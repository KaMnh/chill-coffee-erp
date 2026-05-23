"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDashboard } from "@/lib/data";
import { queryKeys } from "./keys";

export function useDashboardQuery(supabase: SupabaseClient | null, businessDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.dashboard(businessDate),
    queryFn: () => loadDashboard(supabase!, businessDate),
    enabled: enabled && !!supabase,
    staleTime: 30_000,
    // Predictive refresh: when the user re-focuses the window, re-fetch POS
    // numbers. staleTime gates this so rapid focus toggles don't spam.
    refetchOnWindowFocus: true
  });
}
