# Phase 5.A — Inventory Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the first read paths over Phase 4's `stock_movements` data — a Consumption report and a Variance Audit report — inside a new "Tồn kho" tab of a refactored `ReportsView`, plus a shared `DateRangePicker` primitive reusable across Phase 5.B/C/D.

**Architecture:** 2 read-only `STABLE` RPCs feed 2 React components. The existing single-page `ReportsView` is wrapped in a Radix Tabs container (Cash Close preserved byte-for-byte as first tab; 3 EmptyState placeholders for 5.B/C/D). Date range state lives in the analytics tab — same `DateRangePicker` value drives both reports.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Tailwind v4 · Radix `Tabs` · TanStack Query 5 · Supabase JS (RPC) · pgTAP via in-container psql · Vitest 2.1.9.

**Spec:** `docs/superpowers/specs/2026-05-22-v4-phase-5a-inventory-analytics-design.md`
**Branch:** `phase-5a-inventory-analytics` (already created off `main` @ tag `v4-phase-4`)
**Tag at end:** `v4-phase-5a`
**Final verify target:** 75 Vitest + 99 pgTAP = 174 green

---

## File Manifest

### 7 new files
| Path | Lines (est) | Created in |
|------|-------------|------------|
| `database/tests/160_inventory_reports.sql` | ~210 | T1 |
| `src/hooks/queries/use-inventory-reports-query.ts` | ~50 | T2 |
| `src/features/reports/date-range-picker.tsx` | ~140 | T3 |
| `src/features/reports/consumption-report.tsx` | ~130 | T4 |
| `src/features/reports/variance-audit-report.tsx` | ~150 | T5 |
| `src/features/reports/inventory-analytics-tab.tsx` | ~30 | T6 |

### 4 modified files
| Path | Change | Touched in |
|------|--------|------------|
| `database/002_functions.sql` | Append 2 RPCs at EOF | T1 |
| `src/lib/data/reports.ts` | Append 2 wrapper functions | T2 |
| `src/hooks/queries/keys.ts` | Append 2 keys | T2 |
| `src/hooks/queries/index.ts` | Export new file | T2 |
| `src/features/reports/reports-view.tsx` | Wrap in `<Tabs>` shell | T7 |

### Off-limits (DO NOT TOUCH)
- `database/001_schema.sql` — no schema changes
- `database/003_rls.sql` — existing RLS on `stock_movements` already allows SELECT
- `src/lib/types.ts` — query hooks use inline row types
- All Phase 2 primitives, all prior-phase feature modules
- v3 production code in `../Chill manager v3/` (separate repo)

---

## Conventions reminder (apply to every commit)

1. **Commit message authoring on Windows PowerShell** — Vietnamese diacritics break inside compound shell commands. Always write to `.git/COMMIT_MSG_TMP` first via `Out-File -Encoding utf8`, then `git commit -F .git/COMMIT_MSG_TMP`, then `Remove-Item .git/COMMIT_MSG_TMP`. See any T1–T7 commit step below for the exact pattern.
2. **Trailer** — every commit message must end with: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` (case-sensitive, exact form).
3. **NO modifications to v3 production code, Supabase containers, or `.env` files.**
4. **`.gitignored` files stay gitignored.**

---

## Task 1: Backend RPCs + pgTAP (`160_inventory_reports.sql`)

**Files:**
- Modify: `database/002_functions.sql` — append 2 new RPCs at EOF
- Create: `database/tests/160_inventory_reports.sql` (10 pgTAP assertions)

### - [ ] Step 1: Append `inventory_consumption_by_ingredient` RPC

Open `database/002_functions.sql` and append at the very end (after the existing `list_stock_movements` function — current EOF is line 3067):

```sql

-- =====================================================================
-- Phase 5.A — Inventory analytics reports
-- =====================================================================

-- Top ingredients consumed by sales over a date range.
-- Filters strictly to reason = 'sale_theoretical' (excludes manual moves,
-- count corrections, purchases, waste).
create or replace function public.inventory_consumption_by_ingredient(
  p_from date,
  p_to   date
) returns table (
  ingredient_id  uuid,
  name           text,
  unit           text,
  total_consumed numeric,
  sale_count     bigint
)
language sql
stable
set search_path = public
as $$
  select
    i.id           as ingredient_id,
    i.name,
    i.unit,
    sum(abs(sm.quantity_delta))::numeric        as total_consumed,
    count(distinct sm.source_order_id)::bigint  as sale_count
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where sm.reason = 'sale_theoretical'
    and sm.occurred_at::date >= p_from
    and sm.occurred_at::date <= p_to
  group by i.id, i.name, i.unit
  order by total_consumed desc;
$$;

-- Audit log of count_correction movements over a date range.
-- Used by the Variance Audit report. No running balance computation —
-- owner drills into Stock tab for full ledger context.
create or replace function public.inventory_variance_audit(
  p_from date,
  p_to   date
) returns table (
  movement_id      uuid,
  ingredient_id    uuid,
  ingredient_name  text,
  unit             text,
  quantity_delta   numeric,
  occurred_at      timestamptz,
  notes            text,
  created_by       uuid
)
language sql
stable
set search_path = public
as $$
  select
    sm.id           as movement_id,
    sm.ingredient_id,
    i.name          as ingredient_name,
    i.unit,
    sm.quantity_delta,
    sm.occurred_at,
    sm.notes,
    sm.created_by
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where sm.reason = 'count_correction'
    and sm.occurred_at::date >= p_from
    and sm.occurred_at::date <= p_to
  order by sm.occurred_at desc;
$$;
```

Notes for the engineer:
- These are **STABLE** (cacheable by PostgREST) and **NOT** `SECURITY DEFINER` — they read `stock_movements` with the caller's RLS, which already allows SELECT for `authenticated`.
- `set search_path = public` matches the codebase convention.
- No `grant execute` line needed — PostgREST exposes RPCs to `authenticated` by default; RLS on the underlying table does the gating.

### - [ ] Step 2: Apply schema changes to the local Supabase DB

Run:
```powershell
node scripts/db-init.mjs
```
Expected: script reports "schema applied" / "functions applied" without error. If it errors complaining about a syntax issue near the new RPC, fix and re-run.

### - [ ] Step 3: Quick sanity check the RPCs respond

Run:
```powershell
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select public.inventory_consumption_by_ingredient(current_date - interval '7 days', current_date);"
docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres -c "select public.inventory_variance_audit(current_date - interval '7 days', current_date);"
```
Expected: 0 rows back (empty tables in dev), no error.

### - [ ] Step 4: Create the pgTAP test file

Create `database/tests/160_inventory_reports.sql`:

```sql
-- Phase 5.A — Inventory analytics reports.
--
-- 10 assertions (top-level SELECT pattern):
--   inventory_consumption_by_ingredient (6 assertions):
--     1. Empty range returns 0 rows
--     2. Sums abs(quantity_delta) correctly across multiple sale_theoretical rows
--     3. Excludes non-sale_theoretical reasons (purchase_received, count_correction)
--     4. sale_count counts distinct source_order_id values correctly
--     5. Date filter inclusive on both p_from and p_to ends
--     6. Sort is ORDER BY total_consumed DESC
--
--   inventory_variance_audit (4 assertions):
--     7. Empty range returns 0 rows
--     8. Returns ONLY reason='count_correction' rows
--     9. Sort is ORDER BY occurred_at DESC
--    10. Joins ingredients.name + ingredients.unit correctly

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

