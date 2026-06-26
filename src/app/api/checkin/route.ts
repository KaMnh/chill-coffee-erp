import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import { parseClientIp, isIpAllowed } from "@/lib/ip-allowlist";
import { createRateLimiter } from "@/lib/rate-limit";
import type { UserRole } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Roles allowed to self-check-in. Mọi cấp DƯỚI owner đều phải chấm công
 * (manager + staff_operator + employee_self_service); owner KHÔNG tự chấm công
 * (owner vận hành/sửa giờ). Đây là cổng authz thật của route — test trực tiếp.
 */
export const CHECKIN_ALLOWED_ROLES: UserRole[] = ["employee_self_service", "staff_operator", "manager"];

const limiter = createRateLimiter({ max: Number(process.env.CHECKIN_RATE_MAX ?? 10), windowMs: Number(process.env.CHECKIN_RATE_WINDOW_MS ?? 60_000) });
const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.CHECKIN_TRUSTED_PROXY_COUNT ?? 1));
function safeEquals(a: string, b: string) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

export async function POST(req: NextRequest) {
  // (C1/S2) proxy-secret: require it in production; a missing secret in prod fails CLOSED (503),
  // never silently disables the proxy barrier. In dev (no proxy in front) it is skipped — documented.
  const proxySecret = process.env.CHECKIN_PROXY_SECRET;
  if (!proxySecret) {
    if (process.env.NODE_ENV === "production")
      return NextResponse.json({ status: "error", error: "Tính năng chấm công chưa được cấu hình (proxy)." }, { status: 503 });
  } else {
    const presented = req.headers.get("x-checkin-proxy-secret") || "";
    if (!safeEquals(presented, proxySecret)) return NextResponse.json({ status: "error", error: "Forbidden." }, { status: 403 });
  }

  // (B4) employees only; operators use the existing check_in_employee flow.
  let userId: string;
  try { ({ userId } = await requireAuth(req.headers.get("authorization"), CHECKIN_ALLOWED_ROLES)); }
  catch (e) { const m = e instanceof Error ? e.message : "Auth failed."; return NextResponse.json({ status: "error", error: m }, { status: m.includes("Authorization") || m.includes("Token") ? 401 : 403 }); }

  const supabase = getServiceRoleClient();

  // (C3) fail-closed config read.
  const { data: cfgRow, error: cfgErr } = await supabase.from("app_settings").select("value").eq("key", "checkin_network").maybeSingle();
  if (cfgErr || !cfgRow) return NextResponse.json({ status: "error", error: "Tính năng chấm công chưa được cấu hình." }, { status: 503 });
  const cfg = cfgRow.value as { enabled?: boolean; reject_message?: string; grace_hours?: number };
  if (typeof cfg?.enabled !== "boolean" || typeof cfg?.grace_hours !== "number") return NextResponse.json({ status: "error", error: "Cấu hình chấm công không hợp lệ." }, { status: 503 });
  if (cfg.enabled !== true) return NextResponse.json({ status: "error", error: "Tính năng chấm công đang tắt." }, { status: 503 });
  const rejectMessage = cfg.reject_message || "Chỉ chấm công được khi ở tại quán (nối wifi quán).";

  // (R7) fresh anchors, cutoff computed in Postgres via a filter on an ISO string is clock-skew-prone;
  // use an RPC that filters with now() server-side. Read via a small SECURITY DEFINER helper OR
  // filter with .gt('last_heartbeat_at', 'now() - interval') — Postgres can't take an expression in PostgREST,
  // so call a dedicated read RPC:
  const { data: anchors, error: anchErr } = await supabase.rpc("fresh_anchor_ips", { p_grace_hours: cfg.grace_hours });
  if (anchErr) return NextResponse.json({ status: "error", error: "Lỗi đọc thiết bị quán." }, { status: 503 });
  const allow = ((anchors as string[] | null) ?? []).filter(Boolean);
  if (allow.length === 0) return NextResponse.json({ status: "error", error: "Chưa có thiết bị quán hoạt động." }, { status: 503 });

  const ip = parseClientIp(req.headers, { trustedProxyCount: TRUSTED_PROXY_COUNT, trustedHeader: process.env.CHECKIN_TRUSTED_IP_HEADER || null });
  if (!isIpAllowed(ip, allow)) return NextResponse.json({ status: "error", error: rejectMessage }, { status: 403 });

  // (S1) rate-limit only AFTER auth + config + IP gate pass (matches spec §6 order; the write is what we throttle).
  const now = Date.now();
  const rl = limiter.check(userId, now); if (now % 64 === 0) limiter.sweep(now); // probabilistic GC: sweep expired buckets ~1-in-64 requests
  if (!rl.allowed) return NextResponse.json({ status: "error", error: "Bạn thử quá nhiều lần. Đợi một lát." }, { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } });

  const ua = req.headers.get("user-agent");
  const { data, error } = await supabase.rpc("check_in_self", { p_auth_user_id: userId, p_ip: ip, p_user_agent: ua });
  if (error) return NextResponse.json({ status: "error", error: "Không chấm công được." }, { status: 400 });
  const r = data as { employee_name: string; check_in_at: string; already_checked_in: boolean };
  return NextResponse.json({ status: "ok", employee_name: r.employee_name, check_in_at: r.check_in_at, already_checked_in: r.already_checked_in });
}
