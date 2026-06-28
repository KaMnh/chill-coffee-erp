import type { SupabaseClient } from "@supabase/supabase-js";
import type { ManagerCheckoutResult, OpenShift, PayrollRecord, ShiftAssignment } from "@/lib/types";
import { toAppError } from "./_common";

export async function loadShiftAssignments(supabase: SupabaseClient, businessDate: string) {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select("id, employee_id, business_date, check_in_at, check_out_at, total_minutes, status, check_in_ip, check_in_user_agent, employees(name, position)")
    .eq("business_date", businessDate)
    .order("check_in_at", { ascending: false, nullsFirst: false });
  if (error) throw toAppError(error, "Không tải được danh sách ca.");

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const employee = row.employees as { name?: string; position?: string | null } | undefined;
    return {
      ...row,
      employee_name: employee?.name ?? null,
      position: employee?.position ?? null
    } as ShiftAssignment;
  });
}

export async function loadOpenShifts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      "id, employee_id, business_date, check_in_at, check_out_at, total_minutes, status, employees(name, position, is_active)"
    )
    .eq("status", "checked_in")
    .order("check_in_at", { ascending: true, nullsFirst: false });
  if (error) throw toAppError(error, "Không tải được ca đang mở.");

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const employee = row.employees as
      | { name?: string; position?: string | null; is_active?: boolean }
      | null
      | undefined;
    return {
      ...row,
      employee_name: employee?.name ?? null,
      position: employee?.position ?? null,
      employee_is_active: employee?.is_active ?? null,
    } as OpenShift;
  });
}

export async function cancelShiftAssignment(
  supabase: SupabaseClient,
  shiftId: string,
  reason: string
) {
  const { data, error } = await supabase.rpc("cancel_shift_assignment", {
    p_shift_id: shiftId,
    p_reason: reason,
  });
  if (error) throw toAppError(error, "Không huỷ được ca.");
  return data as { shift_assignment_id: string; employee_name: string | null; status: string };
}

export async function checkInEmployee(supabase: SupabaseClient, payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("check_in_employee", { p_payload: payload });
  if (error) throw toAppError(error, "Không vào ca được.");
  return data;
}

export async function checkOutEmployee(supabase: SupabaseClient, payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("check_out_employee", { p_payload: payload });
  if (error) throw toAppError(error, "Không ra ca được.");
  return data;
}

export async function checkOutEmployeeNow(supabase: SupabaseClient, shiftAssignmentId: string) {
  const { data, error } = await supabase.rpc("check_out_employee_now", { p_shift_assignment_id: shiftAssignmentId });
  if (error) throw toAppError(error, "Không đóng ca được.");
  return data as ManagerCheckoutResult;
}

export async function loadPayrollRecords(supabase: SupabaseClient, businessDate: string) {
  const { data, error } = await supabase
    .from("shift_payroll_records")
    .select(
      "id, shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, note, created_at, edited_at, employees(name)"
    )
    .eq("business_date", businessDate)
    .order("created_at", { ascending: false });
  if (error) throw toAppError(error, "Không tải được lương theo ca.");

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const employee = row.employees as { name?: string } | undefined;
    return {
      ...row,
      employee_name: employee?.name ?? null
    } as PayrollRecord;
  });
}

export async function editPayrollRecord(supabase: SupabaseClient, payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("edit_shift_payroll_record", { p_payload: payload });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("edit_shift_payroll_record") || message.includes("Could not find the function")) {
      throw new Error(
        "Supabase chưa có RPC edit_shift_payroll_record. Hãy apply lại database/002_functions.sql rồi thử sửa lượt lương."
      );
    }
    throw toAppError(error, "Không sửa được lượt lương.");
  }
  return data as {
    payroll_record_id?: string;
    shift_assignment_id?: string;
    total_minutes?: number;
    base_pay?: number;
    allowance_amount?: number;
    total_pay?: number;
  };
}
