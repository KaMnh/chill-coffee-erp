# Phase 5.B — Sales Reports Design

**Parent:** `docs/superpowers/specs/2026-05-22-v4-phase-5-overall-design.md`
**Scope:** Second analytics sub-phase. Sales by product + sales by category over date ranges. Replaces the "Doanh số" placeholder tab from Phase 5.A. Reuses the `DateRangePicker` primitive.
**Branch:** `phase-5b-sales-reports` (off `main` @ tag `v4-phase-5a`)
**Tag at end:** `v4-phase-5b`

---

## 0. TL;DR

- 5 new files + 5 modified.
- 2 new RPCs in `002_functions.sql`: `sales_product_summary` + `sales_category_summary`.
- 1 new pgTAP file `170_sales_reports.sql` with **10 assertions**.
- `ReportsView`'s `sales_product` placeholder replaced with `<SalesByProductTab />`.
- Standalone `PivotView` (single-day raw POS list) unchanged — additive, not replacement.
- `verify:phase` after merge: **75 Vitest + 109 pgTAP = 184 total**.

---

## 1. Goal

Surface sales-by-product and sales-by-category aggregations over date ranges. Owner/manager can answer:

- "Which products sold the most by revenue this month?" (product summary)
- "Which category is doing best this week?" (category summary)
- "How many orders touched X this week?" (order count column on product table)

These are the **first multi-day sales aggregations** in v4. The existing `PivotView` (`pivot` ViewKey) is single-day raw invoice rows — stays as-is for daily op checks.

---

## 2. Non-goals (specific to 5.B)

- No status_code filter (voided orders included — matches existing PivotView + `daily_product_summary_view` behavior; flagged as follow-up)
- No click-through drill-down from product row to that product's sales history
- No Excel/CSV/PDF export
- No top-N pagination (coffee shop scale never exceeds ~100 products)
- No price-discount breakdown (gross vs net) — line_total is the displayed revenue
- No customer segmentation (KiotViet customer data ingested but out of scope here)
- No removal of standalone `pivot` nav item — additive only

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| PivotView vs new Doanh số tab | **Keep PivotView separate** — different audience (daily op check vs trend analysis). Additive. |
| Tab content | **2 reports stacked** — Product Summary + Category Summary, matches 5.A precedent |
| RPC implementation | **Query base tables directly** (`sales_orders join sales_order_items`) — not the existing `daily_product_summary_view` which would overcount `order_count` on category aggregation |
| Default sort | **revenue DESC** ("best sellers by money") for both tables |
| Category Summary columns | **No order_count** column — would overcount when one order has multiple products in same category |
| Default date range | **Tuần này** (Monday → today) — consistent with 5.A |
| DateRangePicker | **Shared** — one picker drives both tables (5.A precedent) |
| Status_code filter | **None** — match PivotView + the existing view's behavior. Voided orders inflate revenue marginally; flagged as follow-up |
| NULL category_name | Displayed as **"Chưa phân loại"** in UI; sorted last by Postgres default |

---

## 4. Architecture

### 4.1 ReportsView tab swap

The 5.A refactor added 5 tabs to ReportsView. 5.B replaces ONE placeholder:

```tsx
// Before (5.A):
<TabsContent value="sales_product">
  <EmptyState icon="barChart3" title="Doanh số" subtitle="Phát hành trong giai đoạn 5.B — …" />
</TabsContent>

// After (5.B):
<TabsContent value="sales_product">
  <SalesByProductTab />
</TabsContent>
```

All other tabs (Cash Close, Tồn kho, Chi phí + lương placeholder, Theo giờ placeholder) untouched.

### 4.2 SalesByProductTab composition

```
SalesByProductTab (no props)
├── useState<DateRange> (lazy-init defaultDateRange)
├── DateRangePicker (shared) — controls dateRange
├── Section 1: ProductSummaryTable (dateRange)
│   └── useSalesProductSummaryQuery → sales_product_summary RPC
└── Section 2: CategorySummaryTable (dateRange)
    └── useSalesCategorySummaryQuery → sales_category_summary RPC
```

