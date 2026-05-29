/**
 * GET  /api/kiotviet/config — return current credentials (with client_secret masked)
 * POST /api/kiotviet/config — update credentials (owner/manager only)
 *
 * Auth: caller must be authenticated as owner or manager.
 *       JWT passed via Authorization: Bearer header from frontend.
 *
 * Storage: app_settings row with key='kiotviet_credentials', is_public=false.
 *          Service role used server-side for read/write to avoid RLS leak.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import { loadKvCredentials, maskCredentials, saveKvCredentials } from "@/lib/kiotviet/sync";

// Force dynamic — this route reads request headers and DB.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
    const supabase = getServiceRoleClient();
    const creds = await loadKvCredentials(supabase);
    return NextResponse.json({ status: "ok", config: maskCredentials(creds) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi không xác định.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 :
                 message.includes("không có quyền") || message.includes("Role") ? 403 :
                 500;
    return NextResponse.json({ status: "error", error: message }, { status: code });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth(req.headers.get("authorization"), ["owner", "manager"]);
    const body = (await req.json()) as Record<string, unknown>;

    // Whitelist fields & coerce
    const patch: Record<string, unknown> = {};
    if (typeof body.client_id === "string") patch.client_id = body.client_id.trim();
    if (typeof body.client_secret === "string" && body.client_secret.length > 0) {
      // Empty string = "do not change" (UI sends empty when user doesn't re-enter)
      patch.client_secret = body.client_secret;
    }
    if (typeof body.retailer === "string") patch.retailer = body.retailer.trim();
    if (typeof body.token_url === "string") patch.token_url = body.token_url.trim();
    if (typeof body.api_base === "string") patch.api_base = body.api_base.trim();
    if (typeof body.scope === "string") patch.scope = body.scope.trim();
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if (typeof body.rate_limit_per_sec === "number" && body.rate_limit_per_sec >= 1 && body.rate_limit_per_sec <= 10) {
      patch.rate_limit_per_sec = body.rate_limit_per_sec;
    }
    if (
      typeof body.sync_window_days === "number" &&
      Number.isInteger(body.sync_window_days) &&
      body.sync_window_days >= 1 &&
      body.sync_window_days <= 31
    ) {
      patch.sync_window_days = body.sync_window_days;
    }
    if (typeof body.webhook_secret === "string") {
      // Empty string = clear (revoke webhook); non-empty = update.
      patch.webhook_secret = body.webhook_secret.trim();
    }

    const supabase = getServiceRoleClient();
    const updated = await saveKvCredentials(supabase, patch);
    return NextResponse.json({ status: "ok", config: maskCredentials(updated) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lỗi không xác định.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 :
                 message.includes("không có quyền") || message.includes("Role") ? 403 :
                 500;
    return NextResponse.json({ status: "error", error: message }, { status: code });
  }
}
