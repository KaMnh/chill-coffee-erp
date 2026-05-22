# Phase 5.B — Sales Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5.A's "Doanh số" placeholder tab with 2 multi-day sales aggregations — Product Summary (5-col) + Category Summary (3-col) — driven by the shared `DateRangePicker`.

**Architecture:** 2 STABLE read-only RPCs aggregate `sales_orders + sales_order_items` by `business_date BETWEEN p_from AND p_to`. Both feed a tab composition mirroring 5.A's `InventoryAnalyticsTab` (single `useState<DateRange>` drives both tables). ReportsView's existing `sales_product` placeholder swaps to `<SalesByProductTab />`. Standalone PivotView at `/pivot` stays untouched — additive.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Tailwind v4 · Radix `Tabs` (existing 5.A wrapper) · TanStack Query 5 · Supabase JS (RPC) · pgTAP via in-container psql · Vitest 2.1.9.

**Spec:** `docs/superpowers/specs/2026-05-22-v4-phase-5b-sales-reports-design.md`
**Branch:** `phase-5b-sales-reports` (already created off `main` @ tag `v4-phase-5a`)
**Tag at end:** `v4-phase-5b`
**Final verify target:** 75 Vitest + 109 pgTAP = 184 green

---

## File Manifest

### 5 new files
| Path | Lines (est) | Created in |
|------|-------------|------------|
| `database/tests/170_sales_reports.sql` | ~190 | T1 |
| `src/hooks/queries/use-sales-reports-query.ts` | ~50 | T2 |
| `src/features/reports/product-summary-table.tsx` | ~115 | T3 |
| `src/features/reports/category-summary-table.tsx` | ~95 | T4 |
| `src/features/reports/sales-by-product-tab.tsx` | ~30 | T5 |

### 5 modified files
| Path | Change | Touched in |
|------|--------|------------|
| `database/002_functions.sql` | Append 2 RPCs at EOF (currently 3148 lines) | T1 |
| `src/lib/data/reports.ts` | Append 2 wrapper functions + 2 row interfaces (currently 130 lines) | T2 |
| `src/hooks/queries/keys.ts` | Append 2 keys inside `queryKeys` object (currently 47 lines) | T2 |
| `src/hooks/queries/index.ts` | Re-export new hook file | T2 |
| `src/features/reports/reports-view.tsx` | Swap `sales_product` placeholder for `<SalesByProductTab />` | T6 |

### Off-limits (DO NOT TOUCH)
- `database/001_schema.sql` — no schema changes
- `database/003_rls.sql` — existing `sales_orders` + `sales_order_items` RLS allows SELECT for authenticated
- `src/lib/types.ts` — row interfaces stay in the data layer file (same pattern as 5.A)
- `src/features/pivot/**` — PivotView unchanged (additive only)
- All Phase 2/3/4/5.A primitives and modules

---

## Conventions reminder (apply to every commit)

1. **Vietnamese diacritics break PowerShell here-strings inside compound commands.** Always write commit body to `.git/COMMIT_MSG_TMP` first via `Out-File -Encoding utf8`, then `git commit -F`, then `Remove-Item`. The pattern appears verbatim in every commit step below.
2. **Every commit message MUST end with:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
3. **NO modifications to v3 production code, Supabase containers, or `.env` files.**
4. **`.gitignored` files stay gitignored.**

---

## Task 1: Backend RPCs + pgTAP (`170_sales_reports.sql`)

**Files:**
- Modify: `database/002_functions.sql` — append 2 new RPCs at EOF (currently line 3148)
- Create: `database/tests/170_sales_reports.sql` (10 pgTAP assertions)

### - [ ] Step 1: Append `sales_product_summary` RPC

Open `database/002_functions.sql` and append at the very end:

