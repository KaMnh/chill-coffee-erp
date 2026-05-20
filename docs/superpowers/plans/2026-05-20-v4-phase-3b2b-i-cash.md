# Phase 3B.2b.i — Cash Write Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `view === "cash"` Phase 3A locked EmptyState with a full CashView — port v3 cash module (8 files, ~1,800 LOC) into 11 focused Phase-2-aligned files + 6 mutation hooks + pure `cash-math.ts` helpers extracted for Vitest testability in 3B.2b.ii.

**Architecture:** 11 components under `src/features/cash/` (CashView container → DenominationGrid reusable + ReconciliationSummary + cash-history-section + 4 admin modals + 1 nested popup) + `denominations.ts` (port v3 verbatim) + `cash-math.ts` (NEW pure helpers). 6 mutation hooks co-located in `src/hooks/mutations/use-cash-mutations.ts`. Server-driven refetch; no optimistic updates. v3 business logic preserved verbatim: reconciliation formula, spot_audit vs shift_close, leave-for-next-day, manual POS override, edit cash_count rejects on final report, void reverses safe_deposit via adjustment.

**Tech Stack:** Next.js 15 + React 19 + TypeScript strict + Tailwind v4 + Radix Dialog primitives + TanStack Query 5 + Supabase JS. NO new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-20-v4-phase-3b2b-i-cash-design.md`

---

## File Structure

### Created / modified in Phase 3B.2b.i

```
src/
  app/
    page.tsx                                       [MODIFY — swap cash EmptyState for CashView]
  components/ui/icons.tsx                          [MODIFY — add 2 icons: pencil, calculator]
  features/cash/
    denominations.ts                               [NEW — port v3 verbatim]
    cash-math.ts                                   [NEW — 5 pure helpers, test in 3B.2b.ii]
    denomination-grid.tsx                          [NEW — reusable across 4 modals]
    reconciliation-summary.tsx                     [NEW — display, manual POS override]
    cash-history-section.tsx                       [NEW — list + expand/collapse + admin buttons]
    cash-view.tsx                                  [NEW — container]
    opening-cash-modal.tsx                         [NEW — port v3 + tokenized]
    edit-cash-count-modal.tsx                      [NEW — port v3 + tokenized]
    edit-cash-close-modal.tsx                      [NEW — port v3 + nested popup]
    leave-denomination-popup.tsx                   [NEW — port v3, nested in edit-cash-close]
    void-cash-close-modal.tsx                      [NEW — port v3]
  hooks/
    mutations/
      use-cash-mutations.ts                        [NEW — 6 hooks co-located]
```

### Untouched (do NOT modify)
- `src/lib/**` (Phase 1 — `lib/data/cash.ts` + `lib/data/reports.ts` + `lib/validation.ts` + `lib/datetime.ts` + `lib/format.ts` all frozen; 6 RPCs ready)
- `src/hooks/queries/**` (Phase 1+3A — frozen; `useCashOpeningQuery`, `useCashCountsQuery`, `useSafeBalanceQuery` ready)
- `src/hooks/use-*.ts` (Phase 1+3A — frozen)
- `src/hooks/mutations/use-expense-mutations.ts` (3B.1, frozen)
- `src/hooks/mutations/use-shift-mutations.ts` (3B.2a, frozen)
- `src/middleware.ts`, `src/app/api/**`, `database/**`
- Phase 2 component bodies (other than `icons.tsx` additive)
- `src/features/{navigation,auth,dashboard,reports,pivot,expenses,shifts}/**` (Phase 3A+3B.1+3B.2a — frozen)
- `docker-compose.yml`, `supabase/**`, `.env*`

---

## Conventions for this plan

- **Vietnamese UI labels** preserved verbatim per spec §7. Examples: "Kiểm két nhanh", "Chốt két & tạo báo cáo", "Mệnh giá", "Để lại cho ngày mai", "Sổ quỹ sẽ nhận", "Nhập POS thủ công", "Đã chốt"/"Đã hủy", "Sửa count"/"Sửa báo cáo"/"Hủy báo cáo".
- **Form validation:** `validateCashCount({ total_physical, bank_transfer_confirmed, note, denominations_json })` + `validateDenominations(counts)` from `@/lib/validation` (Phase 1, frozen). Result shape `{ ok: true } | { ok: false; field, message }`.
- **TZ guardrail:** `business_date` from `useBusinessDate`. `counted_at` uses `new Date().toISOString()` (RPC accepts UTC ISO — server interprets in DB session VN TZ).
- **Reconciliation formula** verbatim from v3 cash-panel.tsx line 67:
  ```ts
  reconciliation = physical - openingCash + bankTransferConfirmed + total_expenses + payroll_paid;
  difference = posTotal - reconciliation;
  ```
- **`base_pay`/`total_pay` and other money math is integer VND** — no float decimals. `moneyFromInput` strips non-digit characters and returns integer.
- **Mutations:** TanStack `useMutation` calling Phase 1 `lib/data` fn. Throw `Error("Thiếu cấu hình Supabase.")` when supabase null. `onSuccess: queryClient.invalidateQueries(...)`. Caller uses `mutateAsync` + try/catch + toast.
- **Modal pattern:** Phase 2 compound `<Modal open onOpenChange><ModalContent><ModalTitle>…<ModalDescription>…<form/body><ModalActions>…</ModalActions></ModalContent></Modal>`. Nested popup: separate `<Modal>` with its own `open` state, rendered as sibling (Radix portals each separately).
- **Stale-row guard:** `useEffect` to clear in-flight modal state if the resource disappears from a parent list (3B.1 + 3B.2a pattern).
- **Each commit ends** with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **PowerShell here-string** for commit messages can break on Vietnamese diacritics — write to `.git/COMMIT_MSG_TMP` and `git commit -F .git/COMMIT_MSG_TMP` then `Remove-Item .git/COMMIT_MSG_TMP -Force`.

---

## Tasks overview

| # | Task | Files (new) | Files (modify) | Est. LOC |
|---|---|---|---|---|
| 1 | Icons (+2) + denominations.ts + cash-math.ts + useCashMutations | 3 | 1 | ~300 |
| 2 | DenominationGrid (reusable) | 1 | 0 | ~180 |
| 3 | ReconciliationSummary (display) | 1 | 0 | ~170 |
| 4 | OpeningCashModal | 1 | 0 | ~210 |
| 5 | CashHistorySection (list + expand) | 1 | 0 | ~230 |
| 6 | EditCashCountModal | 1 | 0 | ~220 |
| 7 | LeaveDenominationPopup | 1 | 0 | ~130 |
| 8 | EditCashCloseModal (mounts LeaveDenominationPopup) | 1 | 0 | ~220 |
| 9 | VoidCashCloseModal | 1 | 0 | ~150 |
| 10 | CashView + page.tsx wire | 1 | 1 | ~250 |
| 11 | Smoke verify + tag v4-phase-3b2b-i | 0 | 0 | ~0 |

Total: 12 new files + 2 modifies across 11 tasks. ~2,060 LOC.

---

## Task 1: Icons + denominations.ts + cash-math.ts + useCashMutations

**Files:**
- Modify: `src/components/ui/icons.tsx` (additively add `pencil` + `calculator`)
- Create: `src/features/cash/denominations.ts`
- Create: `src/features/cash/cash-math.ts`
- Create: `src/hooks/mutations/use-cash-mutations.ts`

**Why this first:** Foundation. Every downstream component needs at least one of these. Landing them as foundation prevents downstream tasks from each adding patches. `cash-math.ts` exists now so Vitest tests in 3B.2b.ii can pull pure functions without refactoring components.

### Step 1.1 — Add `pencil` + `calculator` icons additively

- [ ] **Edit `src/components/ui/icons.tsx`.**

In the import block from `"lucide-react"` (in the Phase 3A action icons section, after `Printer`), add:

```tsx
  // Phase 3B.1 — action icons
  Trash2, Save,
  // Phase 3B.2b.i — action icons
  Pencil, Calculator,
```

In the `Icons` map (Phase 3B.1 actions section, after `save`), add:

```tsx
  // Phase 3B.2b.i actions
  pencil: Pencil,
  calculator: Calculator,
```

The rest of the file is unchanged. Total icons: 35 (3B.1 baseline) + 2 = **37**.

### Step 1.2 — Create `src/features/cash/denominations.ts`

- [ ] **Port v3 verbatim (no React, no Phase 2 changes needed).**

```ts
export const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

export type DenominationInputRefs = React.MutableRefObject<Record<number, HTMLInputElement | null>>;

export function normalizeCount(value: string | number | null | undefined): number {
  return Math.max(0, Number(value) || 0);
}

function focusDenominationInput(inputRefs: DenominationInputRefs, denomination: number, direction: -1 | 1): void {
  const currentIndex = DENOMINATIONS.indexOf(denomination);
  const nextDenomination = DENOMINATIONS[currentIndex + direction];
  if (!nextDenomination) return;
  inputRefs.current[nextDenomination]?.focus();
  inputRefs.current[nextDenomination]?.select();
}

export function handleDenominationKeyDown(
  event: React.KeyboardEvent<HTMLInputElement>,
  denomination: number,
  options: {
    inputRefs: DenominationInputRefs;
    updateCount: (denomination: number, delta: number) => void;
    readOnly?: boolean;
  }
): void {
  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusDenominationInput(options.inputRefs, denomination, -1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusDenominationInput(options.inputRefs, denomination, 1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    if (!options.readOnly) options.updateCount(denomination, -1);
    return;
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    if (!options.readOnly) options.updateCount(denomination, 1);
  }
}
```

### Step 1.3 — Create `src/features/cash/cash-math.ts`

- [ ] **Extract 5 pure helpers from v3 inline formulas.**

```ts
/**
 * Pure cash math helpers — no React, no Supabase, no globals.
 *
 * Extracted from v3 cash-panel.tsx + edit-cash-close-modal.tsx inline formulas.
 * Designed for Vitest testability in Phase 3B.2b.ii — every function takes
 * primitive inputs and returns primitive outputs. No side effects.
 */

import { DENOMINATIONS } from "./denominations";

/** Sum of (denomination × count) across all 9 VND denominations. */
export function computeDenominationTotal(counts: Record<string | number, number>): number {
  return DENOMINATIONS.reduce(
    (sum, denom) => sum + denom * (Number(counts[denom] ?? counts[String(denom)] ?? 0) || 0),
    0
  );
}

/**
 * Reconciliation total (matches v3 reconciliationPreview verbatim):
 *   reconciliation = physical - openingCash + bankTransferConfirmed + expenseCashTotal + payrollCashTotal
 *
 * The value POS total should equal. Inverse of "theory cash" in accounting:
 * given physical + ops totals, what should POS report?
 */
export function computeReconciliation(input: {
  physical: number;
  openingCash: number;
  bankTransferConfirmed: number;
  expenseCashTotal: number;
  payrollCashTotal: number;
}): number {
  return (
    input.physical -
    input.openingCash +
    input.bankTransferConfirmed +
    input.expenseCashTotal +
    input.payrollCashTotal
  );
}

