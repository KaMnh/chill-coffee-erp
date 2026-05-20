"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createExpense,
  createExpenseTemplate,
  deleteExpense,
  updateExpense,
} from "@/lib/data";
import type { ExpenseTemplate } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the expenses module (Phase 3B.1).
 *
 * Co-located in one file because they share the same invalidation logic
 * (dashboard + templates) and the same supabase + businessDate dependency.
 *
 * No optimistic updates — every mutation invalidates the relevant queries
 * on success, which triggers a refetch. Simple, predictable, no rollback
 * complexity. Phase 6 can add optimism if measurements show a need.
 *
 * Caller pattern:
 *   const create = useCreateExpense(supabase, businessDate);
 *   try {
 *     await create.mutateAsync({ business_date, ... });
 *     toast({ semantic: "success", message: "Đã lưu khoản chi." });
 *   } catch (err) {
 *     toast({ semantic: "danger", message: err.message });
 *   }
 */

export interface CreateExpenseInput {
  business_date: string;
  category_id: string | null;
  template_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  note: string;
  payment_method: "cash";
}

export function useCreateExpense(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createExpense(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.templates() });
    },
  });
}

export interface CreateExpenseTemplateInput {
  label: string;
  default_category_id: string | null;
  default_unit: string;
  last_unit_price: number;
}

export function useCreateExpenseTemplate(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation<ExpenseTemplate, Error, CreateExpenseTemplateInput>({
    mutationFn: async (input) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createExpenseTemplate(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates() });
    },
  });
}

export interface UpdateExpenseInput {
  id: string;
  patch: { description?: string; note?: string | null };
}

export function useUpdateExpense(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateExpenseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateExpense(supabase, id, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export function useDeleteExpense(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteExpense(supabase, id);
    },
    onSuccess: () => {
      // Both dashboard expenses list AND cash_drawer_events change → invalidate
      // both. (RPC delete_expense reverses cash_drawer_events as a side effect
      // per Phase 1 lib/data/expenses.ts comment.)
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
    },
  });
}
