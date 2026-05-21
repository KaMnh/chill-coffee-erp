# Phase 4.D — Stock Counting + Ledger UI Design

**Parent:** `docs/superpowers/specs/2026-05-21-v4-phase-4-overall-design.md`
**Predecessors:**
- `docs/superpowers/specs/2026-05-21-v4-phase-4a-backend-design.md` (backend foundation, merged at `v4-phase-4a`)
- `docs/superpowers/specs/2026-05-21-v4-phase-4b-masters-ui-design.md` (Masters UI, merged at `v4-phase-4b`)
- `docs/superpowers/specs/2026-05-22-v4-phase-4c-recipes-ui-design.md` (Recipes UI, merged at `v4-phase-4c`)

**Scope:** Stock counting + movement ledger UI inside the Tồn kho tab of InventoryView. Two stacked sections (Balances + Ledger). Two modals (Count + Movement). 2 mutation hooks + 1 new query hook. Updates `inventory-view.tsx` to swap the placeholder EmptyState for the real StockTab.
**Branch:** `phase-4d-stock-ui` (off main @ tag `v4-phase-4c`)
**Tag at end:** `v4-phase-4d`

---

## 0. TL;DR

- 5 new feature files + 2 new hook files + 2 modified files. No backend changes.
- Top-level toolbar with "+ Kiểm kê" and "+ Nhập xuất" buttons. Both modals contain an ingredient Select (no per-row action buttons in this phase).
- Two stacked sections: Balances (current theoretical) on top, Ledger (paged movement history) below.
- Inline filter bar + "Xem thêm" pagination on the ledger.
- **First tab where staff_operator can write** (record_stock_movement + record_stock_count both gate to `staff_or_above`).
- Live variance display on count modal (no extra confirm dialog).
- Sign normalization on movement modal (user enters positive qty; sign applied by reason).
- `verify:phase` remains 75 Vitest + 89 pgTAP = 164 (no backend changes).

---

## 1. Goal

Owner, manager, and staff_operator can:
1. Record physical stock counts → backend emits a `count_correction` movement with delta = actual − theoretical_before.
2. Record manual stock movements (purchase received, manual adjustments in/out, waste).
3. View current theoretical balances per active ingredient (with low-stock + overdraft signals).
4. View and filter the movement ledger by ingredient, reason, and date preset.

Staff sees the full read+write surface for the first time in Phase 4. The 4.E inventory dashboard (next phase) will build on top of this with cross-ingredient analytics.

---

## 2. Non-goals (specific to 4.D)

