# Phase 5.D — Hourly Trends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5.A's "Theo giờ" placeholder tab with a chart-driven hourly trends view — 3 KPI tiles (peak hour / total revenue / total orders) above a 24-bar Recharts BarChart with peak-hour highlighting. Closes Phase 5.

**Architecture:** 1 STABLE read-only RPC aggregates `sales_orders + sales_order_items` by `extract(hour from purchase_at AT TIME ZONE 'Asia/Ho_Chi_Minh')`, returning a deterministic 24 rows via `generate_series(0,23) LEFT JOIN`. The tab owns the query (not pure composition like 5.A/B/C) and feeds the SAME data array to both KPI row + chart. Chart uses the EXISTING `<BarChart>` primitive (Recharts wrapper at `src/components/charts/bar-chart.tsx`) which already supports `highlightKey` + `formatY`. T5 places BOTH the `v4-phase-5d` sub-phase tag AND the umbrella `v4-phase-5` tag closing Phase 5 entirely.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Tailwind v4 · Radix Tabs (existing 5.A wrapper) · Recharts (`^3.8.1`, already installed) · TanStack Query 5 · Supabase JS (RPC) · pgTAP via in-container psql · Vitest 2.1.9.

**Spec:** `docs/superpowers/specs/2026-05-22-v4-phase-5d-hourly-trends-design.md`
**Branch:** `phase-5d-hourly-trends` (already created off `main` @ tag `v4-phase-5c`)
**Tags at end:** `v4-phase-5d` (sub-phase) + `v4-phase-5` (umbrella — closes Phase 5)
**Final verify target:** 75 Vitest + 131 pgTAP = 206 green

---

## File Manifest

### 5 new files
| Path | Lines (est) | Created in |
|------|-------------|------------|
| `database/tests/190_sales_hourly_reports.sql` | ~230 | T1 |
| `src/hooks/queries/use-hourly-reports-query.ts` | ~30 | T2 |
| `src/features/reports/hourly-kpi-row.tsx` | ~80 | T3 |
| `src/features/reports/hourly-bar-chart.tsx` | ~50 | T4 |
| `src/features/reports/hourly-trends-tab.tsx` | ~75 | T5 |

### 5 modified files
| Path | Change | Touched in |
|------|--------|------------|
| `database/002_functions.sql` | Append 1 RPC at EOF (currently 3292 lines) | T1 |
| `src/lib/data/reports.ts` | Append 1 wrapper + 1 row interface (currently 221 lines) | T2 |
| `src/hooks/queries/keys.ts` | Append 1 key under existing `"sales-reports"` namespace (currently 59 lines) | T2 |
| `src/hooks/queries/index.ts` | Re-export new hook file (currently 18 lines) | T2 |
| `src/features/reports/reports-view.tsx` | Swap `hourly` placeholder for `<HourlyTrendsTab />` + add import | T5 |

### Off-limits (DO NOT TOUCH)
- `database/001_schema.sql` — no schema changes
- `database/003_rls.sql` — existing RLS on `sales_orders` + `sales_order_items` allows SELECT for `authenticated`
- `src/components/charts/bar-chart.tsx` — **reused as-is, do NOT modify** even if it would feel cleaner to extend
- `src/lib/types.ts` — `HourlyRow` stays in the data layer file (5.A/B/C pattern)
- `src/features/pivot/**` — PivotView untouched
- All Phase 2/3/4/5.A/B/C primitives and modules

---

## Conventions reminder (apply to every commit)

1. **Vietnamese diacritics break PowerShell here-strings in compound commands.** Always write commit body to `.git/COMMIT_MSG_TMP` first via `Out-File -Encoding utf8`, then `git commit -F`, then `Remove-Item`. The pattern appears verbatim in every commit step below.
2. **Every commit message MUST end with:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
3. **NO modifications to v3 production code, Supabase containers, or `.env` files.**
4. **`.gitignored` files stay gitignored.**

---

## Task 1: Backend RPC + pgTAP (`190_sales_hourly_reports.sql`)

**Files:**
- Modify: `database/002_functions.sql` — append 1 new RPC at EOF (currently line 3292)
- Create: `database/tests/190_sales_hourly_reports.sql` (10 pgTAP assertions including 2 timezone-boundary tests)

### - [ ] Step 1: Append the RPC to `database/002_functions.sql`

Open `database/002_functions.sql` and append at the very end:

```sql

-- =====================================================================
-- Phase 5.D — Hourly trends report
-- =====================================================================

-- Sales aggregation by hour-of-day over a date range. Always returns
-- 24 rows (one per hour 0..23) via generate_series LEFT JOIN — zero
-- hours surface as zero bars in the UI chart, giving the owner
-- shop-hours context at a glance.
--
-- CRITICAL: AT TIME ZONE 'Asia/Ho_Chi_Minh' is applied BEFORE
-- extract(hour ...) so the bucket reflects Vietnam local time, not
-- UTC. Without this, a 02:00 UTC sale (= 09:00 Vietnam) would bucket
-- as hour=2 instead of hour=9. Same defense as 5.A T1's date-cast fix.
-- See pgTAP file 190 Tests 3 + 4 for explicit boundary verification.
--
-- business_date filter (not purchase_at directly) matches the 5.B
-- convention — date boundary handled at the sales_orders level,
-- hour bucket derived from purchase_at via the timezone-aware cast.
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

Notes for the engineer:
- `STABLE` (PostgREST cacheable), NOT `SECURITY DEFINER` — existing RLS on `sales_orders` + `sales_order_items` allows SELECT for `authenticated`.
- `set search_path = public` matches codebase convention.
- `count(*)::int` and `sum(...)::int` (not `bigint`) — same defense as 5.B T1 / 5.C T1 fixes (avoids supabase-js returning bigint as string).
- `coalesce(..., 0)` so empty hours have numeric 0 instead of NULL.
- Sort: `sale_hour ASC` (chronological), NOT by revenue — chart bars left-to-right represent time-of-day.

### - [ ] Step 2: Apply schema changes

```powershell
node scripts/db-init.mjs
```
Expected: schema/functions applied with no error.

### - [ ] Step 3: Sanity check the RPC

```powershell
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select count(*) from public.sales_hourly_summary(current_date - interval '7 days', current_date);"
```
Expected: returns `24` (always — `generate_series` guarantees 24 rows). Even on empty dev DB.

```powershell
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select sale_hour, total_revenue from public.sales_hourly_summary(current_date - interval '7 days', current_date) limit 3;"
```
Expected: 3 rows with `sale_hour` 0, 1, 2 (chronological), `total_revenue` likely 0 on empty dev DB.

### - [ ] Step 4: Create the pgTAP test file

Create `database/tests/190_sales_hourly_reports.sql`:

```sql
-- Phase 5.D — Hourly trends report.
--
-- 10 assertions (top-level SELECT pattern):
--   sales_hourly_summary (10):
--     1. Always returns exactly 24 rows even with empty range
--     2. Empty range returns rows with all zero values
--     3. TZ boundary: 02:00 UTC sale (= 09:00 Vietnam) buckets to hour=9
--     4. TZ boundary: 17:00 UTC sale (= 00:00 next-day Vietnam) buckets
--        to hour=0 (verifying the business_date filter correctly
--        includes the next Vietnam date)
--     5. sum(line_total) correct across 2 sales in same hour
--     6. sum(quantity) correct across 2 sales in same hour
--     7. order_count = count(distinct sales_order_id) per hour
--     8. business_date filter excludes purchases outside range
--     9. Sort is ASC by sale_hour (first row's sale_hour = 0)
--    10. coalesce zeros: empty hour returns total_revenue=0 (not NULL)

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
-- Test 1: always returns 24 rows even with empty range
-- ==================================================================
select is(
  (select count(*)::int from public.sales_hourly_summary(
     current_date - 30, current_date - 29)),
  24,
  'hourly: always returns exactly 24 rows even when empty'
);

-- ==================================================================
-- Test 2: empty range has all zero values
-- ==================================================================
select is(
  (select sum(total_revenue)::numeric from public.sales_hourly_summary(
     current_date - 30, current_date - 29)),
  0::numeric,
  'hourly: empty range — sum of total_revenue across 24 rows = 0'
);

-- ==================================================================
-- Test 3: TZ boundary — 02:00 UTC sale = 09:00 Vietnam → hour=9
-- ==================================================================
-- Insert a sale on yesterday with purchase_at = (current_date - 1) at 02:00 UTC.
-- 02:00 UTC = 09:00 Vietnam (UTC+7). business_date is yesterday.
create temp table _t_ord_tz1 (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-tz1',
    -- explicit timestamptz: yesterday at 02:00 UTC (= 09:00 Asia/Ho_Chi_Minh)
    ((current_date - 1)::timestamp + time '02:00') at time zone 'UTC',
    current_date - 1,
    100000, 100000
  )
  returning id
)
insert into _t_ord_tz1 select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_tz1), 0, 'test-190-tz1-l0', 'TZ Test 1', 1, 100000
);

-- The 02:00 UTC sale should land in hour=9 (Vietnam time), not hour=2
select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  100000::numeric,
  'hourly: TZ boundary — 02:00 UTC sale = hour=9 Vietnam'
);

-- ==================================================================
-- Test 4: TZ boundary — 17:00 UTC sale = 00:00 next-day Vietnam → hour=0
-- ==================================================================
-- Insert a sale at 17:00 UTC on (current_date - 2). In Vietnam time
-- that is 00:00 on (current_date - 1). business_date matches Vietnam
-- date (current_date - 1) since that's the kiotviet "shift" day.
create temp table _t_ord_tz2 (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-tz2',
    ((current_date - 2)::timestamp + time '17:00') at time zone 'UTC',
    current_date - 1,  -- Vietnam-time business_date for this purchase
    50000, 50000
  )
  returning id
)
insert into _t_ord_tz2 select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_tz2), 0, 'test-190-tz2-l0', 'TZ Test 2', 1, 50000
);

select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 0),
  50000::numeric,
  'hourly: TZ boundary — 17:00 UTC sale = hour=0 next-day Vietnam'
);

-- ==================================================================
-- Tests 5 + 6: sum(line_total) + sum(quantity) across 2 sales in
-- the same hour
-- ==================================================================
-- Add a 2nd sale in hour=9 Vietnam (= 02:30 UTC) on (current_date - 1).
-- Combined with Test 3's 100000 → hour=9 total_revenue = 100000 + 75000
-- = 175000; total_quantity = 1 + 2 = 3.
create temp table _t_ord_h9b (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-h9b',
    ((current_date - 1)::timestamp + time '02:30') at time zone 'UTC',
    current_date - 1,
    75000, 75000
  )
  returning id
)
insert into _t_ord_h9b select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_h9b), 0, 'test-190-h9b-l0', 'Hour9b', 2, 75000
);

