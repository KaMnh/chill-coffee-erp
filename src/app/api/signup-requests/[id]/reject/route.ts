/**
 * POST /api/signup-requests/<id>/reject
 *
 * Auth: owner / manager only.
 * Body: { note?: string }
 *
 * Action: set signup_requests.status='rejected', reviewed_by, reviewed_at,
 * note (optional). Does NOT delete the auth.users row — user can still
 * attempt login but will hit the "Tài khoản chờ duyệt" landing screen
 * because they never get an employee_accounts row.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function bad(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let approver: { userId: string };
  try {
    approver = await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return bad(message, code);
  }

  const { id } = await ctx.params;
  if (!id) return bad("Thiếu signup_request id.");

  let body: { note?: string };
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }
  const note = body.note?.trim() || null;

  const supabase = getServiceRoleClient();

  // Fetch + validate status
  const { data: request, error: reqError } = await supabase
    .from("signup_requests")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (reqError) return bad(`Không tải được đơn: ${reqError.message}`, 500);
  if (!request) return bad("Không tìm thấy đơn.", 404);
  if (request.status !== "pending_approval") {
    return bad(`Đơn không ở trạng thái pending_approval (đang: ${request.status}).`, 409);
  }

  const { error: updError } = await supabase
    .from("signup_requests")
    .update({
      status: "rejected",
      reviewed_by: approver.userId,
      reviewed_at: new Date().toISOString(),
      note
    })
    .eq("id", id);
  if (updError) return bad(`Không cập nhật được đơn: ${updError.message}`, 500);

  return NextResponse.json({ status: "ok" });
}
