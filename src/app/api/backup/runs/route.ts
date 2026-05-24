import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Auth: owner only
  const authHeader = req.headers.get("authorization");
  let auth;
  try {
    auth = await requireAuth(authHeader, ["owner"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return NextResponse.json({ status: "error", error: message }, { status: code });
  }

  // Parse limit query param, clamp to 1-50
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "10");
  const limit = Math.min(Math.max(1, isFinite(limitRaw) ? limitRaw : 10), 50);

  // Query backup_runs table
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("backup_runs")
    .select("id, kind, status, started_at, finished_at, byte_size, error_message, filename, created_by")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ status: "error", error: error.message }, { status: 500 });
  }

  return NextResponse.json({ runs: data ?? [] });
}
