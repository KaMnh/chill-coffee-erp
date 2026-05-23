"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadIngredients,
  loadMenuItems,
  loadRecipes,
  loadStockBalancesAll,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 4.A — Inventory query hooks (read-only).
 * Mutation hooks live in `use-inventory-mutations.ts` (added in 4.B).
 *
 * Stale-time strategy:
 *   - Masters (ingredients, menu_items, recipes): 60s — change infrequently
 *   - Stock balances: 30s — move with sales ingest + manual entries
 */

export function useIngredientsQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.ingredients(),
    queryFn: () => loadIngredients(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useMenuItemsQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.menuItems(),
    queryFn: () => loadMenuItems(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useRecipesQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.recipes(),
    queryFn: () => loadRecipes(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useStockBalancesQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.stockBalances(),
    queryFn: () => loadStockBalancesAll(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 30_000,
    // Predictive refresh: when the user re-focuses the window, re-fetch
    // current stock balances. staleTime gates rapid focus toggles.
    refetchOnWindowFocus: true,
  });
}
