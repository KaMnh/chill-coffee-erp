import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashCount, CashDayOpening } from "@/lib/types";
import { toAppError, unwrapJson } from "./_common";

export async function saveCashCount(supabase: SupabaseClient, payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("save_cash_count", { p_payload: payload });
  if (error) throw toAppError(error, "Không lưu được kiểm két.");
  return data as { cash_count_id?: string; difference?: number };
}

/**
 * Sửa cash_count đã tạo (denominations + bank_transfer + note). RPC tự
 * recompute physical/theory/reconciliation/difference + sync
 * cash_drawer_events snapshot. Owner/manager only. Reject nếu shift_close
 * có cash_close_report status='final'.
 */
export async function updateCashCount(
  supabase: SupabaseClient,
  payload: {
    id: string;
    denominations_json?: Record<string, number>;
    bank_transfer_confirmed?: number;
    note?: string | null;
  }
) {
  const { data, error } = await supabase.rpc("update_cash_count", { p_payload: payload });
  if (error) throw toAppError(error, "Không sửa được kiểm két.");
  return data as {
    cash_count_id: string;
    total_physical: number;
    difference: number;
    reconciliation_total: number;
  };
}

/**
 * Trả về tất cả cash_counts trong ngày (cả spot_audit lẫn shift_close).
 * Server-side đã sort desc theo counted_at.
 */
export async function loadCashCountsByDate(
  supabase: SupabaseClient,
  businessDate: string
): Promise<CashCount[]> {
  const { data, error } = await supabase.rpc("list_cash_counts", {
    p_business_date: businessDate
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("list_cash_counts") || message.includes("Could not find the function")) {
      throw new Error(
        "Supabase chưa có RPC list_cash_counts. Hãy apply lại database/002_functions.sql rồi thử lại."
      );
    }
    throw toAppError(error, "Không tải được lịch sử kiểm két.");
  }
  return unwrapJson<CashCount[]>(data, []) ?? [];
}

export async function loadCashDayOpening(supabase: SupabaseClient, businessDate: string) {
  const { data, error } = await supabase
    .from("cash_day_openings")
    .select("id, business_date, denominations_json, opening_total, carried_from_previous_day, carried_amount, safe_withdrawal_amount, created_by, created_at, updated_at")
    .eq("business_date", businessDate)
    .maybeSingle();
  if (error) throw toAppError(error, "Không tải được tiền đầu ngày.");
  return (data ?? null) as CashDayOpening | null;
}

/**
 * Lấy `leave_for_next_day` của báo cáo chốt két final gần nhất TRƯỚC `businessDate`.
 * Dùng cho hint trong OpeningCashModal: "Hôm qua để lại X — đếm để verify".
 *
 * Trả null nếu không có previous report (ngày đầu tiên dùng app, hoặc tất cả
 * báo cáo trước đó đã voided).
 */
export async function loadPreviousDayLeave(
  supabase: SupabaseClient,
  businessDate: string
): Promise<{ business_date: string; leave_for_next_day: number } | null> {
  const { data, error } = await supabase
    .from("cash_close_reports")
    .select("business_date, leave_for_next_day")
    .lt("business_date", businessDate)
    .eq("report_status", "final")
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw toAppError(error, "Không tải được số tiền để lại từ ngày trước.");
  return data
    ? { business_date: data.business_date, leave_for_next_day: Number(data.leave_for_next_day ?? 0) }
    : null;
}

export async function saveCashDayOpening(
  supabase: SupabaseClient,
  payload: {
    business_date: string;
    denominations_json: Record<string, number>;
    carried_from_previous_day?: boolean;
    /** Optional: số tiền rút từ sổ quỹ (owner only, > 0). RPC validate ≤ opening_total. */
    safe_withdrawal_amount?: number;
  }
) {
  const denominations = Object.fromEntries(
    Object.entries(payload.denominations_json).map(([denomination, count]) => [
      String(denomination),
      Math.max(0, Number(count) || 0)
    ])
  );
  const rpcPayload = {
    ...payload,
    denominations_json: denominations
  };
  const { data, error } = await supabase.rpc("save_cash_day_opening", { p_payload: rpcPayload });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("save_cash_day_opening") || message.includes("Could not find the function")) {
      throw new Error(
        "Supabase chưa có RPC save_cash_day_opening. Hãy apply lại file database/002_functions.sql và database/003_rls.sql rồi thử lưu lại."
      );
    }
    throw toAppError(error, "Không lưu được tiền đầu ngày.");
  }
  return unwrapJson<CashDayOpening>(data, {
    id: "",
    business_date: payload.business_date,
    denominations_json: denominations,
    opening_total: 0,
    carried_from_previous_day: Boolean(payload.carried_from_previous_day),
    created_by: null,
    created_at: "",
    updated_at: ""
  });
}
