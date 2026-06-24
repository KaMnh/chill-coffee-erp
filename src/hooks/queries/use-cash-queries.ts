"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadCashCloseReportsByDate,
  loadCashCloseReportsByPeriod,
  loadCashCountsByDate,
  loadCashDayOpening
} from "@/lib/data";
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
 * Báo cáo chốt két theo KHOẢNG ngày (final + voided), business_date DESC.
 * Prefix "cash-close-reports" để finalize/edit/void invalidate tự refresh
 * (xem use-cash-mutations.ts). staleTime 60s như useReportsQuery.
 */
export function useReportsByPeriodQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.reportsByPeriod(from, to),
    queryFn: () => loadCashCloseReportsByPeriod(supabase!, from, to),
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
