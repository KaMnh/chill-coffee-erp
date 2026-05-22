"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadSalesProductSummary,
  loadSalesCategorySummary,
  type ProductSummaryRow,
  type CategorySummaryRow,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.B — Sales analytics query hooks.
 *
 * Both queries:
 *   - staleTime 60s (user-driven date-range pulls, bg-refresh unwanted)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hooks in this phase
 */

export function useSalesProductSummaryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<ProductSummaryRow[]>({
    queryKey: queryKeys.salesProductSummary({ from, to }),
    queryFn: () => loadSalesProductSummary(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useSalesCategorySummaryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<CategorySummaryRow[]>({
    queryKey: queryKeys.salesCategorySummary({ from, to }),
    queryFn: () => loadSalesCategorySummary(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
