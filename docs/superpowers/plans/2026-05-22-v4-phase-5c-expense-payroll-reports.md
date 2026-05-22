# Phase 5.C — Expense + Payroll Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5.A's "Chi phí + lương" placeholder tab with 2 multi-day aggregations — Expense by Category (3-col) + Payroll by Employee (4-col with hours) — driven by the shared `DateRangePicker`.

**Architecture:** 2 STABLE read-only RPCs aggregate `expenses + expense_categories` and `shift_payroll_records + employees` by `business_date BETWEEN p_from AND p_to`. Both feed a tab composition mirroring 5.A/5.B (single `useState<DateRange>` drives both tables). ReportsView's `expense_payroll` placeholder swaps to `<ExpensePayrollTab />`. Existing ExpensesView + ShiftsView untouched.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Tailwind v4 · Radix Tabs (existing 5.A wrapper) · TanStack Query 5 · Supabase JS (RPC) · pgTAP via in-container psql · Vitest 2.1.9.

**Spec:** `docs/superpowers/specs/2026-05-22-v4-phase-5c-expense-payroll-reports-design.md`
**Branch:** `phase-5c-expense-payroll-reports` (already created off `main` @ tag `v4-phase-5b`)
**Tag at end:** `v4-phase-5c`
**Final verify target:** 75 Vitest + 120 pgTAP = 195 green

---

## File Manifest

### 5 new files
| Path | Lines (est) | Created in |
|------|-------------|------------|
| `database/tests/180_expense_payroll_reports.sql` | ~210 | T1 |
| `src/hooks/queries/use-expense-payroll-reports-query.ts` | ~50 | T2 |
| `src/features/reports/expense-by-category-table.tsx` | ~100 | T3 |
| `src/features/reports/payroll-summary-table.tsx` | ~115 | T4 |
| `src/features/reports/expense-payroll-tab.tsx` | ~30 | T5 |

### 5 modified files
| Path | Change | Touched in |
|------|--------|------------|
| `database/002_functions.sql` | Append 2 RPCs at EOF (currently 3215 lines) | T1 |
| `src/lib/data/reports.ts` | Append 2 wrapper functions + 2 row interfaces (currently 176 lines) | T2 |
| `src/hooks/queries/keys.ts` | Append 2 keys inside `queryKeys` object (currently 53 lines) | T2 |
| `src/hooks/queries/index.ts` | Re-export new hook file | T2 |
| `src/features/reports/reports-view.tsx` | Swap `expense_payroll` placeholder for `<ExpensePayrollTab />` + add import | T6 |

### Off-limits (DO NOT TOUCH)
- `database/001_schema.sql` — no schema changes
- `database/003_rls.sql` — existing RLS on expenses / expense_categories / shift_payroll_records / employees allows SELECT for authenticated
- `src/lib/types.ts` — row interfaces stay in the data layer file
- `src/features/expenses/**` — existing ExpensesView untouched
- `src/features/shifts/**` — existing ShiftsView untouched
- All Phase 2/3/4/5.A/5.B primitives and modules

---

## Conventions reminder (apply to every commit)

1. **Vietnamese diacritics break PowerShell here-strings in compound commands.** Always write commit body to `.git/COMMIT_MSG_TMP` first via `Out-File -Encoding utf8`, then `git commit -F`, then `Remove-Item`. The pattern appears verbatim in every commit step below.
2. **Every commit message MUST end with:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
3. **NO modifications to v3 production code, Supabase containers, or `.env` files.**
4. **`.gitignored` files stay gitignored.**

---

## Task 1: Backend RPCs + pgTAP (`180_expense_payroll_reports.sql`)

**Files:**
- Modify: `database/002_functions.sql` — append 2 new RPCs at EOF (currently line 3215)
- Create: `database/tests/180_expense_payroll_reports.sql` (10 pgTAP assertions)

### - [ ] Step 1: Append both RPCs to `database/002_functions.sql`

Open `database/002_functions.sql` and append at the very end:

```sql

-- =====================================================================
-- Phase 5.C — Expense + payroll reports
-- =====================================================================

-- Expense aggregation by category over a date range.
-- LEFT JOIN because expenses.category_id is nullable — a NULL row
-- surfaces as its own bucket displayed as "Chưa phân loại" in UI.
-- No is_active filter on categories — historical expenses against
-- deactivated categories must surface.
create or replace function public.expense_summary_by_category(
  p_from date,
  p_to   date
) returns table (
  category_id    uuid,
  category_name  text,
  total_amount   numeric,
  expense_count  int
)
language sql
stable
set search_path = public
as $$
  select
    e.category_id,
    c.name                       as category_name,
    sum(e.amount)::numeric       as total_amount,
    count(*)::int                as expense_count
  from public.expenses e
  left join public.expense_categories c on c.id = e.category_id
  where e.business_date >= p_from
    and e.business_date <= p_to
  group by e.category_id, c.name
  order by total_amount desc;
$$;

-- Payroll aggregation by employee over a date range.
-- INNER JOIN — schema enforces shift_payroll_records.employee_id NOT NULL.
-- Returns total_minutes as 5th column for "hours worked" display
-- (formatted client-side as "8 giờ 25").
-- No is_active filter on employees — historical pay records for
-- now-inactive employees must surface.
create or replace function public.payroll_summary_by_employee(
  p_from date,
  p_to   date
) returns table (
  employee_id    uuid,
  employee_name  text,
  total_pay      numeric,
  shift_count    int,
  total_minutes  int
)
language sql
stable
set search_path = public
as $$
  select
    p.employee_id,
    e.name                       as employee_name,
    sum(p.total_pay)::numeric    as total_pay,
    count(*)::int                as shift_count,
    sum(p.total_minutes)::int    as total_minutes
  from public.shift_payroll_records p
  join public.employees e on e.id = p.employee_id
  where p.business_date >= p_from
    and p.business_date <= p_to
  group by p.employee_id, e.name
  order by total_pay desc;
$$;
```

