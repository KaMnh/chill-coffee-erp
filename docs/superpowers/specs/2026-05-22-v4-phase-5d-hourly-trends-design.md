# Phase 5.D — Hourly / Intraday Trends Design

**Parent:** `docs/superpowers/specs/2026-05-22-v4-phase-5-overall-design.md`
**Scope:** Fourth and **final** Phase 5 sub-phase. Replaces the "Theo giờ" placeholder tab from 5.A with a single-page chart-driven hourly view. Reuses the `DateRangePicker` primitive and the existing `<BarChart>` component.
**Branch:** `phase-5d-hourly-trends` (off `main` @ tag `v4-phase-5c`)
**Tag at end:** `v4-phase-5d` (sub-phase) **+ umbrella tag `v4-phase-5`** (closes Phase 5 entirely)

---

## 0. TL;DR

- 5 new files + 5 modified.
- 1 new RPC in `002_functions.sql`: `sales_hourly_summary` (always returns 24 rows via `generate_series`).
- 1 new pgTAP file `190_sales_hourly_reports.sql` with **10 assertions**.
- `ReportsView`'s `hourly` placeholder replaced with `<HourlyTrendsTab />`.
- Uses **existing** `<BarChart>` from `src/components/charts/bar-chart.tsx` (Recharts wrapper that already supports `highlightKey` for peak-hour and `formatY` for VND). Phase 5.D is the **first production consumer** of this primitive — playground was sole user before.
- `verify:phase` after merge: **75 Vitest + 131 pgTAP = 206 total**.
- **Closes Phase 5.** Umbrella tag `v4-phase-5` placed on T5 merge commit alongside `v4-phase-5d`.

---

## 1. Goal

Surface intraday sales patterns over arbitrary date ranges. Owner/manager can answer:

- "When is my peak hour?" (KPI tile)
- "How busy is peak vs slow hours?" (visual bar contrast)
- "What's the total revenue + order volume across the picked range?" (KPI tiles)

These are the first **time-of-day** aggregations in v4. Existing `PivotView` (single-day raw POS list) and 5.B `SalesByProductTab` (by product/category) answer different questions; 5.D fills the temporal-pattern gap.

---

## 2. Non-goals (specific to 5.D)

- No Y-axis switcher (revenue / quantity / order_count toggle) — default is revenue. Future polish.
- No per-day breakdown in multi-day ranges — sum across days (per Section 2 semantics). YAGNI for "per-day average".
- No CSV/Excel export — consistent with 5.A/B/C deferrals.
- No day-of-week dimension (peak hour by Monday vs Saturday) — would require schema-time bucketing or a 2-dimensional chart. Out of scope.
- No 30-minute / 15-minute granularity — hour buckets only. Schema's `purchase_at` timestamp supports finer granularity, but coffee-shop signal at 60-min resolution is sufficient.
- No HourlyDataTable accompanying the chart — chart + KPI strip is the only display (per Section 3 decision).
- No write controls — pure read-only report.
- No standalone view — lives inside ReportsView's "Theo giờ" tab.

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Chart library | **Use existing `<BarChart>` from `src/components/charts/bar-chart.tsx`** — Recharts dep already in package.json (`^3.8.1`), wrapper already exists with `highlightKey` and `formatY` support |
| Tab shape | **Chart + KPI strip** — diverges from 5.A/B/C's 2-section stacked tables. Owner's questions ("when's peak?", "how busy overall?") map cleanly to KPI tiles + visual chart |
| 3 KPI tiles | Giờ cao điểm (argmax of revenue) / Tổng doanh thu (sum) / Tổng đơn (sum of order_count) |
| Y-axis default | **revenue** (matches 5.B/C "money first" precedent) |
| Peak highlighting | client-side derived `is_peak: boolean` on each row, passed to `<BarChart highlightKey="is_peak">` |
| Off-hours treatment | **Server returns all 24 rows** (`generate_series(0,23)` LEFT JOIN); zero hours show as zero bars — visual shop-hours context |
| Hour label format | X-axis: `"14:00"`; peak KPI value: `"14:00 – 15:00"` (en-dash range) |
| Default date range | **Tuần này** — consistent with 5.A/B/C |
| Multi-day semantics | **Sum** across days. Owner picks single-day range for per-day view (YAGNI for per-day averaging) |
| Timezone correctness | **`AT TIME ZONE 'Asia/Ho_Chi_Minh'`** before `extract(hour ...)` — same defense as 5.A T1 fix |
| Query-key namespace | Existing `"sales-reports"` (hourly IS a sales view; sub-key `"hourly"`) — no new namespace |
| Single query | One RPC feeds both KPI row + chart (same data array) — simpler than 2 queries |
| Tab-shell extraction question | **Permanently retired** — 5.D's tab shape diverges from 5.A/B/C, breaking the assumed pattern. 3 identical tabs in the codebase is the new ceiling. |
| Umbrella tag | **`v4-phase-5` placed on T5 merge commit** alongside `v4-phase-5d` — closes Phase 5 entirely |

