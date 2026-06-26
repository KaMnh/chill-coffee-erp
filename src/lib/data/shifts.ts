import type { SupabaseClient } from "@supabase/supabase-js";
import type { PayrollRecord, ShiftAssignment } from "@/lib/types";
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
