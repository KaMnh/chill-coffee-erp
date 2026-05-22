# Phase 5.C — Expense + Payroll Reports Design

**Parent:** `docs/superpowers/specs/2026-05-22-v4-phase-5-overall-design.md`
**Scope:** Third analytics sub-phase. Multi-day aggregations of expenses (by category) and payroll (by employee). Replaces the "Chi phí + lương" placeholder tab from Phase 5.A. Reuses the `DateRangePicker` primitive.
**Branch:** `phase-5c-expense-payroll-reports` (off `main` @ tag `v4-phase-5b`)
**Tag at end:** `v4-phase-5c`

---

## 0. TL;DR

- 5 new files + 5 modified.
- 2 new RPCs in `002_functions.sql`: `expense_summary_by_category` + `payroll_summary_by_employee`.
- 1 new pgTAP file `180_expense_payroll_reports.sql` with **10 assertions**.
- `ReportsView`'s `expense_payroll` placeholder replaced with `<ExpensePayrollTab />`.
- `verify:phase` after merge: **75 Vitest + 120 pgTAP = 195 total**.

---

## 1. Goal

Surface owner/manager-facing aggregations of cash going OUT — both vendor expenses (by category) and staff payroll (by employee) — over arbitrary date ranges. Answers:

- "How much did I spend on rent vs utilities vs inventory this month?"
- "Who did I pay the most this week, and how many hours did they work?"
- "What's my biggest expense category right now?"

These are the **first multi-day expense + payroll aggregations** in v4. Existing per-day views (`ExpensesView`, `ShiftsView`/`PayrollHistoryCard`) cover same-day op checks but force the owner to mentally aggregate across days.

---

## 2. Non-goals (specific to 5.C)

- No payment_method dimension on either report (skip — see §3 decision; owner drills into existing history cards for per-record method detail)
- No per-payment-method KPI strip across both reports (option C from brainstorming was rejected)
- No expense-vs-revenue / payroll-vs-revenue ratios (cross-domain — defer)
- No daily breakdown / time-series chart (flat aggregation only, matches 5.A/5.B grain)
- No CSV/Excel export
- No `(đã nghỉ)` annotation for inactive employees in payroll table — owner identifies by name/context
- No drill-down click from row → that record's history (deferred to Phase 5.+ if requested)
- No standalone view (lives inside ReportsView; existing ExpensesView + ShiftsView untouched)

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Tab content | **2 reports stacked** — Expense by Category + Payroll by Employee (matches 5.A/5.B precedent) |
| Payment-method handling | **Skip** — both tables omit payment_method column. Owner drills into PayrollHistoryCard / ExpenseHistoryCard for per-record detail. Simplest, matches 5.A/5.B grain. |
| Expense table columns | **3-col** — Danh mục / Tổng tiền / Số lần |
| Payroll table columns | **4-col** — Nhân viên / Tổng lương / Số ca / Tổng giờ (`total_minutes` included server-side because aggregation is free; column adds genuine value) |
| Default sort | **total amount DESC** for both ("largest first") |
| Default date range | **Tuần này** (Monday → today, consistent with 5.A/5.B) |
| DateRangePicker | **Shared** — one picker drives both tables |
| Inactive category/employee handling | **Include in report** — historical records must surface. No annotation. |
| NULL `category_id` on expenses | UI displays as **"Chưa phân loại"** (consistent with 5.B) |
| Query-key namespace | New `"expense-payroll-reports"` root, decoupled from prior 3 |

---

## 4. Architecture

### 4.1 ReportsView tab swap

The 5.A refactor added 5 tabs to ReportsView. 5.C replaces ONE placeholder:

```tsx
// Before (5.A + 5.B unchanged):
<TabsContent value="expense_payroll">
  <EmptyState icon="wallet" title="Chi phí + lương"
              subtitle="Phát hành trong giai đoạn 5.C — …" dashedBorder />
</TabsContent>

// After (5.C):
<TabsContent value="expense_payroll">
  <ExpensePayrollTab />
</TabsContent>
```

All other tabs (Cash Close, Tồn kho 5.A, Doanh số 5.B, Theo giờ 5.D placeholder) untouched.

### 4.2 ExpensePayrollTab composition