```sql

-- =====================================================================
-- Phase 5.B — Sales reports
-- =====================================================================

-- Sales by product over a date range. Aggregates sales_order_items
-- joined to sales_orders, filtered by sales_orders.business_date.
-- Groups by (product_id, product_code, product_name, category_name) —
-- so a mid-period rename or recategorisation surfaces as 2 rows.
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

-- Sales by category over a date range. Same JOIN + WHERE filter; groups
-- by category_name only. Intentionally NO order_count column — one order
-- with multiple products in same category would overcount.
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

Notes for the engineer:
- Both `STABLE` (PostgREST cacheable), NOT `SECURITY DEFINER` — relies on existing `sales_orders` + `sales_order_items` RLS which allows SELECT for `authenticated`.
- `set search_path = public` matches the codebase convention.
- `order_count::int` (not `bigint`) so supabase-js returns it as JS `number`, not `string`. Same defense as the 5.A T2 fix for `sale_count`.
- `business_date >= p_from AND business_date <= p_to` is intentionally NOT `BETWEEN` so a single-day report (`p_from = p_to`) is inclusive on both sides — verified in pgTAP Test 5 (date inclusive boundaries inherited from 5.A pattern).
- No `grant execute` line needed — PostgREST exposes RPCs to `authenticated` by default; RLS does the gating.

### - [ ] Step 2: Apply schema changes to the local Supabase DB

Run:
```powershell
node scripts/db-init.mjs
```
Expected: script reports schema/functions applied with no error.

### - [ ] Step 3: Quick sanity check the RPCs respond

```powershell
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select public.sales_product_summary(current_date - interval '7 days', current_date);"
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select public.sales_category_summary(current_date - interval '7 days', current_date);"
```
Expected: 0 rows back (empty dev tables), no error.

### - [ ] Step 4: Create the pgTAP test file

Create `database/tests/170_sales_reports.sql`:

```sql
-- Phase 5.B — Sales reports.
--
-- 10 assertions (top-level SELECT pattern):
--   sales_product_summary (5):
--     1. Empty range returns 0 rows
--     2. sum(quantity) correct across multiple orders for same product
--     3. sum(line_total) correct (revenue match)
--     4. order_count = count(distinct sales_order_id)
--     5. Sort is ORDER BY total_revenue DESC (verified via limit 1)
--
--   sales_category_summary (5):
--     6. Empty range returns 0 rows
--     7. Groups by category — 2 products in same category roll up to one row
--     8. sum(quantity) + sum(line_total) correct after roll-up
--     9. NULL category_name produces its own row
--    10. Sort is ORDER BY total_revenue DESC

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

-- ------------------------------------------------------------------
-- Test 1: empty range returns 0 rows (product)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.sales_product_summary(
     current_date - 30, current_date - 29)),
  0,
  'product: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Tests 2, 3, 4: same product across multiple orders + dup in one order
-- ------------------------------------------------------------------
-- Order 1: Espresso x2 (qty=2, line_total=50000)
-- Order 2: Espresso x1 (qty=1, line_total=25000)
-- Order 2: Espresso (DUPLICATE line, qty=1, line_total=25000)
--   → 3 lines, 2 distinct order IDs
--   → total_quantity = 2 + 1 + 1 = 4
--   → total_revenue  = 50000 + 25000 + 25000 = 100000
--   → order_count    = 2 (distinct sales_order_id)
create temp table _t_ord1 (id uuid);
create temp table _t_ord2 (id uuid);

with i1 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord1', current_date - 1, current_date - 1, 50000, 50000)
  returning id
)
insert into _t_ord1 select id from i1;

with i2 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord2', current_date - 1, current_date - 1, 50000, 50000)
  returning id
)
insert into _t_ord2 select id from i2;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord1), 0, 'test-170-l1-0', 'prod-Esp', 'ESP', 'Espresso', 'Cà phê', 2, 50000),
  ((select id from _t_ord2), 0, 'test-170-l2-0', 'prod-Esp', 'ESP', 'Espresso', 'Cà phê', 1, 25000),
  ((select id from _t_ord2), 1, 'test-170-l2-1', 'prod-Esp', 'ESP', 'Espresso', 'Cà phê', 1, 25000);

-- Test 2: sum quantity = 4
select is(
  (select total_quantity from public.sales_product_summary(
     current_date - 2, current_date)
   where product_id = 'prod-Esp'),
  4::numeric,
  'product: sum(quantity) across multiple lines = 4'
);

-- Test 3: sum revenue = 100000
select is(
  (select total_revenue from public.sales_product_summary(
     current_date - 2, current_date)
   where product_id = 'prod-Esp'),
  100000::numeric,
  'product: sum(line_total) = 100000'
);

-- Test 4: order_count = count(distinct sales_order_id) = 2
select is(
  (select order_count from public.sales_product_summary(
     current_date - 2, current_date)
   where product_id = 'prod-Esp'),
  2::int,
  'product: order_count = count(distinct sales_order_id) = 2'
);

-- ------------------------------------------------------------------
-- Test 5: sort is ORDER BY total_revenue DESC (product table)
-- ------------------------------------------------------------------
-- Add a second product with lower revenue so Espresso (100000) appears first.
create temp table _t_ord3 (id uuid);
with i3 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord3', current_date - 1, current_date - 1, 15000, 15000)
  returning id
)
insert into _t_ord3 select id from i3;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord3), 0, 'test-170-l3-0', 'prod-Tea', 'TEA', 'Trà đào', 'Trà', 1, 15000);

