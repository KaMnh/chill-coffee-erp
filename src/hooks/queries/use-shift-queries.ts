"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEmployees, loadPayrollRecords, loadShiftAssignments } from "@/lib/data";
import { queryKeys } from "./keys";

export function useEmployeesQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.employees(),
    queryFn: () => loadEmployees(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 2 * 60_000
  });
}

export function useShiftsQuery(supabase: SupabaseClient | null, businessDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.shifts(businessDate),
    queryFn: () => loadShiftAssignments(supabase!, businessDate),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}

export function usePayrollQuery(supabase: SupabaseClient | null, businessDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.payroll(businessDate),
    queryFn: () => loadPayrollRecords(supabase!, businessDate),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}
