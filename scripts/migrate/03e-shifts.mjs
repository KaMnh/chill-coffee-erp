// scripts/migrate/03e-shifts.mjs — Stage 3e: shift_assignments + shift_payroll_records.
// FK: employees via _mig_idmap_employees, shift_assignment_id UNIQUE.
//
// Usage: node scripts/migrate/03e-shifts.mjs [--dry-run]
import { psqlExec, psqlQuery, parseTabular } from "./_lib/psql.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

function tableExists(schema, name) {
  return psqlQuery(`select to_regclass('${schema}.${name}') is not null;`,
    { tuplesOnly: true, noAlign: true }).trim() === "t";
}
function getCount(t) {
  return psqlQuery(`select count(*) from ${t};`, { tuplesOnly: true, noAlign: true }).trim();
}
function getCols(schema, name) {
  const sql = `select column_name from information_schema.columns where table_schema='${schema}' and table_name='${name}' order by ordinal_position;`;
  return parseTabular(psqlQuery(sql, { tuplesOnly: true, noAlign: true, fieldSep: "|" })).map((r) => r[0]);
}

console.log(">>> Stage 3e — Shifts (assignments + payroll)");

const hasAssign = tableExists("legacy_v2", "shift_assignments");
const hasPayroll = tableExists("legacy_v2", "shift_payroll_records");
const hasEmpMap = tableExists("legacy_v2", "_mig_idmap_employees");
const hasAuthUsers = tableExists("legacy_v2_auth", "users");

console.log("\n[0] Existence:");
console.log(`  legacy_v2.shift_assignments:     ${hasAssign ? "✓" : "skip"}`);
console.log(`  legacy_v2.shift_payroll_records: ${hasPayroll ? "✓" : "skip"}`);
console.log(`  employees id_map: ${hasEmpMap ? "✓" : "❌ chạy Stage 3a trước"}`);

if (!hasEmpMap) {
  console.error("\n❌  employees id_map missing. Chạy Stage 3a trước.");
  process.exit(1);
}
if (!hasAssign && !hasPayroll) {
  console.log("\nNothing to migrate. Done.");
  process.exit(0);
}

console.log("\n[1] Counts:");
if (hasAssign) console.log(`  legacy_v2.shift_assignments:     ${getCount("legacy_v2.shift_assignments")}`);
if (hasPayroll) console.log(`  legacy_v2.shift_payroll_records: ${getCount("legacy_v2.shift_payroll_records")}`);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan: assignments → payroll với FK lookup employees. Skip apply.");
  process.exit(0);
}

function authLookup(colName) {
  if (!hasAuthUsers) return "null";
  return `(select u4.id from legacy_v2_auth.users lu
           join auth.users u4 on lower(u4.email) = lower(lu.email)
           where lu.id = la.${colName} limit 1)`;
}

