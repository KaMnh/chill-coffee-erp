"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { finalizePeriodClose, voidPeriodClose } from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks Kết toán kỳ — pattern use-safe-mutations.ts (null-guard +
 * invalidate). Cả finalize lẫn void đều đụng số dư quỹ + lịch sử quỹ +
 * preview/list kỳ; cash-flow-overview invalidate theo prefix (key có range).
 */

function useInvalidatePeriodClose() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.periodClosePreview() });
    queryClient.invalidateQueries({ queryKey: queryKeys.periodCloses() });
    queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
    queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    queryClient.invalidateQueries({ queryKey: ["cash-flow-overview"] });
  };
}

export interface FinalizePeriodCloseInput {
  /** YYYY-MM-DD (hôm nay VN từ todayInVN()). */
  closeDate: string;
  drawCash: number;
  drawTransfer: number;
  note?: string;
}

export function useFinalizePeriodClose(supabase: SupabaseClient | null) {
  const invalidate = useInvalidatePeriodClose();
  return useMutation({
    mutationFn: async (input: FinalizePeriodCloseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return finalizePeriodClose(supabase, input);
    },
    onSuccess: invalidate
  });
}

export interface VoidPeriodCloseInput {
  id: string;
  /** ≥ 5 ký tự (RPC validate). */
  reason: string;
}

export function useVoidPeriodClose(supabase: SupabaseClient | null) {
  const invalidate = useInvalidatePeriodClose();
  return useMutation({
    mutationFn: async (input: VoidPeriodCloseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return voidPeriodClose(supabase, input);
    },
    onSuccess: invalidate
  });
}
