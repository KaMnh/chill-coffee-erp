/**
 * POST /api/backup/restore — Restore DB từ file pg_dump SQL upload.
 *
 * Auth: owner only.
 * Input: multipart/form-data với field "file" (SQL file từ pg_dump).
 * Output: text/plain streaming logs (psql stderr + status markers).
 *
 * Implementation:
 *   1. Auth check (owner only)
 *   2. Parse multipart form, validate file size (<= 100MB)
 *   3. Validate pg_dump header (first 500 bytes)
 *   4. INSERT backup_runs row (kind='restore', status='running')
 *   5. Stream response:
 *      a. Pre-restore: DROP SCHEMA public CASCADE + recreate
 *      b. Pipe uploaded file → psql stdin (--single-transaction)
 *      c. UPDATE backup_runs on exit
 *
 * WARNING: This endpoint DROPS THE PUBLIC SCHEMA. ALL DATA IS DESTROYED before restore.
 * --single-transaction makes the restore atomic (all-or-nothing per psql).
 *
 * Yêu cầu:
 *   - postgresql15-client cài trong Dockerfile
 *   - Env POSTGRES_BACKUP_URL set với admin credential
 */
import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min

const POSTGRES_BACKUP_URL = process.env.POSTGRES_BACKUP_URL;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const PG_DUMP_HEADER_REGEX = /-- PostgreSQL database dump/i;

export async function POST(req: NextRequest) {
  // 1. Auth check (owner-only)
  let auth: { userId: string; role: string };
  try {
    auth = await requireAuth(req.headers.get("authorization"), ["owner"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code =
      message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return new Response(message, { status: code });
  }

  if (!POSTGRES_BACKUP_URL) {
    return new Response("POSTGRES_BACKUP_URL not configured", { status: 500 });
  }

  // 2. Parse multipart form
  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return new Response("Missing file field", { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return new Response(
      `File quá lớn (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`,
      { status: 400 }
    );
  }

  // 3. Validate pg_dump header (first 500 bytes)
  const headerBuf = await file.slice(0, 500).text();
  if (!PG_DUMP_HEADER_REGEX.test(headerBuf)) {
    return new Response(
      "File không phải pg_dump format (header invalid)",
      { status: 400 }
    );
  }

  // 4. INSERT backup_runs row
  const supabase = getServiceRoleClient();
  const { data: runRow, error: insertErr } = await supabase
    .from("backup_runs")
    .insert({
      kind: "restore",
      status: "running",
      filename: file.name,
      byte_size: file.size,
      created_by: auth.userId,
    })
    .select("id")
    .single();
  if (insertErr || !runRow) {
    return new Response(
      `Cannot create backup_runs row: ${insertErr?.message}`,
      { status: 500 }
    );
  }
  const runId = runRow.id as string;

  // 5. Setup streaming response
  const encoder = new TextEncoder();
  let stderrBuffer = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 5a. Pre-restore: drop + recreate public schema
        controller.enqueue(encoder.encode(">>> Dropping public schema...\n"));
        await runPsqlCommand(
          POSTGRES_BACKUP_URL!,
          `drop schema public cascade; create schema public;
           grant all on schema public to authenticated, anon, service_role;`
        );
        controller.enqueue(encoder.encode("    ✓ Schema dropped + recreated\n\n"));

        // 5b. Stream upload file → psql stdin
        controller.enqueue(encoder.encode(">>> Restoring from backup file...\n"));
        const proc = spawn("psql", [
          POSTGRES_BACKUP_URL!,
          "--single-transaction",
          "-v",
          "ON_ERROR_STOP=1",
        ]);

        // Stream uploaded file → psql stdin (avoid loading 100MB into RAM)
        const reader = file.stream().getReader();
        (async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            proc.stdin.write(value);
          }
          proc.stdin.end();
        })();

        // Capture stderr line by line → buffer + stream
        proc.stderr.on("data", (data: Buffer) => {
          const text = data.toString();
          if (stderrBuffer.length < 1_000_000) {
            stderrBuffer += text;
          }
          controller.enqueue(encoder.encode(text));
        });

        // Wait for exit
        const code = await new Promise<number>((resolve) => {
          proc.on("exit", (c) => resolve(c ?? 1));
        });

        const finishedAt = new Date().toISOString();
        if (code === 0) {
          controller.enqueue(encoder.encode("\n===END=== status=success\n"));
          const { error: updateErr } = await supabase
            .from("backup_runs")
            .update({
              status: "success",
              finished_at: finishedAt,
              log_text: stderrBuffer.slice(0, 1_000_000),
            })
            .eq("id", runId);
          if (updateErr) {
            console.error(
              "[backup/restore] Failed to update backup_runs:",
              updateErr.message
            );
          }
        } else {
          controller.enqueue(
            encoder.encode(`\n===END=== status=failed (exit ${code})\n`)
          );
          const { error: updateErr } = await supabase
            .from("backup_runs")
            .update({
              status: "failed",
              finished_at: finishedAt,
              log_text: stderrBuffer.slice(0, 1_000_000),
              error_message: stderrBuffer.slice(-500),
            })
            .eq("id", runId);
          if (updateErr) {
            console.error(
              "[backup/restore] Failed to update backup_runs:",
              updateErr.message
            );
          }
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(
          encoder.encode(`\n===END=== status=failed (${msg})\n`)
        );
        const { error: updateErr } = await supabase
          .from("backup_runs")
          .update({
            status: "failed",
            finished_at: new Date().toISOString(),
            log_text: stderrBuffer.slice(0, 1_000_000),
            error_message: msg.slice(0, 500),
          })
          .eq("id", runId);
        if (updateErr) {
          console.error(
            "[backup/restore] Failed to update backup_runs:",
            updateErr.message
          );
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "X-Run-Id": runId,
    },
  });
}

/** Helper: run a single psql command, throw if non-zero exit */
function runPsqlCommand(url: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}
