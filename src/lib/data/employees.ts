import type { SupabaseClient } from "@supabase/supabase-js";
import type { Employee } from "@/lib/types";
import { toAppError } from "./_common";

export async function loadEmployees(supabase: SupabaseClient, includeInactive = false) {
  let query = supabase
    .from("employees")
    .select("id, code, name, position, hourly_rate, is_active");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.order("name", { ascending: true });
  if (error) throw toAppError(error, "Không tải được danh sách nhân viên.");
  return (data ?? []) as Employee[];
}

export async function createEmployee(supabase: SupabaseClient, payload: Pick<Employee, "name" | "position" | "hourly_rate">) {
  const { data, error } = await supabase
    .from("employees")
    .insert({ name: payload.name, position: payload.position, hourly_rate: payload.hourly_rate, is_active: true })
    .select("id")
    .single();
  if (error) throw toAppError(error, "Không tạo được nhân viên.");
  return data;
}

export async function updateEmployee(
  supabase: SupabaseClient,
  employeeId: string,
  payload: Partial<Pick<Employee, "name" | "position" | "hourly_rate" | "is_active">>
) {
  const { data, error } = await supabase
    .from("employees")
    .update(payload)
    .eq("id", employeeId)
    .select("id")
    .single();
  if (error) throw toAppError(error, "Không cập nhật được nhân viên.");
  return data;
}
