import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashFlowOverview } from "@/lib/types";
import { toAppError } from "./_common";

export interface LoadCashFlowParams {
  start: string;
  end: string;
  compareStart?: string;
  compareEnd?: string;
}

/**
 * Call the SECURITY DEFINER RPC. Server-side guard inside the function
 * checks owner/manager; the user's JWT is forwarded automatically by
 * Supabase JS.
 */
export async function loadCashFlowOverview(
  supabase: SupabaseClient,
  params: LoadCashFlowParams,
): Promise<CashFlowOverview> {
  const { data, error } = await supabase.rpc("cash_flow_overview", {
    p_start: params.start,
    p_end: params.end,
    p_compare_start: params.compareStart ?? null,
    p_compare_end: params.compareEnd ?? null,
  });
  if (error) throw toAppError(error, "Không tải được tổng quan dòng tiền.");
  return data as CashFlowOverview;
}
