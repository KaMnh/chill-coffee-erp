# Phase 3B.2b.ii.b — pgTAP Infra + Cash RPC Tests + Verify-Mirror Extension + verify:phase Gate (Design Spec)

**Date:** 2026-05-21
**Branch:** `phase-3b2b-ii-b-pgtap` (off `main` @ `98450d9` = tag `v4-phase-3b2b-ii-a`)
**Tag at end:** `v4-phase-3b2b-ii-b`
**Predecessor:** Phase 3B.2b.ii.a (Vitest infra, 75 helper tests, merged at `98450d9`)
**Closes:** Phase 3B (full cash module + verification gate complete)
**Successor:** Phase 3C (safe + settings + handover wizard — owner-only)

---

## 0. TL;DR

Stand up **pgTAP** as v4's database-side test runner, write **~35 assertions across 6 cash RPC test files** covering all money-touching RPCs, write **~12 RLS assertions** for `safe_*` and `cash_*` tables, **extend `verify-mirror.mjs` with 4 cash fields**, and wire a composite **`verify:phase`** npm script as the merge gate from this phase onward.

This phase delivers the **second tier** of test coverage in v4 — the database/backend tier, complementing Phase 3B.2b.ii.a's frontend/helper tier. Combined, the two tiers cover ~110 invariants spanning pure helpers, RPC behavior, and RLS boundaries.

This is also the phase that introduces the **merge gate convention**: from Phase 3C onward, every phase must pass `npm run verify:phase` before tagging.

---

## 1. Goal

Deliver three concrete artifacts:

1. **A working pgTAP harness** (`database/tests/`, runner script, npm scripts) — exit-code-aware, idempotent, no host-side Perl/pg_prove install required.
2. **~47 backend test assertions** — 35 cash RPC + 12 RLS — all passing on `main` at phase end.
3. **A composite gate** — `npm run verify:phase` runs both Vitest (test:run) and pgTAP (pgtap) in sequence; either failure exits non-zero. Verify-mirror stays a separate, manual-trigger gate (requires a fresh production dump).

All tests **MUST** pass on `main` at phase end. If a test surfaces a bug in an RPC, we fix the RPC and document the fix in the same task as the failing test.

---

## 2. Non-Goals (deferred)

| Item | Deferred to | Reason |
|---|---|---|
| pgTAP via `pg_prove` runner | Phase 6 (with CI) | Windows install of Perl + DBD::Pg is painful; `psql -f` + custom TAP parser is sufficient for local-only use. CI on Linux can drop in `pg_prove` later without changing test files. |
| RLS coverage for non-cash tables (audit_log, integration_clients, expenses, shifts, profiles, etc.) | Phase 6 | Out of cash module scope. The other modules' RLS rules are simpler and verified indirectly through verify-mirror. |
| pgTAP for non-cash RPCs (dashboard_daily_ops, expense RPCs, shift RPCs, ingest_kiotviet_batch, handover RPCs, sidebar/settings RPCs) | Phase 6 | Out of cash scope. Money-touching RPCs are the highest-risk surface; others are lower-stakes. |
| Multi-day verify-mirror loop (`--days N` flag) | Phase 6 | Single-date verification + cash fields adequately covers the TZ/aggregation surface. Multi-day adds complexity without proportional risk reduction. |
| CI workflow (`.github/workflows/verify.yml`) | Phase 6 | No git remote yet. Phase 6 introduces remote + CI together. |
| Coverage measurement of RPC code paths | Phase 6 | No tooling for it; deferred until CI exists. |
| Property-based testing for cash math invariants | Phase 6+ | Hypothesis-style testing for VND math (zero-sum, no-rounding-drift, etc.) is interesting but YAGNI for current cash flow. |

---

## 3. Architecture

### 3.1 Runner choice: psql in-container

Picked **`docker compose exec db psql -f -`** over `pg_prove` because:
- No host-side Perl/DBD::Pg install (Windows-painful).
- The Supabase Postgres image is the canonical execution environment — running tests inside it matches production.
- TAP output parsing is trivial (look for `^not ok`, count `^ok`, parse final `1..N`).
- A future drop-in of `pg_prove` (on Linux CI) requires zero changes to the `.sql` test files — pgTAP's `plan() ... finish()` API is the canonical interface.