-- Test 5: sum(line_total) for hour=9 = 100000 + 75000 = 175000
select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  175000::numeric,
  'hourly: sum(line_total) across 2 sales in same hour = 175000'
);

-- Test 6: sum(quantity) for hour=9 = 1 + 2 = 3
select is(
  (select total_quantity from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  3::numeric,
  'hourly: sum(quantity) across 2 sales in same hour = 3'
);

-- ==================================================================
-- Test 7: order_count = count(distinct sales_order_id) per hour
-- ==================================================================
-- Hour=9 now has 2 distinct sales_order_ids (tz1 + h9b).
-- Add a second line_item to the h9b order (same order, different line)
-- to verify it does NOT increment order_count.
insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_h9b), 1, 'test-190-h9b-l1', 'Hour9b-extra', 1, 25000
);

select is(
  (select order_count from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  2::int,
  'hourly: order_count = count(distinct sales_order_id) = 2 (not 3)'
);

-- ==================================================================
-- Test 8: business_date filter excludes purchases outside range
-- ==================================================================
-- Add a sale on (current_date - 10) at 09:00 Vietnam — should be
-- EXCLUDED by the [current_date - 2, current_date] filter.
create temp table _t_ord_old (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-old',
    ((current_date - 10)::timestamp + time '02:00') at time zone 'UTC',
    current_date - 10,
    999999, 999999
  )
  returning id
)
insert into _t_ord_old select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_old), 0, 'test-190-old-l0', 'Excluded', 1, 999999
);

-- Hour=9 within [current_date - 2, current_date] should still be 175000
-- (NOT 175000 + 999999), proving the business_date filter excluded the
-- old sale.
select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  175000::numeric,
  'hourly: business_date filter excludes sales outside range'
);

-- ==================================================================
-- Test 9: sort is ASC by sale_hour (first row sale_hour = 0)
-- ==================================================================
select is(
  (select sale_hour from public.sales_hourly_summary(
     current_date - 2, current_date) limit 1),
  0::int,
  'hourly: sort ASC by sale_hour (first row = 0)'
);

-- ==================================================================
-- Test 10: coalesce — hour with no sales returns total_revenue=0 (NOT NULL)
-- ==================================================================
-- Hour=11 has no sales in the dataset → must return 0 (numeric), not NULL.
select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 11),
  0::numeric,
  'hourly: coalesce — empty hour returns total_revenue=0 (not NULL)'
);

select * from finish();
rollback;
```

Notes for the engineer:
- All 10 `select is(...)` calls are top-level SELECTs (no DO blocks — Phase 4.A learning).
- Count via `grep -c "^select is(" database/tests/190_sales_hourly_reports.sql` before commit — must be exactly 10.
- Test 3 and Test 4 are the **critical timezone-boundary verifications** — they will catch any regression if a future engineer accidentally drops the `AT TIME ZONE 'Asia/Ho_Chi_Minh'` clause.
- The `((current_date - 1)::timestamp + time '02:00') at time zone 'UTC'` construction produces an unambiguous timestamptz at 02:00 UTC. Cast `::timestamp` first to force the "without time zone" interpretation, then `at time zone 'UTC'` to attach the explicit UTC zone — Postgres parses this as "this naive timestamp IS in UTC", giving the right wall-clock anchor.
- Test 9 verifies sort via `limit 1` (relies on documented `language sql` inlining of top-level ORDER BY — same pattern as 5.A/B/C).
- All test data uses ASCII strings (`'Hour9b'`, `'TZ Test 1'`) to avoid encoding edge cases — the timezone behavior is what's being tested, not Vietnamese text.

### - [ ] Step 5: Run the full pgTAP suite

```powershell
npm run pgtap
```
Expected: **121 + 10 = 131 assertions passing**. No failures.

For faster iteration on this one file:
```powershell
$sql = Get-Content "database/tests/190_sales_hourly_reports.sql" -Raw
$sql | docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres
```

### - [ ] Step 6: Run Vitest (must still be 75)

```powershell
npm test -- --run
```

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5d): T1 — sales_hourly_summary RPC + pgTAP 190 (+10 assertions)

Append 1 STABLE RPC to 002_functions.sql:

- sales_hourly_summary(p_from, p_to)
  Aggregates sales_orders + sales_order_items bucketed by
  extract(hour from purchase_at AT TIME ZONE 'Asia/Ho_Chi_Minh').
  Returns deterministic 24 rows via generate_series(0,23) LEFT
  JOIN — zero hours surface as zero bars for shop-context.
  business_date filter for date boundary; purchase_at + tz cast
  for hour bucket. coalesce zeros (not NULLs). count(*)::int
  defense vs supabase-js bigint→string. Sort: sale_hour ASC
  (chronological, NOT by revenue).

STABLE for PostgREST caching, no SECURITY DEFINER — existing
RLS on sales_orders + sales_order_items allows authenticated
read.

New pgTAP file 190_sales_hourly_reports.sql with 10 assertions:
- 1: always 24 rows
- 2: empty range = all zeros
- 3+4: TZ boundary tests (02:00 UTC = hour=9 VN; 17:00 UTC =
      hour=0 next-day VN) — defends against losing AT TIME ZONE
- 5+6: sum(line_total) + sum(quantity) across hour
- 7: order_count distinct (multiple line_items in same order)
- 8: business_date filter excludes out-of-range sales
- 9: sort ASC by sale_hour
- 10: coalesce empty hour to 0 (not NULL)

verify:phase: 75 Vitest + 131 pgTAP = 206 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add database/002_functions.sql database/tests/190_sales_hourly_reports.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 2: Data layer + query hook + key

**Files:**
- Modify: `src/lib/data/reports.ts` — append 1 wrapper + 1 row type (currently 221 lines)
- Modify: `src/hooks/queries/keys.ts` — append 1 key inside `queryKeys` object (currently 59 lines)
- Modify: `src/hooks/queries/index.ts` — re-export new file
- Create: `src/hooks/queries/use-hourly-reports-query.ts`

### - [ ] Step 1: Append data layer wrapper + type

Open `src/lib/data/reports.ts`. The file currently ends at line 221 (after the 5.C `PayrollEmployeeRow` and `loadPayrollSummaryByEmployee` exports). Append at EOF:

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

Notes:
- `SupabaseClient` already imported at the top.
- `toAppError` already imported from `./_common`.
- `HourlyRow` interface exported because the query hook + components import it.
- All numeric fields typed `number` — matches the `::int` / `::numeric` casts in T1's RPC.

### - [ ] Step 2: Append the query key

Open `src/hooks/queries/keys.ts`. The factory currently ends at line 59 with `payrollSummaryByEmployee` (line 57–58) then `};` (line 59). Insert 1 new entry between `payrollSummaryByEmployee` and the closing `};`:

```ts
  payrollSummaryByEmployee: (range: { from: string; to: string }) =>
    ["expense-payroll-reports", "payroll_employee", range] as const,

  // Phase 5.D — Hourly trends (under existing "sales-reports" namespace)
  salesHourlySummary: (range: { from: string; to: string }) =>
    ["sales-reports", "hourly", range] as const,
};
```

(Add 1 new entry; the closing `};` stays.)

Note: hourly IS a sales view, so it reuses the existing `"sales-reports"` root from 5.B. Sub-key `"hourly"` distinguishes from `"product"` and `"category"`. No new namespace.

### - [ ] Step 3: Create the query hook file

Create `src/hooks/queries/use-hourly-reports-query.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSalesHourlySummary, type HourlyRow } from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.D — Hourly trends query hook.
 *
 *   - staleTime 60s (user-driven date-range pull)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hook
 *   - single hook (no second query like 5.B/C) because KPI row + chart
 *     consume the same data array
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