- No editing or deleting historical movements (movements are append-only; corrections happen via new counts/movements)
- No bulk count import (manual entry only)
- No ingredient grouping, custom sorting, or virtual scroll (alphabetical sort, default; can revisit if list exceeds 100+ rows)
- No CSV export (deferred to Phase 5)
- No real-time updates via Supabase Realtime (manual refetch on mutation only)
- No notification on low-stock (badges in 4.D; alerts in 4.E dashboard)
- No pgTAP additions (no new RPCs)
- No new TypeScript types (StockMovement, StockBalance, StockMovementReason already in 4.A)

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Tab structure | **Two stacked sections** (Balances on top + Ledger below) — matches RecipesTab pattern |
| Action button placement | **Top-level toolbar only** — both modals contain ingredient Select |
| Ledger filters | **Inline filter bar** (ingredient + reason + date preset) + **"Xem thêm" pagination** |
| Variance confirmation | **Live display, single-click submit** — no extra confirm dialog |
| Count + Movement | **Two separate modals** (matches backend RPC split) |
| Reason filter | **Client-side** (RPC doesn't accept reason param; acceptable for ~50 rows/page) |
| Modal width | `w-[min(95vw, 32rem)]` — same as 4.B form modals |
| Role gating | `canWrite = role !== "employee_viewer"` — broader than 4.B/4.C; first writeable tab for staff |

---

## 4. Architecture

### 4.1 StockTab structure

```
StockTab (role-aware; employee_viewer blocked by InventoryView outer gate)
├── Header row
│   ├── Section title "Tồn kho"
│   └── (canWrite) toolbar
│       ├── "+ Kiểm kê" Button.primary  → opens StockCountModal
│       └── "+ Nhập xuất" Button.secondary → opens StockMovementModal
│
├── Section 1: "Tồn hiện tại"  (renders <StockBalanceList />)
│   ├── (loading) Spinner
│   ├── (error) AlertBanner.danger
│   ├── (empty) EmptyState "Chưa có nguyên liệu nào"
│   └── Card list:
│       Each row:
│       ├── Icon.package + ingredient.name
│       ├── theoretical_balance + unit (tabular-nums)
│       ├── (is_low) Badge.warning "Sắp hết — dưới {threshold}"
│       ├── (theoretical_balance < 0) Badge.danger "Âm"
│       └── (last_movement_at) muted text "Lần cuối: {relative time}"
│
└── Section 2: "Lịch sử nhập xuất"  (renders <StockLedgerSection />)
    ├── Filter bar (horizontal):
    │   ├── Ingredient Select: "Tất cả nguyên liệu" or specific
    │   ├── Reason Select: "Tất cả lý do" or 6 reason options
    │   └── Date range Select: Hôm nay / Tuần này / Tháng này / Tất cả thời gian
    │
    ├── (loading) Spinner
    ├── (error) AlertBanner.danger
    ├── (empty) EmptyState "Chưa có giao dịch nào trong khoảng này"
    └── Ledger card list:
        Each row:
        ├── Reason icon (sign-tinted) + ingredient.name
        ├── signed quantity_delta + unit (color-coded by reason)
        ├── reason label (Vi)
        ├── (source_order_id) Badge "Từ đơn KiotViet"
        ├── occurred_at (relative or absolute) + (created_by ? "bởi {name}" : "(hệ thống)")
        └── notes (truncated to 1 line)

    Below list:
    ├── "Hiển thị {N} / {total}" text
    └── (more rows might exist) "Xem thêm" Button.ghost
```

### 4.2 StockCountModal layout

```
Modal w-[min(95vw, 32rem)]
└── ModalContent
    ├── ModalTitle: "Kiểm kê tồn kho"
    ├── ModalDescription: "Nhập số lượng thực tế từ kiểm đếm. Hệ thống sẽ ghi chênh lệch so với tồn lý thuyết."
    └── form
        ├── Ingredient Select (required; disabled if initialIngredientId provided)
        ├── (selected) Read-only display: "Tồn lý thuyết: {theoretical_before} {unit}"
        ├── Actual quantity TextField (number, min=0)
        ├── (actual valid) Live variance:
        │   ├── delta === 0 → "Đúng số" (success semantic)
        │   ├── delta > 0 → "Thừa {delta} {unit}" (info semantic)
        │   └── delta < 0 → "Thiếu {abs(delta)} {unit}" (warning semantic)
        ├── Notes Textarea (optional, 500 chars)
        └── ModalActions:
            ├── "Hủy" ghost
            └── "Lưu" primary (loading state)
```

### 4.3 StockMovementModal layout

```
Modal w-[min(95vw, 32rem)]
└── ModalContent
    ├── ModalTitle: "Ghi nhập xuất"
    ├── ModalDescription: "Ghi nhận thay đổi tồn kho thủ công (nhập mua, hao hụt, điều chỉnh)."
    └── form
        ├── Ingredient Select (required; disabled if initialIngredientId)
        ├── (selected) Read-only: "Tồn hiện tại: {balance} {unit}"
        ├── Reason Select (required; 4 options with descriptions)
        ├── Quantity TextField (number, min=0; always positive)
        ├── (reason + qty valid) Sign hint: "Sẽ tăng {qty} {unit} vào tồn" or "Sẽ trừ {qty} {unit} khỏi tồn"
        ├── Notes Textarea (optional, helper text for waste/adjustment_out)
        └── ModalActions:
            ├── "Hủy" ghost
            └── "Lưu" primary (loading state)
```

### 4.4 Data flow

```
StockTab
  ├── useSupabase()
  ├── useStockBalancesQuery(supabase, true)    → balances grid (existing, 4.A)
  ├── useIngredientsQuery(supabase, true)      → for ingredient Select dropdowns (existing, 4.A)
  ├── useStockMovementsQuery(supabase, filter, true) ← NEW (T1)
  ├── useRecordStockMovement(supabase)          → toolbar movement action (T1)
  ├── useRecordStockCount(supabase)             → toolbar count action (T1)
  └── Local state:
      ├── countModalOpen: boolean
      ├── movementModalOpen: boolean
      └── filter: LedgerFilter (see §6.1)

StockCountModal / StockMovementModal
  ├── useSupabase()
  ├── (count) useRecordStockCount or (movement) useRecordStockMovement
  └── Local form state (see §5)
```

### 4.5 Mutation invalidation map

| Hook | onSuccess invalidates |
|------|------------------------|
| `useRecordStockMovement` | `queryKeys.stockBalances()` + `queryKeys.stockMovements()` (prefix match — all filter variants) |
| `useRecordStockCount` | `queryKeys.stockBalances()` + `queryKeys.stockMovements()` (prefix match — all filter variants) |

TanStack Query invalidates by prefix matching the queryKey array. `["inventory", "stock_movements"]` matches `["inventory", "stock_movements", { ... }]` so any cached filter variant gets invalidated.

### 4.6 Role gating

| Role | View tab | Toolbar buttons | Filter bar | Ledger view |
|------|----------|------------------|------------|-------------|
| owner | ✓ | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ | ✓ |
| **staff_operator** | ✓ | ✓ | ✓ | ✓ |
| employee_viewer | n/a (InventoryView outer gate blocks) | — | — | — |

`canWrite = role !== "employee_viewer"`. This is the first phase in 4.* where `staff_operator` writes. Defense-in-depth: backend RPCs gate to `staff_or_above`.

---

## 5. Modal specs

### 5.1 StockCountModal

**Props:**

```tsx
interface StockCountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Optional pre-selected ingredient. Null in 4.D; reserved for 4.E dashboard linkage. */
  initialIngredientId?: string | null;
  /** All active ingredients for the Select. */
  ingredients: Ingredient[];
  /** Current balances for showing theoretical_before display. */
  balances: StockBalance[];
}
```

**State:**

```tsx
const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
const [actual, setActual] = useState("");  // string for empty-vs-zero distinction
const [notes, setNotes] = useState("");
```

**Init (`useEffect([open, initialIngredientId])`):**

- On `!open`: do nothing.
- Reset on open: `selectedIngredientId = initialIngredientId ?? null`, `actual = ""`, `notes = ""`.

**Derived:**

```tsx
const selectedBalance = balances.find((b) => b.ingredient_id === selectedIngredientId);
const theoreticalBefore = selectedBalance?.theoretical_balance ?? 0;
const unit = selectedBalance?.unit ?? "";

const actualNum = actual.trim() === "" ? null : Number(actual);
const actualValid = actualNum !== null && !Number.isNaN(actualNum) && actualNum >= 0;
const delta = actualValid && actualNum !== null ? actualNum - theoreticalBefore : null;

const isBusy = recordCountM.isPending;
const canSubmit = selectedIngredientId !== null && actualValid && !isBusy;
```

**Submit:**

```tsx
await recordCountM.mutateAsync({
  ingredient_id: selectedIngredientId,
  actual_quantity: Number(actual),
  notes: notes.trim() === "" ? null : notes.trim(),
});
toast({ semantic: "success", message: "Đã ghi nhận kiểm kê." });
onOpenChange(false);
```

On error: toast.danger with `err.message` verbatim.

### 5.2 StockMovementModal

**Props:**

```tsx
type ManualReason = "purchase_received" | "manual_adjustment_in" | "manual_adjustment_out" | "waste";

interface StockMovementModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialIngredientId?: string | null;
  initialReason?: ManualReason | null;
  ingredients: Ingredient[];
  balances: StockBalance[];
}
```

**Reason options (constant):**

```tsx
const MANUAL_REASON_OPTIONS: ReadonlyArray<{
  value: ManualReason;
  label: string;
  sign: 1 | -1;
  description: string;
}> = [
  {
    value: "purchase_received",
    label: "Nhập mua",
    sign: 1,
    description: "Nhập hàng từ nhà cung cấp",
  },
  {
    value: "manual_adjustment_in",
    label: "Điều chỉnh tăng",
    sign: 1,
    description: "Tăng tồn do nhập sai, tìm thấy hàng dư, v.v.",
  },
  {
    value: "manual_adjustment_out",
    label: "Điều chỉnh giảm",
    sign: -1,
    description: "Giảm tồn do nhập dư, kiểm kê khác, v.v.",
  },
  {
    value: "waste",
    label: "Hao hụt",
    sign: -1,
    description: "Đổ vỡ, hết hạn, chuyển dùng nội bộ, v.v.",
  },
];
```

**State:**

```tsx
const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
const [selectedReason, setSelectedReason] = useState<ManualReason | null>(null);
const [quantity, setQuantity] = useState("");  // string, always positive
const [notes, setNotes] = useState("");
```

**Derived:**

```tsx
const selectedBalance = balances.find((b) => b.ingredient_id === selectedIngredientId);
const currentBalance = selectedBalance?.theoretical_balance ?? 0;
const unit = selectedBalance?.unit ?? "";

const reasonMeta = MANUAL_REASON_OPTIONS.find((r) => r.value === selectedReason);
const sign = reasonMeta?.sign ?? null;

const quantityNum = quantity.trim() === "" ? null : Number(quantity);
const quantityValid = quantityNum !== null && !Number.isNaN(quantityNum) && quantityNum > 0;

const signHint =
  selectedReason && quantityValid && quantityNum !== null
    ? sign === 1
      ? `Sẽ tăng ${quantityNum} ${formatUnit(unit)} vào tồn`
      : `Sẽ trừ ${quantityNum} ${formatUnit(unit)} khỏi tồn`
    : null;

const isBusy = recordMovementM.isPending;
const canSubmit =
  selectedIngredientId !== null && selectedReason !== null && quantityValid && !isBusy;
```

**Submit:**

```tsx
await recordMovementM.mutateAsync({
  ingredient_id: selectedIngredientId,
  quantity_delta: sign * Number(quantity),
  reason: selectedReason,
  notes: notes.trim() === "" ? null : notes.trim(),
});
toast({ semantic: "success", message: "Đã ghi nhận nhập xuất." });
onOpenChange(false);
```

### 5.3 Shared modal conventions

- Init via `useEffect([open, initialIngredientId, ...])` matching established 4.B/4.C pattern
- Modal stays open during in-flight, closes on success, stays open on error
- `Hủy` button has `disabled={isBusy}` and `onClick={() => onOpenChange(false)}`
- Form uses `<form onSubmit={...}>` so Enter key submits
- Errors via toast.danger with `err.message` (Vietnamese, surfaced verbatim from backend)

---

## 6. StockLedgerSection spec

### 6.1 Filter state shape (lives in StockTab, passed as props)

```tsx
type DateRangePreset = "today" | "week" | "month" | "all";

interface LedgerFilter {
  ingredient_id: string | null;
  reason: StockMovementReason | null;
  dateRange: DateRangePreset;
  limit: number;  // default 50, increments by 50 on "Xem thêm"
}
```

### 6.2 RPC filter derivation

```tsx
function buildQueryFilter(filter: LedgerFilter): {
  ingredient_id?: string;
  from?: string;
  to?: string;
  limit?: number;
} {
  const out: { ingredient_id?: string; from?: string; to?: string; limit?: number } = {};
  if (filter.ingredient_id) out.ingredient_id = filter.ingredient_id;
  if (filter.dateRange === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    out.from = today.toISOString();
  } else if (filter.dateRange === "week") {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7;  // 0 = Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek);
    monday.setHours(0, 0, 0, 0);
    out.from = monday.toISOString();
  } else if (filter.dateRange === "month") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    out.from = start.toISOString();
  }
  // "all" → no date filter
  out.limit = filter.limit;
  return out;
}
```

**Reason filter is applied client-side:**

```tsx
const movements = (movementsQuery.data ?? []).filter(
  (m) => filter.reason === null || m.reason === filter.reason
);
```

This is acceptable because:
- Backend doesn't expose reason filter on `list_stock_movements`
- Page size = 50 rows max
- Reason filter is interactive (changes don't trigger network call)

### 6.3 Ledger row layout

```tsx
<Card>
  <CardBody>
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <Icon name={reasonIcon(reason)} size={20} className={reasonColor(reason)} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-ink truncate">{ingredient_name}</p>
            <p className={cn("text-sm font-mono tabular-nums", deltaColor(reason))}>
              {quantity_delta > 0 ? "+" : ""}{quantity_delta} {formatUnit(unit)}
            </p>
            {source_order_id && (
              <Badge variant="soft" semantic="neutral">Từ đơn KiotViet</Badge>
            )}
          </div>
          <p className="text-xs text-muted mt-0.5">
            {reasonLabel(reason)} · {formatRelativeOrAbsolute(occurred_at)}
            {created_by ? ` · bởi: ${creatorName}` : " · (hệ thống)"}
          </p>
          {notes && <p className="text-xs text-muted mt-0.5 truncate">{notes}</p>}
        </div>
      </div>
    </div>
  </CardBody>
</Card>
```

`reasonIcon`, `reasonColor`, `deltaColor`, `reasonLabel`, `formatRelativeOrAbsolute` are inline helpers within `StockLedgerSection`.

**`creatorName` resolution:** `created_by` is a UUID. The `list_stock_movements` RPC doesn't return a joined username. For 4.D we display the UUID truncated or simply "bởi: nhân viên" — we don't add a join for this in 4.D (would require RPC change). The simplest acceptable display: show "bởi: nhân viên" if `created_by !== null`, "(hệ thống)" if null. **Locked decision.**

### 6.4 Pagination — "Xem thêm"

```tsx
function handleLoadMore() {
  setFilter({ ...filter, limit: filter.limit + 50 });
}
```

TanStack Query refetches with the new key (filter object differs by `limit`). No infinite-scroll, no page numbers.

**"Hiển thị" counter:** `"Hiển thị {movements.length} giao dịch"`. We don't know the total count from the RPC (no count column), so we don't display "{N} / {total}" — just the current count. If returned count equals `filter.limit`, show "Xem thêm" button. Otherwise the user has loaded everything.

---

## 7. File manifest

### 7.1 New files (7)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `src/hooks/mutations/use-stock-mutations.ts` | ~80 | `useRecordStockMovement` + `useRecordStockCount` |
| `src/hooks/queries/use-stock-movements-query.ts` | ~30 | `useStockMovementsQuery(supabase, filter, enabled)` with 30s stale time |
| `src/features/inventory/stock-balance-list.tsx` | ~120 | Card list of balances with low-stock/overdraft badges |
| `src/features/inventory/stock-count-modal.tsx` | ~200 | Count modal (ingredient Select + actual qty + live variance) |
| `src/features/inventory/stock-movement-modal.tsx` | ~220 | Movement modal (ingredient + reason + qty + sign hint) |
| `src/features/inventory/stock-ledger-section.tsx` | ~240 | Inline filter bar + ledger card list + "Xem thêm" pagination |
| `src/features/inventory/stock-tab.tsx` | ~180 | Top-level container: toolbar + state + composes both sections + both modals |

### 7.2 Modified files (2)

| Path | Change |
|------|--------|
| `src/features/inventory/inventory-view.tsx` | Swap the Tồn kho tab's `EmptyState` placeholder for `<StockTab role={role} />`; import StockTab |
| `src/hooks/queries/index.ts` | Re-export `useStockMovementsQuery` from `./use-stock-movements-query` |

### 7.3 Off-limits

- `database/**` (no backend changes)
- `src/lib/data/**` (data layer for stock already exported in 4.A)
- `src/lib/types.ts` (StockMovement, StockBalance, StockMovementReason types in 4.A)
- `src/hooks/queries/keys.ts` (queryKeys.stockMovements / queryKeys.stockBalances already in 4.A)
- `src/hooks/queries/use-inventory-queries.ts` (existing hooks unchanged)
- Phase 2 primitives in `src/components/ui/*`
- All prior-phase feature modules and other inventory files (except `inventory-view.tsx`)
- `src/app/page.tsx` (already wires InventoryView)

---

## 8. Mutation hooks + query hook

### 8.1 `use-stock-mutations.ts`

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordStockMovement, recordStockCount } from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";
import type { StockMovementReason } from "@/lib/types";

export interface RecordStockMovementInput {
  ingredient_id: string;
  quantity_delta: number;
  reason: StockMovementReason;
  notes: string | null;
}

export function useRecordStockMovement(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordStockMovementInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return recordStockMovement(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances() });
      queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements() });
    },
  });
}

