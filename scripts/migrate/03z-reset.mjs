// scripts/migrate/03z-reset.mjs — Cleanup script trước khi re-run migration.
// Xóa toàn bộ rows đã migrate từ public.* (giữ seed owner), drop id_maps.
//
// Yêu cầu HAI flags (muscle-memory protection):
//   --confirm                    -- dry-run vs. real
//   --i-know-this-wipes-data     -- second-stop, must be typed manually
//
// Usage:
//   node scripts/migrate/03z-reset.mjs
//     → print dry-run; exit 0
//   node scripts/migrate/03z-reset.mjs --confirm
//     → still abort; prints reminder about the extra flag; exit 1
//   node scripts/migrate/03z-reset.mjs --confirm --i-know-this-wipes-data
//     → actually delete
import { psqlExec, psqlQuery, parseTabular } from "./_lib/psql.mjs";

const HAS_CONFIRM = process.argv.includes("--confirm") || process.env.RESET_CONFIRMED === "1";
const HAS_ACK = process.argv.includes("--i-know-this-wipes-data");
const CONFIRMED = HAS_CONFIRM && HAS_ACK;

function getCount(t) {
  try {
    return Number(psqlQuery(`select count(*) from ${t};`, { tuplesOnly: true, noAlign: true }).trim());
  } catch {
    return 0;
  }
}
function tableExists(schema, name) {
  return psqlQuery(`select to_regclass('${schema}.${name}') is not null;`,
    { tuplesOnly: true, noAlign: true }).trim() === "t";
}

console.log(">>> Stage 3z — Reset migrated data trong public.*");
console.log("    (Giữ seed owner + master tables không thuộc scope migration)\n");

// 1. Detect seed owner: row đầu tiên có role=owner theo created_at
const ownerSql = `
  select e.id as employee_id, ea.auth_user_id, u.email
  from public.employee_accounts ea
  join public.employees e on e.id = ea.employee_id
  left join auth.users u on u.id = ea.auth_user_id
  where ea.role = 'owner'
  order by ea.created_at asc
  limit 1;
`;
const ownerRow = parseTabular(psqlQuery(ownerSql, { tuplesOnly: true, noAlign: true, fieldSep: "|" }))[0];

if (!ownerRow || !ownerRow[0]) {
  console.error("❌  Không tìm thấy seed owner trong public.employee_accounts.");
  console.error("    Reset sẽ xóa TẤT CẢ employees → app không có account login.");
  console.error("    Chạy `npm run db:seed` trước để tạo owner.");
  process.exit(1);
}

const [seedEmployeeId, seedAuthUserId, seedEmail] = ownerRow;
console.log("[Seed owner sẽ KHÔNG bị xóa]");
console.log(`  employee_id:    ${seedEmployeeId}`);
console.log(`  auth_user_id:   ${seedAuthUserId}`);
console.log(`  email:          ${seedEmail || "(không link auth.users)"}`);

// 2. Counts before
const TABLES = [
  "shift_payroll_records",
  "shift_assignments",
  "safe_attachments",
  "safe_transactions",
  "handover_tasks",
  "handover_sessions",
  "cash_drawer_events",
  "cash_close_reports",
  "cash_counts",
  "cash_day_openings",
  "expenses",
  "expense_templates",
  "expense_categories",
  "employee_accounts",
  "employees",
];
console.log("\n[Counts BEFORE]");
const before = {};
for (const t of TABLES) {
  before[t] = getCount(`public.${t}`);
  console.log(`  ${t.padEnd(28)} ${before[t]}`);
}

const idMapTables = parseTabular(psqlQuery(
  `select tablename from pg_tables where schemaname='legacy_v2' and tablename like '_mig_idmap_%' order by tablename;`,
  { tuplesOnly: true, noAlign: true, fieldSep: "|" }
)).map((r) => r[0]);
console.log(`\n[id_map tables sẽ drop] ${idMapTables.length > 0 ? idMapTables.join(", ") : "(none)"}`);

if (!CONFIRMED) {
  if (HAS_CONFIRM && !HAS_ACK) {
    // User typed --confirm out of muscle memory. Refuse and require the
    // extra acknowledgment flag.
    console.log("\n❌  --confirm is no longer sufficient. This script wipes migrated data.");
    console.log("    Add --i-know-this-wipes-data ONLY when you really mean it:");
    console.log("    node scripts/migrate/03z-reset.mjs --confirm --i-know-this-wipes-data");
    process.exit(1);
  }
  console.log("\n⚠️  Đây là DRY-RUN. Để thực sự DELETE, chạy lại với CẢ HAI flags:");
  console.log("    node scripts/migrate/03z-reset.mjs --confirm --i-know-this-wipes-data");
  process.exit(0);
}

// 3. Execute DELETE theo FK reverse order
console.log("\n>>> Executing DELETE...");

// shift_payroll_records FK shift_assignments → DELETE child trước
// employee_accounts FK employees → DELETE accounts trước employees
// Most other tables FK auth.users (created_by, etc.) — ON DELETE SET NULL, không block
const sql = `
begin;
set local session_replication_role = 'replica';  -- skip audit triggers

delete from public.shift_payroll_records;
delete from public.shift_assignments;
delete from public.safe_attachments;
delete from public.safe_transactions;
-- handover_tasks cascade từ handover_sessions, nhưng explicit delete để chắc
delete from public.handover_tasks;
delete from public.handover_sessions;
delete from public.cash_drawer_events;
delete from public.cash_close_reports;
delete from public.cash_counts;
delete from public.cash_day_openings;
delete from public.expenses;
delete from public.expense_templates;
delete from public.expense_categories;

-- Keep seed owner
delete from public.employee_accounts
  where employee_id != '${seedEmployeeId}'::uuid;
delete from public.employees
  where id != '${seedEmployeeId}'::uuid;

commit;
`;
psqlExec(sql);

// 4. Drop id_maps
if (idMapTables.length > 0) {
  console.log("\n>>> Dropping id_map tables...");
  const dropSql = idMapTables.map((t) => `drop table if exists legacy_v2.${t};`).join("\n");
  psqlExec(dropSql);
  console.log(`    ✓ Dropped ${idMapTables.length} tables`);
}

// 5. Counts after
console.log("\n[Counts AFTER]");
for (const t of TABLES) {
  const after = getCount(`public.${t}`);
  const delta = after - before[t];
  const sign = delta < 0 ? "" : "+";
  console.log(`  ${t.padEnd(28)} ${after}  (${sign}${delta})`);
}

console.log("\n✓ Reset complete. Sẵn sàng re-run:");
console.log("  npm run migrate:apply");