Single source of truth for date range. Both tables re-key TanStack Query when range changes.

### 4.3 Role gating

Inherited from ReportsView's NAV_ITEMS gate: owner + manager + staff_operator. employee_viewer blocked. No write controls — all reports read-only. Same as 5.A.

### 4.4 Data flow

```
SalesByProductTab
  ├── useState<DateRange> (default = "Tuần này")
  └── DateRangePicker controls dateRange

ProductSummaryTable (dateRange)
  ├── useSupabase()
  └── useSalesProductSummaryQuery(supabase, dateRange.from, dateRange.to, true)
      → supabase.rpc("sales_product_summary", { p_from, p_to })

CategorySummaryTable (dateRange)
  ├── useSupabase()
  └── useSalesCategorySummaryQuery(supabase, dateRange.from, dateRange.to, true)
      → supabase.rpc("sales_category_summary", { p_from, p_to })
```

Both queries: `staleTime: 60_000`. Both null-guarded via `enabled: !!supabase && enabled`.

---

## 5. RPC specs (full SQL)

### 5.1 `sales_product_summary`

```sql
create or replace function public.sales_product_summary(
  p_from date,
  p_to   date
) returns table (
  product_id     text,
  product_code   text,
  product_name   text,
  category_name  text,
  total_quantity numeric,
  total_revenue  numeric,
  order_count    int
)
language sql
stable
set search_path = public
as $$
  select
    soi.product_id,
    soi.product_code,
    soi.product_name,
    soi.category_name,
    sum(soi.quantity)::numeric            as total_quantity,
    sum(soi.line_total)::numeric          as total_revenue,
    count(distinct so.id)::int            as order_count
  from public.sales_orders so
  join public.sales_order_items soi on soi.sales_order_id = so.id
  where so.business_date >= p_from
    and so.business_date <= p_to
  group by soi.product_id, soi.product_code, soi.product_name, soi.category_name
  order by total_revenue desc;
$$;
```

Notes:
- Filters by `business_date` (date type) — avoids timezone confusion vs `purchase_at::timestamptz`
- GROUP BY includes `(product_id, product_code, product_name, category_name)` — catches mid-period renames + recategorization
- `count(distinct so.id)` is semantically correct: same product appearing N times in 1 order counts as 1 distinct order
- `STABLE` for PostgREST caching
- NO `SECURITY DEFINER` — relies on existing `sales_orders` + `sales_order_items` RLS (allows SELECT for authenticated)
- `order_count::int` (not `bigint`) to match supabase-js `number` type — same defense as 5.A T2 fix

### 5.2 `sales_category_summary`

```sql
create or replace function public.sales_category_summary(
  p_from date,
  p_to   date
) returns table (
  category_name  text,
  total_quantity numeric,
  total_revenue  numeric
)
language sql
stable
set search_path = public
as $$
  select
    soi.category_name,
    sum(soi.quantity)::numeric   as total_quantity,
    sum(soi.line_total)::numeric as total_revenue
  from public.sales_orders so
  join public.sales_order_items soi on soi.sales_order_id = so.id
  where so.business_date >= p_from
    and so.business_date <= p_to
  group by soi.category_name
  order by total_revenue desc;
$$;
```

Notes:
- Deliberately NO `order_count` column — see §3
- `category_name` can be NULL → its own row → displayed as "Chưa phân loại"
- Same business_date filter semantics as 5.1

### 5.3 pgTAP test plan (`170_sales_reports.sql`)

**10 assertions** (top-level SELECT pattern, no DO blocks per 5.A learnings):

