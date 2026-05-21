# Phase 4.D — Stock Counting + Ledger UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Stock counting + ledger UI inside the Tồn kho tab of InventoryView — two stacked sections (Balances + Ledger), two modals (Count + Movement), 2 mutation hooks + 1 new query hook. **First writeable tab for staff_operator.** No backend changes.

**Architecture:** Pure UI on top of 4.A backend RPCs (`record_stock_movement` + `record_stock_count` + `stock_balances_all` + `list_stock_movements`). Reuses 4.B/4.C primitives (Modal, Select, TextField, Textarea, Card, Badge, AlertBanner, EmptyState, Spinner). Live variance computation client-side; sign normalization in movement modal. Inline filter bar + "Xem thêm" pagination for ledger. Each new file <250 lines.

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict · TanStack Query 5 · Radix UI · Tailwind v4 · Supabase JS · Vietnamese UI labels

---

## Conventions (read before any task)

**Commit messages.** PowerShell here-strings break on Vietnamese diacritics. Use this pattern every time:

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

**Branch state at start:** `phase-4d-stock-ui` is already checked out (off main @ tag `v4-phase-4c`). The design spec is committed at `f91a7e0`.

**Verify gate baseline:** `npm run verify:phase` must remain 75 Vitest + 89 pgTAP = 164 throughout (no backend changes).

**Existing 4.A artifacts:**
- Data layer (from `@/lib/data`): `recordStockMovement`, `recordStockCount`, `loadStockMovements`, `loadStockBalancesAll`
- Types (from `@/lib/types`): `StockMovement`, `StockBalance`, `StockMovementReason`, `Ingredient`, `UserRole`
- Query keys (from `@/hooks/queries/keys`): `queryKeys.stockBalances()`, `queryKeys.stockMovements(filter?)`, `queryKeys.ingredients()`
- Query hook (from `@/hooks/queries`): `useStockBalancesQuery`, `useIngredientsQuery`

**Existing 4.B artifacts:**
- `formatUnit` from `@/features/inventory/units`

**Primitive APIs (verified 4.B/4.C):**
- `Modal`, `ModalContent`, `ModalTitle`, `ModalDescription`, `ModalActions` from `@/components/ui/modal`
- `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` from `@/components/ui/select`
- `TextField` accepts `label`, `helper`, `error` + input props
- `Textarea` accepts `value`, `onChange`, `disabled`, `rows`, `maxLength`, `placeholder`, `helper`, `error`
- `Card`, `CardBody`
- `Badge` accepts `variant: "soft"`, `semantic: "success" | "neutral" | "warning" | "danger" | "info"`
- `Button` accepts `variant`, `loading`, `disabled`, `size?: "sm"`, `leadingIcon?`
- `AlertBanner` accepts `variant`
- `EmptyState` accepts `icon`, `title`, `subtitle`, `dashedBorder?`
- `Spinner` accepts `size`
- `Icon` accepts `name`, `size`, `className`

---

## File Structure

| File | Action | Touched in task |
|------|--------|------------------|
| `src/hooks/mutations/use-stock-mutations.ts` | Create — 2 mutation hooks | T1 |
| `src/hooks/queries/use-stock-movements-query.ts` | Create — 1 query hook | T1 |
| `src/hooks/queries/index.ts` | Modify — re-export new hook | T1 |
| `src/features/inventory/stock-balance-list.tsx` | Create — Balances grid | T2 |
| `src/features/inventory/stock-count-modal.tsx` | Create — Count modal | T3 |
| `src/features/inventory/stock-movement-modal.tsx` | Create — Movement modal | T4 |
| `src/features/inventory/stock-ledger-section.tsx` | Create — Ledger with filters | T5 |
| `src/features/inventory/stock-tab.tsx` | Create — Top-level container | T6 |
| `src/features/inventory/inventory-view.tsx` | Modify — swap EmptyState for StockTab | T7 |

**Off-limits:** `database/**`, `src/lib/data/**`, `src/lib/types.ts`, `src/hooks/queries/keys.ts`, `src/hooks/queries/use-inventory-queries.ts`, Phase 2 primitives (`src/components/ui/*`), all prior-phase feature modules, `src/app/page.tsx`.

---

### Task 1: Mutation hooks + Query hook

**Files:**
- Create: `src/hooks/mutations/use-stock-mutations.ts`
- Create: `src/hooks/queries/use-stock-movements-query.ts`
- Modify: `src/hooks/queries/index.ts`

- [ ] **Step 1: Create `src/hooks/mutations/use-stock-mutations.ts`**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordStockMovement, recordStockCount } from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";
import type { StockMovementReason } from "@/lib/types";

/**
 * Mutation hooks for Phase 4.D Stock UI.
 *
 * Both hooks invalidate stockBalances() + stockMovements() on success.
 * TanStack Query prefix-matches the queryKey array, so invalidating
 * `["inventory", "stock_movements"]` invalidates every cached filter
 * variant `["inventory", "stock_movements", { ... }]`.
 *
 * Backend RPCs gate to staff_or_above (owner+manager+staff_operator).
 * Defense-in-depth: this is the first phase 4 module where staff writes.
 */

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

