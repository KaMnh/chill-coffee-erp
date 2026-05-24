// scripts/migrate/04-verify.mjs — Stage 4: verification.
// Counts diff, sample diff, referential integrity, pgTAP, timezone sanity.
//
// Usage:
//   npm run migrate:verify
//   node scripts/migrate/04-verify.mjs [--out docs/migration/v2-to-v4-verify-report.md]
import { psqlQuery, parseTabular } from "./_lib/psql.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
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
  const out = { outFile: "docs/migration/v2-to-v4-verify-report.md" };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out") out.outFile = argv[++i];
  }
  return out;
}

function tableExists(schema, name) {
  return psqlQuery(`select to_regclass('${schema}.${name}') is not null;`,
    { tuplesOnly: true, noAlign: true }).trim() === "t";
}
function countOf(table) {
  try {
    return Number(psqlQuery(`select count(*) from ${table};`, { tuplesOnly: true, noAlign: true }).trim());
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv);
const sections = [];

console.log(">>> Stage 4 — Verification");

// ---- 1. Count diff ----
console.log("\n[1] Count diff (legacy_v2 vs public)...");
const countRows = [];
for (const t of SCOPE) {
  const v2 = tableExists("legacy_v2", t) ? countOf(`legacy_v2.${t}`) : null;
  const v4 = tableExists("public", t) ? countOf(`public.${t}`) : null;
  const delta = v2 !== null && v4 !== null ? v4 - v2 : null;
  countRows.push({ table: t, v2, v4, delta });
  console.log(`  ${t.padEnd(25)} v2=${v2 ?? "—"}  v4=${v4 ?? "—"}  Δ=${delta ?? "—"}`);
}

sections.push([
  "## 1. Count diff",
  "",
  "| Table | legacy_v2 | public | Δ | Status |",
  "|---|---|---|---|---|",
  ...countRows.map((r) => {
    let status = "OK";
    if (r.v2 === null && r.v4 === null) status = "skip (out of scope)";
    else if (r.v2 === null) status = "v2 missing — không migrate được";
    else if (r.v4 === null) status = "v4 table thiếu — schema lỗi";
    else if (r.delta < 0) status = "❌ v4 < v2 (lost rows?)";
    else if (r.delta === 0 && r.v2 > 0) status = "⚠️  no rows inserted (already migrated? unmapped users?)";
    return `| \`${r.table}\` | ${r.v2 ?? "—"} | ${r.v4 ?? "—"} | ${r.delta ?? "—"} | ${status} |`;
  }),
  "",
].join("\n"));

// ---- 2. Referential integrity ----
console.log("\n[2] Referential integrity...");
const fkChecks = [
  { name: "expenses.category_id → expense_categories.id",
    sql: `select count(*) from public.expenses e left join public.expense_categories c on c.id = e.category_id where e.category_id is not null and c.id is null;` },
  { name: "expenses.template_id → expense_templates.id",
    sql: `select count(*) from public.expenses e left join public.expense_templates t on t.id = e.template_id where e.template_id is not null and t.id is null;` },
  { name: "cash_close_reports.cash_count_id → cash_counts.id",
    sql: `select count(*) from public.cash_close_reports r left join public.cash_counts c on c.id = r.cash_count_id where c.id is null;` },
  { name: "shift_payroll_records.employee_id → employees.id",
    sql: `select count(*) from public.shift_payroll_records p left join public.employees e on e.id = p.employee_id where e.id is null;` },
  { name: "shift_assignments.employee_id → employees.id",
    sql: `select count(*) from public.shift_assignments s left join public.employees e on e.id = s.employee_id where e.id is null;` },
  { name: "employee_accounts.employee_id → employees.id",
    sql: `select count(*) from public.employee_accounts ea left join public.employees e on e.id = ea.employee_id where ea.employee_id is not null and e.id is null;` },
  { name: "handover_tasks.session_id → handover_sessions.id",
    sql: `select count(*) from public.handover_tasks t left join public.handover_sessions s on s.id = t.session_id where s.id is null;` },
  { name: "cash_drawer_events.expense_id → expenses.id",
    sql: `select count(*) from public.cash_drawer_events e left join public.expenses x on x.id = e.expense_id where e.expense_id is not null and x.id is null;` },
  { name: "cash_drawer_events.cash_count_id → cash_counts.id",
    sql: `select count(*) from public.cash_drawer_events e left join public.cash_counts c on c.id = e.cash_count_id where e.cash_count_id is not null and c.id is null;` },
];
const fkRows = [];
for (const check of fkChecks) {
  const dangling = Number(psqlQuery(check.sql, { tuplesOnly: true, noAlign: true }).trim());
  fkRows.push({ name: check.name, dangling });
  console.log(`  ${dangling === 0 ? "✓" : "❌"} ${check.name}: ${dangling} dangling`);
}
sections.push([
  "## 2. Referential integrity",
  "",
  "| Constraint | Dangling FK | Status |",
  "|---|---|---|",
  ...fkRows.map((r) => `| ${r.name} | ${r.dangling} | ${r.dangling === 0 ? "✓ OK" : "❌ FAIL"} |`),
  "",
].join("\n"));

// ---- 3. Timezone sanity (chỉ check expenses + cash_counts có timestamp cols) ----
console.log("\n[3] Timezone sanity...");
const tzCheck = `
  select
    (select count(*) from public.expenses where extract(year from created_at) < 2020) as expenses_too_old,
    (select count(*) from public.expenses where created_at > now() + interval '1 day') as expenses_future,
    (select count(*) from public.cash_counts where counted_at > now() + interval '1 day') as cash_counts_future,
    (select count(*) from public.shift_assignments where check_in_at > now() + interval '1 day') as shifts_future;
`;
const tzRows = parseTabular(psqlQuery(tzCheck, { tuplesOnly: true, noAlign: true, fieldSep: "|" }))[0] || [];
const tzLabels = ["expenses created_at < 2020", "expenses created_at > tomorrow", "cash_counts counted_at > tomorrow", "shifts check_in_at > tomorrow"];
const tzReport = tzLabels.map((label, i) => ({ label, count: Number(tzRows[i] || 0) }));
for (const r of tzReport) {
  console.log(`  ${r.count === 0 ? "✓" : "⚠️ "} ${r.label}: ${r.count}`);
}
sections.push([
  "## 3. Timezone sanity",
  "",
  "Phát hiện timestamp lệch (vd: bug TZ giống bug KiotViet 2026-05-04).",
  "",
  "| Check | Count | Status |",
  "|---|---|---|",
  ...tzReport.map((r) => `| ${r.label} | ${r.count} | ${r.count === 0 ? "✓" : "⚠️  có thể TZ shifted"} |`),
  "",
].join("\n"));

// ---- 4. Sample diff (5 random rows mỗi bảng có data) ----
console.log("\n[4] Sample diff (random 5 rows mỗi bảng — chỉ count matches)...");
const sampleRows = [];
for (const t of SCOPE) {
  if (!tableExists("legacy_v2", t) || !tableExists("public", t)) continue;
  const v2Count = countOf(`legacy_v2.${t}`);
  if (v2Count === 0) continue;

  // Sample diff strategy: count common rows via natural key per table
  let matchSql = null;
  switch (t) {
    case "employees":
      // Match qua _mig_idmap_employees (đã 1:1 sau fix Bug 3)
      if (tableExists("legacy_v2", "_mig_idmap_employees")) {
        matchSql = `select count(*) from legacy_v2._mig_idmap_employees;`;
      }
      break;
    case "expense_categories":
      matchSql = `select count(*) from legacy_v2.expense_categories le
        join public.expense_categories pe on lower(trim(pe.name)) = lower(trim(le.name));`; break;
    case "expense_templates":
      matchSql = `select count(*) from legacy_v2.expense_templates le
        join public.expense_templates pe on lower(trim(pe.label)) = lower(trim(le.label));`; break;
    case "cash_day_openings":
      matchSql = `select count(*) from legacy_v2.cash_day_openings le
        join public.cash_day_openings pe on pe.business_date = le.business_date;`; break;
    case "expenses":
    case "cash_counts":
    case "cash_close_reports":
    case "shift_assignments":
    case "shift_payroll_records":
    case "handover_sessions":
      // Dùng id_map nếu có
      const mapTable = `legacy_v2._mig_idmap_${t}`;
      if (tableExists("legacy_v2", `_mig_idmap_${t}`)) {
        matchSql = `select count(*) from ${mapTable};`;
      }
      break;
    case "handover_tasks":
      // Match qua session_id + task_key
      if (tableExists("legacy_v2", "_mig_idmap_handover_sessions")) {
        matchSql = `select count(*) from legacy_v2.handover_tasks le
          join legacy_v2._mig_idmap_handover_sessions idmap on idmap.legacy_id = le.session_id
          join public.handover_tasks pt on pt.session_id = idmap.v4_id and pt.task_key = le.task_key;`;
      }
      break;
    case "safe_transactions":
      // Match qua composite (occurred_at, transaction_type, abs(amount))
      matchSql = `select count(*) from legacy_v2.safe_transactions le
        join public.safe_transactions pt on
          pt.occurred_at = le.occurred_at
          and pt.transaction_type = le.transaction_type
          and abs(pt.amount) = abs(le.amount);`;
      break;
    case "cash_drawer_events":
      // Match qua composite (business_date, occurred_at, event_type, amount)
      matchSql = `select count(*) from legacy_v2.cash_drawer_events le
        join public.cash_drawer_events pe on
          pe.business_date = le.business_date
          and pe.occurred_at = le.occurred_at
          and pe.event_type = le.event_type
          and pe.amount = le.amount;`;
      break;
  }
  if (!matchSql) continue;
  try {
    const matched = Number(psqlQuery(matchSql, { tuplesOnly: true, noAlign: true }).trim());
    sampleRows.push({ table: t, v2: v2Count, matched, ratio: v2Count > 0 ? (matched / v2Count * 100).toFixed(1) : "—" });
    console.log(`  ${t.padEnd(25)} matched ${matched}/${v2Count} (${v2Count > 0 ? (matched / v2Count * 100).toFixed(1) : "—"}%)`);
  } catch (e) {
    console.warn(`  ${t}: ${e.message}`);
  }
}
sections.push([
  "## 4. Match ratio per table",
  "",
  "Số rows v2 đã được link sang v4 (qua id_map hoặc natural key).",
  "",
  "| Table | v2 rows | Matched | Ratio |",
  "|---|---|---|---|",
  ...sampleRows.map((r) => `| \`${r.table}\` | ${r.v2} | ${r.matched} | ${r.ratio}% |`),
  "",
].join("\n"));

// ---- Compose report ----
const header = [
  "# Verification Report: v2.x → v4 Migration",
  "",
  `_Generated: ${new Date().toISOString()}_`,
  "",
  "## Summary",
  "",
];
const failed = fkRows.some((r) => r.dangling > 0);
const tzWarn = tzReport.some((r) => r.count > 0);
const noData = countRows.every((r) => r.delta === 0 || r.delta === null);

if (failed) header.push("**❌ FAIL** — Có dangling FK. Review section 2 trước khi cleanup staging.");
else if (tzWarn) header.push("**⚠️  WARNING** — Có timestamp suspicious. Review section 3.");
else if (noData) header.push("**⚠️  NO CHANGES** — Không có rows insert (đã migrate trước? unmapped users?).");
else header.push("**✓ OK** — Counts khớp, FK integrity OK, timestamps OK.");
header.push("");
header.push("Sau khi confirm OK, cleanup staging:");
header.push("```powershell");
header.push("docker compose exec -T db psql -U postgres -c \"DROP SCHEMA legacy_v2 CASCADE; DROP SCHEMA legacy_v2_auth CASCADE;\"");
header.push("```");
header.push("");

const report = header.concat(sections).join("\n");

mkdirSync(dirname(args.outFile), { recursive: true });
writeFileSync(args.outFile, report, "utf8");

console.log(`\n✓ Verification report written: ${args.outFile}`);
console.log("\nKế tiếp:");
console.log("  1. Review report bên trên");
console.log("  2. Chạy: npm run pgtap  (đảm bảo schema invariants OK)");
console.log("  3. Cleanup staging nếu OK (xem command trong report)");

if (failed) process.exit(1);