```
sales_product_summary (5):
  1. Empty range returns 0 rows
  2. sum(quantity) correct across multiple orders for same product
  3. sum(line_total) correct (revenue match)
  4. order_count = count(distinct sales_order_id) — verify same product
     appearing in 2 orders + 2x in 1 order = 2 distinct
  5. Sort is ORDER BY total_revenue DESC (verified via limit 1)

sales_category_summary (5):
  6. Empty range returns 0 rows
  7. Groups by category_name — 2 products in same category roll up to one row
  8. sum(quantity) + sum(line_total) correct after roll-up
  9. NULL category_name produces its own row (not merged with non-null)
 10. Sort is ORDER BY total_revenue DESC (verified via limit 1)
```

Same `act_as` impersonation + `auth.users` seed pattern as Phase 4 / 5.A tests. All assertions top-level `select is(...)`. File wrapped in `begin; select plan(10); ... select * from finish(); rollback;`.

---

## 6. File manifest

### 6.1 New files (5)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `database/tests/170_sales_reports.sql` | ~180 | pgTAP — 10 assertions |
| `src/features/reports/sales-by-product-tab.tsx` | ~30 | Composes DateRangePicker + 2 tables |
| `src/features/reports/product-summary-table.tsx` | ~110 | 5-column table |
| `src/features/reports/category-summary-table.tsx` | ~85 | 3-column table |
| `src/hooks/queries/use-sales-reports-query.ts` | ~50 | 2 query hooks |

### 6.2 Modified files (5)

| Path | Change |
|------|--------|
| `database/002_functions.sql` | Append 2 RPCs at EOF |
| `src/lib/data/reports.ts` | Append 2 wrapper functions + 2 row interfaces |
| `src/hooks/queries/keys.ts` | Append 2 key factories under new "sales-reports" namespace |
| `src/hooks/queries/index.ts` | Re-export new hook file |
| `src/features/reports/reports-view.tsx` | Swap `sales_product` placeholder for `<SalesByProductTab />`, add import |

(`reports-view.tsx` is counted in modified files. §6.1 covers files newly created.)

### 6.3 Off-limits

- `database/001_schema.sql` (no schema changes)
- `database/003_rls.sql` (existing `sales_orders` + `sales_order_items` RLS allows SELECT)
- `src/lib/types.ts` (row interfaces stay in the data layer file)
- `src/features/pivot/**` (PivotView unchanged — additive)
- All other Phase 2/3/4 modules

---

## 7. Component specs

### 7.1 ProductSummaryTable

```tsx
interface ProductSummaryTableProps {
  dateRange: DateRange;
}
```

**4 branches:**

| Branch | Render |
|--------|--------|
| loading | `<div className="flex justify-center py-8"><Spinner size={24} /></div>` |
| error | `<AlertBanner variant="danger" title="Không tải được báo cáo doanh thu">Vui lòng tải lại trang. Lỗi: {message}</AlertBanner>` |
| empty | `<EmptyState dashedBorder icon="barChart3" title="Chưa có doanh số trong khoảng này" subtitle="Đổi khoảng thời gian hoặc đợi sync POS mới." />` |
| data | Card with 5-column table |

**Table structure:**

```tsx
<Card>
  <CardBody>
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h3 className="text-sm font-medium text-ink">Doanh thu theo sản phẩm</h3>
      <Badge variant="soft" semantic="neutral">{data.length} sản phẩm</Badge>
    </div>
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted">
          <th scope="col" className="text-left pb-2 font-medium">Sản phẩm</th>
          <th scope="col" className="text-left pb-2 font-medium">Danh mục</th>
          <th scope="col" className="text-right pb-2 font-medium">Số lượng</th>
          <th scope="col" className="text-right pb-2 font-medium">Doanh thu</th>
          <th scope="col" className="text-right pb-2 font-medium">Số đơn</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => (
          <tr key={row.product_id || row.product_code || row.product_name}
              className="border-t border-border">
            <td className="py-2 text-ink">{row.product_name}</td>
            <td className="py-2 text-muted">{row.category_name ?? "Chưa phân loại"}</td>
            <td className="py-2 text-right font-mono tabular-nums text-ink">
              {row.total_quantity.toLocaleString("vi-VN")}
            </td>
            <td className="py-2 text-right font-mono tabular-nums text-ink">
              {formatVND(row.total_revenue)}
            </td>
            <td className="py-2 text-right font-mono tabular-nums text-muted">
              {row.order_count.toLocaleString("vi-VN")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </CardBody>
</Card>
```

