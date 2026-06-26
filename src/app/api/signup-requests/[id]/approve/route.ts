/**
 * POST /api/signup-requests/<id>/approve
 *
 * Auth: owner / manager only.
 * Body: { role: string, employee_id?: string }
 *   - role must be a valid VALID_ROLES entry; only an owner may grant the 'owner' role.
 *   - employee_id (optional): explicit UUID of an existing unlinked employees row to link.
 *
 * Flow:
 *   1. Fetch signup_requests row; 404 if missing, 409 if not pending_approval.
 *   2. Read auth_user_id, email, name, employee_code from row.
 *   3. Reject (409) if employee_accounts already exists for that auth_user_id.
 *   4. Resolve the employees row to link (link-existing-first, insert-fallback):
 *        a) Explicit employee_id supplied → must exist AND not already have an account.
 *        b) No explicit id but signup's employee_code matches exactly ONE unlinked
 *           employees row → link that row automatically.
 *        c) Neither a nor b → INSERT a new employees row (legacy/fallback behavior).
 *      `createdEmployee` flag ensures rollback never deletes a pre-existing row.
 *   5. INSERT employee_accounts (employee_id, auth_user_id, role, status='active').
 *   6. UPSERT profiles (id=auth_user_id, display_name=name). Best-effort, non-fatal.
 *   7. UPDATE signup_requests.status='approved', reviewed_by, reviewed_at.
 *
 * Rollback: if step 5 fails and we created the employees row in step 4c, that row is
 * deleted. If step 7 fails after step 5 succeeds, returns ok_with_warning (account
 * created but signup_requests row still shows pending_approval until next refetch fix).
 */
import { NextResponse, type NextRequest } from "next/server";
import { assertCanAssignRole, getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_ROLES = [
  "owner",
  "manager",
  "staff_operator",
  "employee_viewer",
  "employee_self_service"
] as const;
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

  let body: { role?: string; employee_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Body không phải JSON.");
  }
  const role = body.role;
  if (!role || !VALID_ROLES.includes(role as Role)) {
    return bad("Role không hợp lệ.");
  }
  // Role ceiling (R3/C2): only an owner may grant the `owner` role.
  try {
    assertCanAssignRole(approver.role as UserRole, role as UserRole);
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Không đủ quyền cấp role.", 403);
  }
  const linkEmployeeId = body.employee_id?.trim() || null;

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

  // Step 4: resolve the employees row to link (link-existing instead of always-insert).
  //   a) explicit employee_id → must exist AND be unlinked.
  //   b) else employee_code matches exactly ONE unlinked employees row → link it.
  //   c) else insert a new employees row (legacy behavior).
  // `createdEmployee` tracks whether WE created the row, so rollback never deletes
  // an existing (possibly already-meaningful) employee.
  let employeeId: string;
  let createdEmployee = false;

  if (linkEmployeeId) {
    const { data: target, error: targetErr } = await supabase
      .from("employees")
      .select("id")
      .eq("id", linkEmployeeId)
      .maybeSingle();
    if (targetErr) return bad(`Không tải được nhân viên: ${targetErr.message}`, 500);
    if (!target) return bad("Không tìm thấy nhân viên để link.", 400);
    const { data: linked, error: linkedErr } = await supabase
      .from("employee_accounts")
      .select("id")
      .eq("employee_id", linkEmployeeId)
      .maybeSingle();
    if (linkedErr) return bad(`Không kiểm tra được tài khoản nhân viên: ${linkedErr.message}`, 500);
    if (linked) return bad("Nhân viên này đã có tài khoản.", 409);
    employeeId = target.id;
  } else {
    // Try to match the signup's employee_code to a single unlinked employees row.
    let matchedId: string | null = null;
    const code = request.employee_code?.trim() || null;
    if (code) {
      const { data: candidates, error: candErr } = await supabase
        .from("employees")
        .select("id")
        .eq("code", code);
      if (candErr) return bad(`Không tra được nhân viên theo mã: ${candErr.message}`, 500);
      if (candidates && candidates.length > 0) {
        const ids = candidates.map((c) => c.id);
        const { data: linkedRows, error: linkedErr } = await supabase
          .from("employee_accounts")
          .select("employee_id")
          .in("employee_id", ids);
        if (linkedErr) return bad(`Không kiểm tra được tài khoản nhân viên: ${linkedErr.message}`, 500);
        const linkedSet = new Set((linkedRows ?? []).map((r) => r.employee_id));
        const unlinked = ids.filter((id) => !linkedSet.has(id));
        if (unlinked.length === 1) matchedId = unlinked[0];
      }
    }

    if (matchedId) {
      employeeId = matchedId;
    } else {
      // Step 4c: INSERT a new employees row.
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
      employeeId = emp.id;
      createdEmployee = true;
    }
  }

  // Step 5: INSERT employee_accounts
  const { error: accError } = await supabase.from("employee_accounts").insert({
    employee_id: employeeId,
    auth_user_id: request.auth_user_id,
    role,
    status: "active",
    created_by: approver.userId
  });
  if (accError) {
    // Roll back ONLY an employee row we created — never an existing linked one.
    if (createdEmployee) {
      void supabase.from("employees").delete().eq("id", employeeId);
    }
    const accCode = (accError as { code?: string }).code;
    if (accCode === "23505") {
      // unique(auth_user_id) OR unique(employee_id) (Task 4) — account already exists.
      return bad("Nhân viên này đã có tài khoản.", 409);
    }
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
    // Account is already created — don't roll back, but signal partial success
    // so the client surfaces a warning instead of treating this as a clean OK
    // (otherwise the signup_requests row stays pending_approval and reappears
    // in the next refetch).
    return NextResponse.json({
      status: "ok_with_warning",
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