- [ ] **Step 2: Create `src/hooks/queries/use-stock-movements-query.ts`**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStockMovements } from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 4.D — Stock movements ledger query.
 *
 * Filter object reaches the RPC via the data-layer wrapper.
 * Reason filter is NOT included here — applied client-side in
 * StockLedgerSection because the RPC doesn't accept a reason param.
 *
 * staleTime: 30s — moves with sales ingest + manual entries.
 */

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

- [ ] **Step 3: Re-export from `src/hooks/queries/index.ts`**

Read the current file. At end of file, append:

```ts
export * from "./use-stock-movements-query";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Smoke verify:phase**

Run: `npm run verify:phase`
Expected: 75 Vitest + 89 pgTAP = 164 green. No regressions.

- [ ] **Step 6: Commit**

```powershell
$msg = @'
feat(phase-4d): stock mutation hooks + ledger query hook

src/hooks/mutations/use-stock-mutations.ts:
- useRecordStockMovement (staff+; null-supabase guard)
- useRecordStockCount (staff+; null-supabase guard)
- Both invalidate stockBalances() + stockMovements() — prefix match
  invalidates all cached filter variants

src/hooks/queries/use-stock-movements-query.ts:
- useStockMovementsQuery(supabase, filter?, enabled?)
- staleTime: 30s (moves with sales ingest + manual entries)
- Reason filter applied client-side (RPC doesn't accept reason param)

src/hooks/queries/index.ts: re-export use-stock-movements-query

verify:phase still 75 Vitest + 89 pgTAP = 164 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/hooks/mutations/use-stock-mutations.ts src/hooks/queries/use-stock-movements-query.ts src/hooks/queries/index.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 2: StockBalanceList

**Files:**
- Create: `src/features/inventory/stock-balance-list.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import { formatUnit } from "./units";
import type { StockBalance } from "@/lib/types";

interface StockBalanceListProps {
  balances: StockBalance[];
  isLoading: boolean;
  isError: boolean;
}

/**
 * Phase 4.D — Stock balance list (display only).
 *
 * Renders one card per active ingredient with:
 *   - Icon + name
 *   - Theoretical balance + unit (large, tabular-nums)
 *   - is_low badge (warning) if backend flag set
 *   - "Âm" badge (danger) if balance < 0 (overdraft signal)
 *   - Last-movement relative time
 *
 * Pure presentation — parent owns the query.
 */
export function StockBalanceList({
  balances,
  isLoading,
  isError,
}: StockBalanceListProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }
  if (isError) {
    return (
      <AlertBanner variant="danger">
        Không tải được tồn kho. Vui lòng tải lại trang.
      </AlertBanner>
    );
  }
  if (balances.length === 0) {
    return (
      <EmptyState
        icon="package"
        title="Chưa có nguyên liệu nào"
        subtitle="Thêm nguyên liệu ở tab Nguyên liệu trước."
        dashedBorder
      />
    );
  }

  return (
    <div className="space-y-2">
      {balances.map((b) => {
        const isNegative = b.theoretical_balance < 0;
        return (
          <Card key={b.ingredient_id}>
            <CardBody>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <Icon
                    name="package"
                    size={20}
                    className="text-muted mt-0.5"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      {b.name}
                    </p>
                    {b.last_movement_at && (
                      <p className="text-xs text-muted mt-0.5">
                        Lần cuối: {formatRelative(b.last_movement_at)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <p
                    className={
                      "text-base font-mono tabular-nums " +
                      (isNegative ? "text-danger" : "text-ink")
                    }
                  >
                    {b.theoretical_balance} {formatUnit(b.unit)}
                  </p>
                  {isNegative && (
                    <Badge variant="soft" semantic="danger">
                      Âm
                    </Badge>
                  )}
                  {b.is_low && b.low_stock_threshold !== null && (
                    <Badge variant="soft" semantic="warning">
                      Sắp hết — dưới {b.low_stock_threshold}{" "}
                      {formatUnit(b.unit)}
                    </Badge>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Format a timestamp as Vietnamese relative time.
 * "hôm nay HH:MM" for today, "hôm qua" for yesterday,
 * "{N} ngày trước" for older within a week, else absolute date.
 */
function formatRelative(iso: string): string {
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
  if (isYesterday) return "hôm qua";

  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays > 0 && diffDays <= 7) return `${diffDays} ngày trước`;

  const dd = String(then.getDate()).padStart(2, "0");
  const mo = String(then.getMonth() + 1).padStart(2, "0");
  const yyyy = then.getFullYear();
  return `${dd}/${mo}/${yyyy}`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4d): StockBalanceList display component

Pure presentation component (parent owns the query).
Renders one card per ingredient:
- Icon + name + last-movement relative time
- Theoretical balance + unit (mono tabular-nums)
- "Âm" badge.danger when balance < 0 (overdraft signal)
- "Sắp hết — dưới X unit" badge.warning when is_low === true

Loading / Error / Empty / Data branches.

Inline formatRelative() helper produces Vietnamese relative times
("hôm nay HH:MM", "hôm qua", "N ngày trước", absolute date).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/stock-balance-list.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 3: StockCountModal

**Files:**
- Create: `src/features/inventory/stock-count-modal.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useRecordStockCount } from "@/hooks/mutations/use-stock-mutations";
import { formatUnit } from "./units";
import type { Ingredient, StockBalance } from "@/lib/types";

