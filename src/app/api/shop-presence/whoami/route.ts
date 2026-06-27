import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/server";
import { parseClientIp } from "@/lib/ip-allowlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.CHECKIN_TRUSTED_PROXY_COUNT ?? 1));
const CF_IP_HEADER = process.env.CHECKIN_TRUSTED_IP_HEADER || null;
const CHECKIN_DEBUG = process.env.CHECKIN_DEBUG === "true";

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req.headers.get("authorization"), ["owner"]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Auth failed.";
    const code = msg.includes("Authorization") || msg.includes("Token") ? 401 : 403;
    return NextResponse.json({ status: "error", error: msg }, { status: code });
  }
  const ip = parseClientIp(req.headers, { trustedProxyCount: TRUSTED_PROXY_COUNT, trustedHeader: CF_IP_HEADER });
  if (CHECKIN_DEBUG) {
    console.info("[whoami]", JSON.stringify({
      cfConnectingIp: CF_IP_HEADER ? req.headers.get(CF_IP_HEADER) : null,
      xForwardedFor: req.headers.get("x-forwarded-for"),
      resolvedClientIp: ip,
    }));
  }
  return NextResponse.json({ status: "ok", ip });
}
