# Phase 4.E — Inventory Dashboard + Variance UI Design

**Parent:** `docs/superpowers/specs/2026-05-21-v4-phase-4-overall-design.md`
**Predecessors:**
- `docs/superpowers/specs/2026-05-21-v4-phase-4a-backend-design.md` (backend, merged at `v4-phase-4a`)
- `docs/superpowers/specs/2026-05-21-v4-phase-4b-masters-ui-design.md` (Masters UI, merged at `v4-phase-4b`)
- `docs/superpowers/specs/2026-05-22-v4-phase-4c-recipes-ui-design.md` (Recipes UI, merged at `v4-phase-4c`)
- `docs/superpowers/specs/2026-05-22-v4-phase-4d-stock-ui-design.md` (Stock UI, merged at `v4-phase-4d`)

**Scope:** Inventory dashboard inside the Tổng quan tab of InventoryView — 4 KPI cards + 3 list widgets (Sắp hết, Âm tồn, Top tiêu thụ tuần). NO backend changes. **Final Phase 4 sub-phase.**
**Branch:** `phase-4e-dashboard` (off main @ tag `v4-phase-4d`)
**Tag at end:** `v4-phase-4e` + umbrella `v4-phase-4` on the same merge commit

---

## 0. TL;DR

- 5 new feature files + 1 modified file. No backend changes.
- 4-card KPI row (`StatCard` primitive) + 3 list sections.
- All aggregations client-side from existing 4.A query hooks (`useStockBalancesQuery`, `useStockMovementsQuery`).
- Dashboard is read-only for all 3 roles (owner / manager / staff_operator); employee_viewer blocked at InventoryView outer gate.
- `verify:phase` remains 75 Vitest + 89 pgTAP = 164 (no backend changes).
- After merge: place `v4-phase-4e` tag + umbrella `v4-phase-4` tag closing Phase 4.

---

## 1. Goal

Surface inventory health at a glance: what needs attention now (Sắp hết + Âm tồn) and what consumption looks like this week (Top tiêu thụ). All read-only; no actions. Drives owner/manager focus to the right ingredients in the Tồn kho tab where they can act.

---

## 2. Non-goals (specific to 4.E)

- No charts / sparklines (numbers + lists only)
- No cross-feature integration on main DashboardView — defer to Phase 4.+
- No date-range picker (locked to "last 7 days" rolling for consumption widget)
- No drill-down click-through from KPI cards
- No CSV export
- No real-time push (mutation-driven refetch only)
- No backend changes; no new types, data layer, query hooks, or mutation hooks
- No pgTAP additions

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Widget set | **4 KPI cards + 3 lists** (Sắp hết / Âm tồn / Top tiêu thụ) — MVP scope |
| Chart library | **None** — pure stat cards + text lists |
| Cross-feature widget on main DashboardView | **Deferred to Phase 4.+** |
| Time window for consumption | **Last 7 days rolling** (`now - 7 × 24h`); not Monday-to-now |
| Variance / count_correction list | **Deferred** (would be 4th list; MVP keeps 3) |
| Unit display in Top consumption | **Omit unit suffix** — name + magnitude only (mixed units across ingredients) |
| Movement fetch limit | **1000 rows** for last 7 days (covers small/medium shops; documented in §11) |
| Role gating | All 3 roles see the dashboard equally (read-only) |

---

## 4. Architecture

### 4.1 InventoryDashboardTab layout

```
InventoryDashboardTab
├── h2 "Tổng quan kho"
│
├── InventoryKpiRow (grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4)
│   ├── StatCard.mint   "Tổng nguyên liệu"  → activeCount
│   ├── StatCard.peach  "Sắp hết"           → lowStockCount  + subtitle
│   ├── StatCard.lilac  "Tồn âm"            → negativeCount  + subtitle
│   └── StatCard.blue   "Tiêu thụ tuần"     → weeklySaleCount + subtitle
│
├── grid gap-6 lg:grid-cols-2:
│   ├── LowStockList — top 10 by deficit ratio
│   └── NegativeBalanceList — top 10 by most-negative
│
└── TopConsumptionList — top 5 ingredients by abs(sale_theoretical) sum (last 7 days)
```

### 4.2 Data flow

```
InventoryDashboardTab
  ├── useSupabase()
  ├── useStockBalancesQuery(supabase, true)        → balances (4.A; 30s stale)
  ├── useStockMovementsQuery(supabase, {from: 7d, limit: 1000}, true) → weeklyMovements (4.D; 30s stale)
  │
  ├── InventoryKpiRow ({balances, weeklyMovements})
  ├── LowStockList ({balances})
  ├── NegativeBalanceList ({balances})
  └── TopConsumptionList ({weeklyMovements})
```

