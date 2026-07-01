# Flexible "Fixed" (per-day) Pay Type for Employees — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an employee be paid a manager-entered fixed amount per shift ("fixed" pay type) instead of hours × hourly_rate, without changing anything for existing hourly employees, and routing the fixed amount through the same `shift_payroll_records.total_pay` → `payroll_cash_out` path so the cash drawer, payroll reports, and day-close guard keep working.

**Architecture:** Add a `pay_type` discriminator (`'hourly' | 'fixed'`) to `employees` plus an optional `default_daily_pay`, and snapshot `pay_type` + a manager-entered `override_pay` onto each `shift_payroll_records` row. The pay-calculating RPCs branch on pay type: `fixed` uses `coalesce(override_pay, default_daily_pay, 0)` (ignoring hours×rate and the hourly auto-bonus); `hourly` is byte-for-byte unchanged. Snapshotting `pay_type` on the payroll row means old slips read correctly even after an employee later switches type. The realtime labor-cost estimator skips hourly accrual for `fixed` employees (they show 0 while the shift is open; their pay lands in `total_pay` only at check-out).

**Tech Stack:** Postgres (Supabase local) functions + pgTAP; Next.js 15 App Router / React 19 / TypeScript modals (plain `useState`, no form lib); Vitest + @testing-library/react.

---

## ⚠️ Two findings to verify with Codex BEFORE coding

These are deviations between the spec and the current `origin/main`. The plan resolves them as stated below; Codex must confirm the resolution.

**Finding 1 — Authz is owner-ONLY on main for two of the RPCs, not "owner+manager".**
The spec and handoff prompt say `edit_shift_payroll_record` (and proxy check-out) are "owner+manager". On current `origin/main` they are **owner-only**:
- `check_out_employee` (`database/002_functions.sql:588`) → `app_is_owner()` ("Chỉ chủ quán được ra ca hộ").
- `edit_shift_payroll_record` (`database/002_functions.sql:633`) → `app_is_owner()` ("Chỉ chủ quán được sửa lượt lương đã chốt").
- pgTAP `database/tests/340_attendance_lockdown.sql:74-77` **asserts** "manager KHÔNG edit_shift_payroll_record được (owner-only)".
- Only `check_out_employee_now` (`database/002_functions.sql:4783`) is `app_is_owner_manager()`.

**Resolution:** This feature does **NOT** change any RPC's authorization. The fixed-pay branch inherits each RPC's existing guard. `payroll-edit-modal.tsx` therefore stays owner-only (matching `edit_shift_payroll_record`). If the business genuinely wants managers to edit fixed daily pay, that is a separate authz change with its own test churn (it would break `340_attendance_lockdown.sql`) and is out of scope here.

**Finding 2 — Two more code paths must branch, beyond the two RPCs the spec names.**
The spec lists `check_out_employee` + `edit_shift_payroll_record`. But on this branch two more paths also compute hours×rate and would silently regress fixed employees:
- `check_out_employee_now` (`database/002_functions.sql:4775`) — manager "đóng ca hộ ngay" (force-close, rounds minutes up to 15). A fixed employee closed via this path would be paid hours×rate. It has no payload to type an amount, so it must fall back to `default_daily_pay`.
- `dashboard_daily_ops` (`database/002_functions.sql:320`) — emits `active_shifts: [{check_in_at, hourly_rate}]` consumed by `computeLiveLaborCost` (`src/lib/labor-cost.ts`). A fixed employee with a non-zero `hourly_rate` would wrongly accrue live labor cost while their shift is open. The realtime labor-cost feature **is merged on this branch** (`src/lib/labor-cost.ts`, `src/hooks/use-live-labor-cost.ts`, `database/migrations/2026-06-24-realtime-labor-cost.sql`), so the spec's "forward note" is in scope now.

**Resolution:** Both are included below (`check_out_employee_now` = Task 4; `dashboard_daily_ops` = Task 5). If Codex disagrees that `check_out_employee_now` should branch, the fallback is acceptable behaviour (fixed → `default_daily_pay`), but leaving it on hours×rate is a real bug.

---

## ✅ Codex plan-review Round 1 (2026-07-01) — findings incorporated

Codex reviewed this plan against the spec and the live code. It **confirmed** Finding 1 (owner-only is factually correct; preserving it is right) and Finding 2 (the `_now` + dashboard branches are justified and correct). It raised 6 items, all incorporated below:

1. **[BLOCKER] `check_out_self` is a 5th payroll writer the plan missed.** `database/002_functions.sql:4701` (`check_out_self(p_auth_user_id, p_ip, p_user_agent)`, SERVICE-ROLE, called by `src/app/api/checkout/route.ts:73`) computes hours×rate at `:4752`. A fixed employee self-checking-out would be paid hourly/0 and never snapshot `pay_type`/`override_pay`. → **New Task 4B** branches it (fixed → `default_daily_pay`, allowance 0, snapshot), with pgTAP. There is no manual amount in self-service; owner adjusts later via the edit modal.
   - Full list of payroll writers now covered: `check_out_employee` (T2), `edit_shift_payroll_record` (T3), `check_out_employee_now` (T4), **`check_out_self` (T4B)**, `dashboard_daily_ops` read-path (T5).

2. **[BLOCKER] Mutation-hook input interfaces drop the new fields.** `src/hooks/mutations/use-shift-mutations.ts` — `CheckOutInput` (`:57`) lacks `override_pay`; `UpdatePayrollInput` (`:87`) lacks `override_pay`; `UpsertEmployeeInput` (`:112`) lacks `pay_type`/`default_daily_pay` AND the constructed `payload` (`:128-133`) omits them, so even if the form sends them they are dropped before the data layer. → **Task 6 now also edits this file** (all 3 interfaces + the upsert payload). This is a prerequisite for the UI tasks (8/9/10).

3. **[SHOULD] Open-shift "force close" modal is omitted.** `src/features/shifts/close-shift-modal.tsx` drives `check_out_employee_now` and still shows an hourly figure; `loadOpenShifts` (`src/lib/data/shifts.ts:23`) does not load fixed fields. → **New Task 9B**: add `pay_type`/`default_daily_pay` to the `OpenShift` type + `loadOpenShifts` select + `CloseShiftTarget`, and make the modal DISPLAY the resolved fixed daily pay (read-only info, not the hourly estimate) for fixed rows. **No override input here** — `check_out_employee_now` takes no amount arg, and adding one changes its signature (Postgres would create a 2-arg overload rather than replace the 1-arg fn, breaking the dual-write mirror + `350` fixture). Managers who need a non-default amount edit the slip afterward (owner-only) via the payroll-edit modal. Codex please confirm this tradeoff is acceptable vs. a signature change.

4. **[SHOULD] Task 3's rewritten `edit_shift_payroll_record` body drifted from the real tail.** The shown body changed the `cash_drawer_events` `note` literal and `occurred_at`, and truncated the `return`. → **Task 3 Step 3 is rewritten below as a MINIMAL DIFF** (do not paste a full body): the real tail (`database/002_functions.sql:699-731`) uses `occurred_at = v_out`, `note = 'Sửa lượt lương đã chốt'`, and returns `payroll_record_id, shift_assignment_id, …`. Only add the branch + `override_pay`.

5. **[SHOULD] pgTAP edge cases missing.** Add assertions for: `override_pay = 0` (honored, not coalesced to default), fixed check-out with NO override → uses `default_daily_pay`, snapshot persists after the employee's `pay_type` later changes, `shift_payroll_records.pay_type` column exists, and an old/pre-migration row defaults to `'hourly'`. → Folded into Tasks 1–4B; **the suite's final `plan(N)` is stated explicitly in Task 11 Step 0** (recount when done; ~26 assertions).

