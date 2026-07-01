# Manual race test — cash_close advisory lock (drives real RPCs)

## Why this exists
pgTAP runs each file in a single session; advisory **xact** locks are re-entrant
within one session, so a single-session test can never observe the cross-session
blocking the lock provides. `database/tests/350_cash_close_advisory_lock.sql` only
proves the functions run and the final-close guards fire. The cross-session
*serialization* is demonstrated here, by calling the **actual RPCs**.

## What it proves
Four scenarios, each calling real RPCs that take `pg_advisory_xact_lock(hashtext('cash_close:'||business_date::text))`:
1. **Payroll writer-first** — `check_out_employee` holds the lock; `finalize` in a
   second session must **block** until commit, then its snapshot **includes** that
   payroll (`payroll_cash_total=480000`). `payroll` is read LIVE by finalize, so this
   is a true inclusion proof. Fails if finalize omits/late-takes the lock or uses a
   mismatched key.
2. **Payroll finalize-first** — `finalize` holds the lock; `check_out_employee` must
   **block**, then **raise** the guard once it proceeds.
3. **Cash-count writer-first** — `update_cash_count` holds the lock; `finalize` must
   **block**, then read the UPDATED count (`physical_cash=1500000`). The `cash_counts`
   row is read LIVE by finalize (and its `FOR UPDATE` does not block finalize's plain
   SELECT), so this is the inclusion proof for the *primary* finalized input.
4. **Opening finalize-first** — `finalize` holds the lock; `save_cash_day_opening`
   must **block**, then **raise** the guard. Opening is NOT inclusion-tested on
   purpose: finalize freezes `opening_cash` from the count
   (`coalesce(nullif(v_count.opening_cash,0),...)`), so a live opening edit is not
   picked up; opening's demonstrable cross-session property is block + guard-raise.

## Limitations
- Best-effort, timing-based (`pg_sleep` + wall-clock). Not deterministic enough for CI.
- Scenario 1's amount check assumes `shift_payroll_records.payment_method` defaults to
  `'cash'` (the script prints the default and warns otherwise).
- The `cash_close → safe_fund:cash` ordering inside `save_cash_day_opening`
  (`safe_withdrawal_amount > 0`) is not separately timed here; global lock order is
  `cash_close → safe_fund:cash → safe_fund:transfer` in every function, so no cycle.
- Scope of this script: the four writers locked by `2026-06-28-z-writer-locks-cash-close.sql`
  (`check_out_employee`, `check_out_self`, `update_cash_count`, `save_cash_day_opening`).
  `finalize`/`edit`/`check_in` locks + the "all shifts closed" finalize rule come from
  PR #64. Residual (out of scope): expense and POS-sales writers; `opening`/`pos` are
  frozen into the count at finalize — see the migration header / PR description.

## How to run
1. Bring up the local Supabase stack (so `docker compose exec db` works) and ensure
   `supabase/.env` has `POSTGRES_PASSWORD`.
2. From the repo root: `bash tools/race-cash-close.sh`
3. Expect: `ALL RACE CHECKS PASSED`. The script seeds fixtures on near-future dates
   (`current_date+5..8`, collision-free) with `counted_at = now()+4min` (inside
   `compute_cash_theory`'s allowed window) and cleans them up on exit.

> A logically-equivalent cross-session proof against a throwaway DB (in any running
> Supabase Postgres 15 container) was recorded during development — see the PR
> description for the captured block-times and the included/excluded amounts.
