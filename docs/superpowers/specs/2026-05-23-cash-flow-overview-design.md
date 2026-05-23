# Cash Flow Overview Module — Design Spec

**Date:** 2026-05-23
**Branch (to be created):** `claude/cash-flow-overview` (or stacked on the user-management branch — decided at implementation time)
**Base:** `phase-6a-ci-foundation`
**Predecessor:** user-management UI (concurrent, unmerged)
**Tag at end:** none — feature branch

---

## 0. TL;DR

Add a new top-level sidebar module **"Dòng tiền"** that gives owner/manager a
period-aggregated overview of cash flow: total IN (revenue) vs total OUT
(expenses + payroll), the net delta, a daily IN/OUT chart, a top-5 expense
categories table, and a Vietnamese lunar+solar calendar widget for the
selected period. Period selector supports `Tuần này` / `Tháng này` / custom
date range. All data flows through a single new RPC
`cash_flow_overview(p_start, p_end[, p_compare_start, p_compare_end])`
that returns one JSONB blob with KPIs, daily series, top categories, and
optionally previous-period comparison.

---

## 1. Goal

Deliver an owner/manager-only module that answers three financial questions
at a glance:

1. How much cash came in / went out over the selected period?
2. How does that compare to the previous comparable period?
3. Where is the money going? (top expense categories)

Plus the secondary requirement: surface the **lunar calendar** alongside the
solar dates because Vietnamese business cadence (Tết, rằm, mùng 1, lễ) is
tied to it.

**Acceptance criteria:**

- Owner login → sidebar shows new "Dòng tiền" item (between Reports and
  Pivot, or wherever owner-customised). Click → CashFlowView renders.
- Default landing period = current calendar month.
- Three preset chips (`Tuần này` / `Tháng này` / `Tuỳ chỉnh`) toggle the
  period and recompute everything reactively.
- KPI bar shows `Tổng vào` / `Tổng ra` / `Chênh lệch` with % delta vs the
  immediately-preceding comparable period.
- Daily chart shows grouped IN+OUT bars per day in the period.
- Top-5 expense categories table shows category name + amount + % of total.
- Lunar calendar widget shows every day in the period with solar (large) +
  lunar (small) labels, and badges 6 hard-coded lunar holidays + monthly
  mùng-1 / rằm markers.
- Staff_operator / employee_viewer cannot navigate to "Dòng tiền" (gated
  by NAV_ITEMS.roles).
- `npm run verify:phase` passes — including new pgTAP tests for the RPC
  and new Vitest tests for the lunar helper and period math.

---

## 2. Non-Goals (deferred)

| Item | Reason / defer-to |
|---|---|
| Include `safe_transactions.withdraw_other` in OUT | Defer — same physical expense often gets recorded in `expenses` too; double-count risk. v2 can introduce an "exclude flag" or "source-of-truth" rule. |
| Drill-down: click a day → modal with that day's expenses + sales | Defer — would mostly duplicate the existing Dashboard daily view. |
| Export the dashboard to JPEG / PDF | Defer — `Reports` already has export. Re-evaluate if user requests. |
| Multi-period comparison (3 weeks side-by-side, etc.) | Defer — single previous-period delta covers the common case. |
| Filter chart by expense category | Defer — Reports already has category-filter views. |
| Bank deposits / capital injection tracking | Defer — would need a new domain (capital movements) outside daily sales. |
| Custom holiday list editable in Settings | Defer — 6 hard-coded holidays cover ≥95% of needs. |
| Component tests for the new UI files | Project policy — Phase 6.B defer (see vitest.config.mts). Manual smoke covers UI. |

---

## 3. Architecture

### 3.1 Module layout