Notes:
- Both `STABLE` (PostgREST cacheable), NOT `SECURITY DEFINER` — relies on existing RLS for SELECT.
- `set search_path = public` matches codebase convention.
- `count(*)::int` (not `bigint`) — supabase-js returns bigint as JS string. Same defense as 5.A T2 / 5.B T1 fixes.
- `business_date >= p_from AND business_date <= p_to` (NOT `BETWEEN`) for consistency with 5.A/5.B style.

### - [ ] Step 2: Apply schema changes

```powershell
node scripts/db-init.mjs
```
Expected: schema/functions applied with no error.

### - [ ] Step 3: Sanity check the RPCs respond

```powershell
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select public.expense_summary_by_category(current_date - interval '7 days', current_date);"
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select public.payroll_summary_by_employee(current_date - interval '7 days', current_date);"
```
Expected: 0 rows back, no error.

### - [ ] Step 4: Create the pgTAP test file

Create `database/tests/180_expense_payroll_reports.sql`:

```sql
-- Phase 5.C — Expense + payroll reports.
--
-- 10 assertions (top-level SELECT pattern):
--   expense_summary_by_category (5):
--     1. Empty range returns 0 rows
--     2. sum(amount) correct across multiple expenses in same category
--     3. expense_count = count(*) per category
--     4. NULL category_id produces its own row with category_name = NULL
--     5. Sort is ORDER BY total_amount DESC (verified via limit 1)
--
--   payroll_summary_by_employee (5):
--     6. Empty range returns 0 rows
--     7. sum(total_pay) correct across multiple shifts for same employee
--     8. shift_count = count(*) per employee
--     9. sum(total_minutes) correct across shifts
--    10. Sort is ORDER BY total_pay DESC (verified via limit 1)

begin;
select plan(10);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- ==================================================================
-- expense_summary_by_category tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 1: empty range returns 0 rows (expense)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.expense_summary_by_category(
     current_date - 30, current_date - 29)),
  0,
  'expense: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Tests 2 + 3: sum(amount) + expense_count across multiple rows
-- ------------------------------------------------------------------
-- Create 2 categories: Rent + Utilities
-- Insert 3 expenses against Rent: 5000000, 3000000, 2000000 → sum 10000000, count 3
-- Insert 1 expense against Utilities: 800000 → sum 800000, count 1
create temp table _t_cat_rent (id uuid);
create temp table _t_cat_util (id uuid);
insert into _t_cat_rent select id from public.expense_categories
  where false;  -- create empty; will fill via direct insert
insert into public.expense_categories (name, sort_order) values ('Rent T180', 100) returning id;
update _t_cat_rent set id = (select id from public.expense_categories where name = 'Rent T180');

insert into public.expense_categories (name, sort_order) values ('Utilities T180', 110) returning id;
update _t_cat_util set id = (select id from public.expense_categories where name = 'Utilities T180');

-- Simpler insert pattern (the temp-table dance above is awkward; use direct CTE)
truncate _t_cat_rent;
truncate _t_cat_util;
with r as (
  insert into public.expense_categories (name, sort_order) values ('Rent T180-v2', 100) returning id
)
insert into _t_cat_rent select id from r;
with u as (
  insert into public.expense_categories (name, sort_order) values ('Utilities T180-v2', 110) returning id
)
insert into _t_cat_util select id from u;

-- Insert expenses
insert into public.expenses (business_date, category_id, description, amount)
values
  (current_date - 1, (select id from _t_cat_rent), 'Rent expense 1', 5000000),
  (current_date - 1, (select id from _t_cat_rent), 'Rent expense 2', 3000000),
  (current_date - 1, (select id from _t_cat_rent), 'Rent expense 3', 2000000),
  (current_date - 1, (select id from _t_cat_util), 'Util expense 1', 800000);

-- Test 2: sum(amount) for Rent T180-v2 = 10000000
select is(
  (select total_amount from public.expense_summary_by_category(
     current_date - 2, current_date)
   where category_id = (select id from _t_cat_rent)),
  10000000::numeric,
  'expense: sum(amount) across 3 rent expenses = 10000000'
);

-- Test 3: expense_count for Rent T180-v2 = 3
select is(
  (select expense_count from public.expense_summary_by_category(
     current_date - 2, current_date)
   where category_id = (select id from _t_cat_rent)),
  3::int,
  'expense: expense_count = count(*) per category = 3'
);

-- ------------------------------------------------------------------
-- Test 4: NULL category_id produces its own row
-- ------------------------------------------------------------------
-- Insert an expense with NULL category
insert into public.expenses (business_date, category_id, description, amount)
values
  (current_date - 1, null, 'Uncategorised expense', 150000);

select is(
  (select count(*)::int from public.expense_summary_by_category(
     current_date - 2, current_date)
   where category_id is null),
  1,
  'expense: NULL category_id produces its own row'
);

-- ------------------------------------------------------------------
-- Test 5: sort ORDER BY total_amount DESC (expense)
-- ------------------------------------------------------------------
-- Categories so far: Rent (10000000) > Utilities (800000) > NULL (150000)
-- Expected first row: Rent T180-v2
select is(
  (select category_name from public.expense_summary_by_category(current_date - 2, current_date) limit 1),
  'Rent T180-v2',
  'expense: first row is highest total_amount (Rent 10000000)'
);

-- ==================================================================
-- payroll_summary_by_employee tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 6: empty range returns 0 rows (payroll)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.payroll_summary_by_employee(
     current_date - 60, current_date - 50)),
  0,
  'payroll: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Tests 7 + 8 + 9: sum(total_pay) + shift_count + sum(total_minutes)
-- ------------------------------------------------------------------
-- Create employees: Alice + Bob
-- Alice: 2 shifts, total_pay 500000 + 400000 = 900000, total_minutes 300 + 240 = 540
-- Bob: 1 shift, total_pay 350000, total_minutes 180
create temp table _t_emp_alice (id uuid);
create temp table _t_emp_bob (id uuid);
with a as (
  insert into public.employees (name, hourly_rate) values ('Alice T180', 100000) returning id
)
insert into _t_emp_alice select id from a;
with b as (
  insert into public.employees (name, hourly_rate) values ('Bob T180', 100000) returning id
)
insert into _t_emp_bob select id from b;

insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
values
  ((select id from _t_emp_alice), current_date - 1, 300, 100000, 500000, 500000),
  ((select id from _t_emp_alice), current_date - 1, 240, 100000, 400000, 400000),
  ((select id from _t_emp_bob),   current_date - 1, 180, 100000, 350000, 350000);

-- Test 7: sum(total_pay) for Alice = 900000
select is(
  (select total_pay from public.payroll_summary_by_employee(
     current_date - 2, current_date)
   where employee_id = (select id from _t_emp_alice)),
  900000::numeric,
  'payroll: sum(total_pay) across 2 Alice shifts = 900000'
);

-- Test 8: shift_count for Alice = 2
select is(
  (select shift_count from public.payroll_summary_by_employee(
     current_date - 2, current_date)
   where employee_id = (select id from _t_emp_alice)),
  2::int,
  'payroll: shift_count = count(*) per employee = 2'
);

-- Test 9: sum(total_minutes) for Alice = 540 (300 + 240)
select is(
  (select total_minutes from public.payroll_summary_by_employee(
     current_date - 2, current_date)
   where employee_id = (select id from _t_emp_alice)),
  540::int,
  'payroll: sum(total_minutes) across Alice shifts = 540'
);

-- ------------------------------------------------------------------
-- Test 10: sort ORDER BY total_pay DESC (payroll)
-- ------------------------------------------------------------------
-- Employees so far: Alice (900000) > Bob (350000)
-- Expected first row: Alice T180
select is(
  (select employee_name from public.payroll_summary_by_employee(current_date - 2, current_date) limit 1),
  'Alice T180',
  'payroll: first row is highest total_pay (Alice 900000)'
);

select * from finish();
rollback;
```

