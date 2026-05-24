import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const authHeader = req.headers.get("authorization");
  let auth;
  try {
    auth = await requireAuth(authHeader, ["owner"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return NextResponse.json({ status: "error", error: message }, { status: code });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ status: "error", error: "Invalid run ID" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("backup_runs")
    .select("id, kind, status, started_at, finished_at, byte_size, log_text, error_message, filename, created_by")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ status: "error", error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ status: "error", error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
