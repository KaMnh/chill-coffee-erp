# Phase 3B.2b.ii.a — Vitest Infra + Helper Unit Tests (Design Spec)

**Date:** 2026-05-21
**Branch:** `phase-3b2b-ii-a-vitest` (off `main` @ `07becd3` = tag `v4-phase-3b2b-i`)
**Tag at end:** `v4-phase-3b2b-ii-a`
**Predecessor:** Phase 3B.2b.i (cash UI, 16 files, 11 tasks, merged at `07becd3`)
**Successor:** Phase 3B.2b.ii.b (pgTAP infra + cash RPC tests + RLS assertions + verify-mirror full-day)

---

## 0. TL;DR

Stand up **Vitest** as the project's frontend unit-testing harness, then write **pure-function unit tests** (~70–75 cases across 4 modules) for the math/format/validation/datetime helpers that v4 already exposes in `src/lib/**` and `src/features/cash/cash-math.ts`.

No component tests. No Playwright. No coverage tool. No CI. Those all defer to Phase 6 (when a git remote + the CI verification gate get stood up together).

Scope is deliberately **only the pure helpers** because:
1. They are the layer most prone to silent regressions (small refactors touch them every phase).
2. They are framework-free — Vitest runs them with zero setup cost.
3. The cash-math helpers were **extracted in 3B.2b.i specifically for this phase** (see `cash-math.ts` JSDoc line 4: "Designed for Vitest testability in Phase 3B.2b.ii").

This phase delivers the first executable test suite in v4. It is also the **dependency** for Phase 3B.2b.ii.b's verification gate — that phase will compose `npm run test:run && npm run pgtap && npm run verify:mirror` into a single `verify:phase` script.

---

## 1. Goal

Deliver a working Vitest harness plus ~70–75 pure-function unit tests covering 4 modules. Achieve:

- `npm run test` → watch-mode for dev
- `npm run test:run` → single-shot, exit-code-aware (for the upcoming Phase 3B.2b.ii.b gate)
- `npm run test:watch` → explicit alias (some IDEs prefer it)

All tests **MUST** pass on `main` at the end of this phase. If a test surfaces a bug in the helpers, we fix the helper (or the test, if the test is wrong) — we do not ship red tests.

---

## 2. Non-Goals (deferred)

| Item | Deferred to | Reason |
|---|---|---|
| Coverage threshold tool (`@vitest/coverage-v8`) | Phase 6 | No CI yet — coverage threshold needs a CI gate to be useful. Locally `npm run test:run` is enough discipline. |
| Component tests (RTL / Vitest browser mode) | Phase 6 | Component tests need design tokens stable + jsdom or playwright runner — both expand surface area beyond this phase. |
| E2E tests (Playwright) | Phase 6 | Needs seeded test DB + auth flow + Docker test profile. |
| CI workflow (`.github/workflows/test.yml`) | Phase 6 | No git remote configured yet. Phase 6 stands up the remote + CI together. |
| Shift-math extraction (`shift-math.ts`) | Phase 6 | Would require touching `src/features/shifts/**` — frozen since Phase 3B.2a. Off-limits per project rules. |
| Pivot-math extraction | Phase 6 | Same reason as shift-math (Phase 3A frozen). |
| Snapshot tests | Phase 6 | Encourage brittle UI lock-in early. |

If during implementation an opportunity to extract more pure helpers appears, the implementer should **flag it inline** (not act on it) — keep this phase tight.

---

## 3. Architecture

### 3.1 Runner choice: Vitest

Picked **Vitest** over Jest because:
- Native ESM + TypeScript without transpiler config (project is Next 15 / ESM-by-default).
- Reads `tsconfig.json` directly via `vite-tsconfig-paths` plugin → `@/` alias resolves without duplicated config.
- 10× faster than Jest on a cold node_modules.
- Same `describe / it / expect / vi` API as Jest — zero relearning if we ever migrate.

### 3.2 Config strategy

A single `vitest.config.ts` at project root. Minimal — only declares the alias plugin and `environment: "node"` (we have no DOM tests in this phase). This keeps the door open for a separate `vitest.config.browser.ts` in Phase 6 without retrofitting.

### 3.3 Test file convention

**Co-located** in `__tests__/` directories next to the source under test:

```
src/
  lib/
    format.ts
    validation.ts
    datetime.ts
    __tests__/
      format.test.ts
      validation.test.ts
      datetime.test.ts
  features/
    cash/
      cash-math.ts
      __tests__/
        cash-math.test.ts
```

