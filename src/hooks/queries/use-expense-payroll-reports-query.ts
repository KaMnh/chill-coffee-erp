"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadExpenseSummaryByCategory,
  loadPayrollSummaryByEmployee,
  type ExpenseCategoryRow,
  type PayrollEmployeeRow,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 5.C — Expense + payroll analytics query hooks.
 *
 * Both queries:
 *   - staleTime 60s (user-driven date-range pulls, bg-refresh unwanted)
 *   - keyed by { from, to } so changing the picker auto-refetches
 *   - read-only; no mutation hooks in this phase
 */

export function useExpenseSummaryByCategoryQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<ExpenseCategoryRow[]>({
    queryKey: queryKeys.expenseSummaryByCategory({ from, to }),
    queryFn: () => loadExpenseSummaryByCategory(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function usePayrollSummaryByEmployeeQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery<PayrollEmployeeRow[]>({
    queryKey: queryKeys.payrollSummaryByEmployee({ from, to }),
    queryFn: () => loadPayrollSummaryByEmployee(supabase!, from, to),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
