# Cashflow Per-Day Breakdown + Safe Deposit Line — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend cashflow page: chart click filters expense breakdown to single day, add safe_deposit line series, replace Top-5 categories with full expandable breakdown table.

**Architecture:** Extend `cash_flow_overview` RPC to return `by_day[].safe_deposit` + new `expense_breakdown[]` (all categories with nested expenses array) replacing `top_categories[]`. Modify chart to ComposedChart with Line overlay + onClick. New `ExpenseBreakdownTable` master-detail component replaces `TopCategoriesTable`. Cash flow view owns `selectedDate` state that wires chart click → breakdown filter.

**Tech Stack:** Postgres + pgTAP, Next.js 15, React 19, TypeScript, Vitest, Recharts (ComposedChart + Line).

---

## File structure

```
database/
  migrations/
    2026-05-28-a-cashflow-breakdown.sql   ← NEW (Task 1, replaces RPC)
  tests/
    200_cash_flow_overview.sql            ← MODIFY (Task 3 — extend assertions)
src/
  lib/
    types.ts                               ← MODIFY (Task 4)
  features/
    cashflow/
      expense-breakdown-table.tsx          ← NEW (Task 5)
      cash-flow-chart.tsx                  ← MODIFY (Task 6 — ComposedChart + Line + onClick)
      cash-flow-view.tsx                   ← MODIFY (Task 7 — selectedDate state, replace TopCategoriesTable import)
      top-categories-table.tsx             ← DELETE (Task 7)
```

**Constraints**:
- vitest env: `node` (no @testing-library). Hook/pure logic tests OK; component tests deferred Phase 6.B.
- DO NOT modify `package.json`, `vitest.config.mts`, `database/002_functions.sql` (project convention: cash_flow_overview lives only in its dedicated migration file, NOT patched into 002).
- Migration uses `create or replace function` → idempotent, no signature change.

---

## Task 1: SQL migration — extend `cash_flow_overview` RPC

**Files:**
- Create: `database/migrations/2026-05-28-a-cashflow-breakdown.sql`

- [ ] **Step 1: Write the migration file**

Create `database/migrations/2026-05-28-a-cashflow-breakdown.sql`:

```sql
-- =============================================================================
-- Cash Flow Overview RPC (2026-05-28) — Per-day safe_deposit + expense breakdown
--
-- Extends the existing function (created 2026-05-23):
--   * by_day[].safe_deposit: numeric — sum of cash_close_reports.safe_deposit_amount
--     per business_date where status <> 'voided'
--   * expense_breakdown[]: REPLACES top_categories[] — full list of categories
--     (sorted by amount desc) with nested expenses array for drill-down.
--
-- Auth: SECURITY DEFINER; first line raises if caller is not owner/manager.
-- Idempotent: create or replace function (signature unchanged).
-- =============================================================================

create or replace function public.cash_flow_overview(
  p_start date,
  p_end date,
  p_compare_start date default null,
  p_compare_end date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in numeric;
  v_out numeric;
  v_prev_in numeric;
  v_prev_out numeric;
  v_by_day jsonb;
  v_breakdown jsonb;
  v_result jsonb;
begin
  if not public.app_is_owner_manager() then
    raise exception 'forbidden: cash_flow_overview requires owner/manager';
  end if;

  -- IN / OUT for the current period
  select coalesce(sum(net_amount), 0)
    into v_in
    from public.sales_orders
   where business_date between p_start and p_end;

  select coalesce((select sum(amount) from public.expenses
                    where business_date between p_start and p_end), 0)
       + coalesce((select sum(total_pay) from public.shift_payroll_records
                    where business_date between p_start and p_end), 0)
    into v_out;

  -- by_day: every day in the range, even days with zero activity
  -- Now includes safe_deposit per day (from cash_close_reports.safe_deposit_amount,
  -- excluding voided reports).
  with d as (
    select dd::date as day
      from generate_series(p_start, p_end, interval '1 day') dd
  ),
  ins as (
    select business_date as day, sum(net_amount) as amt
      from public.sales_orders
     where business_date between p_start and p_end
     group by 1
  ),
  outs as (
    select day, sum(amt) as amt from (
      select business_date as day, sum(amount) as amt
        from public.expenses
       where business_date between p_start and p_end
       group by 1
      union all
      select business_date as day, sum(total_pay) as amt
        from public.shift_payroll_records
       where business_date between p_start and p_end
       group by 1
    ) u group by day
  ),
  deposits as (
    select business_date as day, coalesce(sum(safe_deposit_amount), 0) as amt
      from public.cash_close_reports
     where business_date between p_start and p_end
       and status <> 'voided'
     group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'date', to_char(d.day, 'YYYY-MM-DD'),
           'in', coalesce(ins.amt, 0),
           'out', coalesce(outs.amt, 0),
           'safe_deposit', coalesce(deposits.amt, 0)
         ) order by d.day)
    into v_by_day
    from d
    left join ins on ins.day = d.day
    left join outs on outs.day = d.day
    left join deposits on deposits.day = d.day;

  -- expense_breakdown: ALL categories with nested expense list per category,
  -- ordered by total amount desc. Payroll is excluded (matches prior behavior).
  with cat_totals as (
    select
      ec.id as category_id,
      coalesce(ec.name, '(chưa phân loại)') as category_name,
      sum(e.amount) as amount,
      jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'business_date', to_char(e.business_date, 'YYYY-MM-DD'),
          'description', e.description,
          'amount', e.amount,
          'occurred_at', to_char(e.occurred_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS'),
          'note', e.note
        ) order by e.occurred_at desc
      ) as expenses
    from public.expenses e
    left join public.expense_categories ec on ec.id = e.category_id
    where e.business_date between p_start and p_end
    group by ec.id, ec.name
  )
  select jsonb_agg(jsonb_build_object(
           'category_id', category_id,
           'category_name', category_name,
           'amount', amount,
           'pct', case when v_out = 0 then 0 else amount / v_out end,
           'expenses', expenses
         ) order by amount desc)
    into v_breakdown
    from cat_totals;

  v_result := jsonb_build_object(
    'in', v_in,
    'out', v_out,
    'net', v_in - v_out,
    'by_day', coalesce(v_by_day, '[]'::jsonb),
    'expense_breakdown', coalesce(v_breakdown, '[]'::jsonb)
  );

  if p_compare_start is not null and p_compare_end is not null then
    select coalesce(sum(net_amount), 0)
      into v_prev_in
      from public.sales_orders
     where business_date between p_compare_start and p_compare_end;
    select coalesce((select sum(amount) from public.expenses
                      where business_date between p_compare_start and p_compare_end), 0)
         + coalesce((select sum(total_pay) from public.shift_payroll_records
                      where business_date between p_compare_start and p_compare_end), 0)
      into v_prev_out;
    v_result := v_result || jsonb_build_object(
      'prev_in', v_prev_in,
      'prev_out', v_prev_out,
      'prev_net', v_prev_in - v_prev_out
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.cash_flow_overview(date, date, date, date) from public;
grant execute on function public.cash_flow_overview(date, date, date, date) to authenticated;

comment on function public.cash_flow_overview(date, date, date, date) is
  'Cash-flow overview JSONB for owner/manager. v2 (2026-05-28): + safe_deposit per day, expense_breakdown (replaces top_categories). Spec: docs/superpowers/specs/2026-05-28-cashflow-per-day-breakdown-design.md';
```

