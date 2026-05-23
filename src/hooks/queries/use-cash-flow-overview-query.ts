"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCashFlowOverview, type LoadCashFlowParams } from "@/lib/data";
import { queryKeys } from "./keys";

export function useCashFlowOverviewQuery(
  supabase: SupabaseClient | null,
  params: LoadCashFlowParams,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.cashFlowOverview(params.start, params.end),
    queryFn: () => loadCashFlowOverview(supabase!, params),
    enabled: enabled && !!supabase,
    staleTime: 2 * 60_000,
  });
}