---

## 4. Architecture

### 4.1 ReportsView tab swap

```tsx
// Before (5.A + 5.B + 5.C unchanged):
<TabsContent value="hourly">
  <EmptyState icon="info" title="Theo giờ"
              subtitle="Phát hành trong giai đoạn 5.D — …" dashedBorder />
</TabsContent>

// After (5.D):
<TabsContent value="hourly">
  <HourlyTrendsTab />
</TabsContent>
```

All other 4 tabs (Chốt két, Tồn kho 5.A, Doanh số 5.B, Chi phí + lương 5.C) untouched.

### 4.2 HourlyTrendsTab composition

```
HourlyTrendsTab (no props)
├── useState<DateRange> (lazy-init defaultDateRange)
├── DateRangePicker (shared from 5.A) — controls dateRange
├── useSalesHourlySummaryQuery(supabase, from, to)
│   → enrichedData: (HourlyRow & { is_peak: boolean })[]  (24 rows always)
├── Branches: isLoading → isError → all-zero-empty → data
└── Renders:
    ├── HourlyKpiRow (data) — 3 StatTiles
    └── HourlyBarChart (data) — 24-bar chart with peak highlight
```

**Critical difference from 5.A/B/C tabs:** This tab owns the query (not a pure composition). Both children consume the same data array, so we fetch once.

### 4.3 Role gating

Inherited from ReportsView's NAV_ITEMS gate: owner + manager + staff_operator. employee_viewer blocked. No write controls.

### 4.4 Data flow

```
HourlyTrendsTab
  ├── useState<DateRange> (default = "Tuần này")
  └── DateRangePicker controls dateRange

  useSupabase() + useSalesHourlySummaryQuery(supabase, from, to, enabled)
    → supabase.rpc("sales_hourly_summary", { p_from, p_to })
    → 24 rows always (generate_series LEFT JOIN aggregation)

  useMemo to enrich each row with is_peak: boolean (client-side argmax)

  Branch render:
    isLoading      → Spinner (size 32, py-12)
    isError        → AlertBanner.danger "Không tải được báo cáo theo giờ"
    all-zero       → EmptyState dashedBorder icon=barChart3
    has-revenue    → <HourlyKpiRow data={enrichedData} />
                   + <HourlyBarChart data={enrichedData} />
```

staleTime: `60_000`. supabase null-guard via `enabled: !!supabase && enabled`.

---

## 5. RPC spec (full SQL)

### 5.1 `sales_hourly_summary`

```sql
create or replace function public.sales_hourly_summary(
  p_from date,
  p_to   date
) returns table (
  sale_hour      int,
  total_quantity numeric,
  total_revenue  numeric,
  order_count    int
)
language sql
stable
set search_path = public
as $$
  with hours as (
    select generate_series(0, 23) as sale_hour
  ),
  agg as (
    select
      extract(hour from (so.purchase_at at time zone 'Asia/Ho_Chi_Minh'))::int as sale_hour,
      sum(soi.quantity)::numeric                                                as total_quantity,
      sum(soi.line_total)::numeric                                              as total_revenue,
      count(distinct so.id)::int                                                as order_count
    from public.sales_orders so
    join public.sales_order_items soi on soi.sales_order_id = so.id
    where so.business_date >= p_from
      and so.business_date <= p_to
    group by extract(hour from (so.purchase_at at time zone 'Asia/Ho_Chi_Minh'))
  )
  select
    h.sale_hour,
    coalesce(a.total_quantity, 0)::numeric as total_quantity,
    coalesce(a.total_revenue, 0)::numeric  as total_revenue,
    coalesce(a.order_count, 0)::int        as order_count
  from hours h
  left join agg a on a.sale_hour = h.sale_hour
  order by h.sale_hour asc;
$$;
```