6. **[NIT] Settings user-management stays hourly-only (documented, out of scope).** `src/app/api/users/route.ts:58` and `src/app/api/users/[id]/route.ts:153` only accept/update `hourly_rate`. New employees created there get `pay_type='hourly'` (column default) — no corruption. **To configure a fixed employee, use the Shifts employee-form (Task 8)**; the account-linking flow is unchanged (see [[account-creation-always-links-employee]]). Extending the Settings API to fixed pay is deliberately deferred.

---

## Snapshot semantics (locked decisions — Codex please confirm)

For a **fixed** payroll row written by any RPC:
- `pay_type = 'fixed'` (snapshot on the row).
- `override_pay = <resolved daily amount>` (the number the manager entered, or the resolved default).
- `base_pay = override_pay` (so `base_pay` keeps its meaning "non-allowance pay"; reports summing `total_pay`/`base_pay` are unaffected).
- `hourly_rate = 0` (snapshot 0 → unambiguous that pay did not come from a rate).
- `total_minutes` = worked minutes (still recorded, informational only — **not** used for pay).
- `total_pay = base_pay + allowance_amount`.
- `allowance_amount`: still manually enterable in `check_out_employee` / `edit_shift_payroll_record` (manager may add a bonus). In `check_out_employee_now` it stays 0 (that path never collects allowance).

For an **hourly** payroll row: `pay_type='hourly'`, `override_pay=null`, and every existing field is computed exactly as before (no formula change).

`edit_shift_payroll_record` branches on the **row's snapshot** `pay_type` (`v_record.pay_type`), NOT the employee's current `pay_type`, so editing an old slip stays consistent after the employee switches type. `edit_shift_payroll_record` does **not** change the snapshot `pay_type`.

Resolution precedence for the fixed amount:
- `check_out_employee`: `coalesce((payload->>'override_pay')::numeric, employees.default_daily_pay, 0)`. Note `override_pay = 0` in the payload is honored (0 is not null) — a manager can deliberately pay 0.
- `check_out_employee_now`: `coalesce(employees.default_daily_pay, 0)` (no payload).
- `edit_shift_payroll_record`: `coalesce((payload->>'override_pay')::numeric, v_record.override_pay, 0)`.

---

## Dual-write rule (read before touching SQL)

Every function body that changes must be written **byte-identical** in two places:
1. Canonical: `database/002_functions.sql`.
2. The new dated migration: `database/migrations/2026-06-29-flexible-fixed-pay.sql` (full `create or replace function … $$;` body, not a delta — this matches the convention documented in `database/migrations/2026-06-28-manager-checkout-shift-start.sql:4-5`).

The new migration becomes the newest file redefining these functions, so "newest migration body == canonical 002 body" holds. Write the body once (from this plan), paste it into both files unchanged. `npm run verify:mirror` (`node tools/verify-mirror.mjs`) is a **v3↔v4 aggregate-parity** check that needs a v3 dump + a running app + service key; it is generally **not runnable** in this environment and does not diff function bodies. Do not block on it; the dual-write guarantee is manual byte-identity. The runnable gate is `npm run verify:phase` (Vitest + pgTAP).

---

## File Structure (what changes and why)

**Database**
- `database/001_schema.sql` — add the 4 new columns (idempotent `add column if not exists`) + 4 CHECK constraints (idempotent DO-block, in the existing block near line 738) so a fresh `db:init` has them.
- `database/migrations/2026-06-29-flexible-fixed-pay.sql` — **new.** Idempotent column adds + constraints (mirroring 001) AND full byte-identical bodies of the 4 functions below. This is what existing DBs run.
- `database/002_functions.sql` — update full bodies of `check_out_employee` (`:569`), `edit_shift_payroll_record` (`:616`), `dashboard_daily_ops` active_shifts select (`:356`), `check_out_employee_now` (`:4775`).

**Database tests**
- `database/tests/380_fixed_pay.sql` — **new** pgTAP suite (380 is the next free number; current max is `370_cancel_shift_assignment.sql`).

**Frontend types / data / validation**
- `src/lib/types.ts` — `Employee` += `pay_type`, `default_daily_pay`; `PayrollRecord` += `pay_type`, `override_pay`; `ActiveShiftInput` += `pay_type`.
- `src/lib/labor-cost.ts` — skip accrual for `pay_type === 'fixed'`.
- `src/lib/data/employees.ts` — `select` + create/update include `pay_type`, `default_daily_pay`.
- `src/lib/data/shifts.ts` — payroll `select` includes `pay_type`, `override_pay`; check-out + edit payloads include `override_pay`.
- `src/lib/validation.ts` — `EmployeeInput`/`validateEmployee` += `pay_type`/`default_daily_pay`; `PayrollEditInput` += `override_pay`/`pay_type`; add `limits.dailyPay`.

**Frontend UI**
- `src/features/shifts/employee-form-modal.tsx` — pay-type radio + "Lương ngày mặc định" field.
- `src/features/shifts/check-out-modal.tsx` — fixed → "Lương ngày" input (prefill `default_daily_pay`), total = daily + allowance.
- `src/features/shifts/payroll-edit-modal.tsx` — fixed → edit "Lương ngày" directly.

**Frontend tests**
- `src/lib/__tests__/labor-cost.test.ts` — add a fixed-employee skip case.
- `src/lib/__tests__/validation.test.ts` — add fixed-pay validation cases.
- `src/features/shifts/__tests__/employee-form-modal.test.tsx` — **new.**
- `src/features/shifts/__tests__/check-out-modal.test.tsx` — **new.**
- `src/features/shifts/__tests__/payroll-edit-modal.test.tsx` — **new.**

---

## Verification commands (used throughout)

- Single pgTAP file (dev DB, fast iteration): `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -AtX -f - < database/tests/380_fixed_pay.sql`
  - ⚠️ The dev DB (`supabase-db`) has seed-data collisions for the *full* suite (per project memory), but a single self-contained `begin … rollback` file is fine to run against it for iteration.
- Full pgTAP suite (CI-equivalent, throwaway `chill_pgtap` DB): `npm run pgtap` is the documented runner; trust CI-equivalent results from the throwaway DB rebuild, not the dev DB full run.
- Vitest single file: `npm run test:run -- src/lib/__tests__/labor-cost.test.ts`
- Everything: `npm run verify:phase` (Vitest + pgTAP).
- Do **not** run `npm run build` while `next dev` (port 3009) is running.

---

## Phase 1 — Schema (idempotent columns + constraints)

### Task 1: Add columns + constraints to canonical schema and a new migration

**Files:**
- Modify: `database/001_schema.sql` (employees table area + idempotent constraint DO-block near `:738`)
- Create: `database/migrations/2026-06-29-flexible-fixed-pay.sql`
- Test: `database/tests/380_fixed_pay.sql` (idempotency group)

- [ ] **Step 1: Write the failing pgTAP idempotency test (start the new suite file)**

Create `database/tests/380_fixed_pay.sql` with just the header + idempotency group first:

```sql
-- 380 — Fixed (per-day) pay type: schema idempotency + RPC branching.
-- Throwaway DB (auth-mock + 001 + 002 + 003 + migrations; KHÔNG có 004 seed).
begin;
select plan(3);

-- Columns exist after migration
select has_column('public', 'employees', 'pay_type', 'employees.pay_type exists');
select has_column('public', 'employees', 'default_daily_pay', 'employees.default_daily_pay exists');
select has_column('public', 'shift_payroll_records', 'override_pay', 'shift_payroll_records.override_pay exists');

select * from finish();
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -AtX -f - < database/tests/380_fixed_pay.sql`
Expected: FAIL — `has_column` reports `pay_type`/`override_pay` missing (columns not added yet on dev DB unless the migration already ran). If the dev DB already has them from a prior run, drop them first or trust the throwaway-DB run; the assertion content is what matters.

- [ ] **Step 3: Add the idempotent columns + constraints to `database/001_schema.sql`**

After the `employees` table definition, add idempotent column adds (place near the other `add column if not exists` statements; safe anywhere after the table is created):

