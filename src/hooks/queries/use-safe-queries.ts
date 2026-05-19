"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadSafeBalance,
  loadSafeCounts,
  loadSafeTransactions
} from "@/lib/data";
import type { SafeTransactionType } from "@/lib/types";
import { queryKeys } from "./keys";

/** Số dư sổ quỹ. Stale 30s — số dư quan trọng, fresh thường xuyên. */
export function useSafeBalanceQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.safeBalance(),
    queryFn: () => loadSafeBalance(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 30_000
  });
}

/** Lịch sử giao dịch (filter optional). Stale 1 phút. */
export function useSafeTransactionsQuery(
  supabase: SupabaseClient | null,
  filter: { fromDate?: string; toDate?: string; type?: SafeTransactionType } = {},
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.safeTransactions({
      from: filter.fromDate,
      to: filter.toDate,
      type: filter.type
    }),
    queryFn: () => loadSafeTransactions(supabase!, filter),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}

/** Lịch sử đếm safe (mệnh giá snapshot). Stale 1 phút. */
export function useSafeCountsQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.safeCounts(),
    queryFn: () => loadSafeCounts(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}