/**
 * Difference = POS total - reconciliation. Zero = perfect close; non-zero = lệch két.
 */
export function computeReconcileDiff(posTotal: number, reconciliation: number): number {
  return posTotal - reconciliation;
}

/**
 * Validate leave_for_next_day ≤ physical_cash and ≥ 0.
 * Matches v3 leave validation across leave-denomination-popup + edit-cash-close-modal.
 */
export function isLeaveAmountValid(leave: number, physical: number): boolean {
  return Number.isFinite(leave) && leave >= 0 && leave <= physical;
}

/**
 * Greedy denomination breakdown for a target amount. Used by LeaveDenominationPopup
 * to pre-seed the grid when the user opens the calculator popup.
 *
 * Example: 237_000 → { "200000": 1, "20000": 1, "10000": 1, "5000": 1, "2000": 1 }
 *
 * Always returns a fully-decomposable result for VND amounts ≥ 1000 (since
 * 1000 is the smallest denomination). Amounts < 1000 return {} (no decomposition
 * possible).
 */
export function computeGreedyLeaveBreakdown(amount: number): Record<string, number> {
  const result: Record<string, number> = {};
  let remaining = Math.max(0, Math.floor(amount));
  for (const denom of DENOMINATIONS) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / denom);
    if (count > 0) {
      result[String(denom)] = count;
      remaining -= denom * count;
    }
  }
  return result;
}
```

### Step 1.4 — Create `src/hooks/mutations/use-cash-mutations.ts`

- [ ] **6 hooks co-located.**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  saveCashCount,
  saveCashDayOpening,
  updateCashCount,
  finalizeCashCloseReport,
  editCashCloseReport,
  voidCashCloseReport,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the cash module (Phase 3B.2b.i).
 *
 * Co-located in one file because they share invalidation idioms
 * (cashCounts/cashOpening/reports/dashboard/safe — depending on action).
 *
 * No optimistic updates. Each mutation invalidates the relevant keys on
 * success, triggering a refetch.
 */

export interface SaveCashCountInput {
  business_date: string;
  count_type: "spot_audit" | "shift_close";
  counted_at: string;  // UTC ISO timestamp
  denominations_json: Record<string, number>;
  total_physical: number;
  bank_transfer_confirmed: number;
  note: string;
  // Optional: only set when isManualPos in UI
  pos_total?: number;
  pos_cash_total?: number;
  pos_non_cash_total?: number;
}

export function useSaveCashCount(supabase: SupabaseClient | null, businessDate: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveCashCountInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return saveCashCount(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface FinalizeCashCloseInput {
  cash_count_id: string;
  leave_for_next_day: number;
}

export function useFinalizeCashClose(supabase: SupabaseClient | null, businessDate: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FinalizeCashCloseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return finalizeCashCloseReport(supabase, input.cash_count_id, {
        leaveForNextDay: input.leave_for_next_day,
      });
    },
    // Shift_close finalize creates report + auto safe_deposit transaction.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    },
  });
}

export interface SaveCashDayOpeningInput {
  business_date: string;
  denominations_json: Record<string, number>;
  carried_from_previous_day?: boolean;
  safe_withdrawal_amount?: number;
}

export function useSaveCashDayOpening(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveCashDayOpeningInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return saveCashDayOpening(supabase, input);
    },
    // Opening with safe withdrawal also affects sổ quỹ.
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashOpening(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      if ((input.safe_withdrawal_amount ?? 0) > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
        queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
      }
    },
  });
}

export interface UpdateCashCountInput {
  id: string;
  denominations_json?: Record<string, number>;
  bank_transfer_confirmed?: number;
  note?: string | null;
}

export function useUpdateCashCount(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateCashCountInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateCashCount(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface EditCashCloseReportInput {
  reportId: string;
  note?: string | null;
  leaveForNextDay?: number | null;
}

export function useEditCashCloseReport(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EditCashCloseReportInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return editCashCloseReport(supabase, input.reportId, {
        note: input.note,
        leaveForNextDay: input.leaveForNextDay,
      });
    },
    // Leave change → RPC inserts adjustment safe_transaction.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    },
  });
}

export interface VoidCashCloseReportInput {
  reportId: string;
  reason: string;
}

export function useVoidCashCloseReport(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VoidCashCloseReportInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return voidCashCloseReport(supabase, input.reportId, input.reason);
    },
    // Void RPC marks report voided + inserts adjustment safe_transaction (reverse).
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    },
  });
}
```

### Step 1.5 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean. Tree-shaking keeps new exports out of bundles until consumed.

### Step 1.6 — Commit

- [ ] **Write commit message to `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): icons + denominations + cash-math + useCashMutations

- Add 2 icons (pencil, calculator) additively. Total icon count: 37.
- Port v3 denominations.ts verbatim: DENOMINATIONS const + keyboard nav.
- Create cash-math.ts with 5 pure helpers extracted from v3 inline formulas:
  computeDenominationTotal, computeReconciliation, computeReconcileDiff,
  isLeaveAmountValid, computeGreedyLeaveBreakdown. Testable in 3B.2b.ii.
- Create use-cash-mutations.ts with 6 TanStack mutation hooks:
  useSaveCashCount, useFinalizeCashClose, useSaveCashDayOpening,
  useUpdateCashCount, useEditCashCloseReport, useVoidCashCloseReport.
- Invalidation map: cashCounts/cashOpening/reports/dashboard/safe per mutation.
- All mutationFn throw "Thiếu cấu hình Supabase." if supabase null.

No runtime UI change yet; foundation for Tasks 2-10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/components/ui/icons.tsx src/features/cash/denominations.ts src/features/cash/cash-math.ts src/hooks/mutations/use-cash-mutations.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 2: `DenominationGrid` (reusable)

**Files:**
- Create: `src/features/cash/denomination-grid.tsx`

**Why second:** Reusable across 4 consumers (CashView main, OpeningCashModal, EditCashCountModal, LeaveDenominationPopup). Landing it now means downstream tasks just import + wire props.

### Step 2.1 — Create the component

- [ ] **Create `src/features/cash/denomination-grid.tsx`.**

```tsx
"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { formatNumber, formatVND } from "@/lib/format";
import {
  DENOMINATIONS,
  handleDenominationKeyDown,
  normalizeCount,
  type DenominationInputRefs,
} from "./denominations";
import { computeDenominationTotal } from "./cash-math";

interface DenominationGridProps {
  /** Map of denomination (as string or number) → count. */
  value: Record<string, number>;
  onChange(next: Record<string, number>): void;
  readOnly?: boolean;
  /** Show quick-add chips [+1, +5, +10, +20]. Default true. Pass false for compact mode. */
  showQuickAdd?: boolean;
  /** Disable inputs (during mutation). */
  disabled?: boolean;
  /** Label displayed above the grid total. Default "Tổng". */
  totalLabel?: string;
}

/**
 * Reusable denomination grid — 9 VND mệnh giá (500k → 1k) with stepper,
 * numeric input, quick-add chips (+1/+5/+10/+20), and per-row total.
 * Arrow-key navigation: Up/Down move focus between rows; Left/Right
 * decrement/increment count.
 *
 * Single source of truth for denomination editing across:
 *   - CashView main panel (main cash being counted)
 *   - OpeningCashModal (opening day cash)
 *   - EditCashCountModal (admin edit cash_count)
 *   - LeaveDenominationPopup (leave breakdown)
 */
export function DenominationGrid({
  value,
  onChange,
  readOnly = false,
  showQuickAdd = true,
  disabled = false,
  totalLabel = "Tổng",
}: DenominationGridProps) {
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  function updateCount(denomination: number, delta: number) {
    if (readOnly || disabled) return;
    onChange({
      ...value,
      [String(denomination)]: normalizeCount((value[String(denomination)] ?? 0) + delta),
    });
  }

  function setCount(denomination: number, raw: string) {
    if (readOnly || disabled) return;
    onChange({
      ...value,
      [String(denomination)]: normalizeCount(raw),
    });
  }

  const total = computeDenominationTotal(value);
  const isInteractive = !readOnly && !disabled;

  return (
    <div className="flex flex-col gap-2">
      {DENOMINATIONS.map((denomination) => {
        const count = value[String(denomination)] ?? 0;
        const rowTotal = denomination * count;
        return (
          <article
            key={denomination}
            className="grid grid-cols-[100px_auto_1fr_auto] gap-3 items-center rounded-md border border-border bg-surface p-2"
          >
            <strong className="font-display text-sm text-ink">{formatVND(denomination)}</strong>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!isInteractive}
                onClick={() => updateCount(denomination, -1)}
                aria-label={`Giảm 1 tờ ${formatVND(denomination)}`}
                className={cn(
                  "w-7 h-7 rounded-full border border-border flex items-center justify-center transition-colors",
                  isInteractive ? "hover:bg-surface-muted" : "opacity-40 cursor-not-allowed"
                )}
              >
                <Icon name="minus" size={16} />
              </button>
              <input
                ref={(node) => {
                  inputRefs.current[denomination] = node;
                }}
                value={count}
                readOnly={readOnly}
                disabled={disabled}
                aria-label={`${formatVND(denomination)} số tờ`}
                onChange={(e) => setCount(denomination, e.target.value)}
                onKeyDown={(e) =>
                  handleDenominationKeyDown(e, denomination, {
                    inputRefs: inputRefs as DenominationInputRefs,
                    updateCount,
                    readOnly: readOnly || disabled,
                  })
                }
                inputMode="numeric"
                className={cn(
                  "w-14 h-7 rounded-sm border border-border bg-surface text-center text-sm text-ink",
                  "focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong",
                  (readOnly || disabled) && "bg-surface-muted text-muted cursor-not-allowed"
                )}
              />
              <button
                type="button"
                disabled={!isInteractive}
                onClick={() => updateCount(denomination, +1)}
                aria-label={`Tăng 1 tờ ${formatVND(denomination)}`}
                className={cn(
                  "w-7 h-7 rounded-full border border-border flex items-center justify-center transition-colors",
                  isInteractive ? "hover:bg-surface-muted" : "opacity-40 cursor-not-allowed"
                )}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
            {showQuickAdd && (
              <div className="flex items-center gap-1 flex-wrap" aria-label="Cộng nhanh">
                {[1, 5, 10, 20].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    disabled={!isInteractive}
                    onClick={() => updateCount(denomination, delta)}
                    aria-label={`Cộng ${delta} tờ ${formatVND(denomination)}`}
                    className={cn(
                      "px-2 py-0.5 rounded-full border border-border bg-surface text-xs text-ink transition-colors",
                      isInteractive ? "hover:bg-surface-muted hover:border-border-strong" : "opacity-40 cursor-not-allowed"
                    )}
                  >
                    +{delta}
                  </button>
                ))}
              </div>
            )}
            {!showQuickAdd && <span />}
            <span className="text-sm text-muted shrink-0">{formatNumber(rowTotal)}</span>
          </article>
        );
      })}
      <div className="flex items-center justify-between border-t border-border pt-3 mt-1">
        <span className="text-sm text-muted">{totalLabel}</span>
        <strong className="font-display text-base text-ink">{formatVND(total)}</strong>
      </div>
    </div>
  );
}
```

### Step 2.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 2.3 — Commit

- [ ] **Write commit message to `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): DenominationGrid reusable component