Notes for the engineer:
- All 10 `select is(...)` calls are top-level SELECTs (no DO blocks — Phase 4.A learning).
- Count via `grep -c "^select is(" database/tests/180_expense_payroll_reports.sql` before commit — must be exactly 10.
- Tests 5 + 10 use `limit 1` against the function output (no outer `order by`) to verify the function's native ORDER BY — relies on documented `language sql` inlining. Same pattern as 5.A Tests 6/9 (fixed) and 5.B Tests 5/10.
- The `_t_cat_rent / _t_cat_util` setup has a deliberate "v1 fail then v2 succeed" structure to demonstrate the canonical pattern. **Simplify by removing the v1 attempts** if you prefer cleaner code — just use the CTE form from the start. The plan keeps the verbose form so the engineer can copy-paste it as-is if confused. Either way, both `_t_cat_rent` and `_t_cat_util` should resolve to category UUIDs.
- All test names use the `T180` suffix to avoid collisions with any pre-existing test fixtures across the suite.

### - [ ] Step 5: Run the full pgTAP suite

```powershell
npm run pgtap
```
Expected: **110 + 10 = 120 assertions passing**. No failures.

For faster iteration:
```powershell
$sql = Get-Content "database/tests/180_expense_payroll_reports.sql" -Raw
$sql | docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres
```

### - [ ] Step 6: Run Vitest (must still be 75)

```powershell
npm test -- --run
```

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5c): T1 — backend RPCs + pgTAP 180 (+10 assertions)

Append 2 STABLE RPCs to 002_functions.sql:

- expense_summary_by_category(p_from, p_to)
  LEFT JOIN expenses → expense_categories. Groups by
  (category_id, category_name). Sums amount + counts rows.
  NULL category surfaces as own row. No is_active filter —
  historical expenses against deactivated categories must
  surface. Sort: total_amount DESC.

- payroll_summary_by_employee(p_from, p_to)
  INNER JOIN shift_payroll_records → employees (schema
  enforces NOT NULL). Groups by (employee_id, employee_name).
  Sums total_pay + counts shifts + sums total_minutes (5th
  column for hours display). No is_active filter — historical
  pay records for inactive employees must surface. Sort:
  total_pay DESC.

