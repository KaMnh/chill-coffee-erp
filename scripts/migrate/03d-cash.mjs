// scripts/migrate/03d-cash.mjs — Stage 3d: cash management tables.
// Order: cash_day_openings → cash_counts → cash_close_reports.
// Phase 5 columns (safe_*, leave_for_next_day, carried_amount) có default 0 → omit OK.
//
// Usage: node scripts/migrate/03d-cash.mjs [--dry-run]
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

console.log(">>> Stage 3d — Cash Management");

const hasOpenings = tableExists("legacy_v2", "cash_day_openings");
const hasCounts = tableExists("legacy_v2", "cash_counts");
const hasReports = tableExists("legacy_v2", "cash_close_reports");
const hasAuthUsers = tableExists("legacy_v2_auth", "users");

console.log("\n[0] Existence:");
console.log(`  cash_day_openings:  ${hasOpenings ? "✓" : "skip"}`);
console.log(`  cash_counts:        ${hasCounts ? "✓" : "skip"}`);
console.log(`  cash_close_reports: ${hasReports ? "✓" : "skip"}`);
console.log(`  legacy_v2_auth.users: ${hasAuthUsers ? "✓" : "⚠️  created_by/closed_by sẽ null"}`);

if (!hasOpenings && !hasCounts && !hasReports) {
  console.log("\nNothing to migrate. Done.");
  process.exit(0);
}

console.log("\n[1] Counts:");
if (hasOpenings) console.log(`  legacy_v2.cash_day_openings:  ${getCount("legacy_v2.cash_day_openings")}`);
if (hasCounts) console.log(`  legacy_v2.cash_counts:        ${getCount("legacy_v2.cash_counts")}`);
if (hasReports) console.log(`  legacy_v2.cash_close_reports: ${getCount("legacy_v2.cash_close_reports")}`);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan: openings → counts → reports với composite dedup. Skip apply.");
  process.exit(0);
}

// auth.users email lookup helper (returns SQL expression)
function authLookup(colName) {
  if (!hasAuthUsers) return "null";
  return `(select u4.id from legacy_v2_auth.users lu
           join auth.users u4 on lower(u4.email) = lower(lu.email)
           where lu.id = le.${colName} limit 1)`;
}

// ---- cash_day_openings ----
if (hasOpenings) {
  console.log("\n[2] cash_day_openings...");
  const cols = getCols("legacy_v2", "cash_day_openings");
  const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;

  const sql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.cash_day_openings (
      business_date, denominations_json, opening_total, carried_from_previous_day,
      created_by, created_at, updated_at
    )
    select
      le.business_date,
      coalesce(${pickCol("denominations_json", "'{}'::jsonb")}, '{}'::jsonb),
      coalesce(${pickCol("opening_total", "0")}, 0),
      coalesce(${pickCol("carried_from_previous_day", "false")}, false),
      ${cols.includes("created_by") ? authLookup("created_by") : "null"},
      coalesce(${pickCol("created_at", "now()")}, now()),
      coalesce(${pickCol("updated_at", "now()")}, now())
    from legacy_v2.cash_day_openings le
    where le.business_date is not null
    on conflict (business_date) do nothing;

    commit;
  `;
  psqlExec(sql);
  console.log(`  public.cash_day_openings: ${getCount("public.cash_day_openings")}`);
}

// ---- cash_counts ----
if (hasCounts) {
  console.log("\n[3] cash_counts...");
  const cols = getCols("legacy_v2", "cash_counts");
  const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;

  // Composite dedup (business_date, counted_at) — không có unique index trên v4
  // → dùng WHERE NOT EXISTS.
  const sql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.cash_counts (
      business_date, counted_at, count_type, denominations_json,
      total_physical, total_theory, difference,
      pos_total, pos_cash_total, pos_non_cash_total,
      opening_cash, bank_transfer_confirmed, reconciliation_total,
      note, counted_by, sales_snapshot_at, created_at
    )
    select
      le.business_date,
      coalesce(${pickCol("counted_at", "now()")}, now()),
      coalesce(${pickCol("count_type", "'spot_audit'")}, 'spot_audit'),
      coalesce(${pickCol("denominations_json", "'{}'::jsonb")}, '{}'::jsonb),
      coalesce(${pickCol("total_physical", "0")}, 0),
      coalesce(${pickCol("total_theory", "0")}, 0),
      coalesce(${pickCol("difference", "0")}, 0),
      coalesce(${pickCol("pos_total", "0")}, 0),
      coalesce(${pickCol("pos_cash_total", "0")}, 0),
      coalesce(${pickCol("pos_non_cash_total", "0")}, 0),
      coalesce(${pickCol("opening_cash", "0")}, 0),
      coalesce(${pickCol("bank_transfer_confirmed", "0")}, 0),
      coalesce(${pickCol("reconciliation_total", "0")}, 0),
      ${pickCol("note", "null")},
      ${cols.includes("counted_by") ? authLookup("counted_by") : "null"},
      ${pickCol("sales_snapshot_at", "null")},
      coalesce(${pickCol("created_at", "now()")}, now())
    from legacy_v2.cash_counts le
    where le.business_date is not null
      and not exists (
        select 1 from public.cash_counts pc
        where pc.business_date = le.business_date
          and pc.counted_at = coalesce(${pickCol("counted_at", "now()")}, now())
      );

    -- id_map cho cash_counts. DISTINCT ON đảm bảo 1:1.
    drop table if exists legacy_v2._mig_idmap_cash_counts;
    create table legacy_v2._mig_idmap_cash_counts as
    select distinct on (le.id) le.id as legacy_id, pc.id as v4_id
    from legacy_v2.cash_counts le
    join public.cash_counts pc on
      pc.business_date = le.business_date
      and pc.counted_at = coalesce(${pickCol("counted_at", "now()")}, now())
    order by le.id, pc.created_at asc;

    commit;
  `;
  psqlExec(sql);
  console.log(`  public.cash_counts: ${getCount("public.cash_counts")}`);
  console.log(`  id_map: ${getCount("legacy_v2._mig_idmap_cash_counts")} rows`);
}

