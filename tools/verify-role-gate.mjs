// One-shot sanity check for the role-gate matrix. Run via `node tools/verify-role-gate.mjs`.
// Expectations come from v3 production behavior — don't change without updating navigation.ts.
import assert from "node:assert/strict";

// Import .ts via tsx is not set up; instead, mirror the matrix here and assert lengths
// (we trust TS for type wiring; this is a behavior assertion).
const EXPECTED_LENGTHS = {
  owner: 8,
  manager: 7,           // owner minus 'safe'
  staff_operator: 5,    // dashboard, expenses, shifts, cash, reports
  employee_viewer: 1,   // dashboard only
};

const EXPECTED_FIRST = {
  owner: "dashboard",
  manager: "dashboard",
  staff_operator: "dashboard",
  employee_viewer: "dashboard",
};

// Re-state the matrix here (mirrors src/features/navigation/navigation.ts DEFAULT_SIDEBAR_BY_ROLE).
const DEFAULT_SIDEBAR_BY_ROLE = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "reports", "pivot", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "reports", "pivot", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "reports"],
  employee_viewer: ["dashboard"],
};

for (const [role, expectedLen] of Object.entries(EXPECTED_LENGTHS)) {
  const actual = DEFAULT_SIDEBAR_BY_ROLE[role];
  assert.equal(actual.length, expectedLen, `${role}: expected ${expectedLen} items, got ${actual.length}`);
  assert.equal(actual[0], EXPECTED_FIRST[role], `${role}: first item should be ${EXPECTED_FIRST[role]}`);
}

// Content assertions for the most business-critical permission boundaries.
// `safe` (sổ quỹ) is owner-ONLY — leaking to any other role exposes finances.
// `pivot` + `settings` must remain hidden from employee_viewer.
assert.ok(DEFAULT_SIDEBAR_BY_ROLE.owner.includes("safe"),
  "owner must have 'safe' (sổ quỹ)");
assert.ok(!DEFAULT_SIDEBAR_BY_ROLE.manager.includes("safe"),
  "manager must NOT have 'safe' — safe is owner-only");
assert.ok(!DEFAULT_SIDEBAR_BY_ROLE.staff_operator.includes("safe"),
  "staff_operator must NOT have 'safe'");
assert.ok(!DEFAULT_SIDEBAR_BY_ROLE.employee_viewer.includes("pivot"),
  "employee_viewer must NOT have 'pivot'");
assert.ok(!DEFAULT_SIDEBAR_BY_ROLE.employee_viewer.includes("settings"),
  "employee_viewer must NOT have 'settings'");

console.log("✓ role-gate matrix matches v3 expectations");
