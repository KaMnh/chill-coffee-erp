/**
 * POST /api/kiotviet/webhook/<secret> — Receive webhook từ KiotViet FNB.
 *
 * KiotViet FNB chỉ gửi webhook cho 5 events: customer.update, customer.delete,
 * product.update, product.delete, stock.update. Invoice KHÔNG có webhook trên FNB
 * (phải dùng polling — xem docs/kiotviet-polling.md).
 *
 * Auth: secret embedded trong URL path (KiotViet không support custom headers).
 *       So sánh với app_settings.kiotviet_credentials.webhook_secret.
 *       Trả 200 OK với mọi request (kể cả secret sai) để không leak existence.
 *
 * Behavior hiện tại (Phase 2A — minimal):
 *   - Validate secret
 *   - Parse payload (Notifications array)
 *   - Log từng event ra stderr (visible qua `docker logs chill-manager-v2`)
 *   - Trả 200 OK
 *
 * Future (chưa implement):
 *   - product.update → trigger lazy product re-fetch
 *   - stock.update → update inventory cache
 *   - customer.update → cập nhật customer in sales_orders
 *   - Persist event vào kv_webhook_events table cho audit/replay
 *
 * Security: secret URL có thể bị log ở proxy → đặt nginx access_log không log path
 * cho route này, hoặc dùng nginx `if ($request_uri ~* "/webhook/")` để bỏ qua.
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { loadKvCredentials } from "@/lib/kiotviet/sync";
import type { KvWebhookPayload } from "@/lib/kiotviet/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Constant-time comparison để tránh timing attack. */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ secret: string }> }) {
  // Always return 200 OK to avoid leaking secret/existence (best practice cho webhook auth).
  // Errors logged server-side only.
  const ackOk = NextResponse.json({ ok: true });
  const { secret: incomingSecret } = await ctx.params;

  try {
    const supabase = getServiceRoleClient();
    const creds = await loadKvCredentials(supabase);

    // 1. Validate secret
    if (!creds.webhook_secret || creds.webhook_secret.length < 8) {
      console.warn("[kiotviet-webhook] webhook_secret chưa cấu hình trong app_settings");
      return ackOk;
    }
    if (!safeEquals(incomingSecret, creds.webhook_secret)) {
      console.warn("[kiotviet-webhook] secret không khớp", { receivedLength: incomingSecret.length });
      return ackOk;
    }

    // 2. Parse payload
    let payload: KvWebhookPayload;
    try {
      payload = (await req.json()) as KvWebhookPayload;
    } catch (err) {
      console.error("[kiotviet-webhook] payload không phải JSON hợp lệ", err);
      return ackOk;
    }

    if (!payload || !Array.isArray(payload.Notifications)) {
      console.warn("[kiotviet-webhook] payload thiếu Notifications array", payload);
      return ackOk;
    }

    // 3. Log từng notification (xử lý logic chi tiết để Phase 2B)
    for (const notif of payload.Notifications) {
      const action = notif.Action ?? "<unknown>";
      const dataIds = (notif.Data ?? []).map((d) => d.Id).filter((id) => id != null);
      console.info(
        `[kiotviet-webhook] ${action} — ${dataIds.length} record(s): ${dataIds.slice(0, 5).join(",")}${dataIds.length > 5 ? "..." : ""}`
      );
      // TODO: action handlers (product.update → product cache refresh, ...)
    }

    return ackOk;
  } catch (error) {
    // KHÔNG để lỗi server side bubble ra response (security: KiotViet không cần biết)
    console.error("[kiotviet-webhook] internal error", error);
    return ackOk;
  }
}

// KiotViet manager đôi khi GET để verify endpoint (handshake) — trả 200 OK kèm thông tin tối thiểu.
export async function GET() {
  return NextResponse.json({ ok: true, service: "chill-erp-kiotviet-webhook" });
}
