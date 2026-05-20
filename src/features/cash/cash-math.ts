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