export interface RecordStockCountInput {
  ingredient_id: string;
  actual_quantity: number;
  notes: string | null;
}

export function useRecordStockCount(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordStockCountInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return recordStockCount(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances() });
      queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements() });
    },
  });
}
```

### 8.2 `use-stock-movements-query.ts`

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStockMovements } from "@/lib/data";
import { queryKeys } from "./keys";

export interface StockMovementsFilter {
  ingredient_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function useStockMovementsQuery(
  supabase: SupabaseClient | null,
  filter: StockMovementsFilter = {},
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.stockMovements(filter),
    queryFn: () => loadStockMovements(supabase!, filter),
    enabled: !!supabase && enabled,
    staleTime: 30_000,
  });
}
```

---

## 9. Vietnamese strings (locked for Phase 4.D)

See Section 3 brainstorming output. Key strings:

- Tab label: `Tồn kho`
- Sections: `Tồn hiện tại`, `Lịch sử nhập xuất`
- Toolbar: `+ Kiểm kê`, `+ Nhập xuất`
- Modal titles: `Kiểm kê tồn kho`, `Ghi nhập xuất`
- Variance labels: `Đúng số` / `Thừa {N}` / `Thiếu {N}`
- Reasons: `Nhập mua` / `Điều chỉnh tăng` / `Điều chỉnh giảm` / `Hao hụt` / `Bán (lý thuyết)` / `Kiểm kê (điều chỉnh)`
- Filters: `Tất cả nguyên liệu`, `Tất cả lý do`, `Hôm nay`, `Tuần này`, `Tháng này`, `Tất cả thời gian`
- Pagination: `Xem thêm`, `Hiển thị {N} giao dịch`
- Empties: `Chưa có nguyên liệu nào`, `Chưa có giao dịch nào trong khoảng này`
- Toasts: `Đã ghi nhận kiểm kê.`, `Đã ghi nhận nhập xuất.`
- Low stock: `Sắp hết — dưới {threshold} {unit}`
- Overdraft: `Âm`
- Source: `Từ đơn KiotViet`
- Author: `bởi: nhân viên` / `(hệ thống)`

