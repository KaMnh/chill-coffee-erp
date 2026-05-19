"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadExpenseCategories, loadExpenseTemplates } from "@/lib/data";
import { queryKeys } from "./keys";

export function useExpenseCategoriesQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.categories(),
    queryFn: () => loadExpenseCategories(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 5 * 60_000
  });
}

export function useExpenseTemplatesQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.templates(),
    queryFn: () => loadExpenseTemplates(supabase!).catch(() => []),
    enabled: enabled && !!supabase,
    staleTime: 5 * 60_000
  });
}
