/**
 * POST /api/users/<auth_user_id>/repoint — đổi nhân viên cho một tài khoản ĐÃ gắn
 * (re-point) sang NV đích chưa có TK; deactivate NV nguồn. Owner-only.
 * Nguyên tử qua RPC public.repoint_account(uuid,uuid,uuid).
 * Spec: docs/superpowers/specs/2026-06-26-repoint-account-design.md
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import {
  mapRepointErrorStatus,
  validateRepointBody,
  isSelfRepoint
} from "@/lib/repoint-account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function err(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let caller: { userId: string; role: string };
  try {
    caller = await requireAuth(req.headers.get("authorization"), ["owner"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return err(message, code);
  }

  const { id: authUserId } = await ctx.params;
  if (!authUserId) return err("Thiếu auth_user_id");
  if (isSelfRepoint(caller.userId, authUserId)) {
    return err("Không thể đổi nhân viên cho chính tài khoản của bạn.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err("Body không phải JSON.");
  }
  const parsed = validateRepointBody(raw);
  if (!parsed.ok) return err(parsed.error);

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("repoint_account", {
    p_auth_user_id: authUserId,
    p_target_employee_id: parsed.value.target_employee_id,
    p_expected_source_employee_id: parsed.value.source_employee_id
  });
  if (error) {
    return err(error.message, mapRepointErrorStatus((error as { code?: string }).code));
  }
  return NextResponse.json({ status: "ok", result: data });
}