```sql
alter table public.employees add column if not exists pay_type text not null default 'hourly';
alter table public.employees add column if not exists default_daily_pay numeric(14,2);
alter table public.shift_payroll_records add column if not exists pay_type text not null default 'hourly';
alter table public.shift_payroll_records add column if not exists override_pay numeric(14,2);
```

Then, inside the existing idempotent constraint `do $$ begin … end $$;` block (the one starting near `database/001_schema.sql:736` that already adds `employees_hourly_rate_check`, `payroll_pay_check`, …), add four guarded constraints:

```sql
  if not exists (select 1 from pg_constraint where conname = 'employees_pay_type_check') then
    alter table public.employees add constraint employees_pay_type_check
      check (pay_type in ('hourly','fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_default_daily_pay_check') then
    alter table public.employees add constraint employees_default_daily_pay_check
      check (default_daily_pay is null or (default_daily_pay >= 0 and default_daily_pay <= 100000000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_pay_type_check') then
    alter table public.shift_payroll_records add constraint payroll_pay_type_check
      check (pay_type in ('hourly','fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_override_pay_check') then
    alter table public.shift_payroll_records add constraint payroll_override_pay_check
      check (override_pay is null or (override_pay >= 0 and override_pay <= 100000000));
  end if;
```

- [ ] **Step 4: Create the migration file with the same idempotent DDL header**

Create `database/migrations/2026-06-29-flexible-fixed-pay.sql`. Top of file = the schema DDL (identical statements to Step 3), each idempotent:

```sql
-- 2026-06-29 — Loại lương "cố định" (per-day) cho nhân viên.
-- Idempotent: chạy lại an toàn. Mỗi function body DƯỚI ĐÂY phải BYTE-IDENTICAL
-- với bản canonical trong database/002_functions.sql (dual-write).

alter table public.employees add column if not exists pay_type text not null default 'hourly';
alter table public.employees add column if not exists default_daily_pay numeric(14,2);
alter table public.shift_payroll_records add column if not exists pay_type text not null default 'hourly';
alter table public.shift_payroll_records add column if not exists override_pay numeric(14,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employees_pay_type_check') then
    alter table public.employees add constraint employees_pay_type_check
      check (pay_type in ('hourly','fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_default_daily_pay_check') then
    alter table public.employees add constraint employees_default_daily_pay_check
      check (default_daily_pay is null or (default_daily_pay >= 0 and default_daily_pay <= 100000000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_pay_type_check') then
    alter table public.shift_payroll_records add constraint payroll_pay_type_check
      check (pay_type in ('hourly','fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_override_pay_check') then
    alter table public.shift_payroll_records add constraint payroll_override_pay_check
      check (override_pay is null or (override_pay >= 0 and override_pay <= 100000000));
  end if;
end $$;

-- (Function bodies appended in Tasks 4–7.)
```

- [ ] **Step 5: Apply the migration to the dev DB and re-run the test**

Run: `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -AtX -f - < database/migrations/2026-06-29-flexible-fixed-pay.sql`
Then re-run the test from Step 2.
Expected: PASS (3/3). Run the migration a **second** time → expect no error (idempotent).

- [ ] **Step 6: Commit**

```bash
git add database/001_schema.sql database/migrations/2026-06-29-flexible-fixed-pay.sql database/tests/380_fixed_pay.sql
git commit -m "feat(payroll): schema for fixed per-day pay type (pay_type, default_daily_pay, override_pay)"
```

---

## Phase 2 — RPC branching (pgTAP-first)

> For each function below: write the pgTAP assertions first, watch them fail, then paste the new body into BOTH `database/002_functions.sql` and `database/migrations/2026-06-29-flexible-fixed-pay.sql`, apply the migration to the dev DB, and re-run. Increase the `plan(N)` count as you add assertions.

### Task 2: `check_out_employee` — fixed branch + hourly non-regression

**Files:**
- Modify: `database/002_functions.sql:569-614` and append to `database/migrations/2026-06-29-flexible-fixed-pay.sql`
- Test: `database/tests/380_fixed_pay.sql`

- [ ] **Step 1: Add the fixture + assertions to `380_fixed_pay.sql`** (raise `plan` accordingly)

Insert the shared fixture once near the top of the suite (after the existing idempotency asserts), then the Group for `check_out_employee`:

```sql
-- ===== Shared fixture: owner + one fixed NV + one hourly NV =====
create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active');

insert into public.employees (id, name, hourly_rate, pay_type, default_daily_pay) values
  ('e0000000-0000-0000-0000-0000000000f1','NV Fixed', 0, 'fixed', 250000),
  ('e0000000-0000-0000-0000-0000000000h1','NV Hourly', 30000, 'hourly', null);

insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f1','e0000000-0000-0000-0000-0000000000f1', current_date, now() - interval '120 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-0000000000h1','e0000000-0000-0000-0000-0000000000h1', current_date, now() - interval '120 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner

-- ===== Group: check_out_employee fixed branch =====
-- Fixed NV: override_pay nhập tay = 300000, allowance 20000 → base=300000, total=320000.
create temp table _f1 as select public.check_out_employee(jsonb_build_object(
  'shift_assignment_id','5a000000-0000-0000-0000-0000000000f1',
  'employee_id','e0000000-0000-0000-0000-0000000000f1',
  'business_date', current_date::text,
  'check_in_at', (now() - interval '120 minutes')::text,
  'check_out_at', now()::text,
  'override_pay', 300000,
  'allowance_amount', 20000)) as r;

select is((select base_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  300000::numeric(14,2), 'fixed: base_pay = override_pay (bỏ giờ×rate)');
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  320000::numeric(14,2), 'fixed: total = override + allowance');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  'fixed', 'fixed: pay_type snapshot = fixed');
select is((select override_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  300000::numeric(14,2), 'fixed: override_pay snapshot');
select is((select hourly_rate from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  0::numeric(14,2), 'fixed: hourly_rate snapshot = 0');
select is((select amount from public.cash_drawer_events
  where shift_payroll_record_id=(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1')
    and event_type='payroll_cash_out'),
  320000::numeric(14,2), 'fixed: payroll_cash_out = total_pay');

-- Hourly NV NON-REGRESSION: 120 phút @ 30000 = 60000, allowance 0 → total 60000.
select public.check_out_employee(jsonb_build_object(
  'shift_assignment_id','5a000000-0000-0000-0000-0000000000h1',
  'employee_id','e0000000-0000-0000-0000-0000000000h1',
  'business_date', current_date::text,
  'check_in_at', (now() - interval '120 minutes')::text,
  'check_out_at', now()::text));
select is((select base_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000h1'),
  60000::numeric(14,2), 'hourly: base_pay = round(2h×30000) không đổi');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000h1'),
  'hourly', 'hourly: pay_type snapshot = hourly');
select is((select override_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000h1'),
  null, 'hourly: override_pay = null');
```

- [ ] **Step 2: Run → expect failure** (columns referenced exist, but RPC does not yet set `pay_type`/`override_pay`, so `pay_type` is the column default `'hourly'` and `override_pay` is null → fixed asserts fail).

Run: `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -AtX -f - < database/tests/380_fixed_pay.sql`
Expected: FAIL on the fixed-branch assertions.

- [ ] **Step 3: Replace the `check_out_employee` body in BOTH files with this exact body**