Loading/error/data branches at the top-level container. All aggregations live in child components via `useMemo`.

### 4.3 Aggregation logic

**KPI row:**
```ts
const activeCount = balances.length;
const lowStockCount = balances.filter(b => b.is_low).length;
const negativeCount = balances.filter(b => b.theoretical_balance < 0).length;
const weeklySaleCount = weeklyMovements.filter(m => m.reason === "sale_theoretical").length;
```

**LowStockList sort** (most depleted first):
```ts
balances
  .filter(b => b.is_low && b.low_stock_threshold !== null)
  .sort((a, b) => {
    const da = (a.low_stock_threshold! - a.theoretical_balance) / Math.max(a.low_stock_threshold!, 1);
    const db = (b.low_stock_threshold! - b.theoretical_balance) / Math.max(b.low_stock_threshold!, 1);
    return db - da;
  })
  .slice(0, 10);
```

**NegativeBalanceList sort** (most negative first):
```ts
balances
  .filter(b => b.theoretical_balance < 0)
  .sort((a, b) => a.theoretical_balance - b.theoretical_balance)
  .slice(0, 10);
```

**TopConsumptionList aggregation** (group by ingredient, sum abs deltas):
```ts
const byIngredient = new Map<string, { name: string; total: number }>();
for (const m of weeklyMovements) {
  if (m.reason !== "sale_theoretical") continue;
  const existing = byIngredient.get(m.ingredient_id);
  if (existing) existing.total += Math.abs(m.quantity_delta);
  else byIngredient.set(m.ingredient_id, { name: m.ingredient_name, total: Math.abs(m.quantity_delta) });
}
return Array.from(byIngredient.entries())
  .map(([id, v]) => ({ ingredient_id: id, name: v.name, total: v.total }))
  .sort((a, b) => b.total - a.total)
  .slice(0, 5);
```

### 4.4 Role gating

| Role | Tab visible | View only |
|------|-------------|-----------|
| owner | ✓ | n/a (no writes) |
| manager | ✓ | n/a |
| staff_operator | ✓ | n/a |
| employee_viewer | blocked by InventoryView outer gate | n/a |

No `canWrite` plumbing needed — the dashboard has zero write controls.

---

## 5. Widget specs

### 5.1 InventoryKpiRow

```tsx
interface InventoryKpiRowProps {
  balances: StockBalance[];
  weeklyMovements: StockMovement[];
}
```

| Card | Color | Title | Value | Subtitle (zero) | Subtitle (non-zero) |
|------|-------|-------|-------|-----------------|---------------------|
| 1 | `mint` | Tổng nguyên liệu | `activeCount` | n/a | `Đang dùng` |
| 2 | `peach` | Sắp hết | `lowStockCount` | `Tất cả đủ` | `Cần đặt thêm` |
| 3 | `lilac` | Tồn âm | `negativeCount` | `Không có` | `Cần kiểm tra` |
| 4 | `blue` | Tiêu thụ tuần | `weeklySaleCount` | `Giao dịch bán (lý thuyết)` | `Giao dịch bán (lý thuyết)` |

No `onAction` (click-through deferred). Layout: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`.

### 5.2 LowStockList

```tsx
interface LowStockListProps { balances: StockBalance[]; }
```

Layout: `<Card>` with header "Sắp hết hàng" + count badge, body shows up to 10 rows or empty muted text "Tất cả nguyên liệu đủ tồn ✓".

Each row:
- Left: Icon.package + ingredient.name
- Right: `{theoretical_balance}/{threshold} {unit}` (mono tabular-nums) + Badge.warning "Sắp hết"

### 5.3 NegativeBalanceList

```tsx
interface NegativeBalanceListProps { balances: StockBalance[]; }
```

Layout: `<Card>` with header "Tồn âm — cần kiểm tra" + count badge, body shows up to 10 rows or empty muted text "Không có nguyên liệu nào âm ✓".

Each row:
- Left: Icon.package + ingredient.name
- Right: `{theoretical_balance} {unit}` (mono tabular-nums, red text) + Badge.danger "Âm {abs(balance)} {unit}"

### 5.4 TopConsumptionList

```tsx
interface TopConsumptionListProps { weeklyMovements: StockMovement[]; }
```

Layout: `<Card>` with header "Top tiêu thụ tuần này", body shows up to 5 rows or `<EmptyState dashedBorder>` "Chưa có bán hàng trong tuần — chưa có dữ liệu tiêu thụ."

Each row:
- Left: Rank badge `#1` / `#2` / ... + ingredient.name
- Right: `{total}` (mono tabular-nums; NO unit suffix — mixed units across ingredients)