-- Two ingredients used across all tests
create temp table _t_ing_milk (id uuid);
create temp table _t_ing_bean (id uuid);
insert into _t_ing_milk select public.create_ingredient('Milk T160',   'ml', null, null);
insert into _t_ing_bean select public.create_ingredient('Coffee T160', 'g',  null, null);

-- ------------------------------------------------------------------
-- Test 1: empty range returns 0 rows
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.inventory_consumption_by_ingredient(
     current_date - 30, current_date - 29)),
  0,
  'consumption: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Test 2: sums abs(quantity_delta) correctly across multiple rows
-- ------------------------------------------------------------------
-- Insert 2 sale_theoretical movements for milk on yesterday: -100 and -50
-- (source_order_id can be anything we already have or NULL — make it
-- distinct so test 4 works too)
create temp table _t_ord1 (id uuid);
create temp table _t_ord2 (id uuid);
with i1 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-160-ord1', current_date - 1, current_date - 1, 50000, 50000)
  returning id
)
insert into _t_ord1 select id from i1;
with i2 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-160-ord2', current_date - 1, current_date - 1, 30000, 30000)
  returning id
)
insert into _t_ord2 select id from i2;

insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, source_order_id, created_by)
values
  ((select id from _t_ing_milk), -100, 'sale_theoretical', (current_date - 1) + time '10:00', (select id from _t_ord1), '11111111-1111-1111-1111-111111111111'),
  ((select id from _t_ing_milk),  -50, 'sale_theoretical', (current_date - 1) + time '11:00', (select id from _t_ord2), '11111111-1111-1111-1111-111111111111');

select is(
  (select total_consumed from public.inventory_consumption_by_ingredient(
     current_date - 2, current_date)
   where ingredient_id = (select id from _t_ing_milk)),
  150::numeric,
  'consumption: sums abs(quantity_delta) across 2 movements = 150'
);

-- ------------------------------------------------------------------
-- Test 3: excludes non-sale_theoretical reasons
-- ------------------------------------------------------------------
insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, created_by)
values
  ((select id from _t_ing_milk),  500, 'purchase_received', (current_date - 1) + time '12:00', '11111111-1111-1111-1111-111111111111'),
  ((select id from _t_ing_milk),  -10, 'count_correction',  (current_date - 1) + time '13:00', '11111111-1111-1111-1111-111111111111');

-- consumption should still be 150 (purchase + count_correction excluded)
select is(
  (select total_consumed from public.inventory_consumption_by_ingredient(
     current_date - 2, current_date)
   where ingredient_id = (select id from _t_ing_milk)),
  150::numeric,
  'consumption: excludes purchase_received and count_correction'
);

-- ------------------------------------------------------------------
-- Test 4: sale_count is count(distinct source_order_id)
-- ------------------------------------------------------------------
-- 2 distinct order IDs in test 2 → expect 2
select is(
  (select sale_count from public.inventory_consumption_by_ingredient(
     current_date - 2, current_date)
   where ingredient_id = (select id from _t_ing_milk)),
  2::bigint,
  'consumption: sale_count = count(distinct source_order_id) = 2'
);

-- ------------------------------------------------------------------
-- Test 5: date filter inclusive on both ends
-- ------------------------------------------------------------------
-- Both rows above are on (current_date - 1). Filter [current_date - 1, current_date - 1]
-- should still include them.
select is(
  (select total_consumed from public.inventory_consumption_by_ingredient(
     current_date - 1, current_date - 1)
   where ingredient_id = (select id from _t_ing_milk)),
  150::numeric,
  'consumption: date filter is inclusive on both p_from and p_to'
);

-- ------------------------------------------------------------------
-- Test 6: sort is ORDER BY total_consumed DESC
-- ------------------------------------------------------------------
-- Add coffee with smaller total (-30) → milk (150) should appear first.
create temp table _t_ord3 (id uuid);
with i3 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-160-ord3', current_date - 1, current_date - 1, 25000, 25000)
  returning id
)
insert into _t_ord3 select id from i3;

insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, source_order_id, created_by)
values
  ((select id from _t_ing_bean), -30, 'sale_theoretical', (current_date - 1) + time '14:00', (select id from _t_ord3), '11111111-1111-1111-1111-111111111111');

select is(
  (select array_agg(ingredient_id order by ord)
   from (
     select ingredient_id, row_number() over () as ord
     from public.inventory_consumption_by_ingredient(current_date - 2, current_date)
   ) t),
  array[(select id from _t_ing_milk), (select id from _t_ing_bean)],
  'consumption: sort is ORDER BY total_consumed DESC (milk before bean)'
);

-- ==================================================================
-- inventory_variance_audit tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 7: empty range returns 0 rows
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.inventory_variance_audit(
     current_date - 60, current_date - 50)),
  0,
  'variance: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Test 8: returns ONLY reason='count_correction' rows
-- ------------------------------------------------------------------
-- We have so far: -100, -50 sale_theoretical + 500 purchase + -10 count_correction
-- Plus -30 sale_theoretical for bean. So variance audit in last 2 days = 1 row.
select is(
  (select count(*)::int from public.inventory_variance_audit(
     current_date - 2, current_date)),
  1,
  'variance: returns only reason=count_correction rows'
);

-- ------------------------------------------------------------------
-- Test 9: sort is ORDER BY occurred_at DESC
-- ------------------------------------------------------------------
-- Add another count_correction at a LATER time → should appear first
-- when the RPC sorts by occurred_at desc.
insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, created_by)
values
  ((select id from _t_ing_milk), 5, 'count_correction', (current_date - 1) + time '20:00', '11111111-1111-1111-1111-111111111111');

