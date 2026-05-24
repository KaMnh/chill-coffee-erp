// scripts/migrate/03a-employees.mjs — Stage 3a: migrate employees + employee_accounts.
// FK order: employees TRƯỚC, sau đó employee_accounts (qua email_match).
//
// Usage:
//   node scripts/migrate/03a-employees.mjs [--dry-run]
//
// Pre-requisites:
//   - Stage 2 đã chạy (legacy_v2.employees tồn tại)
//   - Owner/manager v2 đã đăng ký lại trên v4 bằng CÙNG email (để email_match work)
import { psqlExec, psqlQuery, parseTabular } from "./_lib/psql.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const DRY_RUN = process.argv.includes("--dry-run");

function check(label, value) {
  console.log(`  ${label}: ${value}`);
}

// ---- Step 0: existence checks ----
function tableExists(schema, name) {
  const sql = `select to_regclass('${schema}.${name}') is not null;`;
  return psqlQuery(sql, { tuplesOnly: true, noAlign: true }).trim() === "t";
}

const hasLegacyEmployees = tableExists("legacy_v2", "employees");
const hasLegacyAccounts = tableExists("legacy_v2", "employee_accounts");
const hasLegacyAuthUsers = tableExists("legacy_v2_auth", "users");

console.log(">>> Stage 3a — Employees + Employee Accounts");
console.log("\n[0] Existence checks:");
check("legacy_v2.employees", hasLegacyEmployees ? "✓" : "❌ MISSING — abort");
check("legacy_v2.employee_accounts", hasLegacyAccounts ? "✓" : "⚠️  missing — sẽ skip account migration");
check("legacy_v2_auth.users", hasLegacyAuthUsers ? "✓" : "⚠️  missing — không thể email-map");

if (!hasLegacyEmployees) {
  console.error("\n❌  legacy_v2.employees không tồn tại. Chạy Stage 2 trước.");
  process.exit(1);
}

// ---- Step 1: counts before ----
console.log("\n[1] Counts trước migration:");
const beforeV2 = psqlQuery("select count(*) from legacy_v2.employees;", { tuplesOnly: true, noAlign: true }).trim();
const beforeV4 = psqlQuery("select count(*) from public.employees;", { tuplesOnly: true, noAlign: true }).trim();
check("legacy_v2.employees", beforeV2);
check("public.employees (current)", beforeV4);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan:");
  console.log("  - INSERT INTO public.employees từ legacy_v2.employees");
  console.log("  - Conflict target: code (nếu có), fallback name (lower trim)");
  console.log("  - Disable triggers via SET LOCAL session_replication_role = 'replica'");
  if (hasLegacyAccounts && hasLegacyAuthUsers) {
    console.log("  - INSERT INTO public.employee_accounts với email_match auth.users");
    console.log("  - Log unmapped emails vào migration/unmapped-users.csv");
  }
  console.log("\nKhông apply changes (dry-run). Bỏ flag để chạy thật.");
  process.exit(0);
}

// ---- Step 2: insert employees ----
console.log("\n[2] Insert employees...");

// Detect columns thực tế trong legacy_v2.employees (vì v2 có thể thiếu một số cột v4).
const colSql = `
  select column_name from information_schema.columns
  where table_schema='legacy_v2' and table_name='employees'
  order by ordinal_position;
`;
const legacyEmpCols = parseTabular(psqlQuery(colSql, { tuplesOnly: true, noAlign: true, fieldSep: "|" })).map((r) => r[0]);
console.log(`  Cột phát hiện trong legacy_v2.employees: ${legacyEmpCols.join(", ")}`);

// Helper: chọn column expression hoặc default nếu không có ở v2.
function pickCol(name, defaultExpr) {
  return legacyEmpCols.includes(name) ? `le.${name}` : defaultExpr;
}

// Root cause fix: nếu le.code IS NULL, generate unique code 'V2-<12 chars UUID>'.
// Lý do: v2 dump có 16/16 employees với code=NULL; ON CONFLICT (code) DO NOTHING
// không fire khi NULL ≠ NULL → duplicate "Nhật Anh" (3 người) gây fanout id_map.
// Sau fix: mọi v2 employee có unique code → 1:1 id_map qua code (no name fallback).
const codeExpr = legacyEmpCols.includes("code")
  ? "coalesce(le.code, 'V2-' || substring(le.id::text, 1, 12))"
  : "'V2-' || substring(le.id::text, 1, 12)";

