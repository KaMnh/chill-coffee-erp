import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExpenseCategory, ExpenseTemplate } from "@/lib/types";
import { toAppError } from "./_common";

export async function loadExpenseCategories(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, name, type, sort_order, is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw toAppError(error, "Không tải được danh mục.");
  return (data ?? []) as ExpenseCategory[];
}

export async function loadExpenseTemplates(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("expense_templates")
    .select("id, label, default_category_id, default_unit, last_unit_price, usage_count, is_active")
    .eq("is_active", true)
    .order("usage_count", { ascending: false })
    .order("label", { ascending: true });
  if (error) throw toAppError(error, "Không tải được template chi phí.");
  return (data ?? []) as ExpenseTemplate[];
}

/** Admin xem cả templates inactive. RLS cho phép owner/manager. */
export async function loadExpenseTemplatesAll(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("expense_templates")
    .select("id, label, default_category_id, default_unit, last_unit_price, usage_count, is_active")
    .order("is_active", { ascending: false })
    .order("usage_count", { ascending: false })
    .order("label", { ascending: true });
  if (error) throw toAppError(error, "Không tải được danh sách mẫu chi phí.");
  return (data ?? []) as ExpenseTemplate[];
}

export async function createExpense(supabase: SupabaseClient, payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("create_expense", { p_payload: payload });
  if (error) throw toAppError(error, "Không tạo được khoản chi.");
  return data;
}

export async function createExpenseTemplate(supabase: SupabaseClient, payload: Record<string, unknown>) {
  const { data, error } = await supabase.rpc("create_expense_template", { p_payload: payload });
  if (error) throw toAppError(error, "Không tạo được template.");
  return data as ExpenseTemplate;
}

/**
 * Admin update template (RLS: owner/manager only via expense_templates_admin_write).
 * Patch fields: label, default_category_id, default_unit, last_unit_price, is_active.
 */
export async function updateExpenseTemplate(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Pick<ExpenseTemplate, "label" | "default_category_id" | "default_unit" | "last_unit_price" | "is_active">>
) {
  const { data, error } = await supabase
    .from("expense_templates")
    .update(patch)
    .eq("id", id)
    .select("id, label, default_category_id, default_unit, last_unit_price, usage_count, is_active")
    .single();
  if (error) throw toAppError(error, "Không cập nhật được mẫu chi phí.");
  return data as ExpenseTemplate;
}

/**
 * Soft delete: set is_active=false. Giữ row để usage_count + lịch sử expenses.template_id còn ý nghĩa.
 */
export async function deactivateExpenseTemplate(supabase: SupabaseClient, id: string) {
  return updateExpenseTemplate(supabase, id, { is_active: false });
}

// =============================================================================
// Edit + delete expense entry (Phase 1 — owner/manager, only text fields)
// =============================================================================

/**
 * Sửa description + note của 1 khoản chi đã tạo. RLS `expenses_manager_update`
 * cho phép owner/manager UPDATE trực tiếp — không cần RPC.
 *
 * Scope giới hạn description+note để tránh phải sync cash_drawer_events
 * (ammount/payment_method) hoặc recompute reports (category_id).
 */
export async function updateExpense(
  supabase: SupabaseClient,
  id: string,
  patch: { description?: string; note?: string | null }
) {
  if (patch.description !== undefined) {
    if (patch.description.length > 500) throw new Error("Mô tả vượt 500 ký tự.");
    if (!patch.description.trim()) throw new Error("Mô tả không được rỗng.");
  }
  if (patch.note != null && patch.note.length > 1000) {
    throw new Error("Ghi chú vượt 1000 ký tự.");
  }
  const { data, error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", id)
    .select("id, description, note")
    .single();
  if (error) throw toAppError(error, "Không cập nhật được khoản chi.");
  return data as { id: string; description: string; note: string | null };
}

/**
 * Xóa khoản chi qua RPC `delete_expense` — RPC tự dọn cash_drawer_events
 * tương ứng (FK ON DELETE SET NULL không đủ vì giữ amount → cash flow lệch).
 */
export async function deleteExpense(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.rpc("delete_expense", { p_id: id });
  if (error) throw toAppError(error, "Không xóa được khoản chi.");
  return data as {
    id: string;
    business_date: string;
    amount: number;
    payment_method: string;
  };
}

// =============================================================================
// Categories CRUD (Phase 1 — owner/manager via RLS direct ops)
// =============================================================================

/** Load tất cả danh mục bao gồm inactive — dùng cho admin UI Settings. */
export async function loadExpenseCategoriesAll(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("id, name, type, sort_order, is_active")
    .order("is_active", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw toAppError(error, "Không tải được danh mục chi phí.");
  return (data ?? []) as ExpenseCategory[];
}

/** Tạo danh mục mới. RLS `expense_categories_admin_write` cho owner/manager. */
export async function createExpenseCategory(supabase: SupabaseClient, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Tên danh mục không được rỗng.");
  if (trimmed.length > 100) throw new Error("Tên danh mục vượt 100 ký tự.");
  const { data, error } = await supabase
    .from("expense_categories")
    .insert({ name: trimmed, type: "expense", sort_order: 100, is_active: true })
    .select("id, name, type, sort_order, is_active")
    .single();
  if (error) {
    // PG unique violation (expense_categories_name_active_uniq)
    if (error.code === "23505") {
      throw new Error(`Danh mục "${trimmed}" đã tồn tại.`);
    }
    throw toAppError(error, "Không tạo được danh mục.");
  }
  return data as ExpenseCategory;
}

/** Update danh mục: name / is_active / sort_order. */
export async function updateExpenseCategory(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<Pick<ExpenseCategory, "name" | "is_active" | "sort_order">>
) {
  const sanitized: typeof patch = { ...patch };
  if (sanitized.name !== undefined) {
    const trimmed = sanitized.name.trim();
    if (!trimmed) throw new Error("Tên danh mục không được rỗng.");
    if (trimmed.length > 100) throw new Error("Tên danh mục vượt 100 ký tự.");
    sanitized.name = trimmed;
  }
  const { data, error } = await supabase
    .from("expense_categories")
    .update(sanitized)
    .eq("id", id)
    .select("id, name, type, sort_order, is_active")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Trùng tên với danh mục khác.");
    throw toAppError(error, "Không cập nhật được danh mục.");
  }
  return data as ExpenseCategory;
}
