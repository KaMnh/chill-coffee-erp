// scripts/migrate/02-load-staging.mjs — Stage 2: load dump v2.x vào schema legacy_v2.
// Pre-process dump (sed-like transforms) → áp dụng qua docker psql.
//
// Usage:
//   npm run migrate:load
//   node scripts/migrate/02-load-staging.mjs [--dump migration/v2-dump.sql]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { psqlExec, psqlQuery } from "./_lib/psql.mjs";

const WHITELIST = [
  "employees", "employee_accounts", "expense_categories", "expense_templates",
  "expenses", "cash_day_openings", "cash_counts", "cash_close_reports",
  "shift_assignments", "shift_payroll_records",
];

function parseArgs(argv) {
  const out = { dump: "migration/v2-dump.sql", staged: "migration/v2-dump-staged.sql" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dump") out.dump = argv[++i];
    else if (argv[i] === "--staged") out.staged = argv[++i];
  }
  return out;
}

/**
 * Pre-process v2 dump để áp dụng được vào v4 stack:
 * - Rename schema `public` → `legacy_v2` (table refs, schema declarations)
 * - Rename schema `auth` → `legacy_v2_auth`
 * - Strip CREATE EXTENSION (đã có ở v4)
 * - Strip ALTER ... OWNER TO ... (roles không tồn tại)
 * - Strip GRANT ... TO ... cho non-existent roles
 * - Skip block storage/realtime (out of scope)
 */
function preprocessDump(raw) {
  let sql = raw;

  // Strip pg_dump 17+ meta-commands `\restrict <token>` / `\unrestrict <token>`
  // (search-path attack guards) — psql 15 trong container Supabase không nhận
  // diện được, sẽ raise "invalid command" và abort với ON_ERROR_STOP=1.
  // Safe to strip vì chỉ là security guard, không ảnh hưởng data.
  sql = sql.replace(/^\\restrict\s+\S+\s*$/gim, "-- (stripped \\restrict — psql 15 không hỗ trợ)");
  sql = sql.replace(/^\\unrestrict\s+\S+\s*$/gim, "-- (stripped \\unrestrict — psql 15 không hỗ trợ)");

  // Postgres 17+ added `transaction_timeout` GUC. Server 15 không nhận → ERROR
  // "unrecognized configuration parameter". Strip safely (chỉ là header pg_dump
  // reset timeouts về 0, không ảnh hưởng data).
  sql = sql.replace(/^SET\s+transaction_timeout\s*=.*$/gim, "-- (stripped SET transaction_timeout — Postgres 15 không có)");

  // Replace schema declarations
  sql = sql.replace(/CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"?public"?\s*;/gi,
    "-- (skipped public schema creation; using legacy_v2 instead)");
  sql = sql.replace(/CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?"?auth"?\s*;/gi,
    "-- (skipped auth schema creation)");

  // Rename `public.` and `"public".` → `legacy_v2.`
  sql = sql.replace(/\bpublic\./g, "legacy_v2.");
  sql = sql.replace(/"public"\./g, '"legacy_v2".');
  sql = sql.replace(/SCHEMA\s+public\b/gi, "SCHEMA legacy_v2");
  sql = sql.replace(/SET\s+search_path\s*=\s*[^;]+;/gi,
    "SET search_path = legacy_v2, legacy_v2_auth, public;");

  // Rename auth schema refs
  sql = sql.replace(/\bauth\.users\b/g, "legacy_v2_auth.users");
  sql = sql.replace(/"auth"\."users"/g, '"legacy_v2_auth"."users"');
  // Other auth tables (sessions, identities...) — chỉ giữ users vì migration cần
  sql = sql.replace(/^.*\bauth\.(sessions|identities|refresh_tokens|audit_log_entries|mfa_\w+|sso_\w+|flow_state|saml_\w+|instances|schema_migrations)\b.*$/gim,
    "-- (stripped auth subsystem table ref)");

  // Strip extension creation (v4 đã có)
  sql = sql.replace(/^\s*CREATE\s+EXTENSION[^;]+;\s*$/gim,
    "-- (stripped CREATE EXTENSION)");
  sql = sql.replace(/^\s*COMMENT\s+ON\s+EXTENSION[^;]+;\s*$/gim,
    "-- (stripped COMMENT ON EXTENSION)");

  // Strip ALTER ... OWNER TO (roles supabase_admin/anon/authenticated etc. may not exist)
  sql = sql.replace(/^\s*ALTER\s+[\s\S]+?OWNER\s+TO[^;]+;\s*$/gim,
    "-- (stripped ALTER OWNER TO)");

  // Strip GRANT statements (RLS bằng cách khác)
  sql = sql.replace(/^\s*(GRANT|REVOKE)\s+[\s\S]+?;\s*$/gim,
    "-- (stripped GRANT/REVOKE)");

  // Skip storage/realtime/supabase_functions blocks
  sql = sql.replace(/^.*\b(storage|realtime|_realtime|supabase_functions|graphql|graphql_public|pgsodium|vault|net|extensions)\.\w+\b.*$/gim,
    "-- (stripped supabase subsystem ref)");

  // Strip ALTER DEFAULT PRIVILEGES (RLS irrelevant ở legacy_v2)
  sql = sql.replace(/^\s*ALTER\s+DEFAULT\s+PRIVILEGES[\s\S]+?;\s*$/gim,
    "-- (stripped ALTER DEFAULT PRIVILEGES)");

  // Strip publication / replication
  sql = sql.replace(/^\s*(CREATE|ALTER|DROP)\s+PUBLICATION[\s\S]+?;\s*$/gim,
    "-- (stripped PUBLICATION)");

  // Strip RLS policies (irrelevant ở legacy_v2 - psql user postgres bypass)
  sql = sql.replace(/^\s*CREATE\s+POLICY[\s\S]+?;\s*$/gim,
    "-- (stripped CREATE POLICY)");
  sql = sql.replace(/^\s*ALTER\s+TABLE[\s\S]+?ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;\s*$/gim,
    "-- (stripped ENABLE ROW LEVEL SECURITY)");

  return sql;
}