-- limit 1 against the function output relies on language-sql inlining
-- to preserve the function's top-level ORDER BY. Same pattern as 5.A.
select is(
  (select product_id from public.sales_product_summary(current_date - 2, current_date) limit 1),
  'prod-Esp',
  'product: first row is highest revenue (Espresso 100000 > Tea 15000)'
);

-- ==================================================================
-- sales_category_summary tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 6: empty range returns 0 rows (category)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.sales_category_summary(
     current_date - 60, current_date - 50)),
  0,
  'category: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Test 7: groups by category — 2 products in same category roll up
-- ------------------------------------------------------------------
-- Add a 2nd product in "Cà phê" — should merge with Espresso into 1 row.
create temp table _t_ord4 (id uuid);
with i4 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord4', current_date - 1, current_date - 1, 30000, 30000)
  returning id
)
insert into _t_ord4 select id from i4;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord4), 0, 'test-170-l4-0', 'prod-Latte', 'LAT', 'Latte', 'Cà phê', 1, 30000);

-- Cà phê now has: Espresso (4 qty, 100k revenue) + Latte (1 qty, 30k revenue)
-- → 1 row, total_quantity = 5, total_revenue = 130000
select is(
  (select count(*)::int from public.sales_category_summary(current_date - 2, current_date)
   where category_name = 'Cà phê'),
  1,
  'category: 2 products in same category roll up to 1 row'
);

-- Test 8: sum quantity + revenue after roll-up
select is(
  (select (total_quantity, total_revenue)
   from public.sales_category_summary(current_date - 2, current_date)
   where category_name = 'Cà phê'),
  (5::numeric, 130000::numeric),
  'category: sum(quantity) + sum(revenue) correct after roll-up'
);

-- ------------------------------------------------------------------
-- Test 9: NULL category_name produces its own row
-- ------------------------------------------------------------------
-- Add a sale with NULL category_name (uncategorised product).
create temp table _t_ord5 (id uuid);
with i5 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord5', current_date - 1, current_date - 1, 8000, 8000)
  returning id
)
insert into _t_ord5 select id from i5;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord5), 0, 'test-170-l5-0', 'prod-Misc', 'MISC', 'Khăn lạnh', null, 1, 8000);

select is(
  (select count(*)::int from public.sales_category_summary(current_date - 2, current_date)
   where category_name is null),
  1,
  'category: NULL category_name produces its own row'
);

-- ------------------------------------------------------------------
-- Test 10: sort ORDER BY total_revenue DESC (category)
-- ------------------------------------------------------------------
-- Categories now:
--   Cà phê: 130000
--   Trà:    15000
--   NULL:    8000
-- Expected first row: Cà phê
select is(
  (select category_name from public.sales_category_summary(current_date - 2, current_date) limit 1),
  'Cà phê',
  'category: first row is highest revenue (Cà phê 130000)'
);

