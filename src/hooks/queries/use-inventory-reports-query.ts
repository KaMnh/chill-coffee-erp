"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadInventoryConsumption,
  loadInventoryVariance,
  type ConsumptionRow,
  type VarianceRow,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.A — Inventory analytics query hooks.
 *
 * Both report queries:
 *   - staleTime 60s (reports re-fetch on demand; bg-refresh unwanted)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hooks in this phase
 */

export function useInventoryConsumptionQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<ConsumptionRow[]>({
    queryKey: queryKeys.inventoryConsumption({ from, to }),
    queryFn: () => loadInventoryConsumption(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useInventoryVarianceQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<VarianceRow[]>({
    queryKey: queryKeys.inventoryVariance({ from, to }),
    queryFn: () => loadInventoryVariance(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
