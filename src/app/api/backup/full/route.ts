/**
 * POST /api/backup/full — Stream pg_dump SQL của public schema cho owner.
 *
 * Auth: owner only.
 * Output: text/sql attachment, filename `chill-backup-YYYY-MM-DD-HHmm.sql`.
 *
 * Implementation:
 *   - INSERT backup_runs row (status='running') BEFORE spawn
 *   - spawn `pg_dump --schema=public --no-owner --no-privileges <URL>`
 *   - Stream stdout → Response body (không buffer trong memory)
 *   - Stderr → console.error (không break response)
 *   - UPDATE backup_runs row on exit (status='success'/'failed', byte_size, log_text)
 *
 * Yêu cầu:
 *   - postgresql15-client cài trong Dockerfile (matching Supabase Postgres 15)
 *   - Env POSTGRES_BACKUP_URL set với admin credential
 *
 * Phase 2 (defer): cron daily backup, cloud upload, accounting export per table.
 */
import { spawn } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, getServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — backup DB thường <30s nhưng cấp thoáng

/** Format VN timestamp for filename: YYYY-MM-DD-HHmm */
function formatVnTimestamp(): string {
  const nowVn = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
  // sv-SE locale ra "YYYY-MM-DD HH:mm:ss" — replace space + ":" cho filename-safe
  return nowVn.replace(" ", "T").replace(/:/g, "-").slice(0, 16);
}

export async function POST(req: NextRequest) {
  // Auth: owner only
  let auth: { userId: string; role: string };
  try {
    auth = await requireAuth(req.headers.get("authorization"), ["owner"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return NextResponse.json({ status: "error", error: message }, { status: code });
  }

  const dbUrl = process.env.POSTGRES_BACKUP_URL;
  if (!dbUrl) {
    return NextResponse.json(
      {
        status: "error",
        error:
          "POSTGRES_BACKUP_URL chưa được cấu hình. Set env này trong .env / docker-compose rồi restart app."
      },
      { status: 500 }
    );
  }

  // Filename theo VN time để khớp UI (DB session = Asia/Ho_Chi_Minh)
  const filename = `chill-backup-${formatVnTimestamp()}.sql`;

  // Create backup_runs row BEFORE spawning pg_dump
  const supabase = getServiceRoleClient();
  const { data: runRow, error: insertErr } = await supabase
    .from("backup_runs")
    .insert({
      kind: "backup",
      status: "running",
      filename,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (insertErr || !runRow) {
    return new Response(`Cannot create backup_runs row: ${insertErr?.message}`, { status: 500 });
  }
  const runId = runRow.id as string;

  // pg_dump options:
  //   --schema=public   → chỉ tables app data, skip auth/storage/realtime của Supabase
  //   --no-owner        → bỏ OWNER TO, restore portable qua user khác
  //   --no-privileges   → bỏ GRANT/REVOKE (RLS policies riêng trong 003_rls.sql)
  //   --format=plain    → SQL text default, human-readable + greppable
  const args = ["--schema=public", "--no-owner", "--no-privileges", "--format=plain", dbUrl];
  const proc = spawn("pg_dump", args);

  let stderrBuffer = "";
  let totalBytes = 0;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      proc.stdout.on("data", (chunk: Buffer) => {
        const bytes = new Uint8Array(chunk);
        totalBytes += bytes.length;
        controller.enqueue(bytes);
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        const line = chunk.toString();
        // Cap stderrBuffer at 1MB to avoid unbounded memory growth
        if (stderrBuffer.length < 1_000_000) {
          stderrBuffer += line;
        }
        console.error("[backup/full] pg_dump stderr:", line.trim());
      });
      proc.on("close", async (code) => {
        const finishedAt = new Date().toISOString();
        if (code === 0) {
          controller.close();
          const { error: updateErr } = await supabase
            .from("backup_runs")
            .update({
              status: "success",
              finished_at: finishedAt,
              byte_size: totalBytes,
              log_text: stderrBuffer.slice(0, 1_000_000),
            })
            .eq("id", runId);
          if (updateErr) {
            console.error("[backup/full] Failed to update backup_runs:", updateErr.message);
          }
        } else {
          controller.error(
            new Error(`pg_dump exit code ${code}. Stderr: ${stderrBuffer.slice(-500)}`)
          );
          const { error: updateErr } = await supabase
            .from("backup_runs")
            .update({
              status: "failed",
              finished_at: finishedAt,
              byte_size: totalBytes,
              log_text: stderrBuffer.slice(0, 1_000_000),
              error_message: stderrBuffer.slice(-500),
            })
            .eq("id", runId);
          if (updateErr) {
            console.error("[backup/full] Failed to update backup_runs:", updateErr.message);
          }
        }
      });
      proc.on("error", async (err) => {
        // ENOENT (binary missing) hoặc spawn fail
        controller.error(err);
        const { error: updateErr } = await supabase
          .from("backup_runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            byte_size: totalBytes,
            error_message: err.message.slice(-500),
          })
          .eq("id", runId);
        if (updateErr) {
          console.error("[backup/full] Failed to update backup_runs:", updateErr.message);
        }
      });
    },
    cancel() {
      proc.kill();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/sql; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