```sql
create or replace function public.check_out_employee(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_shift uuid := (p_payload->>'shift_assignment_id')::uuid;
  v_employee uuid := (p_payload->>'employee_id')::uuid;
  v_date date := coalesce((p_payload->>'business_date')::date, current_date);
  v_in timestamptz := coalesce((p_payload->>'check_in_at')::timestamptz, now());
  v_out timestamptz := coalesce((p_payload->>'check_out_at')::timestamptz, now());
  v_minutes integer;
  v_rate numeric(14,2);
  v_pay_type text;
  v_default_daily numeric(14,2);
  v_override numeric(14,2) := (p_payload->>'override_pay')::numeric;
  v_base numeric(14,2);
  v_allowance numeric(14,2) := coalesce((p_payload->>'allowance_amount')::numeric, 0);
  v_total numeric(14,2);
  v_snapshot_rate numeric(14,2);
  v_snapshot_override numeric(14,2);
  v_payroll_id uuid;
begin
  if not public.app_is_owner() then raise exception 'Chỉ chủ quán được ra ca hộ. Nhân viên tự ra ca ở màn Chấm công.'; end if;
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;
  if v_out < v_in then raise exception 'Giờ ra không được nhỏ hơn giờ vào.'; end if;
  select hourly_rate, coalesce(pay_type, 'hourly'), default_daily_pay
    into v_rate, v_pay_type, v_default_daily
    from public.employees where id = v_employee;
  v_minutes := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  if v_pay_type = 'fixed' then
    v_base := coalesce(v_override, v_default_daily, 0);
    v_snapshot_rate := 0;
    v_snapshot_override := v_base;
  else
    v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
    v_snapshot_rate := coalesce(v_rate, 0);
    v_snapshot_override := null;
  end if;
  v_total := v_base + v_allowance;

  update public.shift_assignments set check_in_at = v_in, check_out_at = v_out, total_minutes = v_minutes, status = 'checked_out', updated_by = auth.uid() where id = v_shift;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, pay_type, override_pay, note, edited_by, edited_at, created_by)
  values (v_shift, v_employee, v_date, v_in, v_out, v_minutes, v_snapshot_rate, v_base, v_allowance, v_total, v_pay_type, v_snapshot_override, p_payload->>'note', auth.uid(), now(), auth.uid())
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, pay_type = excluded.pay_type, override_pay = excluded.override_pay, note = excluded.note, edited_by = auth.uid(), edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, auth.uid(), 'app_action', 'Lương theo lượt ra ca');
  end if;

  return jsonb_build_object('shift_assignment_id', v_shift, 'payroll_record_id', v_payroll_id, 'total_pay', v_total);
end;
$$;
```

- [ ] **Step 4: Apply migration to dev DB + re-run test**

Run the migration file, then re-run `380_fixed_pay.sql`.
Expected: PASS for all check_out_employee asserts (fixed + hourly).

- [ ] **Step 5: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-29-flexible-fixed-pay.sql database/tests/380_fixed_pay.sql
git commit -m "feat(payroll): check_out_employee branches on fixed pay type"
```

### Task 3: `edit_shift_payroll_record` — edit fixed daily pay, owner-only, final guard

**Files:**
- Modify: `database/002_functions.sql:616-730` and append to migration
- Test: `database/tests/380_fixed_pay.sql`

- [ ] **Step 1: Add assertions** (raise `plan`). Reuse the fixed payroll row created in Task 2 (`5a…f1`). As owner, edit its daily pay up to 280000 with allowance 0 → total 280000. Then assert manager is rejected and the final-day guard holds.

```sql
-- ===== Group: edit_shift_payroll_record fixed =====
-- payroll_record_id for the fixed NV row:
create temp table _fpid as select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1';
select public.edit_shift_payroll_record(jsonb_build_object(
  'payroll_record_id', (select id from _fpid),
  'override_pay', 280000,
  'allowance_amount', 0));
select is((select total_pay from public.shift_payroll_records where id=(select id from _fpid)),
  280000::numeric(14,2), 'edit fixed: sửa Lương ngày → total = override');
select is((select base_pay from public.shift_payroll_records where id=(select id from _fpid)),
  280000::numeric(14,2), 'edit fixed: base_pay = override');
select is((select pay_type from public.shift_payroll_records where id=(select id from _fpid)),
  'fixed', 'edit fixed: pay_type snapshot KHÔNG đổi');

