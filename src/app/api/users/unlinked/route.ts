/**
 * GET /api/users/unlinked — list active login accounts NOT yet attached to any
 * employee (employee_id IS NULL), with their email. Owner/manager only.
 * Used by the "Cấp tài khoản → liên kết tài khoản chưa gắn" picker on the shift page.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  let caller: { userId: string; role: string };
  try {
    caller = await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Auth failed.";
    const code = msg.includes("Authorization") || msg.includes("Token") ? 401 : 403;
    return NextResponse.json({ status: "error", error: msg }, { status: code });
  }

  const supabase = getServiceRoleClient();
  let query = supabase
    .from("employee_accounts")
    .select("auth_user_id, role, status")
    .is("employee_id", null)
    .eq("status", "active");
  // Role ceiling: a manager can't link an `owner` account anyway (PATCH returns 403),
  // so don't surface owner accounts to non-owners — avoids a dead-end option + minor leak.
  if (caller.role !== "owner") query = query.neq("role", "owner");
  const { data: accounts, error } = await query;
  if (error) {
    return NextResponse.json({ status: "error", error: "Không tải được tài khoản chưa gắn." }, { status: 500 });
  }
  const rows = accounts ?? [];
  if (rows.length === 0) return NextResponse.json({ status: "ok", accounts: [] });

  // Resolve emails from auth.users (service role; auth schema not exposed via PostgREST).
  // perPage 1000 is plenty for a single-shop deploy; accounts beyond it show a placeholder
  // email but are still linkable by auth_user_id.
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailById = new Map((list?.users ?? []).map((u) => [u.id, u.email ?? ""]));

  const result = rows.map((a) => ({
    auth_user_id: a.auth_user_id as string,
    email: emailById.get(a.auth_user_id as string) || "(không rõ email)",
    role: a.role as string,
  }));
  return NextResponse.json({ status: "ok", accounts: result });
}
