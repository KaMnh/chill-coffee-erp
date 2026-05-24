// scripts/migrate/00-check-dump.mjs — Stage 0: pre-flight check trên dump file v2.x.
// KHÔNG cần Docker, không touch DB. Chỉ đọc + parse file SQL.
//
// Kiểm tra:
//   1. File integrity (size, encoding, header pg_dump)
//   2. Postgres version + dump date
//   3. Tables count + per-table row count
//   4. Whitelist coverage (presence + sample 3 rows)
//   5. Risk flags (sales table size, auth.users presence, encoding warnings)
//
// Usage:
//   node scripts/migrate/00-check-dump.mjs [--dump migration/v2-dump.sql] [--out docs/migration/v2-dump-inspection.md]
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

const SCOPE = [
  "employees",
  "employee_accounts",
  "expense_categories",
  "expense_templates",
  "expenses",
  "cash_day_openings",
  "cash_counts",
  "cash_close_reports",
  "cash_drawer_events",
  "shift_assignments",
  "shift_payroll_records",
  "safe_transactions",
  "handover_sessions",
  "handover_tasks",
];

function parseArgs(argv) {
  const out = { dump: "migration/v2-dump.sql", outFile: "docs/migration/v2-dump-inspection.md" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--dump") out.dump = argv[++i];
    else if (argv[i] === "--out") out.outFile = argv[++i];
  }
  return out;
}

