// scripts/migrate/03g-handover.mjs — Stage 3g: handover_sessions + handover_tasks.
// FK: handover_tasks.session_id → handover_sessions (qua id_map sessions).
//
// Usage: node scripts/migrate/03g-handover.mjs [--dry-run]
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

console.log(">>> Stage 3g — Handover (sessions + tasks)");

const hasSessions = tableExists("legacy_v2", "handover_sessions");
const hasTasks = tableExists("legacy_v2", "handover_tasks");
const hasAuthUsers = tableExists("legacy_v2_auth", "users") &&
  Number(getCount("legacy_v2_auth.users")) > 0;

console.log("\n[0] Existence:");
console.log(`  legacy_v2.handover_sessions: ${hasSessions ? "✓" : "skip"}`);
console.log(`  legacy_v2.handover_tasks:    ${hasTasks ? "✓" : "skip"}`);
console.log(`  legacy_v2_auth.users (rows): ${hasAuthUsers ? "✓" : "⚠️  created_by/checked_by sẽ null"}`);

if (!hasSessions && !hasTasks) {
  console.log("\nNothing to migrate. Done.");
  process.exit(0);
}

console.log("\n[1] Counts:");
if (hasSessions) console.log(`  legacy_v2.handover_sessions: ${getCount("legacy_v2.handover_sessions")}`);
if (hasTasks) console.log(`  legacy_v2.handover_tasks:    ${getCount("legacy_v2.handover_tasks")}`);

if (DRY_RUN) {
  console.log("\n[DRY-RUN] Plan: sessions → tasks với id_map. Skip apply.");
  process.exit(0);
}

function authLookup(colName, alias = "le") {
  if (!hasAuthUsers) return "null";
  return `(select u4.id from legacy_v2_auth.users lu
           join auth.users u4 on lower(u4.email) = lower(lu.email)
           where lu.id = ${alias}.${colName} limit 1)`;
}

// ---- handover_sessions ----
if (hasSessions) {
  console.log("\n[2] handover_sessions...");
  const cols = getCols("legacy_v2", "handover_sessions");
  const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;

  const sql = `
    begin;
    set local session_replication_role = 'replica';

    insert into public.handover_sessions (
      business_date, status, note, created_by, created_at, completed_at, updated_at
    )
    select
      le.business_date,
      coalesce(${pickCol("status", "'draft'")}, 'draft'),
      ${pickCol("note", "null")},
      ${cols.includes("created_by") ? authLookup("created_by") : "null"},
      coalesce(${pickCol("created_at", "now()")}, now()),
      ${pickCol("completed_at", "null")},
      coalesce(${pickCol("updated_at", "now()")}, now())
    from legacy_v2.handover_sessions le
    where le.business_date is not null
    on conflict (business_date) do nothing;

    -- id_map: legacy → v4 (qua business_date unique). DISTINCT ON safety.
    drop table if exists legacy_v2._mig_idmap_handover_sessions;
    create table legacy_v2._mig_idmap_handover_sessions as
    select distinct on (le.id) le.id as legacy_id, ps.id as v4_id
    from legacy_v2.handover_sessions le
    join public.handover_sessions ps on ps.business_date = le.business_date
    order by le.id, ps.created_at asc;

    commit;
  `;
  psqlExec(sql);
  console.log(`  public.handover_sessions: ${getCount("public.handover_sessions")}`);
  console.log(`  id_map: ${getCount("legacy_v2._mig_idmap_handover_sessions")} rows`);
}

// ---- handover_tasks ----
if (hasTasks) {
  console.log("\n[3] handover_tasks...");
  const cols = getCols("legacy_v2", "handover_tasks");
  const pickCol = (n, def) => cols.includes(n) ? `le.${n}` : def;
  const hasSessionMap = tableExists("legacy_v2", "_mig_idmap_handover_sessions");

  if (!hasSessionMap || !cols.includes("session_id")) {
    console.warn("  ⚠️  sessions id_map missing hoặc legacy thiếu session_id — skip tasks.");
  } else {
    const sql = `
      begin;
      set local session_replication_role = 'replica';

      insert into public.handover_tasks (
        session_id, task_key, label, is_done,
        checked_by, checked_at, sort_order, created_at
      )
      select
        idmap.v4_id,
        le.task_key,
        le.label,
        coalesce(${pickCol("is_done", "false")}, false),
        ${cols.includes("checked_by") ? authLookup("checked_by") : "null"},
        ${pickCol("checked_at", "null")},
        coalesce(${pickCol("sort_order", "100")}, 100),
        coalesce(${pickCol("created_at", "now()")}, now())
      from legacy_v2.handover_tasks le
      join legacy_v2._mig_idmap_handover_sessions idmap on idmap.legacy_id = le.session_id
      where le.task_key is not null and le.label is not null
      on conflict (session_id, task_key) do nothing;

      commit;
    `;
    psqlExec(sql);
    console.log(`  public.handover_tasks: ${getCount("public.handover_tasks")}`);
  }
}

console.log("\n✓ Stage 3g complete.");
console.log("  Next: node scripts/migrate/03h-cash-events.mjs");
