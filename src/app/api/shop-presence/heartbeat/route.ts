import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { parseClientIp } from "@/lib/ip-allowlist";
import { createRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.CHECKIN_TRUSTED_PROXY_COUNT ?? 1));
const CF_IP_HEADER = process.env.CHECKIN_TRUSTED_IP_HEADER || null;
// Bật CHECKIN_DEBUG=true để log IP server nhận được khi ghi anchor (PII — tắt sau khi xong).
const CHECKIN_DEBUG = process.env.CHECKIN_DEBUG === "true";

// Heartbeat is authenticated by the DEVICE TOKEN alone — NOT an owner session — so
// the always-on shop anchor device keeps its IP fresh under any logged-in session
// (manager/staff). Light per-source-IP rate-limit: legit traffic is ~1 ping/focus/6h.
const limiter = createRateLimiter({ max: 30, windowMs: 60_000 });

/** Constant-time comparison để tránh timing attack. */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function POST(req: NextRequest) {
  // (C1) proxy-secret parity with /api/checkin: this route WRITES the IP that
  // check-in trusts, so it must be gated at least as strongly. Fail-closed in prod.
  const proxySecret = process.env.CHECKIN_PROXY_SECRET;
  if (!proxySecret) {
    if (process.env.NODE_ENV === "production")
      return NextResponse.json({ status: "error", error: "Chưa cấu hình (proxy)." }, { status: 503 });
  } else {
    const presented = req.headers.get("x-checkin-proxy-secret") || "";
    if (!safeEquals(presented, proxySecret)) {
      // Safe diagnostic (no secret value): tells you WHY the 403 — header not
      // injected by the proxy (headerPresent=false), or value mismatch
      // (lengths differ = whitespace/quote/truncation; same length = typo).
      if (CHECKIN_DEBUG) console.info("[heartbeat] proxy-secret reject", JSON.stringify({
        headerPresent: req.headers.has("x-checkin-proxy-secret"),
        presentedLen: presented.length,
        expectedLen: proxySecret.length,
      }));
      return NextResponse.json({ status: "error", error: "Forbidden." }, { status: 403 });
    }
  }

  let anchorId: string | undefined;
  let deviceToken: string | undefined;
  try {
    const body = (await req.json()) as { anchor_id?: string; device_token?: string };
    anchorId = body.anchor_id;
    deviceToken = body.device_token;
  } catch {
    return NextResponse.json({ status: "error", error: "Yêu cầu không hợp lệ." }, { status: 400 });
  }
  if (!anchorId || !deviceToken) {
    return NextResponse.json({ status: "error", error: "Thiếu anchor_id hoặc device_token." }, { status: 400 });
  }

  const ip = parseClientIp(req.headers, { trustedProxyCount: TRUSTED_PROXY_COUNT, trustedHeader: CF_IP_HEADER });
  if (CHECKIN_DEBUG) {
    console.info("[heartbeat]", JSON.stringify({
      cfConnectingIp: CF_IP_HEADER ? req.headers.get(CF_IP_HEADER) : null,
      xForwardedFor: req.headers.get("x-forwarded-for"),
      resolvedClientIp: ip,
      anchorId,
    }));
  }
  if (!ip) {
    return NextResponse.json({ status: "error", error: "Không xác định được IP thật của thiết bị (proxy/Cloudflare chưa chuyển IP thật — cf-connecting-ip / x-forwarded-for)." }, { status: 400 });
  }

  // Rate-limit by SOURCE IP (not the attacker-controllable anchor_id) BEFORE the DB
  // lookup, and sweep every request so the bucket map stays bounded by distinct IPs.
  const now = Date.now();
  const rl = limiter.check(ip, now);
  limiter.sweep(now);
  if (!rl.allowed) {
    return NextResponse.json({ status: "error", error: "Quá nhiều heartbeat." }, { status: 429 });
  }

  const admin = getServiceRoleClient();
  const { data: anchor } = await admin
    .from("checkin_anchor")
    .select("id, device_token_hash")
    .eq("id", anchorId)
    .maybeSingle();
  // The device token is the credential — constant-time compare against the stored hash.
  if (!anchor || !safeEquals(sha256Hex(deviceToken), String(anchor.device_token_hash))) {
    return NextResponse.json({ status: "error", error: "Thiết bị không hợp lệ." }, { status: 403 });
  }

  // Token verified → write via SERVICE ROLE (record_shop_anchor_heartbeat is
  // service-role-only). No owner session required. IP is the server-read source IP.
  const { data, error } = await admin.rpc("record_shop_anchor_heartbeat", {
    p_anchor_id: anchorId,
    p_public_ip: ip,
  });
  if (error) return NextResponse.json({ status: "error", error: "Không cập nhật được heartbeat." }, { status: 400 });
  const row = data as { current_public_ip: string | null; last_heartbeat_at: string };
  return NextResponse.json({ status: "ok", current_public_ip: row.current_public_ip, last_heartbeat_at: row.last_heartbeat_at });
}
