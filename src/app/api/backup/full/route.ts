/**
 * POST /api/backup/full — Stream pg_dump SQL của public schema cho owner.
 *
 * Auth: owner only.
 * Output: text/sql attachment, filename `chill-backup-YYYY-MM-DD-HHmm.sql`.
 *
 * Implementation:
 *   - spawn `pg_dump --schema=public --no-owner --no-privileges <URL>`
 *   - Stream stdout → Response body (không buffer trong memory)
 *   - Stderr → console.error (không break response)
 *
 * Yêu cầu:
 *   - postgresql15-client cài trong Dockerfile (matching Supabase Postgres 15)
 *   - Env POSTGRES_BACKUP_URL set với admin credential
 *
 * Phase 2 (defer): cron daily backup, cloud upload, accounting export per table.
 */
import { spawn } from "node:child_process";
import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300; // 5 min — backup DB thường <30s nhưng cấp thoáng

export async function POST(req: NextRequest) {
  // Auth: owner only
  try {
    await requireAuth(req.headers.get("authorization"), ["owner"]);
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

  // pg_dump options:
  //   --schema=public   → chỉ tables app data, skip auth/storage/realtime của Supabase
  //   --no-owner        → bỏ OWNER TO, restore portable qua user khác
  //   --no-privileges   → bỏ GRANT/REVOKE (RLS policies riêng trong 003_rls.sql)
  //   --format=plain    → SQL text default, human-readable + greppable
  const args = ["--schema=public", "--no-owner", "--no-privileges", "--format=plain", dbUrl];
  const proc = spawn("pg_dump", args);

  // Filename theo VN time để khớp UI (DB session = Asia/Ho_Chi_Minh)
  const nowVn = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" });
  // sv-SE locale ra "YYYY-MM-DD HH:mm:ss" — replace space + ":" cho filename-safe
  const filenameTs = nowVn.replace(" ", "T").replace(/:/g, "-").slice(0, 16);
  const filename = `chill-backup-${filenameTs}.sql`;

  let stderrBuffer = "";

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      proc.stdout.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      proc.stderr.on("data", (chunk: Buffer) => {
        const line = chunk.toString();
        stderrBuffer += line;
        console.error("[backup/full] pg_dump stderr:", line.trim());
      });
      proc.on("close", (code) => {
        if (code === 0) {
          controller.close();
        } else {
          controller.error(
            new Error(`pg_dump exit code ${code}. Stderr: ${stderrBuffer.slice(-500)}`)
          );
        }
      });
      proc.on("error", (err) => {
        // ENOENT (binary missing) hoặc spawn fail
        controller.error(err);
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
