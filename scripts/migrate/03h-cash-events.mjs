// scripts/migrate/03h-cash-events.mjs — Stage 3h: cash_drawer_events.
// FK chain (chỉ lookup khi id_map có):
//   expense_id → _mig_idmap_expenses
//   cash_count_id → _mig_idmap_cash_counts
//   shift_payroll_record_id → KHÔNG có id_map (03e không build)
//   sales_order_id, sales_payment_id → NULL (không migrate sales)
//
// Usage: node scripts/migrate/03h-cash-events.mjs [--dry-run]
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

console.log(">>> Stage 3h — Cash Drawer Events");

if (!tableExists("legacy_v2", "cash_drawer_events")) {
  console.log("\nlegacy_v2.cash_drawer_events không tồn tại — skip.");
  process.exit(0);
}

const hasExpenseMap = tableExists("legacy_v2", "_mig_idmap_expenses");
const hasCountMap = tableExists("legacy_v2", "_mig_idmap_cash_counts");
const hasAuthUsers = tableExists("legacy_v2_auth", "users") &&
  Number(getCount("legacy_v2_auth.users")) > 0;

console.log("\n[0] Dependencies:");
console.log(`  expenses id_map:     ${hasExpenseMap ? "✓" : "⚠️  expense_id sẽ null"}`);
console.log(`  cash_counts id_map:  ${hasCountMap ? "✓" : "⚠️  cash_count_id sẽ null"}`);
console.log(`  legacy_v2_auth.users: ${hasAuthUsers ? "✓" : "⚠️  created_by sẽ null"}`);
console.log(`  sales_*: KHÔNG migrate → sales_order_id, sales_payment_id = NULL (expected)`);
console.log(`  shift_payroll_records id_map: KHÔNG build → shift_payroll_record_id = NULL (acceptable)`);

console.log("\n[1] Counts:");
console.log(`  legacy_v2.cash_drawer_events: ${getCount("legacy_v2.cash_drawer_events")}`);
console.log(`  public.cash_drawer_events:    ${getCount("public.cash_drawer_events")}`);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan: insert ~1500 events với FK lookups (chỉ expense + cash_count link).");
  process.exit(0);
}

console.log("\n[2] Insert cash_drawer_events...");
const cols = getCols("legacy_v2", "cash_drawer_events");
const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;

function authLookup(colName) {
  if (!hasAuthUsers) return "null";
  return `(select u4.id from legacy_v2_auth.users lu
           join auth.users u4 on lower(u4.email) = lower(lu.email)
           where lu.id = le.${colName} limit 1)`;
}

const expenseFk = hasExpenseMap && cols.includes("expense_id")
  ? "(select v4_id from legacy_v2._mig_idmap_expenses where legacy_id = le.expense_id)"
  : "null";
const countFk = hasCountMap && cols.includes("cash_count_id")
  ? "(select v4_id from legacy_v2._mig_idmap_cash_counts where legacy_id = le.cash_count_id)"
  : "null";

// Dedup composite: (business_date, occurred_at, event_type, amount)
const sql = `
begin;
set local session_replication_role = 'replica';

insert into public.cash_drawer_events (
  business_date, occurred_at, event_type, direction, amount,
  balance_after,
  sales_order_id, sales_payment_id,
  expense_id, shift_payroll_record_id, cash_count_id,
  created_by, source, note, raw_json, created_at
)
select
  le.business_date,
  coalesce(${pickCol("occurred_at", "now()")}, now()),
  ${pickCol("event_type", "'manual_adjustment'")},
  ${pickCol("direction", "'snapshot'")},
  coalesce(${pickCol("amount", "0")}, 0),
  ${pickCol("balance_after", "null")},
  null,  -- sales_order_id: sales không migrate
  null,  -- sales_payment_id: sales không migrate
  ${expenseFk},
  null,  -- shift_payroll_record_id: id_map không build
  ${countFk},
  ${cols.includes("created_by") ? authLookup("created_by") : "null"},
  coalesce(${pickCol("source", "'app_action'")}, 'app_action'),
  ${pickCol("note", "null")},
  ${pickCol("raw_json", "null")},
  coalesce(${pickCol("created_at", "now()")}, now())
from legacy_v2.cash_drawer_events le
where le.business_date is not null
  and ${pickCol("event_type", "'manual_adjustment'")} in (
    'opening_cash','pos_cash_in','customer_cash_received','change_given',
    'expense_cash_out','payroll_cash_out','cash_count_snapshot','manual_adjustment'
  )
  and ${pickCol("direction", "'snapshot'")} in ('in','out','snapshot')
  and not exists (
    select 1 from public.cash_drawer_events pe
    where pe.business_date = le.business_date
      and pe.occurred_at = coalesce(${pickCol("occurred_at", "now()")}, now())
      and pe.event_type = ${pickCol("event_type", "'manual_adjustment'")}
      and pe.amount = coalesce(${pickCol("amount", "0")}, 0)
  );

commit;
`;

psqlExec(sql);

console.log(`  public.cash_drawer_events: ${getCount("public.cash_drawer_events")} (sau migrate)`);

console.log("\n✓ Stage 3h complete.");
console.log("  Next: npm run migrate:verify");