select * from finish();
rollback;
```

Notes for the engineer:
- All 10 `select is(...)` calls are top-level SELECTs (no DO blocks — Phase 4.A learning).
- Confirm exactly 10 by running `grep -c "^select is(" database/tests/170_sales_reports.sql` before commit.
- Test 5 and Test 10 use `limit 1` against the function output (no outer `order by`), relying on documented `language sql` inlining to preserve the function's top-level `ORDER BY`. Same pattern as 5.A Tests 6 and 9 (after the T1 fix in 5.A).
- Test 8 compares a row literal `(5::numeric, 130000::numeric)` — if pgTAP rejects with `cannot compare dissimilar column types`, fall back to two separate `select is(...)` checks (one for quantity, one for revenue) and re-target `plan(11)` accordingly. The row-literal form worked in 5.A's analogous Test 10 once we adapted to string-concat — try the row form first.
- Vietnamese category strings ('Cà phê', 'Trà đào', 'Khăn lạnh') are intentional — exercises the diacritic path through the GROUP BY and string equality. The test transaction will `rollback;` so dev data is untouched.

### - [ ] Step 5: Run the full pgTAP suite

```powershell
npm run pgtap
```
Expected: **99 + 10 = 109 assertions passing** (89 pre-Phase-4 + 10 5.A + 10 new 5.B). No failures.

For faster iteration on a single file you can pipe through psql:
```powershell
$sql = Get-Content "database/tests/170_sales_reports.sql" -Raw
$sql | docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres
```
Fix and re-run until clean.

### - [ ] Step 6: Run the Vitest suite (must still be 75)

```powershell
npm test -- --run
```
Expected: 75 tests passing.

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5b): T1 — backend RPCs + pgTAP 170 (+10 assertions)

Append 2 STABLE RPCs to 002_functions.sql:

- sales_product_summary(p_from, p_to)
  Aggregates sales_order_items joined to sales_orders by
  (product_id, product_code, product_name, category_name).
  Returns total_quantity, total_revenue, order_count (distinct
  sales_order_id). Mid-period rename or recategorisation
  produces 2 rows.

- sales_category_summary(p_from, p_to)
  Same join + business_date filter. Groups by category_name
  only. NO order_count column — would overcount when one
  order has multiple products in same category.

Both STABLE for PostgREST caching, no SECURITY DEFINER (existing
sales_orders + sales_order_items RLS handles authenticated read).
order_count cast to ::int (not ::bigint) so supabase-js returns
JS number — same defense as 5.A T2 fix.

New pgTAP file 170_sales_reports.sql with 10 assertions:
- product: 5 (empty, sum qty, sum revenue, order_count distinct,
  sort)
- category: 5 (empty, group-by rollup, sum after rollup, NULL
  category own row, sort)

verify:phase: 75 Vitest + 109 pgTAP = 184 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add database/002_functions.sql database/tests/170_sales_reports.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 2: Data layer + query hooks + keys

**Files:**
- Modify: `src/lib/data/reports.ts` — append 2 wrappers + 2 row types (currently 130 lines)
- Modify: `src/hooks/queries/keys.ts` — append 2 keys inside `queryKeys` object (currently 47 lines)
- Modify: `src/hooks/queries/index.ts` — re-export new file
- Create: `src/hooks/queries/use-sales-reports-query.ts`

### - [ ] Step 1: Append data layer wrappers + types

Open `src/lib/data/reports.ts`. The file currently ends at line 130 (after the 5.A `VarianceRow` and `loadInventoryVariance` exports). Append at EOF:

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

Notes:
- `SupabaseClient` already imported at the top of the file (line 1).
- `toAppError` already imported from `./_common` (line 3).
- Both row interfaces marked `export` because the query hooks file imports them.
- `product_id` / `product_code` typed as `string | null` because KiotViet may not send them for legacy/manual entries; same defensive shape as the row-key fallback in T3.
- `category_name` typed as `string | null` to surface uncategorised products (UI displays them as "Chưa phân loại" in T4 and the product table in T3).

### - [ ] Step 2: Append query keys

Open `src/hooks/queries/keys.ts`. The factory currently ends at line 47 with `inventoryVariance` (line 45–46) then `};` (line 47). Insert 2 new entries between `inventoryVariance` and the closing `};`:

```ts
  inventoryVariance: (range: { from: string; to: string }) =>
    ["inventory-reports", "variance", range] as const,

  // Phase 5.B — Sales reports
  salesProductSummary: (range: { from: string; to: string }) =>
    ["sales-reports", "product", range] as const,
  salesCategorySummary: (range: { from: string; to: string }) =>
    ["sales-reports", "category", range] as const,
};
```

(Add 2 new entries; the closing `};` stays. The leading `"inventory-reports"` root for 5.A is unchanged.)

The new `"sales-reports"` root is intentionally separate from `"reports"` (Cash Close) and `"inventory-reports"` (5.A) to prevent accidental cache blast from broad invalidation. Same defense as 5.A T2 fix.

### - [ ] Step 3: Create the query hook file

Create `src/hooks/queries/use-sales-reports-query.ts`:

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
 * Phase 5.B — Sales analytics query hooks.
 *
 * Both queries:
 *   - staleTime 60s (user-driven date-range pulls, bg-refresh unwanted)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hooks in this phase
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

### - [ ] Step 4: Add the file to the queries barrel

Open `src/hooks/queries/index.ts`. The file currently ends with:

```ts
export * from "./use-inventory-queries";
export * from "./use-stock-movements-query";
export * from "./use-inventory-reports-query";
```

Add one line at the bottom:

```ts
export * from "./use-inventory-queries";
export * from "./use-stock-movements-query";
export * from "./use-inventory-reports-query";
export * from "./use-sales-reports-query";
```

### - [ ] Step 5: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 6: Run verify:phase (no test changes — should still be 75 / 109)

```powershell
npm run verify:phase
```
Expected: 75 Vitest + 109 pgTAP green.

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5b): T2 — data layer + query hooks + keys

src/lib/data/reports.ts (append):
- ProductSummaryRow / CategorySummaryRow interfaces
- loadSalesProductSummary(supabase, from, to)
- loadSalesCategorySummary(supabase, from, to)
  Both call the new T1 RPCs, throw toAppError on failure with
  Vietnamese fallback messages.

src/hooks/queries/keys.ts (append):
- salesProductSummary({ from, to }) factory
- salesCategorySummary({ from, to }) factory
  Both rooted at "sales-reports" — decoupled from "reports"
  (Cash Close) and "inventory-reports" (5.A).

src/hooks/queries/use-sales-reports-query.ts (new):
- useSalesProductSummaryQuery(supabase, from, to, enabled?)
- useSalesCategorySummaryQuery(supabase, from, to, enabled?)
- staleTime 60s; supabase null-guard via enabled.

src/hooks/queries/index.ts: export new file.

TS strict + verify:phase: 75 + 109 = 184 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/lib/data/reports.ts src/hooks/queries/keys.ts src/hooks/queries/use-sales-reports-query.ts src/hooks/queries/index.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 3: `ProductSummaryTable`

**Files:**
- Create: `src/features/reports/product-summary-table.tsx`

### - [ ] Step 1: Create the component

Create `src/features/reports/product-summary-table.tsx`:

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useSalesProductSummaryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.B — Sales by product over a date range.
 *
 * Data source: sales_product_summary RPC (aggregates
 * sales_order_items joined to sales_orders, grouped by
 * (product_id, product_code, product_name, category_name)).
 * Sorted DESC by total_revenue; rendered flat.
 */

interface ProductSummaryTableProps {
  dateRange: DateRange;
}

export function ProductSummaryTable({ dateRange }: ProductSummaryTableProps) {
  const supabase = useSupabase();
  const query = useSalesProductSummaryQuery(
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
      <AlertBanner variant="danger" title="Không tải được báo cáo doanh thu">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="barChart3"
        title="Chưa có doanh số trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc đợi sync POS mới."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Doanh thu theo sản phẩm</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} sản phẩm
          </Badge>
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
              <tr
                key={row.product_id || row.product_code || row.product_name}
                className="border-t border-border"
              >
                <td className="py-2 text-ink">{row.product_name}</td>
                <td className="py-2 text-muted">
                  {row.category_name ?? "Chưa phân loại"}
                </td>
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
  );
}
```

