import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashCloseReport } from "@/lib/types";
import { toAppError, unwrapJson } from "./_common";

export async function finalizeCashCloseReport(
  supabase: SupabaseClient,
  cashCountId: string,
  options: { leaveForNextDay?: number } = {}
) {
  const { data, error } = await supabase.rpc("finalize_cash_close_report", {
    p_cash_count_id: cashCountId,
    p_leave_for_next_day: Math.max(0, Number(options.leaveForNextDay ?? 0))
  });
  if (error) throw toAppError(error, "Không chốt được báo cáo két.");
  return data as { report_id?: string; safe_deposit?: number };
}

export async function loadCashCloseReportsByDate(supabase: SupabaseClient, businessDate: string) {
  const { data, error } = await supabase.rpc("get_cash_close_reports_by_date", {
    p_business_date: businessDate
  });
  if (error) throw toAppError(error, "Không tải được danh sách báo cáo.");
  return unwrapJson<CashCloseReport[]>(data, []);
}

export async function loadCashCloseReport(supabase: SupabaseClient, reportId: string) {
  const { data, error } = await supabase.rpc("get_cash_close_report", { p_report_id: reportId });
  if (error) throw toAppError(error, "Không tải được báo cáo.");
  return unwrapJson<CashCloseReport | null>(data, null);
}

/**
 * Hủy báo cáo chốt két đã final. Tự động reverse safe deposit qua adjustment.
 * Yêu cầu owner/manager. Reason ≥ 5 ký tự.
 */
export async function voidCashCloseReport(
  supabase: SupabaseClient,
  reportId: string,
  reason: string
) {
  const { data, error } = await supabase.rpc("void_cash_close_report", {
    p_report_id: reportId,
    p_reason: reason
  });
  if (error) throw toAppError(error, "Không hủy được báo cáo.");
  return data as {
    report_id: string;
    status: "voided";
    reversed_safe_amount: number;
    adjustment_id?: string;
  };
}

/**
 * Sửa báo cáo chốt két đã final. Cho phép thay đổi note + leave_for_next_day.
 * Side effect: leave đổi → INSERT adjustment vào sổ quỹ để bù khoản chênh.
 * Yêu cầu owner/manager. Pass null để giữ field nguyên không đổi.
 */
export async function editCashCloseReport(
  supabase: SupabaseClient,
  reportId: string,
  payload: { note?: string | null; leaveForNextDay?: number | null }
) {
  const { data, error } = await supabase.rpc("edit_cash_close_report", {
    p_report_id: reportId,
    p_note: payload.note ?? null,
    p_leave_for_next_day:
      payload.leaveForNextDay === null || payload.leaveForNextDay === undefined
        ? null
        : Math.max(0, Number(payload.leaveForNextDay))
  });
  if (error) throw toAppError(error, "Không sửa được báo cáo.");
  return data as {
    report_id: string;
    note: string | null;
    leave_for_next_day: number;
    safe_deposit_amount: number;
    safe_diff: number;
    adjustment_id?: string;
  };
}