### 5.5 InventoryDashboardTab — container

```tsx
"use client";

import { useMemo } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useStockBalancesQuery,
  useStockMovementsQuery,
} from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { InventoryKpiRow } from "./inventory-kpi-row";
import { LowStockList } from "./low-stock-list";
import { NegativeBalanceList } from "./negative-balance-list";
import { TopConsumptionList } from "./top-consumption-list";

export function InventoryDashboardTab() {
  const supabase = useSupabase();
  const balancesQuery = useStockBalancesQuery(supabase, true);

  const weekAgoISO = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }, []);

  const movementsQuery = useStockMovementsQuery(
    supabase,
    { from: weekAgoISO, limit: 1000 },
    true
  );

  const balances = balancesQuery.data ?? [];
  const weeklyMovements = movementsQuery.data ?? [];

  if (balancesQuery.isLoading || movementsQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }
  if (balancesQuery.isError || movementsQuery.isError) {
    return (
      <AlertBanner variant="danger">
        Không tải được tổng quan kho. Vui lòng tải lại trang.
      </AlertBanner>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-base font-medium text-ink">Tổng quan kho</h2>
      <InventoryKpiRow balances={balances} weeklyMovements={weeklyMovements} />
      <div className="grid gap-6 lg:grid-cols-2">
        <LowStockList balances={balances} />
        <NegativeBalanceList balances={balances} />
      </div>
      <TopConsumptionList weeklyMovements={weeklyMovements} />
    </div>
  );
}
```

---

## 6. File manifest

### 6.1 New files (5)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `src/features/inventory/inventory-kpi-row.tsx` | ~110 | 4-card KPI grid |
| `src/features/inventory/low-stock-list.tsx` | ~90 | Sắp hết list with badges |
| `src/features/inventory/negative-balance-list.tsx` | ~80 | Tồn âm list with red badges |
| `src/features/inventory/top-consumption-list.tsx` | ~140 | Top 5 by aggregated abs(sale_theoretical) |
| `src/features/inventory/inventory-dashboard-tab.tsx` | ~80 | Container: queries + composition |

### 6.2 Modified files (1)

| Path | Change |
|------|--------|
| `src/features/inventory/inventory-view.tsx` | Swap Tổng quan tab's `EmptyState` for `<InventoryDashboardTab />` |

### 6.3 Off-limits

- `database/**`, `src/lib/data/**`, `src/lib/types.ts`, `src/hooks/queries/**`, `src/hooks/mutations/**` (no new code in any backend or hooks layer)
- `src/features/dashboard/**` (cross-feature integration deferred)
- Phase 2 primitives in `src/components/ui/*`
- All prior-phase feature modules and other inventory files
- `src/app/page.tsx` (already wires InventoryView)

---

## 7. Vietnamese strings (locked for Phase 4.E)

| Concept | Vietnamese |
|---------|------------|
| Tab label | Tổng quan |
| Page heading | Tổng quan kho |
| KPI 1 title | Tổng nguyên liệu |
| KPI 1 subtitle | Đang dùng |
| KPI 2 title | Sắp hết |
| KPI 2 subtitle (zero) | Tất cả đủ |
| KPI 2 subtitle (non-zero) | Cần đặt thêm |
| KPI 3 title | Tồn âm |
| KPI 3 subtitle (zero) | Không có |
| KPI 3 subtitle (non-zero) | Cần kiểm tra |
| KPI 4 title | Tiêu thụ tuần |
| KPI 4 subtitle | Giao dịch bán (lý thuyết) |
| LowStock card header | Sắp hết hàng |
| LowStock badge | Sắp hết |
| LowStock empty | Tất cả nguyên liệu đủ tồn ✓ |
| Negative card header | Tồn âm — cần kiểm tra |
| Negative badge | Âm {N} {unit} |
| Negative empty | Không có nguyên liệu nào âm ✓ |
| TopConsumption header | Top tiêu thụ tuần này |
| TopConsumption empty | Chưa có bán hàng trong tuần — chưa có dữ liệu tiêu thụ. |
| Rank prefix | # |
| Error banner | Không tải được tổng quan kho. Vui lòng tải lại trang. |

---

## 8. Error handling

