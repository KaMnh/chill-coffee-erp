/**
 * Tách một khoản chi giữa 2 quỹ sổ quỹ (Sổ quỹ 2 quỹ): chuyển khoản trước,
 * tiền mặt bù phần thiếu. Thuần — dùng chung cho Rút khác (F4) và Nhập NL (F1).
 */

export type FundSplit = { cash: number; transfer: number };

/**
 * Mặc định thông minh: transfer = min(total, số dư CK khả dụng), cash = phần
 * còn lại. Số dư CK âm (dữ liệu hỏng) coi như 0 — không bao giờ trả cash > total.
 * Làm tròn xuống số nguyên VND.
 */
export function defaultFundSplit(total: number, transferBalance: number): FundSplit {
  const totalInt = Math.floor(Number(total) || 0);
  const available = Math.max(0, Math.floor(Number(transferBalance) || 0));
  const transfer = Math.min(totalInt, available);
  return { cash: totalInt - transfer, transfer };
}

/**
 * Split hợp lệ khi: 2 phần nguyên không âm, cộng đúng bằng total (floor về VND),
 * và mỗi phần không vượt số dư quỹ tương ứng.
 */
export function isFundSplitValid(
  split: FundSplit,
  total: number,
  cashBalance: number,
  transferBalance: number
): boolean {
  return (
    Number.isInteger(split.cash) &&
    Number.isInteger(split.transfer) &&
    split.cash >= 0 &&
    split.transfer >= 0 &&
    split.cash + split.transfer === Math.floor(Number(total) || 0) &&
    split.cash <= cashBalance &&
    split.transfer <= transferBalance
  );
}