Notes for the engineer:
- `formatVND` from `@/lib/format` is the existing helper used by `PivotView`, `ReconciliationSummary`, and printable reports. Same formatting as the rest of v4.
- Row key fallback: `row.product_id || row.product_code || row.product_name`. The OR chain handles legacy/manual orders with null product_id. The product_name is virtually unique per shop but the fallback chain protects against React key collisions.
- `<th scope="col">` matches accessibility convention from the 5.A T4 code review (noted as minor improvement deferred — applied here from the start).
- `vi-VN` locale gives thousand separator `.` and decimal `,`. Same convention as 5.A.

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors. If `Badge` props complain about `variant="soft" semantic="neutral"`, open `src/components/ui/badge.tsx` and confirm the prop names — these worked in 5.A T4, should still work.

### - [ ] Step 3: Smoke verify (nothing should regress)

```powershell
npm run verify:phase
```
Expected: 75 + 109 = 184 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5b): T3 — ProductSummaryTable

src/features/reports/product-summary-table.tsx (new):
- useSalesProductSummaryQuery(dateRange.from, dateRange.to)
- Loading: Spinner size 24, centered py-8
- Error: AlertBanner variant=danger with wrapped message
- Empty: EmptyState dashedBorder icon=barChart3 with VN copy
  "Chưa có doanh số trong khoảng này"
- Data: Card → 5-col table (Sản phẩm / Danh mục / Số lượng /
  Doanh thu / Số đơn). vi-VN locale on numerics. formatVND
  for revenue. Row key fallback chain handles null product_id.
- NULL category_name → "Chưa phân loại"
- <th scope="col"> on all column headers (a11y)

verify:phase: 75 + 109 = 184 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/product-summary-table.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 4: `CategorySummaryTable`

**Files:**
- Create: `src/features/reports/category-summary-table.tsx`

### - [ ] Step 1: Create the component

Create `src/features/reports/category-summary-table.tsx`:

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useSalesCategorySummaryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.B — Sales by category over a date range.
 *
 * Data source: sales_category_summary RPC (groups by
 * category_name only — NULL gets its own bucket displayed as
 * "Chưa phân loại"). Sorted DESC by total_revenue.
 *
 * Deliberately no order_count column — would overcount when
 * one order has multiple products in the same category.
 */

interface CategorySummaryTableProps {
  dateRange: DateRange;
}