// ---- shift_assignments ----
if (hasAssign) {
  console.log("\n[2] shift_assignments...");
  const cols = getCols("legacy_v2", "shift_assignments");
  const pickCol = (n, def) => cols.includes(n) ? `la.${n}` : def;

  const sql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.shift_assignments (
      employee_id, business_date, check_in_at, check_out_at,
      confirmed_by_manager, total_minutes, status,
      created_by, updated_by, created_at, updated_at
    )
    select
      idmap.v4_id,
      la.business_date,
      ${pickCol("check_in_at", "null")},
      ${pickCol("check_out_at", "null")},
      coalesce(${pickCol("confirmed_by_manager", "true")}, true),
      ${pickCol("total_minutes", "null")},
      coalesce(${pickCol("status", "'checked_in'")}, 'checked_in'),
      ${cols.includes("created_by") ? authLookup("created_by") : "null"},
      ${cols.includes("updated_by") ? authLookup("updated_by") : "null"},
      coalesce(${pickCol("created_at", "now()")}, now()),
      coalesce(${pickCol("updated_at", "now()")}, now())
    from legacy_v2.shift_assignments la
    join legacy_v2._mig_idmap_employees idmap on idmap.legacy_id = la.employee_id
    where la.business_date is not null
      and not exists (
        select 1 from public.shift_assignments ps
        where ps.employee_id = idmap.v4_id
          and ps.business_date = la.business_date
          and ps.check_in_at is not distinct from ${pickCol("check_in_at", "null")}
      );

    -- id_map cho shift_assignments. DISTINCT ON đảm bảo 1:1 (cùng employee
    -- + cùng business_date + cùng check_in_at hiếm khi >1 nhưng safety first).
    drop table if exists legacy_v2._mig_idmap_shift_assignments;
    create table legacy_v2._mig_idmap_shift_assignments as
    select distinct on (la.id) la.id as legacy_id, ps.id as v4_id
    from legacy_v2.shift_assignments la
    join legacy_v2._mig_idmap_employees idmap on idmap.legacy_id = la.employee_id
    join public.shift_assignments ps on
      ps.employee_id = idmap.v4_id
      and ps.business_date = la.business_date
      and ps.check_in_at is not distinct from ${pickCol("check_in_at", "null")}
    order by la.id, ps.created_at asc;

    commit;
  `;
  psqlExec(sql);
  console.log(`  public.shift_assignments: ${getCount("public.shift_assignments")}`);
  console.log(`  id_map: ${getCount("legacy_v2._mig_idmap_shift_assignments")} rows`);
}

// ---- shift_payroll_records ----
if (hasPayroll) {
  console.log("\n[3] shift_payroll_records...");
  const cols = getCols("legacy_v2", "shift_payroll_records");
  const pickCol = (n, def) => cols.includes(n) ? `la.${n}` : def;
  const hasAssignMap = tableExists("legacy_v2", "_mig_idmap_shift_assignments");

  // shift_assignment_id có thể link qua id_map nếu có. Nếu không, chèn không link.
  const assignFkExpr = hasAssignMap && cols.includes("shift_assignment_id")
    ? "(select v4_id from legacy_v2._mig_idmap_shift_assignments where legacy_id = la.shift_assignment_id)"
    : "null";

  const sql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.shift_payroll_records (
      shift_assignment_id, employee_id, business_date,
      check_in_at, check_out_at, total_minutes, hourly_rate,
      base_pay, allowance_amount, total_pay, payment_method,
      note, edited_by, edited_at, created_by, created_at
    )
    select
      ${assignFkExpr},
      idmap.v4_id,
      la.business_date,
      ${pickCol("check_in_at", "null")},
      ${pickCol("check_out_at", "null")},
      coalesce(${pickCol("total_minutes", "0")}, 0),
      coalesce(${pickCol("hourly_rate", "0")}, 0),
      coalesce(${pickCol("base_pay", "0")}, 0),
      coalesce(${pickCol("allowance_amount", "0")}, 0),
      coalesce(${pickCol("total_pay", "0")}, 0),
      coalesce(${pickCol("payment_method", "'cash'")}, 'cash'),
      ${pickCol("note", "null")},
      ${cols.includes("edited_by") ? authLookup("edited_by") : "null"},
      ${pickCol("edited_at", "null")},
      ${cols.includes("created_by") ? authLookup("created_by") : "null"},
      coalesce(${pickCol("created_at", "now()")}, now())
    from legacy_v2.shift_payroll_records la
    join legacy_v2._mig_idmap_employees idmap on idmap.legacy_id = la.employee_id
    where la.business_date is not null
    on conflict (shift_assignment_id) do nothing;

    commit;
  `;
  psqlExec(sql);
  console.log(`  public.shift_payroll_records: ${getCount("public.shift_payroll_records")}`);
}

console.log("\n✓ Stage 3e complete.");
console.log("  Next: node scripts/migrate/04-verify.mjs");