### - [ ] Step 4: Add to queries barrel

Open `src/hooks/queries/index.ts`. The file currently ends with:

```ts
export * from "./use-inventory-queries";
export * from "./use-stock-movements-query";
export * from "./use-inventory-reports-query";
export * from "./use-sales-reports-query";
export * from "./use-expense-payroll-reports-query";
```

Add one line at the bottom:

```ts
export * from "./use-inventory-queries";
export * from "./use-stock-movements-query";
export * from "./use-inventory-reports-query";
export * from "./use-sales-reports-query";
export * from "./use-expense-payroll-reports-query";
export * from "./use-hourly-reports-query";
```

### - [ ] Step 5: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 6: Run verify:phase (no test changes — should still be 75 / 131)

```powershell
npm run verify:phase
```
Expected: 75 Vitest + 131 pgTAP = 206 green.

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5d): T2 — data layer + query hook + key

src/lib/data/reports.ts (append):
- HourlyRow interface (4 fields: sale_hour, total_quantity,
  total_revenue, order_count — all `number`)
- loadSalesHourlySummary(supabase, from, to)
  Calls T1 RPC, throws toAppError on failure with Vietnamese
  fallback "Không tải được báo cáo theo giờ."

src/hooks/queries/keys.ts (append):
- salesHourlySummary({ from, to }) factory rooted at existing
  "sales-reports" namespace (hourly IS a sales view; sub-key
  "hourly" distinguishes from 5.B's "product"/"category").

src/hooks/queries/use-hourly-reports-query.ts (new):
- useSalesHourlySummaryQuery(supabase, from, to, enabled?)
- staleTime 60s; supabase null-guard via enabled.
- Single hook (no 2nd query like 5.B/C) — KPI row + chart
  consume the same data array.

src/hooks/queries/index.ts: export new file.

TS strict + verify:phase: 75 + 131 = 206 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/lib/data/reports.ts src/hooks/queries/keys.ts src/hooks/queries/use-hourly-reports-query.ts src/hooks/queries/index.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 3: `HourlyKpiRow`

**Files:**
- Create: `src/features/reports/hourly-kpi-row.tsx`

### - [ ] Step 1: Create the component

Create `src/features/reports/hourly-kpi-row.tsx`:

```tsx
"use client";

import { Card, CardBody } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import type { HourlyRow } from "@/lib/data";

/**
 * Phase 5.D — 3-tile KPI strip above the hourly chart.
 *
 * Consumes the same 24-row data array as HourlyBarChart, with an
 * `is_peak: boolean` enrichment derived in the parent tab (argmax
 * over total_revenue, client-side).
 *
 *   Giờ cao điểm  — first row where is_peak === true (formatHourRange)
 *   Tổng doanh thu — sum of total_revenue across all 24 rows (formatVND)
 *   Tổng đơn       — sum of order_count across all 24 rows (vi-VN locale)
 */

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
 *   formatHourRange(23) → "23:00 – 00:00"  (wraparound via (hour+1) % 24)
 */
function formatHourRange(hour: number): string {
  const start = `${String(hour).padStart(2, "0")}:00`;
  const end = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
  return `${start} – ${end}`;
}
```

Notes for the engineer:
- **`StatTile`** is a private sub-component, NOT extracted to a shared primitive yet. Phase 4.E's `InventoryKpiRow` has its own StatCard but may differ in shape (margins, icon slot). If you want to extract, do it in Phase 6 — for T3 keep it inline. Same defer-extraction reasoning as the tab-shell question.
- **Peak label** uses en-dash (`–`) not hyphen-minus, for typographic correctness.
- **Wraparound:** hour 23 → "23:00 – 00:00" via `(hour + 1) % 24`.
- **No icons** on tiles — matches the 4.E `InventoryKpiRow` minimalist pattern.
- **`grid-cols-1 sm:grid-cols-3`** — stacks on mobile, 3-up on `sm+`.

### - [ ] Step 2: TypeScript strict check
```powershell
npx tsc --noEmit
```

### - [ ] Step 3: Smoke verify
```powershell
npm run verify:phase
```
Expected: 75 + 131 = 206 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5d): T3 — HourlyKpiRow