- [ ] **Step 2: Commit the migration**

```bash
git add database/migrations/2026-05-28-a-cashflow-breakdown.sql
git commit -m "$(cat <<'EOF'
feat(sql): extend cash_flow_overview RPC for per-day breakdown

Adds by_day[].safe_deposit (sum from cash_close_reports, excluding voided)
and replaces top_categories[] with expense_breakdown[] — full list of
categories sorted by amount desc, with nested expenses array per category
for drill-down.

Idempotent create-or-replace, signature unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Apply migration locally + manual SQL smoke

**Files:** None (verification only).

- [ ] **Step 1: Apply migration to local Postgres**

```bash
cat database/migrations/2026-05-28-a-cashflow-breakdown.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
```
Expected output: `CREATE FUNCTION`, `REVOKE`, `GRANT`, `COMMENT`.

- [ ] **Step 2: Verify function signature unchanged**

```bash
docker compose exec -T db psql -U postgres -d postgres -c "\df public.cash_flow_overview"
```
Expected: 1 row with `Argument data types = date, date, date DEFAULT NULL::date, date DEFAULT NULL::date`.

- [ ] **Step 3: Smoke test — empty period**

```bash
docker compose exec -T db psql -U postgres -d postgres -c "SELECT public.cash_flow_overview('2099-01-01'::date, '2099-01-03'::date);"
```
Expected JSON: contains `by_day` with 3 entries (each with `date`, `in:0`, `out:0`, `safe_deposit:0`), `expense_breakdown: []`, NO `top_categories` field.

- [ ] **Step 4: Smoke test — period with real data (today's range)**

```bash
docker compose exec -T db psql -U postgres -d postgres -c "SELECT jsonb_pretty(public.cash_flow_overview(CURRENT_DATE - 7, CURRENT_DATE));"
```
Expected: real data with non-zero `by_day[].safe_deposit` if any cash close report exists in the range. `expense_breakdown[]` has full category list with `expenses` array per category.

**Manual verification points**:
- Each `expense_breakdown[i].expenses` is an array of `{id, business_date, description, amount, occurred_at, note}` ordered by `occurred_at desc`.
- `expense_breakdown` sorted by `amount` desc overall.
- Voided cash_close_reports do NOT contribute to `safe_deposit`.

If anything mismatches the spec, STOP and report — don't proceed to Task 3.

- [ ] **Step 5: No commit** (this task only verifies; nothing to commit).

---

## Task 3: pgTAP test extension

**Files:**
- Modify: `database/tests/200_cash_flow_overview.sql`

The existing test has 8 assertions. After the RPC change, assertion 4 (`top_categories is empty`) and assertion 8 (`top_categories[0].category_name = 'CFO Cat Big'`) will FAIL because `top_categories` no longer exists. We replace these with assertions on `expense_breakdown` + new assertions for `safe_deposit`.

- [ ] **Step 1: Replace the existing test content**

Overwrite the file with the updated version (full new content):

```sql
-- =============================================================================
-- pgTAP — cash_flow_overview RPC (v2: per-day breakdown + safe_deposit line)
--
-- 10 assertions across 4 scenarios:
--   Scenario 1: empty period (4 assertions)
--     1. in = 0
--     2. out = 0
--     3. by_day has 3 entries (one per day, all zero including safe_deposit)
--     4. expense_breakdown is empty
--
--   Scenario 2: correct sums across all three sources (3 assertions)
--     5. in = 100 (one sales_order with net_amount=100)
--     6. out = 80  (expense 30 + payroll 50)
--     7. net = 20
--
--   Scenario 3: expense_breakdown ordering + expenses array (2 assertions)
--     8. expense_breakdown[0].category_name = 'CFO Cat Big'
--     9. expense_breakdown[0].expenses[0].amount = 500
--
--   Scenario 4: safe_deposit per day excludes voided reports (1 assertion)
--    10. by_day[0].safe_deposit = 100000 (only the 'final' report counts)
-- =============================================================================

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
  ('22222222-2222-2222-2222-222222222222', 'owner_cfo@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('22222222-2222-2222-2222-222222222222', 'OwnerCFO');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('22222222-2222-2222-2222-222222222222', 'owner', 'active');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

-- ===========================================================================
-- Scenario 1: empty period
-- ===========================================================================

select is(
  (select (public.cash_flow_overview('2099-01-01', '2099-01-03') ->> 'in')::numeric),
  0::numeric,
  'empty: in is 0'
);

select is(
  (select (public.cash_flow_overview('2099-01-01', '2099-01-03') ->> 'out')::numeric),
  0::numeric,
  'empty: out is 0'
);

select is(
  (select jsonb_array_length(public.cash_flow_overview('2099-01-01', '2099-01-03') -> 'by_day')),
  3,
  'empty: by_day has 3 entries (one per day)'
);

select is(
  (select jsonb_array_length(public.cash_flow_overview('2099-01-01', '2099-01-03') -> 'expense_breakdown')),
  0,
  'empty: expense_breakdown is empty'
);

-- ===========================================================================
-- Scenario 2: correct sums — 1 sales_order (in=100) + 1 expense (30) + 1 payroll (50)
-- ===========================================================================

create temp table _t_cfo_cat (id uuid);
with c as (
  insert into public.expense_categories (name, sort_order)
    values ('CFO Test Cat S2', 999)
    returning id
)
insert into _t_cfo_cat select id from c;

create temp table _t_cfo_emp (id uuid);
with e as (
  insert into public.employees (name, hourly_rate)
    values ('CFO Test Employee', 100000)
    returning id
)
insert into _t_cfo_emp select id from e;

insert into public.sales_orders (
  kiotviet_invoice_id, purchase_at, business_date, net_amount
) values (
  'CFO-TEST-INV-001', '2099-02-01 10:00+07', '2099-02-01', 100
);

insert into public.expenses (business_date, description, amount, category_id)
values ('2099-02-01', 'CFO test expense', 30, (select id from _t_cfo_cat));

insert into public.shift_payroll_records (
  employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay
) values (
  (select id from _t_cfo_emp), '2099-02-01', 60, 100000, 50, 50
);

select is(
  (select (public.cash_flow_overview('2099-02-01', '2099-02-01') ->> 'in')::numeric),
  100::numeric,
  'sums: in = 100 (one sales_order)'
);

select is(
  (select (public.cash_flow_overview('2099-02-01', '2099-02-01') ->> 'out')::numeric),
  80::numeric,
  'sums: out = 80 (expense 30 + payroll 50)'
);

select is(
  (select (public.cash_flow_overview('2099-02-01', '2099-02-01') ->> 'net')::numeric),
  20::numeric,
  'sums: net = 20 (100 - 80)'
);

-- ===========================================================================
-- Scenario 3: expense_breakdown ordering + nested expenses
-- ===========================================================================

create temp table _t_cfo_cat_big    (id uuid);
create temp table _t_cfo_cat_medium (id uuid);
create temp table _t_cfo_cat_small  (id uuid);

with c as (insert into public.expense_categories (name, sort_order) values ('CFO Cat Big',    998) returning id)
insert into _t_cfo_cat_big    select id from c;
with c as (insert into public.expense_categories (name, sort_order) values ('CFO Cat Medium', 997) returning id)
insert into _t_cfo_cat_medium select id from c;
with c as (insert into public.expense_categories (name, sort_order) values ('CFO Cat Small',  996) returning id)
insert into _t_cfo_cat_small  select id from c;

insert into public.expenses (business_date, description, amount, category_id) values
  ('2099-03-01', 'big expense',    500, (select id from _t_cfo_cat_big)),
  ('2099-03-01', 'medium expense', 200, (select id from _t_cfo_cat_medium)),
  ('2099-03-01', 'small expense',   50, (select id from _t_cfo_cat_small));

select is(
  (select public.cash_flow_overview('2099-03-01', '2099-03-01') -> 'expense_breakdown' -> 0 ->> 'category_name'),
  'CFO Cat Big',
  'expense_breakdown: first entry is highest amount (Big = 500)'
);

select is(
  (select (public.cash_flow_overview('2099-03-01', '2099-03-01') -> 'expense_breakdown' -> 0 -> 'expenses' -> 0 ->> 'amount')::numeric),
  500::numeric,
  'expense_breakdown[0].expenses[0].amount = 500'
);

-- ===========================================================================
-- Scenario 4: safe_deposit excludes voided reports
-- Insert 2 cash_close_reports for 2099-04-01:
--   - one final with safe_deposit_amount = 100000  (counts)
--   - one voided with safe_deposit_amount = 50000  (NOT counted)
-- Expected: by_day[0].safe_deposit = 100000
-- Need: cash_count rows + cash_close_reports (FK) — keep schema-minimal.
-- ===========================================================================

create temp table _t_cfo_cc_final (id uuid);
create temp table _t_cfo_cc_void  (id uuid);

-- Two cash_counts for the same date — one to back the final report, one for voided
with cc as (
  insert into public.cash_counts (
    business_date, count_type, counted_at, denominations_json, total_physical, counted_by
  ) values (
    '2099-04-01', 'shift_close', '2099-04-01 22:00+07', '{}'::jsonb, 100000,
    '22222222-2222-2222-2222-222222222222'
  ) returning id
)
insert into _t_cfo_cc_final select id from cc;

with cc as (
  insert into public.cash_counts (
    business_date, count_type, counted_at, denominations_json, total_physical, counted_by
  ) values (
    '2099-04-01', 'shift_close', '2099-04-01 22:30+07', '{}'::jsonb, 50000,
    '22222222-2222-2222-2222-222222222222'
  ) returning id
)
insert into _t_cfo_cc_void select id from cc;

-- Final report (counts)
insert into public.cash_close_reports (
  cash_count_id, business_date, status, safe_deposit_amount, leave_for_next_day, created_by
) values (
  (select id from _t_cfo_cc_final), '2099-04-01', 'final', 100000, 0,
  '22222222-2222-2222-2222-222222222222'
);

-- Voided report (does NOT count)
insert into public.cash_close_reports (
  cash_count_id, business_date, status, safe_deposit_amount, leave_for_next_day, created_by, void_reason
) values (
  (select id from _t_cfo_cc_void), '2099-04-01', 'voided', 50000, 0,
  '22222222-2222-2222-2222-222222222222', 'Test void scenario for pgTAP'
);

select is(
  (select (public.cash_flow_overview('2099-04-01', '2099-04-01') -> 'by_day' -> 0 ->> 'safe_deposit')::numeric),
  100000::numeric,
  'safe_deposit: voided reports excluded (only final 100000 counted)'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the pgTAP test**

```bash
npm run verify:phase 2>&1 | tail -30
```
Expected: green (all 10 assertions pass + no regression in other tests).

If the test fails on cash_counts insertion (missing required columns), inspect schema:
```bash
docker compose exec -T db psql -U postgres -d postgres -c "\d public.cash_counts" | head -30
```
Adjust the temp-table insertion in Scenario 4 to include any required NOT NULL columns the schema demands. Re-run.

- [ ] **Step 3: Commit**

```bash
git add database/tests/200_cash_flow_overview.sql
git commit -m "$(cat <<'EOF'
test(pgtap): cash_flow_overview v2 — expense_breakdown + safe_deposit

Updates assertions: top_categories → expense_breakdown (full categories
with nested expenses). Adds Scenario 4 verifying safe_deposit excludes
voided cash_close_reports. Total: 10 assertions across 4 scenarios.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: TypeScript types update

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Locate the existing types**

```bash
grep -n "CashFlowDayPoint\|CashFlowTopCategory\|CashFlowOverview" src/lib/types.ts
```

- [ ] **Step 2: Update types**

In `src/lib/types.ts`, find the existing `CashFlowDayPoint` and `CashFlowTopCategory` declarations.

Replace:

```ts
export interface CashFlowDayPoint {
  date: string;
  in: number;
  out: number;
}

export interface CashFlowTopCategory {
  category_name: string;
  amount: number;
  pct: number;
}
```

With:

```ts
export interface CashFlowDayPoint {
  date: string;
  in: number;
  out: number;
  /** Sum of cash_close_reports.safe_deposit_amount for this date (excludes voided). */
  safe_deposit: number;
}

/** A single expense row inside a category's drill-down list. */
export interface CashFlowExpenseRow {
  id: string;
  business_date: string;
  description: string;
  amount: number;
  occurred_at: string;
  note: string | null;
}

/** A category aggregate with nested expense list (drill-down). */
export interface CashFlowExpenseCategory {
  category_id: string | null;
  category_name: string;
  amount: number;
  pct: number;
  expenses: CashFlowExpenseRow[];
}
```

If the codebase has a `CashFlowOverview` envelope type that lists `top_categories`, update it too:

```ts
export interface CashFlowOverview {
  in: number;
  out: number;
  net: number;
  by_day: CashFlowDayPoint[];
  expense_breakdown: CashFlowExpenseCategory[];  // was: top_categories: CashFlowTopCategory[]
  prev_in?: number;
  prev_out?: number;
  prev_net?: number;
}
```

If `CashFlowTopCategory` is no longer referenced anywhere after this change, REMOVE it. Verify with:
```bash
grep -rn "CashFlowTopCategory" src/
```
Should return 0 matches after edits (the `top-categories-table.tsx` will be deleted in Task 7).

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: errors in files that still reference the OLD types (top_categories field on RPC return, CashFlowTopCategory). These errors are EXPECTED and will be resolved by Tasks 5-7. Note any errors and proceed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "$(cat <<'EOF'
types: update CashFlow types for per-day breakdown

CashFlowDayPoint now includes safe_deposit. Adds CashFlowExpenseRow
and CashFlowExpenseCategory (category + nested expenses array).
Removes CashFlowTopCategory (superseded by CashFlowExpenseCategory).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: New `<ExpenseBreakdownTable>` component

**Files:**
- Create: `src/features/cashflow/expense-breakdown-table.tsx`

This component replaces `TopCategoriesTable`. It shows all categories sorted by amount, optionally filtered to a single day (via `selectedDate` prop), with each row expandable to show individual expenses.

- [ ] **Step 1: Create the file**

Create `src/features/cashflow/expense-breakdown-table.tsx`:

```tsx
"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatVND } from "@/lib/format";
import type { CashFlowExpenseCategory } from "@/lib/types";

interface ExpenseBreakdownTableProps {
  /** Full breakdown from RPC (all categories with nested expenses). */
  rows: CashFlowExpenseCategory[];
  /** If set, filter expenses to this single date (YYYY-MM-DD). */
  selectedDate: string | null;
  /** Called when the "Tất cả" pill is clicked to clear the date filter. */
  onClearDate(): void;
}

function formatDayLabel(iso: string): string {
  // "2026-05-28" → "28/05/2026"
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Cashflow expense breakdown with master-detail accordion:
 *   - rows: one row per category (name, amount, % of total)
 *   - selectedDate=null: shows all categories aggregated over the whole period
 *   - selectedDate!=null: client-side filters each category's expenses to that
 *     date, recomputes category-local amount + pct based on the day's total
 *   - row click toggles inline expand showing the individual expenses
 */
export function ExpenseBreakdownTable({
  rows,
  selectedDate,
  onClearDate,
}: ExpenseBreakdownTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (!selectedDate) {
      return rows;
    }
    return rows
      .map((row) => ({
        ...row,
        expenses: row.expenses.filter((e) => e.business_date === selectedDate),
      }))
      .filter((row) => row.expenses.length > 0)
      .map((row) => ({
        ...row,
        amount: row.expenses.reduce((sum, e) => sum + e.amount, 0),
      }));
  }, [rows, selectedDate]);

  const total = useMemo(
    () => filtered.reduce((sum, r) => sum + r.amount, 0),
    [filtered],
  );

  // Stable row key — category_id can be null for "(chưa phân loại)"
  function rowKey(row: CashFlowExpenseCategory): string {
    return row.category_id ?? `__null__::${row.category_name}`;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>
            Hạng mục chi
            {selectedDate && (
              <span className="ml-2 font-normal text-muted">
                · ngày {formatDayLabel(selectedDate)}
              </span>
            )}
          </CardTitle>
          {selectedDate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClearDate}
              trailingIcon={<Icon name="x" size={14} />}
            >
              Tất cả
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {filtered.length === 0 ? (
          <EmptyState
            icon="wallet"
            title={
              selectedDate
                ? `Ngày ${formatDayLabel(selectedDate)} không có khoản chi`
                : "Chưa có chi phí trong kỳ"
            }
            subtitle={
              selectedDate
                ? "Chọn ngày khác hoặc bấm Tất cả để xem cả kỳ."
                : "Khi có expense thì hạng mục sẽ hiện ở đây."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-2 text-xs font-medium uppercase tracking-wider text-muted w-8" />
                  <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Hạng mục
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Số tiền
                  </th>
                  <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted w-16">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const key = rowKey(row);
                  const isOpen = expanded.has(key);
                  const pct = total === 0 ? 0 : row.amount / total;
                  return (
                    <Fragment key={key}>
                      <tr
                        className="border-b border-border last:border-0 cursor-pointer hover:bg-surface-muted"
                        onClick={() => toggleExpanded(key)}
                      >
                        <td className="py-3 pr-2 text-muted">
                          <Icon
                            name="chevronDown"
                            size={14}
                            className={cn(
                              "transition-transform",
                              isOpen ? "" : "-rotate-90",
                            )}
                          />
                        </td>
                        <td className="py-3 px-2 text-ink">
                          {row.category_name}
                        </td>
                        <td className="py-3 px-2 text-right tabular-nums text-ink">
                          {formatVND(row.amount)}
                        </td>
                        <td className="py-3 pl-2 text-right tabular-nums text-muted">
                          {(pct * 100).toFixed(0)}%
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-surface-muted/40">
                          <td colSpan={4} className="px-4 py-3">
                            <ul className="space-y-1.5">
                              {row.expenses.map((e) => (
                                <li
                                  key={e.id}
                                  className="flex items-start justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0 flex-1">
                                    <span className="text-muted mr-2">
                                      {formatDayLabel(e.business_date)}
                                    </span>
                                    <span className="text-ink">
                                      {e.description}
                                    </span>
                                    {e.note && (
                                      <span className="text-muted ml-2">
                                        · {e.note}
                                      </span>
                                    )}
                                  </div>
                                  <strong className="tabular-nums text-ink shrink-0">
                                    {formatVND(e.amount)}
                                  </strong>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Verify icon name `x` exists**

```bash
grep -E "\"x\":|x:" src/components/ui/icons.tsx | head -3
```
If `x` not in the icon set, use whatever close-icon alias exists (e.g. `xmark`, `close`). Adjust the `<Icon name="x" />` call accordingly. Lucide ships `x` so this should be fine.

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: still errors in `cash-flow-view.tsx` and `cash-flow-chart.tsx` (will be resolved by Tasks 6-7). The new file itself should typecheck.

- [ ] **Step 4: Commit**

```bash
git add src/features/cashflow/expense-breakdown-table.tsx
git commit -m "$(cat <<'EOF'
feat(cashflow): ExpenseBreakdownTable component

Replaces TopCategoriesTable with a master-detail accordion: all
categories sorted by amount, each row expandable to show the
individual expenses. When selectedDate is set, client-side filters
each category to expenses on that day, recomputes category amount
and percent based on the day's total.

Component tests deferred to Phase 6.B per vitest config policy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Modify `cash-flow-chart.tsx` (Bar → ComposedChart + Line + onClick)

**Files:**
- Modify: `src/features/cashflow/cash-flow-chart.tsx`

- [ ] **Step 1: Read the current file**

```bash
cat src/features/cashflow/cash-flow-chart.tsx
```

Current uses `BarChart` with 2 Bars (`in`, `out`). We replace with `ComposedChart`, add a `Line` for `safe_deposit`, and wire bar `onClick` → `onSelectDate(date)`.

- [ ] **Step 2: Replace file contents**

Overwrite `src/features/cashflow/cash-flow-chart.tsx`:

```tsx
"use client";

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardBody } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { CashFlowDayPoint } from "@/lib/types";

interface CashFlowChartProps {
  byDay: CashFlowDayPoint[];
  /** ISO date "YYYY-MM-DD" of the currently filtered day, or null for "all". */
  selectedDate: string | null;
  /** Called when user clicks a bar — passes the bar's date. */
  onSelectDate(date: string): void;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function abbreviateVND(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm bg-ink text-white text-xs px-2 py-1.5 shadow-popover space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="tabular-nums">
          <span style={{ color: entry.color }}>●</span>{" "}
          {entry.name === "in"
            ? "Thu"
            : entry.name === "out"
              ? "Chi"
              : "Nạp két"}
          : {formatVND(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function CashFlowChart({
  byDay,
  selectedDate,
  onSelectDate,
}: CashFlowChartProps) {
  // We preserve `date` (raw ISO) for click handlers; `date_label` (DD/MM)
  // is only for axis display.
  const data = byDay.map((d) => ({
    date: d.date,
    date_label: shortDate(d.date),
    in: d.in,
    out: d.out,
    safe_deposit: d.safe_deposit,
  }));

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-ink">Thu / Chi theo ngày</h3>
          {selectedDate && (
            <span className="text-xs text-muted">
              Click bar khác để đổi ngày
            </span>
          )}
        </div>
        <div className="w-full" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 16, right: 8, left: 0, bottom: 8 }}
            >
              <XAxis
                dataKey="date_label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted)" }}
              />
              <YAxis
                tickFormatter={abbreviateVND}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted)" }}
                width={40}
              />
              <RechartsTooltip
                cursor={{ fill: "var(--color-border)", opacity: 0.2 }}
                content={<ChartTooltip />}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) =>
                  value === "in"
                    ? "Thu"
                    : value === "out"
                      ? "Chi"
                      : "Nạp két"
                }
              />
              <Bar
                dataKey="in"
                fill="var(--color-success)"
                radius={[6, 6, 0, 0]}
                cursor="pointer"
                onClick={(payload: { date?: string }) =>
                  payload?.date && onSelectDate(payload.date)
                }
                fillOpacity={1}
              />
              <Bar
                dataKey="out"
                fill="var(--color-danger)"
                radius={[6, 6, 0, 0]}
                cursor="pointer"
                onClick={(payload: { date?: string }) =>
                  payload?.date && onSelectDate(payload.date)
                }
                fillOpacity={1}
              />
              <Line
                type="monotone"
                dataKey="safe_deposit"
                stroke="var(--color-warning)"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "var(--color-warning)" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
```

**Notes:**
- Recharts Bar `onClick` payload signature: `(data, index)` — we only need `data.date`. The cast `{ date?: string }` is conservative — at runtime recharts passes the row object.
- `selectedDate` is consumed visually only as a hint ("Click bar khác để đổi ngày"). We do NOT change bar opacity per-bar in v1 (keep visual simple). If user wants visual highlight later, can add `fill={selectedDate === d.date ? "..." : "..."}` via custom Cell render.
- `var(--color-warning)` is assumed to exist in the project's CSS variables (used elsewhere e.g. `text-warning` classes). Verify with `grep -E "color-warning" src/app/globals.css` if unsure.

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: remaining errors only in `cash-flow-view.tsx` (not yet wired) — chart itself should typecheck.

- [ ] **Step 4: Commit**

```bash
git add src/features/cashflow/cash-flow-chart.tsx
git commit -m "$(cat <<'EOF'
feat(cashflow): chart Thu/Chi adds Nạp két line overlay + bar click

Replaces BarChart with ComposedChart. Bars Thu/Chi unchanged; adds
Line series for safe_deposit (var(--color-warning) cam). Bar clicks
fire onSelectDate(date) to drive parent's breakdown filter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Modify `cash-flow-view.tsx` + delete `top-categories-table.tsx`

**Files:**
- Modify: `src/features/cashflow/cash-flow-view.tsx`
- Delete: `src/features/cashflow/top-categories-table.tsx`

- [ ] **Step 1: Read the current view file**

```bash
cat src/features/cashflow/cash-flow-view.tsx
```

Note the imports (esp. `TopCategoriesTable`) and the JSX structure (currently `<CashFlowChart byDay={...} />` and `<TopCategoriesTable rows={query.data?.top_categories ?? []} />`).

- [ ] **Step 2: Replace file contents**

Overwrite `src/features/cashflow/cash-flow-view.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import { useCashFlowOverviewQuery } from "@/hooks/queries";
import {
  getCurrentMonthRange,
  getPreviousPeriod,
} from "@/lib/period-math";
import type { PeriodState, UserRole } from "@/lib/types";
import { PeriodSelector } from "./period-selector";
import { CashFlowKpiBar } from "./cash-flow-kpi-bar";
import { CashFlowChart } from "./cash-flow-chart";
import { ExpenseBreakdownTable } from "./expense-breakdown-table";
import { LunarCalendarWidget } from "./lunar-calendar-widget";

interface CashFlowViewProps {
  role: UserRole;
}

function defaultPeriod(): PeriodState {
  const r = getCurrentMonthRange();
  return { preset: "month", start: r.start, end: r.end };
}

export function CashFlowView({ role }: CashFlowViewProps) {
  const supabase = useSupabase();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const compare = useMemo(
    () => getPreviousPeriod(period.start, period.end, period.preset),
    [period.start, period.end, period.preset],
  );

  const query = useCashFlowOverviewQuery(
    supabase,
    {
      start: period.start,
      end: period.end,
      compareStart: compare.start,
      compareEnd: compare.end,
    },
    role === "owner" || role === "manager",
  );

  if (role !== "owner" && role !== "manager") {
    return (
      <EmptyState
        icon="lock"
        title="Module dành cho owner/manager"
        subtitle="Bạn chưa có quyền vào trang này."
      />
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dòng tiền">
        {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  return (
    <div className="space-y-6">
      <PeriodSelector value={period} onChange={setPeriod} />
      <CashFlowKpiBar data={query.data} preset={period.preset} />
      <CashFlowChart
        byDay={query.data?.by_day ?? []}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <ExpenseBreakdownTable
          rows={query.data?.expense_breakdown ?? []}
          selectedDate={selectedDate}
          onClearDate={() => setSelectedDate(null)}
        />
        <LunarCalendarWidget start={period.start} end={period.end} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Delete `top-categories-table.tsx`**

```bash
rm src/features/cashflow/top-categories-table.tsx
```

- [ ] **Step 4: Verify no orphan references**

```bash
grep -rn "TopCategoriesTable\|top-categories-table\|CashFlowTopCategory\|top_categories" src/ 2>&1 | head
```
Expected: no matches in `src/`. If any matches remain (e.g. in `src/lib/data/` or `src/hooks/queries/`), update them to reference `expense_breakdown` / `CashFlowExpenseCategory` instead.

- [ ] **Step 5: Verify typecheck**

```bash
npx tsc --noEmit 2>&1 | tail -10
```
Expected: 0 errors.

- [ ] **Step 6: Verify vitest**

```bash
npx vitest run 2>&1 | tail -10
```
Expected: all tests pass (no new tests added in this task; existing pure-helper tests remain green).

- [ ] **Step 7: Commit**

```bash
git add -A src/features/cashflow/
git commit -m "$(cat <<'EOF'
feat(cashflow): wire selectedDate, mount ExpenseBreakdownTable

CashFlowView now owns selectedDate state. Chart click sets it; new
ExpenseBreakdownTable consumes it for per-day filtering with "Tất cả"
clear button. Deletes top-categories-table.tsx (superseded).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: End-to-end verify + push PR + tag v4.1.15

- [ ] **Step 1: Full local verification**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

```bash
npx vitest run
```
Expected: all tests pass.

```bash
npm run verify:phase 2>&1 | tail -20
```
Expected: all pgTAP green including the updated 200_cash_flow_overview.sql.

- [ ] **Step 2: Manual smoke on dev preview (port 3009)**

Login owner. Navigate to `/cash-flow`.

1. Default view: full breakdown for current period (no day selected). Chart shows 3 series in legend: Thu (xanh) / Chi (đỏ) / Nạp két (cam line).
2. Click a bar in chart → header table changes to "Hạng mục chi · ngày DD/MM/YYYY", "Tất cả ✕" button appears, breakdown filters to that day.
3. Click "Tất cả ✕" → returns to period view.
4. Click a category row → expands inline showing expenses (description, amount, date, note).
5. Click another category → both expand simultaneously (multi-expand confirmed).
6. Empty day (chart has 0/0/0 for some day): click that bar → "Ngày DD/MM không có khoản chi" empty state.
7. Tooltip hover on chart shows Thu / Chi / Nạp két values.

Document any visual oddities found.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin feat/cashflow-breakdown
gh pr create --base main --title "feat: cashflow per-day breakdown + safe deposit line (v4.1.15)" --body "$(cat <<'EOF'
## Summary

Two extensions to the **Dòng tiền** (`/cash-flow`) page:

1. **Chart "Thu/Chi theo ngày" gains Nạp két line overlay** (orange Line series). Bar click → filters breakdown to that day.
2. **Top-5 categories table replaced by full ExpenseBreakdownTable** — all categories sorted by amount, accordion drill-down to individual expenses. Default shows period total; chart click switches to per-day view with "Tất cả" pill to clear.

## RPC changes

`cash_flow_overview` extended (signature unchanged, idempotent create-or-replace):

- `by_day[].safe_deposit` — sum of `cash_close_reports.safe_deposit_amount` per day (excludes `status='voided'`)
- `expense_breakdown[]` — REPLACES `top_categories[]`. Full categories sorted by amount desc, each with nested `expenses[]` array (id/date/description/amount/occurred_at/note) for drill-down

## Files

- New: `database/migrations/2026-05-28-a-cashflow-breakdown.sql`
- New: `src/features/cashflow/expense-breakdown-table.tsx`
- Modified: `database/tests/200_cash_flow_overview.sql` (10 assertions across 4 scenarios — includes safe_deposit excludes-voided check)
- Modified: `src/lib/types.ts` (CashFlowDayPoint + CashFlowExpenseRow + CashFlowExpenseCategory; removes CashFlowTopCategory)
- Modified: `src/features/cashflow/cash-flow-chart.tsx` (BarChart → ComposedChart, adds Line + onClick)
- Modified: `src/features/cashflow/cash-flow-view.tsx` (selectedDate state, wires components)
- Deleted: `src/features/cashflow/top-categories-table.tsx` (superseded by ExpenseBreakdownTable)

## Test plan

- [x] Migration applied locally
- [x] Manual SQL smoke (empty + populated + voided exclusion)
- [x] pgTAP 10/10 (extended from 8 — adds safe_deposit voided exclusion + expense_breakdown drill-down assertions)
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` all pass
- [x] Manual UI smoke per the 7 checks in plan §Task 8 step 2

## Specs + Plan

- Spec: `docs/superpowers/specs/2026-05-28-cashflow-per-day-breakdown-design.md`
- Plan: `docs/superpowers/plans/2026-05-28-cashflow-per-day-breakdown.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

The `--base main` flag is critical — gh has been picking the wrong default base for this repo. Always explicit.

- [ ] **Step 4: Watch CI**

```bash
gh pr checks --watch 2>&1 | tail -20
```
Expected: typecheck + vitest + pgtap + build all green.

If checks don't register within 1 minute, verify the PR base actually = main (`gh pr view <PR_NUM> --json baseRefName`). If it's wrong, fix with `gh pr edit <PR_NUM> --base main` and close+reopen to retrigger.

- [ ] **Step 5: Merge via API**

```bash
PR_NUM=$(gh pr view --json number --jq .number)
gh api -X PUT "repos/KaMnh/chill-coffee-erp/pulls/$PR_NUM/merge" -f merge_method=squash
```

- [ ] **Step 6: Tag v4.1.15 via API**

```bash
MAIN_SHA=$(gh api repos/KaMnh/chill-coffee-erp/commits/main --jq .sha)
gh api -X POST repos/KaMnh/chill-coffee-erp/git/refs -f ref="refs/tags/v4.1.15" -f sha="$MAIN_SHA"
```

This triggers `release.yml` which builds the Docker image tagged `v4.1.15`, `4.1`, `latest`.

- [ ] **Step 7: Verify release**

```bash
gh run list --workflow=release.yml --limit 2
```
Expected: a new "release" run for v4.1.15, status in_progress or completed. Wait for green.

---

## Self-Review Summary

1. **Spec coverage check**:
   - §1 Goal — chart 3 series + bar click + master-detail accordion: Tasks 5, 6, 7 cover.
   - §3.2 RPC: Task 1.
   - §3.3 frontend changes: Tasks 5, 6, 7.
   - §3.4 types: Task 4.
   - §5 verification: Tasks 2, 3, 8.
   - §6 execution order: matches Tasks 1-8.
   - §7 open assumptions — `top_categories` REMOVE: confirmed in Task 7 (deletes file, replaces field name in RPC + types). Voided exclusion: Task 1 SQL + Task 3 assertion 10. Performance JSONB size: noted in spec.

2. **Placeholder scan**: No "TBD" / "TODO" / "implement later" / "add appropriate" patterns. Every step has runnable code or commands with expected output.

3. **Type consistency**:
   - `CashFlowExpenseCategory.expenses: CashFlowExpenseRow[]` (Task 4) — matches the rendered `row.expenses.filter(...)` in `<ExpenseBreakdownTable>` (Task 5).
   - `CashFlowDayPoint.safe_deposit: number` (Task 4) — matches `d.safe_deposit` in chart `data.map` (Task 6) and `by_day[].safe_deposit` from RPC (Task 1).
   - `onSelectDate(date: string)` callback shape consistent between chart (Task 6) and view (Task 7).
   - `selectedDate: string | null` consistent across chart (Task 6), breakdown (Task 5), view (Task 7).