```
src/features/cashflow/
  cash-flow-view.tsx         ← container; period state; role gate
  period-selector.tsx        ← 3 chips + date-range-picker (custom mode)
  cash-flow-kpi-bar.tsx      ← 3 cards (IN / OUT / NET) with delta
  cash-flow-chart.tsx        ← Recharts grouped bar chart
  top-categories-table.tsx   ← Top 5 expense categories
  lunar-calendar-widget.tsx  ← Calendar grid with âm + dương labels

src/lib/
  lunar.ts                   ← Pure helper: solarToLunar(date) → { day, month, year, canChi, isHoliday }
  period-math.ts             ← Pure helper: getCurrentWeekRange(), getCurrentMonthRange(), getPreviousPeriod(start, end)

database/migrations/
  2026-05-23-cash-flow-overview.sql  ← CREATE FUNCTION cash_flow_overview(...)

database/tests/
  cash_flow_overview.pgtap.sql       ← 3 pgTAP scenarios

src/lib/__tests__/
  lunar.test.ts              ← Vitest: known solar↔lunar conversions
  period-math.test.ts        ← Vitest: boundary + previous-period logic
```

### 3.2 Data flow

```
CashFlowView
  ├─ usePeriod state ({ preset: 'week'|'month'|'custom', start, end })
  └─ useCashFlowOverviewQuery(supabase, { start, end, compareStart, compareEnd })
       ↓ calls
     supabase.rpc('cash_flow_overview', {...})
       ↓ returns JSONB
     { in, out, net, prev_in, prev_out, prev_net, by_day[], top_categories[] }
       ↓ split into
     KpiBar gets {in, out, net, prev_*}; Chart gets by_day; Table gets top_categories;
     LunarCalendarWidget receives only the period range.
```

### 3.3 Navigation wiring

- Add `"cashflow"` to `ViewKey` union in
  `src/features/navigation/navigation.ts`.
- Add NAV_ITEMS entry:
  `{ key: "cashflow", label: "Dòng tiền", icon: "trendingUp", roles: ["owner","manager"] }`.
- Add to `DEFAULT_SIDEBAR_BY_ROLE` for `owner` and `manager`.
- Add ROLE_LABELS — N/A (we're adding a nav item, not a role).
- `page.tsx` dispatcher gets `{view === "cashflow" && <CashFlowView />}`.

---

## 4. Period Selector

### 4.1 Behaviour

| Preset | Range |
|---|---|
| `Tuần này` | Monday of current week → Sunday of current week (VN convention, Mon-start) |
| `Tháng này` | 1st of current month → last day of current month |
| `Tuỳ chỉnh` | User-picked range via `date-range-picker` |

Default on mount: `Tháng này`.

### 4.2 Previous-period derivation

- `Tuần này` → previous Mon-Sun (7-day window immediately before)
- `Tháng này` → previous full calendar month
- `Tuỳ chỉnh (N days)` → N days immediately before `start`

Implemented in `src/lib/period-math.ts` as pure functions; tested in Vitest.

### 4.3 UI

Three pill chips in a row at the top of the view. Selected chip uses the
project's primary fill (matches the existing `tab` style in Reports). When
`Tuỳ chỉnh` is selected, a `date-range-picker` reveals below the chip row.
Submitting the range re-fires the query.

Reuse: `src/features/reports/date-range-picker.tsx` already exists with the
right look — import it directly. If its props don't fit (e.g. it owns its
own state instead of being controlled), wrap it with a thin adapter rather
than refactor it.

---

## 5. Data Model — RPC contract

### 5.1 Signature

```sql
create or replace function public.cash_flow_overview(
  p_start date,
  p_end date,
  p_compare_start date default null,
  p_compare_end date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$ ... $$;
```

`security definer` runs as the function owner (postgres role) → bypasses
RLS on the tables it reads. The function itself MUST first verify the
caller is owner/manager using existing helper `app_is_owner_manager()`
(defined in `database/002_functions.sql`) and `raise exception 'forbidden'`
otherwise. This pattern matches existing security-definer RPCs in the
codebase.

`grant execute on function public.cash_flow_overview(date,date,date,date) to authenticated;`

### 5.2 Return shape