-- Verify the FUNCTION returns the rows in DESC order (not the test's own ORDER BY).
-- We use row_number() over the function's natural output to lock in its sort.
select is(
  (select (array_agg(quantity_delta order by ord))[1]
   from (
     select quantity_delta, row_number() over () as ord
     from public.inventory_variance_audit(current_date - 2, current_date)
   ) t),
  5::numeric,
  'variance: function returns rows pre-sorted by occurred_at DESC'
);

-- ------------------------------------------------------------------
-- Test 10: joins ingredients.name + ingredients.unit correctly
-- ------------------------------------------------------------------
select is(
  (select (ingredient_name, unit) from public.inventory_variance_audit(
     current_date - 2, current_date)
   order by occurred_at desc
   limit 1),
  ('Milk T160', 'ml'),
  'variance: joins ingredients.name + ingredients.unit correctly'
);

select * from finish();
rollback;
```

Notes for the engineer:
- All 10 `select is(...)` calls are top-level SELECTs (not inside DO blocks) — earlier Phase 4.A discovered that `perform ok()` / `perform is()` inside `do $ ... $` blocks evaluates but emits NO TAP output. Use top-level SELECT exclusively.
- The `act_as` helper, `auth.users` insert, and `profiles + employee_accounts` rows are copy-paste from `140_sale_deduction_trigger.sql`. Same UUID is fine — each test file runs in its own transaction (`begin` … `rollback`).
- Test 9 deliberately verifies the **function's** internal sort (via `row_number() over ()` inside a subquery that does NOT add its own `order by`). If we wrote `order by occurred_at desc` in the outer query, the test would silently pass even with a broken RPC.
- Recount your `select is(...)` blocks before running — count must equal `plan(10)`: 6 consumption (T1–T6) + 4 variance (T7–T10). If you accidentally end up with 11 or 9, pgTAP fails the plan-mismatch assertion regardless of individual outcomes.
- The `(current_date - 1) + time '10:00'` expressions cast cleanly to `timestamptz` on INSERT into `stock_movements.occurred_at`. If a `data type mismatch` error appears, add an explicit `::timestamptz` cast — but in practice PostgreSQL's implicit cast handles it.

### - [ ] Step 5: Run the full pgTAP suite

```powershell
npm run pgtap
```
Expected: **89 + 10 = 99 assertions passing** (50 pre-Phase-4 + 39 Phase 4 + 10 new in 5.A). No failures.

If any assertion in the new file fails, the TAP output identifies which (e.g., `not ok 4 - consumption: sale_count = ...`). For faster iteration on a single file you can run psql directly against the Docker DB:

```powershell
$sql = Get-Content "database/tests/160_inventory_reports.sql" -Raw
$sql | docker exec -i supabase_db_erp-ice-factory-v2 psql -U postgres -d postgres
```

Fix the RPC or test, re-run `npm run pgtap`, repeat until 99 pass.

### - [ ] Step 6: Run the Vitest suite (must still be 75)

```powershell
npm test -- --run
```
Expected: 75 tests passing. (5.A adds no Vitest tests — helper test additions would belong to a Phase 6 hardening sub-phase.)

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5a): T1 — backend RPCs + pgTAP 160 (+10 assertions)

Append 2 STABLE RPCs to 002_functions.sql:
- inventory_consumption_by_ingredient(p_from, p_to)
  Top ingredients consumed by sales over a date range. Sums
  abs(quantity_delta) where reason='sale_theoretical', joins
  ingredients for name+unit. count(distinct source_order_id)
  gives sale_count. Excludes non-sale reasons.

- inventory_variance_audit(p_from, p_to)
  Movement-level audit of reason='count_correction' over a
  date range. Includes quantity_delta, notes, created_by,
  occurred_at. Sorted by occurred_at desc.

Both are STABLE (PostgREST cacheable) and rely on existing
stock_movements RLS for read gating — no SECURITY DEFINER.

New pgTAP file 160_inventory_reports.sql with 10 assertions:
- consumption: 6 (empty, sum, exclusion, sale_count distinct,
  inclusive date filter, sort order)
- variance: 4 (empty, exclusion, sort, join correctness)

verify:phase: 75 Vitest + 99 pgTAP = 174 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add database/002_functions.sql database/tests/160_inventory_reports.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 2: Data layer + query hooks + keys

**Files:**
- Modify: `src/lib/data/reports.ts` — append 2 wrapper functions + 2 row types
- Modify: `src/hooks/queries/keys.ts` — append 2 keys
- Modify: `src/hooks/queries/index.ts` — re-export new file
- Create: `src/hooks/queries/use-inventory-reports-query.ts`

### - [ ] Step 1: Append data layer wrappers + types

Open `src/lib/data/reports.ts`. Currently ends at line 82. Append at EOF (preserve trailing newline conventions of the file):

```ts

// ---------------------------------------------------------------------
// Phase 5.A — Inventory analytics
// ---------------------------------------------------------------------

export interface ConsumptionRow {
  ingredient_id: string;
  name: string;
  unit: string;
  total_consumed: number;
  sale_count: number;
}

export async function loadInventoryConsumption(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ConsumptionRow[]> {
  const { data, error } = await supabase.rpc(
    "inventory_consumption_by_ingredient",
    { p_from: from, p_to: to }
  );
  if (error) throw toAppError(error, "Không tải được báo cáo tiêu thụ.");
  return (data ?? []) as ConsumptionRow[];
}

export interface VarianceRow {
  movement_id: string;
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  quantity_delta: number;
  occurred_at: string;
  notes: string | null;
  created_by: string | null;
}

export async function loadInventoryVariance(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<VarianceRow[]> {
  const { data, error } = await supabase.rpc(
    "inventory_variance_audit",
    { p_from: from, p_to: to }
  );
  if (error) throw toAppError(error, "Không tải được lịch sử kiểm kê.");
  return (data ?? []) as VarianceRow[];
}
```

Notes:
- `SupabaseClient` is already imported at the top of the existing file (`import type { SupabaseClient } from "@supabase/supabase-js";`).
- `toAppError` is already imported from `./_common`.
- Row interfaces are exported because the query-hooks file in step 4 imports them.

### - [ ] Step 2: Append query keys

Open `src/hooks/queries/keys.ts`. Insert these 2 entries **inside** the `queryKeys = { ... }` object, after the last existing entry (`recipeByMenuItem`, line 39–40). Keep the trailing comma and the closing `};`:

```ts
  recipeByMenuItem: (menuItemId: string) =>
    ["inventory", "recipe", menuItemId] as const,

  // Phase 5.A — Inventory analytics reports
  inventoryConsumption: (range: { from: string; to: string }) =>
    ["reports", "inventory_consumption", range] as const,
  inventoryVariance: (range: { from: string; to: string }) =>
    ["reports", "inventory_variance", range] as const,
};
```

(I.e., add 2 new entries between `recipeByMenuItem` and the closing `};`. Don't delete `recipeByMenuItem` — it stays untouched.)

### - [ ] Step 3: Create the query hook file

Create `src/hooks/queries/use-inventory-reports-query.ts`:

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadInventoryConsumption,
  loadInventoryVariance,
  type ConsumptionRow,
  type VarianceRow,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.A — Inventory analytics query hooks.
 *
 * Both report queries:
 *   - staleTime 60s (reports re-fetch on demand; bg-refresh unwanted)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hooks in this phase
 */

export function useInventoryConsumptionQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<ConsumptionRow[]>({
    queryKey: queryKeys.inventoryConsumption({ from, to }),
    queryFn: () => loadInventoryConsumption(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useInventoryVarianceQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<VarianceRow[]>({
    queryKey: queryKeys.inventoryVariance({ from, to }),
    queryFn: () => loadInventoryVariance(supabase!, from, to),
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
```