9-row mệnh giá grid (500k -> 1k) with stepper + numeric input +
quick-add chips (+1/+5/+10/+20) + per-row total. Arrow-key nav via
handleDenominationKeyDown helper from denominations.ts.

Single source of truth — replaces 4× duplicate grid blocks across v3
cash-panel + opening-cash-modal + edit-cash-count-modal + leave-popup.

Props: value (Record<string,number>), onChange, readOnly?, showQuickAdd?,
disabled?, totalLabel?.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/denomination-grid.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 3: `ReconciliationSummary` (display)

**Files:**
- Create: `src/features/cash/reconciliation-summary.tsx`

**Why third:** Only used in CashView main panel. Pure display + manual-POS-override toggle. Lands before CashView so CashView can compose cleanly.

### Step 3.1 — Create the component

- [ ] **Create `src/features/cash/reconciliation-summary.tsx`.**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { formatVND } from "@/lib/format";
import { computeReconciliation, computeReconcileDiff } from "./cash-math";

interface ReconciliationSummaryProps {
  posTotal: number;
  posCash: number;
  posNonCash: number;
  openingCash: number;
  physical: number;
  bankTransferConfirmed: number;
  expenseCashTotal: number;
  payrollCashTotal: number;

  /** Manual POS override block. */
  isManualPos: boolean;
  manualPosTotal: string;
  manualPosCash: string;
  manualPosNonCash: string;
  onManualPosToggle(v: boolean): void;
  onManualPosTotalChange(v: string): void;
  onManualPosCashChange(v: string): void;
  onManualPosNonCashChange(v: string): void;
  disabled?: boolean;
}

/**
 * Display-only reconciliation panel. Renders 10-row summary table + formula
 * card + manual POS override block.
 *
 * Math is delegated to cash-math.ts pure helpers — keeps component free of
 * arithmetic and testable from the helper side.
 */
export function ReconciliationSummary({
  posTotal,
  posCash,
  posNonCash,
  openingCash,
  physical,
  bankTransferConfirmed,
  expenseCashTotal,
  payrollCashTotal,
  isManualPos,
  manualPosTotal,
  manualPosCash,
  manualPosNonCash,
  onManualPosToggle,
  onManualPosTotalChange,
  onManualPosCashChange,
  onManualPosNonCashChange,
  disabled = false,
}: ReconciliationSummaryProps) {
  const reconciliation = computeReconciliation({
    physical,
    openingCash,
    bankTransferConfirmed,
    expenseCashTotal,
    payrollCashTotal,
  });
  const difference = computeReconcileDiff(posTotal, reconciliation);
  const diffTone = difference === 0 ? "text-success" : "text-danger";

  return (
    <Card>
      <CardHeader>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Kết quả đối soát</p>
          <CardTitle>Chênh lệch két</CardTitle>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* 10-row summary */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Tổng POS</dt>
          <dd className="text-right font-display text-ink">{formatVND(posTotal)}</dd>
          <dt className="text-muted">POS tiền mặt</dt>
          <dd className="text-right font-display text-ink">{formatVND(posCash)}</dd>
          <dt className="text-muted">POS chuyển khoản</dt>
          <dd className="text-right font-display text-ink">{formatVND(posNonCash)}</dd>
          <dt className="text-muted">Tiền vào ca</dt>
          <dd className="text-right font-display text-ink">{formatVND(openingCash)}</dd>
          <dt className="text-muted">Tiền thực đếm</dt>
          <dd className="text-right font-display text-ink">{formatVND(physical)}</dd>
          <dt className="text-muted">Chuyển khoản đã nhận</dt>
          <dd className="text-right font-display text-ink">{formatVND(bankTransferConfirmed)}</dd>
          <dt className="text-muted">Chi phí cash</dt>
          <dd className="text-right font-display text-ink">{formatVND(expenseCashTotal)}</dd>
          <dt className="text-muted">Lương đã phát</dt>
          <dd className="text-right font-display text-ink">{formatVND(payrollCashTotal)}</dd>
          <dt className="text-muted border-t border-border pt-1">Tổng đối soát</dt>
          <dd className="text-right font-display text-ink border-t border-border pt-1">
            {formatVND(reconciliation)}
          </dd>
          <dt className="text-muted">Chênh lệch</dt>
          <dd className={cn("text-right font-display font-bold", diffTone)}>
            {formatVND(difference)}
          </dd>
        </dl>

        {/* Formula card */}
        <div className="rounded-md bg-surface-muted p-3">
          <p className="text-xs uppercase tracking-wide text-muted">Công thức đối soát</p>
          <p className="mt-2 font-mono text-xs text-ink-2 leading-relaxed">
            <strong>{formatVND(posTotal)}</strong> − ((<strong>{formatVND(physical)}</strong> − <strong>{formatVND(openingCash)}</strong>) + <strong>{formatVND(bankTransferConfirmed)}</strong> + <strong>{formatVND(expenseCashTotal)}</strong> + <strong>{formatVND(payrollCashTotal)}</strong>) = <strong className={diffTone}>{formatVND(difference)}</strong>
          </p>
          <p className="mt-1 text-xs text-muted">
            Tổng POS − ((Tiền thực đếm − Tiền vào ca) + Chuyển khoản đã nhận + Chi phí cash + Lương đã phát)
          </p>
        </div>

        {/* Manual POS override */}
        <div className="rounded-md border border-border p-3">
          <Checkbox
            label="Nhập POS thủ công"
            checked={isManualPos}
            onCheckedChange={(checked) => onManualPosToggle(checked === true)}
            disabled={disabled}
          />
          <p className="mt-1 text-xs text-muted">
            Dùng khi POS không sync được (KiotViet API offline, mất kết nối).
          </p>
          {isManualPos && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextField
                label="Tổng POS (thủ công)"
                value={manualPosTotal}
                onChange={(e) => onManualPosTotalChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={disabled}
              />
              <TextField
                label="POS tiền mặt"
                value={manualPosCash}
                onChange={(e) => onManualPosCashChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={disabled}
              />
              <TextField
                label="POS chuyển khoản"
                value={manualPosNonCash}
                onChange={(e) => onManualPosNonCashChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={disabled}
              />
              <p className="sm:col-span-3 text-xs text-muted">
                Khi bật, các giá trị POS ở bảng đối soát phía trên sẽ dùng số bạn nhập tay thay vì dữ liệu sync.
              </p>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
```

### Step 3.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 3.3 — Commit

- [ ] **Commit Task 3.**

Write `.git/COMMIT_MSG_TMP`:

```
feat(phase-3b2b-i): ReconciliationSummary display + manual POS override

10-row summary (POS Total / POS Cash / POS NonCash / Opening / Physical /
Bank Transfer / Expense / Payroll / Reconciliation / Difference) + formula
card with mono font showing actual numbers + Vietnamese explanation.

Manual POS override block: Phase 2 Checkbox + 3 TextFields (conditional).
Used when KiotViet sync is broken; parent owns toggle + 3 value states.

Math delegated to cash-math.ts pure helpers (testable in 3B.2b.ii).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/reconciliation-summary.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 4: `OpeningCashModal`

**Files:**
- Create: `src/features/cash/opening-cash-modal.tsx`

**Why fourth:** Standalone modal (not nested). Uses DenominationGrid + previous-day-leave hint + safe-withdrawal (owner only). Lands before CashView so CashView's "Nhập tiền đầu ngày" button has a target.

### Step 4.1 — Create the component

- [ ] **Create `src/features/cash/opening-cash-modal.tsx`.**

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
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/text-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useSafeBalanceQuery } from "@/hooks/queries";
import { useSaveCashDayOpening } from "@/hooks/mutations/use-cash-mutations";
import { loadPreviousDayLeave } from "@/lib/data";
import { formatVND, moneyFromInput } from "@/lib/format";
import type { CashDayOpening, UserRole } from "@/lib/types";
import { DenominationGrid } from "./denomination-grid";
import { computeDenominationTotal } from "./cash-math";
import { DENOMINATIONS } from "./denominations";

interface OpeningCashModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  opening: CashDayOpening | null;
  businessDate: string;
  role: UserRole;
}

function countsFromOpening(opening: CashDayOpening | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const denom of DENOMINATIONS) {
    const raw = opening?.denominations_json?.[String(denom)] ?? 0;
    result[String(denom)] = Math.max(0, Number(raw) || 0);
  }
  return result;
}

/**
 * Opening cash modal. Three modes:
 *  - Create (opening === null, canCreate): fresh form
 *  - Edit (opening !== null, canEdit): pre-fill, all editable
 *  - View-only (opening !== null, !canEdit): read-only DenominationGrid + close button only
 *
 * Owner-only safe_withdrawal_amount field — manager can create/edit
 * opening but only owner sees safe withdrawal (sổ quỹ owner-only constraint).
 *
 * Previous-day-leave hint fetched via loadPreviousDayLeave when no opening
 * exists for today — encourages cashier to verify count against yesterday's leave.
 */
export function OpeningCashModal({
  open,
  onOpenChange,
  opening,
  businessDate,
  role,
}: OpeningCashModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const saveOpeningM = useSaveCashDayOpening(supabase, businessDate);

  const isOwner = role === "owner";
  const canCreate = isOwner || role === "manager";
  const canEdit = isOwner;
  const readOnly = Boolean(opening) && !canEdit;

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [carried, setCarried] = useState(false);
  const [safeWithdrawal, setSafeWithdrawal] = useState("");
  const [previousLeave, setPreviousLeave] = useState<{
    business_date: string;
    leave_for_next_day: number;
  } | null>(null);

  const safeBalanceQuery = useSafeBalanceQuery(supabase, open && isOwner && !readOnly);
  const safeBalance = safeBalanceQuery.data ?? 0;

  // Reset state on open + load previous-day-leave hint.
  useEffect(() => {
    if (!open) return;
    setCounts(countsFromOpening(opening));
    setCarried(Boolean(opening?.carried_from_previous_day));
    setSafeWithdrawal(opening?.safe_withdrawal_amount ? String(opening.safe_withdrawal_amount) : "");
    setPreviousLeave(null);
    if (opening || !supabase) return;
    let cancelled = false;
    void loadPreviousDayLeave(supabase, businessDate)
      .then((result) => {
        if (!cancelled && result && result.leave_for_next_day > 0) setPreviousLeave(result);
      })
      .catch(() => {
        // Silent — hint is nice-to-have, never block UI.
      });
    return () => {
      cancelled = true;
    };
  }, [open, opening, supabase, businessDate]);

  const total = computeDenominationTotal(counts);
  const safeWithdrawalAmount = moneyFromInput(safeWithdrawal);
  const carriedAmount = Math.max(0, total - safeWithdrawalAmount);
  const safeOverflow = safeWithdrawalAmount > safeBalance;
  const safeOverTotal = safeWithdrawalAmount > total;

  const isBusy = saveOpeningM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || isBusy || safeOverflow || safeOverTotal) return;
    try {
      await saveOpeningM.mutateAsync({
        business_date: businessDate,
        denominations_json: counts,
        carried_from_previous_day: carried,
        ...(isOwner && safeWithdrawalAmount > 0
          ? { safe_withdrawal_amount: safeWithdrawalAmount }
          : {}),
      });
      toast({
        semantic: "success",
        message:
          safeWithdrawalAmount > 0
            ? `Đã lưu tiền đầu ngày — rút ${formatVND(safeWithdrawalAmount)} từ sổ quỹ.`
            : opening
              ? "Đã cập nhật tiền đầu ngày."
              : "Đã lưu tiền đầu ngày.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được tiền đầu ngày.",
      });
    }
  }

  const titleText = readOnly
    ? "Xem tiền mở két"
    : opening
      ? "Sửa tiền mở két"
      : "Nhập tiền mở két";

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,40rem)]">
        <ModalTitle>{titleText}</ModalTitle>
        <ModalDescription>
          Tiền đầu ngày — {businessDate}
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {readOnly && (
            <AlertBanner variant="info">
              Tiền đầu ngày đã lưu. Manager chỉ được xem; chủ quán mới được chỉnh sửa.
            </AlertBanner>
          )}
          {previousLeave && !readOnly && (
            <AlertBanner variant="info">
              <strong>Báo cáo chốt két ngày {previousLeave.business_date}</strong> đã để lại{" "}
              <strong>{formatVND(previousLeave.leave_for_next_day)}</strong> cho hôm nay. Đếm tờ tiền — tổng nên khớp với số này. (KHÔNG auto-fill, đếm tay để xác nhận.)
            </AlertBanner>
          )}
          <DenominationGrid
            value={counts}
            onChange={setCounts}
            readOnly={readOnly}
            disabled={isBusy}
            showQuickAdd={false}
            totalLabel="Tổng tiền đầu ngày"
          />
          <Checkbox
            label="Chuyển từ tiền cuối ngày trước"
            checked={carried}
            onCheckedChange={(checked) => setCarried(checked === true)}
            disabled={readOnly || isBusy}
          />
          {isOwner && !readOnly && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted">Rút từ sổ quỹ (tùy chọn)</p>
              <p className="text-xs text-muted">
                Số dư sổ quỹ: <strong>{formatVND(safeBalance)}</strong>. Rút bao nhiêu sẽ trừ trực tiếp khỏi sổ quỹ và tính vào tiền đầu ngày.
              </p>
              <TextField
                value={safeWithdrawal}
                onChange={(e) => setSafeWithdrawal(e.target.value)}
                inputMode="numeric"
                placeholder="0 = chỉ carry-over"
                disabled={isBusy}
              />
              {safeOverflow && (
                <AlertBanner variant="danger">
                  Sổ quỹ không đủ ({formatVND(safeBalance)}).
                </AlertBanner>
              )}
              {safeOverTotal && (
                <AlertBanner variant="danger">
                  Số rút không được vượt tổng tiền đầu ngày ({formatVND(total)}).
                </AlertBanner>
              )}
              {safeWithdrawalAmount > 0 && !safeOverflow && !safeOverTotal && (
                <p className="text-xs text-muted">
                  Phân bổ: <strong>{formatVND(carriedAmount)}</strong> carry-over từ ngày cũ +{" "}
                  <strong>{formatVND(safeWithdrawalAmount)}</strong> rút từ sổ quỹ.
                </p>
              )}
            </div>
          )}
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Đóng
            </Button>
            {!readOnly && canCreate && (
              <Button
                type="submit"
                variant="primary"
                loading={isBusy}
                disabled={safeOverflow || safeOverTotal || total === 0}
              >
                Lưu tiền đầu ngày
              </Button>
            )}
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