src/features/reports/hourly-kpi-row.tsx (new):
- 3 StatTile cards in a grid (stacks on mobile, 3-up on sm+):
    Giờ cao điểm  — formatHourRange of the row where is_peak
    Tổng doanh thu — formatVND of sum(total_revenue)
    Tổng đơn       — vi-VN-locale of sum(order_count)
- Inline formatHourRange(hour): "14:00 – 15:00" with wraparound
  for hour=23 ("23:00 – 00:00") via (hour + 1) % 24
- Peak fallback "—" when no row has is_peak
- StatTile private sub-component (defer extraction; 4.E's
  InventoryKpiRow has its own — revisit on 3rd consumer)

Consumes the same data shape as HourlyBarChart (next task);
HourlyTrendsTab (T5) enriches each row with is_peak before
distributing to both children.

verify:phase: 75 + 131 = 206 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/hourly-kpi-row.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 4: `HourlyBarChart`

**Files:**
- Create: `src/features/reports/hourly-bar-chart.tsx`

### - [ ] Step 1: Create the component

Create `src/features/reports/hourly-bar-chart.tsx`:

```tsx
"use client";

import { Card, CardBody } from "@/components/ui/card";
import { BarChart } from "@/components/charts/bar-chart";
import { Badge } from "@/components/ui/badge";
import { formatVND } from "@/lib/format";
import type { HourlyRow } from "@/lib/data";

/**
 * Phase 5.D — 24-bar Recharts chart of revenue per hour, with the
 * peak hour highlighted.
 *
 * Wraps the EXISTING <BarChart> primitive at
 * src/components/charts/bar-chart.tsx (Recharts wrapper that
 * already supports highlightKey + formatY). Phase 5.D is the
 * first production consumer of this primitive — playground was
 * the only prior user.
 *
 * The is_peak boolean is computed in the parent tab (T5) and
 * passed through; the BarChart's highlightKey="is_peak" reads it
 * to fill the peak bar with var(--color-ink) (others get
 * var(--color-border)).
 *
 * X-axis labels use "HH:00" short form (24 labels fit horizontally).
 * Tooltip uses formatVND for revenue display on hover.
 */

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

Notes for the engineer:
- **`<BarChart>` is reused as-is** — do NOT modify `src/components/charts/bar-chart.tsx`. It already accepts the generic `T extends Record<string, unknown>` and the 4 keyed props (xKey, yKey, highlightKey, formatY).
- **`hour_label`** is the short form `"14:00"` (not the bracket form). Bracket form lives in `HourlyKpiRow` only.
- **`is_peak` boolean** comes from the parent tab (T5 enriches the raw `HourlyRow[]`).
- **Height 280** — slightly taller than `<BarChart>`'s 240 default to give 24 bars more vertical breathing room.
- **No legend, no axis title** — heading + badge + tooltip cover labeling.

### - [ ] Step 2: TypeScript strict check
```powershell
npx tsc --noEmit
```

### - [ ] Step 3: Smoke verify
```powershell
npm run verify:phase
```
Expected: 75 + 131 = 206 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5d): T4 — HourlyBarChart

src/features/reports/hourly-bar-chart.tsx (new):
- Card-wrapped wrapper around the EXISTING <BarChart> primitive
  at src/components/charts/bar-chart.tsx (Recharts wrapper).
- Maps HourlyRow[] → ChartRow[] with hour_label "HH:00" short
  form for X-axis (24 labels fit horizontally).
- highlightKey="is_peak" tells <BarChart> to fill the peak bar
  with var(--color-ink); others get var(--color-border).
- formatY={formatVND} for VND tooltip on hover.
- Height 280 (taller than 240 default — 24-bar density).
- Heading "Doanh thu theo giờ", badge "24 giờ".

Phase 5.D is the FIRST production consumer of <BarChart>
(playground was the sole prior user).

verify:phase: 75 + 131 = 206 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/hourly-bar-chart.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 5: `HourlyTrendsTab` + ReportsView swap + tag `v4-phase-5d` + umbrella tag `v4-phase-5`

**Files:**
- Create: `src/features/reports/hourly-trends-tab.tsx`
- Modify: `src/features/reports/reports-view.tsx` — swap `hourly` placeholder + add import

This is the heaviest task in 5.D because it carries:
- Creates the tab itself (owns query, derives `is_peak`, branches render)
- Wires into ReportsView
- Manual smoke test for the full ReportsView (4 prior roles × 5 tabs)
- **TWO tags at the end: `v4-phase-5d` (sub-phase) AND `v4-phase-5` (umbrella closing Phase 5)**

### - [ ] Step 1: Create `HourlyTrendsTab`

Create `src/features/reports/hourly-trends-tab.tsx`:

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
 * Differs from 5.A/B/C tabs: this tab OWNS the query (not a pure
 * composition). Branches loading/error/empty at the tab level
 * (not per-child) because both children share the same data array.
 *
 * Empty detection uses `every(d => total_revenue === 0)` because
 * the RPC always returns 24 rows (generate_series) — `data.length
 * === 0` would never trigger.
 *
 * `is_peak` is derived client-side via argmax over total_revenue.
 * The guard `maxRevenue > 0` prevents highlighting hour=0 in an
 * empty range (defensive — the EmptyState branch would have
 * rendered first anyway).
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

  const hasRevenue = enrichedData.some((d) => d.total_revenue > 0);

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

      {!query.isLoading && !query.isError && !hasRevenue && (
        <EmptyState
          dashedBorder
          icon="barChart3"
          title="Chưa có doanh số trong khoảng này"
          subtitle="Đổi khoảng thời gian hoặc đợi sync POS mới."
        />
      )}

      {!query.isLoading && !query.isError && hasRevenue && (
        <>
          <HourlyKpiRow data={enrichedData} />
          <HourlyBarChart data={enrichedData} />
        </>
      )}
    </div>
  );
}
```