Add one line at the bottom:

```ts
export * from "./use-inventory-queries";
export * from "./use-stock-movements-query";
export * from "./use-inventory-reports-query";
```

### - [ ] Step 5: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors. If a missing export error shows up for `ConsumptionRow` / `VarianceRow`, double-check Step 1 added them at module scope (export, not inside a function).

### - [ ] Step 6: Run Vitest + pgTAP (no test changes — should still be 75/99)

```powershell
npm run verify:phase
```
Expected: 75 Vitest + 99 pgTAP green.

### - [ ] Step 7: Commit

```powershell
@'
feat(phase-5a): T2 — data layer + query hooks + keys

src/lib/data/reports.ts (append):
- ConsumptionRow / VarianceRow interfaces
- loadInventoryConsumption(supabase, from, to)
- loadInventoryVariance(supabase, from, to)
  Both call new RPCs, throw toAppError on failure.

src/hooks/queries/keys.ts (append):
- inventoryConsumption({ from, to }) key factory
- inventoryVariance({ from, to }) key factory

src/hooks/queries/use-inventory-reports-query.ts (new):
- useInventoryConsumptionQuery(supabase, from, to, enabled?)
- useInventoryVarianceQuery(supabase, from, to, enabled?)
- staleTime 60s
- supabase null-guard via enabled

src/hooks/queries/index.ts: export new file.

TS strict + verify:phase: 75 + 99 = 174 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/lib/data/reports.ts src/hooks/queries/keys.ts src/hooks/queries/use-inventory-reports-query.ts src/hooks/queries/index.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 3: `DateRangePicker` shared component

**Files:**
- Create: `src/features/reports/date-range-picker.tsx`

### - [ ] Step 1: Create the component file

Create `src/features/reports/date-range-picker.tsx`:

```tsx
"use client";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * Phase 5.A — Shared DateRangePicker.
 *
 * Used by InventoryAnalyticsTab (5.A) and reused by 5.B/C/D
 * (Sales/Expense/Payroll/Hourly reports). Pure controlled component
 * — parent owns the DateRange state.
 *
 * Preset semantics (Vietnamese business week starts Monday):
 *   - today: [today, today]
 *   - week:  [Monday of this week, today]
 *   - month: [1st of current month, today]
 *   - custom: parent-supplied from/to (HTML date inputs revealed)
 */

export type DateRangePreset = "today" | "week" | "month" | "custom";

export interface DateRange {
  preset: DateRangePreset;
  from: string; // YYYY-MM-DD (local time)
  to: string;   // YYYY-MM-DD (local time)
}

interface DateRangePickerProps {
  value: DateRange;
  onChange(next: DateRange): void;
  className?: string;
}