### 3.2 File layout

```
database/
  tests/
    000_setup.sql                       -- CREATE EXTENSION pgtap (one-time, idempotent)
    010_save_cash_day_opening.sql       -- ~4 assertions
    020_save_cash_count.sql             -- ~6 assertions
    030_update_cash_count.sql           -- ~4 assertions
    040_finalize_cash_close_report.sql  -- ~8 assertions
    050_edit_cash_close_report.sql      -- ~7 assertions
    060_void_cash_close_report.sql      -- ~6 assertions
    070_rls_safe_tables.sql             -- ~6 assertions
    080_rls_cash_tables.sql             -- ~6 assertions

scripts/
  pgtap-run.mjs                         -- Node runner: iterate files, parse TAP, exit 0/1

tools/
  verify-mirror.mjs                     -- EXTENDED with 4 cash fields (see §5)

package.json                            -- 3 new scripts: pgtap, verify:phase, verify:mirror
```

**~47 total assertions** (35 cash RPC + 12 RLS) across 9 SQL files.

### 3.3 Test file template (per file)

Every test file follows this shape so each is fully isolated and rollback-safe:

```sql
BEGIN;
SELECT plan(N);  -- declare expected assertion count up front

-- ────────────────────────────────────────
-- Fixtures: minimal setup just for this file
-- ────────────────────────────────────────
INSERT INTO public.profiles ...;
INSERT INTO public.employees ...;
INSERT INTO public.employee_accounts ...;
-- (any RPC-specific fixtures: opening cash, prior counts, etc.)

-- ────────────────────────────────────────
-- Assertions
-- ────────────────────────────────────────
SELECT lives_ok(
  $$ SELECT public.save_cash_count('{"...": "..."}'::jsonb) $$,
  'happy path: save_cash_count does not throw'
);

SELECT is(
  (SELECT count(*)::int FROM public.cash_counts WHERE business_date = '2026-01-15'),
  1,
  'exactly one cash_counts row inserted'
);

SELECT throws_ok(
  $$ SELECT public.save_cash_count('{"denominations_json": {"100": 5}}'::jsonb) $$,
  NULL,  -- any SQLSTATE matches
  NULL,  -- any message matches
  'invalid denomination key rejected'
);

-- ────────────────────────────────────────
-- Finish
-- ────────────────────────────────────────
SELECT * FROM finish();
ROLLBACK;  -- discard fixtures; DB left clean for next file
```

**Rollback-per-file** is the cornerstone of isolation. Files can run in any order, partial failures don't pollute, and DB state never drifts.

### 3.4 Runner script (`scripts/pgtap-run.mjs`)

Follows the same shape as the existing `scripts/db-init.mjs`:

- Reads `supabase/.env` for `POSTGRES_PASSWORD`.
- Globs `database/tests/0*.sql` (excludes `000_setup.sql` from the main run — `000` runs first as a one-time setup, then `010+` run as actual tests).
- Wait — actually, `000_setup.sql` only contains `CREATE EXTENSION IF NOT EXISTS pgtap;` and is idempotent. Easier to just include it in the iteration (it adds ~50ms once, then is a no-op).
- For each file: `docker compose exec -T -e PGPASSWORD=... db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -` with file contents piped in.
- Parses stdout. Pattern:
  - `^ok N - <description>` → tally pass count.
  - `^not ok N - <description>` → tally fail count + print the description.
  - `^1\.\.N` → confirm declared plan matched actuals.
- Exits 0 if all files pass; 1 on first failure (fail-fast). Final summary line: `Files: 9/9 passed | Assertions: 47/47 passed`.

**CLI flags** (small surface):
- (no flag, default) — run all files.
- `--setup-only` — only run `000_setup.sql` (for explicit one-time setup).
- `--file <path>` — run a single file (for iteration during development).

No `--verbose` or `--watch` flag — out of scope. Devs can `cat` the file and run `docker compose exec ... psql -f -` manually if they want raw TAP.

### 3.5 No new dependencies

`pgtap-run.mjs` uses only Node 22 built-ins (`child_process`, `fs`, `path`) — same as `db-init.mjs`. No new npm devDeps.

