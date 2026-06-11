import type { StockBalance, IngredientReferencePrice } from "@/lib/types";

/**
 * Tính giá trị tồn kho theo đơn giá tham chiếu (owner-only).
 * Spec: docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md
 */

/** Giá trị tồn 1 dòng = round(tồn × giá) về VND nguyên; null nếu chưa có giá. */
export function rowValue(balance: number, unitPrice: number | null | undefined): number | null {
  if (unitPrice == null) return null;
  return Math.round(balance * unitPrice);
}

/** Tổng giá trị kho (chỉ dòng CÓ giá, gồm cả giá trị âm) + số NL chưa đặt giá. */
export function stockTotals(
  balances: ReadonlyArray<StockBalance>,
  prices: ReadonlyMap<string, IngredientReferencePrice>
): { total: number; missingCount: number } {
  let total = 0;
  let missingCount = 0;
  for (const b of balances) {
    const v = rowValue(b.theoretical_balance, prices.get(b.ingredient_id)?.unit_price);
    if (v == null) missingCount += 1;
    else total += v;
  }
  return { total, missingCount };
}