```
ExpensePayrollTab (no props)
├── useState<DateRange> (lazy-init defaultDateRange)
├── DateRangePicker (shared from 5.A) — controls dateRange
├── Section 1: ExpenseByCategoryTable (dateRange)
│   └── useExpenseSummaryByCategoryQuery → expense_summary_by_category RPC
└── Section 2: PayrollSummaryTable (dateRange)
    └── usePayrollSummaryByEmployeeQuery → payroll_summary_by_employee RPC
```

Single source of truth for date range. Both tables re-key TanStack Query when range changes. Same shape as `InventoryAnalyticsTab` (5.A) and `SalesByProductTab` (5.B).

### 4.3 Role gating

Inherited from ReportsView's NAV_ITEMS gate: owner + manager + staff_operator. employee_viewer blocked. No write controls — all reports read-only.

### 4.4 Data flow

```
ExpensePayrollTab
  ├── useState<DateRange> (default = "Tuần này")
  └── DateRangePicker controls dateRange

ExpenseByCategoryTable (dateRange)
  ├── useSupabase()
  └── useExpenseSummaryByCategoryQuery(supabase, dateRange.from, dateRange.to, true)
      → supabase.rpc("expense_summary_by_category", { p_from, p_to })

PayrollSummaryTable (dateRange)
  ├── useSupabase()
  └── usePayrollSummaryByEmployeeQuery(supabase, dateRange.from, dateRange.to, true)
      → supabase.rpc("payroll_summary_by_employee", { p_from, p_to })
```

Both queries: `staleTime: 60_000`. Both null-guarded via `enabled: !!supabase && enabled`.

---

## 5. RPC specs (full SQL)

### 5.1 `expense_summary_by_category`

```sql
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
```

Notes:
- `LEFT JOIN` because `expenses.category_id` is nullable. A NULL row surfaces as `category_id = NULL, category_name = NULL` → UI renders "Chưa phân loại".
- No `c.is_active` filter — historical expenses against deactivated categories must surface. The category name still resolves via the JOIN.
- `count(*)::int` (not `bigint`) — consistent supabase-js JS-number defense from 5.A T2 / 5.B T1 fixes.
- `STABLE`, no `SECURITY DEFINER`. Existing RLS on `expenses` + `expense_categories` allows SELECT for `authenticated`.
- Sort: `total_amount DESC`.

### 5.2 `payroll_summary_by_employee`

```sql
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
- INNER JOIN — `shift_payroll_records.employee_id` is NOT NULL per schema. Every record has a valid employee.
- No `e.is_active` filter — historical pay records for now-inactive employees must surface.
- 5 return columns (4 displayed in UI; the 5th `employee_id` is the React row key).
- Both numerics cast to `::int` / `::numeric` defensively.
- `STABLE`, no `SECURITY DEFINER`. Existing RLS on `shift_payroll_records` + `employees` allows SELECT for `authenticated`.
- Sort: `total_pay DESC`.

### 5.3 pgTAP test plan (`180_expense_payroll_reports.sql`)

**10 assertions** (top-level SELECT pattern, no DO blocks per 5.A/5.B learnings):

```
expense_summary_by_category (5):
  1. Empty range returns 0 rows
  2. sum(amount) correct across multiple expenses in same category
  3. expense_count = count(*) per category (verify with 3 expenses in 1 cat)
  4. NULL category_id produces its own row with category_name = NULL
  5. Sort is ORDER BY total_amount DESC (verified via limit 1)

payroll_summary_by_employee (5):
  6. Empty range returns 0 rows
  7. sum(total_pay) correct across multiple shifts for same employee
  8. shift_count = count(*) per employee (verify with 2 shifts)
  9. sum(total_minutes) correct across shifts
 10. Sort is ORDER BY total_pay DESC (verified via limit 1)