export function CategorySummaryTable({ dateRange }: CategorySummaryTableProps) {
  const supabase = useSupabase();
  const query = useSalesCategorySummaryQuery(
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
      <AlertBanner variant="danger" title="Không tải được báo cáo danh mục">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="barChart3"
        title="Chưa có doanh số trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc đợi sync POS mới."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Doanh thu theo danh mục</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} danh mục
          </Badge>
        </div>
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
              <tr
                key={row.category_name ?? `null-${i}`}
                className="border-t border-border"
              >
                <td className="py-2 text-ink">
                  {row.category_name ?? "Chưa phân loại"}
                </td>
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
      </CardBody>
    </Card>
  );
}
```

Notes for the engineer:
- Mirrors `ProductSummaryTable` shape — 3 cols instead of 5, drops the order_count column (overcounting risk per spec §3 + §5.2).
- Row key uses `row.category_name ?? \`null-${i}\`` — the GROUP BY should produce at most one NULL row, but the index-suffixed fallback is defensive against any future change.
- Error title is different from T3 ("danh mục" not "doanh thu") so the user sees which section failed independently.

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 3: Smoke verify

```powershell
npm run verify:phase
```
Expected: 75 + 109 = 184 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5b): T4 — CategorySummaryTable

src/features/reports/category-summary-table.tsx (new):
- useSalesCategorySummaryQuery(dateRange.from, dateRange.to)
- Loading / Error / Empty branches match T3 pattern with
  distinct error title "Không tải được báo cáo danh mục"
- Data: Card → 3-col table (Danh mục / Số lượng / Doanh thu).
  NO order_count column — by design, would overcount when one
  order has multiple products in same category.
- NULL category_name displays as "Chưa phân loại"; row key
  fallback uses `null-${i}` defensively.
- <th scope="col"> on all column headers.

verify:phase: 75 + 109 = 184 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/category-summary-table.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 5: `SalesByProductTab`

**Files:**
- Create: `src/features/reports/sales-by-product-tab.tsx`

### - [ ] Step 1: Create the tab composition

Create `src/features/reports/sales-by-product-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ProductSummaryTable } from "./product-summary-table";
import { CategorySummaryTable } from "./category-summary-table";

/**
 * Phase 5.B — Sales tab inside ReportsView.
 *
 * Single source of truth for the date range: both
 * ProductSummaryTable and CategorySummaryTable receive the same
 * value. Changing the picker re-keys both TanStack Query caches.
 *
 * Mirrors InventoryAnalyticsTab (5.A) verbatim.
 */
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

Notes:
- Lazy state init (`useState(() => defaultDateRange())`) so `new Date()` runs only on mount, not every render.
- Both tables share one `dateRange` value — clean cache invalidation when the picker changes.
- Not yet wired into `ReportsView` — that's T6.

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 3: Smoke verify

```powershell
npm run verify:phase
```
Expected: 75 + 109 = 184 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5b): T5 — SalesByProductTab

src/features/reports/sales-by-product-tab.tsx (new):
- useState<DateRange> lazy-initialised with defaultDateRange()
  (= "Tuần này": Monday → today, from 5.A)
- DateRangePicker at top, both tables below sharing the same
  range. Changing the picker invalidates both queries via
  TanStack Query's automatic key change.

Not yet wired into ReportsView — that's T6.

verify:phase: 75 + 109 = 184 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/sales-by-product-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 6: `ReportsView` placeholder swap + verify + tag `v4-phase-5b`

**Files:**
- Modify: `src/features/reports/reports-view.tsx` — swap `sales_product` placeholder for `<SalesByProductTab />`

### - [ ] Step 1: Add the import

Open `src/features/reports/reports-view.tsx`. Find the existing import block at the top of the file. The 5.A T7 refactor added:
```tsx
import { InventoryAnalyticsTab } from "./inventory-analytics-tab";
```

Add immediately after it:
```tsx
import { SalesByProductTab } from "./sales-by-product-tab";
```

### - [ ] Step 2: Swap the placeholder

Find this exact block (around lines 45–53 after the 5.A T7 refactor):

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

Replace it with:

```tsx
      <TabsContent value="sales_product">
        <SalesByProductTab />
      </TabsContent>
