// scripts/migrate/03-run-all.mjs — Stage 3 orchestrator.
// Chạy 03a → 03e tuần tự, abort on first error.
//
// Usage:
//   npm run migrate:apply
//   node scripts/migrate/03-run-all.mjs [--dry-run]
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

const STEPS = [
  { id: "3a", script: "scripts/migrate/03a-employees.mjs", label: "Employees + Accounts" },
  { id: "3b", script: "scripts/migrate/03b-expense-masters.mjs", label: "Expense Masters" },
  { id: "3c", script: "scripts/migrate/03c-expenses.mjs", label: "Expenses" },
  { id: "3d", script: "scripts/migrate/03d-cash.mjs", label: "Cash Management" },
  { id: "3e", script: "scripts/migrate/03e-shifts.mjs", label: "Shifts + Payroll" },
  { id: "3f", script: "scripts/migrate/03f-safe.mjs", label: "Safe Transactions (sổ quỹ)" },
  { id: "3g", script: "scripts/migrate/03g-handover.mjs", label: "Handover (sessions + tasks)" },
  { id: "3h", script: "scripts/migrate/03h-cash-events.mjs", label: "Cash Drawer Events" },
];

const DRY_RUN = process.argv.includes("--dry-run");
const passthroughArgs = DRY_RUN ? ["--dry-run"] : [];

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logPath = `migration/migration-log-${timestamp}.json`;
mkdirSync("migration", { recursive: true });

const log = { startedAt: new Date().toISOString(), dryRun: DRY_RUN, steps: [] };

console.log(`>>> Stage 3 orchestrator (${DRY_RUN ? "DRY-RUN" : "LIVE"})`);
console.log(`    Log: ${logPath}\n`);

for (const step of STEPS) {
  console.log(`========================================`);
  console.log(`  ${step.id}: ${step.label}`);
  console.log(`========================================`);
  const startedAt = new Date().toISOString();
  let status = "completed";
  let error = null;
  try {
    execFileSync("node", [step.script, ...passthroughArgs], { stdio: "inherit" });
  } catch (e) {
    status = "failed";
    error = e.message;
    console.error(`\n❌  Step ${step.id} failed: ${e.message}`);
  }
  log.steps.push({
    id: step.id,
    script: step.script,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    error,
  });
  if (status === "failed") {
    log.endedAt = new Date().toISOString();
    log.finalStatus = "aborted";
    writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");
    console.error(`\n❌  Migration aborted at step ${step.id}. Inspect ${logPath}.`);
    console.error(`    Rollback nếu cần: docker compose exec db psql -U postgres < backup/v4-pre-migration-*.sql`);
    process.exit(1);
  }
}

log.endedAt = new Date().toISOString();
log.finalStatus = "ok";
writeFileSync(logPath, JSON.stringify(log, null, 2), "utf8");

console.log(`\n========================================`);
console.log(`✓ Stage 3 complete (${STEPS.length} steps).`);
console.log(`  Log: ${logPath}`);
console.log(`  Next: npm run migrate:verify`);
console.log(`========================================`);
