"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { triggerPosSync } from "@/lib/data";
import type { Account, DashboardData } from "@/lib/types";
import { queryKeys } from "./queries/keys";

type SalesSyncRunMeta = NonNullable<DashboardData["latest_sync"]>;

const STALE_MS = 30 * 60 * 1000;

/**
 * Drive POS sync: exposes a mutation to manually trigger KiotViet sync,
 * and an effect that auto-syncs when latest run is stale/failed.
 * Replaces the autoSyncKeys+accountRef workaround.
 */
export function usePosSync(
  supabase: SupabaseClient | null,
  businessDate: string,
  account: Account | null | undefined,
  latestSync: SalesSyncRunMeta | null | undefined
) {
  const queryClient = useQueryClient();
  const triedRef = useRef<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: (vars: { force: boolean; reason: string }) =>
      triggerPosSync(supabase!, { businessDate, force: vars.force, reason: vars.reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    }
  });

  useEffect(() => {
    if (!supabase || !account || account.role === "employee_viewer") return;
    const finishedAt = latestSync?.finished_at ? new Date(latestSync.finished_at).getTime() : 0;
    const stale = !finishedAt || Date.now() - finishedAt > STALE_MS;
    const failed = latestSync?.status === "failed";
    if (!stale && !failed) return;
    const key = `${businessDate}:${latestSync?.id ?? "none"}:${latestSync?.status ?? "none"}`;
    if (triedRef.current.has(key)) return;
    triedRef.current.add(key);
    mutation.mutate({ force: false, reason: "auto_load" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.role, businessDate, latestSync?.id, latestSync?.finished_at, latestSync?.status, supabase]);

  return mutation;
}
