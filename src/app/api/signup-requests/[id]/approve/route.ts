/**
 * POST /api/signup-requests/<id>/approve
 *
 * Auth: owner / manager only.
 * Body: { role: 'owner' | 'manager' | 'staff_operator' | 'employee_viewer' }
 *
 * Flow:
 *   1. Fetch signup_requests row; 404 if missing, 409 if not pending_approval.
 *   2. Read auth_user_id, email, name, employee_code from row.
 *   3. Reject (409) if employee_accounts already exists for that auth_user_id.
 *   4. INSERT employees (name, code, position=null, hourly_rate=0, is_active=true).
 *   5. INSERT employee_accounts (employee_id, auth_user_id, role, status='active').
 *   6. UPSERT profiles (id=auth_user_id, display_name=name).
 *   7. UPDATE signup_requests.status='approved', reviewed_by, reviewed_at.
 *
 * Best-effort rollback if 4/5/6 fail.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_ROLES = ["owner", "manager", "staff_operator", "employee_viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

function bad(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let approver: { userId: string; role: string };
  try {
    approver = await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return bad(message, code);
  }

  const { id } = await ctx.params;
  if (!id) return bad("Thiếu signup_request id.");

  let body: { role?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Body không phải JSON.");
  }
  const role = body.role;
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return bad("Role không hợp lệ.");
  }

  const supabase = getServiceRoleClient();

  // Step 1: fetch the signup_request
  const { data: request, error: reqError } = await supabase
    .from("signup_requests")
    .select("id, auth_user_id, email, name, employee_code, status")
    .eq("id", id)
    .maybeSingle();
  if (reqError) return bad(`Không tải được đơn: ${reqError.message}`, 500);
  if (!request) return bad("Không tìm thấy đơn.", 404);
  if (request.status !== "pending_approval") {
    return bad(`Đơn không ở trạng thái pending_approval (đang: ${request.status}).`, 409);
  }
  if (!request.auth_user_id) {
    return bad("Đơn không có auth_user_id (bug data — báo admin).", 409);
  }

  // Step 2/3: ensure no existing employee_accounts for this auth user
  const { data: existing } = await supabase
    .from("employee_accounts")
    .select("id")
    .eq("auth_user_id", request.auth_user_id)
    .maybeSingle();
  if (existing) {
    return bad("Tài khoản đã tồn tại cho auth user này — không thể duyệt lần nữa.", 409);
  }

  const displayName = request.name?.trim() || request.email;

  // Step 4: INSERT employees
  const { data: emp, error: empError } = await supabase
    .from("employees")
    .insert({
      code: request.employee_code,
      name: displayName,
      position: null,
      hourly_rate: 0,
      is_active: true
    })
    .select("id")
    .single();
  if (empError || !emp) {
    return bad(`Không tạo được employee: ${empError?.message ?? "unknown"}`, 500);
  }
  const employeeId = emp.id;

  // Step 5: INSERT employee_accounts
  const { error: accError } = await supabase.from("employee_accounts").insert({
    employee_id: employeeId,
    auth_user_id: request.auth_user_id,
    role,
    status: "active",
    created_by: approver.userId
  });
  if (accError) {
    void supabase.from("employees").delete().eq("id", employeeId);
    return bad(`Không tạo được employee_account: ${accError.message}`, 500);
  }

  // Step 6: UPSERT profiles (best-effort, non-fatal)
  await supabase
    .from("profiles")
    .upsert({ id: request.auth_user_id, display_name: displayName }, { onConflict: "id" });

  // Step 7: UPDATE signup_requests
  const { error: updError } = await supabase
    .from("signup_requests")
    .update({
      status: "approved",
      reviewed_by: approver.userId,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id);
  if (updError) {
    // Account is already created — don't roll back; just surface the warning.
    return NextResponse.json({
      status: "ok",
      auth_user_id: request.auth_user_id,
      employee_id: employeeId,
      warning: `Đã tạo tài khoản nhưng không cập nhật được signup_requests: ${updError.message}`
    });
  }

  return NextResponse.json({
    status: "ok",
    auth_user_id: request.auth_user_id,
    employee_id: employeeId
  });
}