### Step 4.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 4.3 — Commit

- [ ] **Write `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): OpeningCashModal

Three modes: create / edit (owner) / view-only (manager when opening exists).
DenominationGrid (no quick-add) + carried checkbox + safe_withdrawal_amount
(owner only, with sổ quỹ balance hint).

Previous-day-leave hint via loadPreviousDayLeave (silent fail) — shown only
when no opening exists for today, gives cashier a target to verify the
count against yesterday's leave-for-next-day.

useSaveCashDayOpening invalidates cashOpening + dashboard + safe (when
safe_withdrawal_amount > 0).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/opening-cash-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 5: `CashHistorySection`

**Files:**
- Create: `src/features/cash/cash-history-section.tsx`

**Why fifth:** Pure prop-driven display with expand/collapse + admin action buttons. Independent of modals (parent owns modal state).

### Step 5.1 — Create the component

- [ ] **Create `src/features/cash/cash-history-section.tsx`.**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, formatVND } from "@/lib/format";
import type { CashCount } from "@/lib/types";
import { DENOMINATIONS } from "./denominations";

interface CashHistorySectionProps {
  counts: ReadonlyArray<CashCount>;
  isLoading: boolean;
  isFetching: boolean;
  canManage: boolean;
  onEditReport(reportId: string): void;
  onVoidReport(reportId: string): void;
  onEditCount(count: CashCount): void;
}

function countTypeBadge(count: CashCount) {
  if (count.report_status === "voided") {
    return <Badge variant="soft" semantic="danger">Đã hủy</Badge>;
  }
  if (count.count_type === "shift_close") {
    if (count.report_status === "final") {
      return <Badge variant="soft" semantic="success">Chốt két</Badge>;
    }
    return <Badge variant="soft" semantic="warning">Chốt két (pending)</Badge>;
  }
  return <Badge variant="soft" semantic="neutral">Kiểm két nhanh</Badge>;
}

/**
 * History list of today's cash counts (both spot_audit and shift_close).
 *
 * Row collapsed: meta (badge + time + physical + difference + chevron toggle).
 * Row expanded: denomination grid breakdown + POS snapshot + note + admin action buttons.
 *
 * Admin buttons (owner/manager only):
 *  - "Sửa count" — enabled for spot_audit always, shift_close only if report not final
 *  - "Sửa báo cáo" + "Hủy báo cáo" — enabled when count has report_id with status="final"
 *
 * Pattern matches v3 cash-history-section: toggle ONE row open at a time.
 */
export function CashHistorySection({
  counts,
  isLoading,
  isFetching,
  canManage,
  onEditReport,
  onVoidReport,
  onEditCount,
}: CashHistorySectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Lịch sử trong ngày</p>
            <CardTitle>Kiểm két & chốt két</CardTitle>
          </div>
          {isFetching && !isLoading && (
            <span className="text-xs text-muted">Đang cập nhật...</span>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {isLoading && counts.length === 0 ? (
          <EmptyState icon="loader" title="Đang tải..." subtitle="Đang lấy lịch sử kiểm két." />
        ) : counts.length === 0 ? (
          <EmptyState
            icon="banknote"
            title="Chưa có lượt kiểm két nào hôm nay"
            subtitle='Bấm "Kiểm két nhanh" để lưu spot audit, hoặc "Chốt két & tạo báo cáo" để chốt cuối ca.'
          />
        ) : (
          <div className="space-y-2">
            {counts.map((count) => {
              const isExpanded = expandedId === count.id;
              const isVoided = count.report_status === "voided";
              return (
                <article
                  key={count.id}
                  className={cn(
                    "rounded-md border border-border transition-colors",
                    isVoided && "opacity-60 bg-surface-muted"
                  )}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                    onClick={() => toggleExpand(count.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {countTypeBadge(count)}
                      <span className="text-sm text-muted">{formatDateTime(count.counted_at)}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <span className="block text-xs text-muted">Đếm thực</span>
                        <strong className="font-display text-sm text-ink">
                          {formatVND(count.total_physical)}
                        </strong>
                      </div>
                      <div className="text-right">
                        <span className="block text-xs text-muted">Chênh lệch</span>
                        <strong
                          className={cn(
                            "font-display text-sm",
                            count.difference === 0 ? "text-success" : "text-danger"
                          )}
                        >
                          {formatVND(count.difference)}
                        </strong>
                      </div>
                      <Icon
                        name="chevronDown"
                        size={16}
                        className={cn("transition-transform text-muted", isExpanded && "rotate-180")}
                      />
                    </div>
                  </button>
                  {isExpanded && (
                    <CashHistoryDetail
                      count={count}
                      canManage={canManage}
                      onEditReport={onEditReport}
                      onVoidReport={onVoidReport}
                      onEditCount={onEditCount}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CashHistoryDetail({
  count,
  canManage,
  onEditReport,
  onVoidReport,
  onEditCount,
}: {
  count: CashCount;
  canManage: boolean;
  onEditReport(reportId: string): void;
  onVoidReport(reportId: string): void;
  onEditCount(count: CashCount): void;
}) {
  const denominations = count.denominations_json ?? {};
  const hasDenominations = Object.values(denominations).some((value) => Number(value) > 0);
  const canEditReport =
    canManage && Boolean(count.report_id) && count.report_status === "final";
  // Sửa count enabled for spot_audit always; for shift_close only when no final report
  const canEditCount =
    canManage && (count.count_type !== "shift_close" || count.report_status !== "final");

  return (
    <div className="border-t border-border px-3 py-3 space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Chi tiết mệnh giá</p>
          {!hasDenominations ? (
            <p className="text-sm text-muted">Không có dữ liệu mệnh giá.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {DENOMINATIONS.map((denom) => {
                const qty = Number(denominations[String(denom)] ?? 0);
                if (qty <= 0) return null;
                return (
                  <li key={denom} className="flex items-center justify-between gap-2">
                    <strong className="text-ink">{formatVND(denom)}</strong>
                    <span className="text-muted">× {formatNumber(qty)}</span>
                    <em className="font-display text-ink not-italic">{formatVND(denom * qty)}</em>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section>
          <p className="text-xs uppercase tracking-wide text-muted mb-2">
            POS & đối soát tại thời điểm đếm
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Tổng POS</dt>
            <dd className="text-right text-ink">{formatVND(count.pos_total ?? 0)}</dd>
            <dt className="text-muted">POS tiền mặt</dt>
            <dd className="text-right text-ink">{formatVND(count.pos_cash_total ?? 0)}</dd>
            <dt className="text-muted">POS chuyển khoản</dt>
            <dd className="text-right text-ink">{formatVND(count.pos_non_cash_total ?? 0)}</dd>
            <dt className="text-muted">Tiền vào ca</dt>
            <dd className="text-right text-ink">{formatVND(count.opening_cash ?? 0)}</dd>
            <dt className="text-muted">Chuyển khoản đã nhận</dt>
            <dd className="text-right text-ink">{formatVND(count.bank_transfer_confirmed ?? 0)}</dd>
            <dt className="text-muted">Tổng đối soát</dt>
            <dd className="text-right text-ink">{formatVND(count.reconciliation_total ?? 0)}</dd>
            <dt className="text-muted">Trạng thái</dt>
            <dd className="text-right text-ink">
              {count.report_id
                ? count.report_status === "final"
                  ? "Đã chốt"
                  : count.report_status === "voided"
                    ? "Đã hủy"
                    : (count.report_status ?? "—")
                : "Chưa chốt"}
            </dd>
          </dl>
        </section>
      </div>
      {count.note && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Ghi chú</p>
          <p className="text-sm text-ink mt-1">{count.note}</p>
        </div>
      )}
      {(canEditReport || canEditCount) && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {canEditCount && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leadingIcon={<Icon name="pencil" size={14} />}
              onClick={() => onEditCount(count)}
            >
              Sửa count
            </Button>
          )}
          {canEditReport && count.report_id && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leadingIcon={<Icon name="pencil" size={14} />}
                onClick={() => onEditReport(count.report_id!)}
              >
                Sửa báo cáo
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leadingIcon={<Icon name="trash" size={14} />}
                onClick={() => onVoidReport(count.report_id!)}
                className="text-danger hover:bg-danger-soft"
              >
                Hủy báo cáo
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

### Step 5.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 5.3 — Commit

- [ ] **Write `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): CashHistorySection list + expand

