# Phase 4.E — Inventory Dashboard + Variance UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Inventory Dashboard tab — 4-card KPI row + 3 list widgets (Sắp hết, Tồn âm, Top tiêu thụ tuần) — closing Phase 4. No backend changes.

**Architecture:** Pure UI on top of existing 4.A/4.D query hooks (`useStockBalancesQuery`, `useStockMovementsQuery`). All aggregations client-side via `useMemo`. Reuses existing primitives (`StatCard`, `Card`, `Badge`, `AlertBanner`, `EmptyState`, `Spinner`, `Icon`). No new hooks, types, or mutations.

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict · TanStack Query 5 · Tailwind v4 · Supabase JS · Vietnamese UI labels

---

## Conventions (read before any task)

**Commit messages.** PowerShell here-strings break on Vietnamese diacritics. Use this pattern:

```powershell
$msg = @'
<commit subject>

<body...>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add <files>
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

**Branch state:** `phase-4e-dashboard` is already checked out (off main @ tag `v4-phase-4d`). The design spec is committed at `38b8617`.

**Verify gate baseline:** `npm run verify:phase` must remain 75 Vitest + 89 pgTAP = 164 throughout (no backend changes).

**Existing artifacts:**
- Types from `@/lib/types`: `StockBalance`, `StockMovement`, `UserRole`
- Query hooks from `@/hooks/queries`: `useStockBalancesQuery`, `useStockMovementsQuery`
- Primitives: `StatCard` (with `color: "peach" | "blue" | "mint" | "lilac"`), `Card`, `CardBody`, `Badge`, `AlertBanner`, `EmptyState`, `Spinner`, `Icon`
- `formatUnit` from `@/features/inventory/units` (4.B)

**Umbrella tag placement:** `v4-phase-4e` is placed by T4 on the branch HEAD. The umbrella `v4-phase-4` tag is placed by the **controller after merge to main** (matches the `v4-phase-3c` umbrella pattern). T4 does NOT place the umbrella tag on the branch.

---

## File Structure

| File | Action | Touched in task |
|------|--------|------------------|
| `src/features/inventory/inventory-kpi-row.tsx` | Create | T1 |
| `src/features/inventory/low-stock-list.tsx` | Create | T1 |
| `src/features/inventory/negative-balance-list.tsx` | Create | T1 |
| `src/features/inventory/top-consumption-list.tsx` | Create | T2 |
| `src/features/inventory/inventory-dashboard-tab.tsx` | Create | T3 |
| `src/features/inventory/inventory-view.tsx` | Modify — swap EmptyState placeholder | T4 |

**Off-limits:** `database/**`, `src/lib/data/**`, `src/lib/types.ts`, `src/hooks/queries/**`, `src/hooks/mutations/**`, `src/features/dashboard/**` (cross-feature deferred), Phase 2 primitives (`src/components/ui/*`), other prior-phase feature modules, `src/app/page.tsx`.

---

### Task 1: KPI row + Low-stock + Negative balance lists

**Files:**
- Create: `src/features/inventory/inventory-kpi-row.tsx`
- Create: `src/features/inventory/low-stock-list.tsx`
- Create: `src/features/inventory/negative-balance-list.tsx`

- [ ] **Step 1: Create `inventory-kpi-row.tsx`**

```tsx
"use client";

import { StatCard } from "@/components/ui/stat-card";
import type { StockBalance, StockMovement } from "@/lib/types";

interface InventoryKpiRowProps {
  balances: StockBalance[];
  /** Already filtered to last 7 days by parent. */
  weeklyMovements: StockMovement[];
}

/**
 * Phase 4.E — 4-card KPI row for inventory dashboard.
 *
 * Cards:
 *   1. Tổng nguyên liệu (mint)      → balances.length
 *   2. Sắp hết (peach)              → count where is_low
 *   3. Tồn âm (lilac)               → count where theoretical < 0
 *   4. Tiêu thụ tuần (blue)         → count of sale_theoretical movements
 *
 * Subtitle text adapts to zero vs non-zero state for cards 2 + 3.
 */
