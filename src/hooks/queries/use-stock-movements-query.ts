"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStockMovements } from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 4.D — Stock movements ledger query.
 *
 * Filter object reaches the RPC via the data-layer wrapper.
 * Reason filter is NOT included here — applied client-side in
 * StockLedgerSection because the RPC doesn't accept a reason param.
 *
 * staleTime: 30s — moves with sales ingest + manual entries.
 */

export interface StockMovementsFilter {
  ingredient_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function useStockMovementsQuery(
  supabase: SupabaseClient | null,
  filter: StockMovementsFilter = {},
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.stockMovements(filter),
    queryFn: () => loadStockMovements(supabase!, filter),
    enabled: !!supabase && enabled,
    staleTime: 30_000,
  });
}