Per-row collapsed: count_type Badge + time + total_physical + difference
(colored) + chevron toggle. Expanded: denomination breakdown (DESC by denom,
hides zero-count) + POS snapshot dl + note + admin action buttons.

Admin buttons (canManage only):
- "Sửa count" enabled for spot_audit always, shift_close only when no
  final report (workflow: void first to edit)
- "Sửa báo cáo" + "Hủy báo cáo" shown when count has report_id with
  status=final

Voided rows: opacity-60 + bg-surface-muted (visually de-emphasized but
still readable for audit trail).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/cash-history-section.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 6: `EditCashCountModal`

**Files:**
- Create: `src/features/cash/edit-cash-count-modal.tsx`

**Why sixth:** Standalone admin modal. Uses DenominationGrid + computes live reconciliation preview.

### Step 6.1 — Create the component

- [ ] **Create `src/features/cash/edit-cash-count-modal.tsx`.**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
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
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateCashCount } from "@/hooks/mutations/use-cash-mutations";
import { cn } from "@/lib/cn";
import { formatDateTime, formatVND, moneyFromInput } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { CashCount } from "@/lib/types";
import { DenominationGrid } from "./denomination-grid";
import { computeDenominationTotal } from "./cash-math";
import { DENOMINATIONS } from "./denominations";

interface EditCashCountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  count: CashCount | null;
}

function countsFromCashCount(count: CashCount | null): Record<string, number> {
  if (!count) return {};
  const result: Record<string, number> = {};
  for (const denom of DENOMINATIONS) {
    result[String(denom)] = Number(count.denominations_json?.[String(denom)] ?? 0);
  }
  return result;
}

/**
 * Admin edit cash_count denominations + bank_transfer + note. RPC will
 * recompute physical/theory/reconciliation/difference + re-snapshot
 * cash_drawer_events. UI shows live preview (delta-based) — final values
 * come from server.
 *
 * Reject if shift_close + report_status === "final" (parent disables
 * "Sửa count" button; RPC also rejects defense-in-depth).
 */
