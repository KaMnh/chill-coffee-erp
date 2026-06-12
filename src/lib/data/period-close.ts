import type { SupabaseClient } from "@supabase/supabase-js";
import type { PeriodClosePreview, PeriodCloseRecord } from "@/lib/types";
import { toAppError } from "./_common";

/**
 * Kết toán kỳ (owner-only RPCs). Spec:
 * docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
 */

export async function loadPeriodClosePreview(
  supabase: SupabaseClient
): Promise<PeriodClosePreview> {
  const { data, error } = await supabase.rpc("period_close_preview");
  if (error) throw toAppError(error, "Không tải được kỳ hiện tại.");
  return data as PeriodClosePreview;
}

export async function loadPeriodCloses(
  supabase: SupabaseClient
): Promise<PeriodCloseRecord[]> {
  const { data, error } = await supabase.rpc("list_period_closes");
  if (error) throw toAppError(error, "Không tải được lịch sử kết toán kỳ.");
  return (data ?? []) as PeriodCloseRecord[];
}

export async function finalizePeriodClose(
  supabase: SupabaseClient,
  payload: { closeDate: string; drawCash: number; drawTransfer: number; note?: string }
): Promise<{
  id: string;
  draw_total: number;
  closing_total: number;
  profit: number;
}> {
  const { data, error } = await supabase.rpc("finalize_period_close", {
    p_close_date: payload.closeDate,
    p_draw_cash: payload.drawCash,
    p_draw_transfer: payload.drawTransfer,
    p_note: payload.note ?? null,
  });
  if (error) throw toAppError(error, "Không kết toán được kỳ.");
  return data as { id: string; draw_total: number; closing_total: number; profit: number };
}

export async function voidPeriodClose(
  supabase: SupabaseClient,
  payload: { id: string; reason: string }
): Promise<{ id: string; status: "voided" }> {
  const { data, error } = await supabase.rpc("void_period_close", {
    p_id: payload.id,
    p_reason: payload.reason,
  });
  if (error) throw toAppError(error, "Không huỷ được kỳ kết.");
  return data as { id: string; status: "voided" };
}