Rationale: keeps tests visible to the developer editing the helper. Vitest auto-discovers `**/*.test.ts` so no `include` pattern needed.

### 3.4 No mocks, no fixtures, no global setup file

Every test imports the helper, calls it with primitives, asserts the output. No Supabase mocks, no React, no jsdom. The only exception is `datetime.test.ts`, which uses `vi.useFakeTimers()` + `vi.setSystemTime()` to test the VN timezone helper at TZ-edge moments.

### 3.5 Dependencies to add (devDependencies)

```json
{
  "vitest": "^2.1.0",
  "vite-tsconfig-paths": "^5.0.0"
}
```

That's it. No `@vitest/ui`, no `@vitest/coverage-v8`, no `@testing-library/*` — all deferred.

---

## 4. Module-by-module test plan

### 4.1 `src/features/cash/__tests__/cash-math.test.ts`

Source: `src/features/cash/cash-math.ts` (5 functions, all pure).

| Function | Test count (≈) | Key cases |
|---|---|---|
| `computeDenominationTotal` | 4 | All-zero → 0; one denom (`{"200000": 3}` → 600_000); mixed numeric+string keys (`{500000: 1, "100000": 2}` → 700_000); missing keys = treated as 0 |
| `computeReconciliation` | 3 | All-zero → 0; basic happy path matching v3 fixture; negative result when `openingCash > physical + extras` |
| `computeReconcileDiff` | 3 | POS == reconciliation → 0; POS < reconciliation → negative (thiếu); POS > reconciliation → positive (thừa) |
| `isLeaveAmountValid` | 6 | Exactly 0 → true; exactly = physical → true; > physical → false; negative → false; `NaN` → false; `Infinity` → false |
| `computeGreedyLeaveBreakdown` | 5 | `237_000` → `{"200000":1, "20000":1, "10000":1, "5000":1, "2000":1}` (per JSDoc example); `0` → `{}`; `500` (< smallest denom) → `{}`; `1_000_000` (clean 5× 200k) → `{"200000":5}`; `1_001_000` (1M + 1k) → `{"200000":5, "1000":1}` |

**~21 test cases for cash-math.**

The opus reviewer of Phase 3B.2b.i specifically called out these three high-priority cases:
1. `computeDenominationTotal` with mixed numeric/string keys (covered above).
2. `computeGreedyLeaveBreakdown(237_000)` matching the JSDoc example exactly (covered above).
3. `isLeaveAmountValid` edge cases (`NaN`, exactly = physical, negative) (covered above).

### 4.2 `src/lib/__tests__/format.test.ts`

Source: `src/lib/format.ts` (7 functions).

| Function | Test count (≈) | Key cases |
|---|---|---|
| `formatNumber` | 3 | `0` → `"0"`; `1_234_567` → `"1.234.567"` (vi-VN thousand sep is `.`); `null` / `undefined` → `"0"` |
| `formatVND` | 2 | `1_234_567` → `"1.234.567 ₫"`; `null` → `"0 ₫"` |
| `formatVNDCompact` | 6 | `0` → `"0"`; `500` → `"500"`; `185_000` → `"185k"`; `1_721_000` → `"1.7M"`; `2_000_000` → `"2M"` (no `.0`); `-185_000` → `"-185k"` |
| `formatDateTime` | 3 | `null` → `"Chưa có"`; valid ISO → vi-VN dd/mm/yyyy hh:mm format; pin to fixed instant via `vi.setSystemTime` for determinism |
| `formatTime` | 2 | `null` → `"--:--"`; valid ISO → `"hh:mm"` |
| `durationLabel` | 4 | `0` → `"0:00 giờ"`; `45` → `"0:45 giờ"`; `90` → `"1:30 giờ"`; `null` → `"0:00 giờ"` |
| `moneyFromInput` | 4 | `"1.234.567"` → `1234567`; `"abc"` → `0`; empty string → `0`; `"-500"` → `-500` (the regex keeps `-`) |

**~24 test cases for format.**

**Note on `formatNumber` / `formatVND`:** vi-VN locale uses `.` as thousands separator on Node 22's ICU. We assert the exact string. If a future Node upgrade changes ICU output, the test will catch it — that's a feature, not a bug.

