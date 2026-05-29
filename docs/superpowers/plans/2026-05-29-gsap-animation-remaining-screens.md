# GSAP Animation — 8 Remaining Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the existing reusable GSAP animation layer (`<Reveal>`, `<CountUp>`) to the 8 remaining feature screens — Reports, Inventory, Settings (tabbed) and Cashflow, Cash, Safe, Shifts, Handover (non-tabbed) — consistently with the already-animated Dashboard/Login.

**Architecture:** Reuse the proven primitives only. Tabbed screens wrap each `<TabsContent>` child in `<Reveal duration={DUR.fast}>` (Radix remounts panels → fade on each tab switch). Non-tabbed screens use `<Reveal stagger>` for card/KPI grids, `<CountUp>` for settled numbers, `<Reveal onScroll>` for long lists/tables. Strict UX guardrails (no CountUp on real-time numbers, no stagger on input grids, no `<div>` inside `<table>`).

**Tech Stack:** Next.js 15 / React 19, gsap 3.15 + @gsap/react 2.1, Tailwind v4, Radix Tabs/Dialog, Recharts.

**Spec:** `docs/superpowers/specs/2026-05-29-gsap-animation-remaining-screens-design.md`

---

## Verification approach (read first)

This work is **pure JSX wiring** — wrapping existing components in `<Reveal>`/`<CountUp>` and adding one optional prop. There is **no new pure logic to unit-test**, and the repo deliberately defers component tests to "Phase 6.B" (`vitest.config.mts`: node-only, `*.test.ts` only, `src/components|features|hooks` excluded from coverage). So tasks are **not** TDD RED/GREEN. Each task verifies with:
1. `npm run build` — TypeScript + SSR safety (the gating automated check).
2. `npm run test:run` — existing 141-test suite stays green (run once at the end; pure-lib layer unaffected).
3. Browser spot-check via `npm run dev` (http://localhost:3009) — **requires Supabase login** for these authed screens; do the reachable checks + reduced-motion toggle. If no credentials, the build is the gate.

**Commit checkpoints** are included per task (frequent commits). We are on feature branch `claude/flamboyant-stonebraker-1979f8` (not default) — local commits are fine.

---

## File Structure

**Modify (primitive):**
- `src/components/ui/reveal.tsx` — add optional `duration?: number` prop.

**Modify (wiring, one task each):**
- `src/features/reports/reports-view.tsx` (+ `hourly-kpi-row.tsx`, and `<Reveal onScroll>` around table Cards in the 4 table tabs)
- `src/features/inventory/inventory-view.tsx` (+ `inventory-kpi-row.tsx`, list/table wraps in each tab)
- `src/features/settings/settings-view.tsx` (+ table/list wraps; NO input animation)
- `src/features/cashflow/cash-flow-view.tsx` (+ `cash-flow-kpi-bar.tsx`)
- `src/features/cash/cash-view.tsx` (+ `cash-history-section.tsx`; guardrails)
- `src/features/safe/safe-view.tsx` (+ `safe-balance-card.tsx`)
- `src/features/shifts/shifts-view.tsx` (+ `employee-grid.tsx`, `payroll-history-card.tsx`)
- `src/features/handover/handover-view.tsx` (+ `handover-checklist.tsx`)

**Possibly widen `value` prop to `ReactNode`** (only if currently `string|number`, so it can host `<CountUp>`): `hourly-kpi-row.tsx` (StatTile), `cash-flow-kpi-bar.tsx` (KpiCard). `StatCard` is already `ReactNode` (done last round) → Inventory KPI needs no widening.

**Reusable primitives (import from):** `@/components/ui/reveal`, `@/components/ui/count-up`, `@/lib/gsap` (`DUR`), `@/lib/format` (`formatVND`).

---

## Task 1: Add `duration?` prop to `<Reveal>`

**Files:**
- Modify: `src/components/ui/reveal.tsx`

- [ ] **Step 1: Add the prop to the interface**

In `RevealProps`, add:
```tsx
  /** Override the entrance duration (seconds). Defaults to DUR.base. */
  duration?: number;
```

- [ ] **Step 2: Accept and use it**

Change the signature to destructure `duration`, and in the mount `gsap.from(...)` call replace `duration: DUR.base` with `duration: duration ?? DUR.base`:
```tsx
export function Reveal({ children, className, stagger, onScroll, duration }: RevealProps) {
  // ...
      gsap.from(stagger ? Array.from(el.children) : el, {
        autoAlpha: 0,
        y: 12,
        duration: duration ?? DUR.base,
        stagger: stagger ? STAGGER : 0,
      });
  // ...
}
```
(Leave the `onScroll` branch unchanged — it uses the gsap default duration.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles, type-check passes (no new errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/reveal.tsx
git commit -m "feat(ui): add optional duration prop to <Reveal>"
```

---

## Task 2: Reports — tab panel fades + hourly CountUp + table reveals

**Files:**
- Modify: `src/features/reports/reports-view.tsx`
- Modify: `src/features/reports/hourly-kpi-row.tsx`
- Modify (wrap table Cards): `consumption-report.tsx`, `variance-audit-report.tsx`, `product-summary-table.tsx`, `category-summary-table.tsx`, `expense-by-category-table.tsx`, `payroll-summary-table.tsx` (all under `src/features/reports/`)

- [ ] **Step 1: Wrap each tab panel in a fast Reveal**

In `reports-view.tsx`, import: `import { Reveal } from "@/components/ui/reveal";` and `import { DUR } from "@/lib/gsap";`. Wrap the child inside **each** of the 5 `<TabsContent>` panels:
```tsx
<TabsContent value="cash_close">
  <Reveal duration={DUR.fast}>
    <CashCloseTab /* existing props */ />
  </Reveal>
</TabsContent>
```
Apply identically to all 5 panels (`cash_close`, inventory, sales-by-product, expense-payroll, hourly).

- [ ] **Step 2: CountUp the hourly KPIs**

In `hourly-kpi-row.tsx`, import `CountUp` (`@/components/ui/count-up`) and `formatVND` (`@/lib/format`). If `StatTile`'s `value` prop is typed `string | number`, widen it to `ReactNode` (import `type ReactNode` from "react"). Replace the two numeric displays:
```tsx
// total revenue tile value:
value={<CountUp value={totalRevenue} format={formatVND} />}
// total orders tile value:
value={<CountUp value={totalOrders} format={(n) => n.toLocaleString("vi-VN")} />}
```
Leave `HourlyBarChart` (Recharts) untouched.

- [ ] **Step 3: Scroll-reveal the table Cards (guardrail #3 + #4)**

In each of the 6 table components, wrap the **Card/table block** (NOT the `<tbody>`, NOT the DateRangePicker/toolbar) in `<Reveal onScroll>`. Import `Reveal` in each. Pattern:
```tsx
<Reveal onScroll>
  <Card>{/* the existing table */}</Card>
</Reveal>
```
Do this only around the table/Card, leaving any date-range/search controls outside the Reveal so they stay immediately interactive.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/
git commit -m "feat(reports): tab-panel fade, hourly KPI count-up, table scroll-reveal"
```

---

## Task 3: Inventory — tab panel fades + KPI count-up + list reveals

**Files:**
- Modify: `src/features/inventory/inventory-view.tsx`
- Modify: `src/features/inventory/inventory-kpi-row.tsx`
- Modify (list wraps): `stock-tab.tsx` (StockBalanceList + StockLedgerSection), `ingredients-tab.tsx`, `menu-items-tab.tsx`, `recipes-tab.tsx`, `low-stock-list.tsx`, `negative-balance-list.tsx`, `top-consumption-list.tsx` (under `src/features/inventory/`)

- [ ] **Step 1: Wrap each tab panel in a fast Reveal**

In `inventory-view.tsx`, import `Reveal` + `DUR`. Wrap the child of **each** of the 5 `<TabsContent>` panels (`stock`, `ingredients`, `menu_items`, `recipes`, `dashboard`):
```tsx
<TabsContent value="stock">
  <Reveal duration={DUR.fast}><StockTab /* props */ /></Reveal>
</TabsContent>
```

- [ ] **Step 2: CountUp the 4 inventory KPIs**

In `inventory-kpi-row.tsx`, import `CountUp`. `StatCard.value` is already `ReactNode` (no widening). Replace each of the 4 `value={...}` integers:
```tsx
value={<CountUp value={activeCount} format={(n) => String(n)} />}
// same for lowStockCount, negativeCount, weeklySaleCount
```

- [ ] **Step 3: Scroll-reveal the card lists**

In the card-list components, wrap the list container (`<div className="space-y-2">…cards…</div>`) — NOT the ListToolbar/search — in `<Reveal onScroll>`. Apply to: StockBalanceList, StockLedgerSection, Ingredients list, MenuItems list, Recipes list, LowStockList, NegativeBalanceList, TopConsumptionList. Import `Reveal` per file. Pattern:
```tsx
<Reveal onScroll>
  <div className="space-y-2">{/* existing cards/rows */}</div>
</Reveal>
```
(Do NOT add `<Reveal stagger>` inside tab panels — the panel fade is the entrance, per spec §5.)

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/inventory/
git commit -m "feat(inventory): tab-panel fade, KPI count-up, list scroll-reveal"
```

---

## Task 4: Settings — tab panel fades + table/list reveals (NO input animation)

**Files:**
- Modify: `src/features/settings/settings-view.tsx`
- Modify (table/list wraps only): `accounts-manager-card.tsx`, `signup-requests-card.tsx`, `handover-default-tasks-editor.tsx`, `backup-restore-section.tsx` (HistoryPanel), and the user-override list in `sidebar-config-form.tsx` (under `src/features/settings/`)

- [ ] **Step 1: Wrap both tab panels in a fast Reveal**

In `settings-view.tsx`, import `Reveal` + `DUR`. Wrap the child of both `<TabsContent>` panels (`general`, `backup`):
```tsx
<TabsContent value="general">
  <Reveal duration={DUR.fast}><div className="space-y-6">{/* the 6 cards */}</div></Reveal>
</TabsContent>
```

- [ ] **Step 2: Scroll-reveal tables/lists (guardrail #2 — NO input animation)**

Wrap ONLY these in `<Reveal onScroll>` (import `Reveal` per file):
- `accounts-manager-card.tsx`: the accounts `<table>` (wrap the whole table/Card).
- `signup-requests-card.tsx`: the requests `<table>`.
- `handover-default-tasks-editor.tsx`: the task list `<div className="space-y-2">` (NOT the "add item" input row).
- `sidebar-config-form.tsx`: the per-user override list (NOT the checkbox matrix).
- `backup-restore-section.tsx`: the HistoryPanel `<table>`.

**Do NOT** animate: KiotViet config form, Shift bonus form, the sidebar checkbox matrix (guardrail #2). The panel fade covers their entrance.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/
git commit -m "feat(settings): tab-panel fade + table/list scroll-reveal (forms left static)"
```

---

## Task 5: Cashflow — KPI stagger + count-up + table reveal + lunar widget

**Files:**
- Modify: `src/features/cashflow/cash-flow-view.tsx`
- Modify: `src/features/cashflow/cash-flow-kpi-bar.tsx`
- Modify: `src/features/cashflow/expense-breakdown-table.tsx`, `src/features/cashflow/lunar-calendar-widget.tsx`

- [ ] **Step 1: KPI grid stagger + count-up**

In `cash-flow-kpi-bar.tsx`: import `Reveal`, `CountUp`, `formatVND`. Wrap the 3-card grid (`<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">`) in `<Reveal stagger className="…same grid classes…">` (move the grid classes onto Reveal, like KpiBar did). If `KpiCard.value` is `string|number`, widen to `ReactNode`. Set each card value:
```tsx
value={<CountUp value={in_} format={formatVND} />}   // and out, net
```

- [ ] **Step 2: Table + lunar widget**

- `expense-breakdown-table.tsx`: wrap the table/Card in `<Reveal onScroll>` (keep expand/collapse CSS as-is).
- `lunar-calendar-widget.tsx`: wrap the whole widget in `<Reveal>` (plain fade — NOT `stagger`; 49 cells staggered is too busy, spec §6.4).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/cashflow/
git commit -m "feat(cashflow): KPI stagger+count-up, table scroll-reveal, lunar fade"
```

---

## Task 6: Cash — opening-cash count-up + history reveal (STRICT guardrails)

**Files:**
- Modify: `src/features/cash/cash-view.tsx`
- Modify: `src/features/cash/cash-history-section.tsx`

- [ ] **Step 1: CountUp ONLY the opening-cash number**

In `cash-view.tsx`, import `CountUp` + `formatVND`. Replace the opening-cash display (`formatVND(cashOpening.opening_total)`) with `<CountUp value={cashOpening.opening_total} format={formatVND} />`.

**DO NOT** touch `reconciliation-summary.tsx` or `cash-count-wizard.tsx` totals (`posTotal/physical/difference/todayTotal/nextDayTotal/safeDepositPreview`) — they update in real-time as the user types in the denomination grid; CountUp there would re-animate per keystroke (guardrail #1). **DO NOT** add stagger to `denomination-grid.tsx` (input grid, guardrail #2).

- [ ] **Step 2: Scroll-reveal cash history**

In `cash-history-section.tsx`, wrap the history list container (`<div className="space-y-2">…article rows…</div>`) in `<Reveal onScroll>` (import `Reveal`). Rows are immutable history → safe.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/cash/
git commit -m "feat(cash): opening-cash count-up + history scroll-reveal (real-time totals left static)"
```

---

## Task 7: Safe — balance count-up + history reveal

**Files:**
- Modify: `src/features/safe/safe-balance-card.tsx`
- Modify: `src/features/safe/safe-history-section.tsx`

- [ ] **Step 1: CountUp the balance**

In `safe-balance-card.tsx`, import `CountUp` + `formatVND`. Replace the balance display (`formatVND(balance)`) with `<CountUp value={balance} format={formatVND} />`. (Balance settles after modal close — safe.)

- [ ] **Step 2: Scroll-reveal history**

In `safe-history-section.tsx`, wrap the `<DataTable>` (or its Card) in `<Reveal onScroll>` (import `Reveal`).

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/safe/
git commit -m "feat(safe): balance count-up + history scroll-reveal"
```

---

## Task 8: Shifts — payroll count-up + employee/payroll list stagger

**Files:**
- Modify: `src/features/shifts/payroll-history-card.tsx`
- Modify: `src/features/shifts/employee-grid.tsx`

- [ ] **Step 1: CountUp payroll total**

In `payroll-history-card.tsx`, import `CountUp` + `formatVND`. Replace the payroll total display (`formatVND(total)`) with `<CountUp value={total} format={formatVND} />`.

- [ ] **Step 2: Stagger the lists (mount-only — guardrail #5)**

- `employee-grid.tsx`: wrap each list container (`<div className="space-y-2">…rows…</div>` for active and inactive) in `<Reveal stagger>` (import `Reveal`).
- `payroll-history-card.tsx`: wrap the `<ul>` of payroll rows in `<Reveal stagger>`.

These are non-tab screens so entrance runs once on mount (`useGSAP` no-deps); mutation re-renders won't re-trigger.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/shifts/
git commit -m "feat(shifts): payroll count-up + employee/payroll list stagger"
```

---

## Task 9: Handover — checklist stagger

**Files:**
- Modify: `src/features/handover/handover-checklist.tsx`

- [ ] **Step 1: Stagger the checklist**

In `handover-checklist.tsx`, import `Reveal`. Wrap the task list container (`<div className="space-y-2">…task rows…</div>`) in `<Reveal stagger>`. (No bespoke check-mark animation — primitives only, per decision.)

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: compiles, types pass.

- [ ] **Step 3: Commit**

```bash
git add src/features/handover/
git commit -m "feat(handover): checklist stagger entrance"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm run test:run`
Expected: 141 tests pass (pure-lib layer unaffected by UI wiring).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: compiles, types pass, 7/7 static pages, no new warnings.

- [ ] **Step 3: Browser spot-check (if Supabase login available)**

Run: `npm run dev` → http://localhost:3009 → log in. Verify:
- Reports/Inventory/Settings: switching tabs fades the panel each time.
- Cashflow/Inventory dashboard: KPI numbers count up.
- Long lists/tables (history, reports tables) reveal on scroll.
- **Cash: reconciliation totals do NOT jump/re-animate while typing denominations.**
- Toggle `prefers-reduced-motion: reduce` (DevTools → Rendering, or patch `matchMedia`): animations off, all content visible, no layout break.
- Console clean; ~60fps on tab switches + scroll (chrome-devtools MCP performance trace).

---

## Self-Review (done while writing)

**Spec coverage:** every spec §6 screen maps to a task (Reports→T2, Inventory→T3, Settings→T4, Cashflow→T5, Cash→T6, Safe→T7, Shifts→T8, Handover→T9), the `duration` prop (spec §4)→T1, verification (spec §9)→T10. ✓
**Guardrails:** #1 (no real-time CountUp) enforced in T6; #2 (no input/grid stagger) in T4+T6; #3/#4 (table wrap, not tbody; don't hide controls) in T2/T3/T4; #5 (mount-only) in T8. ✓
**Placeholders:** none — each task names exact files, the wrap construct, imports, and the build/commit commands. Exact surrounding lines are read at execution time (subagent-driven). ✓
**Type consistency:** `<CountUp value:number format:(n)=>string>`, `<Reveal duration={DUR.fast}>`, `DUR.fast` from `@/lib/gsap` — consistent across tasks. `value→ReactNode` widening flagged where needed (StatTile, KpiCard; StatCard already done). ✓