interface StockCountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialIngredientId?: string | null;
  ingredients: Ingredient[];
  balances: StockBalance[];
}

/**
 * Phase 4.D — Stock count modal.
 *
 * Form: ingredient Select + read-only theoretical_before + actual qty
 * + live variance display + notes.
 *
 * Submit: backend (record_stock_count) computes delta = actual −
 * theoretical_before and emits count_correction movement.
 *
 * Live variance display:
 *   - delta === 0 → "Đúng số" (success)
 *   - delta > 0   → "Thừa N unit" (info)
 *   - delta < 0   → "Thiếu N unit" (warning)
 *
 * No extra confirm step — variance is shown live, then user clicks Lưu.
 */
export function StockCountModal({
  open,
  onOpenChange,
  initialIngredientId,
  ingredients,
  balances,
}: StockCountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const recordCountM = useRecordStockCount(supabase);

  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [actual, setActual] = useState("");
  const [notes, setNotes] = useState("");

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setSelectedIngredientId(initialIngredientId ?? null);
    setActual("");
    setNotes("");
  }, [open, initialIngredientId]);

  const selectedBalance = balances.find(
    (b) => b.ingredient_id === selectedIngredientId
  );
  const theoreticalBefore = selectedBalance?.theoretical_balance ?? 0;
  const unit = selectedBalance?.unit ?? "";

  const actualTrimmed = actual.trim();
  const actualNum = actualTrimmed === "" ? null : Number(actualTrimmed);
  const actualValid =
    actualNum !== null && !Number.isNaN(actualNum) && actualNum >= 0;
  const delta =
    actualValid && actualNum !== null ? actualNum - theoreticalBefore : null;

  const isBusy = recordCountM.isPending;
  const canSubmit = selectedIngredientId !== null && actualValid && !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedIngredientId || actualNum === null) return;
    try {
      await recordCountM.mutateAsync({
        ingredient_id: selectedIngredientId,
        actual_quantity: actualNum,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      toast({ semantic: "success", message: "Đã ghi nhận kiểm kê." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message:
          err instanceof Error ? err.message : "Có lỗi khi ghi nhận kiểm kê.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>Kiểm kê tồn kho</ModalTitle>
        <ModalDescription>
          Nhập số lượng thực tế từ kiểm đếm. Hệ thống sẽ ghi chênh lệch so với tồn lý thuyết.
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Ingredient picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">
              Nguyên liệu
            </label>
            <Select
              value={selectedIngredientId ?? undefined}
              onValueChange={(v) => setSelectedIngredientId(v)}
              disabled={isBusy || initialIngredientId != null}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn nguyên liệu..." />
              </SelectTrigger>
              <SelectContent>
                {ingredients.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    Chưa có nguyên liệu
                  </SelectItem>
                ) : (
                  ingredients.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Theoretical balance display */}
          {selectedBalance && (
            <div className="rounded-md border border-border bg-surface-muted p-3">
              <p className="text-xs text-muted">Tồn lý thuyết</p>
              <p className="text-lg font-mono tabular-nums text-ink">
                {theoreticalBefore} {formatUnit(unit)}
              </p>
            </div>
          )}

          {/* Actual quantity */}
          <TextField
            label="Số lượng thực tế"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            disabled={isBusy || selectedIngredientId === null}
            placeholder="0"
            error={
              actualTrimmed !== "" && !actualValid
                ? "Số lượng thực tế không thể âm."
                : undefined
            }
          />

          {/* Live variance */}
          {delta !== null && selectedBalance && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted mb-1">Chênh lệch</p>
              {delta === 0 ? (
                <p className="text-sm font-medium text-success">Đúng số</p>
              ) : delta > 0 ? (
                <p className="text-sm font-medium text-info">
                  Thừa {delta} {formatUnit(unit)}
                </p>
              ) : (
                <p className="text-sm font-medium text-warning">
                  Thiếu {Math.abs(delta)} {formatUnit(unit)}
                </p>
              )}
            </div>
          )}

          {/* Notes */}
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={2}
            maxLength={500}
            placeholder="Ghi chú (tùy chọn) — VD: kiểm cuối ngày, ca sáng..."
            helper="Tùy chọn"
          />

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={!canSubmit}
            >
              Lưu
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

**Note for implementer:** if `text-success`, `text-info`, `text-warning` classes don't exist, substitute with available semantic classes (likely `text-emerald-600`, `text-blue-600`, `text-amber-600`). Check `tailwind.config` or `globals.css`. The AlertBanner / Badge primitives use semantic colors, so they likely exist.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4d): StockCountModal with live variance

Form fields:
- Ingredient Select (disabled when initialIngredientId provided)
- Read-only theoretical balance display (when ingredient selected)
- Actual quantity TextField (number, min=0)
- Live variance display ("Đúng số" / "Thừa N" / "Thiếu N")
- Notes Textarea (optional)

Init via useEffect([open, initialIngredientId]). Single-click submit
calls useRecordStockCount which emits a count_correction movement
with delta = actual - theoretical_before (computed by backend).

Always emits a row even when delta === 0 (audit trail preserved).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/stock-count-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 4: StockMovementModal

**Files:**
- Create: `src/features/inventory/stock-movement-modal.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useRecordStockMovement } from "@/hooks/mutations/use-stock-mutations";
import { formatUnit } from "./units";
import type { Ingredient, StockBalance } from "@/lib/types";

type ManualReason =
  | "purchase_received"
  | "manual_adjustment_in"
  | "manual_adjustment_out"
  | "waste";

interface StockMovementModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialIngredientId?: string | null;
  initialReason?: ManualReason | null;
  ingredients: Ingredient[];
  balances: StockBalance[];
}

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

/**
 * Phase 4.D — Stock movement modal.
 *
 * Form: ingredient Select + reason Select + positive quantity +
 * sign hint preview + notes.
 *
 * Sign normalization: user always enters POSITIVE quantity; sign is
 * applied based on reason on submit (purchase + adjustment_in → +;
 * adjustment_out + waste → −). Backend CHECK constraint
 * stock_movements_sign_matches_reason validates the result.
 */
export function StockMovementModal({
  open,
  onOpenChange,
  initialIngredientId,
  initialReason,
  ingredients,
  balances,
}: StockMovementModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const recordMovementM = useRecordStockMovement(supabase);

  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState<ManualReason | null>(null);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedIngredientId(initialIngredientId ?? null);
    setSelectedReason(initialReason ?? null);
    setQuantity("");
    setNotes("");
  }, [open, initialIngredientId, initialReason]);

  const selectedBalance = balances.find(
    (b) => b.ingredient_id === selectedIngredientId
  );
  const currentBalance = selectedBalance?.theoretical_balance ?? 0;
  const unit = selectedBalance?.unit ?? "";

  const reasonMeta = MANUAL_REASON_OPTIONS.find(
    (r) => r.value === selectedReason
  );
  const sign = reasonMeta?.sign ?? null;

  const quantityTrimmed = quantity.trim();
  const quantityNum = quantityTrimmed === "" ? null : Number(quantityTrimmed);
  const quantityValid =
    quantityNum !== null && !Number.isNaN(quantityNum) && quantityNum > 0;

  const signHint =
    selectedReason !== null && quantityValid && quantityNum !== null && sign !== null
      ? sign === 1
        ? `Sẽ tăng ${quantityNum} ${formatUnit(unit)} vào tồn`
        : `Sẽ trừ ${quantityNum} ${formatUnit(unit)} khỏi tồn`
      : null;

  const isBusy = recordMovementM.isPending;
  const canSubmit =
    selectedIngredientId !== null &&
    selectedReason !== null &&
    quantityValid &&
    !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !canSubmit ||
      !selectedIngredientId ||
      !selectedReason ||
      sign === null ||
      quantityNum === null
    )
      return;

    try {
      await recordMovementM.mutateAsync({
        ingredient_id: selectedIngredientId,
        quantity_delta: sign * quantityNum,
        reason: selectedReason,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      toast({ semantic: "success", message: "Đã ghi nhận nhập xuất." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message:
          err instanceof Error
            ? err.message
            : "Có lỗi khi ghi nhận nhập xuất.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>Ghi nhập xuất</ModalTitle>
        <ModalDescription>
          Ghi nhận thay đổi tồn kho thủ công (nhập mua, hao hụt, điều chỉnh).
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {/* Ingredient picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">
              Nguyên liệu
            </label>
            <Select
              value={selectedIngredientId ?? undefined}
              onValueChange={(v) => setSelectedIngredientId(v)}
              disabled={isBusy || initialIngredientId != null}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn nguyên liệu..." />
              </SelectTrigger>
              <SelectContent>
                {ingredients.length === 0 ? (
                  <SelectItem value="__empty" disabled>
                    Chưa có nguyên liệu
                  </SelectItem>
                ) : (
                  ingredients.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Current balance display */}
          {selectedBalance && (
            <p className="text-xs text-muted">
              Tồn hiện tại:{" "}
              <span className="font-mono tabular-nums">
                {currentBalance} {formatUnit(unit)}
              </span>
            </p>
          )}

          {/* Reason picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">Lý do</label>
            <Select
              value={selectedReason ?? undefined}
              onValueChange={(v) => setSelectedReason(v as ManualReason)}
              disabled={isBusy || initialReason != null}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn lý do..." />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reasonMeta && (
              <p className="text-xs text-muted">{reasonMeta.description}</p>
            )}
          </div>

          {/* Quantity */}
          <TextField
            label="Số lượng"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={isBusy || selectedIngredientId === null}
            placeholder="0"
            helper={signHint ?? undefined}
            error={
              quantityTrimmed !== "" && !quantityValid
                ? "Số lượng phải lớn hơn 0."
                : undefined
            }
          />

          {/* Notes */}
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={2}
            maxLength={500}
            placeholder={
              selectedReason === "waste" ||
              selectedReason === "manual_adjustment_out"
                ? "Ghi chú (khuyến nghị) — VD: đổ vỡ, hết hạn..."
                : "Ghi chú (tùy chọn)"
            }
            helper="Tùy chọn"
          />

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={!canSubmit}
            >
              Lưu
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4d): StockMovementModal with sign normalization

Form fields:
- Ingredient Select (disabled when initialIngredientId provided)
- Current balance display (when ingredient selected)
- Reason Select with 4 options + description helper text:
  - purchase_received (sign +)
  - manual_adjustment_in (sign +)
  - manual_adjustment_out (sign -)
  - waste (sign -)
- Quantity TextField (number, min=0, ALWAYS positive)
- Sign hint preview: "Sẽ tăng N unit vào tồn" / "Sẽ trừ N unit khỏi tồn"
- Notes Textarea (helper text suggests notes for waste/adjustment_out)

Sign normalization on submit: quantity_delta = sign × Number(qty).
Backend CHECK stock_movements_sign_matches_reason validates the result.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/stock-movement-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 5: StockLedgerSection

**Files:**
- Create: `src/features/inventory/stock-ledger-section.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSupabase } from "@/hooks/use-supabase";
import { useStockMovementsQuery } from "@/hooks/queries";
import { formatUnit } from "./units";
import type {
  Ingredient,
  StockMovement,
  StockMovementReason,
} from "@/lib/types";

export type DateRangePreset = "today" | "week" | "month" | "all";

export interface LedgerFilter {
  ingredient_id: string | null;
  reason: StockMovementReason | null;
  dateRange: DateRangePreset;
  limit: number;
}

interface StockLedgerSectionProps {
  filter: LedgerFilter;
  onFilterChange(next: LedgerFilter): void;
  ingredients: Ingredient[];
}

const REASON_OPTIONS: ReadonlyArray<{
  value: StockMovementReason;
  label: string;
}> = [
  { value: "purchase_received", label: "Nhập mua" },
  { value: "sale_theoretical", label: "Bán (lý thuyết)" },
  { value: "manual_adjustment_in", label: "Điều chỉnh tăng" },
  { value: "manual_adjustment_out", label: "Điều chỉnh giảm" },
  { value: "count_correction", label: "Kiểm kê (điều chỉnh)" },
  { value: "waste", label: "Hao hụt" },
];

/**
 * Phase 4.D — Stock ledger section with inline filter bar.
 *
 * Filter bar (horizontal): ingredient + reason + date preset.
 * Filter state owned by parent (StockTab); passed in via props.
 *
 * Reason filter is applied CLIENT-SIDE (RPC doesn't accept reason).
 * Ingredient + date filters go to the RPC via the query hook.
 *
 * Pagination: "Xem thêm" button increments filter.limit by 50.
 * When returned count < filter.limit, no more rows exist → hide button.
 */
export function StockLedgerSection({
  filter,
  onFilterChange,
  ingredients,
}: StockLedgerSectionProps) {
  const supabase = useSupabase();

  const queryFilter = buildQueryFilter(filter);
  const movementsQuery = useStockMovementsQuery(supabase, queryFilter, true);

  const allMovements = movementsQuery.data ?? [];
  const visibleMovements =
    filter.reason === null
      ? allMovements
      : allMovements.filter((m) => m.reason === filter.reason);

  const reachedLimit = allMovements.length >= filter.limit;

  function handleLoadMore() {
    onFilterChange({ ...filter, limit: filter.limit + 50 });
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Ingredient filter */}
        <Select
          value={filter.ingredient_id ?? "__all"}
          onValueChange={(v) =>
            onFilterChange({
              ...filter,
              ingredient_id: v === "__all" ? null : v,
              limit: 50,
            })
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tất cả nguyên liệu</SelectItem>
            {ingredients.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Reason filter */}
        <Select
          value={filter.reason ?? "__all"}
          onValueChange={(v) =>
            onFilterChange({
              ...filter,
              reason: v === "__all" ? null : (v as StockMovementReason),
              limit: 50,
            })
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tất cả lý do</SelectItem>
            {REASON_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date range filter */}
        <Select
          value={filter.dateRange}
          onValueChange={(v) =>
            onFilterChange({
              ...filter,
              dateRange: v as DateRangePreset,
              limit: 50,
            })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hôm nay</SelectItem>
            <SelectItem value="week">Tuần này</SelectItem>
            <SelectItem value="month">Tháng này</SelectItem>
            <SelectItem value="all">Tất cả thời gian</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {movementsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : movementsQuery.isError ? (
        <AlertBanner variant="danger">
          Không tải được lịch sử. Vui lòng tải lại trang.
        </AlertBanner>
      ) : visibleMovements.length === 0 ? (
        <EmptyState
          icon="info"
          title="Chưa có giao dịch nào trong khoảng này"
          subtitle="Đổi bộ lọc hoặc ghi kiểm kê / nhập xuất mới."
          dashedBorder
        />
      ) : (
        <>
          <div className="space-y-2">
            {visibleMovements.map((m) => (
              <LedgerRow key={m.id} movement={m} />
            ))}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Hiển thị {visibleMovements.length} giao dịch
            </p>
            {reachedLimit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleLoadMore}
              >
                Xem thêm
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function buildQueryFilter(filter: LedgerFilter): {
  ingredient_id?: string;
  from?: string;
  to?: string;
  limit?: number;
} {
  const out: {
    ingredient_id?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {};
  if (filter.ingredient_id) out.ingredient_id = filter.ingredient_id;
  if (filter.dateRange === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    out.from = today.toISOString();
  } else if (filter.dateRange === "week") {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek);
    monday.setHours(0, 0, 0, 0);
    out.from = monday.toISOString();
  } else if (filter.dateRange === "month") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    out.from = start.toISOString();
  }
  out.limit = filter.limit;
  return out;
}

const REASON_LABELS: Record<StockMovementReason, string> = {
  purchase_received: "Nhập mua",
  sale_theoretical: "Bán (lý thuyết)",
  manual_adjustment_in: "Điều chỉnh tăng",
  manual_adjustment_out: "Điều chỉnh giảm",
  count_correction: "Kiểm kê (điều chỉnh)",
  waste: "Hao hụt",
};

function LedgerRow({ movement }: { movement: StockMovement }) {
  const m = movement;
  const isPositive = m.quantity_delta > 0;
  const isNegative = m.quantity_delta < 0;
  const reasonColor =
    m.reason === "purchase_received" || m.reason === "manual_adjustment_in"
      ? "text-success"
      : m.reason === "manual_adjustment_out" ||
          m.reason === "sale_theoretical"
        ? "text-muted"
        : m.reason === "waste"
          ? "text-danger"
          : "text-info"; // count_correction

  const occurred = formatOccurred(m.occurred_at);

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Icon
              name="package"
              size={20}
              className="text-muted mt-0.5"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-ink truncate">
                  {m.ingredient_name}
                </p>
                <p
                  className={`text-sm font-mono tabular-nums ${reasonColor}`}
                >
                  {isPositive ? "+" : ""}
                  {m.quantity_delta}
                </p>
                {m.source_order_id && (
                  <Badge variant="soft" semantic="neutral">
                    Từ đơn KiotViet
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted mt-0.5">
                {REASON_LABELS[m.reason]} · {occurred}
                {m.created_by ? " · bởi: nhân viên" : " · (hệ thống)"}
              </p>
              {m.notes && (
                <p className="text-xs text-muted mt-0.5 truncate">
                  {m.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
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

**Note for implementer:** the row uses `formatUnit(unit)` implicitly via the data — wait, the row displays just `m.quantity_delta` without the unit. The `StockMovement` type doesn't include the ingredient's unit. Since the row already shows `ingredient_name`, that's fine; the user knows the unit from context. If you want to add unit display, you'd need to look it up from the ingredients array — pass it as a prop or join client-side. **Locked decision: omit unit on ledger rows.** The balances section shows units; the ledger shows deltas relative to the ingredient.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4d): StockLedgerSection with inline filters

Filter bar (horizontal flex):
- Ingredient Select: "Tất cả nguyên liệu" or specific
- Reason Select: "Tất cả lý do" or 6 reason options
- Date range Select: Hôm nay / Tuần này / Tháng này / Tất cả thời gian

Filter state owned by parent (StockTab) and passed via props.
Filter changes reset limit to 50 (avoids stale pagination state).

Reason filter applied CLIENT-SIDE (RPC doesn't accept reason param).
Ingredient + date filters reach the RPC via the query hook.

Ledger row: ingredient name + signed quantity_delta (color by reason)
+ reason label + occurred_at (relative) + bởi: nhân viên / (hệ thống)
+ notes (truncated). Source badge if source_order_id present.

Pagination: "Xem thêm" button increments filter.limit by 50.
Hidden when allMovements.length < filter.limit (no more rows).

"Hiển thị N giao dịch" counter below list.

Inline formatOccurred() for hôm nay / hôm qua / dd/mm/yyyy timestamps.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/stock-ledger-section.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 6: StockTab

**Files:**
- Create: `src/features/inventory/stock-tab.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useStockBalancesQuery,
  useIngredientsQuery,
} from "@/hooks/queries";
import { StockBalanceList } from "./stock-balance-list";
import { StockCountModal } from "./stock-count-modal";
import { StockMovementModal } from "./stock-movement-modal";
import {
  StockLedgerSection,
  type LedgerFilter,
} from "./stock-ledger-section";
import type { UserRole } from "@/lib/types";

interface StockTabProps {
  role: UserRole;
}

const INITIAL_FILTER: LedgerFilter = {
  ingredient_id: null,
  reason: null,
  dateRange: "today",
  limit: 50,
};

/**
 * Phase 4.D — Stock tab content.
 *
 * Two stacked sections:
 *   Section 1: "Tồn hiện tại" — StockBalanceList
 *   Section 2: "Lịch sử nhập xuất" — StockLedgerSection
 *
 * Toolbar (top): "+ Kiểm kê" + "+ Nhập xuất" buttons (canWrite only).
 *
 * canWrite = role !== "employee_viewer"
 *   (broader than 4.B/4.C; first writeable tab for staff_operator)
 *
 * Filter state for ledger lives here, passed to StockLedgerSection.
 *
 * Active ingredients filtered client-side for the modal Select dropdowns.
 */
export function StockTab({ role }: StockTabProps) {
  const supabase = useSupabase();
  const balancesQuery = useStockBalancesQuery(supabase, true);
  const ingredientsQuery = useIngredientsQuery(supabase, true);

  const canWrite = role !== "employee_viewer";

  const [countModalOpen, setCountModalOpen] = useState(false);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [filter, setFilter] = useState<LedgerFilter>(INITIAL_FILTER);

  const balances = balancesQuery.data ?? [];
  const ingredients = ingredientsQuery.data ?? [];

  const activeIngredients = useMemo(
    () => ingredients.filter((i) => i.is_active),
    [ingredients]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-ink">Tồn kho</h2>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => setCountModalOpen(true)}
              leadingIcon={<Icon name="plus" size={16} />}
            >
              Kiểm kê
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMovementModalOpen(true)}
              leadingIcon={<Icon name="plus" size={16} />}
            >
              Nhập xuất
            </Button>
          </div>
        )}
      </div>

      {/* Section 1: Balances */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Tồn hiện tại</h3>
        <StockBalanceList
          balances={balances}
          isLoading={balancesQuery.isLoading}
          isError={balancesQuery.isError}
        />
      </section>

      {/* Section 2: Ledger */}
      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Lịch sử nhập xuất</h3>
        <StockLedgerSection
          filter={filter}
          onFilterChange={setFilter}
          ingredients={activeIngredients}
        />
      </section>

      {/* Modals */}
      <StockCountModal
        open={countModalOpen}
        onOpenChange={setCountModalOpen}
        ingredients={activeIngredients}
        balances={balances}
      />
      <StockMovementModal
        open={movementModalOpen}
        onOpenChange={setMovementModalOpen}
        ingredients={activeIngredients}
        balances={balances}
      />
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
feat(phase-4d): StockTab — composes everything

Top-level tab container:
- Header + toolbar (Kiểm kê + Nhập xuất buttons, canWrite only)
- Section 1: "Tồn hiện tại" → StockBalanceList
- Section 2: "Lịch sử nhập xuất" → StockLedgerSection
- Two modals (count + movement) — opened from toolbar

canWrite = role !== "employee_viewer"
  (first writeable tab for staff_operator; broader than 4.B/4.C)

Filter state for ledger lives in this component; passed to
StockLedgerSection as props.

Active ingredients filtered client-side for modal Select dropdowns.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/stock-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 7: Wire StockTab into InventoryView + verify + tag

**Files:**
- Modify: `src/features/inventory/inventory-view.tsx`

- [ ] **Step 1: Modify `src/features/inventory/inventory-view.tsx`**

Read the file. Find the imports near the top:

```tsx
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
import { RecipesTab } from "./recipes-tab";
```

Add:

```tsx
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
import { RecipesTab } from "./recipes-tab";
import { StockTab } from "./stock-tab";
```

Then find the existing "stock" TabsContent placeholder:

```tsx
        <TabsContent value="stock">
          <EmptyState
            icon="package"
            title="Tồn kho"
            subtitle="Phát hành trong giai đoạn 4.D — kiểm kê + sổ nhập xuất + điều chỉnh thủ công."
            dashedBorder
          />
        </TabsContent>
```

Replace with:

```tsx
        <TabsContent value="stock">
          <StockTab role={role} />
        </TabsContent>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | Select-Object -Last 30`
Expected: build succeeds.

- [ ] **Step 4: Final verify:phase**

Run: `npm run verify:phase`
Expected: `Vitest 75/75 + pgTAP 89/89 = 164 total`, exit 0. No regression.

- [ ] **Step 5: Verify file manifest**

Run: `git diff main..HEAD --name-only`
Expected exactly these 11 files:
- `docs/superpowers/specs/2026-05-22-v4-phase-4d-stock-ui-design.md`
- `docs/superpowers/plans/2026-05-22-v4-phase-4d-stock-ui.md`
- `src/hooks/mutations/use-stock-mutations.ts`
- `src/hooks/queries/use-stock-movements-query.ts`
- `src/hooks/queries/index.ts` (modified)
- `src/features/inventory/stock-balance-list.tsx`
- `src/features/inventory/stock-count-modal.tsx`
- `src/features/inventory/stock-movement-modal.tsx`
- `src/features/inventory/stock-ledger-section.tsx`
- `src/features/inventory/stock-tab.tsx`
- `src/features/inventory/inventory-view.tsx` (modified)

If any off-limits file appears, STOP and revert.

- [ ] **Step 6: Commit InventoryView wire**

```powershell
$msg = @'
feat(phase-4d): wire StockTab into InventoryView + tag v4-phase-4d

Swap the Tồn kho tab's EmptyState placeholder for <StockTab role={role} />.
Import StockTab from ./stock-tab.

After this, the Tồn kho tab is fully functional:
- Section 1: theoretical balances with low-stock/overdraft badges
- Section 2: paged movement ledger with inline filters
- Toolbar: Kiểm kê + Nhập xuất buttons (canWrite only)
- Two modals: count (live variance) + movement (sign normalization)

Remaining placeholder tab (Tổng quan) still shows EmptyState until 4.E.

Final: 75 Vitest + 89 pgTAP = 164 assertions green.

Tag: v4-phase-4d (closes Phase 4.D).
Phase 4 progress:
  - 4.A Backend (complete)
  - 4.B Masters UI (complete)
  - 4.C Recipes UI (complete)
  - 4.D Stock UI (THIS PHASE)
  - 4.E Inventory dashboard (next, final 4.x)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/inventory-view.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

- [ ] **Step 7: Place tag**

```bash
git tag v4-phase-4d
git tag -f v4-phase-4d HEAD
git show v4-phase-4d --stat --no-patch | Select-Object -First 5
```

Confirm the tag points to the InventoryView wire commit (the most recent on the branch).

Phase 4.D is now ready for `superpowers:finishing-a-development-branch` to merge to main.

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Covered by | Status |
|--------------|-----------|--------|
| §0 TL;DR (5 feature files + 2 hook files + 2 modified, no backend) | All tasks | ✓ |
| §1 Goal (count/movement/balances/ledger; staff writeable) | T2 (balances) + T3 (count) + T4 (movement) + T5 (ledger) + T6 (canWrite=role!=="employee_viewer") | ✓ |
| §2 Non-goals (no edit/delete history, no bulk, no CSV) | Correctly absent from all tasks | ✓ |
| §3 Scope decisions | T1 hooks, T6 toolbar, T5 filters, T3 variance, T4 sign normalization | ✓ |
| §4.1 StockTab structure | T6 | ✓ |
| §4.2 StockCountModal layout | T3 | ✓ |
| §4.3 StockMovementModal layout | T4 | ✓ |
| §4.4 Data flow | T6 imports queries; T3/T4 receive props | ✓ |
| §4.5 Invalidation map | T1 hooks both invalidate stockBalances + stockMovements | ✓ |
| §4.6 Role gating | T6 canWrite + T2/T3/T4/T5 buttons gated | ✓ |
| §5.1 StockCountModal props/state/init/submit | T3 (full code) | ✓ |
| §5.2 StockMovementModal props/state/reason options/derived/submit | T4 (full code) | ✓ |
| §5.3 Shared modal conventions | T3 + T4 (matching pattern) | ✓ |
| §6.1 LedgerFilter shape | T5 + T6 (filter state) | ✓ |
| §6.2 buildQueryFilter | T5 (full code) | ✓ |
| §6.3 Ledger row layout | T5 (LedgerRow component) | ✓ |
| §6.4 Pagination "Xem thêm" | T5 (handleLoadMore + reachedLimit logic) | ✓ |
| §7 File manifest | All 9 task files match | ✓ |
| §8 Mutation hooks + query hook code | T1 (full code) | ✓ |
| §9 Vietnamese strings | All strings used in T2-T6 match the glossary | ✓ |
| §10 Error handling | T2 (AlertBanner.danger) + T5 (AlertBanner.danger) + T3/T4 (toast.danger) | ✓ |
| §11 Risk register | Addressed inline (Set check for filter race, client-side reason filter, etc.) | ✓ |
| §12 7-task projection | T1-T7 exactly | ✓ |
| §13 Success criteria | T7 verification steps | ✓ |

**2. Placeholder scan:**
- No "TBD" / "TODO" / "implement later" in normative content ✓
- Every code step has full TSX/TS code ✓
- Commit messages fully written ✓
- T3 note about `text-success` / `text-info` / `text-warning` substitutes is robust handling, not a placeholder ✓
- T5 note about unit display on ledger rows is an explicit decision documented ("Locked decision") ✓

**3. Type consistency:**
- `StockMovementReason`, `StockMovement`, `StockBalance`, `Ingredient`, `UserRole` from `@/lib/types` used identically across T1-T6 ✓
- `ManualReason` defined as union of 4 strings (T4) — matches `MANUAL_REASON_OPTIONS` shape ✓
- `LedgerFilter` defined in T5, re-imported by T6 ✓
- `DateRangePreset` defined in T5 ✓
- `RecordStockMovementInput`, `RecordStockCountInput` defined in T1, used identically in T3/T4 mutation calls ✓
- `formatUnit` from `@/features/inventory/units` used in T2, T3, T4 (unit display) ✓
- `useStockBalancesQuery`, `useIngredientsQuery` from `@/hooks/queries` (4.A) — used in T6 ✓
- `useStockMovementsQuery` from T1 — re-exported via barrel in T1 — used in T5 ✓

No issues found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-v4-phase-4d-stock-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh implementer subagent per task, combined spec+quality review, final opus overall review. Matches the proven pattern that successfully shipped 4.A, 4.B, and 4.C.

**2. Inline Execution** — execute tasks directly in this session using `superpowers:executing-plans` with batch checkpoints.

Which approach?