Both STABLE for PostgREST caching, no SECURITY DEFINER.
count(*)::int and sum(total_minutes)::int (not bigint) so
supabase-js returns JS number — same defense as 5.A T2 /
5.B T1 fixes.

New pgTAP file 180_expense_payroll_reports.sql with 10
assertions:
- expense: 5 (empty, sum, count, NULL category own row, sort)
- payroll: 5 (empty, sum pay, count shifts, sum minutes, sort)

verify:phase: 75 Vitest + 120 pgTAP = 195 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add database/002_functions.sql database/tests/180_expense_payroll_reports.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 2: Data layer + query hooks + keys

**Files:**
- Modify: `src/lib/data/reports.ts` — append 2 wrappers + 2 row types (currently 176 lines)
- Modify: `src/hooks/queries/keys.ts` — append 2 keys inside `queryKeys` object (currently 53 lines)
- Modify: `src/hooks/queries/index.ts` — re-export new file
- Create: `src/hooks/queries/use-expense-payroll-reports-query.ts`

### - [ ] Step 1: Append data layer wrappers + types

Open `src/lib/data/reports.ts`. The file currently ends at line 176 (after the 5.B `CategorySummaryRow` and `loadSalesCategorySummary` exports). Append at EOF:

```ts

// ---------------------------------------------------------------------
// Phase 5.C — Expense + payroll reports
// ---------------------------------------------------------------------

export interface ExpenseCategoryRow {
  category_id: string | null;
  category_name: string | null;
  total_amount: number;
  expense_count: number;
}

export async function loadExpenseSummaryByCategory(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ExpenseCategoryRow[]> {
  const { data, error } = await supabase.rpc("expense_summary_by_category", {
    p_from: from,
    p_to: to,
  });
  if (error) throw toAppError(error, "Không tải được báo cáo chi phí.");
  return (data ?? []) as ExpenseCategoryRow[];
}

export interface PayrollEmployeeRow {
  employee_id: string;
  employee_name: string;
  total_pay: number;
  shift_count: number;
  total_minutes: number;
}

export async function loadPayrollSummaryByEmployee(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<PayrollEmployeeRow[]> {
  const { data, error } = await supabase.rpc("payroll_summary_by_employee", {
    p_from: from,
    p_to: to,
  });
  if (error) throw toAppError(error, "Không tải được báo cáo lương.");
  return (data ?? []) as PayrollEmployeeRow[];
}
```

Notes:
- `SupabaseClient` already imported at the top of the file (line 1).
- `toAppError` already imported from `./_common` (line 3).
- `category_id` / `category_name` typed `string | null` (LEFT JOIN can return NULL).
- `employee_id` typed `string` (NOT NULL — schema enforces).
- `total_minutes` is the 5th payroll column — `number` type matches the `::int` cast in T1.

### - [ ] Step 2: Append query keys

Open `src/hooks/queries/keys.ts`. The factory currently ends at line 53 with `salesCategorySummary` (line 51–52) then `};` (line 53). Insert 2 new entries between `salesCategorySummary` and the closing `};`:

```ts
  salesCategorySummary: (range: { from: string; to: string }) =>
    ["sales-reports", "category", range] as const,

  // Phase 5.C — Expense + payroll reports
  expenseSummaryByCategory: (range: { from: string; to: string }) =>
    ["expense-payroll-reports", "expense_category", range] as const,
  payrollSummaryByEmployee: (range: { from: string; to: string }) =>
    ["expense-payroll-reports", "payroll_employee", range] as const,
};
```

(Add 2 new entries; the closing `};` stays. The leading `salesCategorySummary` from 5.B is unchanged.)

The new `"expense-payroll-reports"` root is intentionally separate from `"reports"` (Cash Close), `"inventory-reports"` (5.A), and `"sales-reports"` (5.B) — prevents accidental cache blast from broad invalidation.

### - [ ] Step 3: Create the query hook file

Create `src/hooks/queries/use-expense-payroll-reports-query.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadExpenseSummaryByCategory,
  loadPayrollSummaryByEmployee,
  type ExpenseCategoryRow,
  type PayrollEmployeeRow,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.C — Expense + payroll analytics query hooks.
 *
 * Both queries:
 *   - staleTime 60s (user-driven date-range pulls, bg-refresh unwanted)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hooks in this phase
 */

export function useExpenseSummaryByCategoryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<ExpenseCategoryRow[]>({
    queryKey: queryKeys.expenseSummaryByCategory({ from, to }),
    queryFn: () => loadExpenseSummaryByCategory(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function usePayrollSummaryByEmployeeQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<PayrollEmployeeRow[]>({
    queryKey: queryKeys.payrollSummaryByEmployee({ from, to }),
    queryFn: () => loadPayrollSummaryByEmployee(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
```

### - [ ] Step 4: Add the file to the queries barrel

Open `src/hooks/queries/index.ts`. The file currently ends with:

```ts
export * from "./use-inventory-queries";
export * from "./use-stock-movements-query";
export * from "./use-inventory-reports-query";
export * from "./use-sales-reports-query";
```

Add one line at the bottom:

```ts
export * from "./use-inventory-queries";
export * from "./use-stock-movements-query";
export * from "./use-inventory-reports-query";
export * from "./use-sales-reports-query";
export * from "./use-expense-payroll-reports-query";
```