export function InventoryKpiRow({
  balances,
  weeklyMovements,
}: InventoryKpiRowProps) {
  const activeCount = balances.length;
  const lowStockCount = balances.filter((b) => b.is_low).length;
  const negativeCount = balances.filter(
    (b) => b.theoretical_balance < 0
  ).length;
  const weeklySaleCount = weeklyMovements.filter(
    (m) => m.reason === "sale_theoretical"
  ).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        color="mint"
        title="Tổng nguyên liệu"
        subtitle="Đang dùng"
        value={activeCount}
      />
      <StatCard
        color="peach"
        title="Sắp hết"
        subtitle={lowStockCount === 0 ? "Tất cả đủ" : "Cần đặt thêm"}
        value={lowStockCount}
      />
      <StatCard
        color="lilac"
        title="Tồn âm"
        subtitle={negativeCount === 0 ? "Không có" : "Cần kiểm tra"}
        value={negativeCount}
      />
      <StatCard
        color="blue"
        title="Tiêu thụ tuần"
        subtitle="Giao dịch bán (lý thuyết)"
        value={weeklySaleCount}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `low-stock-list.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { formatUnit } from "./units";
import type { StockBalance } from "@/lib/types";

interface LowStockListProps {
  balances: StockBalance[];
}

/**
 * Phase 4.E — Sắp hết hàng list.
 *
 * Filters balances where is_low === true AND threshold !== null.
 * Sorts by deficit ratio = (threshold - balance) / threshold descending.
 * Returns top 10.
 */
export function LowStockList({ balances }: LowStockListProps) {
  const lowStock = useMemo(() => {
    return balances
      .filter((b) => b.is_low && b.low_stock_threshold !== null)
      .sort((a, b) => {
        const da =
          (a.low_stock_threshold! - a.theoretical_balance) /
          Math.max(a.low_stock_threshold!, 1);
        const db =
          (b.low_stock_threshold! - b.theoretical_balance) /
          Math.max(b.low_stock_threshold!, 1);
        return db - da;
      })
      .slice(0, 10);
  }, [balances]);

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Sắp hết hàng</h3>
          {lowStock.length > 0 && (
            <Badge variant="soft" semantic="warning">
              {lowStock.length}
            </Badge>
          )}
        </div>

        {lowStock.length === 0 ? (
          <p className="text-sm text-muted">Tất cả nguyên liệu đủ tồn ✓</p>
        ) : (
          <div className="space-y-2">
            {lowStock.map((b) => (
              <div
                key={b.ingredient_id}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="package" size={16} className="text-muted shrink-0" />
                  <p className="text-sm text-ink truncate">{b.name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="text-xs font-mono tabular-nums text-muted">
                    {b.theoretical_balance}/{b.low_stock_threshold}{" "}
                    {formatUnit(b.unit)}
                  </p>
                  <Badge variant="soft" semantic="warning">
                    Sắp hết
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 3: Create `negative-balance-list.tsx`**

```tsx
"use client";

import { useMemo } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { formatUnit } from "./units";
import type { StockBalance } from "@/lib/types";

interface NegativeBalanceListProps {
  balances: StockBalance[];
}

/**
 * Phase 4.E — Tồn âm list.
 *
 * Filters balances where theoretical_balance < 0.
 * Sorts ascending (most negative first). Returns top 10.
 */
export function NegativeBalanceList({ balances }: NegativeBalanceListProps) {
  const negative = useMemo(() => {
    return balances
      .filter((b) => b.theoretical_balance < 0)
      .sort((a, b) => a.theoretical_balance - b.theoretical_balance)
      .slice(0, 10);
  }, [balances]);

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">
            Tồn âm — cần kiểm tra
          </h3>
          {negative.length > 0 && (
            <Badge variant="soft" semantic="danger">
              {negative.length}
            </Badge>
          )}
        </div>

        {negative.length === 0 ? (
          <p className="text-sm text-muted">Không có nguyên liệu nào âm ✓</p>
        ) : (
          <div className="space-y-2">
            {negative.map((b) => (
              <div
                key={b.ingredient_id}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="package" size={16} className="text-muted shrink-0" />
                  <p className="text-sm text-ink truncate">{b.name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="text-xs font-mono tabular-nums text-danger">
                    {b.theoretical_balance} {formatUnit(b.unit)}
                  </p>
                  <Badge variant="soft" semantic="danger">
                    Âm {Math.abs(b.theoretical_balance)} {formatUnit(b.unit)}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. If `StatCard` doesn't accept `value` as `number` (only `string`), wrap with `String(...)`.

- [ ] **Step 5: Commit**

```powershell
$msg = @'
feat(phase-4e): InventoryKpiRow + LowStockList + NegativeBalanceList

Three display components for the inventory dashboard:

InventoryKpiRow: 4-card StatCard grid (mint/peach/lilac/blue)
- Tổng nguyên liệu / Sắp hết / Tồn âm / Tiêu thụ tuần
- Subtitle text adapts to zero vs non-zero for cards 2 + 3

LowStockList: Sắp hết hàng card with up to 10 rows
- Filters balances where is_low === true && threshold !== null
- Sorts by deficit ratio (most depleted first)
- Empty state: "Tất cả nguyên liệu đủ tồn ✓"

NegativeBalanceList: Tồn âm — cần kiểm tra card with up to 10 rows
- Filters balances where theoretical_balance < 0
- Sorts ascending (most negative first)
- Red badge "Âm {abs} {unit}" + red text balance
- Empty state: "Không có nguyên liệu nào âm ✓"

All read-only display; no event handlers. useMemo for derived arrays.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/inventory-kpi-row.tsx src/features/inventory/low-stock-list.tsx src/features/inventory/negative-balance-list.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 2: TopConsumptionList (with aggregation)

**Files:**
- Create: `src/features/inventory/top-consumption-list.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useMemo } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import type { StockMovement } from "@/lib/types";

interface TopConsumptionListProps {
  /** Already filtered to last 7 days by parent. */
  weeklyMovements: StockMovement[];
}

interface AggregatedItem {
  ingredient_id: string;
  name: string;
  total: number;
}

/**
 * Phase 4.E — Top tiêu thụ tuần này list.
 *
 * Aggregation:
 *   1. Filter weeklyMovements where reason === "sale_theoretical"
 *   2. Group by ingredient_id; sum abs(quantity_delta) per group
 *   3. Sort by total descending; take top 5
 *
 * Display: name + magnitude (no unit suffix — mixed units across ingredients;
 * ranking by absolute magnitude is still the meaningful signal).
 */
export function TopConsumptionList({
  weeklyMovements,
}: TopConsumptionListProps) {
  const topConsumption = useMemo<AggregatedItem[]>(() => {
    const byIngredient = new Map<string, { name: string; total: number }>();
    for (const m of weeklyMovements) {
      if (m.reason !== "sale_theoretical") continue;
      const existing = byIngredient.get(m.ingredient_id);
      if (existing) {
        existing.total += Math.abs(m.quantity_delta);
      } else {
        byIngredient.set(m.ingredient_id, {
          name: m.ingredient_name,
          total: Math.abs(m.quantity_delta),
        });
      }
    }
    return Array.from(byIngredient.entries())
      .map(([id, v]) => ({
        ingredient_id: id,
        name: v.name,
        total: v.total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [weeklyMovements]);

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-medium text-ink mb-3">
          Top tiêu thụ tuần này
        </h3>

        {topConsumption.length === 0 ? (
          <EmptyState
            icon="info"
            title="Chưa có bán hàng trong tuần"
            subtitle="Chưa có dữ liệu tiêu thụ để hiển thị."
            dashedBorder
          />
        ) : (
          <div className="space-y-2">
            {topConsumption.map((item, idx) => (
              <div
                key={item.ingredient_id}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="soft" semantic="neutral">
                    #{idx + 1}
                  </Badge>
                  <Icon name="package" size={16} className="text-muted shrink-0" />
                  <p className="text-sm text-ink truncate">{item.name}</p>
                </div>
                <p className="text-sm font-mono tabular-nums text-ink flex-shrink-0">
                  {item.total}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4e): TopConsumptionList with Map-based aggregation

Top 5 ingredients by absolute sale_theoretical consumption over the
last 7 days (parent filters the time window).

Aggregation: Map<ingredient_id, {name, total}> built via single pass.
Sort by total descending; slice top 5.

Display: rank badge "#N" + ingredient name + total magnitude.
NO unit suffix — mixed units across ingredients (kg, ml, each)
would mislead; ranking by magnitude is the signal.

Empty state: EmptyState dashedBorder "Chưa có bán hàng trong tuần".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/top-consumption-list.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 3: InventoryDashboardTab container

**Files:**
- Create: `src/features/inventory/inventory-dashboard-tab.tsx`

- [ ] **Step 1: Create the file**

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

/**
 * Phase 4.E — Inventory dashboard tab container.
 *
 * Fetches:
 *   - useStockBalancesQuery (no filter) — feeds KPI + LowStock + Negative
 *   - useStockMovementsQuery({from: 7d ago, limit: 1000}) — feeds KPI + TopConsumption
 *
 * Loading: top-level Spinner if EITHER query loading.
 * Error: top-level AlertBanner.danger if EITHER query errored.
 * Data: KPI row + 2-column grid (LowStock + Negative) + TopConsumption.
 *
 * All aggregation happens inside child components via useMemo.
 *
 * No write controls; no canWrite plumbing needed.
 */
export function InventoryDashboardTab() {
  const supabase = useSupabase();
  const balancesQuery = useStockBalancesQuery(supabase, true);

  // Last 7 days rolling window (now - 7×24h)
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

      <InventoryKpiRow
        balances={balances}
        weeklyMovements={weeklyMovements}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <LowStockList balances={balances} />
        <NegativeBalanceList balances={balances} />
      </div>

      <TopConsumptionList weeklyMovements={weeklyMovements} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4e): InventoryDashboardTab container

Composes the 4 display components:
- InventoryKpiRow (top)
- 2-column grid: LowStockList + NegativeBalanceList
- TopConsumptionList (bottom)

Fetches via existing 4.A/4.D hooks:
- useStockBalancesQuery (no filter; 30s stale)
- useStockMovementsQuery({from: 7d ago, limit: 1000}; 30s stale)

Last 7 days = now - 7×24h rolling window via useMemo.

Loading: Spinner if either query loading.
Error: AlertBanner.danger if either query errored.

All aggregations live inside child components via useMemo.
No write controls; no canWrite plumbing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/inventory-dashboard-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 4: Wire into InventoryView + verify + tag v4-phase-4e

**Files:**
- Modify: `src/features/inventory/inventory-view.tsx`

- [ ] **Step 1: Modify `src/features/inventory/inventory-view.tsx`**

Read the file. Find the existing imports near the top:

```tsx
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
import { RecipesTab } from "./recipes-tab";
import { StockTab } from "./stock-tab";
```

Add the new import:

```tsx
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
import { RecipesTab } from "./recipes-tab";
import { StockTab } from "./stock-tab";
import { InventoryDashboardTab } from "./inventory-dashboard-tab";
```

Then find the existing `<TabsContent value="dashboard">` placeholder block:

```tsx
        <TabsContent value="dashboard">
          <EmptyState
            icon="barChart3"
            title="Tổng quan kho"
            subtitle="Phát hành trong giai đoạn 4.E — cảnh báo sắp hết, chênh lệch lý thuyết-thực tế, tiêu thụ theo thời gian."
            dashedBorder
          />
        </TabsContent>
```

Replace with:

```tsx
        <TabsContent value="dashboard">
          <InventoryDashboardTab />
        </TabsContent>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. If `EmptyState` import in `inventory-view.tsx` is no longer used after the swap (since the dashboard tab was the last placeholder using it), remove the import.

Check the file's other TabsContent blocks first — if any other tab still uses `EmptyState`, keep the import. The current state has Recipes / Stock / Dashboard tabs filled (4.C/4.D/4.E) AND has the `employee_viewer` defense gate that uses `EmptyState.lock`. So `EmptyState` IS still needed for the role gate. Keep the import.

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | Select-Object -Last 30`
Expected: build succeeds.

- [ ] **Step 4: Final verify:phase**

Run: `npm run verify:phase`
Expected: `Vitest 75/75 + pgTAP 89/89 = 164 total`, exit 0.

- [ ] **Step 5: Verify file manifest**

Run: `git diff main..HEAD --name-only`
Expected exactly these 7 files:
- `docs/superpowers/specs/2026-05-22-v4-phase-4e-dashboard-design.md`
- `docs/superpowers/plans/2026-05-22-v4-phase-4e-dashboard.md`
- `src/features/inventory/inventory-kpi-row.tsx`
- `src/features/inventory/low-stock-list.tsx`
- `src/features/inventory/negative-balance-list.tsx`
- `src/features/inventory/top-consumption-list.tsx`
- `src/features/inventory/inventory-dashboard-tab.tsx`
- `src/features/inventory/inventory-view.tsx` (modified)

If any off-limits file appears, STOP and revert.

- [ ] **Step 6: Commit InventoryView wire**

```powershell
$msg = @'
feat(phase-4e): wire InventoryDashboardTab into InventoryView + tag v4-phase-4e

Swap the Tổng quan tab's EmptyState placeholder for <InventoryDashboardTab />.
Import InventoryDashboardTab from ./inventory-dashboard-tab.

After this, the Tổng quan tab is fully functional:
- 4 KPI cards (Tổng nguyên liệu / Sắp hết / Tồn âm / Tiêu thụ tuần)
- LowStockList + NegativeBalanceList (2-column grid)
- TopConsumptionList (top 5 ingredients last 7 days)

All InventoryView tabs are now live — no placeholders remain.

Final: 75 Vitest + 89 pgTAP = 164 assertions green.

Tag: v4-phase-4e (closes Phase 4.E).
Phase 4 closure: umbrella tag v4-phase-4 will be placed on the merge
commit by the controller after this branch merges to main, mirroring
the v4-phase-3c umbrella pattern.

Phase 4 progress (complete after merge):
  - 4.A Backend (complete)
  - 4.B Masters UI (complete)
  - 4.C Recipes UI (complete)
  - 4.D Stock UI (complete)
  - 4.E Inventory Dashboard (THIS PHASE) — closes Phase 4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/inventory-view.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

- [ ] **Step 7: Place tag (AFTER commit)**

```bash
git tag v4-phase-4e
git tag -f v4-phase-4e HEAD
git show v4-phase-4e --stat --no-patch | Select-Object -First 5
```

Confirm the tag points to the wire commit you just made (`feat(phase-4e): wire InventoryDashboardTab into InventoryView + tag v4-phase-4e`), not an earlier commit.

- [ ] **Step 8: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expected ~6 commits (spec + plan + T1 + T2 + T3 + T4).

Phase 4.E is ready for `superpowers:finishing-a-development-branch` to merge to main. After merge, the controller places the umbrella `v4-phase-4` tag on the merge commit.

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Covered by | Status |
|--------------|-----------|--------|
| §0 TL;DR (5 new + 1 modified) | All tasks | ✓ |
| §1 Goal (read-only inventory health) | T1+T2+T3 (display components) | ✓ |
| §2 Non-goals (no charts, no cross-feature, no date picker) | All tasks avoid these | ✓ |
| §3 Scope decisions | T1 KPI subtitle adapts, T2 omit units, T3 7-day rolling + 1000 limit | ✓ |
| §4.1 InventoryDashboardTab layout | T3 | ✓ |
| §4.2 Data flow | T3 (both queries + composition) | ✓ |
| §4.3 Aggregation logic | T1 (KPI counts), T1 (LowStock + Negative sorts), T2 (Map-based) | ✓ |
| §4.4 Role gating | No canWrite needed; defense at InventoryView outer gate | ✓ |
| §5.1 InventoryKpiRow spec | T1 | ✓ |
| §5.2 LowStockList spec | T1 | ✓ |
| §5.3 NegativeBalanceList spec | T1 | ✓ |
| §5.4 TopConsumptionList spec | T2 | ✓ |
| §5.5 InventoryDashboardTab container | T3 (full code matches spec) | ✓ |
| §6 File manifest | 5 new (T1×3, T2, T3) + 1 modified (T4) | ✓ |
| §7 Vietnamese strings | All strings used in T1-T3 match the glossary | ✓ |
| §8 Error handling | T3 has top-level AlertBanner.danger; empty states per widget in T1+T2 | ✓ |
| §9 Risks | Addressed inline (limit 1000 doc'd, mixed units doc'd, rolling window doc'd) | ✓ |
| §10 4-task projection | T1-T4 exactly | ✓ |
| §11 Success criteria | T4 verification steps | ✓ |
| §12 Phase 4 closure plan | T4 commit message + Step 7 tag + controller-placed umbrella documented | ✓ |

**2. Placeholder scan:**
- No "TBD" / "TODO" / "implement later" ✓
- Every code step has full TSX code ✓
- Commit messages fully written ✓
- T4 Step 2 note about `EmptyState` import preservation is robust handling, not a placeholder ✓
- Umbrella tag placement explicitly documented as controller's responsibility post-merge ✓

**3. Type consistency:**
- `StockBalance`, `StockMovement`, `UserRole` from `@/lib/types` used identically across T1, T2, T3 ✓
- `InventoryKpiRowProps`, `LowStockListProps`, `NegativeBalanceListProps`, `TopConsumptionListProps` defined in their respective tasks; consumed by T3 ✓
- `useStockBalancesQuery`, `useStockMovementsQuery` from `@/hooks/queries` (4.A/4.D) — used in T3 ✓
- `formatUnit` from `@/features/inventory/units` (4.B) — used in T1 LowStock + Negative ✓
- `StatCard` color prop values (`"mint"`, `"peach"`, `"lilac"`, `"blue"`) match the verified type `PastelColor` ✓
- `Badge` semantic values (`"success"`, `"neutral"`, `"warning"`, `"danger"`) used per established convention ✓

No issues found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-v4-phase-4e-dashboard.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh implementer subagent per task, combined spec+quality review, final opus overall review. Matches the proven pattern that successfully shipped 4.A, 4.B, 4.C, and 4.D.

**2. Inline Execution** — execute tasks directly in this session using `superpowers:executing-plans`.

Which approach?
