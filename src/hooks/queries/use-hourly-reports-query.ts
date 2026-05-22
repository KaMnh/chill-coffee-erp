"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSalesHourlySummary, type HourlyRow } from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.D — Hourly trends query hook.
 *
 *   - staleTime 60s (user-driven date-range pull)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hook
 *   - single hook (no 2nd query like 5.B/C) because KPI row + chart
 *     consume the same data array
 */

export function useSalesHourlySummaryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<HourlyRow[]>({
    queryKey: queryKeys.salesHourlySummary({ from, to }),
    queryFn: () => loadSalesHourlySummary(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
