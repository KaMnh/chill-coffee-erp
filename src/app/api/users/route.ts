/**
 * POST /api/users — Tạo user mới (Auth + employee + employee_account).
 *
 * Auth: owner / manager only (qua requireAuth helper).
 * Body:
 *   {
 *     email: string,
 *     password: string (min 8 chars),
 *     name: string,
 *     position?: string,
 *     hourly_rate?: number,
 *     role: 'owner' | 'manager' | 'staff_operator' | 'employee_viewer'
 *   }
 *
 * Flow:
 *   1. Validate inputs
 *   2. Tạo auth user qua admin.createUser (auto-confirm email)
 *   3. INSERT employees row → get id
 *   4. INSERT employee_accounts (link auth_user_id + role + status='active')
 *   5. INSERT profiles (display_name)
 *   6. Trả {auth_user_id, employee_id} cho frontend
 *
 * Rollback: nếu employee/account insert fail sau khi auth user đã tạo,
 *           nên cleanup auth user. Hiện chưa implement (best-effort), user
 *           có thể xóa manually qua Studio nếu fail giữa chừng.
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

function badRequest(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest) {
  let caller: { userId: string; role: string };
  try {
    caller = await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return badRequest(message, code);
  }

  let body: {
    email?: string;
    password?: string;
    name?: string;
    position?: string;
    hourly_rate?: number;
    role?: string;
    code?: string;
    employee_id?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body không phải JSON hợp lệ.");
  }

  // Validate
  const email = body.email?.trim();
  const password = body.password ?? "";
  const name = body.name?.trim();
  const role = body.role;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return badRequest("Email không hợp lệ.");
  if (password.length < 8) return badRequest("Mật khẩu tối thiểu 8 ký tự.");
  if (!name) return badRequest("Tên nhân viên bắt buộc.");
  if (!role || !VALID_ROLES.includes(role as Role)) return badRequest("Role không hợp lệ.");
  // Role ceiling (R3/C2): only an owner may grant the `owner` role.
  try {
    assertCanAssignRole(caller.role as UserRole, role as UserRole);
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Không đủ quyền cấp role.", 403);
  }
  const linkEmployeeId = body.employee_id?.trim() || null;
  const hourly = Number(body.hourly_rate ?? 0);
  if (!Number.isFinite(hourly) || hourly < 0 || hourly > 10000000) {
    return badRequest("Lương theo giờ phải 0–10.000.000.");
  }
  const position = body.position?.trim() || null;
  const employeeCode = body.code?.trim() || null;

  const supabase = getServiceRoleClient();

  // Step 1: Create auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (authError || !authData.user) {
    return badRequest(`Không tạo được auth user: ${authError?.message ?? "unknown error"}`, 500);
  }
  const authUserId = authData.user.id;

  // Step 2: resolve the employees row — link an existing unlinked one when
  // employee_id is supplied, otherwise create a new row. `createdEmployee`
  // tracks ownership so rollback never deletes an existing employee.
  let employeeId: string;
  let createdEmployee = false;

  if (linkEmployeeId) {
    const { data: target, error: targetErr } = await supabase
      .from("employees")
      .select("id")
      .eq("id", linkEmployeeId)
      .maybeSingle();
    if (targetErr) {
      void supabase.auth.admin.deleteUser(authUserId);
      return badRequest(`Không tải được nhân viên: ${targetErr.message}`, 500);
    }
    if (!target) {
      void supabase.auth.admin.deleteUser(authUserId);
      return badRequest("Không tìm thấy nhân viên để link.", 400);
    }
    const { data: linked, error: linkedErr } = await supabase
      .from("employee_accounts")
      .select("id")
      .eq("employee_id", linkEmployeeId)
      .maybeSingle();
    if (linkedErr) {
      void supabase.auth.admin.deleteUser(authUserId);
      return badRequest(`Không kiểm tra được tài khoản nhân viên: ${linkedErr.message}`, 500);
    }
    if (linked) {
      void supabase.auth.admin.deleteUser(authUserId);
      return badRequest("Nhân viên này đã có tài khoản.", 409);
    }
    employeeId = target.id;
  } else {
    const { data: empData, error: empError } = await supabase
      .from("employees")
      .insert({
        code: employeeCode,
        name,
        position,
        hourly_rate: hourly,
        is_active: true
      })
      .select("id")
      .single();

    if (empError || !empData) {
      // Try cleanup auth user (best-effort)
      void supabase.auth.admin.deleteUser(authUserId);
      return badRequest(`Không tạo được employee: ${empError?.message ?? "unknown"}`, 500);
    }
    employeeId = empData.id;
    createdEmployee = true;
  }

  // Step 3: Insert employee_account
  const { error: accError } = await supabase.from("employee_accounts").insert({
    employee_id: employeeId,
    auth_user_id: authUserId,
    role,
    status: "active"
  });
  if (accError) {
    // Cleanup — only delete an employee row WE created.
    if (createdEmployee) {
      void supabase.from("employees").delete().eq("id", employeeId);
    }
    void supabase.auth.admin.deleteUser(authUserId);
    if ((accError as { code?: string }).code === "23505") {
      return badRequest("Nhân viên này đã có tài khoản.", 409);
    }
    return badRequest(`Không tạo được employee_account: ${accError.message}`, 500);
  }

  // Step 4: Profile (best-effort, không cleanup nếu fail vì không critical)
  await supabase.from("profiles").upsert({ id: authUserId, display_name: name }, { onConflict: "id" });

  return NextResponse.json({
    status: "ok",
    auth_user_id: authUserId,
    employee_id: employeeId
  });
}