```

All other tabs (`cash_close`, `inventory`, `expense_payroll`, `hourly`) stay untouched. The `<CashCloseTab businessDate={businessDate} />` and `<InventoryAnalyticsTab />` and the 2 remaining EmptyState placeholders are unchanged.

### - [ ] Step 3: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 4: Production build sanity check

```powershell
npm run build
```
Expected: build succeeds with no type or compile errors.

### - [ ] Step 5: Run the full verify suite

```powershell
npm run verify:phase
```
Expected: **75 Vitest + 109 pgTAP = 184 green**.

### - [ ] Step 6: Manual smoke test (recommended before commit)

Start the dev server in another terminal (`npm run dev`) and verify in a browser:

1. Owner login → Báo cáo → "Chốt két" tab is default and shows existing Cash Close UI unchanged
2. Click "Tồn kho" tab → 5.A consumption + variance reports render unchanged
3. Click "Doanh số" tab → DateRangePicker + ProductSummaryTable + CategorySummaryTable render
4. Click "Hôm nay" / "Tuần này" / "Tháng này" presets → both tables refetch with new data
5. Click "Khoảng tùy chọn" → custom from/to date inputs appear; changing either refetches
6. With an empty `sales_orders` dev DB or a range pre-KiotViet-data → both EmptyStates render with the "Chưa có doanh số" message
7. Verify any uncategorised products show "Chưa phân loại" in the Danh mục column (Product table) and as a separate row in the Category table
8. Click "Chi phí + lương" tab → still placeholder for 5.C (unchanged from 5.A)
9. Click "Theo giờ" tab → still placeholder for 5.D (unchanged from 5.A)
10. Visit `/pivot` (standalone PivotView) → single-day raw POS list renders unchanged
11. Log in as manager → same 5 ReportsView tabs visible, same read-only behavior
12. Log in as staff_operator → same 5 tabs visible
13. Log in as employee_viewer → Báo cáo NOT in sidebar (NAV_ITEMS blocks)

If any smoke check fails, fix and re-verify before committing.

### - [ ] Step 7: Commit the swap

```powershell
@'
feat(phase-5b): T6 — wire SalesByProductTab + tag v4-phase-5b

src/features/reports/reports-view.tsx:
- Add import: SalesByProductTab from "./sales-by-product-tab"
- Replace `sales_product` placeholder EmptyState with
  <SalesByProductTab />.

All other tabs (cash_close, inventory, expense_payroll, hourly)
unchanged. Standalone PivotView at /pivot unchanged — Phase 5.B
is additive, not a replacement.

Role gating unchanged: NAV_ITEMS restricts Báo cáo to
owner + manager + staff_operator. employee_viewer blocked.

Manual smoke: all 4 roles tested in browser. All 5 ReportsView
tabs visible to the 3 allowed roles. Doanh số tab renders the
2 new aggregations driven by the shared DateRangePicker.

verify:phase: 75 Vitest + 109 pgTAP = 184 green.

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

### - [ ] Step 9: Tag `v4-phase-5b`

```powershell
git tag -a v4-phase-5b -m "Phase 5.B — Sales Reports"
git log --oneline -10
git tag -l "v4-phase-5*"
```
Expected:
- `git log` shows the latest commits from this phase
- `git tag -l` shows `v4-phase-5a` (from prior phase) + `v4-phase-5b` (new). No umbrella `v4-phase-5` yet — that comes after 5.D.

### - [ ] Step 10: Final status check

```powershell
git status
git diff main..HEAD --stat
```
Expected:
- `git status`: clean working tree
- `git diff main..HEAD --stat`: shows the spec + plan docs + 5 code files modified/new:
  - `docs/superpowers/specs/2026-05-22-v4-phase-5b-sales-reports-design.md` (already committed)
  - `docs/superpowers/plans/2026-05-22-v4-phase-5b-sales-reports.md` (this file, if committed before subagent dispatch)
  - `database/002_functions.sql` (modified)
  - `database/tests/170_sales_reports.sql` (new)
  - `src/lib/data/reports.ts` (modified)
  - `src/hooks/queries/keys.ts` (modified)
  - `src/hooks/queries/index.ts` (modified)
  - `src/hooks/queries/use-sales-reports-query.ts` (new)
  - `src/features/reports/product-summary-table.tsx` (new)
  - `src/features/reports/category-summary-table.tsx` (new)
  - `src/features/reports/sales-by-product-tab.tsx` (new)
  - `src/features/reports/reports-view.tsx` (modified)

If extra files appear that aren't in the manifest, investigate before invoking `superpowers:finishing-a-development-branch`.

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
| pgTAP | `npm run pgtap` | 109 pass (99 prior + 10 new in 170) |
| TS strict | `npx tsc --noEmit` | 0 errors |
| Build | `npm run build` | success |
| Branch | `git log --oneline main..phase-5b-sales-reports` | 6 task commits + spec + plan commits |
| Tag | `git tag -l v4-phase-5b` | exists, points to final merge commit |

Manual UI smoke (from T6 Step 6) — owner login first, then verify the other 3 roles can reach the same tabs.

---

## Self-review

