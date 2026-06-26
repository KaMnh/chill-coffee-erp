import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { getServiceRoleClient, getUserClient, requireAuth } from "@/lib/supabase/server";
import { parseClientIp } from "@/lib/ip-allowlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.CHECKIN_TRUSTED_PROXY_COUNT ?? 1));

/** Constant-time comparison để tránh timing attack. */
function safeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  try {
    await requireAuth(authHeader, ["owner"]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Auth failed.";
    const code = msg.includes("Authorization") || msg.includes("Token") ? 401 : 403;
    return NextResponse.json({ status: "error", error: msg }, { status: code });
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

  const admin = getServiceRoleClient();
  const { data: anchor } = await admin
    .from("checkin_anchor")
    .select("id, device_token_hash")
    .eq("id", anchorId)
    .maybeSingle();
  if (!anchor || !safeEquals(sha256Hex(deviceToken), String(anchor.device_token_hash))) {
    return NextResponse.json({ status: "error", error: "Thiết bị không hợp lệ." }, { status: 403 });
  }

  const ip = parseClientIp(req.headers, {
    trustedProxyCount: TRUSTED_PROXY_COUNT,
    trustedHeader: process.env.CHECKIN_TRUSTED_IP_HEADER || null,
  });
  if (!ip) {
    return NextResponse.json({ status: "error", error: "Không xác định được IP thật của thiết bị (kiểm tra proxy)." }, { status: 400 });
  }

  // Call via the owner JWT so the SQL owner-gate (app_role()='owner') is the enforced boundary.
  const userClient = getUserClient(authHeader);
  const { data, error } = await userClient.rpc("record_shop_anchor_heartbeat", {
    p_anchor_id: anchorId,
    p_public_ip: ip,
  });
  if (error) return NextResponse.json({ status: "error", error: "Không cập nhật được heartbeat." }, { status: 400 });
  const row = data as { current_public_ip: string | null; last_heartbeat_at: string };
  return NextResponse.json({ status: "ok", current_public_ip: row.current_public_ip, last_heartbeat_at: row.last_heartbeat_at });
}