`formatVND` imported from `@/lib/format` (existing helper used across PivotView, ReconciliationSummary, etc.).

Row key fallback chain: `product_id || product_code || product_name`. KiotViet should always send `product_id` but legacy/manual orders may have null. Defensive.

### 7.2 CategorySummaryTable

Same 4-branch pattern. 3-column table:

```tsx
<table className="w-full text-sm">
  <thead>
    <tr className="text-xs text-muted">
      <th scope="col" className="text-left pb-2 font-medium">Danh mục</th>
      <th scope="col" className="text-right pb-2 font-medium">Số lượng</th>
      <th scope="col" className="text-right pb-2 font-medium">Doanh thu</th>
    </tr>
  </thead>
  <tbody>
    {data.map((row, i) => (
      <tr key={row.category_name ?? `null-${i}`} className="border-t border-border">
        <td className="py-2 text-ink">{row.category_name ?? "Chưa phân loại"}</td>
        <td className="py-2 text-right font-mono tabular-nums text-ink">
          {row.total_quantity.toLocaleString("vi-VN")}
        </td>
        <td className="py-2 text-right font-mono tabular-nums text-ink">
          {formatVND(row.total_revenue)}
        </td>
      </tr>
    ))}
  </tbody>
</table>
```

Heading: "Doanh thu theo danh mục". Badge: `{data.length} danh mục`. Error title: "Không tải được báo cáo danh mục". Same empty state as Product table.