The `pgtap` Postgres extension itself is bundled with the Supabase Postgres image (verified — `select * from pg_available_extensions where name='pgtap'` returns it). No image change.

---

## 4. Test plan per RPC

### 4.1 010_save_cash_day_opening.sql (~4 assertions)

The RPC accepts `{p_payload: jsonb}` with fields: `business_date`, `opening_cash`, `note`, optionally `safe_withdrawal_amount` (owner only). It inserts into `cash_day_openings` + optionally a `safe_transaction` (kind=`day_opening_withdrawal`).

| # | Assertion | Type |
|---|---|---|
| 1 | Happy path: owner inserts → row appears with correct `opening_cash` | `is` on table row |
| 2 | Duplicate `business_date` rejected | `throws_ok` on second call |
| 3 | Manager allowed (per RLS `cash_openings_owner_manager_insert`) | `lives_ok` after `act_as(manager)` |
| 4 | Staff_operator rejected | `throws_ok` after `act_as(staff)` |

### 4.2 020_save_cash_count.sql (~6 assertions)

The RPC accepts `{p_payload: jsonb}` with `business_date`, `denominations_json`, `total_physical`, `bank_transfer_confirmed`, `note`, `count_type`. Inserts `cash_counts` + `cash_drawer_events` snapshot.

| # | Assertion | Type |
|---|---|---|
| 1 | Happy path: row inserted + `cash_drawer_events` snapshot rows created | `is` on count of inserted rows |
| 2 | Invalid denomination key `"100"` → raises | `throws_ok` |
| 3 | Denomination count > 10000 → raises | `throws_ok` |
| 4 | `total_physical` > limits.amount.max → raises | `throws_ok` |
| 5 | `bank_transfer_confirmed = 0` accepted | `lives_ok` |
| 6 | `count_type='spot_audit'` and `count_type='shift_close'` both accepted | `lives_ok` × 2 inline |

### 4.3 030_update_cash_count.sql (~4 assertions)

Admin RPC to edit an existing non-finalized count. Re-snapshots `cash_drawer_events`.

