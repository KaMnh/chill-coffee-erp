"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCashCloseReportsByDate, loadCashCountsByDate, loadCashDayOpening } from "@/lib/data";
import { queryKeys } from "./keys";

export function useCashOpeningQuery(supabase: SupabaseClient | null, businessDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.cashOpening(businessDate),
    queryFn: () => loadCashDayOpening(supabase!, businessDate).catch(() => null),
    enabled: enabled && !!supabase,
    staleTime: 30_000
  });
}

export function useReportsQuery(supabase: SupabaseClient | null, businessDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.reports(businessDate),
    queryFn: () => loadCashCloseReportsByDate(supabase!, businessDate),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}

/**
 * Lịch sử kiểm két theo ngày (cả spot_audit lẫn shift_close).
 * Dùng trong CashHistorySection — staleTime ngắn để show count mới ngay.
 */
export function useCashCountsQuery(supabase: SupabaseClient | null, businessDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.cashCounts(businessDate),
    queryFn: () => loadCashCountsByDate(supabase!, businessDate),
    enabled: enabled && !!supabase,
    staleTime: 15_000
  });
}
