"use client";

import type { QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadDashboard,
  loadIngredients,
  loadStockBalancesAll,
  loadShiftAssignments,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";
import type { ViewKey } from "@/features/navigation/navigation";

/**
 * Hover-prefetch helper for the sidebar nav. Called from page.tsx after a
 * 200ms hover debounce. Each branch prefetches the primary query for that
 * section, deferring to TanStack's per-query staleTime — `prefetchQuery` is
 * a no-op when cached data is still fresh.
 *
 * Targets cover the heavier queries; cheap tabs (Settings, Pivot, etc.) and
 * tabs already covered by another (Chốt két shares dashboard) are skipped.
 */
export function prefetchNav(
  section: ViewKey,
  queryClient: QueryClient,
  supabase: SupabaseClient | null,
  businessDate: string,
): void {
  if (!supabase) return;
  switch (section) {
    case "dashboard": {
      queryClient.prefetchQuery({
        queryKey: queryKeys.dashboard(businessDate),
        queryFn: () => loadDashboard(supabase, businessDate),
        staleTime: 30_000,
      });
      return;
    }
    case "inventory": {
      queryClient.prefetchQuery({
        queryKey: queryKeys.stockBalances(),
        queryFn: () => loadStockBalancesAll(supabase),
        staleTime: 30_000,
      });
      queryClient.prefetchQuery({
        queryKey: queryKeys.ingredients(),
        queryFn: () => loadIngredients(supabase),
        staleTime: 60_000,
      });
      return;
    }
    case "shifts": {
      queryClient.prefetchQuery({
        queryKey: queryKeys.shifts(businessDate),
        queryFn: () => loadShiftAssignments(supabase, businessDate),
        staleTime: 60_000,
      });
      return;
    }
    // Other sections skipped intentionally — either covered by another
    // prefetch target or cheap enough to render on-demand.
    default:
      return;
  }
}