```

Same `act_as` impersonation + `auth.users` seed pattern as Phase 4 / 5.A / 5.B tests. All assertions top-level `select is(...)`. File wrapped in `begin; select plan(10); … select * from finish(); rollback;`.

---

## 6. File manifest

### 6.1 New files (5)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `database/tests/180_expense_payroll_reports.sql` | ~210 | pgTAP — 10 assertions |
| `src/features/reports/expense-payroll-tab.tsx` | ~30 | Composes DateRangePicker + 2 tables |
| `src/features/reports/expense-by-category-table.tsx` | ~100 | 3-column expense table |
| `src/features/reports/payroll-summary-table.tsx` | ~115 | 4-column payroll table (inline `formatHours`) |
| `src/hooks/queries/use-expense-payroll-reports-query.ts` | ~50 | 2 query hooks |

### 6.2 Modified files (5)

| Path | Change |
|------|--------|
| `database/002_functions.sql` | Append 2 RPCs at EOF |
| `src/lib/data/reports.ts` | Append 2 wrapper functions + 2 row interfaces |
| `src/hooks/queries/keys.ts` | Append 2 keys under new `"expense-payroll-reports"` namespace |
| `src/hooks/queries/index.ts` | Re-export new hook file |
| `src/features/reports/reports-view.tsx` | Swap `expense_payroll` placeholder for `<ExpensePayrollTab />`, add import |

### 6.3 Off-limits

- `database/001_schema.sql` — no schema changes
- `database/003_rls.sql` — existing RLS on expenses / expense_categories / shift_payroll_records / employees allows SELECT
- `src/lib/types.ts` — row interfaces stay in the data layer file (5.A/5.B pattern)
- `src/features/expenses/**` — existing ExpensesView untouched
- `src/features/shifts/**` — existing ShiftsView untouched
- All Phase 2/3/4/5.A/5.B primitives and modules

---

## 7. Component specs

### 7.1 ExpenseByCategoryTable

```tsx
interface ExpenseByCategoryTableProps {
  dateRange: DateRange;
}
```

**4 branches:**

| Branch | Render |
|--------|--------|
| loading | `<div className="flex justify-center py-8"><Spinner size={24} /></div>` |
| error | `<AlertBanner variant="danger" title="Không tải được báo cáo chi phí">Vui lòng tải lại trang. Lỗi: {message}</AlertBanner>` |
| empty | `<EmptyState dashedBorder icon="wallet" title="Chưa có chi phí trong khoảng này" subtitle="Đổi khoảng thời gian hoặc nhập chi phí mới." />` |
| data | Card with 3-column table |

**Table structure:**

```tsx
<Card>
  <CardBody>
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h3 className="text-sm font-medium text-ink">Chi phí theo danh mục</h3>
      <Badge variant="soft" semantic="neutral">{data.length} danh mục</Badge>
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
          <tr key={row.category_id ?? `null-${i}`} className="border-t border-border">
            <td className="py-2 text-ink">{row.category_name ?? "Chưa phân loại"}</td>
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
```

Row key uses `row.category_id ?? \`null-${i}\`` — defensive against multiple NULL rows (GROUP BY collapses to one, but defense costs nothing).

### 7.2 PayrollSummaryTable

```tsx
interface PayrollSummaryTableProps {
  dateRange: DateRange;
}
```

**4 branches** (same template as 7.1). Empty state uses `icon="users"` + payroll-specific copy.

**Table structure:**

```tsx
<Card>
  <CardBody>
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h3 className="text-sm font-medium text-ink">Lương theo nhân viên</h3>
      <Badge variant="soft" semantic="neutral">{data.length} nhân viên</Badge>
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
```

**Inline `formatHours` helper:**

```ts
function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} giờ`;
  return `${h} giờ ${String(m).padStart(2, "0")}`;
}
```

Examples: `505 minutes` → `"8 giờ 25"`, `480 minutes` → `"8 giờ"`, `0 minutes` → `"0 giờ"`.

Row key uses `row.employee_id` directly — schema guarantees NOT NULL.

### 7.3 ExpensePayrollTab

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

### 7.4 ReportsView swap

In `src/features/reports/reports-view.tsx`, replace:

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

with:

```tsx
<TabsContent value="expense_payroll">
  <ExpensePayrollTab />
</TabsContent>
```

Add import: `import { ExpensePayrollTab } from "./expense-payroll-tab";`

---

## 8. Data layer + query hooks

### 8.1 Data layer (`src/lib/data/reports.ts` — append at EOF)

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

### 8.2 Query keys (`src/hooks/queries/keys.ts` — append inside `queryKeys` object)

```ts
// Phase 5.C — Expense + payroll reports
expenseSummaryByCategory: (range: { from: string; to: string }) =>
  ["expense-payroll-reports", "expense_category", range] as const,
payrollSummaryByEmployee: (range: { from: string; to: string }) =>
  ["expense-payroll-reports", "payroll_employee", range] as const,
```

New `"expense-payroll-reports"` root, decoupled from `"reports"` (Cash Close), `"inventory-reports"` (5.A), `"sales-reports"` (5.B).

### 8.3 Query hooks (`src/hooks/queries/use-expense-payroll-reports-query.ts` — new)

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

### 8.4 Barrel export

`src/hooks/queries/index.ts` — append line:

```ts
export * from "./use-expense-payroll-reports-query";
```

---

## 9. Vietnamese strings (locked for 5.C)

| String | Usage |
|--------|-------|
| Chi phí theo danh mục | Expense table heading |
| Lương theo nhân viên | Payroll table heading |
| Danh mục | Expense table column header |
| Tổng tiền | Expense table column header |
| Số lần | Expense table column header |
| Nhân viên | Payroll table column header |
| Tổng lương | Payroll table column header |
| Số ca | Payroll table column header |
| Tổng giờ | Payroll table column header |
| {N} danh mục | Expense table badge |
| {N} nhân viên | Payroll table badge |
| Chưa phân loại | NULL category_name fallback |
| Chưa có chi phí trong khoảng này | Expense EmptyState title |
| Đổi khoảng thời gian hoặc nhập chi phí mới. | Expense EmptyState subtitle |
| Chưa có lương trong khoảng này | Payroll EmptyState title |
| Đổi khoảng thời gian hoặc tạo ca chấm công mới. | Payroll EmptyState subtitle |
| Không tải được báo cáo chi phí | Expense AlertBanner title |
| Không tải được báo cáo lương | Payroll AlertBanner title |
| Vui lòng tải lại trang. Lỗi: {message} | AlertBanner body (both tables) |
| {N} giờ {MM} | Hours format ("8 giờ 25"); when minutes=0 → "{N} giờ" only |

All terms align with the Phase 5 overall glossary (§6 of `2026-05-22-v4-phase-5-overall-design.md`).

---

## 10. Error handling

| Source | Behavior |
|--------|----------|
| `useExpenseSummaryByCategoryQuery` error | Expense section AlertBanner.danger ("Không tải được báo cáo chi phí") |
| `usePayrollSummaryByEmployeeQuery` error | Payroll section AlertBanner.danger ("Không tải được báo cáo lương") |
| Empty range | Per-section EmptyState (dashedBorder) |
| Date range invalid (from > to) | Postgres returns 0 rows → EmptyState shows. DateRangePicker doesn't validate (known minor gap, deferred) |
| RPC fails (network / 500) | `toAppError` wraps → AlertBanner shows wrapped message |
| `total_minutes = 0` | Renders as `"0 giờ"` — informative |
| Inactive category/employee | Still surfaces in report — historical data preserved |

---

## 11. Risk register

| Risk | Mitigation |
|------|------------|
| NULL `category_id` row sort position | Postgres sorts NULLs last with DESC. UI shows "Chưa phân loại" — informative. |
| Inactive employee/category in reports | Documented as intentional (§3). Owner identifies by name; no `(đã nghỉ)` annotation per scope decision. |
| RPC perf on large `shift_payroll_records` / `expenses` | Existing `business_date` indexes on both tables cover the filter. Coffee-shop scale fine. |
| `formatHours` duplication risk | Inline in `payroll-summary-table.tsx`. If 3rd consumer appears (Phase 5.+), extract to `@/lib/format`. |
| `total_minutes = 0` rendering | "0 giờ" displays correctly; consistent with `formatHours(0)` logic. Possible for cancelled shifts that still got a payroll record. |
| Cross-namespace query-key collision | New `"expense-payroll-reports"` root explicitly separate from prior 3 namespaces. |
| Sort default DESC may not match user's mental model | "Largest first" matches sales report (revenue DESC); consistent UX across 5.B/5.C. DataTable could allow runtime sort, but spec sticks with server-side default. |

---

## 12. Implementation strategy (task projection)

**6 tasks** (same shape as 5.B):

| Task | Files | Verify |
|------|-------|--------|
| **T1** | `database/002_functions.sql` (+2 RPCs) + `database/tests/180_expense_payroll_reports.sql` (10 assertions) | 120 pgTAP, 75 Vitest |
| **T2** | `src/lib/data/reports.ts` (+2 wrappers + 2 types) · `src/hooks/queries/keys.ts` (+2 keys) · `src/hooks/queries/use-expense-payroll-reports-query.ts` (new) · `index.ts` re-export | `tsc --noEmit` clean |
| **T3** | `src/features/reports/expense-by-category-table.tsx` (new — 3-col) | TS + verify:phase |
| **T4** | `src/features/reports/payroll-summary-table.tsx` (new — 4-col, inline `formatHours`) | TS + verify:phase |
| **T5** | `src/features/reports/expense-payroll-tab.tsx` (new) — composes T3 + T4 + DateRangePicker | TS + verify:phase |
| **T6** | `src/features/reports/reports-view.tsx` — swap placeholder for `<ExpensePayrollTab />`, smoke test 4 roles, tag `v4-phase-5c` | Final verify:phase = 195 green |

---

## 13. Success criteria

1. ✅ `npm run verify:phase` ends at **75 Vitest + 120 pgTAP = 195 green** (110 pre-5.C + 10 new in 180)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ "Chi phí + lương" tab renders both tables driven by shared DateRangePicker
5. ✅ Switching presets re-fetches both tables
6. ✅ Custom date range filters correctly
7. ✅ Empty range → both EmptyStates show
8. ✅ NULL `category_id` expense → "Chưa phân loại" row in Expense table
9. ✅ `formatHours(505)` → "8 giờ 25"; `formatHours(480)` → "8 giờ"; `formatHours(0)` → "0 giờ"
10. ✅ Inactive employees/categories still appear in respective tables
11. ✅ Cash Close + Tồn kho (5.A) + Doanh số (5.B) tabs unchanged
12. ✅ Theo giờ placeholder unchanged (5.D pending)
13. ✅ Manager + staff_operator: same view as owner (read-only)
14. ✅ employee_viewer: cannot reach ReportsView
15. ✅ pgTAP 180 file: 10/10 assertions pass
16. ✅ Tag `v4-phase-5c` on final merge commit

---

## 14. Open decisions (deferred to writing-plans / execution)

- **`(đã nghỉ)` annotation for inactive employees** — deferred. Owner identifies by name/context. Easy 1-line follow-up if pushback during T6 smoke.
- **Click-through drill-down** — clicking a category row could open that category's expense history. Deferred to Phase 5.+ if requested.
- **Excel/CSV export** — deferred to Phase 5.+ (5.A and 5.B also deferred).
- **Top-N pagination** — coffee shop scale doesn't need it. Revisit if `expense_count` or `shift_count` ever exceeds ~100 rows.
- **Per-payment-method breakdown** — explicitly excluded per §3 decision.

---

## 15. Self-review

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in normative sections (§§3–13). §14 explicitly labels Open decisions for future patches.

**Internal consistency:**
- File count: 5 new + 5 modified (§6) ✓
- 6 tasks (§12) ✓
- 2 RPCs (§5 + §6) ✓
- 10 pgTAP assertions (§5.3 + §13) ✓
- Both tables follow 4-branch render pattern (§7) ✓
- DateRangePicker reused from 5.A (§4 + §7.3) ✓
- "expense-payroll-reports" namespace explicit (§8.2) ✓
- `formatHours` defined exactly once (§7.2 with examples in §13) ✓

**Ambiguity check:**
- "Flat aggregation" defined explicitly — one row per (category_id) / (employee_id) tuple
- "Skip payment_method" defined explicitly + reasoning in §3
- "Inactive records preserved" defined explicitly in §3 + §11
- "Sort default" defined explicitly — total amount DESC for both
- Role gating uniform across tabs (§4.3)
- `formatHours(0)` behavior locked in §13

**Scope check:** UI + 2 RPCs + 10 assertions. Manageable in 6 tasks. Matches 5.A/5.B scale.

No issues found.

---

## 16. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 6-task implementation plan with full SQL + TSX code inline per task.