### - [ ] Step 5: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 6: Run verify:phase (no test changes — should still be 75 / 120)

```powershell
npm run verify:phase
```
Expected: 75 Vitest + 120 pgTAP green.

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5c): T2 — data layer + query hooks + keys

src/lib/data/reports.ts (append):
- ExpenseCategoryRow / PayrollEmployeeRow interfaces
- loadExpenseSummaryByCategory(supabase, from, to)
- loadPayrollSummaryByEmployee(supabase, from, to)
  Both call the T1 RPCs, throw toAppError on failure with
  Vietnamese fallback messages.

src/hooks/queries/keys.ts (append):
- expenseSummaryByCategory({ from, to }) factory
- payrollSummaryByEmployee({ from, to }) factory
  Both rooted at "expense-payroll-reports" — decoupled from
  "reports" (Cash Close), "inventory-reports" (5.A), and
  "sales-reports" (5.B).

src/hooks/queries/use-expense-payroll-reports-query.ts (new):
- useExpenseSummaryByCategoryQuery(supabase, from, to, enabled?)
- usePayrollSummaryByEmployeeQuery(supabase, from, to, enabled?)
- staleTime 60s; supabase null-guard via enabled.

src/hooks/queries/index.ts: export new file.

TS strict + verify:phase: 75 + 120 = 195 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/lib/data/reports.ts src/hooks/queries/keys.ts src/hooks/queries/use-expense-payroll-reports-query.ts src/hooks/queries/index.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 3: `ExpenseByCategoryTable`

**Files:**
- Create: `src/features/reports/expense-by-category-table.tsx`

### - [ ] Step 1: Create the component

Create `src/features/reports/expense-by-category-table.tsx`:

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useExpenseSummaryByCategoryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.C — Expenses aggregated by category over a date range.
 *
 * Data source: expense_summary_by_category RPC (LEFT JOIN to
 * surface NULL category as own row). Sorted DESC by total_amount.
 */

interface ExpenseByCategoryTableProps {
  dateRange: DateRange;
}