```json
{
  "in": 125000000,
  "out": 92000000,
  "net": 33000000,
  "prev_in": 111000000,
  "prev_out": 87000000,
  "prev_net": 24000000,
  "by_day": [
    { "date": "2026-05-01", "in": 4500000, "out": 3200000 },
    { "date": "2026-05-02", "in": 5100000, "out": 2800000 }
  ],
  "top_categories": [
    { "category_name": "Tiền điện", "amount": 25000000, "pct": 0.272 },
    { "category_name": "Lương nhân viên", "amount": 20000000, "pct": 0.217 }
  ]
}
```

If `p_compare_start` / `p_compare_end` are NULL, omit `prev_in` / `prev_out`
/ `prev_net` fields entirely (the TS type allows them to be optional).

### 5.3 SQL computation rules

| Field | SQL |
|---|---|
| `in` | `SELECT COALESCE(SUM(net_amount), 0) FROM sales_orders WHERE purchase_at::date BETWEEN p_start AND p_end` |
| `out` | `(SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE business_date BETWEEN p_start AND p_end) + (SELECT COALESCE(SUM(total_pay), 0) FROM shift_payroll_records WHERE business_date BETWEEN p_start AND p_end)` |
| `net` | `in - out` |
| `by_day` | aggregate per-`business_date` (or `purchase_at::date` for sales) and outer-join across `generate_series(p_start, p_end, '1 day'::interval)` so days with zero stay in the array |
| `top_categories` | `GROUP BY expense_categories.name ORDER BY SUM(amount) DESC LIMIT 5`; `pct = amount / total_out` |

`top_categories` only considers `expenses` (not payroll) — categorisation
is the point; lumping "Lương" into a single bar in the chart is fine but
the table should be expense-category-level.

### 5.4 Performance

- Indexes already exist: `sales_orders(purchase_at)`, `expenses(business_date)`,
  `shift_payroll_records(business_date)` (verify during impl; add if missing).
- `by_day` does `O(P × N)` where P = days in period, N = rows per day.
  Period max ~31 days → fine for typical shops.
- One RPC call vs four separate queries → fewer round-trips, simpler error
  handling.

---

## 6. UI Components

### 6.1 `CashFlowView`

**Props:** `{ role: UserRole }` (passed from `page.tsx` dispatcher).

```tsx
export function CashFlowView({ role }: { role: UserRole }) {
  if (role !== "owner" && role !== "manager") {
    return <EmptyState icon="lock" title="Module dành cho owner/manager" />;
  }

  const [period, setPeriod] = useState<PeriodState>(getDefaultPeriod()); // 'month'
  const supabase = useSupabase();
  const query = useCashFlowOverviewQuery(supabase, period);

  // Loading / error states → Spinner / AlertBanner (existing patterns)

  return (
    <div className="space-y-6">
      <PeriodSelector value={period} onChange={setPeriod} />
      <CashFlowKpiBar data={query.data} />
      <CashFlowChart byDay={query.data?.by_day ?? []} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopCategoriesTable rows={query.data?.top_categories ?? []} />
        <LunarCalendarWidget start={period.start} end={period.end} />
      </div>
    </div>
  );
}
```

### 6.2 `PeriodSelector`

**Props:** `{ value: PeriodState; onChange(next: PeriodState): void }`.

UI: three pill buttons (`Tuần này` / `Tháng này` / `Tuỳ chỉnh`) inline.
When `value.preset === "custom"`, a `DateRangePicker` shows below.
Header text underneath shows: `<solar-range> · Âm: <lunar-range> năm <canChi>`.

### 6.3 `CashFlowKpiBar`

**Props:** `{ data?: CashFlowOverview }`.

Three `Card` instances side-by-side (matching the existing KpiBar in
Dashboard, but with 3 cards instead of 4):