(Full glossary in brainstorming output Section 3.)

---

## 10. Error handling

| Source | Behavior |
|--------|----------|
| `useStockBalancesQuery` error | Section 1 shows `AlertBanner.danger` "Không tải được tồn kho. Vui lòng tải lại trang." |
| `useStockMovementsQuery` error | Section 2 shows `AlertBanner.danger` "Không tải được lịch sử. Vui lòng tải lại trang." |
| Mutation errors (count or movement) | toast.danger with `err.message` verbatim (backend returns Vietnamese for known errors) |
| Network down on mutation | toast.danger via mutation catch; modal stays open for retry |

---

## 11. Risk register

See Section 3 brainstorming output. Highlights:

| Risk | Mitigation |
|------|------------|
| Variance display divides by zero | Don't compute percentage — show signed delta in absolute units only |
| Concurrent counts race | Backend handles via `theoretical_before` snapshot per transaction. Last write wins logically. |
| Reason filter applied client-side | Acceptable for 50-row pages; documented limitation |
| `created_by` UUID display | Show "bởi: nhân viên" / "(hệ thống)" — no join needed in 4.D |
| Empty filter returns 10k rows | Default 50 limit prevents accidental over-fetch |
| Negative balance UX | Red "Âm" badge + red text |
| Modal `initialIngredientId` reserved | Both modals accept the prop; T6 doesn't use it (reserved for 4.E dashboard linkage) |
| Filter keystroke re-fetches | Filter changes only on Select changes (no typing); no debounce needed |

