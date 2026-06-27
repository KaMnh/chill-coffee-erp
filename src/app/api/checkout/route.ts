import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import { parseClientIp, matchClientIp } from "@/lib/ip-allowlist";
import { createRateLimiter } from "@/lib/rate-limit";
import { CHECKIN_ALLOWED_ROLES } from "@/lib/api-roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Limiter RIÊNG cho checkout (không "ăn" bucket self check-in). Default = checkin.
const limiter = createRateLimiter({
  max: Number(process.env.CHECKOUT_RATE_MAX ?? process.env.CHECKIN_RATE_MAX ?? 10),
  windowMs: Number(process.env.CHECKOUT_RATE_WINDOW_MS ?? process.env.CHECKIN_RATE_WINDOW_MS ?? 60_000),
});
const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.CHECKIN_TRUSTED_PROXY_COUNT ?? 1));
const IPV6_PREFIX64 = process.env.CHECKIN_IPV6_PREFIX64 !== "false";
const CF_IP_HEADER = process.env.CHECKIN_TRUSTED_IP_HEADER || null;
const CHECKIN_DEBUG = process.env.CHECKIN_DEBUG === "true";
function safeEquals(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

/** TỰ RA CA — đối xứng /api/checkin: cùng cổng proxy-secret + IP/anchor; gate riêng
 *  bằng self_checkout_enabled; gọi check_out_self (đóng ca + chốt lương). */
export async function POST(req: NextRequest) {
  const proxySecret = process.env.CHECKIN_PROXY_SECRET;
  if (!proxySecret) {
    if (process.env.NODE_ENV === "production")
      return NextResponse.json({ status: "error", error: "Tính năng chấm công chưa được cấu hình (proxy)." }, { status: 503 });
  } else {
    const presented = req.headers.get("x-checkin-proxy-secret") || "";
    if (!safeEquals(presented, proxySecret)) {
      if (CHECKIN_DEBUG) console.info("[checkout] proxy-secret reject", JSON.stringify({
        headerPresent: req.headers.has("x-checkin-proxy-secret"), presentedLen: presented.length, expectedLen: proxySecret.length,
      }));
      return NextResponse.json({ status: "error", error: "Forbidden." }, { status: 403 });
    }
  }

  let userId: string;
  try { ({ userId } = await requireAuth(req.headers.get("authorization"), CHECKIN_ALLOWED_ROLES)); }
  catch (e) { const m = e instanceof Error ? e.message : "Auth failed."; return NextResponse.json({ status: "error", error: m }, { status: m.includes("Authorization") || m.includes("Token") ? 401 : 403 }); }

  const supabase = getServiceRoleClient();

  const { data: cfgRow, error: cfgErr } = await supabase.from("app_settings").select("value").eq("key", "checkin_network").maybeSingle();
  if (cfgErr || !cfgRow) return NextResponse.json({ status: "error", error: "Tính năng chấm công chưa được cấu hình." }, { status: 503 });
  const cfg = cfgRow.value as { self_checkout_enabled?: boolean; reject_message?: string; grace_hours?: number };
  if (typeof cfg?.grace_hours !== "number") return NextResponse.json({ status: "error", error: "Cấu hình chấm công không hợp lệ." }, { status: 503 });
  if (cfg.self_checkout_enabled !== true) return NextResponse.json({ status: "error", error: "Tính năng tự ra ca đang tắt." }, { status: 503 });
  const rejectMessage = cfg.reject_message || "Chỉ ra ca được khi ở tại quán (nối wifi quán).";

  const { data: anchors, error: anchErr } = await supabase.rpc("fresh_anchor_ips", { p_grace_hours: cfg.grace_hours });
  if (anchErr) return NextResponse.json({ status: "error", error: "Lỗi đọc thiết bị quán." }, { status: 503 });
  const allow = ((anchors as string[] | null) ?? []).filter(Boolean);
  if (allow.length === 0) return NextResponse.json({ status: "error", error: "Chưa có thiết bị quán hoạt động." }, { status: 503 });

  const ip = parseClientIp(req.headers, { trustedProxyCount: TRUSTED_PROXY_COUNT, trustedHeader: CF_IP_HEADER });
  const match = matchClientIp(ip, allow, { ipv6Prefix64: IPV6_PREFIX64 });
  if (CHECKIN_DEBUG) {
    console.info("[checkout]", JSON.stringify({
      cfConnectingIp: CF_IP_HEADER ? req.headers.get(CF_IP_HEADER) : null,
      resolvedClientIp: ip, normalizedClientIp: match.normalized,
      matchedIpRange: match.matchedRange, ipVersion: match.version, checkinAllowed: match.allowed,
    }));
  }
  if (!ip) return NextResponse.json({ status: "error", error: "Không xác định được IP thật của bạn (kiểm tra cấu hình proxy/Cloudflare)." }, { status: 400 });
  if (!match.allowed) return NextResponse.json({ status: "error", error: rejectMessage }, { status: 403 });

  const now = Date.now();
  const rl = limiter.check(userId, now); if (now % 64 === 0) limiter.sweep(now);
  if (!rl.allowed) return NextResponse.json({ status: "error", error: "Bạn thử quá nhiều lần. Đợi một lát." }, { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } });

  const ua = req.headers.get("user-agent");
  const { data, error } = await supabase.rpc("check_out_self", { p_auth_user_id: userId, p_ip: ip, p_user_agent: ua });
  if (error) return NextResponse.json({ status: "error", error: "Không ra ca được." }, { status: 400 });
  const r = data as { employee_name: string; check_out_at: string; total_pay: number; already_checked_out: boolean };
  return NextResponse.json({ status: "ok", employee_name: r.employee_name, check_out_at: r.check_out_at, total_pay: r.total_pay, already_checked_out: r.already_checked_out });
}
