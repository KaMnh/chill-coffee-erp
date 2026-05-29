/**
 * POST /api/kiotviet/sync — manual trigger: fetch invoices từ KiotViet → ingest vào Supabase.
 *
 * Body (optional JSON):
 *   Windowed/single: { anchorDate?: 'YYYY-MM-DD', applyWindow?: boolean } — the
 *     server resolves the range from the owner-only sync_window_days setting.
 *   Range backfill:  { fromDate: 'YYYY-MM-DD', toDate: 'YYYY-MM-DD' }
 *   Plus: { force?: boolean, reason?: string }. Default (no dates): today only.
 *
 * Auth: owner / manager / staff_operator (giống cooldown rule cũ của edge function).
 *
 * Behavior:
 *   - Per-user rate limit: 6 calls/min (owner: 12) — track in pos_sync_attempts table
 *   - Cooldown: bỏ qua nếu sync trước < 30s (force=true bypass)
 *   - Returns: { status, message, ingested?: {...}, truncated, pages_scanned }
 *
 * Required env:
 *   - SUPABASE_SERVICE_ROLE_KEY: server-side DB access
 *   - INGEST_CLIENT_ID, INGEST_CLIENT_SECRET: integration_clients credentials cho RPC
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import { runSync } from "@/lib/kiotviet/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// KiotViet sync có thể chạy lâu (nhiều page). Cho phép tới 60s.
export const maxDuration = 60;

const COOLDOWN_SECONDS = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;

function badRequest(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest) {
  // Auth: 2 mode hỗ trợ
  //   Mode A — User JWT (Authorization: Bearer ...) — Settings UI manual sync
  //   Mode B — Cron secret (X-Cron-Secret: <CRON_SECRET env>) — system cron polling
  let auth: { userId: string | null; role: string; isCron: boolean };
  const cronHeader = req.headers.get("x-cron-secret");
  const cronEnv = process.env.CRON_SECRET;
  if (cronHeader && cronEnv && cronHeader === cronEnv) {
    // Cron call: bypass user auth, use service role
    auth = { userId: null, role: "cron", isCron: true };
  } else {
    try {
      const userAuth = await requireAuth(req.headers.get("authorization"), [
        "owner",
        "manager",
        "staff_operator"
      ]);
      auth = { userId: userAuth.userId, role: userAuth.role, isCron: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Auth failed.";
      const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
      return badRequest(message, code);
    }
  }

  let body: {
    fromDate?: string;
    toDate?: string;
    anchorDate?: string;
    applyWindow?: boolean;
    force?: boolean;
    reason?: string;
  };
  try {
    body = (await req.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }

  // Date-range backfill (explicit fromDate+toDate) is owner/manager only —
  // mirrors the owner/manager-only Settings card. staff_operator can still run
  // the routine windowed/single sync (anchorDate path); cron is allowed.
  const isRangeBackfill = Boolean(body.fromDate && body.toDate);
  if (isRangeBackfill && !auth.isCron && auth.role !== "owner" && auth.role !== "manager") {
    return badRequest("Chỉ owner/manager được đồng bộ theo khoảng ngày.", 403);
  }

  const supabase = getServiceRoleClient();

  // Per-user rate limit (chỉ áp dụng cho mode user; cron bypass)
  if (!auth.isCron && auth.userId) {
    const sinceIso = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count: recentCount } = await supabase
      .from("pos_sync_attempts")
      .select("id", { count: "exact", head: true })
      .gte("requested_at", sinceIso)
      .eq("user_id", auth.userId);
    const limit = auth.role === "owner" ? 12 : 6;
    if ((recentCount ?? 0) >= limit) {
      return badRequest(`Vượt quá tốc độ cho phép (${limit}/phút).`, 429);
    }
  }

  // Cooldown check (skip nếu sync gần đây + không force)
  // Cron luôn được phép qua nếu chạy theo lịch định sẵn — vẫn check để tránh duplicate
  // khi cron chạy quá dày.
  if (!body.force) {
    const cooldownSince = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString();
    const { data: lastRun } = await supabase
      .from("sales_sync_runs")
      .select("started_at, status")
      .eq("source", "kiotviet")
      .gte("started_at", cooldownSince)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastRun) {
      return NextResponse.json({
        status: "skipped",
        message: `Đã sync gần đây (${COOLDOWN_SECONDS}s), bỏ qua. Bấm Force để chạy lại.`
      });
    }
  }

  // Log attempt (skip cho cron để khỏi pollute pos_sync_attempts table)
  if (!auth.isCron && auth.userId) {
    await supabase.from("pos_sync_attempts").insert({
      user_id: auth.userId,
      force: Boolean(body.force),
      reason: body.reason ?? null
    });
  }

  // Read ingest credentials from env (these auth with public.ingest_kiotviet_batch RPC)
  const ingestClientId = process.env.INGEST_CLIENT_ID;
  const ingestClientSecret = process.env.INGEST_CLIENT_SECRET;
  if (!ingestClientId || !ingestClientSecret) {
    return badRequest(
      "Thiếu env INGEST_CLIENT_ID / INGEST_CLIENT_SECRET. Phải khớp với row trong integration_clients.",
      500
    );
  }

  try {
    const result = await runSync(supabase, ingestClientId, ingestClientSecret, {
      fromDate: body.fromDate,
      toDate: body.toDate,
      anchorDate: body.anchorDate,
      applyWindow: body.applyWindow
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync thất bại.";
    return NextResponse.json({ status: "error", error: message }, { status: 500 });
  }
}