---

## 12. Implementation strategy (task projection)

7 tasks projected for `superpowers:writing-plans`:

1. **T1** — `use-stock-mutations.ts` (2 hooks) + `use-stock-movements-query.ts` (1 hook) + barrel re-export
2. **T2** — `StockBalanceList` (display component with low-stock + overdraft badges)
3. **T3** — `StockCountModal` (ingredient Select + actual qty + live variance display)
4. **T4** — `StockMovementModal` (ingredient + reason + qty + sign hint)
5. **T5** — `StockLedgerSection` (filter bar + ledger card list + "Xem thêm" pagination)
6. **T6** — `StockTab` (composes all 4 components + toolbar + filter state + modal state)
7. **T7** — Wire `StockTab` into `InventoryView` + final `verify:phase` + tag `v4-phase-4d`

---

## 13. Success criteria

1. ✅ `npm run verify:phase` still 75 Vitest + 89 pgTAP = 164 green (no backend changes)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ Owner login → Kho → Tồn kho tab → Section 1 (balances) + Section 2 (ledger) render
5. ✅ Click "+ Kiểm kê" → modal → pick ingredient → enter actual → variance shows live → submit → balance updates, count_correction row in ledger
6. ✅ Click "+ Nhập xuất" → modal → pick ingredient + reason + qty → submit → balance + ledger update
7. ✅ Filter ledger by ingredient → only that ingredient's rows show
8. ✅ Filter ledger by reason → reason filtered client-side
9. ✅ Filter ledger by date preset → date range applied
10. ✅ "Xem thêm" → limit increases by 50, more rows load
11. ✅ Manager: same as owner
12. ✅ **Staff_operator: full read + write** (first writeable tab for staff)
13. ✅ Low-stock badge shows on rows where `is_low === true`
14. ✅ Negative balance shows "Âm" badge + red text
15. ✅ Tag `v4-phase-4d` placed on final commit