```
┌─Tổng vào──────┐ ┌─Tổng ra──────┐ ┌─Chênh lệch───┐
│ 125.000.000 ₫ │ │ 92.000.000 ₫│ │ +33.000.000 ₫│
│ ↑12% vs T4    │ │ ↑5% vs T4   │ │ ↑28% vs T4   │
└───────────────┘ └─────────────┘ └──────────────┘
```

Delta % is computed client-side from `(current - prev) / prev * 100` with
guard for `prev === 0` (show `—` instead of `Infinity%`). Arrow direction:
green ↑ for `in` and `net`, red ↑ for `out`; flip colours for ↓.

Currency formatting: reuse existing `formatCurrency` from
`src/lib/format.ts` (project convention).

### 6.4 `CashFlowChart`

**Props:** `{ byDay: Array<{ date: string; in: number; out: number }> }`.

Recharts grouped bar chart, two series per day (`in` xanh / `out` đỏ).
X-axis: day label `dd/MM` (no year — already in header). Y-axis: currency
abbreviated `1M`, `500K` (write a small inline formatter; do NOT extract
into `src/lib` unless used twice).

Match the visual style of existing `hourly-bar-chart.tsx` in Reports
(rounded-top bars, same palette).

### 6.5 `TopCategoriesTable`

**Props:** `{ rows: Array<{ category_name: string; amount: number; pct: number }> }`.

Table with 4 columns: rank (1–5), name, amount, percent. Empty state if
`rows.length === 0`. Matches the table style used in `expense-by-category-table.tsx`
in Reports — reuse the row component if cleanly extractable, else duplicate.

### 6.6 `LunarCalendarWidget`

**Props:** `{ start: string; end: string }` (ISO dates).

Renders a calendar grid:
- One row per week, Mon–Sun columns.
- Each cell shows:
  - Solar day-of-month (large, top-left)
  - Lunar day (small, bottom-right): `15/3` style
  - Holiday badge if the lunar date matches one of the 6 hard-coded list
  - `◐` icon on mùng 1 (lunar day 1), `●` on rằm (lunar day 15)
- Days outside `[start, end]` rendered greyed-out but still in their grid
  position (to keep the week-row layout intact).
- Today (solar) gets a ring/border highlight.

Hard-coded lunar holiday list (in `src/lib/lunar.ts`):
| Lunar | Solar (varies) | Label |
|---|---|---|
| 1/1 | Tết Nguyên Đán |
| 15/1 | Rằm tháng Giêng |
| 10/3 | Giỗ tổ Hùng Vương |
| 5/5 | Tết Đoan Ngọ |
| 15/7 | Vu Lan |
| 15/8 | Tết Trung Thu |

---

## 7. Lunar calendar implementation

### 7.1 Library choice

**Decision rule (apply at implementation time):**
1. If `vietnamese-lunar` (or similar focused VN lib) is ≤ 20 KB minified and
   has TS types → use it.
2. Else implement Hồ Ngọc Đức's algorithm inline in `src/lib/lunar.ts`
   (~200 lines, well-known public-domain). Test against 10 known dates.
3. Avoid `lunar-typescript` (300 KB) — bundle bloat for our use case.

Either way, expose a single function:

```ts
export function solarToLunar(date: Date | string): LunarInfo;

export interface LunarInfo {
  day: number;            // 1..30
  month: number;          // 1..12 (or 13 for leap)
  year: number;
  isLeapMonth: boolean;
  canChi: string;         // e.g. "Bính Ngọ"
  holiday?: string;       // e.g. "Tết Nguyên Đán" (if mùng 1/1, etc.)
  isFirstOfMonth: boolean;  // mùng 1
  isFullMoon: boolean;      // rằm (15)
}
```

### 7.2 Testing

`src/lib/__tests__/lunar.test.ts` — 10 known reference conversions:
- 17/2/2026 (Tue) ↔ 1/1 năm Bính Ngọ (Tết 2026)
- 23/5/2026 (Sat) ↔ 7/4 năm Bính Ngọ (today, sanity check)
- 4 Tết dates from past years
- 4 mùng 1 / rằm dates for verification