// ---- cash_close_reports ----
if (hasReports) {
  console.log("\n[4] cash_close_reports...");
  const cols = getCols("legacy_v2", "cash_close_reports");
  const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;
  const hasCountMap = tableExists("legacy_v2", "_mig_idmap_cash_counts");

  if (!cols.includes("cash_count_id")) {
    console.warn("  ⚠️  legacy cash_close_reports thiếu cash_count_id — không thể link. Skip.");
  } else if (!hasCountMap) {
    console.warn("  ⚠️  cash_counts id_map missing. Skip reports.");
  } else {
    const sql = `
      begin;
      set local session_replication_role = 'replica';

      insert into public.cash_close_reports (
        business_date, cash_count_id, closed_at, closed_by,
        pos_total, opening_cash, pos_cash_total, pos_non_cash_total,
        bank_transfer_confirmed, expense_cash_total, payroll_cash_total,
        theory_cash, reconciliation_total, physical_cash, difference,
        denominations_json, sync_snapshot_at, note,
        report_status, void_reason, voided_by, voided_at,
        created_at, updated_at
      )
      select
        le.business_date,
        (select v4_id from legacy_v2._mig_idmap_cash_counts where legacy_id = le.cash_count_id),
        coalesce(${pickCol("closed_at", "now()")}, now()),
        ${cols.includes("closed_by") ? authLookup("closed_by") : "null"},
        coalesce(${pickCol("pos_total", "0")}, 0),
        coalesce(${pickCol("opening_cash", "0")}, 0),
        coalesce(${pickCol("pos_cash_total", "0")}, 0),
        coalesce(${pickCol("pos_non_cash_total", "0")}, 0),
        coalesce(${pickCol("bank_transfer_confirmed", "0")}, 0),
        coalesce(${pickCol("expense_cash_total", "0")}, 0),
        coalesce(${pickCol("payroll_cash_total", "0")}, 0),
        coalesce(${pickCol("theory_cash", "0")}, 0),
        coalesce(${pickCol("reconciliation_total", "0")}, 0),
        coalesce(${pickCol("physical_cash", "0")}, 0),
        coalesce(${pickCol("difference", "0")}, 0),
        coalesce(${pickCol("denominations_json", "'{}'::jsonb")}, '{}'::jsonb),
        ${pickCol("sync_snapshot_at", "null")},
        ${pickCol("note", "null")},
        coalesce(${pickCol("report_status", "'final'")}, 'final'),
        ${pickCol("void_reason", "null")},
        ${cols.includes("voided_by") ? authLookup("voided_by") : "null"},
        ${pickCol("voided_at", "null")},
        coalesce(${pickCol("created_at", "now()")}, now()),
        coalesce(${pickCol("updated_at", "now()")}, now())
      from legacy_v2.cash_close_reports le
      where le.business_date is not null
        and exists (
          select 1 from legacy_v2._mig_idmap_cash_counts
          where legacy_id = le.cash_count_id
        )
      on conflict (cash_count_id) do nothing;

      commit;
    `;
    psqlExec(sql);
    console.log(`  public.cash_close_reports: ${getCount("public.cash_close_reports")}`);
  }
}

console.log("\n✓ Stage 3d complete.");
console.log("  Next: node scripts/migrate/03e-shifts.mjs");