export function EditCashCountModal({
  open,
  onOpenChange,
  count,
}: EditCashCountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateCashCount(supabase, count?.business_date ?? "");

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [bankTransfer, setBankTransfer] = useState("");
  const [note, setNote] = useState("");

  // Reset on open + count change.
  useEffect(() => {
    if (open && count) {
      setCounts(countsFromCashCount(count));
      setBankTransfer(String(count.bank_transfer_confirmed ?? 0));
      setNote(count.note ?? "");
    }
  }, [open, count?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const physical = useMemo(() => computeDenominationTotal(counts), [counts]);
  const bankTransferValue = moneyFromInput(bankTransfer);

  // Live preview reconciliation (delta-based, mirrors v3 logic).
  const reconciliationPreview = useMemo(() => {
    if (!count) return 0;
    const cachedReconciliation = Number(count.reconciliation_total ?? 0);
    const cachedPhysical = Number(count.total_physical ?? 0);
    const cachedBankTransfer = Number(count.bank_transfer_confirmed ?? 0);
    return cachedReconciliation + (physical - cachedPhysical) + (bankTransferValue - cachedBankTransfer);
  }, [count, physical, bankTransferValue]);

  const posTotal = Number(count?.pos_total ?? 0);
  const differencePreview = posTotal - reconciliationPreview;

  if (!count) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const initialDenoms = countsFromCashCount(count);
  const denomsDirty = DENOMINATIONS.some(
    (d) => (counts[String(d)] ?? 0) !== (initialDenoms[String(d)] ?? 0)
  );
  const bankDirty = bankTransferValue !== Number(count.bank_transfer_confirmed ?? 0);
  const noteDirty = note !== (count.note ?? "");
  const dirty = denomsDirty || bankDirty || noteDirty;

  const tooBigBank = bankTransferValue > limits.amount.max;
  const negBank = bankTransferValue < 0;
  const noteTooLong = note.length > limits.note;
  const hasError = tooBigBank || negBank || noteTooLong;
  const isShiftClose = count.count_type === "shift_close";
  const isBusy = updateM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!count || hasError || !dirty || isBusy) return;
    try {
      const denomsToSubmit: Record<string, number> = {};
      for (const d of DENOMINATIONS) denomsToSubmit[String(d)] = counts[String(d)] ?? 0;
      const result = await updateM.mutateAsync({
        id: count.id,
        denominations_json: denomsDirty ? denomsToSubmit : undefined,
        bank_transfer_confirmed: bankDirty ? bankTransferValue : undefined,
        note: noteDirty ? note : undefined,
      });
      toast({
        semantic: "success",
        message: `Đã sửa kiểm két. Đếm thực ${formatVND(result.total_physical)}, chênh lệch ${formatVND(result.difference)}.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được kiểm két.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,42rem)]">
        <ModalTitle>{formatVND(physical)}</ModalTitle>
        <ModalDescription>
          {isShiftClose ? "Sửa chốt két" : "Sửa kiểm két nhanh"} · {formatDateTime(count.counted_at)}
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <dl className="grid grid-cols-3 gap-3 rounded-md border border-border bg-surface-muted p-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Loại</dt>
              <dd className="text-ink">{isShiftClose ? "Chốt két" : "Kiểm két nhanh"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Tiền vào ca</dt>
              <dd className="text-ink">{formatVND(count.opening_cash ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Tổng POS</dt>
              <dd className="text-ink">{formatVND(posTotal)}</dd>
            </div>
          </dl>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Số tờ tiền</p>
            <DenominationGrid
              value={counts}
              onChange={setCounts}
              disabled={isBusy}
              showQuickAdd={false}
              totalLabel="Tổng đếm"
            />
          </div>

          <TextField
            label="Chuyển khoản đã nhận"
            value={bankTransfer}
            onChange={(e) => setBankTransfer(e.target.value)}
            inputMode="numeric"
            disabled={isBusy}
            error={negBank ? "Không được âm." : tooBigBank ? `Vượt ${formatVND(limits.amount.max)}.` : undefined}
          />

          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={limits.note}
            rows={2}
            disabled={isBusy}
            helper={`${note.length}/${limits.note} ký tự`}
            error={noteTooLong ? `Vượt ${limits.note} ký tự.` : undefined}
          />

          <div className="grid grid-cols-3 gap-3 rounded-md border border-border p-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Đếm thực</p>
              <strong className="block font-display text-ink">{formatVND(physical)}</strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Đối soát (preview)</p>
              <strong className="block font-display text-ink">{formatVND(reconciliationPreview)}</strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Chênh lệch (preview)</p>
              <strong
                className={cn(
                  "block font-display",
                  differencePreview === 0 ? "text-success" : "text-danger"
                )}
              >
                {formatVND(differencePreview)}
              </strong>
            </div>
          </div>
          <p className="text-xs text-muted">
            Server sẽ tính lại fresh khi lưu (expense + payroll + theory mới nhất).
          </p>

          <ModalActions>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={hasError || !dirty}
              leadingIcon={<Icon name="save" size={16} />}
            >
              Lưu thay đổi
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

### Step 6.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 6.3 — Commit

- [ ] **Write `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): EditCashCountModal

Admin edit denominations + bank_transfer + note of an existing cash_count.
DenominationGrid (no quick-add for compact admin UX) + meta dl (loại,
tiền vào ca, tổng POS read-only) + bank-transfer TextField with error +
Textarea note with char counter + live preview reconciliation (delta-based).

Server-side recompute on save is authoritative; UI shows preview only.
RPC update_cash_count rejects when count is shift_close with final report
(workflow: void first to edit).

useUpdateCashCount invalidates cashCounts + dashboard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/edit-cash-count-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 7: `LeaveDenominationPopup`

**Files:**
- Create: `src/features/cash/leave-denomination-popup.tsx`

**Why seventh:** Nested popup used by EditCashCloseModal (Task 8). Self-contained component — landing it first lets Task 8 just import + wire.

### Step 7.1 — Create the component

- [ ] **Create `src/features/cash/leave-denomination-popup.tsx`.**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { formatVND } from "@/lib/format";
import { DenominationGrid } from "./denomination-grid";
import {
  computeDenominationTotal,
  computeGreedyLeaveBreakdown,
  isLeaveAmountValid,
} from "./cash-math";

interface LeaveDenominationPopupProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Target leave amount from parent (current input value). Used to seed greedy breakdown. */
  initialValue: number;
  /** physical_cash of the report — leave cannot exceed. */
  maxValue: number;
  /** Save callback — receives final total. Parent updates its leave input + closes popup. */
  onConfirm(total: number): void;
}

/**
 * Nested popup inside EditCashCloseModal. User clicks calculator icon next
 * to the "Để lại cho ngày mai" input → this popup opens → user counts by
 * denomination → on Save, total is sent back to parent and popup closes.
 *
 * Seed strategy: greedy breakdown from initialValue (e.g. 237_000 → 200k×1
 * + 20k×1 + 10k×1 + 5k×1 + 2k×1). User can adjust.
 *
 * Validation: total must be ≤ maxValue (physical_cash). Submit disabled if
 * overflow.
 */
export function LeaveDenominationPopup({
  open,
  onOpenChange,
  initialValue,
  maxValue,
  onConfirm,
}: LeaveDenominationPopupProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Re-seed on open. Subsequent reopens with same initialValue re-seed too —
  // that's intentional (user revisiting the popup wants fresh breakdown).
  useEffect(() => {
    if (open) {
      setCounts(computeGreedyLeaveBreakdown(initialValue));
    }
  }, [open, initialValue]);

  const total = useMemo(() => computeDenominationTotal(counts), [counts]);
  const valid = isLeaveAmountValid(total, maxValue);

  function handleSave() {
    if (!valid) return;
    onConfirm(total);
    onOpenChange(false);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>{formatVND(total)}</ModalTitle>
        <ModalDescription>
          Đếm để lại ngày mai · Tối đa {formatVND(maxValue)} (= đếm thực). Phần dư tự nạp sổ quỹ.
        </ModalDescription>
        <div className="mt-6 space-y-4">
          <DenominationGrid
            value={counts}
            onChange={setCounts}
            showQuickAdd={false}
            totalLabel="Tổng để lại"
          />
          {!valid && (
            <AlertBanner variant="danger">
              Vượt đếm thực ({formatVND(maxValue)}). Giảm bớt trước khi lưu.
            </AlertBanner>
          )}
        </div>
        <ModalActions>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!valid}
            onClick={handleSave}
            leadingIcon={<Icon name="save" size={14} />}
          >
            Lưu {formatVND(total)}
          </Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
```

### Step 7.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 7.3 — Commit

- [ ] **Write `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): LeaveDenominationPopup

Nested popup for counting leave-for-next-day by denomination. Used by
EditCashCloseModal (Task 8) — owner clicks calculator icon to open.

Seeds greedy breakdown from initialValue via computeGreedyLeaveBreakdown
(e.g. 237k -> 200k+20k+10k+5k+2k). User can adjust.

Validation via isLeaveAmountValid: total <= maxValue (physical_cash).
Submit disabled if overflow. On Save, total sent to parent via onConfirm
callback and popup closes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/leave-denomination-popup.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 8: `EditCashCloseModal`

**Files:**
- Create: `src/features/cash/edit-cash-close-modal.tsx`

**Why eighth:** Admin edit final report. Mounts the LeaveDenominationPopup (Task 7) as nested Modal sibling.

### Step 8.1 — Create the component

- [ ] **Create `src/features/cash/edit-cash-close-modal.tsx`.**

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
import { AlertBanner } from "@/components/ui/alert-banner";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useEditCashCloseReport } from "@/hooks/mutations/use-cash-mutations";
import { loadCashCloseReport } from "@/lib/data";
import { cn } from "@/lib/cn";
import { formatVND, moneyFromInput } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { CashCloseReport } from "@/lib/types";
import { LeaveDenominationPopup } from "./leave-denomination-popup";

interface EditCashCloseModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  reportId: string | null;
  businessDate: string;
}

/**
 * Edit final cash_close_report. Editable: note + leave_for_next_day.
 * Snapshot fields (POS, opening, physical) immutable — to change those,
 * void the report and chốt két fresh.
 *
 * Side effect: leave change → RPC inserts adjustment safe_transaction to
 * keep safe balance consistent.
 *
 * One-shot loadCashCloseReport on open (not TanStack query because the
 * report is editable here; we don't want stale-while-revalidate).
 */
export function EditCashCloseModal({
  open,
  onOpenChange,
  reportId,
  businessDate,
}: EditCashCloseModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const editM = useEditCashCloseReport(supabase, businessDate);

  const [report, setReport] = useState<CashCloseReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [note, setNote] = useState("");
  const [leaveInput, setLeaveInput] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);

  useEffect(() => {
    if (!open || !reportId || !supabase) return;
    let cancelled = false;
    setIsLoading(true);
    setReport(null);
    void loadCashCloseReport(supabase, reportId)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        if (r) {
          setNote(r.note ?? "");
          setLeaveInput(String(r.leave_for_next_day ?? 0));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          semantic: "danger",
          message: err instanceof Error ? err.message : "Không tải được báo cáo.",
        });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reportId, supabase, toast]);

  const leaveValue = moneyFromInput(leaveInput);
  const newDeposit = report ? Math.max(0, report.physical_cash - leaveValue) : 0;
  const diff = report ? newDeposit - report.safe_deposit_amount : 0;
  const noteChanged = report ? (note ?? "") !== (report.note ?? "") : false;
  const leaveChanged = report ? leaveValue !== report.leave_for_next_day : false;
  const dirty = noteChanged || leaveChanged;
  const tooBig = report ? leaveValue > report.physical_cash : false;
  const tooSmall = leaveValue < 0;
  const noteTooLong = note.length > limits.note;
  const hasError = tooBig || tooSmall || noteTooLong || !dirty;
  const isBusy = editM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report || !reportId || hasError || isBusy) return;
    try {
      await editM.mutateAsync({
        reportId,
        note: noteChanged ? note : null,
        leaveForNextDay: leaveChanged ? leaveValue : null,
      });
      toast({
        semantic: "success",
        message:
          diff === 0
            ? "Đã cập nhật ghi chú."
            : `Đã sửa và điều chỉnh sổ quỹ ${diff > 0 ? "+" : ""}${formatVND(diff)}.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được báo cáo.",
      });
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange}>
        <ModalContent>
          <ModalTitle>{report ? `Ngày ${report.business_date}` : "Đang tải..."}</ModalTitle>
          <ModalDescription>
            {report
              ? `Đếm thực ${formatVND(report.physical_cash)} · Hiện đang nạp ${formatVND(report.safe_deposit_amount)} vào sổ quỹ`
              : "Sửa báo cáo chốt két"}
          </ModalDescription>
          {isLoading && (
            <div className="flex justify-center py-8">
              <Spinner size={24} />
            </div>
          )}
          {!isLoading && report && (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <Textarea
                label="Ghi chú"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={limits.note}
                rows={2}
                placeholder="VD: Sửa số liệu sau khi đối soát lại..."
                disabled={isBusy}
                helper={`${note.length}/${limits.note} ký tự`}
                error={noteTooLong ? `Vượt ${limits.note} ký tự.` : undefined}
              />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <TextField
                    label="Để lại cho ngày mai"
                    value={leaveInput}
                    onChange={(e) => setLeaveInput(e.target.value)}
                    inputMode="numeric"
                    placeholder="0"
                    disabled={isBusy}
                    helper={`Tối đa ${formatVND(report.physical_cash)}. Phần dư tự nạp sổ quỹ.`}
                    error={
                      tooSmall
                        ? "Không được âm."
                        : tooBig
                          ? `Vượt đếm thực (${formatVND(report.physical_cash)}).`
                          : undefined
                    }
                  />
                </div>
                <IconButton
                  type="button"
                  icon="calculator"
                  size={40}
                  variant="secondary"
                  aria-label="Đếm theo mệnh giá"
                  disabled={isBusy}
                  onClick={() => setPopupOpen(true)}
                />
              </div>
              {leaveChanged && diff !== 0 && (
                <AlertBanner variant={diff > 0 ? "success" : "warning"}>
                  {diff > 0
                    ? `Sẽ nạp thêm ${formatVND(diff)} vào sổ quỹ.`
                    : `Sẽ rút ${formatVND(Math.abs(diff))} khỏi sổ quỹ.`}
                </AlertBanner>
              )}
              <ModalActions>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                  Hủy
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={isBusy}
                  disabled={hasError}
                  leadingIcon={<Icon name="pencil" size={16} />}
                >
                  Lưu thay đổi
                </Button>
              </ModalActions>
            </form>
          )}
        </ModalContent>
      </Modal>

      {/* Nested popup. Separate Modal Root with own open state. */}
      <LeaveDenominationPopup
        open={popupOpen}
        onOpenChange={setPopupOpen}
        initialValue={leaveValue}
        maxValue={report?.physical_cash ?? 0}
        onConfirm={(total) => setLeaveInput(String(total))}
      />
    </>
  );
}
```

### Step 8.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 8.3 — Commit

- [ ] **Write `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): EditCashCloseModal with nested LeaveDenominationPopup

One-shot load via loadCashCloseReport (not TanStack — report is editable
here, no stale-while-revalidate needed). Edits note + leave_for_next_day
only; snapshot fields (POS, opening, physical) immutable.

Nested LeaveDenominationPopup: calculator IconButton beside the leave
TextField opens the popup; user counts by mệnh giá; on confirm, total
returns to leave input. Two Modal Roots (sibling, not nested in JSX) —
Radix portals each separately. Same pattern as 3B.1 ExpenseEditModal's
nested confirm-delete.

Live preview AlertBanner shows safe-deposit adjustment:
- diff > 0 (more leave) → "Sẽ nạp thêm X vào sổ quỹ" (success)
- diff < 0 (less leave) → "Sẽ rút Y khỏi sổ quỹ" (warning)

useEditCashCloseReport invalidates cashCounts + reports + safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/edit-cash-close-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 9: `VoidCashCloseModal`

**Files:**
- Create: `src/features/cash/void-cash-close-modal.tsx`

**Why ninth:** Last admin modal. One-shot loadCashCloseReport + reason text + reverse-deposit preview.

### Step 9.1 — Create the component

- [ ] **Create `src/features/cash/void-cash-close-modal.tsx`.**

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
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useVoidCashCloseReport } from "@/hooks/mutations/use-cash-mutations";
import { loadCashCloseReport } from "@/lib/data";
import { formatVND } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { CashCloseReport } from "@/lib/types";

interface VoidCashCloseModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  reportId: string | null;
  businessDate: string;
}

const REASON_MIN = 5;

/**
 * Void final cash_close_report. Reason required (≥5 chars for audit trail).
 * RPC marks report voided + inserts adjustment safe_transaction (reverse
 * the original safe_deposit). If safe doesn't have enough balance left
 * (e.g. funds already withdrawn next day), RPC rejects.
 *
 * Report stays in DB with status="voided" — never hard-deleted, preserves
 * audit log.
 */
export function VoidCashCloseModal({
  open,
  onOpenChange,
  reportId,
  businessDate,
}: VoidCashCloseModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const voidM = useVoidCashCloseReport(supabase, businessDate);

  const [report, setReport] = useState<CashCloseReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open || !reportId || !supabase) return;
    let cancelled = false;
    setIsLoading(true);
    setReport(null);
    setReason("");
    void loadCashCloseReport(supabase, reportId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          semantic: "danger",
          message: err instanceof Error ? err.message : "Không tải được báo cáo.",
        });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reportId, supabase, toast]);

  const reasonTrimmed = reason.trim();
  const reasonShort = reasonTrimmed.length < REASON_MIN;
  const reasonTooLong = reason.length > limits.note;
  const hasError = reasonShort || reasonTooLong;
  const isBusy = voidM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report || !reportId || hasError || isBusy) return;
    try {
      const result = await voidM.mutateAsync({ reportId, reason: reasonTrimmed });
      toast({
        semantic: "success",
        message:
          result.reversed_safe_amount > 0
            ? `Đã hủy và reverse ${formatVND(result.reversed_safe_amount)} khỏi sổ quỹ.`
            : "Đã hủy báo cáo.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không hủy được báo cáo.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{report ? `Ngày ${report.business_date}` : "Đang tải..."}</ModalTitle>
        <ModalDescription>
          {report && report.safe_deposit_amount > 0
            ? `Sẽ trả ${formatVND(report.safe_deposit_amount)} về sổ quỹ qua adjustment.`
            : "Hủy báo cáo chốt két"}
        </ModalDescription>
        {isLoading && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}
        {!isLoading && report && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <AlertBanner variant="warning">
              Báo cáo bị đánh dấu <strong>voided</strong>, KHÔNG xóa khỏi DB (giữ audit trail).
              {report.safe_deposit_amount > 0 && (
                <>
                  {" "}Một adjustment ngược <strong>−{formatVND(report.safe_deposit_amount)}</strong> sẽ được tạo trong sổ quỹ. Nếu sổ quỹ không đủ (đã rút khi mở két ngày sau), thao tác sẽ bị từ chối.
                </>
              )}
            </AlertBanner>
            <Textarea
              label="Lý do hủy *"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={limits.note}
              rows={3}
              placeholder="VD: Đếm sai số liệu, cần chốt lại sau khi đối soát POS..."
              disabled={isBusy}
              autoFocus
              helper={`Bắt buộc ≥ ${REASON_MIN} ký tự (ghi vào audit log).`}
              error={
                reason.length > 0 && reasonShort
                  ? `Lý do phải ≥ ${REASON_MIN} ký tự.`
                  : reasonTooLong
                    ? `Vượt ${limits.note} ký tự.`
                    : undefined
              }
            />
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Đóng
              </Button>
              <Button
                type="submit"
                variant="destructive"
                loading={isBusy}
                disabled={hasError}
                leadingIcon={<Icon name="trash" size={16} />}
              >
                Xác nhận hủy
              </Button>
            </ModalActions>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}
```

### Step 9.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 9.3 — Commit

- [ ] **Write `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): VoidCashCloseModal

One-shot load via loadCashCloseReport. Reason Textarea (>=5 chars for
audit trail, max limits.note=1000). AlertBanner warning shows the
reverse-deposit preview + warning if safe doesn't have enough balance.

Submit button "destructive" variant (red) + Trash icon — visually
emphasizes terminal action.

useVoidCashCloseReport invalidates cashCounts + reports + safe.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/void-cash-close-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 10: `CashView` + page.tsx wire

**Files:**
- Create: `src/features/cash/cash-view.tsx`
- Modify: `src/app/page.tsx` (swap cash EmptyState for `<CashView />`)

**Why tenth:** Container assembles all children. Wiring into page.tsx completes the user-visible path.

### Step 10.1 — Create `CashView`

- [ ] **Create `src/features/cash/cash-view.tsx`.**

```tsx
"use client";

import { useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useCashCountsQuery,
  useCashOpeningQuery,
  useDashboardQuery,
} from "@/hooks/queries";
import {
  useSaveCashCount,
  useFinalizeCashClose,
} from "@/hooks/mutations/use-cash-mutations";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatVND, moneyFromInput } from "@/lib/format";
import { validateCashCount } from "@/lib/validation";
import type { CashCount, UserRole } from "@/lib/types";
import { DenominationGrid } from "./denomination-grid";
import { ReconciliationSummary } from "./reconciliation-summary";
import { CashHistorySection } from "./cash-history-section";
import { OpeningCashModal } from "./opening-cash-modal";
import { EditCashCountModal } from "./edit-cash-count-modal";
import { EditCashCloseModal } from "./edit-cash-close-modal";
import { VoidCashCloseModal } from "./void-cash-close-modal";
import { computeDenominationTotal } from "./cash-math";

interface CashViewProps {
  businessDate: string;
  role: UserRole;
}

/**
 * Top-level container for view === "cash". Mounts 3 queries (dashboard for
 * POS + expense + payroll totals; cashOpening for tiền đầu ngày; cashCounts
 * for history). Owns all modal state + denomination grid state + manual POS
 * override state.
 *
 * Two main actions:
 *  - "Kiểm két nhanh" (spot_audit): save cash_count, no report
 *  - "Chốt két & tạo báo cáo" (shift_close): save cash_count → finalize → create report + auto safe_deposit
 *
 * Counts stay after spot_audit (operator may re-audit); reset after shift_close.
 */
export function CashView({ businessDate, role }: CashViewProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const dashboardQuery = useDashboardQuery(supabase, businessDate, true);
  const cashOpeningQuery = useCashOpeningQuery(supabase, businessDate, true);
  const cashCountsQuery = useCashCountsQuery(supabase, businessDate, true);
  const saveCountM = useSaveCashCount(supabase, businessDate);
  const finalizeM = useFinalizeCashClose(supabase, businessDate);

  const canManage = role === "owner" || role === "manager";

  // Main panel state.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [bankTransfer, setBankTransfer] = useState("");
  const [note, setNote] = useState("");
  const [leaveForNextDay, setLeaveForNextDay] = useState("");
  const [isManualPos, setIsManualPos] = useState(false);
  const [manualPosTotal, setManualPosTotal] = useState("");
  const [manualPosCash, setManualPosCash] = useState("");
  const [manualPosNonCash, setManualPosNonCash] = useState("");

  // Modal state.
  const [isOpeningOpen, setIsOpeningOpen] = useState(false);
  const [editingCount, setEditingCount] = useState<CashCount | null>(null);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [voidingReportId, setVoidingReportId] = useState<string | null>(null);

  if (dashboardQuery.isLoading || cashOpeningQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dữ liệu POS">
        {dashboardQuery.error instanceof Error
          ? dashboardQuery.error.message
          : String(dashboardQuery.error)}
      </AlertBanner>
    );
  }

  const dashboard = dashboardQuery.data;
  const cashOpening = cashOpeningQuery.data ?? null;
  const cashCounts = cashCountsQuery.data ?? [];

  // Resolve POS values (manual override OR sync).
  const dashboardPosTotal = dashboard?.total_sales ?? 0;
  const dashboardPosCash = dashboard?.cash_sales ?? 0;
  const dashboardPosNonCash =
    dashboard?.non_cash_sales ?? Math.max(0, dashboardPosTotal - dashboardPosCash);

  const posTotal = isManualPos ? moneyFromInput(manualPosTotal) : dashboardPosTotal;
  const posCash = isManualPos ? moneyFromInput(manualPosCash) : dashboardPosCash;
  const posNonCash = isManualPos
    ? moneyFromInput(manualPosNonCash)
    : dashboardPosNonCash;

  const openingCash =
    cashOpening?.opening_total ??
    dashboard?.opening_cash ??
    dashboard?.latest_cash_count?.opening_cash ??
    0;
  const physical = computeDenominationTotal(counts);
  const bankTransferConfirmed = moneyFromInput(bankTransfer);
  const expenseCashTotal = dashboard?.total_expenses ?? 0;
  const payrollCashTotal = dashboard?.payroll_paid ?? 0;
  const leaveAmount = moneyFromInput(leaveForNextDay);
  const safeDepositPreview = Math.max(0, physical - leaveAmount);

  const canCreateOpening = canManage;
  const canOpenOpeningModal = Boolean(cashOpening) || canCreateOpening;
  const isBusy = saveCountM.isPending || finalizeM.isPending;

  async function submit(mode: "spot_audit" | "shift_close") {
    if (!supabase || isBusy) return;
    const validation = validateCashCount({
      total_physical: physical,
      bank_transfer_confirmed: bankTransferConfirmed,
      note,
      denominations_json: counts,
    });
    if (!validation.ok) {
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    try {
      const saved = await saveCountM.mutateAsync({
        business_date: businessDate,
        count_type: mode,
        counted_at: new Date().toISOString(),
        denominations_json: counts,
        total_physical: physical,
        bank_transfer_confirmed: bankTransferConfirmed,
        note,
        ...(isManualPos
          ? {
              pos_total: posTotal,
              pos_cash_total: posCash,
              pos_non_cash_total: posNonCash,
            }
          : {}),
      });
      let safeDeposit = 0;
      if (mode === "shift_close" && saved.cash_count_id) {
        const result = await finalizeM.mutateAsync({
          cash_count_id: saved.cash_count_id,
          leave_for_next_day: leaveAmount,
        });
        safeDeposit = result.safe_deposit ?? 0;
      }
      toast({
        semantic: "success",
        message:
          mode === "shift_close"
            ? `Đã chốt két${safeDeposit > 0 ? ` và nạp ${formatVND(safeDeposit)} vào sổ quỹ` : ""}.`
            : "Đã lưu kiểm két nhanh.",
      });
      // Reset only after shift_close (spot_audit: counts stay for next audit).
      if (mode === "shift_close") {
        setCounts({});
        setBankTransfer("");
        setNote("");
        setLeaveForNextDay("");
      }
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được kiểm két.",
      });
    }
  }

  const openingButtonLabel = cashOpening
    ? role === "owner"
      ? "Sửa tiền đầu ngày"
      : "Xem tiền đầu ngày"
    : "Nhập tiền đầu ngày";

  return (
    <div className="space-y-6">
      {/* Opening cash card */}
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Tiền đầu ngày</p>
              <CardTitle>
                {cashOpening ? formatVND(cashOpening.opening_total) : "Chưa nhập"}
              </CardTitle>
            </div>
            {canOpenOpeningModal && (
              <Button
                type="button"
                variant={cashOpening ? "secondary" : "primary"}
                onClick={() => setIsOpeningOpen(true)}
                disabled={isBusy}
              >
                {openingButtonLabel}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Main 2-col: DenominationGrid left, ReconciliationSummary right */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader>
            <div className="flex w-full items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Đếm tiền mặt</p>
                <CardTitle>Kiểm két theo mệnh giá</CardTitle>
              </div>
              <strong className="font-display text-base text-ink">{formatVND(physical)}</strong>
            </div>
          </CardHeader>
          <CardBody>
            <DenominationGrid
              value={counts}
              onChange={setCounts}
              disabled={isBusy}
              showQuickAdd={true}
              totalLabel="Tổng đếm"
            />
          </CardBody>
        </Card>

        <ReconciliationSummary
          posTotal={posTotal}
          posCash={posCash}
          posNonCash={posNonCash}
          openingCash={openingCash}
          physical={physical}
          bankTransferConfirmed={bankTransferConfirmed}
          expenseCashTotal={expenseCashTotal}
          payrollCashTotal={payrollCashTotal}
          isManualPos={isManualPos}
          manualPosTotal={manualPosTotal}
          manualPosCash={manualPosCash}
          manualPosNonCash={manualPosNonCash}
          onManualPosToggle={setIsManualPos}
          onManualPosTotalChange={setManualPosTotal}
          onManualPosCashChange={setManualPosCash}
          onManualPosNonCashChange={setManualPosNonCash}
          disabled={isBusy}
        />
      </div>

      {/* Form fields + submit buttons */}
      <Card>
        <CardBody className="space-y-4">
          <TextField
            label="Chuyển khoản đã nhận"
            value={bankTransfer}
            onChange={(e) => setBankTransfer(e.target.value)}
            inputMode="numeric"
            placeholder={formatNumber(posNonCash)}
            disabled={isBusy}
          />
          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Lý do lệch két, tình trạng POS sync..."
            disabled={isBusy}
          />
          <TextField
            label="Để lại cho ngày mai"
            value={leaveForNextDay}
            onChange={(e) => setLeaveForNextDay(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            disabled={isBusy}
            helper={
              `Mặc định 0 = toàn bộ dư nạp vào sổ quỹ. Sổ quỹ sẽ nhận ${formatVND(safeDepositPreview)}.`
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => submit("spot_audit")}
              loading={saveCountM.isPending && !finalizeM.isPending}
              disabled={isBusy || physical === 0}
            >
              Kiểm két nhanh
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => submit("shift_close")}
              loading={isBusy}
              disabled={isBusy || physical === 0}
            >
              Chốt két &amp; tạo báo cáo
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* History */}
      <CashHistorySection
        counts={cashCounts}
        isLoading={cashCountsQuery.isLoading}
        isFetching={cashCountsQuery.isFetching}
        canManage={canManage}
        onEditCount={setEditingCount}
        onEditReport={setEditingReportId}
        onVoidReport={setVoidingReportId}
      />

      {/* Modals */}
      <OpeningCashModal
        open={isOpeningOpen}
        onOpenChange={setIsOpeningOpen}
        opening={cashOpening}
        businessDate={businessDate}
        role={role}
      />
      <EditCashCountModal
        open={editingCount !== null}
        onOpenChange={(next) => {
          if (!next) setEditingCount(null);
        }}
        count={editingCount}
      />
      <EditCashCloseModal
        open={editingReportId !== null}
        onOpenChange={(next) => {
          if (!next) setEditingReportId(null);
        }}
        reportId={editingReportId}
        businessDate={businessDate}
      />
      <VoidCashCloseModal
        open={voidingReportId !== null}
        onOpenChange={(next) => {
          if (!next) setVoidingReportId(null);
        }}
        reportId={voidingReportId}
        businessDate={businessDate}
      />
    </div>
  );
}
```

### Step 10.2 — Modify `src/app/page.tsx`

- [ ] **Add CashView import + swap dispatcher.**

In `src/app/page.tsx`:

1. Add import (alphabetical with feature imports):

```tsx
import { CashView } from "@/features/cash/cash-view";
```

2. Replace the cash locked EmptyState block. Find:

```tsx
        {view === "cash" && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3B.2b"
            subtitle="Chốt két sẽ port ở Phase 3B.2b."
          />
        )}
```

Replace with:

```tsx
        {view === "cash" && (
          <CashView businessDate={businessDate} role={account.role} />
        )}
```

No other changes to page.tsx.

### Step 10.3 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean. `/` route First Load JS grows ~40-60 kB. Target ~290-310 kB total (vs ~252 kB at 3B.2a).

### Step 10.4 — Commit

- [ ] **Write `.git/COMMIT_MSG_TMP`:**

```
feat(phase-3b2b-i): CashView + wire into page.tsx

CashView mounts 3 queries (dashboard for POS/expense/payroll; cashOpening
for tiền đầu ngày; cashCounts for history). Owns 9 state slots:
counts (denomination map), bankTransfer, note, leaveForNextDay,
isManualPos + 3 manualPos*, 4 modal slots (isOpeningOpen, editingCount,
editingReportId, voidingReportId).

Two submit modes:
- "Kiểm két nhanh" (spot_audit): save cash_count; counts stay (for re-audit)
- "Chốt két & tạo báo cáo" (shift_close): save cash_count -> finalize ->
  report + auto safe_deposit; counts reset after success

Manual POS override: 3 inputs override dashboard POS values when enabled.

Layout: opening card (top) -> 2-col grid (DenominationGrid + Reconciliation)
-> form fields card (bankTransfer + note + leave + 2 buttons) -> history
section -> 4 modals (Opening + EditCount + EditClose + Void).

page.tsx now mounts <CashView /> when view==="cash" with account.role for
canManage gating.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/cash/cash-view.tsx src/app/page.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 11: Smoke verify + tag `v4-phase-3b2b-i`

**Files:** (none — verification only)

### Step 11.1 — Verify build clean at HEAD

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean. `/` route ~290-310 kB First Load JS.

### Step 11.2 — Re-run Phase 3A drift scripts

- [ ] **Confirm Phase 3A guards still pass.**

```bash
node tools/verify-role-gate.mjs
node tools/verify-business-date.mjs
```

Expected: both print `✓` success messages.

### Step 11.3 — Scope check (off-limits files untouched)

- [ ] **`git diff --name-only main..HEAD`** — should list only:

```
docs/superpowers/specs/2026-05-20-v4-phase-3b2b-i-cash-design.md
docs/superpowers/plans/2026-05-20-v4-phase-3b2b-i-cash.md
src/app/page.tsx                                    # dispatcher only
src/components/ui/icons.tsx                         # additive +2 icons
src/features/cash/cash-history-section.tsx
src/features/cash/cash-math.ts
src/features/cash/cash-view.tsx
src/features/cash/denomination-grid.tsx
src/features/cash/denominations.ts
src/features/cash/edit-cash-close-modal.tsx
src/features/cash/edit-cash-count-modal.tsx
src/features/cash/leave-denomination-popup.tsx
src/features/cash/opening-cash-modal.tsx
src/features/cash/reconciliation-summary.tsx
src/features/cash/void-cash-close-modal.tsx
src/hooks/mutations/use-cash-mutations.ts
```

Confirm NONE of these appear:
- `src/lib/**`
- `src/hooks/queries/**`
- `src/hooks/use-*.ts` (Phase 1 + 3A)
- `src/hooks/mutations/use-{expense,shift}-mutations.ts`
- `src/middleware.ts`, `src/app/api/**`, `database/**`
- Other `src/components/ui/*.tsx` (only icons.tsx)
- `src/features/{navigation,auth,dashboard,reports,pivot,expenses,shifts}/**`
- `docker-compose.yml`, `supabase/**`, `.env*`

### Step 11.4 — Manual smoke (~18 checks)

- [ ] **Smoke test cash module end-to-end.**

```bash
docker compose up -d
```

Visit `http://localhost:3009`. Owner login (Phase 1 seed): `owner@chill.local` / `chill-owner-2026`.

Click "Chốt két" in the sidebar. Verify in order:

| # | Action | Expected |
|---|---|---|
| 1 | View loads on empty seed | Opening card shows "Chưa nhập" + "Nhập tiền đầu ngày" button (owner sees primary variant). DenominationGrid empty (zeros). ReconciliationSummary shows zeros + formula. History EmptyState. |
| 2 | Click "Nhập tiền đầu ngày" | OpeningCashModal opens create mode. No previous-day-leave hint (first day). Carried checkbox unchecked. Safe withdrawal field visible (owner). |
| 3 | Fill grid 500k×1 + 100k×2 = 700k → save | Toast "Đã lưu tiền đầu ngày". Modal closes. Opening card shows 700k. |
| 4 | In main grid: count 200k×3 = 600k. ReconciliationSummary updates live. | Difference shows posTotal − reconciliation. With no POS data + 600k physical + 700k opening + 0 transfer + 0 expense + 0 payroll → reconciliation = 600 − 700 + 0 + 0 + 0 = −100k → difference = 0 − (−100k) = +100k red. |
| 5 | Click "Kiểm két nhanh" → spot_audit | Toast "Đã lưu kiểm két nhanh". History row appears with "Kiểm két nhanh" badge. Counts STAY in grid (operator can re-audit). |
| 6 | Set leave=50k → expand history row (just inserted) | Detail shows denomination breakdown + POS snapshot dl + admin "Sửa count" button (canManage). |
| 7 | Admin click "Sửa count" on spot_audit row | EditCashCountModal opens with denominations + bank_transfer + note pre-filled. Live preview reconciliation works. |
| 8 | Change bank_transfer to 100k → save | Toast success with new physical + diff. Modal closes. Row updates. |
| 9 | Click "Chốt két & tạo báo cáo" with leave=50k | Toast "Đã chốt két và nạp X vào sổ quỹ". History row "Chốt két" + status "final" badge. Form fields reset (counts/bank/note/leave). |
| 10 | Expand the final row | "Sửa báo cáo" + "Hủy báo cáo" buttons visible (canManage). |
| 11 | Admin click "Sửa báo cáo" | EditCashCloseModal opens. Spinner briefly while loading. Then note + leave fields editable. |
| 12 | Click calculator icon | LeaveDenominationPopup opens (nested Modal sibling). Grid pre-seeded greedy from current leave value. |
| 13 | Adjust to leave=60k → Save | Popup closes. EditCashCloseModal leave input shows 60000. AlertBanner success "Sẽ nạp thêm 10k vào sổ quỹ" (diff=+10k). |
| 14 | Submit edit | Toast "Đã sửa và điều chỉnh sổ quỹ +10k". Modal closes. Row reflects new leave. |
| 15 | Admin click "Hủy báo cáo" | VoidCashCloseModal opens with reverse-deposit preview banner. Reason textarea empty. |
| 16 | Type "Đếm sai" (5 chars exactly) → submit | Toast success "Đã hủy và reverse X khỏi sổ quỹ". History row → "Đã hủy" badge (red). |
| 17 | Try void with reason "Sai" (3 chars) | Submit disabled. Error helper text: "Lý do phải ≥ 5 ký tự." |
| 18 | Sign in as staff_operator (or skip if not seeded) | "Nhập tiền đầu ngày" NOT visible if opening doesn't exist; opening view-only if it does. Main spot_audit/shift_close flow still works. History rows: no expand buttons OR expand without admin action buttons. |

Document any failures:

```
[ ] All 18 smoke checks pass.
[ ] Failures (if any): _____________
```

If a check fails: fix before tagging.

### Step 11.5 — Tag the phase

- [ ] **Tag `v4-phase-3b2b-i`.**

```bash
git tag v4-phase-3b2b-i
git log --oneline main..HEAD
```

Expected: 12 commits (2 docs + 10 implementation tasks).

---

## End-of-phase checklist

Before declaring Phase 3B.2b.i complete:

- [ ] `npm run build` clean.
- [ ] Both drift scripts pass.
- [ ] All 18 smoke checks pass.
- [ ] Scope check: only allowed file paths modified.
- [ ] Tag `v4-phase-3b2b-i` on final commit.
- [ ] Branch `phase-3b2b-i-cash` ready for merge to main.