If `vietnamese-lunar` is used, the test verifies our wrapper preserves the
output shape; if implemented inline, the test exercises the algorithm.

---

## 8. Backend

### 8.1 Migration file

`database/migrations/2026-05-23-cash-flow-overview.sql`:

```sql
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
  v_role text;
  v_in numeric;
  v_out numeric;
  v_prev_in numeric;
  v_prev_out numeric;
  v_by_day jsonb;
  v_top jsonb;
  v_result jsonb;
begin
  if not public.app_is_owner_manager() then
    raise exception 'forbidden: cash_flow_overview requires owner/manager';
  end if;

  -- IN / OUT for the current period
  select coalesce(sum(net_amount), 0)
    into v_in
    from public.sales_orders
   where purchase_at::date between p_start and p_end;

  select coalesce((select sum(amount) from public.expenses
                    where business_date between p_start and p_end), 0)
       + coalesce((select sum(total_pay) from public.shift_payroll_records
                    where business_date between p_start and p_end), 0)
    into v_out;

  -- by_day
  with d as (
    select dd::date as day from generate_series(p_start, p_end, interval '1 day') dd
  ),
  ins as (
    select purchase_at::date as day, sum(net_amount) as amt
      from public.sales_orders
     where purchase_at::date between p_start and p_end
     group by 1
  ),
  outs as (
    select business_date as day, sum(amount) as amt
      from public.expenses
     where business_date between p_start and p_end
     group by 1
    union all
    select business_date as day, sum(total_pay) as amt
      from public.shift_payroll_records
     where business_date between p_start and p_end
     group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'date', d.day,
           'in', coalesce(ins.amt, 0),
           'out', coalesce((select sum(amt) from outs where outs.day = d.day), 0)
         ) order by d.day)
    into v_by_day
    from d
    left join ins on ins.day = d.day;

  -- top_categories
  with totals as (
    select ec.name, sum(e.amount) as amt
      from public.expenses e
      left join public.expense_categories ec on ec.id = e.category_id
     where e.business_date between p_start and p_end
     group by ec.name
     order by amt desc
     limit 5
  )
  select jsonb_agg(jsonb_build_object(
           'category_name', coalesce(name, '(chưa phân loại)'),
           'amount', amt,
           'pct', case when v_out = 0 then 0 else amt / v_out end
         ) order by amt desc)
    into v_top
    from totals;

  v_result := jsonb_build_object(
    'in', v_in,
    'out', v_out,
    'net', v_in - v_out,
    'by_day', coalesce(v_by_day, '[]'::jsonb),
    'top_categories', coalesce(v_top, '[]'::jsonb)
  );

  if p_compare_start is not null and p_compare_end is not null then
    select coalesce(sum(net_amount), 0)
      into v_prev_in
      from public.sales_orders
     where purchase_at::date between p_compare_start and p_compare_end;
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

revoke all on function public.cash_flow_overview(date,date,date,date) from public;
grant execute on function public.cash_flow_overview(date,date,date,date) to authenticated;
```

### 8.2 pgTAP tests

`database/tests/cash_flow_overview.pgtap.sql` — 3 scenarios:

1. Empty period returns zeros: insert no data, call with arbitrary range,
   assert `in=0, out=0, net=0, by_day` array with all-zero entries.
2. Sums correctly across `sales_orders` + `expenses` + `payroll`:
   insert one row in each, call, assert totals.
3. `top_categories` ordering: insert 6 expense rows in 3 categories, assert
   array length ≤ 5 and ordered by amount desc.

Auth check (owner/manager guard) is tested via existing `app_is_owner_manager`
coverage — no new pgTAP needed for that.

---

## 9. Testing strategy

### 9.1 Vitest (pure helpers)

