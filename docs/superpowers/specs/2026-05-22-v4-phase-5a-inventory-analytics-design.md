# Phase 5.A — Inventory Analytics Design

**Parent:** `docs/superpowers/specs/2026-05-22-v4-phase-5-overall-design.md`
**Scope:** First analytics sub-phase. Inventory consumption + variance audit reports inside a new "Tồn kho" tab of a refactored `ReportsView`. Introduces shared `DateRangePicker` for use across 5.B/C/D. 2 new RPCs.
**Branch:** `phase-5a-inventory-analytics` (off main @ tag `v4-phase-4`)
**Tag at end:** `v4-phase-5a`

---

## 0. TL;DR

- 1 modified file (`reports-view.tsx` — refactored to tabs) + 7 new files.
- 2 new RPCs in `002_functions.sql`: `inventory_consumption_by_ingredient` + `inventory_variance_audit`.
- 1 new pgTAP file `160_inventory_reports.sql` with ~10 assertions.
- Cash Close report content preserved as first tab. 3 placeholder tabs added (5.B/C/D).
- Shared `DateRangePicker` lives in `src/features/reports/` (used by 5.B/C/D).
- `verify:phase` after merge: **75 Vitest + 99 pgTAP = 174 total**.

---

## 1. Goal

Surface inventory consumption + variance audit over date ranges. These are the **first read paths** for Phase 4's `stock_movements` data. Owner/manager/staff_operator can answer:

- "How much milk did we use last week?" (consumption report)
- "When and why did we count-correct ingredient X this month?" (variance audit)

---

## 2. Non-goals (specific to 5.A)