Notes for the engineer:
- **Tab owns the query** — unlike 5.A `InventoryAnalyticsTab` (which lets each child fetch its own), this tab fetches once and feeds both children. Reason: both children need the SAME 24-row array, and `is_peak` derivation is a shared client-side step.
- **`Math.max(0, ...data.map(...))`** — the `0` seed ensures `maxRevenue >= 0` even when `data` is empty (in which case `Math.max(0)` = 0). Without the seed, `Math.max(...[])` would be `-Infinity`.
- **`hasRevenue`** is the discriminator for showing chart/KPI vs EmptyState. The variable is named for readability (vs inlining the `some(...)` call into 2 conditionals).
- **`<>...</>` fragment** wraps the KPI row + chart so the outer flex container spaces them via `space-y-6`.

### - [ ] Step 2: TypeScript strict check
```powershell
npx tsc --noEmit
```

### - [ ] Step 3: Add import to `reports-view.tsx`

Open `src/features/reports/reports-view.tsx`. The 5.C T6 swap added (immediately after the `SalesByProductTab` import):
```tsx
import { ExpensePayrollTab } from "./expense-payroll-tab";
```

Add immediately after the `ExpensePayrollTab` import:
```tsx
import { HourlyTrendsTab } from "./hourly-trends-tab";
```

### - [ ] Step 4: Swap the placeholder

Find this exact block (added in 5.A T7, untouched by 5.B + 5.C):

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

Replace it with:

```tsx
      <TabsContent value="hourly">
        <HourlyTrendsTab />
      </TabsContent>
```

All other 4 tabs (`cash_close`, `inventory`, `sales_product`, `expense_payroll`) stay untouched.

### - [ ] Step 5: Production build sanity check
```powershell
npm run build
```
Expected: build succeeds with no errors.

### - [ ] Step 6: Run the full verify suite
```powershell
npm run verify:phase
```
Expected: **75 Vitest + 131 pgTAP = 206 green**.

### - [ ] Step 7: Manual smoke test

Start dev server in another terminal (`npm run dev`) and verify in browser. If you can't run the dev server, skip and note it in your report — the mechanical TS + build + verify:phase checks are mandatory; smoke is recommended.

1. Owner login → Báo cáo → "Chốt két" tab is default; Cash Close UI unchanged
2. Click "Tồn kho" tab → 5.A consumption + variance reports unchanged
3. Click "Doanh số" tab → 5.B product + category tables unchanged
4. Click "Chi phí + lương" tab → 5.C expense + payroll tables unchanged
5. **Click "Theo giờ" tab → DateRangePicker + 3-tile KPI strip + 24-bar chart render**
6. Hover a bar → Recharts tooltip shows VND-formatted value
7. Peak hour bar visually distinct (`var(--color-ink)`) vs others (`var(--color-border)`)
8. KPI "Giờ cao điểm" value matches the highlighted bar's hour (e.g. "14:00 – 15:00")
9. Click "Hôm nay" / "Tuần này" / "Tháng này" → all 3 sections refetch
10. Custom range with from/to → chart filters correctly
11. Empty range (e.g. far-past dates) → EmptyState renders; NO KPI row, NO chart
12. Visit `/expenses` + `/shifts` + `/pivot` → all unchanged
13. Log in as manager → same 5 ReportsView tabs visible
14. Log in as staff_operator → same 5 tabs visible
15. Log in as employee_viewer → Báo cáo NOT in sidebar (NAV_ITEMS blocks)

If any smoke check fails, fix and re-verify before committing.

### - [ ] Step 8: Commit the tab + wire