NULL category row key uses `null-${i}` to avoid React key collisions if multiple NULL rows appear (shouldn't happen — group by collapses them — but defensive).

### 7.3 SalesByProductTab

```tsx
"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ProductSummaryTable } from "./product-summary-table";
import { CategorySummaryTable } from "./category-summary-table";

export function SalesByProductTab() {
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      <section className="space-y-3">
        <ProductSummaryTable dateRange={dateRange} />
      </section>

      <section className="space-y-3">
        <CategorySummaryTable dateRange={dateRange} />
      </section>
    </div>
  );
}
```

Identical structure to `InventoryAnalyticsTab` (5.A T6).

### 7.4 ReportsView swap

In `src/features/reports/reports-view.tsx`, replace:

```tsx
<TabsContent value="sales_product">
  <EmptyState
    icon="barChart3"
    title="Doanh số"
    subtitle="Phát hành trong giai đoạn 5.B — báo cáo doanh số theo sản phẩm và danh mục."
    dashedBorder
  />
</TabsContent>
```

with:

```tsx
<TabsContent value="sales_product">
  <SalesByProductTab />
</TabsContent>
```

Add import at top: `import { SalesByProductTab } from "./sales-by-product-tab";`

---

## 8. Data layer + query hooks

### 8.1 Data layer (`src/lib/data/reports.ts` — append at EOF)

```ts
// ---------------------------------------------------------------------
// Phase 5.B — Sales reports
// ---------------------------------------------------------------------

export interface ProductSummaryRow {
  product_id: string | null;
  product_code: string | null;
  product_name: string;
  category_name: string | null;
  total_quantity: number;
  total_revenue: number;
  order_count: number;
}

export async function loadSalesProductSummary(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ProductSummaryRow[]> {
  const { data, error } = await supabase.rpc("sales_product_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) throw toAppError(error, "Không tải được báo cáo doanh thu.");
  return (data ?? []) as ProductSummaryRow[];
}

export interface CategorySummaryRow {
  category_name: string | null;
  total_quantity: number;
  total_revenue: number;
}

export async function loadSalesCategorySummary(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<CategorySummaryRow[]> {
  const { data, error } = await supabase.rpc("sales_category_summary", {
    p_from: from,
    p_to: to,
  });
  if (error) throw toAppError(error, "Không tải được báo cáo danh mục.");
  return (data ?? []) as CategorySummaryRow[];
}
```

### 8.2 Query keys (`src/hooks/queries/keys.ts` — append inside `queryKeys` object)

```ts
// Phase 5.B — Sales reports
salesProductSummary: (range: { from: string; to: string }) =>
  ["sales-reports", "product", range] as const,
salesCategorySummary: (range: { from: string; to: string }) =>
  ["sales-reports", "category", range] as const,
```

Uses NEW `"sales-reports"` root, decoupled from `"reports"` (Cash Close) and `"inventory-reports"` (5.A) — same defensive pattern as 5.A T2 fix.

### 8.3 Query hooks (`src/hooks/queries/use-sales-reports-query.ts` — new)

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadSalesProductSummary,
  loadSalesCategorySummary,
  type ProductSummaryRow,
  type CategorySummaryRow,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.B — Sales reports query hooks.
 *
 * Both queries:
 *   - staleTime 60s
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutations in this phase
 */

export function useSalesProductSummaryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<ProductSummaryRow[]>({
    queryKey: queryKeys.salesProductSummary({ from, to }),
    queryFn: () => loadSalesProductSummary(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useSalesCategorySummaryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<CategorySummaryRow[]>({
    queryKey: queryKeys.salesCategorySummary({ from, to }),
    queryFn: () => loadSalesCategorySummary(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
```

### 8.4 Barrel export

`src/hooks/queries/index.ts` — append line:

```ts
export * from "./use-sales-reports-query";
```

---

## 9. Vietnamese strings (locked for 5.B)

| String | Usage |
|--------|-------|
| Doanh thu theo sản phẩm | Product table heading |
| Doanh thu theo danh mục | Category table heading |
| Sản phẩm | Product table column header |
| Danh mục | Both tables column header |
| Số lượng | Both tables column header |
| Doanh thu | Both tables column header |
| Số đơn | Product table only column header |
| {N} sản phẩm | Product table badge |
| {N} danh mục | Category table badge |
| Chưa phân loại | NULL category_name fallback display |
| Chưa có doanh số trong khoảng này | EmptyState title for both tables |
| Đổi khoảng thời gian hoặc đợi sync POS mới. | EmptyState subtitle for both tables |
| Không tải được báo cáo doanh thu | Product table AlertBanner title |
| Không tải được báo cáo danh mục | Category table AlertBanner title |
| Vui lòng tải lại trang. Lỗi: {message} | AlertBanner body (both tables) |

All terms align with the Phase 5 overall glossary (§6 of `2026-05-22-v4-phase-5-overall-design.md`).

---

## 10. Error handling

| Source | Behavior |
|--------|----------|
| `useSalesProductSummaryQuery` error | Product section AlertBanner.danger with the error message |
| `useSalesCategorySummaryQuery` error | Category section AlertBanner.danger with separate error message |
| Empty range | Per-section EmptyState (dashedBorder) |
| Date range invalid (from > to) | Allowed at picker level. Postgres returns 0 rows for inverted range → EmptyState shows. Documented as known minor UX gap; the `DateRangePicker` itself doesn't validate yet. |
| RPC fails (network / 500) | `toAppError` wraps PostgrestError → AlertBanner shows wrapped message |

---

## 11. Risk register

| Risk | Mitigation |
|------|------------|
| NULL `category_name` produces awkward sort position | Postgres sorts NULLs last by default with DESC. UI shows them as "Chưa phân loại" — informative not broken. |
| Voided KiotViet orders inflate revenue | Spec acknowledges no status filter for parity with v4 PivotView. Flagged as known follow-up — not a blocker. |
| Same product re-categorized mid-period | GROUP BY includes `category_name` so each (product, category) pair gets its own row. Owner sees both rows + can reconcile. Matches view convention. |
| RPC perf on large `sales_order_items` | Existing index `sales_orders_business_date_idx` covers the filter. Coffee shop scale (~500–3000 orders/month) is fine. No materialized view needed. Revisit in Phase 6 if real-world data proves otherwise. |
| Sort default revenue DESC may be wrong for "popularity" question | DataTable allows runtime sort. Default = revenue. If owner asks for qty sort by default, flip in 5-line follow-up. |
| `product_id` is `text` (KiotViet string) — not Postgres UUID | Documented in RPC signature + ProductSummaryRow interface. Row key fallback chain handles nulls. |
| Cross-feature query-key collision | New `"sales-reports"` root explicitly separate from `"reports"` + `"inventory-reports"` namespaces. |

---

## 12. Implementation strategy (task projection)

**6 tasks** (one fewer than 5.A — both tables share the same template so tab composition + wire can fold):

| Task | Files | Verify |
|------|-------|--------|
| **T1** | `database/002_functions.sql` (+2 RPCs) + `database/tests/170_sales_reports.sql` (10 assertions) | 109 pgTAP, 75 Vitest |
| **T2** | `src/lib/data/reports.ts` (+2 wrappers + 2 types) · `src/hooks/queries/keys.ts` (+2 keys) · `src/hooks/queries/use-sales-reports-query.ts` (new) · `index.ts` re-export | `tsc --noEmit` clean |
| **T3** | `src/features/reports/product-summary-table.tsx` (new) | TS + verify:phase |
| **T4** | `src/features/reports/category-summary-table.tsx` (new) | TS + verify:phase |
| **T5** | `src/features/reports/sales-by-product-tab.tsx` (new) — composes T3 + T4 + DateRangePicker | TS + verify:phase |
| **T6** | `src/features/reports/reports-view.tsx` — swap placeholder for `<SalesByProductTab />`, smoke test 4 roles, tag `v4-phase-5b` | Final verify:phase = 184 green |

---

## 13. Success criteria

1. ✅ `npm run verify:phase` ends at **75 Vitest + 109 pgTAP = 184 green** (99 pre-5.B + 10 new in 170)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ Doanh số tab renders both tables with date-range picker driving them
5. ✅ Switching presets (Hôm nay / Tuần này / Tháng này) re-fetches both tables
6. ✅ Custom date range with from/to inputs filters correctly
7. ✅ Empty range → both EmptyStates show
8. ✅ NULL category_name rows show "Chưa phân loại"
9. ✅ Cash Close + Tồn kho (5.A) tabs unchanged
10. ✅ PivotView at `/pivot` unchanged (single-day raw POS list)
11. ✅ Manager + staff_operator: same view as owner (all read-only)
12. ✅ employee_viewer: cannot reach ReportsView
13. ✅ pgTAP 170 file: 10/10 assertions pass
14. ✅ Tag `v4-phase-5b` on final merge commit

---

## 14. Open decisions (deferred to writing-plans / execution)

- **Status_code filter**: currently NONE for parity with PivotView. If owner pushes back during T6 smoke testing, add filter in a follow-up patch.
- **Click-through drill-down**: clicking a product row could open that product's invoice history. Deferred to Phase 5.+ if requested.
- **Excel/CSV export**: deferred to Phase 5.+ (5.A also deferred).
- **Top-N pagination**: coffee shop scale doesn't need it. Revisit only if `product_summary` ever exceeds ~100 rows.
- **Discount breakdown column**: line_total used as displayed revenue. Owner can drill into PivotView for gross/discount split per invoice.

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
- "sales-reports" query-key namespace explicit (§8.2) ✓

**Ambiguity check:**
- "Flat aggregation by product" defined explicitly — one row per (product_id, product_code, product_name, category_name) tuple
- "Category aggregation" defined explicitly — one row per category_name (NULL gets its own row)
- "Sort default" defined explicitly — revenue DESC for both
- "No status_code filter" defined explicitly + flagged as follow-up
- Role gating uniform across tabs (§4.3)

**Scope check:** UI + 2 RPCs + 10 assertions. Manageable in 6 tasks. Matches 5.A scale.

No issues found.

---

## 16. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 6-task implementation plan with full SQL + TSX code inline per task.
