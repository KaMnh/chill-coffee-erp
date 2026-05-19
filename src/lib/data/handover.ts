import type { SupabaseClient } from "@supabase/supabase-js";
import type { HandoverSession } from "@/lib/types";
import { toAppError, unwrapJson } from "./_common";

export async function loadHandoverSession(supabase: SupabaseClient, businessDate: string) {
  const { data, error } = await supabase.rpc("get_or_create_handover_session", {
    p_business_date: businessDate
  });
  if (error) throw toAppError(error, "Không tải được sổ bàn giao.");
  return unwrapJson<HandoverSession | null>(data, null);
}

export async function updateHandoverTask(supabase: SupabaseClient, taskId: string, isDone: boolean) {
  const { data, error } = await supabase.rpc("update_handover_task", {
    p_task_id: taskId,
    p_is_done: isDone
  });
  if (error) throw toAppError(error, "Không cập nhật được checklist.");
  return data;
}

export async function updateHandoverNote(supabase: SupabaseClient, sessionId: string, note: string) {
  const { data, error } = await supabase.rpc("update_handover_note", {
    p_session_id: sessionId,
    p_note: note
  });
  if (error) throw toAppError(error, "Không lưu được ghi chú bàn giao.");
  return data;
}

export async function completeHandoverSession(supabase: SupabaseClient, sessionId: string) {
  const { data, error } = await supabase.rpc("complete_handover_session", {
    p_session_id: sessionId
  });
  if (error) throw toAppError(error, "Không hoàn tất được sổ bàn giao.");
  return data;
}

export async function updateHandoverDefaultTasks(supabase: SupabaseClient, tasks: Array<{ key: string; label: string }>) {
  const { data, error } = await supabase.rpc("update_handover_default_tasks", { p_tasks: tasks });
  if (error) throw toAppError(error, "Không lưu được checklist mặc định.");
  return data as Array<{ key: string; label: string }>;
}

export async function updateHandoverSessionTasks(
  supabase: SupabaseClient,
  sessionId: string,
  tasks: Array<{ id?: string; key?: string; label: string; sort_order?: number }>
) {
  const { data, error } = await supabase.rpc("update_handover_session_tasks", { p_session_id: sessionId, p_tasks: tasks });
  if (error) throw toAppError(error, "Không lưu được checklist hôm nay.");
  return data as HandoverSession;
}