---

## 14. Open decisions (defer to writing-plans / execution)

- **`createdBy` display refinement**: 4.D shows "bởi: nhân viên" / "(hệ thống)". If a join is desired (e.g., "bởi: Khoa") this requires amending `list_stock_movements` RPC — deferred to a future polish phase.
- **Icon choice for ledger reasons**: implementer picks suitable lucide icons (e.g., `truck` for purchase, `trash` for waste, `refresh` for count_correction). Default to `package` if uncertain.
- **`text-warning` and `text-danger` Tailwind tokens**: confirm they exist in `tailwind.config` or `globals.css`. If not, substitute available semantic colors (e.g., `text-amber-600`).
- **Date preset boundaries**: Vietnamese week starts Monday (per spec §6.2 code). Confirm before implementation.
- **`useStockBalancesQuery` enabled flag**: 4.A query hook accepts `(supabase, enabled = true)`. StockTab passes `true` implicitly.

---

## 15. Self-review

**Placeholder scan:** No "TBD" or "TODO" in normative sections (§§3–13). §14 explicitly labels open decisions.

**Internal consistency:**
- File count: 7 new + 2 modified (§7.1 + §7.2) ✓
- 7 tasks (§12) ✓
- 3 hooks total (2 mutation + 1 query) ✓
- StockCountModal vs StockMovementModal props consistent across §4 + §5 ✓
- Vietnamese strings glossary consistent across §4 + §5 + §6 + §9 ✓
- Mutation invalidation map (§4.5) matches T1 code (§8.1) ✓

**Ambiguity check:**
- Reason filter "client-side" defined as: filter on `m.reason === selected` after RPC returns. Unambiguous.
- "Xem thêm" defined as: increment `filter.limit` by 50, refetch via new queryKey. Unambiguous.
- Variance display "live" defined as: re-computed on every actual input change, no extra submit step. Unambiguous.
- canWrite = `role !== "employee_viewer"` — explicit (broader than 4.B/4.C). Unambiguous.

**Scope check:** UI-only. 7 files new + 2 modified. ~7 tasks for writing-plans. Matches 4.B size; manageable.

No issues found.

---

## 16. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 7-task implementation plan.
