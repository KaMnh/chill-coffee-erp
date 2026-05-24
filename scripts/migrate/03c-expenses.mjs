// scripts/migrate/03c-expenses.mjs — Stage 3c: expenses transactional.
// FK: category_id (via id_map), template_id (via id_map), created_by (via auth email).
// Dedup: WHERE NOT EXISTS composite (business_date, description, amount, created_at).
//
// Usage: node scripts/migrate/03c-expenses.mjs [--dry-run]
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

console.log(">>> Stage 3c — Expenses");

if (!tableExists("legacy_v2", "expenses")) {
  console.error("❌  legacy_v2.expenses missing. Chạy Stage 2 trước.");
  process.exit(1);
}

const hasCatMap = tableExists("legacy_v2", "_mig_idmap_expense_categories");
const hasTplMap = tableExists("legacy_v2", "_mig_idmap_expense_templates");
const hasAuthUsers = tableExists("legacy_v2_auth", "users");

console.log("\n[0] Dependencies:");
console.log(`  category id_map: ${hasCatMap ? "✓" : "⚠️  missing (sẽ set category_id=null)"}`);
console.log(`  template id_map: ${hasTplMap ? "✓" : "⚠️  missing (sẽ set template_id=null)"}`);
console.log(`  legacy_v2_auth.users: ${hasAuthUsers ? "✓" : "⚠️  missing (sẽ set created_by=null)"}`);

console.log("\n[1] Counts:");
console.log(`  legacy_v2.expenses: ${getCount("legacy_v2.expenses")}`);
console.log(`  public.expenses (current): ${getCount("public.expenses")}`);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan: INSERT với FK lookups + dedup composite. Skip apply.");
  process.exit(0);
}

console.log("\n[2] Insert expenses...");
const cols = getCols("legacy_v2", "expenses");
const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;

// FK lookups: chỉ JOIN khi map có
const categoryExpr = hasCatMap && cols.includes("category_id")
  ? "(select v4_id from legacy_v2._mig_idmap_expense_categories where legacy_id = le.category_id)"
  : "null";
const templateExpr = hasTplMap && cols.includes("template_id")
  ? "(select v4_id from legacy_v2._mig_idmap_expense_templates where legacy_id = le.template_id)"
  : "null";

// created_by: email_match qua auth.users
const createdByExpr = hasAuthUsers && cols.includes("created_by")
  ? `(select u4.id from legacy_v2_auth.users lu
       join auth.users u4 on lower(u4.email) = lower(lu.email)
       where lu.id = le.created_by limit 1)`
  : "null";

const sql = `
begin;
set local session_replication_role = 'replica';

insert into public.expenses (
  business_date, category_id, template_id, description, quantity, unit,
  unit_price, amount, payment_method, note, created_by, created_at, updated_at
)
select
  le.business_date,
  ${categoryExpr},
  ${templateExpr},
  le.description,
  coalesce(${pickCol("quantity", "1")}, 1),
  ${pickCol("unit", "null")},
  coalesce(${pickCol("unit_price", "0")}, 0),
  le.amount,
  coalesce(${pickCol("payment_method", "'cash'")}, 'cash'),
  ${pickCol("note", "null")},
  ${createdByExpr},
  coalesce(${pickCol("created_at", "now()")}, now()),
  coalesce(${pickCol("updated_at", "now()")}, now())
from legacy_v2.expenses le
where le.business_date is not null
  and le.description is not null
  and le.amount is not null
  and not exists (
    select 1 from public.expenses pe
    where pe.business_date = le.business_date
      and pe.description = le.description
      and pe.amount = le.amount
      and pe.created_at = coalesce(${pickCol("created_at", "now()")}, now())
  );

-- id_map cho expenses (composite key dedup). DISTINCT ON đảm bảo 1:1
-- (composite match có thể trùng nếu 2 expenses giống hệt nhau).
drop table if exists legacy_v2._mig_idmap_expenses;
create table legacy_v2._mig_idmap_expenses as
select distinct on (le.id) le.id as legacy_id, pe.id as v4_id
from legacy_v2.expenses le
join public.expenses pe on
  pe.business_date = le.business_date
  and pe.description = le.description
  and pe.amount = le.amount
  and pe.created_at = coalesce(${pickCol("created_at", "now()")}, now())
order by le.id, pe.created_at asc;

commit;
`;

psqlExec(sql);

console.log(`  public.expenses: ${getCount("public.expenses")} (sau migrate)`);
console.log(`  id_map: ${getCount("legacy_v2._mig_idmap_expenses")} rows`);

console.log("\n✓ Stage 3c complete.");
console.log("  Next: node scripts/migrate/03d-cash.mjs");
