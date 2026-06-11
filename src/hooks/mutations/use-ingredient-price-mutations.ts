"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  upsertIngredientReferencePrice,
  deleteIngredientReferencePrice,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Upsert đơn giá tham chiếu tồn kho (owner-only qua RLS);
 * `unitPrice = null` nghĩa là XÓA giá.
 */
export function useSetIngredientPrice(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ingredientId: string; unitPrice: number | null }) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      if (input.unitPrice == null) {
        await deleteIngredientReferencePrice(supabase, input.ingredientId);
      } else {
        await upsertIngredientReferencePrice(supabase, input.ingredientId, input.unitPrice);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredientPrices() });
    },
  });
}
