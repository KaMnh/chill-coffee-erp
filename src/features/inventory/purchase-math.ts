/**
 * Toán thuần cho form "Nhập nguyên liệu từ sổ quỹ" (F1+F2) — quy đổi 2 chiều
 * Số lượng ↔ Thành tiền theo đơn giá, và tổng đơn nhập.
 */

/** Thành tiền một dòng = SL × đơn giá. Input rác → 0. */
export function lineAmount(quantity: number, unitPrice: number): number {
  return (Number(quantity) || 0) * (Number(unitPrice) || 0);
}

/** Quy đổi ngược: SL = thành tiền / đơn giá (đơn giá ≤ 0 → 0, không chia 0). */
export function deriveQuantity(amount: number, unitPrice: number): number {
  const p = Number(unitPrice) || 0;
  return p > 0 ? (Number(amount) || 0) / p : 0;
}

/** Tổng đơn nhập = Σ thành tiền các dòng. */
export function purchaseTotal(
  lines: ReadonlyArray<{ quantity: number; unitPrice: number }>
): number {
  return lines.reduce((sum, line) => sum + lineAmount(line.quantity, line.unitPrice), 0);
}