```powershell
@'
feat(phase-5d): T5 — HourlyTrendsTab + wire + tag v4-phase-5d + v4-phase-5

src/features/reports/hourly-trends-tab.tsx (new):
- Owns the useSalesHourlySummaryQuery (not a pure composition
  like 5.A/B/C — both children consume same data array)
- useState<DateRange> lazy-initialised with defaultDateRange()
- useMemo enriches each HourlyRow with is_peak: boolean via
  client-side argmax over total_revenue (guarded by
  maxRevenue > 0 so empty ranges don't highlight hour=0)
- 4 branches: isLoading / isError / all-zero-empty / has-data
- Empty detection: every(d => total_revenue === 0) since RPC
  always returns 24 rows
- has-data branch renders <HourlyKpiRow> + <HourlyBarChart>
  with enrichedData

src/features/reports/reports-view.tsx:
- Add import: HourlyTrendsTab from "./hourly-trends-tab"
- Replace `hourly` placeholder EmptyState with <HourlyTrendsTab />.

All other 4 tabs (cash_close, inventory, sales_product,
expense_payroll) unchanged. Existing PivotView at /pivot,
ExpensesView at /expenses, ShiftsView at /shifts all unchanged
— Phase 5.D is additive.

Role gating unchanged: NAV_ITEMS restricts Báo cáo to
owner + manager + staff_operator. employee_viewer blocked.

Tab shape DIVERGES from 5.A/B/C's 2-stacked-tables pattern.
Permanently retires the tab-shell extraction question: 3
identical tabs is the new ceiling, not 4. The MEMORY.md
formatOccurred extraction trigger remains the only live rule.

verify:phase: 75 Vitest + 131 pgTAP = 206 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/hourly-trends-tab.tsx src/features/reports/reports-view.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

### - [ ] Step 9: Final verify before tagging
```powershell
npm run verify:phase
npx tsc --noEmit
npm run build
```
Expected: all three clean.

### - [ ] Step 10: Tag `v4-phase-5d` (sub-phase tag)

```powershell
git tag -a v4-phase-5d -m "Phase 5.D — Hourly Trends"
git log --oneline -3
git tag -l "v4-phase-5*"
```
Expected:
- `git log` shows the T5 commit at HEAD
- `git tag -l` shows `v4-phase-5a`, `v4-phase-5b`, `v4-phase-5c`, `v4-phase-5d`

### - [ ] Step 11: Final status check before umbrella tag

```powershell
git status
git diff main..HEAD --stat
```
Expected:
- `git status`: clean working tree
- `git diff main..HEAD --stat`: shows ~12 files changed (spec + plan + T1 + T2's 4 + T3 + T4 + T5's 2)

If extra files appear, investigate before tagging.

### - [ ] Step 12: Hand off to `superpowers:finishing-a-development-branch`

After T5 commits + `v4-phase-5d` tag are in place, the controller invokes:
- `superpowers:finishing-a-development-branch` to present merge / PR / keep / discard options
- Typical choice: **Option 1 — Merge back to main locally** (matches every prior 5.x sub-phase finish)

### - [ ] Step 13: Place umbrella `v4-phase-5` tag on the MERGE commit

**This step happens AFTER the merge to main, not before.** Once `superpowers:finishing-a-development-branch` has merged the branch and produced the merge commit on `main`:

```powershell
# Confirm HEAD is on main and at the merge commit
git checkout main
git log --oneline -1
# Should show the merge commit with subject "merge: Phase 5.D — Hourly Trends ..."

# Place the umbrella tag on the merge commit itself (NOT on the T5 commit)
git tag -a v4-phase-5 -m "Phase 5 — Analytics & Reports (closes Phase 5: 5.A Inventory + 5.B Sales + 5.C Expense+Payroll + 5.D Hourly)"

# Verify both tags exist
git tag -l "v4-phase-5*"
# Expected output:
# v4-phase-5
# v4-phase-5a
# v4-phase-5b
# v4-phase-5c
# v4-phase-5d