-- manager bị từ chối (owner-only, KHÔNG đổi authz)
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select throws_like(
  $$ select public.edit_shift_payroll_record(jsonb_build_object('payroll_record_id',(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),'override_pay',999000)) $$,
  '%chủ quán%', 'edit_shift_payroll_record vẫn owner-only (manager bị chặn)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
```

- [ ] **Step 2: Run → expect failure** (override not yet honored). Expected: FAIL on "edit fixed" asserts.

- [ ] **Step 3: Apply a MINIMAL DIFF to `edit_shift_payroll_record` in BOTH files** (Codex finding #4 — do NOT paste a rewritten full body; the real tail must be preserved byte-for-byte)

Open `database/002_functions.sql:616-731`. Make exactly these four changes; leave every other line (including the `cash_drawer_events` re-insert with `occurred_at = v_out`, `note = 'Sửa lượt lương đã chốt'`, and the full `return jsonb_build_object('payroll_record_id', …, 'shift_assignment_id', …, …)`) **unchanged**:

1. In the `declare` block, add one local after `v_minutes integer;`:
   ```sql
     v_override numeric(14,2);
   ```
2. Replace the single base-pay line (currently `database/002_functions.sql:673`):
   ```sql
   v_base := round(((v_minutes::numeric / 60) * coalesce(v_record.hourly_rate, 0)) / 1000) * 1000;
   ```
   with the branch:
   ```sql
     if coalesce(v_record.pay_type, 'hourly') = 'fixed' then
       v_override := coalesce((p_payload->>'override_pay')::numeric, v_record.override_pay, 0);
       v_base := v_override;
     else
       v_override := null;
       v_base := round(((v_minutes::numeric / 60) * coalesce(v_record.hourly_rate, 0)) / 1000) * 1000;
     end if;
   ```
3. In the `update public.shift_payroll_records set …` list, add one assignment (e.g. right after `total_pay = v_total,`):
   ```sql
         override_pay = v_override,
   ```
4. Do **not** touch the `v_total := v_base + v_allowance;` line, the `shift_assignments` update, the `cash_drawer_events` delete/insert, or the `return`.

Then copy the resulting full function body verbatim into `database/migrations/2026-06-29-flexible-fixed-pay.sql` (dual-write byte-identity). Diff the two to confirm identical:
```bash
# after editing both, sanity-check the two bodies match (extract-and-compare is manual; eyeball the diff)
git diff -- database/002_functions.sql | grep -A2 -B2 override_pay
```

> **Snapshot note:** this function does **not** write `pay_type` (it edits an existing row and must keep the original snapshot). It only branches on `v_record.pay_type`.

- [ ] **Step 4: Apply migration + re-run.** Expected: PASS for edit asserts (fixed edit + manager-rejected).

- [ ] **Step 5: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-29-flexible-fixed-pay.sql database/tests/380_fixed_pay.sql
git commit -m "feat(payroll): edit_shift_payroll_record edits fixed daily pay (owner-only, snapshot pay_type)"
```

### Task 4: `check_out_employee_now` — fixed fallback to default_daily_pay

**Files:**
- Modify: `database/002_functions.sql:4775-4822` and append to migration
- Test: `database/tests/380_fixed_pay.sql`

- [ ] **Step 1: Add a fixture shift + assertions** (raise `plan`). A second fixed NV (own shift) closed by manager via `check_out_employee_now` → base = `default_daily_pay` (250000), allowance 0, total 250000, `pay_type='fixed'`.

```sql
-- ===== Group: check_out_employee_now fixed fallback =====
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f2','e0000000-0000-0000-0000-0000000000f1', current_date, now() - interval '40 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager (allowed for *_now)
select public.check_out_employee_now('5a000000-0000-0000-0000-0000000000f2'::uuid);
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f2'),
  250000::numeric(14,2), 'now fixed: total = default_daily_pay (bỏ giờ×rate)');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f2'),
  'fixed', 'now fixed: pay_type snapshot = fixed');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- back to owner
```

- [ ] **Step 2: Run → expect failure** (currently computes hours×rate; for NV Fixed `hourly_rate=0` so total would be 0 → asserts fail at 250000).

- [ ] **Step 3: Replace `check_out_employee_now` body in BOTH files**

```sql
create or replace function public.check_out_employee_now(p_shift_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_rate numeric(14,2); v_date date;
  v_pay_type text; v_default_daily numeric(14,2);
  v_in timestamptz; v_out timestamptz := now();
  v_raw integer; v_minutes integer; v_base numeric(14,2); v_total numeric(14,2);
  v_snapshot_rate numeric(14,2); v_snapshot_override numeric(14,2);
  v_payroll_id uuid;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được đóng ca hộ.';
  end if;

  select sa.employee_id, sa.business_date, sa.check_in_at, e.name, e.hourly_rate, coalesce(e.pay_type,'hourly'), e.default_daily_pay
    into v_employee, v_date, v_in, v_name, v_rate, v_pay_type, v_default_daily
    from public.shift_assignments sa join public.employees e on e.id = sa.employee_id
   where sa.id = p_shift_assignment_id and sa.status = 'checked_in';
  if not found then raise exception 'Ca không tồn tại hoặc đã đóng.'; end if;

  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;

  v_raw := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  v_minutes := ((v_raw + 14) / 15) * 15;  -- làm tròn LÊN bội số 15 (tối đa +14)

  update public.shift_assignments
     set check_out_at = v_out, total_minutes = v_minutes, status = 'checked_out', updated_by = auth.uid()
   where id = p_shift_assignment_id and status = 'checked_in';
  if not found then raise exception 'Ca đã được đóng.'; end if;

  if v_pay_type = 'fixed' then
    v_base := coalesce(v_default_daily, 0);
    v_snapshot_rate := 0;
    v_snapshot_override := v_base;
  else
    v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
    v_snapshot_rate := coalesce(v_rate, 0);
    v_snapshot_override := null;
  end if;
  v_total := v_base;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, pay_type, override_pay, note, edited_by, edited_at, created_by)
  values (p_shift_assignment_id, v_employee, v_date, v_in, v_out, v_minutes, v_snapshot_rate, v_base, 0, v_total, v_pay_type, v_snapshot_override, null, auth.uid(), now(), auth.uid())
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, pay_type = excluded.pay_type, override_pay = excluded.override_pay, edited_by = auth.uid(), edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, auth.uid(), 'app_action', 'Lương theo lượt (quản lý đóng ca)');
  end if;

  return jsonb_build_object('shift_assignment_id', p_shift_assignment_id, 'employee_name', v_name,
    'check_out_at', v_out, 'total_minutes', v_minutes, 'total_pay', v_total);
end; $$;
```

- [ ] **Step 4: Apply migration + re-run.** Expected: PASS. Also re-run the existing `database/tests/350_manager_checkout.sql` against the dev DB to confirm hourly `check_out_employee_now` (38000 for 75 min) still passes — **non-regression**.

```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -AtX -f - < database/tests/350_manager_checkout.sql
```
Expected: 13/13 pass.

- [ ] **Step 5: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-29-flexible-fixed-pay.sql database/tests/380_fixed_pay.sql
git commit -m "feat(payroll): check_out_employee_now fixed fallback to default_daily_pay"
```

### Task 4B: `check_out_self` — fixed fallback (Codex BLOCKER #1)

`check_out_self` (`database/002_functions.sql:4701`) is the SERVICE-ROLE self-checkout RPC called by `src/app/api/checkout/route.ts:73`. It computes hours×rate at `:4752`, allowance 0, and (like `_now`) has no manual amount input. A fixed employee self-checking-out must be paid `default_daily_pay`, not hours×rate, and must snapshot `pay_type`/`override_pay`.

**Files:**
- Modify: `database/002_functions.sql:4701-4767` and append full body to the migration
- Test: `database/tests/380_fixed_pay.sql` (and note existing self-checkout coverage lives in `database/tests/330_self_checkout.sql`)

- [ ] **Step 1: Add fixture + assertions** to `380_fixed_pay.sql` (raise `plan`). Seed an `employee_accounts` row for the fixed NV so `check_out_self` can resolve it by `auth_user_id`, plus a checked-in shift, then call `check_out_self` and assert fixed pay.

```sql
-- ===== Group: check_out_self fixed fallback (service-role) =====
-- self-service NV cần employee_accounts để resolve theo auth_user_id.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-0000000000f1','selffix@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-0000000000f1','e0000000-0000-0000-0000-0000000000f1','employee_self_service','active');
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f3','e0000000-0000-0000-0000-0000000000f1', current_date, now() - interval '30 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
-- check_out_self is service-role (guard-internal); call directly in the superuser test session.
select public.check_out_self('a0000000-0000-0000-0000-0000000000f1'::uuid, '203.0.113.9'::inet, 'UA');
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f3'),
  250000::numeric(14,2), 'self fixed: total = default_daily_pay (bỏ giờ×rate)');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f3'),
  'fixed', 'self fixed: pay_type snapshot = fixed');
