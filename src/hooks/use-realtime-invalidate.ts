"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queryKeys } from "./queries/keys";

/**
 * Subscribe to Supabase realtime channels for the current business date and
 * invalidate the matching React Query caches when relevant rows change.
 *
 * Note: requires the `supabase_realtime` publication to include the listed tables.
 */
export function useRealtimeInvalidate(supabase: SupabaseClient | null, businessDate: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel(`live-${businessDate}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "sales_sync_runs", filter: "status=eq.success" },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
        }
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_close_reports" }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });
        queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_counts" }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "handover_tasks" }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "expenses" }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "safe_transactions" }, () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
        queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [businessDate, queryClient, supabase]);
}