**Semantic notes:**

- **Always returns 24 rows** (`generate_series(0, 23)` LEFT JOINed) — chart gets deterministic 24-bar input.
- **`AT TIME ZONE 'Asia/Ho_Chi_Minh'`** before `extract(hour ...)` — without it, sales at 02:00 UTC (= 09:00 Vietnam) would bucket as hour=2 instead of hour=9. Critical correctness. Same defense as 5.A T1 fix.
- **`business_date` filter** (not `purchase_at`) — matches 5.B's filter convention.
- **`coalesce(..., 0)`** so empty hours have numeric 0 instead of NULL (cleaner for chart + JS sum/argmax).
- **`order_count::int`** — same defense as 5.B T1 / 5.C T1.
- **`STABLE`, no `SECURITY DEFINER`** — same as 5.B (read-only sales path; RLS doesn't filter sales_orders).
- **Sort: `sale_hour ASC`** (chronological, NOT by revenue) — chart bars left-to-right represent time-of-day. Different from 5.B/C which sorted by `total_revenue DESC`.

### 5.2 pgTAP test plan (`190_sales_hourly_reports.sql`)

**10 assertions** (top-level SELECT pattern):

```
sales_hourly_summary (10):
  1. Always returns exactly 24 rows even with empty range
  2. Empty range returns rows with all zero values (total_revenue=0,
     total_quantity=0, order_count=0)
  3. AT TIME ZONE bucket correctness: insert a sale at 02:00 UTC =
     09:00 Vietnam → hour=9 row has the revenue, hour=2 stays at 0
  4. Hour 0 bucket: insert at 17:00 UTC (= 00:00 Vietnam) → hour=0
     row has the revenue
  5. sum(line_total) correct across 2 sales in same hour
  6. sum(quantity) correct across 2 sales in same hour
  7. order_count = count(distinct sales_order_id) per hour
     (2 line_items from same order at 14:30 = order_count=1 in hour=14)
  8. business_date filter excludes purchases outside range
  9. Sort is ASC by sale_hour (verified via first row sale_hour=0)
 10. coalesce: hour with no sales returns total_revenue=0 (not NULL)
```

Same `act_as` impersonation + `auth.users` seed pattern as Phase 4 / 5.A / 5.B / 5.C tests. All assertions top-level `select is(...)`. File wrapped in `begin; select plan(10); … select * from finish(); rollback;`.

---

## 6. File manifest

### 6.1 New files (5)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `database/tests/190_sales_hourly_reports.sql` | ~200 | pgTAP — 10 assertions |
| `src/features/reports/hourly-trends-tab.tsx` | ~70 | Owns query + state + branch render |
| `src/features/reports/hourly-kpi-row.tsx` | ~80 | 3 StatTiles (Peak / Revenue / Orders) |
| `src/features/reports/hourly-bar-chart.tsx` | ~50 | Wraps existing `<BarChart>` with hour-label mapping |
| `src/hooks/queries/use-hourly-reports-query.ts` | ~30 | 1 query hook |

### 6.2 Modified files (5)

| Path | Change |
|------|--------|
| `database/002_functions.sql` | Append 1 RPC at EOF |
| `src/lib/data/reports.ts` | Append 1 wrapper function + 1 row interface |
| `src/hooks/queries/keys.ts` | Append 1 key under existing `"sales-reports"` namespace |
| `src/hooks/queries/index.ts` | Re-export new hook file |
| `src/features/reports/reports-view.tsx` | Swap `hourly` placeholder for `<HourlyTrendsTab />` + add import |

### 6.3 Off-limits

- `database/001_schema.sql` — no schema changes
- `database/003_rls.sql` — existing `sales_orders` + `sales_order_items` RLS allows SELECT
- `src/components/charts/bar-chart.tsx` — reused as-is, do NOT modify
- `src/lib/types.ts` — row interface stays in the data layer file (5.A/B/C pattern)
- `src/features/pivot/**` — standalone PivotView untouched
- All Phase 2/3/4/5.A/B/C primitives and modules

---

## 7. Component specs

### 7.1 HourlyTrendsTab

```tsx
"use client";

import { useMemo, useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import { useSalesHourlySummaryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DateRangePicker,
  defaultDateRange,
  type DateRange,
} from "./date-range-picker";
import { HourlyKpiRow } from "./hourly-kpi-row";
import { HourlyBarChart } from "./hourly-bar-chart";
import type { HourlyRow } from "@/lib/data";

/**
 * Phase 5.D — Hourly trends tab inside ReportsView.
 *
 * Single source of truth for date range. Single query feeds both
 * the KPI row + the chart. Branches loading/error/empty at the
 * tab level (not per-child) because both children share data.
 *
 * Shape differs from 5.A/B/C tabs (no 2-stacked-tables pattern).
 */
export function HourlyTrendsTab() {
  const supabase = useSupabase();
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());
  const query = useSalesHourlySummaryQuery(
    supabase,
    dateRange.from,
    dateRange.to,
    !!supabase
  );

  const enrichedData = useMemo<(HourlyRow & { is_peak: boolean })[]>(() => {
    const data = query.data ?? [];
    const maxRevenue = Math.max(0, ...data.map((d) => d.total_revenue));
    return data.map((row) => ({
      ...row,
      is_peak: maxRevenue > 0 && row.total_revenue === maxRevenue,
    }));
  }, [query.data]);

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {query.isLoading && (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      )}

      {query.isError && (
        <AlertBanner variant="danger" title="Không tải được báo cáo theo giờ">
          Vui lòng tải lại trang. Lỗi:{" "}
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </AlertBanner>
      )}

      {!query.isLoading && !query.isError &&
        enrichedData.every((d) => d.total_revenue === 0) && (
          <EmptyState
            dashedBorder
            icon="barChart3"
            title="Chưa có doanh số trong khoảng này"
            subtitle="Đổi khoảng thời gian hoặc đợi sync POS mới."
          />
        )}

      {!query.isLoading && !query.isError &&
        enrichedData.some((d) => d.total_revenue > 0) && (
          <>
            <HourlyKpiRow data={enrichedData} />
            <HourlyBarChart data={enrichedData} />
          </>
        )}
    </div>
  );
}
```

Notes:
- **Empty detection** uses `every(d => total_revenue === 0)` — RPC always returns 24 rows so `data.length === 0` is impossible.
- **Single query**, `useMemo` for argmax derivation, branches at tab level.
- **`is_peak` falsy when all rows are zero** — `maxRevenue > 0 && ...` prevents highlighting hour=0 in an empty range (though that branch wouldn't render anyway via the EmptyState gate).

### 7.2 HourlyKpiRow

```tsx
"use client";

import { Card, CardBody } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import type { HourlyRow } from "@/lib/data";

interface HourlyKpiRowProps {
  data: (HourlyRow & { is_peak: boolean })[];
}

export function HourlyKpiRow({ data }: HourlyKpiRowProps) {
  const peakRow = data.find((d) => d.is_peak);
  const peakLabel = peakRow ? formatHourRange(peakRow.sale_hour) : "—";
  const totalRevenue = data.reduce((sum, d) => sum + d.total_revenue, 0);
  const totalOrders = data.reduce((sum, d) => sum + d.order_count, 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatTile label="Giờ cao điểm" value={peakLabel} />
      <StatTile label="Tổng doanh thu" value={formatVND(totalRevenue)} />
      <StatTile
        label="Tổng đơn"
        value={totalOrders.toLocaleString("vi-VN")}
      />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium text-muted uppercase tracking-wide">
          {label}
        </p>
        <p className="mt-1 font-display text-2xl text-ink tabular-nums">
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Format an hour index 0..23 as a one-hour bracket label.
 *   formatHourRange(14) → "14:00 – 15:00"
 *   formatHourRange(23) → "23:00 – 00:00"
 */
function formatHourRange(hour: number): string {
  const start = `${String(hour).padStart(2, "0")}:00`;
  const end = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
  return `${start} – ${end}`;
}
```

Notes:
- **`StatTile`** private sub-component. Could check if 4.E's `InventoryKpiRow` exports a reusable `StatCard` — if it does, import it instead. If not, keep this inline; extract only when 3rd consumer emerges.
- **Peak label uses en-dash** (`"14:00 – 15:00"`) not hyphen for typographic correctness.
- **Wraparound:** hour 23 → "23:00 – 00:00" (uses `(hour+1) % 24`).
- **No icons** — keeps strip clean.

### 7.3 HourlyBarChart

```tsx
"use client";

import { Card, CardBody } from "@/components/ui/card";
import { BarChart } from "@/components/charts/bar-chart";
import { Badge } from "@/components/ui/badge";
import { formatVND } from "@/lib/format";
import type { HourlyRow } from "@/lib/data";

interface HourlyBarChartProps {
  data: (HourlyRow & { is_peak: boolean })[];
}

interface ChartRow {
  hour_label: string;
  total_revenue: number;
  is_peak: boolean;
}

export function HourlyBarChart({ data }: HourlyBarChartProps) {
  const chartData: ChartRow[] = data.map((row) => ({
    hour_label: `${String(row.sale_hour).padStart(2, "0")}:00`,
    total_revenue: row.total_revenue,
    is_peak: row.is_peak,
  }));

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Doanh thu theo giờ</h3>
          <Badge variant="soft" semantic="neutral">24 giờ</Badge>
        </div>
        <BarChart<ChartRow>
          data={chartData}
          xKey="hour_label"
          yKey="total_revenue"
          highlightKey="is_peak"
          formatY={formatVND}
          height={280}
        />
      </CardBody>
    </Card>
  );
}
```

Notes:
- **`hour_label`** short form for X-axis: `"14:00"` (not the range). Fits 24 labels horizontally.
- **`highlightKey="is_peak"`** — existing `<BarChart>` already does the conditional coloring.
- **`formatY={formatVND}`** — tooltip renders revenue as VND on hover.
- **Height 280px** — taller than 240 default for 24-bar density.

### 7.4 ReportsView swap

In `src/features/reports/reports-view.tsx`, replace:

```tsx
<TabsContent value="hourly">
  <EmptyState
    icon="info"
    title="Theo giờ"
    subtitle="Phát hành trong giai đoạn 5.D — xu hướng doanh số theo giờ."
    dashedBorder
  />
</TabsContent>
```

with:

```tsx
<TabsContent value="hourly">
  <HourlyTrendsTab />
</TabsContent>
```

Add import: `import { HourlyTrendsTab } from "./hourly-trends-tab";`

---

## 8. Data layer + query hook

### 8.1 Data layer (`src/lib/data/reports.ts` — append at EOF)

```ts
// ---------------------------------------------------------------------
// Phase 5.D — Hourly trends report
// ---------------------------------------------------------------------

export interface HourlyRow {
  sale_hour: number;
  total_quantity: number;
  total_revenue: number;
  order_count: number;
}

export async function loadSalesHourlySummary(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<HourlyRow[]> {
  const { data, error } = await supabase.rpc("sales_hourly_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) throw toAppError(error, "Không tải được báo cáo theo giờ.");
  return (data ?? []) as HourlyRow[];
}
```

### 8.2 Query key (`src/hooks/queries/keys.ts` — append inside `queryKeys` object)

```ts
// Phase 5.D — Hourly trends (under existing "sales-reports" namespace)
salesHourlySummary: (range: { from: string; to: string }) =>
  ["sales-reports", "hourly", range] as const,
```

Reuses the `"sales-reports"` root from 5.B because hourly IS a sales view. Sub-key `"hourly"` distinguishes from `"product"` (5.B) and `"category"` (5.B).

### 8.3 Query hook (`src/hooks/queries/use-hourly-reports-query.ts` — new)

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadSalesHourlySummary,
  type HourlyRow,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.D — Hourly trends query hook.
 *
 *   - staleTime 60s (user-driven date-range pull)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hook
 */

export function useSalesHourlySummaryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<HourlyRow[]>({
    queryKey: queryKeys.salesHourlySummary({ from, to }),
    queryFn: () => loadSalesHourlySummary(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
```

### 8.4 Barrel export

`src/hooks/queries/index.ts` — append line:

```ts
export * from "./use-hourly-reports-query";
```

---

## 9. Vietnamese strings (locked for 5.D)

| String | Usage |
|--------|-------|
| Doanh thu theo giờ | HourlyBarChart card heading |
| 24 giờ | Chart badge |
| Giờ cao điểm | KPI tile 1 label |
| Tổng doanh thu | KPI tile 2 label |
| Tổng đơn | KPI tile 3 label |
| {HH}:00 – {HH+1}:00 | Peak hour value format (e.g. "14:00 – 15:00") |
| {HH}:00 | Chart X-axis label format (e.g. "14:00") |
| — | Peak label fallback when no data (em-dash, single char) |
| Không tải được báo cáo theo giờ | AlertBanner title |
| Vui lòng tải lại trang. Lỗi: {message} | AlertBanner body |
| Chưa có doanh số trong khoảng này | EmptyState title (same as 5.B for consistency) |
| Đổi khoảng thời gian hoặc đợi sync POS mới. | EmptyState subtitle (same as 5.B) |

All terms align with the Phase 5 overall glossary.

---

## 10. Error handling

| Source | Behavior |
|--------|----------|
| `useSalesHourlySummaryQuery` error | Tab-level AlertBanner.danger "Không tải được báo cáo theo giờ" |
| Empty range (all 24 rows have revenue=0) | EmptyState (dashedBorder, icon=barChart3) — NO KPI row, NO chart rendered |
| Date range invalid (from > to) | Postgres returns 24 zero rows → EmptyState shows |
| RPC fails (network / 500) | `toAppError` wraps → AlertBanner shows wrapped message |
| All hours zero except one | KPI + chart render; peak highlights the single non-zero hour |
| Multiple hours tied at max revenue | `find` returns first; multiple bars may visually highlight in chart (Recharts highlights each row where `is_peak===true`). Acceptable — informative not buggy |

---

## 11. Risk register

| Risk | Mitigation |
|------|------------|
| Recharts SSR / hydration mismatch | `<BarChart>` has `"use client"`; `<HourlyBarChart>` is its only call site; both directives present. `ResponsiveContainer` is hydration-safe. |
| 24 X-axis labels overflow on narrow screens | Recharts auto-handles; 280px height gives label rotation room. If collisions visible during smoke, fallback: render every 2nd label (post-merge polish). |
| Multi-day "peak hour" interpretation | Documented: SUM semantics. Single-day picker for per-day view. |
| `is_peak` tied at max | `find` returns first; multiple bars may highlight if tied. Acceptable. |
| `<BarChart>` only validated in playground before | T5 smoke test exercises real data path. If issues arise (e.g., CSS var `var(--color-ink)` not resolving), fix in `<BarChart>` itself, not 5.D scope. |
| Server timezone math correctness | `AT TIME ZONE 'Asia/Ho_Chi_Minh'` before `extract(hour ...)`. pgTAP Tests 3 + 4 explicitly verify this with sales crossing UTC/Vietnam date boundaries. |
| RPC perf — `generate_series(0,23)` LEFT JOIN | Constant 24-row series; aggregation uses `sales_orders_business_date_idx`. Trivial cost. |
| Cross-phase key namespace | `"sales-reports"` shared with 5.B intentionally — hourly IS a sales view. Sub-key disambiguates. |
| Umbrella tag `v4-phase-5` placement | T5 places BOTH `v4-phase-5d` (sub-phase) AND `v4-phase-5` (umbrella). Verify both via `git tag -l "v4-phase-5*"` after T5 commit. |

---

## 12. Implementation strategy (task projection)

**5 tasks** (one fewer than 5.B/C because no 2nd RPC + 2nd query hook):

| Task | Files | Verify |
|------|-------|--------|
| **T1** | `database/002_functions.sql` (+1 RPC) + `database/tests/190_sales_hourly_reports.sql` (10 assertions) | 131 pgTAP, 75 Vitest |
| **T2** | `src/lib/data/reports.ts` (+1 wrapper + 1 type) · `src/hooks/queries/keys.ts` (+1 key) · `src/hooks/queries/use-hourly-reports-query.ts` (new) · `index.ts` re-export | `tsc --noEmit` clean |
| **T3** | `src/features/reports/hourly-kpi-row.tsx` (new) — 3 StatTiles | TS + verify:phase |
| **T4** | `src/features/reports/hourly-bar-chart.tsx` (new) — wraps existing `<BarChart>` | TS + verify:phase |
| **T5** | `src/features/reports/hourly-trends-tab.tsx` (new — owns query + branches) · `src/features/reports/reports-view.tsx` (swap placeholder + import) · smoke test 4 roles · **tag `v4-phase-5d` + tag `v4-phase-5`** | Final verify:phase = 206 green |

---

## 13. Success criteria

1. ✅ `verify:phase` ends at **75 Vitest + 131 pgTAP = 206 green** (121 pre-5.D + 10 new in 190)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ "Theo giờ" tab renders KPI strip (3 tiles) + BarChart (24 bars) driven by shared DateRangePicker
5. ✅ Preset switching re-fetches and re-renders everything
6. ✅ Custom date range filters correctly
7. ✅ Empty range → EmptyState (no KPI / no chart clutter)
8. ✅ Peak hour bar visually distinct (`var(--color-ink)` vs `var(--color-border)`)
9. ✅ KPI "Giờ cao điểm" value matches the highlighted bar
10. ✅ Hour labels: chart X-axis "HH:00", peak KPI "HH:00 – HH+1:00"
11. ✅ Recharts tooltip on hover shows VND-formatted value
12. ✅ Cash Close + Tồn kho (5.A) + Doanh số (5.B) + Chi phí + lương (5.C) tabs unchanged
13. ✅ Manager + staff_operator: same view as owner
14. ✅ employee_viewer: cannot reach ReportsView
15. ✅ pgTAP 190 file: 10/10 assertions pass (including timezone correctness Tests 3 + 4)
16. ✅ Tag `v4-phase-5d` placed on T5 commit
17. ✅ **Umbrella tag `v4-phase-5` placed** on T5 merge commit (closes Phase 5 entirely)

---

## 14. Open decisions (deferred to writing-plans / execution)

- **Y-axis switcher (revenue / quantity / order_count toggle)** — deferred. Default is revenue.
- **Hour-range tooltip enrichment** (showing quantity + order_count alongside revenue) — current tooltip shows only revenue. Polish if user pushes back during smoke.
- **30-min / 15-min granularity** — deferred. Hour buckets sufficient for coffee-shop signal.
- **Day-of-week dimension** (peak hour by Monday vs Saturday) — deferred (Phase 6+ scope).
- **Per-day average semantics** — deferred. Single-day range gives per-day view.
- **Tab-shell extraction question** — permanently retired (5.D diverges from 5.A/B/C shape).
- **`StatTile` extraction to shared primitive** — check if 4.E's `StatCard` is reusable in T3; if yes import it, if no keep inline and revisit on 3rd consumer.

---

## 15. Self-review

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in normative sections (§§3–13). §14 explicitly labels Open decisions.

**Internal consistency:**
- File count: 5 new + 5 modified (§6) ✓
- 5 tasks (§12) — one fewer than 5.B/C because 1 RPC instead of 2 ✓
- 1 RPC (§5.1 + §6) ✓
- 10 pgTAP assertions (§5.2 + §13) ✓
- 3 KPI tiles + 1 chart (§4 + §7) ✓
- DateRangePicker reused from 5.A; `<BarChart>` reused from existing primitive (§4 + §7) ✓
- Sort: `sale_hour ASC` (chronological) — explicit contrast with 5.B/C's `total_amount DESC` (§5.1) ✓
- AT TIME ZONE applied before `extract(hour)` (§5.1) — explicit defense documented ✓

**Ambiguity check:**
- "Always 24 rows" defined explicitly via `generate_series + LEFT JOIN`
- "Multi-day = SUM" defined explicitly (§3 + §11)
- "Peak hour = argmax of revenue" defined explicitly client-side (§4 + §7.1)
- "Empty detection" defined explicitly via `every(d => total_revenue === 0)` (§7.1) — different from prior phases due to always-24-rows
- Role gating uniform across tabs (§4.3)
- Umbrella tag placement explicit (§12 + §13)

**Scope check:** UI (3 components) + 1 RPC + 10 assertions. Manageable in 5 tasks. Smaller than 5.B/C scale (because 1 RPC instead of 2, and chart primitive already exists).

No issues found.

---

## 16. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 5-task implementation plan with full SQL + TSX code inline per task. After T5 merges, umbrella tag `v4-phase-5` closes Phase 5 entirely.
