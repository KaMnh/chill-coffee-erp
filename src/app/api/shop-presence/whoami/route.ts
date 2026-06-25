import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/server";
import { parseClientIp } from "@/lib/ip-allowlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TRUSTED_PROXY_COUNT = Math.max(1, Number(process.env.CHECKIN_TRUSTED_PROXY_COUNT ?? 1));

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req.headers.get("authorization"), ["owner"]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Auth failed.";
    const code = msg.includes("Authorization") || msg.includes("Token") ? 401 : 403;
    return NextResponse.json({ status: "error", error: msg }, { status: code });
  }
  const ip = parseClientIp(req.headers, {
    trustedProxyCount: TRUSTED_PROXY_COUNT,
    trustedHeader: process.env.CHECKIN_TRUSTED_IP_HEADER || null,
  });
  return NextResponse.json({ status: "ok", ip });
}