### Spec coverage
| Spec section | Requirement | Plan task |
|---|---|---|
| §3 (scope decisions) | Keep PivotView separate, 2 reports, base-table queries, revenue DESC sort, no order_count on category, "Tuần này" default, shared picker, no status filter, NULL handling | T1 + T3 + T4 + T5 |
| §4.1 (ReportsView placeholder swap) | Replace `sales_product` placeholder with `<SalesByProductTab />` | T6 |
| §4.2 (SalesByProductTab composition) | Single useState, both tables share dateRange | T5 |
| §4.3 (role gating) | Inherits ReportsView's NAV_ITEMS gate | T6 smoke step |
| §4.4 (data flow) | Both queries staleTime 60s, supabase null-guarded | T2 |
| §5.1 (`sales_product_summary` RPC) | STABLE, no SECURITY DEFINER, business_date filter, group + order | T1 |
| §5.2 (`sales_category_summary` RPC) | Same JOIN, group by category, NO order_count | T1 |
| §5.3 (10 pgTAP assertions) | 5 product + 5 category | T1 |
| §6.1 (5 new files) | All 5 referenced in T1–T5 | ✓ |
| §6.2 (5 modified files) | All 5 touched by T1, T2, T6 | ✓ |
| §7.1 (ProductSummaryTable 4-branch) | loading / error / empty / data | T3 |
| §7.2 (CategorySummaryTable 3 cols, no order_count) | drops column per spec | T4 |
| §7.3 (SalesByProductTab composition) | Mirrors InventoryAnalyticsTab | T5 |
| §7.4 (ReportsView swap mechanics) | Add import + replace TabsContent body | T6 |
| §8.1 (data layer wrappers) | 2 interfaces + 2 functions | T2 |
| §8.2 (query keys "sales-reports" namespace) | New root, decoupled | T2 |
| §8.3 (query hooks file) | 2 hooks, staleTime 60s | T2 |
| §8.4 (barrel export) | Add line to index.ts | T2 |
| §9 (Vietnamese strings) | All 15 strings appear in T3, T4, T6 | ✓ |
| §10 (error handling) | AlertBanner.danger per section, EmptyState for empty range | T3 + T4 |
| §11 (risks) | NULL category, voided orders, mid-period recategorisation, perf, sort default, product_id text, key namespace collision | Documented; mitigations in T1 + T2 + T3 + T4 |
| §13 (success criteria) | All 14 items | Covered by T6 final verify + smoke |

### Placeholder scan
- No "TBD" / "implement later" / "TODO" / "handle edge cases" / "Similar to Task N" in any task
- T1 Step 4 includes a fallback note for row-literal Test 8 (`(5::numeric, 130000::numeric)`) — if pgTAP rejects, falls back to two separate assertions. This is a concrete contingency with a known mitigation (matches the 5.A T1 Test 10 string-concat workaround), not a placeholder. The plan's pgTAP code uses the row form first because pgTAP supports row literals in `is()` — the 5.A issue was specific to row literals containing `text` and `unknown` types, which Test 8 avoids by explicitly casting both numerics.

### Type consistency
- `DateRange` from `./date-range-picker` — same import path in T3, T4, T5
- `ProductSummaryRow` defined in T2 with 7 fields → consumed in T3
- `CategorySummaryRow` defined in T2 with 3 fields → consumed in T4
- `useSalesProductSummaryQuery(supabase, from, to, enabled?)` signature consistent between T2 (declaration) and T3 (call)
- `useSalesCategorySummaryQuery(supabase, from, to, enabled?)` signature consistent between T2 and T4
- `formatVND` import path `@/lib/format` — same in T3 and T4
- `SalesByProductTab` named export in T5 → imported in T6
- Query key `salesProductSummary({ from, to })` and `salesCategorySummary({ from, to })` shape matches between keys.ts (T2 step 2) and the hook usage (T2 step 3)

### Scope check
6 tasks × ~7–10 steps each = ~50 total steps. Smaller than 5.A (which had 7 tasks because of the ReportsView refactor; 5.B just swaps a placeholder, so T6 ≈ 5.A T7 minus the byte-for-byte preservation work). All steps fit the 2–5 minute target. No spec requirement uncovered.

No issues found.

---

## After this plan

Once T6 merges and tag `v4-phase-5b` lands:

- **Phase 5.C** (Expense + payroll date-range reports) — replaces `expense_payroll` placeholder. New RPCs `expense_summary_by_category` + `payroll_summary_by_employee`. ~5–6 tasks.
- **Phase 5.D** (Hourly / intraday trends) — replaces `hourly` placeholder. New RPC `sales_hourly_summary`. Chart library decision (Recharts vs SVG vs HTML table) deferred to 5.D brainstorm. ~4–5 tasks.
- **Umbrella `v4-phase-5`** tag placed on the final merge commit of 5.D.

5.B's `"sales-reports"` query-key namespace is established; 5.D will likely extend it for hourly variants.