| Source | Behavior |
|--------|----------|
| `useStockBalancesQuery` OR `useStockMovementsQuery` error | Top-level AlertBanner.danger "Không tải được tổng quan kho. Vui lòng tải lại trang." (single banner; either query failure stops the dashboard) |
| Empty store (`balances.length === 0`) | All KPIs show 0; all lists show their respective empty states. No special "first-time setup" CTA. |

---

## 9. Risk register

(Full version in brainstorming Section 3.)

Key risks:
- `limit: 1000` may miss data on very busy shops → acceptable for MVP, documented
- Mixed units in Top consumption → omit unit suffix, name + magnitude is the signal
- "Last 7 days rolling" not Monday-to-now → explicit decision, simpler implementation
- Cache reuse: dashboard's `{from: 7d, limit: 1000}` is a different key than StockTab's `{dateRange: today}` — no collision

---

## 10. Implementation strategy (task projection)

4 tasks projected for `superpowers:writing-plans`:

1. **T1** — `InventoryKpiRow` + `LowStockList` + `NegativeBalanceList` (3 sibling display components)
2. **T2** — `TopConsumptionList` (with Map-based aggregation + ranking)
3. **T3** — `InventoryDashboardTab` (container; both queries; loading/error/data branches)
4. **T4** — Wire into `InventoryView` + final `verify:phase` + tag `v4-phase-4e` + place umbrella `v4-phase-4` tag

---

## 11. Success criteria

1. ✅ `npm run verify:phase` still 75 Vitest + 89 pgTAP = 164 green (no backend changes)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ Owner login → Kho → Tổng quan tab → KPI row + 2 alert lists + Top consumption render
5. ✅ With sample data: low-stock alerts list shows ingredients where `is_low === true`, sorted by deficit ratio (most depleted first)
6. ✅ Negative balance list shows ingredients with `theoretical_balance < 0` sorted ascending (most negative first)
7. ✅ Top consumption ranks ingredients by absolute `sale_theoretical` sum over last 7 days (max 5)
8. ✅ Manager + staff_operator: same view (read-only)
9. ✅ employee_viewer: blocked by InventoryView outer gate
10. ✅ Tag `v4-phase-4e` placed on final commit
11. ✅ **Umbrella tag `v4-phase-4` placed on the 4.E merge commit closing Phase 4**

---

## 12. Phase 4 closure plan

After 4.E merges to main:

1. Tag `v4-phase-4e` on the merge commit
2. **Place umbrella tag `v4-phase-4`** on the same merge commit (mirrors `v4-phase-3c` umbrella)
3. The complete Phase 4 inventory module:
   - **4.A** Backend foundation (5 tables, 12 RPCs, auto-deduction trigger, RLS) ✓
   - **4.B** Masters UI (Ingredients + Menu Items CRUD) ✓
   - **4.C** Recipe Builder UI ✓
   - **4.D** Stock counting + ledger UI ✓
   - **4.E** Inventory Dashboard + variance ← closes Phase 4

Tag tree after closure:
```
v4-phase-1, 2, 3a, 3b1, 3b2a, 3b2b-i, 3b2b-ii-a, 3b2b-ii-b
v4-phase-3c1, 3c2, 3c3, 3c (umbrella)
v4-phase-4a, 4b, 4c, 4d, 4e, 4 (umbrella)
```

---

## 13. Open decisions (defer to writing-plans / execution)

- **`StatCard` action handler**: spec leaves `onAction` unused (no click-through). Implementer leaves the prop unset.
- **Empty state icon for TopConsumptionList**: `info` or `barChart`. Implementer picks; `info` is the safe default.
- **Rank badge styling**: `Badge.neutral` with `#{rank}` text, or just plain text. Implementer's call.

---

## 14. Self-review

**Placeholder scan:** No "TBD" or "TODO" in normative sections (§§3–11). §13 explicitly labels open decisions.

**Internal consistency:**
- File count: 5 new + 1 modified (§6.1 + §6.2) ✓
- 4 tasks (§10) ✓
- 4 KPI cards × 3 lists = 7 widgets total ✓
- All aggregation logic in §4.3 traces to widget specs in §5 ✓
- Vietnamese strings (§7) used consistently in widget specs (§5) ✓

**Ambiguity check:**
- "Last 7 days" defined as `now - 7×24h` rolling (§3 + §5.5 init code) — explicit
- `limit: 1000` documented in §9 with rationale — explicit
- "Top 10" for LowStock/Negative, "Top 5" for Consumption — explicit in §4.3
- Empty state per widget — explicit in §5 + §7

**Scope check:** UI-only, no hooks. 4 tasks. Smaller than 4.D (7 tasks); appropriate for closing the phase.

No issues found.

---

## 15. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 4-task implementation plan.