const insertEmployeesSql = `
begin;
set local session_replication_role = 'replica';

insert into public.employees (code, name, position, hourly_rate, is_active, created_at, updated_at)
select
  ${codeExpr},
  ${pickCol("name", "'Unknown'")},
  ${pickCol("position", "null")},
  coalesce(${pickCol("hourly_rate", "0")}, 0),
  coalesce(${pickCol("is_active", "true")}, true),
  coalesce(${pickCol("created_at", "now()")}, now()),
  coalesce(${pickCol("updated_at", "now()")}, now())
from legacy_v2.employees le
where le.name is not null
on conflict (code) do nothing;

-- Build id_map: 1:1 mapping qua generated code. Seed owner (code=NULL) tự exclude.
-- DISTINCT ON defense-in-depth (lẽ ra mỗi code là unique, nhưng giữ safety).
drop table if exists legacy_v2._mig_idmap_employees;
create table legacy_v2._mig_idmap_employees as
select distinct on (le.id)
  le.id as legacy_id, pe.id as v4_id, le.name as name
from legacy_v2.employees le
join public.employees pe on pe.code = ${codeExpr}
order by le.id, pe.created_at asc;

commit;

select count(*) as mapped_count from legacy_v2._mig_idmap_employees;
`;

psqlExec(insertEmployeesSql);

const afterV4Emp = psqlQuery("select count(*) from public.employees;", { tuplesOnly: true, noAlign: true }).trim();
const mappedCount = psqlQuery("select count(*) from legacy_v2._mig_idmap_employees;", { tuplesOnly: true, noAlign: true }).trim();
console.log(`  public.employees: ${beforeV4} → ${afterV4Emp} (+${Number(afterV4Emp) - Number(beforeV4)})`);
console.log(`  id_map built: ${mappedCount} rows`);

// ---- Step 3: employee_accounts (chỉ khi có) ----
if (!hasLegacyAccounts) {
  console.log("\n[3] Skip employee_accounts (legacy table missing).");
} else if (!hasLegacyAuthUsers) {
  console.log("\n[3] Skip employee_accounts (legacy_v2_auth.users missing — không email-map được).");
} else {
  console.log("\n[3] Insert employee_accounts với email_match...");

  // Build & log unmapped users CSV first
  const unmappedSql = `
    select distinct lu.email::text as email, lea.role::text as legacy_role
    from legacy_v2.employee_accounts lea
    join legacy_v2_auth.users lu on lu.id = lea.auth_user_id
    left join auth.users u4 on lower(u4.email) = lower(lu.email)
    where u4.id is null and lu.email is not null
    order by 1;
  `;
  const unmapped = parseTabular(psqlQuery(unmappedSql, { tuplesOnly: true, noAlign: true, fieldSep: "|" }));
  if (unmapped.length > 0) {
    mkdirSync("migration", { recursive: true });
    const csv = ["email,legacy_role"].concat(unmapped.map((r) => r.join(","))).join("\n");
    writeFileSync("migration/unmapped-users.csv", csv, "utf8");
    console.log(`  ⚠️  ${unmapped.length} email không match v4 auth.users → migration/unmapped-users.csv`);
    console.log(`      Các email này phải đăng ký trên v4 trước khi rerun, hoặc bỏ qua.`);
  } else {
    console.log(`  ✓ Tất cả email match được auth.users.`);
  }

  const insertAccountsSql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.employee_accounts (employee_id, auth_user_id, role, status, created_at)
    select
      idmap.v4_id,
      u4.id,
      lea.role,
      coalesce(lea.status, 'active'),
      coalesce(lea.created_at, now())
    from legacy_v2.employee_accounts lea
    join legacy_v2._mig_idmap_employees idmap on idmap.legacy_id = lea.employee_id
    join legacy_v2_auth.users lu on lu.id = lea.auth_user_id
    join auth.users u4 on lower(u4.email) = lower(lu.email)
    where lea.role in ('owner','manager','staff_operator','employee_viewer')
    on conflict (auth_user_id) do nothing;

    commit;
  `;
  psqlExec(insertAccountsSql);

  const accCount = psqlQuery("select count(*) from public.employee_accounts;", { tuplesOnly: true, noAlign: true }).trim();
  console.log(`  public.employee_accounts: ${accCount} rows total`);
}

// ---- Summary ----
console.log("\n✓ Stage 3a complete.");
console.log("  Next: node scripts/migrate/03b-expense-masters.mjs");
