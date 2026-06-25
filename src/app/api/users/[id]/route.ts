/**
 * PATCH /api/users/<auth_user_id> — Update role / status / employee fields.
 * DELETE /api/users/<auth_user_id> — Soft delete (set status='disabled', is_active=false).
 *
 * Auth: owner / manager only.
 *
 * PATCH body (any subset):
 *   {
 *     role?: string,             // employee_accounts.role
 *     status?: 'active' | 'disabled',  // employee_accounts.status
 *     name?: string,
 *     position?: string,
 *     hourly_rate?: number
 *   }
 *
 * DELETE: soft delete only — KHÔNG xóa hẳn auth user (giữ history).
 *         Để xóa hẳn → admin manual qua Supabase Studio Auth UI.
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
const VALID_STATUS = ["active", "disabled"] as const;

function badRequest(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

/**
 * Verify owner/manager. Returns the caller's row on success, or a NextResponse
 * (error) to short-circuit. Callers must check `instanceof NextResponse`.
 */
async function ensureAuth(
  req: NextRequest
): Promise<NextResponse | { userId: string; role: string }> {
  try {
    return await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return badRequest(message, code);
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;
  const caller = auth;

  const { id: authUserId } = await ctx.params;
  if (!authUserId) return badRequest("Thiếu auth_user_id");

  let body: {
    role?: string;
    status?: string;
    name?: string;
    position?: string;
    hourly_rate?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return badRequest("Body không phải JSON.");
  }

  const supabase = getServiceRoleClient();

  // Update employee_accounts (role/status)
  const accountPatch: Record<string, unknown> = {};
  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role as never)) return badRequest("Role không hợp lệ.");
    // Role ceiling (R3/C2): only an owner may change a role to `owner`.
    try {
      assertCanAssignRole(caller.role as UserRole, body.role as UserRole);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "Không đủ quyền cấp role.", 403);
    }
    accountPatch.role = body.role;
  }
  if (body.status !== undefined) {
    if (!VALID_STATUS.includes(body.status as never)) return badRequest("Status không hợp lệ.");
    accountPatch.status = body.status;
  }

  if (Object.keys(accountPatch).length > 0) {
    const { error } = await supabase
      .from("employee_accounts")
      .update(accountPatch)
      .eq("auth_user_id", authUserId);
    if (error) return badRequest(`Không update employee_accounts: ${error.message}`, 500);
  }

  // Update employees (name/position/hourly_rate)
  const employeePatch: Record<string, unknown> = {};
  if (body.name !== undefined) employeePatch.name = body.name.trim();
  if (body.position !== undefined) employeePatch.position = body.position?.trim() || null;
  if (body.hourly_rate !== undefined) {
    const rate = Number(body.hourly_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 10000000) {
      return badRequest("Lương theo giờ không hợp lệ (0-10M).");
    }
    employeePatch.hourly_rate = rate;
  }

  if (Object.keys(employeePatch).length > 0) {
    // Resolve employee_id from auth_user_id
    const { data: account } = await supabase
      .from("employee_accounts")
      .select("employee_id")
      .eq("auth_user_id", authUserId)
      .maybeSingle();
    if (!account?.employee_id) return badRequest("Không tìm thấy employee gắn với auth user.", 404);

    const { error } = await supabase
      .from("employees")
      .update(employeePatch)
      .eq("id", account.employee_id);
    if (error) return badRequest(`Không update employees: ${error.message}`, 500);

    // Update profile display_name if name changed
    if (body.name !== undefined) {
      await supabase
        .from("profiles")
        .upsert({ id: authUserId, display_name: body.name.trim() }, { onConflict: "id" });
    }
  }

  return NextResponse.json({ status: "ok" });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await ensureAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id: authUserId } = await ctx.params;
  if (!authUserId) return badRequest("Thiếu auth_user_id");

  const supabase = getServiceRoleClient();

  // Soft delete: disable account + deactivate employee
  const { data: account } = await supabase
    .from("employee_accounts")
    .select("employee_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  const { error: accError } = await supabase
    .from("employee_accounts")
    .update({ status: "disabled" })
    .eq("auth_user_id", authUserId);
  if (accError) return badRequest(`Không disable account: ${accError.message}`, 500);

  if (account?.employee_id) {
    await supabase
      .from("employees")
      .update({ is_active: false })
      .eq("id", account.employee_id);
  }

  return NextResponse.json({ status: "ok", message: "Đã vô hiệu hóa tài khoản." });
}