- No daily breakdown / time-series chart (flat aggregation only)
- No per-menu-item or per-recipe drill-down (deferred to 5.+ or 5.B)
- No cross-feature linkage (clicking a row does NOT navigate to InventoryView's Stock tab; owner manually navigates)
- No CSV/Excel export
- No food cost computation (requires `ingredients.unit_cost` schema change)
- No running theoretical_before column in variance audit (owner drills into Stock tab if they need running balance)
- No filters beyond date range (no per-ingredient filter — would duplicate Stock tab's filter)

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Report set | **2 reports**: Consumption + Variance (3rd menu_item-rollup deferred) |
| RPC return shape | **Flat** (per-ingredient totals), not 2D by-day |
| DateRangePicker UI | **Preset chips** + reveal-on-custom native date inputs |
| Variance audit columns | **Movement-level row** (date, ingredient, delta, notes, actor); NO running theoretical_before |
| Default inventory tab section | Consumption first, Variance below (stacked sections, not nested tabs) |
| Cross-feature drill-down | **Deferred** — no click-to-navigate from reports rows |
| ReportsView refactor | **Tab-based** in 5.A — Cash Close preserved as first tab |

---

## 4. Architecture

### 4.1 ReportsView refactor

Current `ReportsView` is a single-page Cash Close viewer (139 lines). 5.A wraps the existing JSX in a `<Tabs>` container without modifying inner logic:

```
ReportsView ({businessDate, role?})
└── Tabs.Root defaultValue="cash_close"
    ├── Tabs.List (5 triggers)
    ├── Tabs.Content value="cash_close" → (existing ReportList + PrintableReport JSX, untouched)
    ├── Tabs.Content value="inventory" → <InventoryAnalyticsTab />
    ├── Tabs.Content value="sales_product" → <EmptyState> "Phát hành trong 5.B"
    ├── Tabs.Content value="expense_payroll" → <EmptyState> "Phát hành trong 5.C"
    └── Tabs.Content value="hourly" → <EmptyState> "Phát hành trong 5.D"
```

The Cash Close inner logic (selectedReportId state, list, printable, export-jpeg) is preserved byte-for-byte. Only the outer `<div>` shell is replaced with `<Tabs.Root>`.

### 4.2 InventoryAnalyticsTab structure

```
InventoryAnalyticsTab (no props)
├── DateRangePicker (shared)
│   └── state: dateRange (default = "Tuần này")
│
├── Section 1: "Tiêu thụ theo nguyên liệu"
│   └── ConsumptionReport (dateRange prop)
│
└── Section 2: "Chênh lệch kiểm kê"
    └── VarianceAuditReport (dateRange prop)
```

Date range state lives in the tab; passed to both reports.

### 4.3 Data flow

```
InventoryAnalyticsTab
  ├── useState<DateRange> (default: "Tuần này")
  └── DateRangePicker controls dateRange

ConsumptionReport (dateRange)
  ├── useSupabase()
  └── useInventoryConsumptionQuery(supabase, dateRange.from, dateRange.to, true)
      → fetches via supabase.rpc("inventory_consumption_by_ingredient", { p_from, p_to })

VarianceAuditReport (dateRange)
  ├── useSupabase()
  └── useInventoryVarianceQuery(supabase, dateRange.from, dateRange.to, true)
      → fetches via supabase.rpc("inventory_variance_audit", { p_from, p_to })
```

Both queries have `staleTime: 60_000`. No mutations (read-only).

### 4.4 Role gating

ReportsView is gated by NAV_ITEMS — `owner + manager + staff_operator` (employee_viewer excluded). Within ReportsView, all 5 tabs are visible to all 3 allowed roles. Inventory analytics specifically:

| Role | Can see Inventory tab | Can interact |
|------|------------------------|--------------|
| owner | ✓ | full read |
| manager | ✓ | full read |
| staff_operator | ✓ | full read |
| employee_viewer | n/a | n/a |

No write controls in 5.A. No `canWrite` plumbing needed.

---

## 5. RPC specs (full SQL)

### 5.1 `inventory_consumption_by_ingredient`

```sql
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
security definer
set search_path = public
as $$
  select
    i.id           as ingredient_id,
    i.name,
    i.unit,
    sum(abs(sm.quantity_delta))::numeric as total_consumed,
    count(distinct sm.source_order_id)::bigint as sale_count
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where sm.reason = 'sale_theoretical'
    and sm.occurred_at::date >= p_from
    and sm.occurred_at::date <= p_to
  group by i.id, i.name, i.unit
  order by total_consumed desc;
$$;
```

Notes:
- Filters to `reason = 'sale_theoretical'` exclusively (excludes manual movements, purchases, count_corrections, waste).
- `count(distinct sm.source_order_id)` is meaningful because the trigger emits one row per `(order_item, recipe_item)` pair; distinct order IDs ≈ distinct sale transactions.
- Excludes ingredients with zero consumption in the range (server-side via implicit GROUP BY + JOIN filter).
- `STABLE` for PostgREST query caching.

### 5.2 `inventory_variance_audit`

```sql
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
security definer
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

Notes:
- Filters to `reason = 'count_correction'` exclusively.
- No running balance computation (intentional — owner drills into Stock tab for full ledger).
- Returns raw `created_by` UUID (UI shows "bởi: nhân viên" / "(hệ thống)" — matches 4.D pattern).
- Sort: most recent first.

### 5.3 pgTAP test plan (`160_inventory_reports.sql`)

10 assertions:

```
1. inventory_consumption_by_ingredient returns empty set when no sales in range
2. Sums abs(quantity_delta) correctly across multiple sale_theoretical rows for same ingredient
3. Excludes non-sale_theoretical reasons (purchase_received, waste, count_correction)
4. sale_count counts distinct source_order_id values correctly
5. Date filter is inclusive on both p_from and p_to ends
6. Sort is ORDER BY total_consumed DESC (verify with 2 ingredients of different totals)

7. inventory_variance_audit returns empty when no count_corrections in range
8. Returns ONLY reason='count_correction' rows (verify exclusion)
9. Sort is ORDER BY occurred_at DESC
10. Joins ingredients.name + ingredients.unit correctly (verify joined values)
```

---

## 6. File manifest

### 6.1 New files (7)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `src/features/reports/date-range-picker.tsx` | ~110 | Shared preset chips + custom date input reveal |
| `src/features/reports/inventory-analytics-tab.tsx` | ~80 | Composes DateRangePicker + 2 reports |
| `src/features/reports/consumption-report.tsx` | ~150 | Flat table of ingredient × consumption |
| `src/features/reports/variance-audit-report.tsx` | ~180 | Paged list of count_correction rows |
| `src/lib/data/reports.ts` | (existing — append 2 fns) | `loadInventoryConsumption` + `loadInventoryVariance` |
| `src/hooks/queries/use-inventory-reports-query.ts` | ~50 | 2 query hooks |
| `database/tests/160_inventory_reports.sql` | ~80 | pgTAP — 10 assertions |

Note: `src/lib/data/reports.ts` already exists (cash close functions). 5.A APPENDS to it rather than creating a separate file.

### 6.2 Modified files (3)

| Path | Change |
|------|--------|
| `src/features/reports/reports-view.tsx` | Refactor outer wrapper to `<Tabs.Root>` shell |
| `database/002_functions.sql` | Append 2 new RPCs |
| `src/hooks/queries/keys.ts` | Add `queryKeys.inventoryConsumption()` + `queryKeys.inventoryVariance()` |

### 6.3 Off-limits

- `database/001_schema.sql` (no schema changes)
- `database/003_rls.sql` (no new RLS — existing stock_movements RLS allows SELECT to authenticated)
- `src/lib/types.ts` (no new types — query hooks use inline row types)
- Other Phase 2 primitives, prior-phase feature modules

---

## 7. Component specs

### 7.1 DateRangePicker

```tsx
export type DateRangePreset = "today" | "week" | "month" | "custom";

export interface DateRange {
  preset: DateRangePreset;
  from: string;  // YYYY-MM-DD
  to: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange(next: DateRange): void;
}
```

**Behavior:**
- Renders 4 preset chips as `<Button variant="ghost">` with active state styling
- Clicking a preset auto-computes from/to and clears custom inputs
- Clicking "Khoảng tùy chọn" reveals 2 native `<input type="date">` controls below
- Vietnamese week starts Monday (matches 4.D Stock ledger convention)
- Vietnamese month boundary: 1st of current month

**Default value (helper):**

```ts
export function defaultDateRange(): DateRange {
  const now = new Date();
  const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  monday.setHours(0, 0, 0, 0);
  return {
    preset: "week",
    from: toISODate(monday),
    to: toISODate(now),
  };
}

function toISODate(d: Date): string {
  // YYYY-MM-DD in local time
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
```

### 7.2 ConsumptionReport

```tsx
interface ConsumptionReportProps {
  dateRange: DateRange;
}
```

**Behavior:**
- Fetch via `useInventoryConsumptionQuery(supabase, dateRange.from, dateRange.to)`
- Loading: Spinner
- Error: `<AlertBanner variant="danger">Không tải được báo cáo tiêu thụ. Vui lòng tải lại trang.</AlertBanner>`
- Empty: `<EmptyState dashedBorder icon="package" title="Chưa có tiêu thụ trong khoảng này" subtitle="Đổi khoảng thời gian hoặc nhập đơn bán mới." />`
- Data: Card with table

**Table:**

```tsx
<Card>
  <CardBody>
    <div className="flex items-baseline justify-between gap-3 mb-3">
      <h3 className="text-sm font-medium text-ink">Tiêu thụ theo nguyên liệu</h3>
      <Badge variant="soft" semantic="neutral">{data.length} nguyên liệu</Badge>
    </div>
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-muted">
          <th className="text-left pb-2">Nguyên liệu</th>
          <th className="text-right pb-2">Tổng tiêu thụ</th>
          <th className="text-right pb-2">Số đơn</th>
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
```

### 7.3 VarianceAuditReport

```tsx
interface VarianceAuditReportProps {
  dateRange: DateRange;
}
```

**Behavior:**
- Fetch via `useInventoryVarianceQuery(supabase, dateRange.from, dateRange.to)`
- Loading / Error / Empty same pattern
- Data: Card with row list (similar style to 4.D stock ledger but read-only)

**Row layout:**

```tsx
<div className="flex items-start gap-3 py-2 border-b border-border last:border-b-0">
  <Icon name="package" size={16} className="text-muted mt-0.5 shrink-0" />
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-2 flex-wrap">
      <p className="text-sm font-medium text-ink truncate">{row.ingredient_name}</p>
      <p className={`text-sm font-mono tabular-nums ${deltaColor(row.quantity_delta)}`}>
        Δ {row.quantity_delta > 0 ? "+" : ""}{row.quantity_delta} {formatUnit(row.unit)}
      </p>
    </div>
    <p className="text-xs text-muted mt-0.5">
      {formatOccurred(row.occurred_at)}
      {row.created_by ? " · bởi: nhân viên" : " · (hệ thống)"}
    </p>
    {row.notes && <p className="text-xs text-muted mt-0.5 truncate">{row.notes}</p>}
  </div>
</div>
```

`deltaColor` helper:
```ts
function deltaColor(delta: number): string {
  if (delta > 0) return "text-success"; // found extra
  if (delta < 0) return "text-warning"; // missing
  return "text-muted"; // exact
}
```

`formatOccurred` reused from 4.D pattern (relative timestamps).

### 7.4 InventoryAnalyticsTab

```tsx
"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ConsumptionReport } from "./consumption-report";
import { VarianceAuditReport } from "./variance-audit-report";

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

### 7.5 Refactored ReportsView

```tsx
"use client";

// ... existing imports (keep all) ...
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { InventoryAnalyticsTab } from "./inventory-analytics-tab";

interface ReportsViewProps {
  businessDate: string;
}

export function ReportsView({ businessDate }: ReportsViewProps) {
  // ... existing useState + useReportsQuery logic, preserved byte-for-byte ...

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
        {/* EXISTING JSX preserved here — left/right split with ReportList + PrintableReport */}
      </TabsContent>

      <TabsContent value="inventory">
        <InventoryAnalyticsTab />
      </TabsContent>

      <TabsContent value="sales_product">
        <EmptyState
          icon="barChart3"
          title="Doanh số"
          subtitle="Phát hành trong giai đoạn 5.B — báo cáo doanh số theo sản phẩm/danh mục."
          dashedBorder
        />
      </TabsContent>

      <TabsContent value="expense_payroll">
        <EmptyState
          icon="wallet"
          title="Chi phí + lương"
          subtitle="Phát hành trong giai đoạn 5.C — báo cáo chi phí + lương theo khoảng."
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
```

The `businessDate` prop is still used by the existing Cash Close logic; it's passed to `useReportsQuery` etc. The new tabs don't need businessDate (they use their own date range internally).

---

## 8. Data layer + query hook additions

### 8.1 Data layer (`src/lib/data/reports.ts` — append to existing file)

```ts
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
  const { data, error } = await supabase.rpc("inventory_consumption_by_ingredient", {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
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
  const { data, error } = await supabase.rpc("inventory_variance_audit", {
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return (data ?? []) as VarianceRow[];
}
```

### 8.2 Query keys (`src/hooks/queries/keys.ts` — append)

```ts
inventoryConsumption: (range: { from: string; to: string }) =>
  ["reports", "inventory_consumption", range] as const,
inventoryVariance: (range: { from: string; to: string }) =>
  ["reports", "inventory_variance", range] as const,
```

### 8.3 Query hooks (`src/hooks/queries/use-inventory-reports-query.ts` — new)

(See §2.4 in brainstorming — full code.)

---

## 9. Vietnamese strings (locked for Phase 5.A)

Full glossary in §2.5 brainstorming. Key strings:

- Tab labels: Chốt két / Tồn kho / Doanh số / Chi phí + lương / Theo giờ
- Section headings: Tiêu thụ theo nguyên liệu / Chênh lệch kiểm kê
- Column headers: Nguyên liệu / Tổng tiêu thụ / Số đơn
- DateRangePicker: Hôm nay / Tuần này / Tháng này / Khoảng tùy chọn / Từ / Đến
- Variance delta prefix: `Δ`
- Empty consumption: Chưa có tiêu thụ trong khoảng này
- Empty variance: Chưa có kiểm kê trong khoảng này
- Pagination hint: Hiển thị {N} dòng. Để xem chi tiết hơn vào tab Tồn kho.
- Author display: bởi: nhân viên / (hệ thống)

---

## 10. Error handling

| Source | Behavior |
|--------|----------|
| `useInventoryConsumptionQuery` error | Section 1 AlertBanner.danger "Không tải được báo cáo tiêu thụ. Vui lòng tải lại trang." |
| `useInventoryVarianceQuery` error | Section 2 AlertBanner.danger "Không tải được lịch sử kiểm kê. Vui lòng tải lại trang." |
| Empty range | Per-section EmptyState (dashedBorder) with relevant subtitle |
| Cash Close tab regression (existing logic) | Manual smoke test in T7 — verify select report → display → export still works |

---

## 11. Risk register (5.A-specific)

See §2.6 brainstorming. Highlights:

- ReportsView refactor preserves Cash Close logic byte-for-byte (only outer shell changes)
- All new RPCs filter by `occurred_at::date` (date type) to avoid timezone confusion
- `created_by` UUID displayed as generic "nhân viên" / "(hệ thống)" — no join needed
- Variance row count typically 30-50 per month — no pagination needed

---

## 12. Implementation strategy (task projection)

7 tasks projected for `superpowers:writing-plans`:

1. **T1** — Append 2 RPCs to `002_functions.sql` + create `database/tests/160_inventory_reports.sql` (10 pgTAP assertions)
2. **T2** — Append data layer functions to `src/lib/data/reports.ts` + create `src/hooks/queries/use-inventory-reports-query.ts` + extend `keys.ts`
3. **T3** — Create `DateRangePicker` shared component (used by 5.B/C/D later)
4. **T4** — Create `ConsumptionReport`
5. **T5** — Create `VarianceAuditReport`
6. **T6** — Create `InventoryAnalyticsTab` (composes T3 + T4 + T5)
7. **T7** — Refactor `ReportsView` to tabs + wire `InventoryAnalyticsTab` + 3 placeholders + final `verify:phase` + tag `v4-phase-5a`

---

## 13. Success criteria

1. ✅ `npm run verify:phase` ends at **75 Vitest + 99 pgTAP = 174 green** (50 pre-Phase-4 + 39 Phase 4 + 10 new in 5.A)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ Owner login → Báo cáo → Chốt két tab renders existing Cash Close UI unchanged (smoke test)
5. ✅ Tồn kho tab → DateRangePicker + ConsumptionReport + VarianceAuditReport render
6. ✅ Switching presets (Hôm nay / Tuần này / Tháng này) re-fetches and shows new data
7. ✅ Custom date range with `from`/`to` inputs filters correctly
8. ✅ Empty range → both sections show appropriate EmptyState
9. ✅ Manager + staff_operator: same view as owner (all read-only)
10. ✅ employee_viewer: cannot reach ReportsView (NAV_ITEMS already filters)
11. ✅ pgTAP 160 file: 10/10 assertions pass
12. ✅ Tag `v4-phase-5a` placed on final merge commit

---

## 14. Open decisions (defer to writing-plans / execution)

- **Custom date input UX**: native `<input type="date">` is locked. If browser support quirks emerge, fall back to plain text inputs with regex validation. Implementer decides at T3.
- **Empty range subtitle text**: minor copy variations OK. Spec provides defaults but implementer can adjust if better wording emerges during build.
- **Pagination hint for variance audit**: shown only when `data.length > 50`. Below threshold, no hint. Implementer keeps threshold consistent.

---

## 15. Self-review

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in normative sections (§§3–13). §14 explicitly labels Open decisions.

**Internal consistency:**
- File count: 7 new + 3 modified (§6.1 + §6.2) ✓
- 7 tasks (§12) ✓
- 2 RPCs (§5 + §6.2) ✓
- 10 pgTAP assertions (§5.3 + §13) ✓
- ReportsView refactor preserves Cash Close (§4.1 + §7.5 + §11) ✓

**Ambiguity check:**
- "Flat aggregation" defined explicitly — per-ingredient totals, no daily breakdown
- "Variance audit" defined as count_correction rows only — no other reasons
- Cash Close preservation defined as "outer shell only — inner JSX preserved byte-for-byte"
- Defense gating: all 5 tabs visible to all 3 allowed roles; employee_viewer blocked at NAV_ITEMS

**Scope check:** UI + 2 RPCs. Manageable; 7 tasks. Matches Phase 4.A scale.

No issues found.

---

## 16. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 7-task implementation plan.
