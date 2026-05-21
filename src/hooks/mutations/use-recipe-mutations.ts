"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertRecipe, deleteRecipe } from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for Phase 4.C Recipe Builder UI.
 *
 * Conservative invalidation: both hooks invalidate `menuItems()` because
 * `menu_items.recipe_count` (returned by list_menu_items RPC via subquery)
 * changes when a recipe is created or deleted. Otherwise the gap report
 * in RecipesTab would show stale data.
 *
 * Recipe items are replaced atomically inside upsert_recipe (DELETE +
 * INSERT in a single transaction — see 4.A backend spec §6.3).
 */

export interface UpsertRecipeInput {
  menu_item_id: string;
  is_active: boolean;
  notes: string | null;
  items: Array<{ ingredient_id: string; quantity: number }>;
}

export function useUpsertRecipe(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertRecipeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return upsertRecipe(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes() });
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}

export interface DeleteRecipeInput {
  id: string;
}

export function useDeleteRecipe(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteRecipeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteRecipe(supabase, input.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes() });
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}
