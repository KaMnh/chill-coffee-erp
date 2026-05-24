// scripts/migrate/03b-expense-masters.mjs — Stage 3b: expense_categories + expense_templates.
// Master data, không có FK dependency phức tạp. Conflict trên lower(trim(name/label)) where is_active.
//
// Usage:
//   node scripts/migrate/03b-expense-masters.mjs [--dry-run]
import { psqlExec, psqlQuery, parseTabular } from "./_lib/psql.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

function tableExists(schema, name) {
  return psqlQuery(`select to_regclass('${schema}.${name}') is not null;`,
    { tuplesOnly: true, noAlign: true }).trim() === "t";
}

function getCount(table) {
  return psqlQuery(`select count(*) from ${table};`, { tuplesOnly: true, noAlign: true }).trim();
}

console.log(">>> Stage 3b — Expense Masters (categories + templates)");

const hasLegacyCat = tableExists("legacy_v2", "expense_categories");
const hasLegacyTpl = tableExists("legacy_v2", "expense_templates");

console.log("\n[0] Existence checks:");
console.log(`  legacy_v2.expense_categories: ${hasLegacyCat ? "✓" : "❌"}`);
console.log(`  legacy_v2.expense_templates:  ${hasLegacyTpl ? "✓" : "❌"}`);

if (!hasLegacyCat) {
  console.warn("⚠️  legacy_v2.expense_categories missing — skip categories.");
}
if (!hasLegacyTpl) {
  console.warn("⚠️  legacy_v2.expense_templates missing — skip templates.");
}
if (!hasLegacyCat && !hasLegacyTpl) {
  console.log("\nNothing to migrate. Done.");
  process.exit(0);
}

console.log("\n[1] Counts trước migration:");
if (hasLegacyCat) console.log(`  legacy_v2.expense_categories: ${getCount("legacy_v2.expense_categories")}`);
if (hasLegacyTpl) console.log(`  legacy_v2.expense_templates:  ${getCount("legacy_v2.expense_templates")}`);
console.log(`  public.expense_categories:    ${getCount("public.expense_categories")}`);
console.log(`  public.expense_templates:     ${getCount("public.expense_templates")}`);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan:");
  if (hasLegacyCat) console.log("  - INSERT expense_categories ON CONFLICT lower(trim(name)) where is_active");
  if (hasLegacyTpl) console.log("  - INSERT expense_templates ON CONFLICT lower(trim(label)) where is_active");
  console.log("\nKhông apply changes.");
  process.exit(0);
}

// Detect columns thực tế.
function getCols(schema, name) {
  const sql = `
    select column_name from information_schema.columns
    where table_schema='${schema}' and table_name='${name}'
    order by ordinal_position;
  `;
  return parseTabular(psqlQuery(sql, { tuplesOnly: true, noAlign: true, fieldSep: "|" })).map((r) => r[0]);
}

if (hasLegacyCat) {
  console.log("\n[2] Insert expense_categories...");
  const cols = getCols("legacy_v2", "expense_categories");
  const pickCol = (n, def) => cols.includes(n) ? `lc.${n}` : def;
  const sql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.expense_categories (name, type, sort_order, is_active, created_at, updated_at)
    select
      lc.name,
      coalesce(${pickCol("type", "'expense'")}, 'expense'),
      coalesce(${pickCol("sort_order", "100")}, 100),
      coalesce(${pickCol("is_active", "true")}, true),
      coalesce(${pickCol("created_at", "now()")}, now()),
      coalesce(${pickCol("updated_at", "now()")}, now())
    from legacy_v2.expense_categories lc
    where lc.name is not null
      and not exists (
        select 1 from public.expense_categories pc
        where lower(trim(pc.name)) = lower(trim(lc.name)) and pc.is_active
      );

    -- id_map: legacy_id → v4_id (qua name match). DISTINCT ON đảm bảo 1:1.
    drop table if exists legacy_v2._mig_idmap_expense_categories;
    create table legacy_v2._mig_idmap_expense_categories as
    select distinct on (lc.id) lc.id as legacy_id, pc.id as v4_id
    from legacy_v2.expense_categories lc
    join public.expense_categories pc on lower(trim(pc.name)) = lower(trim(lc.name))
    order by lc.id, pc.created_at asc;

    commit;
  `;
  psqlExec(sql);
  console.log(`  public.expense_categories: ${getCount("public.expense_categories")} (sau migrate)`);
  console.log(`  id_map: ${getCount("legacy_v2._mig_idmap_expense_categories")} rows`);
}

if (hasLegacyTpl) {
  console.log("\n[3] Insert expense_templates...");
  const cols = getCols("legacy_v2", "expense_templates");
  const pickCol = (n, def) => cols.includes(n) ? `lt.${n}` : def;
  // default_category_id needs FK lookup via id_map
  const sql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.expense_templates (label, default_category_id, default_unit, last_unit_price, usage_count, last_used_at, is_active, created_at, updated_at)
    select
      lt.label,
      ${cols.includes("default_category_id")
        ? "(select v4_id from legacy_v2._mig_idmap_expense_categories where legacy_id = lt.default_category_id)"
        : "null"},
      ${pickCol("default_unit", "null")},
      coalesce(${pickCol("last_unit_price", "0")}, 0),
      coalesce(${pickCol("usage_count", "0")}, 0),
      ${pickCol("last_used_at", "null")},
      coalesce(${pickCol("is_active", "true")}, true),
      coalesce(${pickCol("created_at", "now()")}, now()),
      coalesce(${pickCol("updated_at", "now()")}, now())
    from legacy_v2.expense_templates lt
    where lt.label is not null
      and not exists (
        select 1 from public.expense_templates pt
        where lower(trim(pt.label)) = lower(trim(lt.label)) and pt.is_active
      );

    -- id_map. DISTINCT ON đảm bảo 1:1.
    drop table if exists legacy_v2._mig_idmap_expense_templates;
    create table legacy_v2._mig_idmap_expense_templates as
    select distinct on (lt.id) lt.id as legacy_id, pt.id as v4_id
    from legacy_v2.expense_templates lt
    join public.expense_templates pt on lower(trim(pt.label)) = lower(trim(lt.label))
    order by lt.id, pt.created_at asc;

    commit;
  `;
  psqlExec(sql);
  console.log(`  public.expense_templates: ${getCount("public.expense_templates")} (sau migrate)`);
  console.log(`  id_map: ${getCount("legacy_v2._mig_idmap_expense_templates")} rows`);
}

console.log("\n✓ Stage 3b complete.");
console.log("  Next: node scripts/migrate/03c-expenses.mjs");
