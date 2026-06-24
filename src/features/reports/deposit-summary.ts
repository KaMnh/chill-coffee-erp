import type { CashCloseReport } from "@/lib/types";

export interface DayDeposit {
  /** Tiền mặt nạp quỹ khi chốt (= safe_deposit_amount). */
  cash: number;
  /** Chuyển khoản xác nhận khi chốt (= bank_transfer_confirmed). */
  transfer: number;
}

/**
 * Nạp két của RIÊNG một ngày từ báo cáo chốt két.
 * voided → 0/0 vì khoản nạp đã bị đảo ngược qua adjustment (xem void RPC).
 */
export function depositForDay(report: CashCloseReport): DayDeposit {
  if (report.report_status === "voided") {
    return { cash: 0, transfer: 0 };
  }
  return {
    cash: report.safe_deposit_amount ?? 0,
    transfer: report.bank_transfer_confirmed ?? 0
  };
}