**`todayIso` is deprecated** (see JSDoc line 39 of `format.ts`) — we do NOT add tests for it. We add a test for the canonical `todayInVN` in `datetime.test.ts`.

### 4.3 `src/lib/__tests__/validation.test.ts`

Source: `src/lib/validation.ts` (6 exported validators + `limits` constant).

| Function | Test count (≈) | Key cases |
|---|---|---|
| `validateExpense` | 5 | Happy path → `{ok: true}`; empty description → fail field=`description`; description > 500 → fail; quantity out of range → fail; amount negative → fail |
| `validateEmployee` | 3 | Happy path → ok; empty name → fail; hourly_rate > 10M → fail |
| `validatePayrollEdit` | 4 | Happy path → ok; missing check_in → fail; check_out < check_in → fail; note > 1000 → fail |
| `validateDenominations` | 4 | Happy path (all 9 valid keys) → ok; invalid key `"100"` → fail; count negative → fail; count > 10000 → fail |
| `validateCashCount` | 3 | Happy path → ok; denominations fail propagates → fail with same field; total_physical out of range → fail |
| `validateHandoverNote` | 2 | Note ≤ 1000 → ok; > 1000 → fail |

**~21 test cases for validation.**

Tests should assert **both** `result.ok` AND, when `ok: false`, `result.field` matches the expected field name. This catches future refactors that change which field a validation error attaches to (matters for form error placement).

### 4.4 `src/lib/__tests__/datetime.test.ts`

Source: `src/lib/datetime.ts` (3 functions).

| Function | Test count (≈) | Key cases |
|---|---|---|
| `toDatetimeLocal` | 3 | `null` / `undefined` → `""`; UTC ISO `"2026-05-04T15:47:00.000Z"` → `"2026-05-04T22:47"` (VN = UTC+7); naive ISO without TZ marker still produces 16-char output |
| `fromDatetimeLocal` | 3 | Empty string → `null`; valid `"2026-05-04T05:30"` → unchanged pass-through; whitespace-only → `null` (only via the `||` falsy path) |
| `todayInVN` | 3 | Mock `Date` to 2026-05-21 16:59 UTC (= 23:59 VN) → returns `"2026-05-21"`; mock to 2026-05-21 17:01 UTC (= 00:01 VN next day) → returns `"2026-05-22"`; format is always `YYYY-MM-DD` (10 chars) |

**~9 test cases for datetime.**

**Critical TZ-edge test:** the 17:00 UTC boundary tests precisely cover the bug the JSDoc on `todayInVN` describes — using `toISOString().slice(0,10)` would return wrong-day after that boundary. The test pins `vi.setSystemTime()` to both sides of the boundary and asserts the helper crosses correctly.

**Mocking pattern (used only in datetime.test.ts and `formatDateTime` test of format.test.ts):**
```ts
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it("crosses VN midnight at 17:00 UTC", () => {
  vi.setSystemTime(new Date("2026-05-21T17:01:00.000Z"));
  expect(todayInVN()).toBe("2026-05-22");
});
```

---

## 5. File Manifest

### 5.1 New files (created in this phase)

| Path | Purpose | Approx LOC |
|---|---|---|
| `vitest.config.ts` | Runner config (alias plugin + node env) | 12 |
| `src/features/cash/__tests__/cash-math.test.ts` | Cash math unit tests | ~120 |
| `src/lib/__tests__/format.test.ts` | Format helpers tests | ~110 |
| `src/lib/__tests__/validation.test.ts` | Validation helpers tests | ~120 |
| `src/lib/__tests__/datetime.test.ts` | Datetime helpers tests (with fake timers) | ~70 |

### 5.2 Modified files

