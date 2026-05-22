# Phase 5 — Analytics + Reports (Overall Design)

**Status:** Approved 2026-05-22. Covers Phase 5 strategy, sub-phase manifest, ReportsView refactor pattern, and risk register. Each sub-phase (5.A–5.D) gets its own focused spec + plan + execute cycle.

---

## 0. TL;DR

Phase 5 adds **new reports** on top of the existing parity reports (cash close + pivot + dashboard) that already work in v4. Priority: exploit Phase 4's unused `stock_movements` data first; then port v3's hidden DB views; then add date-range reports; then intraday trends.

Decomposed into 4 sub-phases:
- **5.A** Inventory analytics (consumption + variance reports)
- **5.B** Sales by product/category (port v3's hidden DB views to UI)
- **5.C** Expense + payroll date-range reports
- **5.D** Hourly / intraday trends

Food cost foundations (`unit_cost` on ingredients + recipe costing) deferred to Phase 5.+ — requires schema change.

After 5.D merges → umbrella `v4-phase-5` tag on the final merge commit.

---

## 1. Goal

Surface analytics that bridge raw transactional data (sales, expenses, stock_movements, payroll) into actionable insights for owner/manager decision-making. Specifically:

1. Make Phase 4 inventory data **readable** (currently has zero report paths beyond per-row balances)
2. Expose v3's **hidden DB views** that have data but no UI
3. Enable **multi-day reporting** (current RPCs are single-day only)
4. Surface **intraday patterns** (peak hours, slow days)

---

## 2. Non-goals (entire Phase 5)

| Item | Why deferred | Future phase |
|------|--------------|--------------|
| Food cost / COGS reports | Requires schema change (`ingredients.unit_cost`) + cost-tracking discipline | Phase 5.E or later |
| Materialized views for hot reports | Coffee shop scale doesn't need it; recompute is cheap | Phase 6+ if perf issues |
| Real-time WebSocket dashboards | No infra; current refetch-on-mutation is sufficient | Phase 7+ |
| CSV / Excel / PDF export beyond cash close | Cash close uses html-to-image JPEG; sufficient for now | Phase 5.+ |
| Custom date-range picker UI | Locked presets (today / week / month / custom) provide 95% of value | Phase 5.+ |
| Cross-business comparison reports | Single-business scope locked | Phase 7+ |
| Owner-defined custom queries | Out of scope; would require a SQL builder | Never (security) |

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Priority order | **Inventory analytics first** (highest unrealized value) → product/category → expense date-range → hourly trends |
| Sub-phase count | **4** (5.A–5.D); food cost deferred |
| ReportsView container | **Convert to tab-based** in 5.A (mirrors InventoryView 4.B pattern); existing Cash Close content preserved as first tab |
| New RPCs | **YES** — date-range aggregations need server-side aggregation; client-side aggregation only for single-day or small windows |
| Chart library | **Defer decision to 5.D brainstorm** — likely none (HTML tables for MVP) |
| Export format | **JPEG only** (matches existing cash close pattern); skip CSV/PDF for MVP |
| Date-range presets | **Today / Tuần này / Tháng này / Khoảng tùy chọn** — mirrors 4.D Stock ledger preset model |

---

## 4. Architecture

### 4.1 ReportsView refactor (locked in 5.A)

Current `ReportsView` is a single-page Cash Close report viewer (139 lines). Phase 5.A wraps it in a `<Tabs>` shell:

```
ReportsView (after 5.A merges)
├── Tabs.Root defaultValue="cash_close"
├── Tabs.List
│   ├── Tabs.Trigger "Chốt két"       ← cash_close (existing content preserved)
│   ├── Tabs.Trigger "Tồn kho"        ← 5.A inventory analytics
│   ├── Tabs.Trigger "Doanh số"       ← 5.B sales by product (placeholder until 5.B)
│   ├── Tabs.Trigger "Chi phí + lương" ← 5.C (placeholder until 5.C)
│   └── Tabs.Trigger "Theo giờ"       ← 5.D (placeholder until 5.D)
├── Tabs.Content value="cash_close" → existing ReportList + PrintableReport
├── Tabs.Content value="inventory" → <InventoryAnalyticsTab />
├── Tabs.Content value="sales_product" → EmptyState (5.B placeholder)
├── Tabs.Content value="expense_payroll" → EmptyState (5.C placeholder)
└── Tabs.Content value="hourly" → EmptyState (5.D placeholder)
```

Each subsequent sub-phase fills one placeholder. Same pattern as InventoryView from Phase 4.

### 4.2 Role gating (locked across all 5.x)

| Role | ReportsView nav | Cash Close tab | Inventory + Sales + Expense + Hourly tabs |
|------|-----------------|----------------|--------------------------------------------|
| owner | ✓ | full | full read-only |
| manager | ✓ | full | full read-only |
| staff_operator | ✓ | read-only | read-only |
| employee_viewer | blocked at NAV_ITEMS level | n/a | n/a |

All tabs read-only inside ReportsView. No write controls in any 5.x sub-phase. `canWrite` plumbing not needed.

### 4.3 RPC pattern for date-range reports

All new RPCs in Phase 5 follow this signature pattern:

```sql
create or replace function public.<report_name>(
  p_from date,        -- inclusive start (business_date)
  p_to   date         -- inclusive end (business_date)
) returns table (...)
language sql
stable
security definer
set search_path = public
as $$
  select ... from <table>
  where business_date between p_from and p_to
  group by ...
  order by ...
$$;
```

Notes:
- `business_date` (date type) for filtering — not `purchase_at` (timestamptz) — avoids timezone confusion
- `STABLE` for query caching by PostgREST
- `SECURITY DEFINER` to bypass RLS gracefully (RLS still applies to inputs)
- No `LIMIT` / `OFFSET` (reports return all rows in range; UI paginates client-side if needed)

### 4.4 Common UI patterns across sub-phases

**Date-range picker (lifted into a shared component in 5.A):**
- `DateRangePicker` accepts `value: { from: string, to: string } | { preset: "today" | "week" | "month" }` + `onChange`
- Renders 4 preset buttons (`Hôm nay` / `Tuần này` / `Tháng này` / `Khoảng tùy chọn`)
- "Khoảng tùy chọn" reveals 2 native `<input type="date">` fields

Decision: this lives in `src/features/reports/date-range-picker.tsx` (shared across 5.B/C/D). 5.A doesn't strictly need it (single-week default works) but ships it for the rest.

**Table component:**
- Reuse `DataTable` primitive (already exists, used in `safe-history-section.tsx` from 3C.1)
- For aggregated reports: row-grouping done in RPC, UI just renders flat rows

**Empty / loading / error patterns:**
- Spinner during initial load
- AlertBanner.danger on query error
- EmptyState (dashedBorder) when range has no data

---

## 5. Sub-phase manifest

### 5.1 Phase 5.A — Inventory analytics

**Goal:** Surface stock consumption + count_correction variance over date ranges. First read paths for Phase 4's `stock_movements` data.

**New RPCs:**
- `inventory_consumption_by_ingredient(p_from, p_to)` → SETOF (ingredient_id, name, unit, total_consumed, sale_count)
- `inventory_variance_audit(p_from, p_to)` → SETOF (movement_id, ingredient_name, occurred_at, quantity_delta, notes, created_by_name)

**New files:**
- `src/features/reports/inventory-analytics-tab.tsx`
- `src/features/reports/consumption-report.tsx`
- `src/features/reports/variance-audit-report.tsx`
- `src/features/reports/date-range-picker.tsx` (shared)
- `src/hooks/queries/use-inventory-reports-query.ts` (3 hooks)
- Modify: `src/features/reports/reports-view.tsx` (refactor to tabs)

**Estimated tasks:** 6–8.

### 5.2 Phase 5.B — Sales by product / category

**Goal:** Port v3's hidden `daily_product_summary_view` to a real UI report. Show sales by product + by category over date range.

**New RPCs:**
- `sales_product_summary(p_from, p_to)` → SETOF (product_code, product_name, category_name, total_quantity, total_revenue, order_count)
- `sales_category_summary(p_from, p_to)` → SETOF (category_name, total_quantity, total_revenue, order_count)

**New files:**
- `src/features/reports/sales-by-product-tab.tsx`
- `src/features/reports/product-summary-table.tsx`
- `src/features/reports/category-summary-table.tsx`
- `src/hooks/queries/use-sales-reports-query.ts`

**Estimated tasks:** 5–7.

### 5.3 Phase 5.C — Expense + payroll date-range

**Goal:** Multi-day expense breakdown by category + payroll summary by employee.

**New RPCs:**
- `expense_summary_by_category(p_from, p_to)` → SETOF (category_id, category_name, total_amount, expense_count)
- `payroll_summary_by_employee(p_from, p_to)` → SETOF (employee_id, employee_name, total_pay, payment_count, payment_methods_json)

**New files:**
- `src/features/reports/expense-payroll-tab.tsx`
- `src/features/reports/expense-by-category-table.tsx`
- `src/features/reports/payroll-summary-table.tsx`
- `src/hooks/queries/use-expense-payroll-reports-query.ts`

**Estimated tasks:** 5–6.

### 5.4 Phase 5.D — Hourly / intraday trends

**Goal:** Sales by hour-of-day over date range. Shows peak hours visually.

**New RPCs:**
- `sales_hourly_summary(p_from, p_to)` → SETOF (sale_hour int 0-23, total_quantity, total_revenue, order_count)

**New files:**
- `src/features/reports/hourly-trends-tab.tsx`
- `src/features/reports/hourly-bar-chart.tsx` (or HTML table if no chart lib)
- `src/hooks/queries/use-hourly-reports-query.ts`

**Estimated tasks:** 4–5. Chart library decision (Recharts vs SVG vs HTML table) deferred to 5.D brainstorm.

---

## 6. Vietnamese terminology (locked for all of Phase 5)

| English | Vietnamese |
|---------|------------|
| Report | Báo cáo |
| Analytics | Phân tích |
| Date range | Khoảng thời gian |
| From / To | Từ / Đến |
| Today | Hôm nay |
| This week | Tuần này |
| This month | Tháng này |
| Custom range | Khoảng tùy chọn |
| Consumption | Tiêu thụ |
| Variance | Chênh lệch |
| Audit | Lịch sử kiểm |
| Total | Tổng |
| Quantity | Số lượng |
| Revenue | Doanh thu |
| Product | Sản phẩm |
| Category | Danh mục |
| Hour | Giờ |
| Peak hour | Giờ cao điểm |
| Employee | Nhân viên |
| Pay | Lương |
| Cash close | Chốt két |
| Inventory | Tồn kho |
| Sales | Doanh số |
| Expense | Chi phí |

UI labels in 5.A–5.D must use these terms verbatim.

---

## 7. Risk register (entire Phase 5)

| Risk | Mitigation |
|------|------------|
| ReportsView refactor breaks existing Cash Close UX | 5.A wraps existing content in `<Tabs>` without touching the cash close logic. Manual smoke test required before merge. |
| New RPCs need pgTAP coverage | Each sub-phase adds ~5–10 new assertions. Target after Phase 5: ~110–130 pgTAP. |
| Date-range queries scale on busy shops | Coffee shop scale (~500–3000 movements/month) doesn't need materialized views. Server-side aggregation with existing indexes is fine. Document in spec; revisit in Phase 6 if real-world data proves otherwise. |
| Existing `business_date` filter assumption | All RPCs use `business_date` (date) not `purchase_at` (timestamptz). Avoids timezone confusion. UI shows dates in local Vietnam time but stores ISO. Same convention as 4.D Stock ledger. |
| Charts in 5.D | Decision deferred to 5.D brainstorm. HTML table fallback always works. Chart library adds ~50KB bundle. |
| Cross-sub-phase consistency | All sub-phases share `DateRangePicker` (5.A introduces it), date-range RPC signature pattern, and Vietnamese glossary. Locked here. |
| 5.A adds new tab pattern in ReportsView | Tabs primitive (`@/components/ui/tabs`) already proven in 4.B/C/D/E. No new infrastructure. |

---

## 8. Process for each sub-phase

Each sub-phase 5.A–5.D follows the established cadence:

1. `superpowers:brainstorming` to refine sub-phase scope
2. Spec written + committed to `docs/superpowers/specs/<date>-v4-phase-5X-<topic>-design.md`
3. User reviews spec
4. `superpowers:writing-plans` to draft implementation plan with full code per task
5. Plan written + committed to `docs/superpowers/plans/<date>-v4-phase-5X-<topic>.md`
6. User chooses execution mode (subagent-driven recommended)
7. `superpowers:subagent-driven-development` executes task-by-task with per-task spec + code quality reviews
8. Final overall opus review
9. `superpowers:finishing-a-development-branch` merges + tags (`v4-phase-5a`, `v4-phase-5b`, ...)

After 5.D merges, controller places umbrella `v4-phase-5` tag on the merge commit closing Phase 5.

---

## 9. Open decisions for Phase 5.A brainstorming

These are deferred to the focused 5.A brainstorm:

- **Exact RPC return shapes** (e.g., should consumption return rolled-up by-day breakdown, or just total per ingredient?)
- **DateRangePicker UI details** (preset chips vs Select dropdown; custom date picker library or native HTML)
- **Whether 5.A includes the "Sản phẩm sử dụng nhiều nhất" cross-tab (drill down by recipe)** — maybe a 3rd report in 5.A
- **Inventory tab default view** — consumption first, or variance first
- **Per-ingredient drill-down** — does clicking a row in consumption report navigate to that ingredient's movement history? (Cross-feature linkage)

---

## 10. Self-review

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in normative sections (§§1–8). §9 explicitly labels Open decisions for the next brainstorm — appropriate.

**Internal consistency:**
- 4 sub-phases (§3, §5). Consistent.
- ReportsView refactor described in §4.1 matches sub-phase scopes in §5. Consistent.
- Vietnamese terminology (§6) covers all UI strings hinted at in §4 + §5. Consistent.
- RPC pattern (§4.3) referenced by all sub-phases (§5.1–5.4). Consistent.

**Ambiguity check:**
- "Date range" defined explicitly in §4.4 (4 presets + custom).
- "Tab-based ReportsView" defined explicitly in §4.1 with full structure.
- Role gating uniform across all tabs (§4.2). No ambiguity.

**Scope check:** Multi-subsystem but properly decomposed. Each sub-phase produces a separate working report. Each gets its own brainstorm → spec → plan → execute cycle.

No issues found.

---

## 11. Next step

Spec approved → invoke `superpowers:brainstorming` for **Phase 5.A** (Inventory analytics only) to lock the report scope + RPC return shapes before writing the 5.A spec. The overall Phase 5 strategy in this document is the parent contract; each sub-phase brainstorm refines one section of §5.