const args = parseArgs(process.argv);
if (!existsSync(args.dump)) {
  console.error(`❌  Không tìm thấy dump file: ${args.dump}`);
  console.error(`   Tải v2 dump từ Supabase Dashboard → Database → Backups → Download (Plain SQL).`);
  console.error(`   Đặt vào path trên hoặc dùng --dump <path>.`);
  process.exit(1);
}

console.log(`>>> Đọc dump: ${args.dump}`);
const raw = readFileSync(args.dump, "utf8");
console.log(`    Size: ${(raw.length / 1024 / 1024).toFixed(2)} MB`);

console.log(`>>> Pre-process dump → ${args.staged}`);
const staged = preprocessDump(raw);
writeFileSync(args.staged, staged, "utf8");
console.log(`    Output: ${(staged.length / 1024 / 1024).toFixed(2)} MB`);

console.log(`\n>>> Drop & recreate staging schemas`);
psqlExec(`
  drop schema if exists legacy_v2 cascade;
  drop schema if exists legacy_v2_auth cascade;
  create schema legacy_v2;
  create schema legacy_v2_auth;

  -- Stub auth.users table in legacy schema (in case dump không có)
  create table if not exists legacy_v2_auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb,
    created_at timestamptz
  );
`);

console.log(`\n>>> Áp staged dump vào legacy_v2 (qua docker psql, có thể mất vài phút)`);
psqlExec(staged);

// Load auth.users CSV (cho email mapping ở Stage 3) — Supabase Dashboard backup
// không bao gồm schema auth, nên user phải dump riêng từ SQL Editor:
//   select id, email from auth.users;  → Download CSV → migration/v2-auth-users.csv
const authCsvPath = "migration/v2-auth-users.csv";
if (existsSync(authCsvPath)) {
  // Normalize CSV: strip BOM, convert CRLF → LF, drop empty trailing lines.
  // psql COPY parser strict về newlines — CRLF từ Windows + trailing empty line
  // sẽ raise "unquoted newline found in data".
  const csvRaw = readFileSync(authCsvPath, "utf8")
    .replace(/^﻿/, "")              // strip UTF-8 BOM nếu có
    .replace(/\r\n/g, "\n")              // CRLF → LF
    .replace(/\r/g, "\n");               // lone CR → LF
  const allLines = csvRaw.split("\n").filter((l) => l.trim().length > 0);
  const headerLine = (allLines[0] || "").toLowerCase();
  const hasHeader = headerLine.includes("id") && headerLine.includes("email");
  const dataLines = hasHeader ? allLines.slice(1) : allLines;
  console.log(`\n>>> Load auth.users CSV: ${authCsvPath} (${dataLines.length} rows)`);

  // Rebuild clean CSV body với LF endings + 1 trailing newline trước \.
  const csvBody = "id,email\n" + dataLines.join("\n") + "\n";
  psqlExec(
    "truncate table legacy_v2_auth.users;\n" +
    "copy legacy_v2_auth.users(id, email) from stdin csv header;\n" +
    csvBody + "\\.\n"
  );
  console.log(`    ✓ Loaded ${dataLines.length} auth users vào legacy_v2_auth.users`);
} else {
  console.log(`\n⚠️  ${authCsvPath} không tồn tại — email mapping sẽ FAIL.`);
  console.log(`   Để có email mapping, dump auth.users từ Supabase v2 Dashboard:`);
  console.log(`     1. SQL Editor → run: select id, email from auth.users;`);
  console.log(`     2. Click "Download CSV" → save vào ${authCsvPath}`);
  console.log(`     3. Rerun: npm run migrate:load`);
}

console.log(`\n>>> Verify: row counts trong legacy_v2.*`);
const tables = WHITELIST.map((t) => `'${t}' as table_name, (select count(*) from legacy_v2.${t})`).join(" union all select ");
const sql = `select table_name, count from (select ${tables.replace("'", "'")}) s order by 1;`;

try {
  const sumSql = WHITELIST.map((t) =>
    `select '${t}' as table_name, (select count(*) from legacy_v2.${t}) as row_count`
  ).join("\nunion all\n") + "\norder by 1;";
  psqlExec(sumSql);
} catch (e) {
  console.warn(`⚠️  Một số bảng không tồn tại trong v2 dump — đó là OK nếu nằm ngoài v2.x scope.`);
  console.warn(`    Chạy: docker compose exec db psql -U postgres -c "\\dt legacy_v2.*"  để xem bảng thực tế.`);
}

console.log(`\n✓ Stage 2 xong. Inspect kết quả:`);
console.log(`   docker compose exec db psql -U postgres -c "\\\\dt legacy_v2.*"`);
console.log(`\nKế tiếp: review docs/migration/v2-to-v4-schema-diff.md → tạo migration/mapping-rules.json → chạy Stage 3.`);
