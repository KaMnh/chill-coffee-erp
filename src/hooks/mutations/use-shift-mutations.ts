"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkInEmployee,
  checkOutEmployee,
  editPayrollRecord,
  createEmployee,
  updateEmployee,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the shifts module (Phase 3B.2a).
 *
 * Co-located in one file because they share the same invalidation idioms
 * (shifts/payroll/dashboard for date-scoped; employees() for ref data).
 *
 * No optimistic updates — every mutation invalidates the relevant queries
 * on success, triggering a refetch. Simple, predictable, no rollback
 * complexity. Phase 6 may add optimism if measurements show a need.
 *
 * Caller pattern:
 *   const checkIn = useCheckIn(supabase, businessDate);
 *   try {
 *     await checkIn.mutateAsync({ employee_id, business_date, check_in_at });
 *     toast({ semantic: "success", message: "Đã vào ca." });
 *   } catch (err) {
 *     toast({ semantic: "danger", message: err.message });
 *   }
 */

export interface CheckInInput {
  employee_id: string;
  business_date: string;
  /** Naive datetime-local string (VN wall-clock, NOT UTC). */
  check_in_at: string;
}

export function useCheckIn(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CheckInInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return checkInEmployee(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
    },
  });
}

export interface CheckOutInput {
  shift_assignment_id: string;
  employee_id: string;
  business_date: string;
  check_in_at: string;
  check_out_at: string;
  allowance_amount: number;
  note: string;
  override_pay?: number; // set for fixed NV; undefined for hourly
}

export function useCheckOut(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CheckOutInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return checkOutEmployee(supabase, input as unknown as Record<string, unknown>);
    },
    // Check-out closes a shift AND creates payroll_record AND affects
    // dashboard (active_staff drops, payroll_paid increases).
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface UpdatePayrollInput {
  payroll_record_id: string;
  check_in_at: string;
  check_out_at: string;
  allowance_amount: number;
  note: string;
  override_pay?: number; // set for fixed NV
}

export function useUpdatePayrollRecord(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePayrollInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return editPayrollRecord(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface UpsertEmployeeInput {
  /** Set to existing id for update; omit for create. */
  id?: string;
  name: string;
  position: string;
  hourly_rate: number;
  pay_type: "hourly" | "fixed";
  default_daily_pay: number | null;
  is_active: boolean;
}

export function useUpsertEmployee(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertEmployeeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      // Branch by id presence — Phase 1 employees.ts has separate
      // createEmployee + updateEmployee functions.
      const payload = {
        name: input.name,
        position: input.position,
        hourly_rate: input.hourly_rate,
        pay_type: input.pay_type,
        default_daily_pay: input.default_daily_pay,
        is_active: input.is_active,
      };
      if (input.id) {
        return updateEmployee(supabase, input.id, payload);
      }
      return createEmployee(supabase, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
    },
  });
}

// Removed: useDeactivateEmployee. The current UI deactivates employees via
// EmployeeFormModal's is_active checkbox (-> useUpsertEmployee). If a dedicated
// "Tam dung" surface ships in a later phase, re-introduce this hook then.