// ---- File integrity ----
function checkFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Không tìm thấy file: ${path}\n  → Tải dump từ Supabase Dashboard và đặt vào path trên.`);
  }
  const stat = statSync(path);
  return {
    path,
    sizeBytes: stat.size,
    sizeMB: (stat.size / 1024 / 1024).toFixed(2),
    mtime: stat.mtime.toISOString(),
  };
}

// ---- pg_dump metadata (từ comment header) ----
function extractMetadata(sql) {
  // pg_dump header có dạng:
  //   -- PostgreSQL database dump
  //   --
  //   -- Dumped from database version 15.1 (Ubuntu 15.1-1.pgdg22.04+1)
  //   -- Dumped by pg_dump version 15.4
  const meta = {};
  const versionMatch = sql.match(/--\s*Dumped from database version\s+([^\s\n]+)/i);
  if (versionMatch) meta.serverVersion = versionMatch[1];
  const dumpVersionMatch = sql.match(/--\s*Dumped by pg_dump version\s+([^\s\n]+)/i);
  if (dumpVersionMatch) meta.dumpVersion = dumpVersionMatch[1];
  const dateMatch = sql.match(/--\s*Started on\s+(.+)/i);
  if (dateMatch) meta.startedOn = dateMatch[1].trim();
  // Detect pg_dump output style (đặc trưng `-- Name:` blocks)
  meta.isPgDump = sql.includes("PostgreSQL database dump") || sql.includes("-- Dumped");
  return meta;
}

// ---- Schemas present ----
function extractSchemas(sql) {
  const schemas = new Set();
  const re = /create\s+schema\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi;
  let m;
  while ((m = re.exec(sql)) !== null) schemas.add(m[1]);
  // Cũng detect qua `schema.table` references
  const refRe = /\b(\w+)\.\w+\s*\(/g;
  while ((m = refRe.exec(sql)) !== null) {
    if (!["pg_catalog", "information_schema"].includes(m[1])) schemas.add(m[1]);
  }
  return [...schemas].sort();
}

// ---- Tables + row counts ----
// pg_dump COPY format:
//   COPY public.employees (id, name, ...) FROM stdin;
//   <data row 1>
//   <data row 2>
//   \.
function extractTables(sql) {
  // 1. Find all CREATE TABLE (schema.table)
  const tables = new Map();  // key: "schema.table" → { schema, name, lineNumber, copyRows, sampleRows }
  const lines = sql.split(/\r?\n/);

  // Build line-indexed view của CREATE TABLE locations
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?\s*\(/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(createRe);
    if (m) {
      const schema = m[1] || "public";
      const name = m[2];
      const key = `${schema}.${name}`;
      if (!tables.has(key)) {
        tables.set(key, { schema, name, createdAtLine: i + 1, copyRows: 0, sampleRows: [] });
      }
    }
  }

  // 2. Find COPY blocks and count rows
  const copyRe = /^COPY\s+(?:"?(\w+)"?\.)?"?(\w+)"?\s*\([^)]*\)\s+FROM\s+stdin\s*;/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(copyRe);
    if (!m) continue;
    const schema = m[1] || "public";
    const name = m[2];
    const key = `${schema}.${name}`;

    let rowCount = 0;
    const sample = [];
    let j = i + 1;
    while (j < lines.length && lines[j] !== "\\.") {
      if (lines[j].length > 0) {
        rowCount++;
        if (sample.length < 3) sample.push(lines[j]);
      }
      j++;
    }
    if (!tables.has(key)) {
      tables.set(key, { schema, name, createdAtLine: null, copyRows: 0, sampleRows: [] });
    }
    const t = tables.get(key);
    t.copyRows = rowCount;
    t.sampleRows = sample;
    t.copyAtLine = i + 1;
  }
  return tables;
}

// ---- Risk flags ----
function buildFlags(meta, tables, schemas, sizeMB) {
  const flags = [];

  if (!meta.isPgDump) {
    flags.push({ level: "error", msg: "File không giống pg_dump output. Confirm bạn tải đúng file (Plain SQL format)." });
  }
  if (Number(sizeMB) > 500) {
    flags.push({ level: "warn", msg: `Dump rất lớn (${sizeMB} MB). Stage 2 load có thể mất nhiều phút. Cân nhắc --exclude-table-data='sales_*' khi pg_dump.` });
  }

  // Sales table size warning
  const salesTables = [...tables.values()].filter((t) => t.schema === "public" && /^sales_/.test(t.name));
  const salesRows = salesTables.reduce((s, t) => s + t.copyRows, 0);
  if (salesRows > 10000) {
    flags.push({ level: "info", msg: `Sales tables có ${salesRows.toLocaleString()} rows tổng — KHÔNG migrate (sẽ re-sync từ KiotViet). Bạn có thể dump lại với --exclude-table-data='sales_*' để giảm size.` });
  }

  // auth.users presence (cần cho email mapping)
  const hasAuthUsers = tables.has("auth.users");
  const authUsersRows = hasAuthUsers ? tables.get("auth.users").copyRows : 0;
  if (!hasAuthUsers) {
    flags.push({ level: "warn", msg: "Không thấy bảng `auth.users` trong dump. Email mapping sẽ FAIL — tất cả `created_by` sẽ NULL." });
  } else if (authUsersRows === 0) {
    flags.push({ level: "warn", msg: "Bảng `auth.users` có ở dump nhưng EMPTY. Email mapping sẽ FAIL." });
  } else {
    flags.push({ level: "info", msg: `auth.users có ${authUsersRows} users — email mapping sẵn sàng. Đảm bảo các email này đã đăng ký lại trên v4 trước Stage 3.` });
  }

  // Whitelist coverage
  const missing = SCOPE.filter((t) => !tables.has(`public.${t}`));
  if (missing.length === SCOPE.length) {
    flags.push({ level: "error", msg: "KHÔNG bảng nào trong scope migration có ở dump. Confirm bạn dump đúng project." });
  } else if (missing.length > 0) {
    flags.push({ level: "info", msg: `Bảng scope KHÔNG có ở dump (sẽ skip): ${missing.join(", ")}` });
  }

  // Empty whitelist tables
  const empty = SCOPE.filter((t) => tables.has(`public.${t}`) && tables.get(`public.${t}`).copyRows === 0);
  if (empty.length > 0) {
    flags.push({ level: "info", msg: `Bảng scope EMPTY (không có data để migrate): ${empty.join(", ")}` });
  }

  // Storage / realtime data (sẽ bị strip ở Stage 2, nhưng tăng size dump)
  const storageRows = [...tables.values()]
    .filter((t) => ["storage", "realtime", "_realtime"].includes(t.schema))
    .reduce((s, t) => s + t.copyRows, 0);
  if (storageRows > 0) {
    flags.push({ level: "info", msg: `Storage/realtime có ${storageRows} rows — sẽ bị STRIP ở Stage 2 (không cần thiết).` });
  }

  return flags;
}

// ---- Output ----
function levelIcon(l) {
  return { error: "❌", warn: "⚠️ ", info: "ℹ️ " }[l] || "•";
}

function renderConsole(file, meta, schemas, tables, flags) {
  console.log(">>> Stage 0 — Pre-flight check on dump file\n");
  console.log("[FILE]");
  console.log(`  Path:  ${file.path}`);
  console.log(`  Size:  ${file.sizeMB} MB (${file.sizeBytes.toLocaleString()} bytes)`);
  console.log(`  Mtime: ${file.mtime}`);

  console.log("\n[PG_DUMP METADATA]");
  console.log(`  Is pg_dump:     ${meta.isPgDump ? "✓" : "❌"}`);
  if (meta.serverVersion) console.log(`  Server version: ${meta.serverVersion}`);
  if (meta.dumpVersion) console.log(`  pg_dump version: ${meta.dumpVersion}`);
  if (meta.startedOn) console.log(`  Dumped on:      ${meta.startedOn}`);

  console.log("\n[SCHEMAS]");
  console.log(`  Detected: ${schemas.join(", ")}`);

  console.log("\n[TABLES] (top by row count)");
  const sorted = [...tables.values()]
    .filter((t) => t.copyRows > 0)
    .sort((a, b) => b.copyRows - a.copyRows)
    .slice(0, 15);
  for (const t of sorted) {
    console.log(`  ${(t.schema + "." + t.name).padEnd(40)} ${t.copyRows.toLocaleString().padStart(10)} rows`);
  }
  const totalRows = [...tables.values()].reduce((s, t) => s + t.copyRows, 0);
  console.log(`  ${"".padEnd(40)} ${"---".padStart(10)}`);
  console.log(`  ${"TOTAL".padEnd(40)} ${totalRows.toLocaleString().padStart(10)} rows`);

  console.log("\n[WHITELIST COVERAGE]");
  for (const name of SCOPE) {
    const key = `public.${name}`;
    const t = tables.get(key);
    const status = !t ? "MISSING" : t.copyRows === 0 ? "EMPTY" : `${t.copyRows.toLocaleString()} rows`;
    const icon = !t ? "❌" : t.copyRows === 0 ? "○" : "✓";
    console.log(`  ${icon} ${name.padEnd(28)} ${status}`);
  }

  console.log("\n[FLAGS]");
  if (flags.length === 0) {
    console.log("  ✓ Không có cảnh báo");
  } else {
    for (const f of flags) console.log(`  ${levelIcon(f.level)} ${f.msg}`);
  }
}

function renderMarkdown(file, meta, schemas, tables, flags) {
  const totalRows = [...tables.values()].reduce((s, t) => s + t.copyRows, 0);
  const sortedTables = [...tables.values()]
    .sort((a, b) => (b.copyRows - a.copyRows) || a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name));

  const lines = [
    `# Stage 0 — Dump File Inspection`,
    ``,
    `_Generated: ${new Date().toISOString()}_`,
    ``,
    `## File`,
    ``,
    `- **Path**: \`${file.path}\``,
    `- **Size**: ${file.sizeMB} MB`,
    `- **Mtime**: ${file.mtime}`,
    ``,
    `## pg_dump metadata`,
    ``,
    `- **Detected as pg_dump**: ${meta.isPgDump ? "✓ yes" : "❌ no"}`,
    meta.serverVersion ? `- **Source server version**: ${meta.serverVersion}` : "",
    meta.dumpVersion ? `- **pg_dump version**: ${meta.dumpVersion}` : "",
    meta.startedOn ? `- **Dumped on**: ${meta.startedOn}` : "",
    ``,
    `## Schemas`,
    ``,
    schemas.map((s) => `- \`${s}\``).join("\n"),
    ``,
    `## All tables (sorted by row count desc)`,
    ``,
    `- **Total rows**: ${totalRows.toLocaleString()}`,
    ``,
    `| Schema | Table | Rows | CREATE line | COPY line |`,
    `|---|---|---:|---:|---:|`,
    ...sortedTables.map((t) =>
      `| \`${t.schema}\` | \`${t.name}\` | ${t.copyRows.toLocaleString()} | ${t.createdAtLine ?? "—"} | ${t.copyAtLine ?? "—"} |`
    ),
    ``,
    `## Whitelist coverage (scope migration)`,
    ``,
    `| Table | Status | Rows |`,
    `|---|---|---:|`,
    ...SCOPE.map((n) => {
      const t = tables.get(`public.${n}`);
      if (!t) return `| \`${n}\` | ❌ MISSING | — |`;
      if (t.copyRows === 0) return `| \`${n}\` | ○ EMPTY | 0 |`;
      return `| \`${n}\` | ✓ | ${t.copyRows.toLocaleString()} |`;
    }),
    ``,
    `## Sample rows (3 đầu mỗi whitelist table có data)`,
    ``,
  ];

  for (const n of SCOPE) {
    const t = tables.get(`public.${n}`);
    if (!t || t.copyRows === 0) continue;
    lines.push(`### \`public.${n}\` (${t.copyRows.toLocaleString()} rows)`);
    lines.push("");
    lines.push("```");
    for (const r of t.sampleRows) lines.push(r);
    lines.push("```");
    lines.push("");
  }

  lines.push(`## Risk flags`, ``);
  if (flags.length === 0) {
    lines.push(`- ✓ Không có cảnh báo`);
  } else {
    for (const f of flags) lines.push(`- ${levelIcon(f.level)} ${f.msg}`);
  }
  lines.push(``);

  lines.push(`## Bước tiếp theo`, ``);
  const hasError = flags.some((f) => f.level === "error");
  if (hasError) {
    lines.push(`- ❌ Có error — fix trước khi tiếp tục Stage 1+.`);
  } else {
    lines.push(`1. Review whitelist coverage & sample rows phía trên.`);
    lines.push(`2. Chạy \`npm run migrate:inspect\` (Stage 1 — schema diff).`);
    lines.push(`3. Nếu OK → \`npm run migrate:load\` (Stage 2).`);
  }
  lines.push(``);

  return lines.filter((l) => l !== "").concat([""]).join("\n");  // strip blank empty-string lines
}

// ---- Main ----
const args = parseArgs(process.argv);

const file = checkFile(args.dump);
console.log(`>>> Đọc file ${args.dump} (${file.sizeMB} MB)...`);
const sql = readFileSync(args.dump, "utf8");

const meta = extractMetadata(sql);
const schemas = extractSchemas(sql);
const tables = extractTables(sql);
const flags = buildFlags(meta, tables, schemas, file.sizeMB);

renderConsole(file, meta, schemas, tables, flags);

mkdirSync(dirname(args.outFile), { recursive: true });
writeFileSync(args.outFile, renderMarkdown(file, meta, schemas, tables, flags), "utf8");
console.log(`\n✓ Markdown report: ${args.outFile}`);

const hasError = flags.some((f) => f.level === "error");
if (hasError) {
  console.error("\n❌ Có error flags. Fix trước khi tiếp tục.");
  process.exit(1);
}
