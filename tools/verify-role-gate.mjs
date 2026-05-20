// One-shot sanity check for the role-gate matrix. Run via `node tools/verify-role-gate.mjs`.
// Expectations come from v3 production behavior — don't change without updating navigation.ts.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

// Drift guard: parse the actual DEFAULT_SIDEBAR_BY_ROLE block out of navigation.ts
// at runtime. If someone edits navigation.ts, the parsed matrix below diverges
// from the implementation and the assertions catch it. Without this step, the
// script would only be testing its own hardcoded literal.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const navTsPath = resolve(__dirname, "../src/features/navigation/navigation.ts");
const navSource = readFileSync(navTsPath, "utf8");

function parseMatrix(src) {
  // Match the const block:
  //   export const DEFAULT_SIDEBAR_BY_ROLE: Record<...> = {
  //     owner:           [...],
  //     manager:         [...],
  //     ...
  //   };
  const blockMatch = src.match(
    /export\s+const\s+DEFAULT_SIDEBAR_BY_ROLE[^{]*\{([\s\S]*?)\};/
  );
  if (!blockMatch) {
    throw new Error("Could not find DEFAULT_SIDEBAR_BY_ROLE export in navigation.ts");
  }
  const body = blockMatch[1];
  const out = {};
  // For each role: capture identifier + the [...] literal that follows.
  const roleRe = /(owner|manager|staff_operator|employee_viewer)\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = roleRe.exec(body)) !== null) {
    const role = m[1];
    const items = m[2]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    out[role] = items;
  }
  return out;
}

const DEFAULT_SIDEBAR_BY_ROLE = parseMatrix(navSource);

// Sanity: all 4 roles found.
for (const role of ["owner", "manager", "staff_operator", "employee_viewer"]) {
  assert.ok(
    Array.isArray(DEFAULT_SIDEBAR_BY_ROLE[role]),
    `Failed to parse '${role}' from navigation.ts — regex out of date?`
  );
}

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