| # | Assertion | Type |
|---|---|---|
| 1 | Happy path: admin edits non-final count → bank_transfer field updated | `is` on column value |
| 2 | Rejects when target count is already finalized (linked to `cash_close_report`) | `throws_ok` |
| 3 | Recomputes `cash_drawer_events` snapshot when denominations change | `is` on count of replaced rows |
| 4 | Note + bank_transfer can be edited independently (note-only edit doesn't re-snapshot denoms) | `is` on snapshot row count |

### 4.4 040_finalize_cash_close_report.sql (~8 assertions — the big one)

The RPC accepts `p_cash_count_id` and creates 1 `cash_close_report` + 1 `safe_transaction` (kind=`safe_deposit`).

| # | Assertion | Type |
|---|---|---|
| 1 | Happy path: exactly 1 `cash_close_report` row created | `is` on count |
| 2 | Happy path: exactly 1 `safe_transaction` of kind `safe_deposit` created | `is` on count |
| 3 | `safe_deposit_amount` = `physical_cash - leave_for_next_day` | `is` on exact value |
| 4 | `safe_balance_now()` increases by `safe_deposit_amount` | `is` on before/after diff |
| 5 | Report status = `'final'` | `is` on column |
| 6 | `cash_close_report.cash_count_id` FK matches input | `is` on FK |
| 7 | Idempotency: calling finalize twice on same count → second call raises | `throws_ok` |
| 8 | Rejects finalize on a `spot_audit` count (only `shift_close` qualifies) | `throws_ok` |

(Earlier draft listed 9 — "rejects when no opening exists". On review: `dashboard_daily_ops` and the RPC chain require opening, but `finalize_cash_close_report` itself doesn't gate on opening — opening is a UI-layer prerequisite. Dropped from the test list.)

### 4.5 050_edit_cash_close_report.sql (~7 assertions)

Admin RPC to edit a final report's `note` and/or `leave_for_next_day`. Leave change → adjustment safe_transaction.

| # | Assertion | Type |
|---|---|---|
| 1 | Happy path: edit note only → no new safe_transaction (count unchanged) | `is` on count |
| 2 | Increase leave by 50k → adjustment safe_transaction of −50k inserted | `is` on transaction.amount |
| 3 | Decrease leave by 50k → adjustment safe_transaction of +50k inserted | `is` on transaction.amount |
| 4 | Rejects when target report is `voided` | `throws_ok` |
| 5 | Rejects leave > `physical_cash` | `throws_ok` |
| 6 | Rejects negative leave | `throws_ok` |
| 7 | `safe_balance_now()` reflects adjustment correctly after leave-change edit | `is` on diff |

### 4.6 060_void_cash_close_report.sql (~6 assertions)

The RPC accepts `p_report_id, p_reason` and marks status=`voided`, inserts reverse safe_transaction.

| # | Assertion | Type |
|---|---|---|
| 1 | Happy path: status flips to `voided` | `is` on column |
| 2 | `reversed_safe_amount` returned by RPC matches original `safe_deposit_amount` | `is` on RPC return |
| 3 | Original `cash_close_report` row still exists (no hard delete) | `is` on row count = 1 |
| 4 | Reason < 5 chars rejected | `throws_ok` |
| 5 | Rejects when already voided (idempotency) | `throws_ok` |
| 6 | Rejects when safe doesn't have enough balance to reverse (depleted scenario) | `throws_ok` |

### 4.7 Fixtures discipline

Each file's `BEGIN…ROLLBACK` wraps fixtures + assertions. Fixtures are **minimal**:
- One profile per role needed (owner / manager / staff_operator)
- One employee + one employee_account tied to each profile
- One `cash_day_opening` for `business_date='2026-01-15'`
- For RPCs that act on prior counts: pre-insert a count with known values

No `001_seed_test_data.sql` or shared fixture file. Every test is independently runnable in isolation — if you copy a single test file to a fresh DB, it works.

---

## 5. RLS test plan

### 5.1 JWT mock helper

Each RLS file defines a `pg_temp.act_as(p_user_id uuid, p_role text)` function that calls `set_config('request.jwt.claims', json_build_object(...)::text, true)` so `auth.uid()` and `app_role()` return the desired identity.

Critical: tests `SET LOCAL ROLE authenticated;` after `act_as` so RLS policies actually fire (superuser bypasses RLS).

### 5.2 070_rls_safe_tables.sql (~6 assertions)

Three sensitive tables (`safe_transactions`, `safe_counts`, `safe_attachments`) — all **owner-only read**, **no direct write**:

| # | Assertion | Test |
|---|---|---|
| 1 | Owner SELECT from `safe_transactions` → rows returned | `is` on count |
| 2 | Manager SELECT from `safe_transactions` → 0 rows (RLS filters) | `is` on count = 0 |
| 3 | Staff_operator SELECT from `safe_transactions` → 0 rows | `is` on count = 0 |
| 4 | Manager direct INSERT into `safe_transactions` → policy violation | `throws_ok` |
| 5 | Owner SELECT from `safe_counts` returns rows; manager SELECT returns 0 | `is` × 2 inline |
| 6 | Owner SELECT from `safe_attachments` returns rows; manager SELECT returns 0 | `is` × 2 inline |

### 5.3 080_rls_cash_tables.sql (~6 assertions)

Cash tables with role gradients:

| # | Assertion | Test |
|---|---|---|
| 1 | Staff_operator SELECT from `cash_day_openings` → works | `lives_ok` |
| 2 | Staff_operator INSERT into `cash_day_openings` → policy violation (only owner/manager) | `throws_ok` |
| 3 | Manager INSERT into `cash_day_openings` → works | `lives_ok` |
| 4 | Staff_operator INSERT into `cash_counts` → works (staff-all policy) | `lives_ok` |
| 5 | Staff_operator SELECT from `cash_close_reports` → works | `lives_ok` |
| 6 | Staff_operator UPDATE on `cash_close_reports` → policy violation (only owner/manager update) | `throws_ok` |

### 5.4 RLS testing caveats

**Direct-write tests** (assertions 4 in §5.2, 2/3/6 in §5.3) exercise INSERT/UPDATE paths that the **app never uses** — the app always goes through security-definer RPCs. These tests still matter: they confirm the RLS policy itself is correctly written, which is the second line of defense if a future RPC accidentally exposes a path.

**Why not just trust the RPCs?** Because future ad-hoc maintenance queries from owner-debugging sessions could accidentally exercise the direct path. RLS-as-defense-in-depth is the policy here.

---

## 6. Verify-mirror cash extension

### 6.1 Scope

Extend `tools/verify-mirror.mjs` with 4 new cash fields. Same single-date model — no multi-day loop.

### 6.2 New comparison phase

A new `viaCashAggregates()` async function alongside `viaRpc()` / `viaRawAggregates()`:

```js
async function viaCashAggregates() {
  // RPC side
  const { data: reports, error: e1 } = await supabase.rpc(
    "get_cash_close_reports_by_date",
    { p_business_date: date }
  );
  if (e1) throw new Error(`get_cash_close_reports_by_date failed: ${e1.message}`);

  const { data: counts, error: e2 } = await supabase.rpc(
    "list_cash_counts",
    { p_business_date: date }
  );
  if (e2) throw new Error(`list_cash_counts failed: ${e2.message}`);

  // Raw side (PostgREST direct table queries)
  const { data: rawReports, error: e3 } = await supabase
    .from("cash_close_reports")
    .select("status, safe_deposit_amount, business_date")
    .eq("business_date", date);
  if (e3) throw new Error(`cash_close_reports read failed: ${e3.message}`);

  const { data: rawCounts, error: e4 } = await supabase
    .from("cash_counts")
    .select("id")
    .eq("business_date", date);
  if (e4) throw new Error(`cash_counts read failed: ${e4.message}`);

  return {
    cash_close_reports_count_rpc: reports.length,
    cash_close_reports_count_raw: rawReports.length,
    cash_close_reports_final_rpc: reports.filter(r => r.status === 'final').length,
    cash_close_reports_final_raw: rawReports.filter(r => r.status === 'final').length,
    safe_deposit_sum_rpc: reports
      .filter(r => r.status === 'final')
      .reduce((sum, r) => sum + Number(r.safe_deposit_amount ?? 0), 0),
    safe_deposit_sum_raw: rawReports
      .filter(r => r.status === 'final')
      .reduce((sum, r) => sum + Number(r.safe_deposit_amount ?? 0), 0),
    cash_counts_count_rpc: counts.length,
    cash_counts_count_raw: rawCounts.length,
  };
}
```

### 6.3 Updated checks table

The output table grows from 7 rows to 11. Same `Field | RPC | Raw | Match` format:

```
Field                          | RPC              | Raw              | Match
─────────────────────────────────────────────────────────────────────
total_sales                    | ...              | ...              | ✓
cash_sales                     | ...              | ...              | ✓
total_expenses                 | ...              | ...              | ✓
payroll_paid                   | ...              | ...              | ✓
active_staff                   | ...              | ...              | ✓
sales_orders_count             | ...              | ...              | ✓
expenses_count                 | ...              | ...              | ✓
cash_close_reports_count       | ...              | ...              | ✓
cash_close_reports_final_count | ...              | ...              | ✓
safe_deposit_sum_for_date      | ...              | ...              | ✓
cash_counts_count              | ...              | ...              | ✓
```

### 6.4 Zero-data behavior

If the mirror date has no cash activity (a Sunday closed-shop, or a date predating cash module rollout in v3), all 4 cash fields return 0 on both sides → still passes. The extension validates consistency, not presence.

### 6.5 Caveat: `safe_balance_now()` not added

Originally considered but dropped: `safe_balance_now()` is a running total across all dates, not date-scoped. Comparing it across the mirror-load timestamp is fragile (depends on which transactions are in the dump). The 4 chosen fields are all date-scoped and stable.

---

## 7. Composite gate (`verify:phase`)

### 7.1 npm scripts

Three new scripts added to `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run",
    "test:watch": "vitest watch",
    "pgtap": "node scripts/pgtap-run.mjs",
    "verify:phase": "npm run test:run && npm run pgtap",
    "verify:mirror": "node tools/verify-mirror.mjs"
  }
}
```

(Existing scripts `dev`, `build`, `start`, `db:init`, `db:seed`, `smoke` unchanged.)

### 7.2 Semantics

- **`npm run pgtap`** — runs all pgTAP files. Exit 0 if all assertions pass; 1 on first failure.
- **`npm run verify:phase`** — composite gate. Sequential: vitest first (fast, <2s), pgtap second (needs Docker DB up, ~5-10s). Total target <15s.
- **`npm run verify:mirror`** — wrapper for the existing `tools/verify-mirror.mjs`. Discoverable via `npm run`. NOT included in `verify:phase` because it needs a fresh mirror dump (impractical for daily gating).

### 7.3 Phase-gate convention

From this phase onward, every phase must pass `npm run verify:phase` before tagging. The `finishing-a-development-branch` step (verify-tests phase) will call `npm run verify:phase`, not just `npm test`.

Verify-mirror remains a **periodic** gate (weekly or pre-release), run manually with a fresh dump from v3 production.

---

## 8. File Manifest

### 8.1 New files (created in this phase)

| Path | Purpose | Approx LOC |
|---|---|---|
| `database/tests/000_setup.sql` | CREATE EXTENSION pgtap (idempotent) | 5 |
| `database/tests/010_save_cash_day_opening.sql` | ~4 assertions | ~80 |
| `database/tests/020_save_cash_count.sql` | ~6 assertions | ~120 |
| `database/tests/030_update_cash_count.sql` | ~4 assertions | ~90 |
| `database/tests/040_finalize_cash_close_report.sql` | ~8 assertions | ~160 |
| `database/tests/050_edit_cash_close_report.sql` | ~7 assertions | ~150 |
| `database/tests/060_void_cash_close_report.sql` | ~6 assertions | ~130 |
| `database/tests/070_rls_safe_tables.sql` | ~6 assertions | ~110 |
| `database/tests/080_rls_cash_tables.sql` | ~6 assertions | ~110 |
| `scripts/pgtap-run.mjs` | Node runner, TAP parser | ~120 |

### 8.2 Modified files

| Path | Change |
|---|---|
| `tools/verify-mirror.mjs` | Add `viaCashAggregates()` + 4 cash fields to checks table |
| `package.json` | Add `pgtap`, `verify:phase`, `verify:mirror` scripts |

### 8.3 Off-limits (NOT touched)

- `database/001_schema.sql`, `002_functions.sql`, `003_rls.sql`, `004_seed.sql`, `005_storage.sql` — Phase 1 backend, frozen
- `database/migrations/**` — historical, never edit
- `supabase/**` (other than reading `.env` for password) — separate stack ownership
- All `src/**` — frontend, not touched by this phase
- All prior `docs/superpowers/` files — referenced, not modified
- `docker-compose.yml`, `.env*` — runtime config, frozen

---

## 9. Implementation order (task decomposition preview)

Final count + structure decided in `writing-plans`. Rough projection:

1. **Task 1**: pgTAP setup — `000_setup.sql`, `scripts/pgtap-run.mjs`, npm scripts. Verify `npm run pgtap` exits 0 with "no tests yet" (acceptable).
2. **Task 2**: `010_save_cash_day_opening.sql` — first RPC test file, also doubles as the template-validation task.
3. **Task 3**: `020_save_cash_count.sql` + `030_update_cash_count.sql` (small files, batched).
4. **Task 4**: `040_finalize_cash_close_report.sql` — the big one, on its own.
5. **Task 5**: `050_edit_cash_close_report.sql` + `060_void_cash_close_report.sql`.
6. **Task 6**: `070_rls_safe_tables.sql` + `080_rls_cash_tables.sql` (both use the `act_as` pattern, natural to batch).
7. **Task 7**: Extend `verify-mirror.mjs` + add `verify:phase` script.
8. **Task 8**: Final verify (`npm run verify:phase` green, all 47 assertions pass) + tag `v4-phase-3b2b-ii-b`.

**Estimated total: ~8 tasks.** Slightly bigger than Phase 3B.2b.ii.a (6 tasks) — reflects the additional backend surface.

---

## 10. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Supabase Postgres image doesn't bundle pgtap | Medium | Verified `pg_available_extensions` includes pgtap on the image we use. If a future image upgrade drops it, fallback is `docker compose exec db apt install postgresql-XX-pgtap`. Task 1 verifies this. |
| `SET LOCAL ROLE authenticated;` doesn't fire policies as expected (superuser bypass) | Medium | Test 1 of file 070 explicitly verifies the role switch works by asserting `current_role` = `'authenticated'` and that owner SELECT returns rows while manager returns 0. If it fails, switch to a service-role connection vs superuser. |
| pgTAP TAP output parsing brittle | Low | Use the canonical `^ok N`, `^not ok N`, `^1\.\.N` regex set. Tested against pgTAP's actual output during Task 1. |
| `set_config('request.jwt.claims', ...)` doesn't propagate to RLS | Medium | Supabase RLS reads `auth.uid()` which reads from `request.jwt.claims` per current_setting. Verified the pattern via existing `app_role()` function — same mechanism. |
| Tests pollute DB despite ROLLBACK (e.g., sequences advance) | Low | Sequences advancing is harmless; doesn't affect correctness. Document in test file headers. |
| Long fixture inserts per file → tests slow | Low | Each fixture inserts <10 rows. Whole suite target <10s. Measured in Task 8. |
| Verify-mirror cash extension fails on dates with zero cash data | Low | Explicitly handled: both sides return 0 → match. Tested with a fresh DB during Task 7. |
| `verify:phase` chains fail silently on Windows (`&&` shell behavior) | Low | npm uses cross-platform `&&` semantics via npm-run-all-style invocation. Tested in Task 8. |
| pgTAP assertions accidentally depend on prior file's state | Critical (if it happens) | Every file's `BEGIN…ROLLBACK` enforces isolation. Task 1 includes a runner sanity check: `pgtap-run.mjs --file 040_finalize_cash_close_report.sql` (in isolation) must produce identical pass count vs full-suite run. |

---

## 11. Success criteria

- [ ] `npm run pgtap` exits 0 with ~47 assertions passing across 9 files.
- [ ] `npm run verify:phase` exits 0 (vitest 75/75 + pgtap 47/47 = 122 total assertions).
- [ ] All 9 SQL files exist at the spec-mandated paths.
- [ ] No off-limits files modified (Phase 1 backend frozen, no schema changes).
- [ ] `package.json` has 3 new scripts: `pgtap`, `verify:phase`, `verify:mirror`.
- [ ] `tools/verify-mirror.mjs` has 4 new cash fields in its checks table; output still readable.
- [ ] Each pgTAP test file is independently runnable (`--file <path>` mode).
- [ ] Commit history: one commit per task (~8 commits), each with `Co-Authored-By: Claude Opus 4.7 (1M context)` footer.
- [ ] Final tag `v4-phase-3b2b-ii-b` placed on the merge commit on `main`.
- [ ] Phase 3C can immediately call `npm run verify:phase` as part of its `finishing-a-development-branch` step.
- [ ] Phase 3B is officially complete (closes the cash module + full verification gate).

---

## 12. Phase boundary

This is the **last sub-phase of Phase 3B**. After merging this, Phase 3C begins:
- Safe view (owner-only) — `safe_transactions` table UI
- Settings module — `app_settings` editing
- Handover wizard — end-of-day workflow

Phase 3C inherits the `verify:phase` gate convention introduced here.

---

## 13. Out-of-scope notes (documented for future picking up)

These were considered and explicitly deferred (with rationale, so they're not lost):

- **Property-based tests for cash math.** `computeReconciliation` has interesting algebraic properties (associativity in some, not in others). Hypothesis-style tests would surface edge cases unit tests miss. Out of scope for this phase — would be its own design exercise.
- **Snapshot-based regression suite for verify-mirror.** Save a known-good `viaRpc()` JSON snapshot per date, diff against future runs. Useful for spot-the-drift but needs a fixture-store convention. Phase 6.
- **pgTAP for transactional behavior** (savepoints, advisory locks). Cash RPCs don't use them currently; if Phase 3C handover wizard does, add then.
- **Performance regression checks** (RPC takes >X ms → fail). Not for local-only test infra. Phase 6 with CI.
