import { defaultFundSplit, type FundSplit } from "@/features/safe/fund-split";
import type { SafeBalances } from "@/lib/types";

/**
 * Kết toán kỳ: người dùng nhập "số vốn để lại" (float), phần rút = số dư − float.
 * Tách phần rút theo quỹ bằng defaultFundSplit (rút CHUYỂN KHOẢN trước → phần
 * để lại ưu tiên là TIỀN MẶT — đúng nhu cầu vận hành quán, spec §5).
 * Float âm/NaN coi như 0 (rút hết); floor về VND nguyên.
 */
export function drawFromFloat(balances: SafeBalances, floatTotal: number): FundSplit {
  const safeFloat = Math.max(0, Math.floor(Number(floatTotal) || 0));
  const drawTotal = Math.max(0, balances.total - safeFloat);
  return defaultFundSplit(drawTotal, balances.transfer);
}