export function ExpenseByCategoryTable({ dateRange }: ExpenseByCategoryTableProps) {
  const supabase = useSupabase();
  const query = useExpenseSummaryByCategoryQuery(
    supabase,
    dateRange.from,
    dateRange.to,
    !!supabase
  );

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={24} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được báo cáo chi phí">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="wallet"
        title="Chưa có chi phí trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc nhập chi phí mới."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Chi phí theo danh mục</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} danh mục
          </Badge>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="text-left pb-2 font-medium">Danh mục</th>
              <th scope="col" className="text-right pb-2 font-medium">Tổng tiền</th>
              <th scope="col" className="text-right pb-2 font-medium">Số lần</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.category_id ?? `null-${i}`}
                className="border-t border-border"
              >
                <td className="py-2 text-ink">
                  {row.category_name ?? "Chưa phân loại"}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-ink">
                  {formatVND(row.total_amount)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-muted">
                  {row.expense_count.toLocaleString("vi-VN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
```

Notes:
- Icon `wallet` matches the existing nav icon for Expenses + the 5.A placeholder for this tab.
- Row key uses `row.category_id ?? \`null-${i}\`` — defensive (GROUP BY collapses NULLs but the fallback costs nothing).
- All 3 `<th>` have `scope="col"` for a11y.

### - [ ] Step 2: TypeScript strict check
```powershell
npx tsc --noEmit
```

### - [ ] Step 3: Smoke verify
```powershell
npm run verify:phase
```
Expected: 75 + 120 = 195 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5c): T3 — ExpenseByCategoryTable

src/features/reports/expense-by-category-table.tsx (new):
- useExpenseSummaryByCategoryQuery(dateRange.from, dateRange.to)
- Loading: Spinner size 24, centered py-8
- Error: AlertBanner variant=danger with wrapped message
- Empty: EmptyState dashedBorder icon=wallet with VN copy
  "Chưa có chi phí trong khoảng này"
- Data: Card → 3-col table (Danh mục / Tổng tiền / Số lần).
  vi-VN locale on count, formatVND for total_amount. Row key
  fallback `null-${i}` defensive.
- NULL category_name → "Chưa phân loại"
- <th scope="col"> on all 3 column headers (a11y)

verify:phase: 75 + 120 = 195 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/expense-by-category-table.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 4: `PayrollSummaryTable`

**Files:**
- Create: `src/features/reports/payroll-summary-table.tsx`

### - [ ] Step 1: Create the component

Create `src/features/reports/payroll-summary-table.tsx`:

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { usePayrollSummaryByEmployeeQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.C — Payroll aggregated by employee over a date range.
 *
 * Data source: payroll_summary_by_employee RPC. Sorted DESC by
 * total_pay. Includes inactive employees (historical pay records
 * must surface).
 *
 * 4-column table: Nhân viên / Tổng lương / Số ca / Tổng giờ.
 * total_minutes formatted client-side as "8 giờ 25" via
 * formatHours below.
 */

interface PayrollSummaryTableProps {
  dateRange: DateRange;
}

export function PayrollSummaryTable({ dateRange }: PayrollSummaryTableProps) {
  const supabase = useSupabase();
  const query = usePayrollSummaryByEmployeeQuery(
    supabase,
    dateRange.from,
    dateRange.to,
    !!supabase
  );

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={24} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được báo cáo lương">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="users"
        title="Chưa có lương trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc tạo ca chấm công mới."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Lương theo nhân viên</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} nhân viên
          </Badge>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="text-left pb-2 font-medium">Nhân viên</th>
              <th scope="col" className="text-right pb-2 font-medium">Tổng lương</th>
              <th scope="col" className="text-right pb-2 font-medium">Số ca</th>
              <th scope="col" className="text-right pb-2 font-medium">Tổng giờ</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.employee_id} className="border-t border-border">
                <td className="py-2 text-ink">{row.employee_name}</td>
                <td className="py-2 text-right font-mono tabular-nums text-ink">
                  {formatVND(row.total_pay)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-muted">
                  {row.shift_count.toLocaleString("vi-VN")}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-muted">
                  {formatHours(row.total_minutes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

/**
 * Format a number of minutes as "{H} giờ {MM}" or "{H} giờ" if minutes=0.
 * Examples:
 *   505 → "8 giờ 25"
 *   480 → "8 giờ"
 *     0 → "0 giờ"
 */
function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} giờ`;
  return `${h} giờ ${String(m).padStart(2, "0")}`;
}
```

Notes:
- Icon `users` matches the nav icon for Shifts (Phase 3B2a).
- Row key uses `row.employee_id` directly (NOT NULL per schema).
- `formatHours` is inline — extract to `@/lib/format` only if a 3rd consumer appears (current consumers: just this file).
- Error title is distinct from T3 ("lương" not "chi phí") so user sees which section failed independently.

### - [ ] Step 2: TypeScript strict check
```powershell
npx tsc --noEmit
```

### - [ ] Step 3: Smoke verify
```powershell
npm run verify:phase
```
Expected: 75 + 120 = 195 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5c): T4 — PayrollSummaryTable

src/features/reports/payroll-summary-table.tsx (new):
- usePayrollSummaryByEmployeeQuery(dateRange.from, dateRange.to)
- Loading / Error / Empty branches match T3 with distinct
  error title "Không tải được báo cáo lương" + EmptyState
  icon=users + payroll-specific copy
- Data: Card → 4-col table (Nhân viên / Tổng lương / Số ca /
  Tổng giờ). vi-VN locale on counts, formatVND for total_pay.
- Inline formatHours(minutes): "{H} giờ {MM}" with " giờ"-only
  when minutes=0. Examples: 505→"8 giờ 25", 480→"8 giờ",
  0→"0 giờ". Extract only when 3rd consumer appears.
- <th scope="col"> on all 4 column headers (a11y)
- Row key row.employee_id (NOT NULL per schema)

verify:phase: 75 + 120 = 195 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/payroll-summary-table.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 5: `ExpensePayrollTab`

**Files:**
- Create: `src/features/reports/expense-payroll-tab.tsx`

### - [ ] Step 1: Create the file

Create `src/features/reports/expense-payroll-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ExpenseByCategoryTable } from "./expense-by-category-table";
import { PayrollSummaryTable } from "./payroll-summary-table";

/**
 * Phase 5.C — Expense + payroll tab inside ReportsView.
 *
 * Single source of truth for the date range: both
 * ExpenseByCategoryTable and PayrollSummaryTable receive the same
 * value. Changing the picker re-keys both TanStack Query caches.
 *
 * Mirrors InventoryAnalyticsTab (5.A) and SalesByProductTab (5.B)
 * verbatim.
 */
export function ExpensePayrollTab() {
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      <section className="space-y-3">
        <ExpenseByCategoryTable dateRange={dateRange} />
      </section>

      <section className="space-y-3">
        <PayrollSummaryTable dateRange={dateRange} />
      </section>
    </div>
  );
}
```

Notes:
- Lazy state init `useState(() => defaultDateRange())` — `new Date()` runs only on mount.
- No props. Named export only.
- Identical structure to 5.A `InventoryAnalyticsTab` and 5.B `SalesByProductTab`.

### - [ ] Step 2: TypeScript strict check
```powershell
npx tsc --noEmit
```

### - [ ] Step 3: Smoke verify
```powershell
npm run verify:phase
```
Expected: 75 + 120 = 195 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5c): T5 — ExpensePayrollTab

src/features/reports/expense-payroll-tab.tsx (new):
- useState<DateRange> lazy-initialised with defaultDateRange()
  (= "Tuần này": Monday → today, from 5.A)
- DateRangePicker at top, both tables below sharing the same
  range. Changing the picker invalidates both queries via
  TanStack Query's automatic key change.

Not yet wired into ReportsView — that's T6.

verify:phase: 75 + 120 = 195 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/expense-payroll-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 6: `ReportsView` placeholder swap + verify + tag `v4-phase-5c`

**Files:**
- Modify: `src/features/reports/reports-view.tsx` — swap `expense_payroll` placeholder for `<ExpensePayrollTab />`

### - [ ] Step 1: Add the import

Open `src/features/reports/reports-view.tsx`. Find the existing import block at the top. The 5.B T6 swap added:
```tsx
import { SalesByProductTab } from "./sales-by-product-tab";
```
(immediately after the `InventoryAnalyticsTab` import).

Add immediately after the `SalesByProductTab` import:
```tsx
import { ExpensePayrollTab } from "./expense-payroll-tab";
```

### - [ ] Step 2: Swap the placeholder

Find this exact block (added in 5.A T7, untouched by 5.B):

```tsx
      <TabsContent value="expense_payroll">
        <EmptyState
          icon="wallet"
          title="Chi phí + lương"
          subtitle="Phát hành trong giai đoạn 5.C — báo cáo chi phí và lương theo khoảng."
          dashedBorder
        />
      </TabsContent>
```

Replace it with:

```tsx
      <TabsContent value="expense_payroll">
        <ExpensePayrollTab />
      </TabsContent>
```

All other tabs (`cash_close`, `inventory`, `sales_product`, `hourly`) stay untouched. The `<CashCloseTab />`, `<InventoryAnalyticsTab />`, `<SalesByProductTab />`, and the remaining `<EmptyState>` placeholder for 5.D are unchanged.

### - [ ] Step 3: TypeScript strict check
```powershell
npx tsc --noEmit
```

### - [ ] Step 4: Production build sanity check
```powershell
npm run build
```
Expected: build succeeds.

### - [ ] Step 5: Run the full verify suite
```powershell
npm run verify:phase
```
Expected: **75 Vitest + 120 pgTAP = 195 green**.

### - [ ] Step 6: Manual smoke test (recommended before commit)

Start dev server in another terminal (`npm run dev`) and verify in browser:

1. Owner login → Báo cáo → "Chốt két" tab is default; Cash Close UI unchanged
2. Click "Tồn kho" tab → 5.A consumption + variance reports unchanged
3. Click "Doanh số" tab → 5.B product + category tables unchanged
4. Click "Chi phí + lương" tab → DateRangePicker + ExpenseByCategoryTable + PayrollSummaryTable render
5. Click "Hôm nay" / "Tuần này" / "Tháng này" → both tables refetch
6. Custom date range with from/to → tables filter
7. Empty range → both EmptyStates render (Chi phí + Lương distinct empty copy)
8. With dev data containing a NULL `category_id` expense → "Chưa phân loại" row appears
9. With dev data containing shifts → check Tổng giờ formatting (e.g., 505 min → "8 giờ 25", 480 min → "8 giờ")
10. Click "Theo giờ" tab → still placeholder for 5.D
11. Visit `/expenses` (standalone ExpensesView) → unchanged
12. Visit `/shifts` (standalone ShiftsView) → unchanged
13. Log in as manager → same 5 ReportsView tabs visible
14. Log in as staff_operator → same 5 tabs visible
15. Log in as employee_viewer → Báo cáo NOT in sidebar (NAV_ITEMS blocks)

If any smoke check fails, fix and re-verify before committing.

### - [ ] Step 7: Commit the swap

```powershell
@'
feat(phase-5c): T6 — wire ExpensePayrollTab + tag v4-phase-5c

src/features/reports/reports-view.tsx:
- Add import: ExpensePayrollTab from "./expense-payroll-tab"
- Replace `expense_payroll` placeholder EmptyState with
  <ExpensePayrollTab />.

All other tabs (cash_close, inventory, sales_product, hourly)
unchanged. Existing ExpensesView at /expenses and ShiftsView at
/shifts unchanged — Phase 5.C is additive, not a replacement.

Role gating unchanged: NAV_ITEMS restricts Báo cáo to
owner + manager + staff_operator. employee_viewer blocked.

Manual smoke: all 4 roles tested in browser. All 5 ReportsView
tabs visible to the 3 allowed roles. Chi phí + lương tab renders
both new aggregations driven by the shared DateRangePicker.

verify:phase: 75 Vitest + 120 pgTAP = 195 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/reports-view.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

### - [ ] Step 8: Final verify before tagging
```powershell
npm run verify:phase
npx tsc --noEmit
npm run build
```
Expected: all three clean.

### - [ ] Step 9: Tag `v4-phase-5c`
```powershell
git tag -a v4-phase-5c -m "Phase 5.C — Expense + Payroll Reports"
git log --oneline -10
git tag -l "v4-phase-5*"
```
Expected:
- `git log` shows latest commits
- `git tag -l` shows `v4-phase-5a` + `v4-phase-5b` + `v4-phase-5c`. No umbrella `v4-phase-5` yet — that comes after 5.D.

### - [ ] Step 10: Final status check
```powershell
git status
git diff main..HEAD --stat
```
Expected:
- `git status`: clean working tree
- `git diff main..HEAD --stat`: shows ~13 files changed:
  - `docs/superpowers/specs/2026-05-22-v4-phase-5c-expense-payroll-reports-design.md` (already committed)
  - `docs/superpowers/plans/2026-05-22-v4-phase-5c-expense-payroll-reports.md` (this file)
  - `database/002_functions.sql` (modified)
  - `database/tests/180_expense_payroll_reports.sql` (new)
  - `src/lib/data/reports.ts` (modified)
  - `src/hooks/queries/keys.ts` (modified)
  - `src/hooks/queries/index.ts` (modified)
  - `src/hooks/queries/use-expense-payroll-reports-query.ts` (new)
  - `src/features/reports/expense-by-category-table.tsx` (new)
  - `src/features/reports/payroll-summary-table.tsx` (new)
  - `src/features/reports/expense-payroll-tab.tsx` (new)
  - `src/features/reports/reports-view.tsx` (modified)

If extra files appear, investigate before invoking `superpowers:finishing-a-development-branch`.

### - [ ] Step 11: Hand off to `superpowers:finishing-a-development-branch`

After T6 commits + tag are in place, the controller invokes:
- `superpowers:finishing-a-development-branch` to present merge / PR / keep / discard options
- Typical choice: **Option 1 — Merge back to main locally** (matches every prior 5.x and Phase 4 sub-phase finish)

---

## Verification matrix

After T6 merges to `main`:

| Check | Command | Expected |
|-------|---------|----------|
| Vitest | `npm test -- --run` | 75 pass (unchanged) |
| pgTAP | `npm run pgtap` | 120 pass (110 prior + 10 new in 180) |
| TS strict | `npx tsc --noEmit` | 0 errors |
| Build | `npm run build` | success |
| Branch | `git log --oneline main..phase-5c-expense-payroll-reports` | 6 task commits + spec + plan commits |
| Tag | `git tag -l v4-phase-5c` | exists, points to final merge commit |

Manual UI smoke (from T6 Step 6) — owner login is sufficient; other 3 roles verified in T6 step 6 list.

---

## Self-review

### Spec coverage
| Spec section | Requirement | Plan task |
|---|---|---|
| §3 (scope decisions) | 2 reports stacked, no payment_method, 3+4 col tables, default sort total DESC, "Tuần này" default, shared picker, inactive records preserved, NULL category fallback, new key namespace | T1 + T3 + T4 + T5 |
| §4.1 (ReportsView placeholder swap) | Replace `expense_payroll` placeholder with `<ExpensePayrollTab />` | T6 |
| §4.2 (ExpensePayrollTab composition) | Single useState, both tables share dateRange | T5 |
| §4.3 (role gating) | Inherits NAV_ITEMS gate | T6 smoke step |
| §4.4 (data flow) | Both queries staleTime 60s, null-guarded | T2 |
| §5.1 (`expense_summary_by_category` RPC) | LEFT JOIN, no is_active filter, group + order | T1 |
| §5.2 (`payroll_summary_by_employee` RPC) | INNER JOIN, includes total_minutes, no is_active filter | T1 |
| §5.3 (10 pgTAP assertions) | 5 expense + 5 payroll | T1 |
| §6.1 (5 new files) | All 5 referenced in T1–T5 | ✓ |
| §6.2 (5 modified files) | All 5 touched by T1, T2, T6 | ✓ |
| §7.1 (ExpenseByCategoryTable 4-branch) | loading / error / empty / data | T3 |
| §7.2 (PayrollSummaryTable + formatHours) | 4-col with formatHours helper | T4 |
| §7.3 (ExpensePayrollTab composition) | Mirrors prior 5.x tabs | T5 |
| §7.4 (ReportsView swap mechanics) | Add import + replace TabsContent body | T6 |
| §8.1 (data layer wrappers) | 2 interfaces + 2 functions | T2 |
| §8.2 (query keys "expense-payroll-reports" namespace) | New root, decoupled | T2 |
| §8.3 (query hooks file) | 2 hooks, staleTime 60s | T2 |
| §8.4 (barrel export) | Add line to index.ts | T2 |
| §9 (Vietnamese strings) | All ~20 strings appear across T1 (RPC names not VN), T3, T4, T6 | ✓ |
| §10 (error handling) | AlertBanner.danger per section, EmptyState for empty range, `formatHours(0) = "0 giờ"` | T3 + T4 |
| §11 (risks) | NULL category sort, inactive employees, perf, formatHours duplication, key namespace | Documented in respective tasks |
| §13 (success criteria) | All 16 items | Covered by T6 final verify + smoke |

### Placeholder scan
- No "TBD" / "implement later" / "TODO" / "handle edge cases" / "Similar to Task N" in any task
- T1 Step 4 includes a deliberate note about the temp-table v1/v2 setup pattern. The plan provides BOTH the verbose and cleaner forms; the engineer can use either. Not a placeholder — it's a clarifying option.

### Type consistency
- `DateRange` from `./date-range-picker` — same import path in T3, T4, T5
- `ExpenseCategoryRow` defined in T2 with 4 fields → consumed in T3
- `PayrollEmployeeRow` defined in T2 with 5 fields → consumed in T4
- `useExpenseSummaryByCategoryQuery(supabase, from, to, enabled?)` signature consistent between T2 (decl) and T3 (call)
- `usePayrollSummaryByEmployeeQuery(supabase, from, to, enabled?)` signature consistent between T2 and T4
- `formatVND` import path `@/lib/format` — same in T3 and T4
- `formatHours` defined inline in T4 only (no other consumers)
- `ExpensePayrollTab` named export in T5 → imported in T6
- Query keys `expenseSummaryByCategory({ from, to })` and `payrollSummaryByEmployee({ from, to })` shape matches between keys.ts (T2 step 2) and the hook usage (T2 step 3)

### Scope check
6 tasks × ~7–10 steps each = ~50 total steps. Same scale as 5.B. All steps fit the 2–5 minute target. No spec requirement uncovered.

No issues found.

---

## After this plan

Once T6 merges and tag `v4-phase-5c` lands:
- **Phase 5.D (Hourly / intraday trends)** — replaces `hourly` placeholder. Last sub-phase. New RPC `sales_hourly_summary`. Chart library decision (Recharts vs SVG vs HTML table) deferred to 5.D brainstorm. ~4-5 tasks.
- **Umbrella `v4-phase-5` tag** placed on the final merge commit of 5.D — closes Phase 5.

5.C's `"expense-payroll-reports"` namespace established. 5.D will likely extend `"sales-reports"` (hourly is a sales view).
