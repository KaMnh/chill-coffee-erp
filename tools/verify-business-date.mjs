// Smoke: verify todayInVN-like behavior at TZ boundaries.
// Runs in Node, mirrors what lib/datetime.todayInVN does, asserts no off-by-one.
import assert from "node:assert/strict";

function todayInVNLike(now) {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

// Case 1: 2026-05-20 16:59:59 UTC == 23:59:59 VN -> VN date = 2026-05-20
const beforeMidnightVN = new Date("2026-05-20T16:59:59Z");
assert.equal(todayInVNLike(beforeMidnightVN), "2026-05-20", "23:59 VN should be 2026-05-20");

// Case 2: 2026-05-20 17:00:00 UTC == 00:00:00 VN next day -> VN date = 2026-05-21
const justAfterMidnightVN = new Date("2026-05-20T17:00:00Z");
assert.equal(todayInVNLike(justAfterMidnightVN), "2026-05-21", "00:00 VN next day should be 2026-05-21");

// Case 3: noon UTC = 19:00 VN same day
const noonUTC = new Date("2026-05-20T12:00:00Z");
assert.equal(todayInVNLike(noonUTC), "2026-05-20", "noon UTC = 19:00 VN, same day");

console.log("✓ business-date timezone behavior matches VN wall-clock at edges");