| Path | Change |
|---|---|
| `package.json` | Add `vitest` + `vite-tsconfig-paths` to `devDependencies`; add `test`, `test:run`, `test:watch` scripts |
| `package-lock.json` | Regenerated by `npm install` |
| `tsconfig.json` | Add `"vitest/globals"` to `compilerOptions.types` if using globals API (we DO — for `describe` / `it` / `expect` without imports) |
| `.gitignore` | Add `coverage/` (forward-looking, even though we don't generate it yet) |

### 5.3 Off-limits (NOT touched)

- Any file in `src/lib/**` other than the new `__tests__/` dirs (Phase 1 backend code is frozen).
- Any file in `src/features/cash/**` other than the new `__tests__/` dir (helpers themselves are correct — we test them, we don't refactor them).
- Phase 2 component bodies, Phase 1 hooks, Phase 1 RPC clients — all frozen.

---

## 6. Implementation order (task decomposition preview)

Final task count + structure will be decided by `writing-plans`. Rough projected ordering:

1. **Task 1**: Install Vitest + vite-tsconfig-paths, write `vitest.config.ts`, add npm scripts, add `vitest/globals` to tsconfig. Verify `npm run test:run` exits 0 (with "no test files found" being acceptable — runner is alive).
2. **Task 2**: `cash-math.test.ts` (the most-anticipated suite, opus-flagged cases).
3. **Task 3**: `format.test.ts`.
4. **Task 4**: `validation.test.ts`.
5. **Task 5**: `datetime.test.ts` (uses fake timers — slightly more involved).
6. **Task 6**: Verify `npm run test:run` passes with all ~70–75 tests green. Tag `v4-phase-3b2b-ii-a`.

Each task commits independently. Each task should be runnable end-to-end after the previous one — TDD discipline means writing tests first, but since these helpers already exist, the tests are characterization tests, not red-green-refactor. We still run each test once to confirm it passes.

**Estimated total ~6 tasks.**

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Node 22 ICU output changes `formatNumber` separator | Low | Tests will catch in CI when Phase 6 stands up; locally we pin assertions to current Node 22 output. Acceptable. |
| `vi.useFakeTimers()` doesn't intercept `new Date().toLocaleDateString()` in `todayInVN` | Medium | Vitest's fake timers DO patch `Date` constructor by default. We'll verify in Task 1 with a smoke test. If broken, fall back to `vi.setSystemTime(new Date(...))` which patches the Date object too. |
| Vitest version bump breaks API | Low | Pin major version `^2.1.0`. Re-evaluate at Phase 6 (next phase touching tests). |
| `vite-tsconfig-paths` doesn't resolve `@/` alias | Medium | Plugin is well-supported (Vercel/Vite community). If it fails, fallback is manually configuring `resolve.alias` in `vitest.config.ts`. Spec mentions both options. |
| Tests surface latent bug in helpers (e.g., `computeReconciliation` sign error) | Medium | This is the whole point of the phase. If a bug surfaces, fix the helper in the same task as the failing test, document in commit message, get reviewer sign-off. Do NOT modify the test to pass against buggy code. |
| Coverage of `formatDateTime` / `formatTime` is locale-dependent | Low | Use `vi.setSystemTime` to pin the input instant; assert against the EXACT vi-VN output Node 22 produces. If a future Node update changes output, the test fails loudly — that's correct behavior. |

---

## 8. Verification at end of phase

After all 6 tasks land, the implementer (or final reviewer) MUST run:

```bash
npm run test:run
```

Expected output:
- All ~70–75 tests pass (green checkmarks).
- Exit code 0.
- Run time < 5 seconds (pure functions, no I/O).

Then tag:
```bash
git tag v4-phase-3b2b-ii-a
```

And invoke `finishing-a-development-branch` to merge into main.

---

## 9. What this phase explicitly does NOT verify

- **It does not verify backend correctness.** That's Phase 3B.2b.ii.b's job (pgTAP against the real Postgres functions).
- **It does not verify UI flow.** Component / E2E tests are Phase 6.
- **It does not verify Supabase RLS.** That's also Phase 3B.2b.ii.b (pgTAP + `auth.uid()` mocking).
- **It does not gate phase transitions.** Phase 3B.2b.ii.b will introduce `verify:phase` as the composite gate.

---

## 10. Success criteria

- [ ] `npm install` runs cleanly (Vitest + vite-tsconfig-paths added).
- [ ] `npm run test:run` exits 0 with ~70–75 tests passing.
- [ ] All 4 test files exist at the spec-mandated paths.
- [ ] `tsconfig.json` has `"types": [..., "vitest/globals"]` so `describe` / `it` / `expect` resolve without per-file imports.
- [ ] No off-limits files modified (Phase 1 backend + Phase 2 components + prior-phase features all untouched).
- [ ] Commit history: one commit per task (~6 commits), each with `Co-Authored-By: Claude Opus 4.7 (1M context)` footer.
- [ ] Final tag `v4-phase-3b2b-ii-a` placed on the merge commit on `main`.
- [ ] Phase 3B.2b.ii.b can immediately start by branching off the new `v4-phase-3b2b-ii-a` tag with `npm run test:run` already wired as a prerequisite for its composite gate.
