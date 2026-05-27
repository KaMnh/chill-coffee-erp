"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  saveCashCount,
  saveCashDayOpening,
  updateCashCount,
  finalizeCashCloseReport,
  editCashCloseReport,
  voidCashCloseReport,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the cash module (Phase 3B.2b.i).
 *
 * Co-located in one file because they share invalidation idioms
 * (cashCounts/cashOpening/reports/dashboard/safe — depending on action).
 *
 * No optimistic updates. Each mutation invalidates the relevant keys on
 * success, triggering a refetch.
 */

export interface SaveCashCountInput {
  business_date: string;
  count_type: "spot_audit" | "shift_close";
  counted_at: string;
  denominations_json: Record<string, number>;
  total_physical: number;
  bank_transfer_confirmed: number;
  note: string;
  pos_total?: number;
  pos_cash_total?: number;
  pos_non_cash_total?: number;
}

export function useSaveCashCount(supabase: SupabaseClient | null, businessDate: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveCashCountInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return saveCashCount(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface FinalizeCashCloseInput {
  cash_count_id: string;
  leave_for_next_day: number;
  /** Optional: nếu pass, server tạo cash_day_openings cho business_date+1. */
  next_day_denominations?: Record<string, number> | null;
}

export function useFinalizeCashClose(supabase: SupabaseClient | null, businessDate: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FinalizeCashCloseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return finalizeCashCloseReport(supabase, input.cash_count_id, {
        leaveForNextDay: input.leave_for_next_day,
        nextDayDenominations: input.next_day_denominations ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
      // New: opening cho ngày mai có thể vừa được tạo → invalidate ALL cash-opening
      // queries (prefix match) để bất kỳ business_date nào đang mở đều refetch.
      queryClient.invalidateQueries({ queryKey: ["cash-opening"] });
    },
  });
}

export interface SaveCashDayOpeningInput {
  business_date: string;
  denominations_json: Record<string, number>;
  carried_from_previous_day?: boolean;
  safe_withdrawal_amount?: number;
}

export function useSaveCashDayOpening(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveCashDayOpeningInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return saveCashDayOpening(supabase, input);
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashOpening(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      if ((input.safe_withdrawal_amount ?? 0) > 0) {
        queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
        queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
      }
    },
  });
}

export interface UpdateCashCountInput {
  id: string;
  denominations_json?: Record<string, number>;
  bank_transfer_confirmed?: number;
  note?: string | null;
}

export function useUpdateCashCount(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateCashCountInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateCashCount(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface EditCashCloseReportInput {
  reportId: string;
  note?: string | null;
  leaveForNextDay?: number | null;
}

export function useEditCashCloseReport(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: EditCashCloseReportInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return editCashCloseReport(supabase, input.reportId, {
        note: input.note,
        leaveForNextDay: input.leaveForNextDay,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    },
  });
}

export interface VoidCashCloseReportInput {
  reportId: string;
  reason: string;
}

export function useVoidCashCloseReport(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: VoidCashCloseReportInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return voidCashCloseReport(supabase, input.reportId, input.reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    },
  });
}
