"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordStockMovement, recordStockCount } from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";
import type { StockMovementReason } from "@/lib/types";

/**
 * Mutation hooks for Phase 4.D Stock UI.
 *
 * Both hooks invalidate stockBalances() + stockMovements() on success.
 * TanStack Query prefix-matches the queryKey array, so invalidating
 * `["inventory", "stock_movements"]` invalidates every cached filter
 * variant `["inventory", "stock_movements", { ... }]`.
 *
 * Backend RPCs gate to staff_or_above (owner+manager+staff_operator).
 * Defense-in-depth: this is the first phase 4 module where staff writes.
 */

export interface RecordStockMovementInput {
  ingredient_id: string;
  quantity_delta: number;
  reason: StockMovementReason;
  notes: string | null;
}

export function useRecordStockMovement(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordStockMovementInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return recordStockMovement(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances() });
      queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements() });
    },
  });
}

export interface RecordStockCountInput {
  ingredient_id: string;
  actual_quantity: number;
  notes: string | null;
}

export function useRecordStockCount(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecordStockCountInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return recordStockCount(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances() });
      queryClient.invalidateQueries({ queryKey: queryKeys.stockMovements() });
    },
  });
}