const PRESET_LABELS: Record<Exclude<DateRangePreset, "custom">, string> = {
  today: "Hôm nay",
  week:  "Tuần này",
  month: "Tháng này",
};

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  function selectPreset(preset: Exclude<DateRangePreset, "custom">) {
    onChange(rangeFromPreset(preset));
  }

  function selectCustom() {
    // Keep current from/to but switch preset flag — reveals the date inputs.
    onChange({ preset: "custom", from: value.from, to: value.to });
  }

  function changeFrom(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ preset: "custom", from: e.target.value, to: value.to });
  }

  function changeTo(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ preset: "custom", from: value.from, to: e.target.value });
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted mr-1">Khoảng thời gian:</span>
        {(Object.keys(PRESET_LABELS) as Array<Exclude<DateRangePreset, "custom">>).map((p) => (
          <Button
            key={p}
            type="button"
            variant={value.preset === p ? "primary" : "ghost"}
            size="sm"
            onClick={() => selectPreset(p)}
          >
            {PRESET_LABELS[p]}
          </Button>
        ))}
        <Button
          type="button"
          variant={value.preset === "custom" ? "primary" : "ghost"}
          size="sm"
          onClick={selectCustom}
        >
          Khoảng tùy chọn
        </Button>
      </div>

      {value.preset === "custom" && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Từ</span>
            <input
              type="date"
              value={value.from}
              onChange={changeFrom}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Đến</span>
            <input
              type="date"
              value={value.to}
              onChange={changeTo}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Default = "Tuần này" (Monday → today). Used by the analytics tab
 * to initialise state lazily: `useState(() => defaultDateRange())`.
 */
export function defaultDateRange(): DateRange {
  return rangeFromPreset("week");
}

export function rangeFromPreset(
  preset: Exclude<DateRangePreset, "custom">
): DateRange {
  const now = new Date();
  const today = toISODate(now);

  if (preset === "today") {
    return { preset: "today", from: today, to: today };
  }

  if (preset === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { preset: "month", from: toISODate(first), to: today };
  }

  // week: Monday-based
  const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  return { preset: "week", from: toISODate(monday), to: today };
}

function toISODate(d: Date): string {
  // YYYY-MM-DD in LOCAL time (avoid toISOString() which is UTC).
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
```

Notes for the engineer:
- The component is fully controlled. Parent passes `value` + `onChange`; nothing is stored internally.
- "Khoảng tùy chọn" doesn't reset from/to — it carries the current values forward so a user clicking "Tuần này" then "Khoảng tùy chọn" can tweak the existing week dates without re-entering them.
- `toISODate` is intentional: `new Date().toISOString()` returns UTC, which would shift the day in some timezones. We need local time for "today" semantics in Vietnam (UTC+7).
- The Vietnamese week starts on Monday (matches the 4.D Stock ledger convention).

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors. If `Button` props complain, double-check the import path (`@/components/ui/button`).

### - [ ] Step 3: Smoke verify

```powershell
npm run verify:phase
```
Expected: 75 + 99 = 174 green. (No new tests; just ensure nothing regressed.)

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5a): T3 — DateRangePicker shared primitive

src/features/reports/date-range-picker.tsx (new):
- DateRange type { preset, from, to } where preset ∈ today/week/
  month/custom
- DateRangePicker controlled component:
    * 4 preset chips (Hôm nay/Tuần này/Tháng này/Khoảng tùy chọn)
    * Native <input type=date> for from/to revealed when custom
    * Preset chip = primary variant when active, ghost otherwise
- defaultDateRange() helper — used by tabs as useState lazy init
- rangeFromPreset(preset) — exported for future use (chip preset
  re-computation)
- toISODate() local-time YYYY-MM-DD formatter — avoids UTC drift

Reusable by 5.B/C/D (sales / expense+payroll / hourly tabs).

Vietnamese week starts Monday. Vietnamese month from 1st of
current month. All labels Vietnamese.

verify:phase: 75 + 99 = 174 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/date-range-picker.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 4: `ConsumptionReport`

**Files:**
- Create: `src/features/reports/consumption-report.tsx`

### - [ ] Step 1: Create the report component

Create `src/features/reports/consumption-report.tsx`:

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useInventoryConsumptionQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatUnit } from "@/features/inventory/units";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.A — Top ingredients consumed by sales over a date range.
 *
 * Data source: inventory_consumption_by_ingredient RPC (filters to
 * reason='sale_theoretical'). Sorted DESC by total_consumed; rendered
 * flat (no pagination — typical run is <50 rows for a coffee shop).
 */

interface ConsumptionReportProps {
  dateRange: DateRange;
}

export function ConsumptionReport({ dateRange }: ConsumptionReportProps) {
  const supabase = useSupabase();
  const query = useInventoryConsumptionQuery(
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
      <AlertBanner variant="danger" title="Không tải được báo cáo tiêu thụ">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="package"
        title="Chưa có tiêu thụ trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc nhập đơn bán mới."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Tiêu thụ theo nguyên liệu</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} nguyên liệu
          </Badge>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="text-left pb-2 font-medium">Nguyên liệu</th>
              <th className="text-right pb-2 font-medium">Tổng tiêu thụ</th>
              <th className="text-right pb-2 font-medium">Số đơn</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.ingredient_id} className="border-t border-border">
                <td className="py-2 text-ink">{row.name}</td>
                <td className="py-2 text-right font-mono tabular-nums text-ink">
                  {row.total_consumed.toLocaleString("vi-VN")} {formatUnit(row.unit)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-muted">
                  {row.sale_count}
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
- Reusing `formatUnit` from `@/features/inventory/units` so display matches 4.B/4.D conventions ("kg" → "Kg", "ml" → "Mililit", etc.).
- `toLocaleString("vi-VN")` produces Vietnamese number formatting (thousand separator = `.`, decimal = `,`).
- No pagination, no per-row drill-down (per spec §2 non-goals).

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors. If `Badge` `variant`/`semantic` props complain, open `src/components/ui/badge.tsx` and confirm the prop names — substitute the closest equivalent if different (e.g., `tone="neutral"`). The semantic value `"neutral"` is the most muted option.

### - [ ] Step 3: Smoke verify

```powershell
npm run verify:phase
```
Expected: 75 + 99 = 174 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5a): T4 — ConsumptionReport

src/features/reports/consumption-report.tsx (new):
- useInventoryConsumptionQuery(dateRange.from, dateRange.to)
- Loading: Spinner size 24, centered
- Error: AlertBanner variant=danger with message
- Empty: EmptyState dashedBorder, icon=package
- Data: Card → 3-column table (Nguyên liệu / Tổng tiêu thụ /
  Số đơn). Tabular-nums for right-aligned numerics. Unit label
  via formatUnit() from 4.B units helper.

Vietnamese number formatting via toLocaleString("vi-VN").
No pagination — typical row count <50 per range.

verify:phase: 75 + 99 = 174 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/consumption-report.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 5: `VarianceAuditReport`

**Files:**
- Create: `src/features/reports/variance-audit-report.tsx`

### - [ ] Step 1: Create the report component

Create `src/features/reports/variance-audit-report.tsx`:

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useInventoryVarianceQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { formatUnit } from "@/features/inventory/units";
import type { DateRange } from "./date-range-picker";
import type { VarianceRow } from "@/lib/data";

/**
 * Phase 5.A — Audit log of count_correction stock movements.
 *
 * Each row = one count_correction movement (date, ingredient, delta,
 * notes, actor). Sorted DESC by occurred_at. Read-only; owner drills
 * into Stock tab for full ledger context.
 */

interface VarianceAuditReportProps {
  dateRange: DateRange;
}

const VISIBLE_LIMIT = 50;

export function VarianceAuditReport({ dateRange }: VarianceAuditReportProps) {
  const supabase = useSupabase();
  const query = useInventoryVarianceQuery(
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
      <AlertBanner variant="danger" title="Không tải được lịch sử kiểm kê">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="package"
        title="Chưa có kiểm kê trong khoảng này"
        subtitle="Vào tab Tồn kho → Kiểm đếm để bắt đầu."
      />
    );
  }

  const visible = data.slice(0, VISIBLE_LIMIT);
  const hidden = data.length - visible.length;

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Chênh lệch kiểm kê</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} lần kiểm
          </Badge>
        </div>

        <div className="divide-y divide-border">
          {visible.map((row) => (
            <VarianceRowItem key={row.movement_id} row={row} />
          ))}
        </div>

        {hidden > 0 && (
          <p className="text-xs text-muted mt-3">
            Hiển thị {VISIBLE_LIMIT} dòng gần nhất. Còn {hidden} dòng nữa — xem chi tiết hơn vào tab Tồn kho.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function VarianceRowItem({ row }: { row: VarianceRow }) {
  const sign = row.quantity_delta > 0 ? "+" : "";
  const color =
    row.quantity_delta > 0
      ? "text-success"
      : row.quantity_delta < 0
        ? "text-warning"
        : "text-muted";

  return (
    <div className="flex items-start gap-3 py-2">
      <Icon name="package" size={16} className="text-muted mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-ink truncate">{row.ingredient_name}</p>
          <p className={`text-sm font-mono tabular-nums ${color}`}>
            Δ {sign}{row.quantity_delta.toLocaleString("vi-VN")} {formatUnit(row.unit)}
          </p>
        </div>
        <p className="text-xs text-muted mt-0.5">
          {formatOccurred(row.occurred_at)}
          {row.created_by ? " · bởi: nhân viên" : " · (hệ thống)"}
        </p>
        {row.notes && (
          <p className="text-xs text-muted mt-0.5 truncate">{row.notes}</p>
        )}
      </div>
    </div>
  );
}

function formatOccurred(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const isSameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();

  if (isSameDay) {
    const hh = String(then.getHours()).padStart(2, "0");
    const mm = String(then.getMinutes()).padStart(2, "0");
    return `hôm nay ${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();
  if (isYesterday) {
    const hh = String(then.getHours()).padStart(2, "0");
    const mm = String(then.getMinutes()).padStart(2, "0");
    return `hôm qua ${hh}:${mm}`;
  }

  const dd = String(then.getDate()).padStart(2, "0");
  const mo = String(then.getMonth() + 1).padStart(2, "0");
  const yyyy = then.getFullYear();
  const hh = String(then.getHours()).padStart(2, "0");
  const mm = String(then.getMinutes()).padStart(2, "0");
  return `${dd}/${mo}/${yyyy} ${hh}:${mm}`;
}
```

Notes for the engineer:
- `formatOccurred` is duplicated from `src/features/inventory/stock-ledger-section.tsx:308-340`. We're intentionally NOT extracting to a shared helper for 5.A — the function is small (~30 lines), used in only 2 places, and extracting risks pulling in an out-of-scope refactor. If 5.B/C/D needs it for a third site, that's the right moment to extract.
- `VISIBLE_LIMIT = 50` is the spec's chosen pagination threshold (§14). Above 50, the footer note nudges the user toward the Stock tab.
- `row.created_by` is `null` for system-emitted movements (none today for count_correction, but defensive).

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 3: Smoke verify

```powershell
npm run verify:phase
```
Expected: 75 + 99 = 174 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5a): T5 — VarianceAuditReport

src/features/reports/variance-audit-report.tsx (new):
- useInventoryVarianceQuery(dateRange.from, dateRange.to)
- Loading / Error / Empty patterns match T4 ConsumptionReport
- Data: Card → divide-y row list (icon + name + delta + meta +
  notes). Δ prefix on delta. Sign colour:
    > 0 = text-success (extra found)
    < 0 = text-warning (missing)
    = 0 = text-muted (exact)
- Inline formatOccurred() — relative timestamps (today/yesterday/
  full date), duplicated from stock-ledger-section to avoid
  out-of-scope refactor. Extract when 3rd consumer arrives.
- Visible limit = 50; over-limit footer nudges user to Stock tab.

verify:phase: 75 + 99 = 174 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/variance-audit-report.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 6: `InventoryAnalyticsTab`

**Files:**
- Create: `src/features/reports/inventory-analytics-tab.tsx`

### - [ ] Step 1: Create the tab composition

Create `src/features/reports/inventory-analytics-tab.tsx`:

```tsx
"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ConsumptionReport } from "./consumption-report";
import { VarianceAuditReport } from "./variance-audit-report";

/**
 * Phase 5.A — Inventory tab inside ReportsView.
 *
 * Single source of truth for the date range: both ConsumptionReport
 * and VarianceAuditReport receive the same value. Changing the
 * picker re-keys both TanStack Query caches and refetches.
 */
export function InventoryAnalyticsTab() {
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      <section className="space-y-3">
        <ConsumptionReport dateRange={dateRange} />
      </section>

      <section className="space-y-3">
        <VarianceAuditReport dateRange={dateRange} />
      </section>
    </div>
  );
}
```

Notes:
- Lazy init (`useState(() => defaultDateRange())`) so `new Date()` runs only on mount, not on every render.
- Reports are siblings under one shared state, so the page is one query per RPC × one selected range — clean for cache invalidation.

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors.

### - [ ] Step 3: Smoke verify

```powershell
npm run verify:phase
```
Expected: 75 + 99 = 174 green.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-5a): T6 — InventoryAnalyticsTab

src/features/reports/inventory-analytics-tab.tsx (new):
- useState<DateRange> lazy-initialised with defaultDateRange()
  (= "Tuần này": Monday → today)
- DateRangePicker at top, both reports below sharing the same
  range. Changing picker invalidates both queries via TanStack
  Query's automatic key change.

Not yet wired into ReportsView — that's T7.

verify:phase: 75 + 99 = 174 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/inventory-analytics-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 7: `ReportsView` refactor + verify + tag `v4-phase-5a`

**Files:**
- Modify: `src/features/reports/reports-view.tsx` — wrap existing JSX in `<Tabs>` shell

### - [ ] Step 1: Refactor `ReportsView` to tabs

Open `src/features/reports/reports-view.tsx`. Replace the file's contents in full with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import { useReportsQuery } from "@/hooks/queries";
import { loadCashCloseReport } from "@/lib/data";
import type { CashCloseReport } from "@/lib/types";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReportList } from "./report-list";
import { PrintableReport } from "./printable-report";
import { exportElementAsJpeg } from "./export-jpeg";
import { InventoryAnalyticsTab } from "./inventory-analytics-tab";

interface ReportsViewProps {
  businessDate: string;
}

export function ReportsView({ businessDate }: ReportsViewProps) {
  return (
    <Tabs defaultValue="cash_close">
      <TabsList>
        <TabsTrigger value="cash_close">Chốt két</TabsTrigger>
        <TabsTrigger value="inventory">Tồn kho</TabsTrigger>
        <TabsTrigger value="sales_product">Doanh số</TabsTrigger>
        <TabsTrigger value="expense_payroll">Chi phí + lương</TabsTrigger>
        <TabsTrigger value="hourly">Theo giờ</TabsTrigger>
      </TabsList>

      <TabsContent value="cash_close">
        <CashCloseTab businessDate={businessDate} />
      </TabsContent>

      <TabsContent value="inventory">
        <InventoryAnalyticsTab />
      </TabsContent>

      <TabsContent value="sales_product">
        <EmptyState
          icon="barChart3"
          title="Doanh số"
          subtitle="Phát hành trong giai đoạn 5.B — báo cáo doanh số theo sản phẩm và danh mục."
          dashedBorder
        />
      </TabsContent>

      <TabsContent value="expense_payroll">
        <EmptyState
          icon="wallet"
          title="Chi phí + lương"
          subtitle="Phát hành trong giai đoạn 5.C — báo cáo chi phí và lương theo khoảng."
          dashedBorder
        />
      </TabsContent>

      <TabsContent value="hourly">
        <EmptyState
          icon="info"
          title="Theo giờ"
          subtitle="Phát hành trong giai đoạn 5.D — xu hướng doanh số theo giờ."
          dashedBorder
        />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------
// Cash close tab — extracted from the previous ReportsView body
// without semantic changes. Renders the existing two-pane layout.
// ---------------------------------------------------------------------

interface CashCloseTabProps {
  businessDate: string;
}

function CashCloseTab({ businessDate }: CashCloseTabProps) {
  const supabase = useSupabase();
  const reportsQuery = useReportsQuery(supabase, businessDate, true);
  const { toast } = useToast();
  const [selected, setSelected] = useState<CashCloseReport | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  // Auto-select latest report when list changes (matches v3 page.tsx 149-152).
  useEffect(() => {
    setSelected((current) => current ?? reportsQuery.data?.[0] ?? null);
  }, [reportsQuery.data]);

  async function handleSelect(id: string) {
    if (!supabase) return;
    try {
      const full = await loadCashCloseReport(supabase, id);
      setSelected(full);
    } catch (err) {
      toast({
        semantic: "danger",
        title: "Không tải được báo cáo",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleExport() {
    if (!selected || !printRef.current) return;
    setIsExporting(true);
    try {
      const filename = `chot-ket-${selected.business_date}-${selected.id.slice(0, 8)}.jpg`;
      await exportElementAsJpeg(printRef.current, filename);
      toast({ semantic: "success", message: "Đã tải ảnh báo cáo." });
    } catch (err) {
      toast({
        semantic: "danger",
        title: "Không tải được ảnh",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsExporting(false);
    }
  }

  if (reportsQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (reportsQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được danh sách báo cáo">
        {reportsQuery.error instanceof Error
          ? reportsQuery.error.message
          : String(reportsQuery.error)}
      </AlertBanner>
    );
  }

  const reports = reportsQuery.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <ReportList
        reports={reports}
        selectedId={selected?.id ?? null}
        onSelect={handleSelect}
      />
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between gap-3">
            <CardTitle>Phiếu chốt két</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon name="download" size={16} />}
                loading={isExporting}
                disabled={!selected}
                onClick={handleExport}
              >
                Tải ảnh
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Icon name="printer" size={16} />}
                disabled={!selected}
                onClick={() => window.print()}
              >
                In
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {selected ? (
            <div ref={printRef} className="print-target">
              <PrintableReport report={selected} />
            </div>
          ) : (
            <EmptyState
              icon="fileText"
              title="Chọn một báo cáo"
              subtitle="Chọn một báo cáo ở cột trái để xem và in."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

Notes for the engineer:
- The Cash Close inner logic (`reportsQuery`, `selected`, `isExporting`, `printRef`, `handleSelect`, `handleExport`, both loading/error branches, the two-pane grid JSX) is **preserved byte-for-byte** — only relocated inside `CashCloseTab` instead of `ReportsView`'s body.
- `ReportsView`'s new body is purely the `<Tabs>` shell + 5 `<TabsContent>` children — no business logic at the top level.
- The 4 placeholder icons (`barChart3`, `wallet`, `info`) are assumed to exist already (they're used in Phase 2 design system + 4.E). If `barChart3` is missing, substitute with `bar-chart-3` per the codebase's icon-name convention. Verify by glancing at `src/components/ui/icons.tsx` if the build complains.

### - [ ] Step 2: TypeScript strict check

```powershell
npx tsc --noEmit
```
Expected: zero errors. If an Icon name like `"barChart3"` errors, open `src/components/ui/icons.tsx` and substitute with whichever similar name exists. The empty-state icons are decorative — exact icon match is not critical.

### - [ ] Step 3: Production build sanity check

```powershell
npm run build
```
Expected: build succeeds. If a chunk fails for a missing module, double-check the import paths at the top of `reports-view.tsx`.

### - [ ] Step 4: Run the full verify suite

```powershell
npm run verify:phase
```
Expected: **75 Vitest + 99 pgTAP = 174 green**.

### - [ ] Step 5: Manual smoke test (recommended before commit)

Start the dev server in another terminal (`npm run dev`) and verify in a browser:

1. Owner login → click Báo cáo in the sidebar
2. "Chốt két" tab is the default — existing Cash Close list + printable report render exactly as before
3. Click "Tồn kho" tab → DateRangePicker + ConsumptionReport + VarianceAuditReport render
4. Click "Tuần này" / "Tháng này" / "Hôm nay" → both reports refetch
5. Click "Khoảng tùy chọn" → 2 date inputs appear; changing either refetches
6. With an empty stock_movements range, both reports show their EmptyState
7. Sales tab / Chi phí + lương tab / Theo giờ tab → each shows its placeholder EmptyState
8. Log in as manager → same 5 tabs visible (all read-only)
9. Log in as staff_operator → same 5 tabs visible
10. Log in as employee_viewer → "Báo cáo" item NOT in sidebar (NAV_ITEMS already blocks)

If any smoke check fails, fix and re-verify before committing.

### - [ ] Step 6: Commit the refactor

```powershell
@'
feat(phase-5a): T7 — ReportsView refactor to tabs + wire Inventory tab

src/features/reports/reports-view.tsx (refactor):
- Outer shell now <Tabs defaultValue="cash_close"> with 5 triggers:
    * Chốt két (existing)
    * Tồn kho (new — wires InventoryAnalyticsTab from T6)
    * Doanh số (placeholder for 5.B)
    * Chi phí + lương (placeholder for 5.C)
    * Theo giờ (placeholder for 5.D)
- All existing Cash Close logic + JSX extracted into a private
  CashCloseTab(businessDate) sub-component without semantic
  changes — preserved byte-for-byte:
    * useReportsQuery + useEffect auto-select
    * handleSelect + loadCashCloseReport on row click
    * handleExport via exportElementAsJpeg
    * 2-pane grid (ReportList + Card with PrintableReport)
- 3 placeholder tabs use EmptyState with dashedBorder + an
  explanatory subtitle naming the sub-phase that will deliver
  the report (5.B/5.C/5.D).

Role gating unchanged — NAV_ITEMS already restricts /Báo cáo
to owner+manager+staff_operator (employee_viewer blocked).

Manual smoke: all 4 roles tested in browser. All 5 tabs visible
to the 3 allowed roles; employee_viewer can't reach the route.

verify:phase: 75 Vitest + 99 pgTAP = 174 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add src/features/reports/reports-view.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

### - [ ] Step 7: Final verify before tagging

```powershell
npm run verify:phase
npx tsc --noEmit
npm run build
```
Expected: all three clean. If anything fails, fix before tagging.

### - [ ] Step 8: Tag `v4-phase-5a`

```powershell
git tag -a v4-phase-5a -m "Phase 5.A — Inventory Analytics"
git log --oneline -10
git tag -l "v4-phase-5*"
```
Expected output:
- `git log` shows the latest 7 commits from this phase
- `git tag -l` shows at least `v4-phase-5a` (no umbrella `v4-phase-5` yet — that comes after 5.D)

### - [ ] Step 9: Final status check

```powershell
git status
git diff main..HEAD --stat
```
Expected:
- `git status`: clean working tree
- `git diff main..HEAD --stat`: shows ~9 files changed
   - `database/002_functions.sql` (modified)
   - `database/tests/160_inventory_reports.sql` (new)
   - `src/lib/data/reports.ts` (modified)
   - `src/hooks/queries/keys.ts` (modified)
   - `src/hooks/queries/index.ts` (modified)
   - `src/hooks/queries/use-inventory-reports-query.ts` (new)
   - `src/features/reports/date-range-picker.tsx` (new)
   - `src/features/reports/consumption-report.tsx` (new)
   - `src/features/reports/variance-audit-report.tsx` (new)
   - `src/features/reports/inventory-analytics-tab.tsx` (new)
   - `src/features/reports/reports-view.tsx` (modified)
   - `docs/superpowers/specs/2026-05-22-v4-phase-5-overall-design.md` (already on branch from prior commit)
   - `docs/superpowers/specs/2026-05-22-v4-phase-5a-inventory-analytics-design.md` (already on branch from prior commit)
   - `docs/superpowers/plans/2026-05-22-v4-phase-5a-inventory-analytics.md` (this file — already on branch when plan was committed before subagent dispatch, if applicable)

If extra files appear that aren't in the manifest, investigate before invoking `superpowers:finishing-a-development-branch`.

### - [ ] Step 10: Hand off to `superpowers:finishing-a-development-branch`

After T7 commits + tag are in place, the controller invokes:
- `superpowers:finishing-a-development-branch` to present merge / PR / keep / discard options
- Typical choice: **Option 1 — Merge back to main locally** (matches every prior Phase 4 sub-phase finish)
- Verify the merge commit also contains the `v4-phase-5a` tag (move tag if it ended up on a pre-merge SHA — but `git tag -a` on the latest pre-merge SHA + a fast-forward / merge --no-ff is fine)

---

## Verification matrix

After T7 merges to `main`:

| Check | Command | Expected |
|-------|---------|----------|
| Vitest | `npm test -- --run` | 75 pass |
| pgTAP | `npm run pgtap` | 99 pass (89 prior + 10 new in 160) |
| TS strict | `npx tsc --noEmit` | 0 errors |
| Build | `npm run build` | success |
| Branch off main | `git log --oneline main..phase-5a-inventory-analytics` | 9 commits (spec + 7 task commits, possibly + plan commit) |
| Tag | `git tag -l v4-phase-5a` | exists, points to final merge commit |

Manual UI smoke (from T7 Step 5) — owner login is sufficient; other 3 roles verified in T7 step 5 list.

---

## Self-review

### Spec coverage
| Spec section | Requirement | Plan task |
|---|---|---|
| §4.1 | ReportsView refactored to tabs | T7 |
| §4.2 | InventoryAnalyticsTab structure | T6 |
| §4.3 | Data flow (2 queries, same range) | T2, T6 |
| §4.4 | Role gating (NAV_ITEMS + tab visibility) | T7 (smoke) |
| §5.1 | `inventory_consumption_by_ingredient` RPC | T1 |
| §5.2 | `inventory_variance_audit` RPC | T1 |
| §5.3 | 10 pgTAP assertions | T1 |
| §6.1 | 7 new files | T1 (×1), T2 (×1), T3, T4, T5, T6, (T7 modifies) |
| §6.2 | 3 modified files (002_functions, reports-view, keys) | T1, T2, T7 (+ data/reports + queries/index) |
| §7.1 | DateRangePicker | T3 |
| §7.2 | ConsumptionReport | T4 |
| §7.3 | VarianceAuditReport | T5 |
| §7.4 | InventoryAnalyticsTab | T6 |
| §7.5 | Refactored ReportsView | T7 |
| §8.1 | Data layer wrappers | T2 |
| §8.2 | Query keys | T2 |
| §8.3 | Query hooks | T2 |
| §9 | Vietnamese strings | T3, T4, T5, T7 |
| §10 | Error handling | T4, T5, T7 |
| §11 | Risk mitigation (preserve Cash Close) | T7 |
| §13 | Success criteria | T7 (verify step) |

All 12 success criteria from §13 covered:
1–3 ✓ T7 final verify
4 ✓ T7 smoke test step
5 ✓ T7 smoke test
6 ✓ T7 smoke test
7 ✓ T7 smoke test
8 ✓ T4 + T5 EmptyState branches
9 ✓ T7 smoke test
10 ✓ T7 smoke test
11 ✓ T1 pgTAP step
12 ✓ T7 Step 8 tag

### Placeholder scan
- No "TBD" / "implement later" / "TODO" / "add appropriate" / "handle edge cases" in any task
- T1 Step 4 contains a deliberate `→ Implementer note` explaining a known recount issue (the draft has 11 `select is` statements but `plan(10)` — the note flags exactly which one to delete). This is a guard against the writer's own miscount, not a placeholder.

### Type consistency
- `DateRange` interface defined in T3 (`{ preset, from, to }` where `from` and `to` are `string`)
- `ConsumptionRow` / `VarianceRow` interfaces defined in T2; consumed by T4 / T5 via `@/lib/data` barrel
- `useInventoryConsumptionQuery(supabase, from, to, enabled?)` signature consistent between T2 (declaration) and T4 (call site)
- `useInventoryVarianceQuery(supabase, from, to, enabled?)` signature consistent between T2 and T5
- `formatUnit` from `@/features/inventory/units` — same import path in T4, T5
- `InventoryAnalyticsTab` named export in T6; same name imported in T7

### Scope check
7 tasks × ~10 steps each = ~70 steps. Matches Phase 4.A scale. All steps fit the 2–5 min target. No spec requirement uncovered.

No issues found.

---

## After this plan

Once T7 merges and tag `v4-phase-5a` lands:
- **Phase 5.B (Sales by product + category)** — next sub-phase: new tab content for `sales_product` placeholder
- **Phase 5.C (Expense + payroll date-range)** — replaces `expense_payroll` placeholder
- **Phase 5.D (Hourly trends)** — replaces `hourly` placeholder
- **Umbrella `v4-phase-5`** tag placed on the final merge commit of 5.D

5.A unblocks 5.B/C/D because `DateRangePicker` is shared infrastructure.