select is((select override_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f3'),
  250000::numeric(14,2), 'self fixed: override_pay = default snapshot');
```

- [ ] **Step 2: Run → expect failure** (fixed NV has `hourly_rate=0` → current code pays 0, not 250000).

- [ ] **Step 3: Minimal diff to `check_out_self` in BOTH files.** Open `database/002_functions.sql:4701-4767`. Changes:
  1. `declare`: add `v_pay_type text; v_default_daily numeric(14,2); v_snapshot_rate numeric(14,2); v_snapshot_override numeric(14,2);`.
  2. Extend the employee `select` (`:4710-4712`) to also fetch pay type:
     ```sql
       select ea.employee_id, e.name, e.hourly_rate, coalesce(e.pay_type,'hourly'), e.default_daily_pay
         into v_employee, v_name, v_rate, v_pay_type, v_default_daily
         from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
         where ea.auth_user_id = p_auth_user_id and ea.status = 'active' limit 1;
     ```
  3. Replace the base calc (`:4752-4753`):
     ```sql
       if v_pay_type = 'fixed' then
         v_base := coalesce(v_default_daily, 0);
         v_snapshot_rate := 0;
         v_snapshot_override := v_base;
       else
         v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
         v_snapshot_rate := coalesce(v_rate, 0);
         v_snapshot_override := null;
       end if;
       v_total := v_base;
     ```
  4. In the `insert into public.shift_payroll_records (…)` add `pay_type, override_pay` to the column list and `v_pay_type, v_snapshot_override` to `values`; change the `hourly_rate` value from `coalesce(v_rate, 0)` to `v_snapshot_rate`; and add `pay_type = excluded.pay_type, override_pay = excluded.override_pay` to the `on conflict … do update set`.
  Leave the final-close guard, the atomic UPDATE transition, the idempotent already-checked-out branch, the `cash_drawer_events` delete/insert (note `'Lương theo lượt TỰ ra ca'`), the `return`, and the `revoke/grant` lines unchanged. Copy the full resulting body into the migration (dual-write).

- [ ] **Step 4: Apply migration + re-run.** Expected: PASS. Also re-run `database/tests/330_self_checkout.sql` for hourly non-regression:
  ```bash
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -AtX -f - < database/tests/330_self_checkout.sql
  ```

- [ ] **Step 5: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-29-flexible-fixed-pay.sql database/tests/380_fixed_pay.sql
git commit -m "feat(payroll): check_out_self fixed fallback to default_daily_pay"
```

---

## Phase 3 — Realtime labor cost skips fixed (Vitest-first)

### Task 5: `dashboard_daily_ops` emits pay_type; `computeLiveLaborCost` skips fixed

**Files:**
- Modify: `database/002_functions.sql:356` (active_shifts select) + append the full `dashboard_daily_ops` body to the migration
- Modify: `src/lib/types.ts` (`ActiveShiftInput`)
- Modify: `src/lib/labor-cost.ts`
- Test: `src/lib/__tests__/labor-cost.test.ts`

- [ ] **Step 1: Add a failing Vitest case** to `src/lib/__tests__/labor-cost.test.ts`:

```ts
it("fixed NV (pay_type='fixed') → KHÔNG accrual khi ca đang mở", () => {
  expect(
    computeLiveLaborCost({
      finalizedTotal: 100_000,
      activeShifts: [
        { check_in_at: checkInMinutesAgo(180), hourly_rate: 30_000, pay_type: "fixed" },
        { check_in_at: checkInMinutesAgo(60), hourly_rate: 25_000, pay_type: "hourly" },
      ],
      now: NOW,
      bonusConfig: BONUS,
    })
  ).toBe(100_000 + Math.round((1 * 25_000) / 1000) * 1000); // chỉ hourly NV accrue
});
```

- [ ] **Step 2: Run → expect failure**

Run: `npm run test:run -- src/lib/__tests__/labor-cost.test.ts`
Expected: FAIL (fixed shift currently accrues 30000×3 = 90000).

- [ ] **Step 3: Add `pay_type` to `ActiveShiftInput` and skip in the loop**

In `src/lib/labor-cost.ts`, extend the interface and the loop:

```ts
export interface ActiveShiftInput {
  /** ISO timestamp lúc vào ca. */
  check_in_at: string;
  /** Đơn giá giờ của nhân viên (VND). */
  hourly_rate: number;
  /** Loại lương; 'fixed' KHÔNG tích lũy real-time (chỉ vào total_pay sau khi ra ca). */
  pay_type?: "hourly" | "fixed";
}
```

Inside the `for` loop, before computing, add:

```ts
  for (const shift of activeShifts ?? []) {
    if (shift.pay_type === "fixed") continue; // NV cố định: 0 khi ca đang mở
    const checkInMs = new Date(shift.check_in_at).getTime();
    // ... unchanged
  }
```

- [ ] **Step 4: Run → expect pass.** Run the same command. Expected: PASS (existing cases still green — `pay_type` is optional, undefined ⇒ hourly path).

- [ ] **Step 5: Update the DB `active_shifts` select (canonical + migration full body)**

In `database/002_functions.sql:356`, change the `jsonb_build_object` to include pay_type:

```sql
  select coalesce(jsonb_agg(jsonb_build_object('check_in_at', sa.check_in_at, 'hourly_rate', coalesce(e.hourly_rate, 0), 'pay_type', coalesce(e.pay_type, 'hourly')) order by sa.check_in_at), '[]'::jsonb)
  into v_active_shifts
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.business_date = p_business_date
    and sa.status = 'checked_in'
    and sa.check_out_at is null
    and sa.check_in_at is not null;
```

Append the **full** updated `dashboard_daily_ops` body (`database/002_functions.sql:320-384`, with only the line above changed) to `database/migrations/2026-06-29-flexible-fixed-pay.sql`. (Dual-write: copy the entire current body verbatim and swap that single select line.)

- [ ] **Step 6: Apply migration to dev DB; sanity-check the JSON shape**

```bash
docker exec -i supabase-db psql -U postgres -d postgres -At -c "select public.dashboard_daily_ops(current_date)->'active_shifts';"
```
Expected: each element now has a `pay_type` key (no error). (Owner JWT not required for shape check via superuser session.)

- [ ] **Step 7: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-29-flexible-fixed-pay.sql src/lib/labor-cost.ts src/lib/types.ts src/lib/__tests__/labor-cost.test.ts
git commit -m "feat(dashboard): exclude fixed NV from realtime labor accrual"
```

---

## Phase 4 — Types, data layer, validation

### Task 6: Extend `Employee` / `PayrollRecord` types + data layer selects/payloads

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/data/employees.ts`
- Modify: `src/lib/data/shifts.ts`
- Modify: `src/hooks/mutations/use-shift-mutations.ts` (Codex BLOCKER #2 — hook interfaces + upsert payload drop new fields otherwise)

- [ ] **Step 1: Extend types in `src/lib/types.ts`**

`Employee` (after `hourly_rate`):

```ts
export type Employee = {
  id: string;
  code: string | null;
  name: string;
  position: string | null;
  hourly_rate: number; // VND per hour
  pay_type: "hourly" | "fixed";
  default_daily_pay: number | null; // VND, gợi ý prefill cho NV fixed
  is_active: boolean;
};
```

`PayrollRecord` (after `total_pay`):

```ts
  total_pay: number; // base_pay + allowance_amount
  pay_type: "hourly" | "fixed"; // snapshot lúc ra ca
  override_pay: number | null; // "Lương ngày" NV fixed (null cho hourly)
```

- [ ] **Step 2: Update `src/lib/data/employees.ts`**

`loadEmployees` select → add columns:

```ts
    .select("id, code, name, position, hourly_rate, pay_type, default_daily_pay, is_active");
```

`createEmployee` payload type + insert:

```ts
export async function createEmployee(
  supabase: SupabaseClient,
  payload: Pick<Employee, "name" | "position" | "hourly_rate" | "pay_type" | "default_daily_pay">
) {
  const { data, error } = await supabase
    .from("employees")
    .insert({
      name: payload.name,
      position: payload.position,
      hourly_rate: payload.hourly_rate,
      pay_type: payload.pay_type,
      default_daily_pay: payload.default_daily_pay,
      is_active: true,
    })
    .select("id")
    .single();
  if (error) throw toAppError(error, "Không tạo được nhân viên.");
  return data;
}
```

`updateEmployee` payload type:

```ts
  payload: Partial<Pick<Employee, "name" | "position" | "hourly_rate" | "pay_type" | "default_daily_pay" | "is_active">>
```

- [ ] **Step 3: Update `src/lib/data/shifts.ts`** — payroll select adds `pay_type, override_pay`; check-out and edit payload builders forward `override_pay` (number | null/undefined). Open the file, find the payroll `.select(...)` and the two RPC payload constructions (`check_out_employee`, `edit_shift_payroll_record`) and add `override_pay` to the jsonb passed (only include when present). Show the implementer the exact select string after editing matches the `PayrollRecord` columns.

- [ ] **Step 3B: Update `src/hooks/mutations/use-shift-mutations.ts`** (Codex BLOCKER #2). Three interfaces + one payload construction currently drop the new fields:

`CheckOutInput` (`:57`) — add optional override:
```ts
export interface CheckOutInput {
  shift_assignment_id: string;
  employee_id: string;
  business_date: string;
  check_in_at: string;
  check_out_at: string;
  allowance_amount: number;
  note: string;
  override_pay?: number; // set for fixed NV; undefined for hourly
}
```

`UpdatePayrollInput` (`:87`) — add optional override:
```ts
export interface UpdatePayrollInput {
  payroll_record_id: string;
  check_in_at: string;
  check_out_at: string;
  allowance_amount: number;
  note: string;
  override_pay?: number; // set for fixed NV
}
```

`UpsertEmployeeInput` (`:112`) + the payload block (`:128-133`) — add pay fields and forward them:
```ts
export interface UpsertEmployeeInput {
  id?: string;
  name: string;
  position: string;
  hourly_rate: number;
  pay_type: "hourly" | "fixed";
  default_daily_pay: number | null;
  is_active: boolean;
}
// …inside mutationFn:
      const payload = {
        name: input.name,
        position: input.position,
        hourly_rate: input.hourly_rate,
        pay_type: input.pay_type,
        default_daily_pay: input.default_daily_pay,
        is_active: input.is_active,
      };
```

(The check-out/edit hooks pass `input` straight through as `Record<string, unknown>`, so once `override_pay` is on the interface and the data layer forwards it, no further change is needed there.)

- [ ] **Step 4: Typecheck**

Run: `npm run test:run -- src/lib/__tests__/labor-cost.test.ts` (cheap compile smoke) and, if available, `npx tsc --noEmit`.
Expected: no type errors from the new fields.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/lib/data/employees.ts src/lib/data/shifts.ts src/hooks/mutations/use-shift-mutations.ts
git commit -m "feat(data): surface pay_type/default_daily_pay/override_pay through types, data layer, mutation hooks"
```

### Task 7: Validation for fixed pay

**Files:**
- Modify: `src/lib/validation.ts`
- Test: `src/lib/__tests__/validation.test.ts`

- [ ] **Step 1: Add failing validation tests** to `src/lib/__tests__/validation.test.ts`:

```ts
describe("validateEmployee fixed pay", () => {
  it("fixed với default_daily_pay hợp lệ → ok", () => {
    expect(validateEmployee({ name: "A", hourly_rate: 0, pay_type: "fixed", default_daily_pay: 250000 }).ok).toBe(true);
  });
  it("fixed với default_daily_pay âm → fail", () => {
    expect(validateEmployee({ name: "A", hourly_rate: 0, pay_type: "fixed", default_daily_pay: -1 }).ok).toBe(false);
  });
  it("hourly không cần default_daily_pay → ok", () => {
    expect(validateEmployee({ name: "A", hourly_rate: 30000, pay_type: "hourly", default_daily_pay: null }).ok).toBe(true);
  });
});
```

(Confirm the `ValidationResult` shape — the codebase uses `ok()`/`fail()`; assert on the actual returned property, e.g. `.ok` or `.valid`. Match `src/lib/validation.ts`.)

- [ ] **Step 2: Run → expect failure / type error** (EmployeeInput lacks `pay_type`).

Run: `npm run test:run -- src/lib/__tests__/validation.test.ts`

- [ ] **Step 3: Extend `EmployeeInput` + `validateEmployee` + `limits`**

```ts
export type EmployeeInput = {
  name: string;
  hourly_rate: number;
  pay_type: "hourly" | "fixed";
  default_daily_pay: number | null;
};

export function validateEmployee(input: EmployeeInput): ValidationResult {
  if (!input.name?.trim()) return fail("name", "Tên nhân viên không được để trống.");
  if (input.name.length > 200) return fail("name", "Tên nhân viên tối đa 200 ký tự.");
  if (input.pay_type !== "hourly" && input.pay_type !== "fixed")
    return fail("pay_type", "Loại lương không hợp lệ.");
  if (input.pay_type === "hourly") {
    if (!inRange(input.hourly_rate, limits.hourlyRate))
      return fail("hourly_rate", `Lương theo giờ phải từ ${limits.hourlyRate.min} đến ${limits.hourlyRate.max}.`);
  }
  if (input.default_daily_pay != null && !inRange(input.default_daily_pay, limits.dailyPay))
    return fail("default_daily_pay", `Lương ngày phải từ ${limits.dailyPay.min} đến ${limits.dailyPay.max}.`);
  return ok();
}
```

Add `dailyPay: { min: 0, max: 100000000 }` to the `limits` object. Also extend `PayrollEditInput` with `pay_type?: "hourly" | "fixed"` and `override_pay?: number | null`, and in `validatePayrollEdit`, when `pay_type === "fixed"`, validate `override_pay` (if provided) against `limits.dailyPay` and **skip** the check_in/out ordering requirement only if the UI omits times (keep time validation if times are present).

- [ ] **Step 4: Run → expect pass.** Expected: PASS, plus existing validation tests still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validation.ts src/lib/__tests__/validation.test.ts
git commit -m "feat(validation): fixed pay type + default daily pay bounds"
```

---

## Phase 5 — UI (component-test-first)

> These modals use plain `useState` and call the data layer via TanStack Query hooks (`use-shift-mutations.ts`). Tests use `@testing-library/react`; mock the mutation hooks like the existing `src/features/shifts/__tests__/*.test.tsx` do.

### Task 8: Employee form — pay-type selector + default daily pay

**Files:**
- Modify: `src/features/shifts/employee-form-modal.tsx`
- Test: `src/features/shifts/__tests__/employee-form-modal.test.tsx` (new)

- [ ] **Step 1: Write component test** — render in create mode, switch pay type to "Cố định", assert the "Lương theo giờ" field is replaced/hidden and "Lương ngày mặc định" appears; fill it; submit; assert the mutation is called with `pay_type: "fixed"` and `default_daily_pay: <value>`. (Follow the mock pattern in `src/features/shifts/__tests__/shifts-view.test.tsx`.)

- [ ] **Step 2: Run → fail** (`npm run test:run -- src/features/shifts/__tests__/employee-form-modal.test.tsx`).

- [ ] **Step 3: Implement** — add `payType` + `defaultDailyPay` state (init from `employee?.pay_type ?? "hourly"` / `employee?.default_daily_pay`). Add a radio/segmented control ("Theo giờ" / "Cố định"). When `payType === "fixed"`: hide the hourly-rate input (or relabel) and show a "Lương ngày mặc định" number input. Build the mutation payload with `pay_type` + `default_daily_pay` (null when hourly). Run `validateEmployee` before submit.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/employee-form-modal.tsx src/features/shifts/__tests__/employee-form-modal.test.tsx
git commit -m "feat(ui): employee form pay-type selector + default daily pay"
```

### Task 9: Check-out modal — "Lương ngày" for fixed employees

**Files:**
- Modify: `src/features/shifts/check-out-modal.tsx`
- Test: `src/features/shifts/__tests__/check-out-modal.test.tsx` (new)

- [ ] **Step 1: Write component test** — render with a `fixed` employee (`pay_type:"fixed", default_daily_pay:250000`); assert a "Lương ngày" input is shown prefilled 250000 (not the hours×rate block); change to 300000, set allowance 20000; assert displayed total = 320000; submit; assert the check-out mutation payload has `override_pay: 300000`, `allowance_amount: 20000`. Add a second test: an `hourly` employee shows the existing hours×rate UI and submits **without** `override_pay`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — branch on `employee.pay_type`. For fixed: replace the `basePay` useMemo with `dailyPay` state (init `employee.default_daily_pay ?? 0`), `total = dailyPay + allowanceAmount`; render a "Lương ngày" number input instead of the "Tổng giờ / Lương giờ" rows (keep "Giờ vào/Giờ ra" + "Bồi dưỡng" + "Ghi chú"). Add `override_pay: dailyPay` to the mutation payload only for fixed. Hourly path unchanged.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/check-out-modal.tsx src/features/shifts/__tests__/check-out-modal.test.tsx
git commit -m "feat(ui): check-out modal fixed daily pay input"
```

### Task 9B: Open-shift "force close" modal — show fixed daily pay (Codex SHOULD #3)

`src/features/shifts/close-shift-modal.tsx` is the manager/owner "đóng ca hộ" surface; it calls `check_out_employee_now` (Task 4). Because `_now` takes no amount argument, this modal cannot collect an override without changing the RPC signature (which would break the dual-write mirror + the `350` fixture — see the Round-1 note). So the fix is display-only: stop showing a misleading hourly figure for fixed employees and show the resolved fixed daily pay instead; managers who need a different amount edit the slip afterward (owner-only, Task 10).

**Files:**
- Modify: `src/lib/data/shifts.ts` (`OpenShift` type + `loadOpenShifts` select `:23`)
- Modify: `src/lib/types.ts` (if `OpenShift`/`CloseShiftTarget` types live there)
- Modify: `src/features/shifts/shifts-view.tsx` and `src/features/shifts/open-shifts-table.tsx` — **the intermediary components that build/pass `CloseShiftTarget`** (Codex Round-2 FIX: without these, `pay_type`/`default_daily_pay` loaded by `loadOpenShifts` are dropped before reaching `CloseShiftModal`)
- Modify: `src/features/shifts/close-shift-modal.tsx`
- Test: `src/features/shifts/__tests__/close-shift-modal.test.tsx` (new, if a test file does not already exist; otherwise extend it)

- [ ] **Step 1: Write/extend component test** — render `CloseShiftModal` for a fixed open shift (`pay_type:"fixed", default_daily_pay:250000`); assert it displays the fixed daily pay (250000) and does **not** show an hours×rate estimate; confirm submit still calls the `check_out_employee_now` mutation with just the shift id. Hourly open shift: unchanged display.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — add `pay_type` + `default_daily_pay` to the `OpenShift` type and the `loadOpenShifts` select (`src/lib/data/shifts.ts:23`); add the same two fields to `CloseShiftTarget` and forward them in `src/features/shifts/shifts-view.tsx` and `src/features/shifts/open-shifts-table.tsx` where the `CloseShiftTarget` is constructed and `CloseShiftModal` is rendered (Codex Round-2 FIX — grep `CloseShiftTarget` and the modal's props to find every drop point); in `close-shift-modal.tsx` branch on `pay_type`: for fixed, render "Lương ngày (cố định): {default_daily_pay}" as read-only info (with a hint that the amount can be adjusted afterward via phiếu lương) instead of the hourly estimate. Submit path unchanged.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/shifts.ts src/lib/types.ts src/features/shifts/shifts-view.tsx src/features/shifts/open-shifts-table.tsx src/features/shifts/close-shift-modal.tsx src/features/shifts/__tests__/close-shift-modal.test.tsx
git commit -m "feat(ui): open-shift close modal shows fixed daily pay"
```

### Task 10: Payroll-edit modal — edit "Lương ngày" for fixed rows (owner-only)

**Files:**
- Modify: `src/features/shifts/payroll-edit-modal.tsx`
- Test: `src/features/shifts/__tests__/payroll-edit-modal.test.tsx` (new)

- [ ] **Step 1: Write component test** — render with a `fixed` PayrollRecord (`pay_type:"fixed", override_pay:280000`); assert a "Lương ngày" input prefilled 280000; change to 260000; assert total updates; submit; assert the edit mutation payload includes `override_pay: 260000`. Second test: hourly record shows the existing hours×rate edit UI and submits without `override_pay`.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — branch on `payroll.pay_type`. For fixed: `overridePay` state init `payroll.override_pay ?? 0`; total = `overridePay + allowance`; render "Lương ngày" input replacing the hours/rate rows; payload `override_pay`. Hourly path unchanged. No authz change in the component (it is already only reachable by owner; do not loosen).

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/payroll-edit-modal.tsx src/features/shifts/__tests__/payroll-edit-modal.test.tsx
git commit -m "feat(ui): payroll-edit modal fixed daily pay (owner-only)"
```

---

## Phase 6 — Full verification

### Task 11: Run the whole gate + manual smoke

- [ ] **Step 0: Recount `plan(N)` in `380_fixed_pay.sql`.** Count every `select is/ok/throws_like/has_column(...)` assertion actually written across all groups (schema idempotency, `check_out_employee` fixed+hourly, edit fixed+manager-denied, `_now` fixed, `check_out_self` fixed, plus the Codex #5 edge cases: `override_pay=0`, fixed-without-override→default, snapshot-persists-after-`pay_type`-change, `has_column pay_type`, old-row default `'hourly'`). Set `plan(N)` to the exact count (≈26). A mismatch fails the suite — this is the last thing to reconcile before running.

- [ ] **Step 1: Full pgTAP suite (CI-equivalent throwaway DB).** Run `npm run pgtap`. Expected: all suites pass, including new `380_fixed_pay.sql` and unchanged `330/340/350/250`. If the dev-DB run shows the known ~13 false fails from seed collisions, trust the throwaway `chill_pgtap` rebuild instead (per project memory).

- [ ] **Step 2: Vitest.** Run `npm run test:run`. Expected: all green (labor-cost, validation, 3 new modal tests).

- [ ] **Step 3: Combined gate.** Run `npm run verify:phase`. Expected: exits 0.

- [ ] **Step 4: `verify:mirror` note.** Attempt `npm run verify:mirror` only if a v3 mirror + running app + service key are available; otherwise record that it is N/A in this environment and that dual-write byte-identity was maintained by construction. Spot-check by diffing the canonical body vs the migration body for each of the **5** functions (`check_out_employee`, `check_out_employee_now`, `check_out_self`, `edit_shift_payroll_record`, `dashboard_daily_ops`) — they must match.

- [ ] **Step 5: Manual smoke (optional, owner login at port 3009, dev already running).** Create a "Cố định" employee with default 250k; check them in; check out → enter 300k → confirm cash drawer payroll_cash_out = 300k+allowance; edit the slip down to 280k → confirm drawer updates; confirm an hourly employee is unchanged; confirm the dashboard live labor cost does not climb for the open fixed shift.

- [ ] **Step 6: Final commit / branch finish.** Use `superpowers:finishing-a-development-branch` to open the PR into `main`.

---

## Self-Review (against spec `2026-06-24-flexible-fixed-pay-employee-design.md`)

| Spec requirement | Covered by |
|---|---|
| `employees.pay_type` not null default 'hourly' check ('hourly','fixed') | Task 1 |
| `employees.default_daily_pay numeric null` | Task 1 |
| `shift_payroll_records.override_pay numeric null` | Task 1 |
| Snapshot `pay_type` onto payroll row | Task 1 (column) + Tasks 2/4/4B (write) + Task 3 (read on edit) |
| `check_out_employee` fixed branch (base = coalesce(override, default, 0), skip hours, skip hourly bonus) | Task 2 |
| `edit_shift_payroll_record` fixed branch, owner+manager **→ corrected to owner-only (Finding 1, Codex-confirmed)** | Task 3 |
| Both still write `total_pay` → `payroll_cash_out` + final guard | Tasks 2/3 (asserts) |
| Hourly unchanged / non-regression | Tasks 2 (assert) + 4 (350 re-run) + 4B (330 re-run) |
| Migration idempotent; old NV = hourly | Task 1 (+ Codex #5 edge asserts) |
| Dual-write 002 + migration | "Dual-write rule" + Tasks 2/3/4/4B/5 |
| Form NV: pay-type selector + default daily | Task 8 |
| Check-out modal: "Lương ngày" for fixed | Task 9 |
| Payroll-edit modal: edit "Lương ngày" | Task 10 |
| Realtime labor-cost skips fixed (forward note — **in scope on this branch**) | Task 5 |
| Reports/ledger unchanged (sum total_pay) | No change needed (verified: `payroll_summary_by_employee:3932`, period-close read only `total_pay`; `total_minutes` still accurate) |
| pgTAP + Vitest green | Phase 6 |
| **Beyond spec (Codex-confirmed):** `check_out_employee_now` fixed (Finding 2) | Task 4 |
| **Codex BLOCKER #1:** `check_out_self` fixed (5th payroll writer) | Task 4B |
| **Codex BLOCKER #2:** mutation-hook interfaces/payload | Task 6 (Step 3B) |
| **Codex SHOULD #3:** open-shift close modal display | Task 9B |
| **Codex #5:** pgTAP edge cases + explicit `plan(N)` | Tasks 1–4B + Task 11 Step 0 |
| **Codex NIT #6 / Out of scope:** Settings `/api/users` stays hourly-only; % revenue auto; per-product commission | Documented, not implemented |

**Codex status: GO (Round 2 passed 2026-07-01).** Round 1: all 6 findings incorporated; Findings 1 & 2 confirmed correct. Round 2 verdict on the revised plan:
- check_out_self minimal diff — **OK**, no bug.
- Task 3 minimal diff preserves the real tail (`occurred_at=v_out`, note, full return) — **OK**.
- Mutation-hook / data-layer field forwarding — **OK**, nothing dropped for the normal check-out/edit/upsert paths.
- Task 9B — display-only is the right call (do NOT change `check_out_employee_now` signature); **fixed applied**: also thread `pay_type`/`default_daily_pay` through `shifts-view.tsx` + `open-shifts-table.tsx` (they build `CloseShiftTarget`), else the fields drop before `CloseShiftModal`.
- (a) snapshot `base_pay=override_pay`, `hourly_rate=0` — harmless for all readers found. (b) bound `100000000` consistent with `limits.dailyPay.max` — confirmed.

The single Round-2 FIX (Task 9B intermediary components) is now folded into Task 9B's Files + Step 3. Plan is cleared for implementation.