| File | Coverage |
|---|---|
| `src/lib/__tests__/period-math.test.ts` | `getCurrentWeekRange()` (Mon-Sun); `getCurrentMonthRange()`; `getPreviousPeriod(start, end, preset)` for all 3 presets |
| `src/lib/__tests__/lunar.test.ts` | 10 reference solar↔lunar conversions including Tết 2026 |

Both files are pure-function tests, no DOM — fits the existing node-env
Vitest setup.

### 9.2 pgTAP

3 scenarios in §8.2 above.

### 9.3 Manual smoke (after impl)

1. Seed shop has at least one month of data → switch to "Dòng tiền" →
   expect KPI bar populated, chart shows daily bars, top-5 table populated,
   calendar widget shows the month with âm dates.
2. Toggle `Tuần này` → range shrinks; all sections update.
3. Toggle `Tuỳ chỉnh` → pick a 3-day window → range narrows; calendar widget
   shows just 3 day cells in the relevant week.
4. Log in as `staff_operator` → "Dòng tiền" not in sidebar; if URL forced
   via `view=cashflow`, EmptyState lock shows.
5. Check a known lunar date (Tết = 17/2/2026 if seed includes it) → calendar
   widget shows the holiday badge.

---

## 10. Open questions / explicit tradeoffs

1. **Preset vs custom previous-period derivation diverge by design.**
   Presets anchor to calendar units; custom anchors to "N days immediately
   before":
   - `Tuần này` (Mon-Sun) → previous Mon-Sun. Always 7 vs 7.
   - `Tháng này` (1st-last) → previous calendar month. May (31d) compared
     against April (30d), Feb (28-29d) compared against Jan (31d), etc.
     Day counts may differ. Delta is between calendar months as the user
     conceptually thinks of them.
   - `Tuỳ chỉnh` (N days) → N days immediately before `start`. Uniform
     window length. Picking 1/5-31/5 in custom mode compares against
     31/3-30/4 (31 days), NOT April-the-calendar-month. This is different
     from the preset Tháng này behaviour on purpose: a custom range may
     not align to month boundaries, so an "N days back" semantic is the
     only consistent rule.
   The UI clarifies this in the KPI sub-label: presets say "vs T4" /
   "vs tuần trước"; custom says "vs 31 ngày trước".

2. **Excluded payroll edits.** `shift_payroll_records.edited_at` flag exists
   but we ignore it — sum total_pay regardless of edit state. If users
   want a "draft vs final" toggle, defer to v2.

3. **Lunar year naming.** `canChi` returned as Vietnamese (Bính Ngọ, Giáp Tý,
   …). If the lib only returns Chinese characters, we localise inside our
   wrapper.

4. **Visual companion / frontend-design skill.** Brainstorming forbids
   invoking implementation skills; `/frontend-design` will be invoked at
   the UI-build task (task ordering: backend RPC + data layer first, then
   UI). Mockups in this spec are textual.

5. **Sidebar default for "Dòng tiền".** Added to owner+manager defaults.
   Owner can hide for individual managers via the per-user sidebar
   override (already exists in Settings).

---

## 11. Implementation order (proposed)

1. `src/lib/period-math.ts` + Vitest tests (pure, no deps)
2. `src/lib/lunar.ts` + Vitest tests (research lib choice → implement → test)
3. Migration `2026-05-23-cash-flow-overview.sql` + pgTAP tests
4. `src/lib/data/cash-flow.ts` (RPC wrapper)
5. `src/hooks/queries/use-cash-flow-overview-query.ts`
6. Types in `src/lib/types.ts` (`CashFlowOverview`, `PeriodState`)
7. Components leaf-inward: `period-selector`, `cash-flow-kpi-bar`,
   `cash-flow-chart`, `top-categories-table`, `lunar-calendar-widget`,
   then `cash-flow-view`
8. Navigation wiring (NAV_ITEMS, defaults, page.tsx)
9. Manual smoke (§9.3)

`writing-plans` will expand this into bite-sized TDD tasks with explicit
verify steps.
