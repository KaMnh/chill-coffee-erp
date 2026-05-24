// scripts/migrate/03f-safe.mjs — Stage 3f: safe_transactions (sổ quỹ).
// FK: cash_close_report_id, cash_day_opening_id (qua id_maps Stage 3d), created_by.
// CHECK constraint: amount sign by transaction_type (script clamp nếu v2 khác).
//
// Usage: node scripts/migrate/03f-safe.mjs [--dry-run]
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

console.log(">>> Stage 3f — Safe Transactions (sổ quỹ)");

if (!tableExists("legacy_v2", "safe_transactions")) {
  console.log("\nlegacy_v2.safe_transactions không tồn tại — skip.");
  process.exit(0);
}

const hasAuthUsers = tableExists("legacy_v2_auth", "users") &&
  Number(getCount("legacy_v2_auth.users")) > 0;
const hasReportMap = tableExists("legacy_v2", "_mig_idmap_cash_close_reports");
const hasOpeningMap = tableExists("legacy_v2", "_mig_idmap_cash_day_openings");

console.log("\n[0] Dependencies:");
console.log(`  legacy_v2_auth.users (rows): ${hasAuthUsers ? "✓" : "⚠️  empty/missing — created_by sẽ null"}`);
console.log(`  cash_close_reports id_map:   ${hasReportMap ? "✓" : "⚠️  missing — cash_close_report_id sẽ null"}`);
console.log(`  cash_day_openings id_map:    ${hasOpeningMap ? "✓" : "⚠️  missing — cash_day_opening_id sẽ null"}`);

console.log("\n[1] Counts:");
console.log(`  legacy_v2.safe_transactions: ${getCount("legacy_v2.safe_transactions")}`);
console.log(`  public.safe_transactions:    ${getCount("public.safe_transactions")}`);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan: insert với FK lookups + clamp amount sign. Skip apply.");
  process.exit(0);
}

console.log("\n[2] Insert safe_transactions...");
const cols = getCols("legacy_v2", "safe_transactions");
const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;

function authLookup(colName) {
  if (!hasAuthUsers) return "null";
  return `(select u4.id from legacy_v2_auth.users lu
           join auth.users u4 on lower(u4.email) = lower(lu.email)
           where lu.id = le.${colName} limit 1)`;
}

const reportFk = hasReportMap && cols.includes("cash_close_report_id")
  ? "(select v4_id from legacy_v2._mig_idmap_cash_close_reports where legacy_id = le.cash_close_report_id)"
  : "null";

// cash_close_reports id_map name in 03d-cash.mjs is `_mig_idmap_cash_counts` — let me check
// Actually 03d-cash.mjs only creates _mig_idmap_cash_counts. Reports id_map isn't created.
// So cash_close_report_id will need to be looked up via JOIN through cash_counts:
//   legacy report → cash_count_id → v4 cash_count via _mig_idmap_cash_counts → v4 report via cash_count_id
const reportFkViaCash = cols.includes("cash_close_report_id") &&
  tableExists("legacy_v2", "_mig_idmap_cash_counts") &&
  tableExists("legacy_v2", "cash_close_reports")
  ? `(select pr.id from legacy_v2.cash_close_reports lcr
       join legacy_v2._mig_idmap_cash_counts icm on icm.legacy_id = lcr.cash_count_id
       join public.cash_close_reports pr on pr.cash_count_id = icm.v4_id
       where lcr.id = le.cash_close_report_id limit 1)`
  : "null";

const openingFk = hasOpeningMap && cols.includes("cash_day_opening_id")
  ? "(select v4_id from legacy_v2._mig_idmap_cash_day_openings where legacy_id = le.cash_day_opening_id)"
  : "null";

// Note: 03d-cash.mjs hiện không build id_map cho cash_day_openings → openingFk sẽ null.
// Fallback: lookup qua business_date trong legacy + public (cash_day_openings.business_date unique).
const openingFkViaDate = cols.includes("cash_day_opening_id") &&
  tableExists("legacy_v2", "cash_day_openings")
  ? `(select po.id from legacy_v2.cash_day_openings lo
       join public.cash_day_openings po on po.business_date = lo.business_date
       where lo.id = le.cash_day_opening_id limit 1)`
  : "null";

const sql = `
begin;
set local session_replication_role = 'replica';

insert into public.safe_transactions (
  occurred_at, transaction_type, amount, balance_after,
  reason_category, description,
  cash_close_report_id, cash_day_opening_id,
  created_by, created_at
)
select
  coalesce(${pickCol("occurred_at", "now()")}, now()),
  ${pickCol("transaction_type", "'adjustment'")},
  -- Clamp amount sign theo transaction_type (v4 CHECK constraint)
  case ${pickCol("transaction_type", "'adjustment'")}
    when 'initial_setup'  then abs(coalesce(${pickCol("amount", "0")}, 0))
    when 'deposit_close'  then abs(coalesce(${pickCol("amount", "0")}, 0))
    when 'withdraw_open'  then -abs(coalesce(${pickCol("amount", "0")}, 0))
    when 'withdraw_other' then -abs(coalesce(${pickCol("amount", "0")}, 0))
    else coalesce(${pickCol("amount", "0")}, 0)
  end,
  greatest(0, coalesce(${pickCol("balance_after", "0")}, 0)),  -- v4 CHECK: balance >= 0
  ${pickCol("reason_category", "null")},
  ${pickCol("description", "null")},
  ${reportFkViaCash},
  ${openingFkViaDate},
  ${cols.includes("created_by") ? authLookup("created_by") : "null"},
  coalesce(${pickCol("created_at", "now()")}, now())
from legacy_v2.safe_transactions le
where ${pickCol("transaction_type", "'adjustment'")} in
  ('initial_setup','deposit_close','withdraw_open','withdraw_other','adjustment')
  and not exists (
    select 1 from public.safe_transactions ps
    where ps.occurred_at = coalesce(${pickCol("occurred_at", "now()")}, now())
      and ps.transaction_type = ${pickCol("transaction_type", "'adjustment'")}
      and ps.amount = case ${pickCol("transaction_type", "'adjustment'")}
        when 'initial_setup'  then abs(coalesce(${pickCol("amount", "0")}, 0))
        when 'deposit_close'  then abs(coalesce(${pickCol("amount", "0")}, 0))
        when 'withdraw_open'  then -abs(coalesce(${pickCol("amount", "0")}, 0))
        when 'withdraw_other' then -abs(coalesce(${pickCol("amount", "0")}, 0))
        else coalesce(${pickCol("amount", "0")}, 0)
      end
  );

commit;
`;

psqlExec(sql);

console.log(`  public.safe_transactions: ${getCount("public.safe_transactions")} (sau migrate)`);

console.log("\n✓ Stage 3f complete.");
console.log("  Next: node scripts/migrate/03g-handover.mjs");