# Confirm v4-phase-5 points at the merge commit
git rev-parse v4-phase-5
git log --oneline -1
# Both should resolve to the same commit hash (or the tag object hash if annotated;
# the tag object should dereference to the merge commit via `git log -1 v4-phase-5`)
```

This is the FINAL step of Phase 5. After this tag is placed, Phase 5 is closed entirely.

---

## Verification matrix

After T5 merges to `main` and both tags are placed:

| Check | Command | Expected |
|-------|---------|----------|
| Vitest | `npm test -- --run` | 75 pass (unchanged) |
| pgTAP | `npm run pgtap` | 131 pass (121 prior + 10 new in 190) |
| TS strict | `npx tsc --noEmit` | 0 errors |
| Build | `npm run build` | success |
| Branch | `git log --oneline main..phase-5d-hourly-trends` | 5 task commits + spec + plan commits |
| Sub-phase tag | `git tag -l v4-phase-5d` | exists on T5 commit |
| Umbrella tag | `git tag -l v4-phase-5` | exists on the merge commit |

Manual UI smoke (from T5 Step 7) — owner login is sufficient; other 3 roles verified in T5 Step 7 list.

---

## Self-review

### Spec coverage
| Spec section | Requirement | Plan task |
|---|---|---|
| §3 (scope decisions) | Use existing `<BarChart>`, chart+KPI shape, 3 KPI tiles, revenue default Y-axis, peak via client argmax, all-24-rows server-side, "HH:00" + "HH:00 – HH+1:00" formats, "Tuần này" default, multi-day = sum, AT TIME ZONE before extract, "sales-reports" namespace, single query, retire tab-shell question | T1 + T3 + T4 + T5 |
| §4.1 (ReportsView placeholder swap) | Replace `hourly` placeholder with `<HourlyTrendsTab />` | T5 |
| §4.2 (HourlyTrendsTab composition) | Single useState + single query + 4-branch render | T5 |
| §4.3 (role gating) | Inherits NAV_ITEMS gate | T5 smoke step |
| §4.4 (data flow) | Single query staleTime 60s, supabase null-guard | T2 |
| §5.1 (`sales_hourly_summary` RPC) | STABLE, no SECURITY DEFINER, generate_series + LEFT JOIN, AT TIME ZONE, coalesce zeros, sort ASC | T1 |
| §5.2 (10 pgTAP assertions including 2 TZ-boundary) | 24 rows / empty / TZ-09 / TZ-00 / sum line_total / sum quantity / order_count distinct / date filter / sort ASC / coalesce | T1 |
| §6.1 (5 new files) | All 5 referenced in T1–T5 | ✓ |
| §6.2 (5 modified files) | All 5 touched by T1, T2, T5 | ✓ |
| §7.1 (HourlyTrendsTab) | useMemo argmax, 4 branches, fragment wrap for has-data | T5 |
| §7.2 (HourlyKpiRow) | 3 StatTiles, formatHourRange en-dash + wraparound, peak fallback "—" | T3 |
| §7.3 (HourlyBarChart) | Wraps existing `<BarChart>`, hour_label "HH:00", height 280 | T4 |
| §7.4 (ReportsView swap mechanics) | Import + replace TabsContent body | T5 |
| §8.1 (data layer wrapper) | HourlyRow + loadSalesHourlySummary with Vietnamese error | T2 |
| §8.2 (query key under existing namespace) | salesHourlySummary under "sales-reports"/"hourly" | T2 |
| §8.3 (query hook file) | Single hook, staleTime 60s | T2 |
| §8.4 (barrel export) | Add line to index.ts | T2 |
| §9 (Vietnamese strings) | All ~12 strings appear across T1 (RPC names not VN), T3, T4, T5 | ✓ |
| §10 (error handling) | AlertBanner.danger at tab level, EmptyState for no-revenue range, `find` returns first on tie | T5 + T3 |
| §11 (risks) | Recharts SSR, label overflow, multi-day, ties, BarChart first prod use, TZ math, perf, key namespace, umbrella tag placement | Documented in respective tasks |
| §13 (success criteria, 17 items) | All 17 | Covered by T5 final verify + smoke + umbrella tag step |

### Placeholder scan
- No "TBD" / "implement later" / "TODO" / "handle edge cases" / "Similar to Task N" in any task.
- T1 Step 4 includes deliberate notes about the timezone test construction (`((current_date - X)::timestamp + time '...') at time zone 'UTC'`) — these are clarifying explanations, not placeholders.

### Type consistency
- `HourlyRow` defined in T2 with 4 fields (`sale_hour: number`, `total_quantity: number`, `total_revenue: number`, `order_count: number`) → imported in T3, T4, T5.
- `(HourlyRow & { is_peak: boolean })[]` shape: T5 enriches the raw data and passes the SAME enriched shape to BOTH T3 (`HourlyKpiRow`) and T4 (`HourlyBarChart`). The prop types in T3 + T4 BOTH say `data: (HourlyRow & { is_peak: boolean })[]` — verified.
- `useSalesHourlySummaryQuery(supabase, from, to, enabled?)` signature consistent between T2 (declaration) and T5 (call site).
- `formatVND` from `@/lib/format` — same import in T3 + T4.
- `BarChart` import path `@/components/charts/bar-chart` — only in T4.
- `DateRange` + `defaultDateRange` from `./date-range-picker` — only in T5.
- Query key `salesHourlySummary({ from, to })` shape matches between keys.ts (T2 step 2) and the hook usage (T2 step 3).
- `HourlyTrendsTab` named export in T5 → imported in T5 step 3 (ReportsView).

### Scope check
5 tasks × 7–13 steps each = ~45 total steps. One fewer task than 5.B/C because there's only 1 RPC + 1 query hook + 1 fewer UI component. T5 carries extra weight (umbrella tag placement) but the per-step granularity stays bite-sized. All steps fit the 2–5 minute target. No spec requirement uncovered.

No issues found.

---

## After this plan

Once T5 merges and BOTH `v4-phase-5d` AND `v4-phase-5` tags land:

- **Phase 5 is complete.** All 4 sub-phases (5.A Inventory + 5.B Sales + 5.C Expense+Payroll + 5.D Hourly) merged.
- Final tag tree:
  ```
  v4-phase-4 → v4-phase-4a/b/c/d/e (Phase 4)
  v4-phase-5 (umbrella — closes Phase 5)
  v4-phase-5a/b/c/d (Phase 5 sub-phases)
  ```
- The MEMORY.md `formatOccurred` extraction trigger remains the only live extraction rule.
- The tab-shell extraction question is permanently retired (5.D shape diverges from 5.A/B/C).
- Next phase TBD by user — likely Phase 6 (hardening: more Vitest coverage, performance, polish) or Phase 7 (new features).
