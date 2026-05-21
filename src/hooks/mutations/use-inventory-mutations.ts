"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createIngredient,
  updateIngredient,
  deleteIngredient,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for Phase 4.B Masters UI (ingredients + menu_items).
 *
 * Pattern: null-supabase guard with Vietnamese error, then call the
 * data-layer wrapper. On success, invalidate relevant query keys.
 *
 * Conservative invalidation:
 *   - useUpdateIngredient invalidates stockBalances too (unit or
 *     low_stock_threshold may change → dashboard refresh needed).
 *   - useUpdateMenuItem invalidates recipes too (menu_item_name is
 *     joined in list_recipes output).
 *
 * Recipe / stock mutation hooks are deferred to Phase 4.C / 4.D.
 */

// ----------------------- Ingredients -----------------------------------

export interface CreateIngredientInput {
  name: string;
  unit: string;
  low_stock_threshold?: number | null;
  notes?: string | null;
}

export function useCreateIngredient(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateIngredientInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createIngredient(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredients() });
    },
  });
}

export interface UpdateIngredientInput {
  id: string;
  name: string;
  unit: string;
  low_stock_threshold: number | null;
  notes: string | null;
  is_active: boolean;
}

export function useUpdateIngredient(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateIngredientInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateIngredient(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredients() });
      // Conservative: unit or threshold may have changed → dashboard refresh
      queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances() });
    },
  });
}

export interface DeleteIngredientInput {
  id: string;
}

export function useDeleteIngredient(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteIngredientInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteIngredient(supabase, input.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredients() });
    },
  });
}

// ----------------------- Menu items ------------------------------------

export interface CreateMenuItemInput {
  name: string;
  external_product_name?: string | null;
  notes?: string | null;
}

export function useCreateMenuItem(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMenuItemInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createMenuItem(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}

export interface UpdateMenuItemInput {
  id: string;
  name: string;
  external_product_name: string | null;
  notes: string | null;
  is_active: boolean;
}

export function useUpdateMenuItem(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMenuItemInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateMenuItem(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
      // Conservative: menu_item_name is joined in list_recipes output
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes() });
    },
  });
}

export interface DeleteMenuItemInput {
  id: string;
}

export function useDeleteMenuItem(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteMenuItemInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteMenuItem(supabase, input.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}
