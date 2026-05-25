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
 *      a. Pre-restore SNAPSHOT — dump CURRENT public schema to /backups/pre-restore/
 *         BEFORE any destructive operation. If snapshot fails, abort the
 *         restore (no DROP) so existing data is preserved.
 *      b. DROP SCHEMA public CASCADE + recreate
 *      c. Pipe uploaded file → psql stdin (--single-transaction)
 *      d. UPDATE backup_runs on exit (incl. pre_restore_dump_path for rollback)
 *
 * WARNING: This endpoint DROPS THE PUBLIC SCHEMA. ALL DATA IS DESTROYED before restore.
 * --single-transaction makes the restore atomic (all-or-nothing per psql).
 * The pre-restore snapshot path is recorded in backup_runs.pre_restore_dump_path
 * so operators can recover from a bad restore by piping it back into psql.
 *
 * Yêu cầu:
 *   - postgresql15-client cài trong Dockerfile
 *   - Env POSTGRES_BACKUP_URL set với admin credential
 *   - /backups/pre-restore/ writable (provided by chill-backup-cron, mode 1777)
 */
import { mkdirSync, statSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { NextRequest } from "next/server";
import { spawn } from "node:child_process";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min

const POSTGRES_BACKUP_URL = process.env.POSTGRES_BACKUP_URL;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const PG_DUMP_HEADER_REGEX = /-- PostgreSQL database dump/i;
// Min size for a valid pg_dump (header + at least one statement). A truly
// empty schema dumps to ~2KB of SET / SELECT pg_catalog... boilerplate.
const MIN_PRE_RESTORE_BYTES = 1024;
const PRE_RESTORE_DIR =
  process.env.PRE_RESTORE_DIR || "/backups/pre-restore";

// SQL block re-applied AFTER a successful restore. The DROP SCHEMA public
// CASCADE earlier in this endpoint wipes every grant on the public schema,
// and pg_dump --no-privileges (used by /api/backup/full for portability)
// produces dumps without GRANT statements. Without re-granting, Supabase
// roles cannot see any restored data — login itself fails because
// employee_accounts is invisible to the authenticated role.
//
// Kept in lockstep with database/003_rls.sql + database/migrations/
// 2026-05-25-grant-service-role.sql. If you change one, change the others.
//
// NOTIFY pgrst forces PostgREST to re-introspect the schema immediately so
// the new tables are visible to the REST API without waiting for the next
// periodic refresh.
const POST_RESTORE_GRANTS_SQL = `
grant usage on schema public to authenticated, anon, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, anon, service_role;
grant execute on all functions in schema public to authenticated, anon, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, anon, service_role;
notify pgrst, 'reload schema';
`;
// Fallback inside the container's writable /tmp if PRE_RESTORE_DIR is not
// accessible (volume not mounted, perms wrong, backup-cron sidecar missing).
// /tmp is always writable by the nextjs UID but is tmpfs/ephemeral — snapshot
// is lost on container restart, so we WARN loudly when this kicks in.
const PRE_RESTORE_FALLBACK_DIR =
  process.env.PRE_RESTORE_FALLBACK_DIR || "/tmp/chill-restore-snapshots";

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
  let preRestoreDumpPath: string | null = null;

  let proc: ReturnType<typeof spawn> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // 5a. PRE-RESTORE SNAPSHOT — dump current public schema BEFORE any
        // destructive operation. Skipping or silently swallowing this step
        // would re-create the original data loss bug. If snapshot fails, we
        // abort the restore (no DROP) so existing data is preserved.
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "")
          .slice(0, 15); // YYYYMMDDTHHMMSS
        // Pick the writable directory: prefer the persistent /backups mount
        // (visible to chill-backup-cron for off-host rsync), fall back to
        // ephemeral /tmp if the volume isn't there or perms block us.
        // Try mkdir-with-recursive on the preferred dir; if it throws EACCES
        // (or any error), switch to fallback and warn loudly.
        let snapshotDir = PRE_RESTORE_DIR;
        let usedFallback = false;
        try {
          mkdirSync(PRE_RESTORE_DIR, { recursive: true });
        } catch (dirErr) {
          const code = (dirErr as NodeJS.ErrnoException).code;
          if (code === "EACCES" || code === "EROFS" || code === "ENOENT") {
            mkdirSync(PRE_RESTORE_FALLBACK_DIR, { recursive: true });
            snapshotDir = PRE_RESTORE_FALLBACK_DIR;
            usedFallback = true;
            controller.enqueue(
              encoder.encode(
                `>>> WARNING: ${PRE_RESTORE_DIR} not writable (${code}). ` +
                  `Falling back to ephemeral ${PRE_RESTORE_FALLBACK_DIR} ` +
                  `(snapshot will be LOST on container restart — ` +
                  `docker cp it out if restore fails).\n`
              )
            );
          } else {
            throw dirErr;
          }
        }
        const candidatePath = `${snapshotDir}/pre-restore-${runId}-${timestamp}.sql`;
        controller.enqueue(
          encoder.encode(
            `>>> Pre-restore snapshot → ${candidatePath}\n`
          )
        );
        try {
          await runPgDumpToFile(POSTGRES_BACKUP_URL!, candidatePath);
          verifyPgDumpFile(candidatePath); // throws if invalid
          preRestoreDumpPath = candidatePath;
          const persistedNote = usedFallback
            ? ` (ephemeral — copy out with: docker cp chill-app:${candidatePath} ./)`
            : "";
          controller.enqueue(
            encoder.encode(
              `    ✓ Snapshot saved (${statSync(candidatePath).size} bytes)${persistedNote}. ` +
                `Rollback command: psql "$POSTGRES_BACKUP_URL" < "${candidatePath}"\n\n`
            )
          );
          // Persist path NOW so even if subsequent steps crash, the row tells
          // the operator where the rollback file is.
          await supabase
            .from("backup_runs")
            .update({ pre_restore_dump_path: candidatePath })
            .eq("id", runId);
        } catch (snapErr) {
          // Snapshot failed — DO NOT proceed to DROP SCHEMA. Mark run failed.
          const msg =
            snapErr instanceof Error ? snapErr.message : String(snapErr);
          // Clean up partial file if any
          try {
            unlinkSync(candidatePath);
          } catch {
            /* ignore — file may not exist */
          }
          controller.enqueue(
            encoder.encode(
              `    ✗ Snapshot FAILED — aborting restore to preserve data: ${msg}\n` +
                `===END=== status=failed (pre-restore snapshot)\n`
            )
          );
          await supabase
            .from("backup_runs")
            .update({
              status: "failed",
              finished_at: new Date().toISOString(),
              error_message: `pre-restore snapshot failed: ${msg.slice(0, 400)}`,
            })
            .eq("id", runId);
          controller.close();
          return;
        }

        // 5b. Pre-restore: drop + recreate public schema
        controller.enqueue(encoder.encode(">>> Dropping public schema...\n"));
        await runPsqlCommand(
          POSTGRES_BACKUP_URL!,
          `drop schema public cascade; create schema public;
           grant all on schema public to authenticated, anon, service_role;`
        );
        controller.enqueue(encoder.encode("    ✓ Schema dropped + recreated\n\n"));

        // 5c. Stream upload file → psql stdin
        controller.enqueue(encoder.encode(">>> Restoring from backup file...\n"));
        // psql -c executes BEFORE -f. With --single-transaction, both run in
        // one txn. We use -c to set session_replication_role=replica which
        // disables FK constraint enforcement triggers for this session, then
        // pipe the dump via stdin (-f -). Without this, dumps from /api/backup/full
        // (public-schema-only) fail when restored to an instance with different
        // auth.users (after a full wipe + reinstall, common scenario).
        // Dangling FK refs after restore are acceptable for historical records.
        proc = spawn("psql", [
          POSTGRES_BACKUP_URL!,
          "--single-transaction",
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          "SET session_replication_role = replica",
          "-f",
          "-",
        ]);
        const psqlProc = proc; // local non-null ref for use inside closures below

        // Stream uploaded file → psql stdin (avoid loading 100MB into RAM).
        // Filter lines that pg_dump 18+ emits but PostgreSQL 15 doesn't recognize.
        // pg_dump always writes the dumping-server's CURRENT version's SET commands;
        // when client > server, dump contains SETs the server rejects. We strip
        // them in-stream to keep restore working across version skew.
        const psqlStdin = psqlProc.stdin!;
        const reader = file.stream().getReader();
        const dumpDecoder = new TextDecoder("utf-8", { fatal: false });
        const dumpEncoder = new TextEncoder();
        // Patterns to strip from the dump:
        //   1. SET commands the server doesn't recognize (pg_dump > server version)
        //   2. CREATE SCHEMA public; — we pre-create above; dump's would conflict
        //   3. \restrict/\unrestrict — psql 18+ meta-commands that drop session
        //      privileges (kills our SET session_replication_role = replica)
        // Match conservatively — only exact known lines, line-anchored.
        const INCOMPATIBLE_LINE_PATTERNS = [
          /^SET transaction_timeout = 0;\s*$/m, // PG 17+ only
          /^CREATE SCHEMA public;\s*$/m, // pre-created in step 5a
          /^\\restrict\s+\S+\s*$/m, // psql 18+ restrict
          /^\\unrestrict\s+\S+\s*$/m, // psql 18+ unrestrict
        ];
        const filterText = (text: string): string => {
          let out = text;
          for (const pat of INCOMPATIBLE_LINE_PATTERNS) {
            out = out.replace(pat, "");
          }
          // Append NOT VALID to FK constraints referencing auth.users. Backup
          // dumps the public schema only; after a wipe + reinstall, auth.users
          // has a new owner with a different UUID, so the dump's historical
          // user_id columns won't match. ADD CONSTRAINT validates the existing
          // data (post-COPY) → FK violation → restore fails. With NOT VALID,
          // the constraint is added but doesn't scan existing rows; future
          // inserts/updates ARE still validated (via trigger).
          // Capture group preserves optional clauses like ON DELETE CASCADE
          // that appear between REFERENCES and the trailing semicolon.
          out = out.replace(
            / REFERENCES auth\.users\(id\)([^;]*);$/gm,
            " REFERENCES auth.users(id)$1 NOT VALID;",
          );
          return out;
        };
        (async () => {
          let lineBuffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                // Flush any remaining buffered text
                if (lineBuffer) psqlStdin.write(filterText(lineBuffer));
                psqlStdin.end();
                break;
              }
              // Decode + split by newlines; keep last partial line in buffer
              lineBuffer += dumpDecoder.decode(value, { stream: true });
              const lastNewline = lineBuffer.lastIndexOf("\n");
              if (lastNewline >= 0) {
                const completeLines = lineBuffer.slice(0, lastNewline + 1);
                lineBuffer = lineBuffer.slice(lastNewline + 1);
                psqlStdin.write(dumpEncoder.encode(filterText(completeLines)));
              }
            }
          } catch {
            /* psql exited early — EPIPE is expected, swallow */
          }
        })();

        // Capture stderr line by line → buffer + stream
        psqlProc.stderr!.on("data", (data: Buffer) => {
          const text = data.toString();
          if (stderrBuffer.length < 1_000_000) {
            stderrBuffer += text;
          }
          controller.enqueue(encoder.encode(text));
        });

        // Wait for exit
        const code = await new Promise<number>((resolve) => {
          psqlProc.on("exit", (c) => resolve(c ?? 1));
        });

        const finishedAt = new Date().toISOString();
        if (code === 0) {
          // 5d. RE-APPLY SCHEMA PRIVILEGES — the DROP SCHEMA public CASCADE in
          // step 5b wipes all grants on the public schema. The dump runs with
          // pg_dump --no-privileges (intentional for portability), so the
          // restored objects have NO grants either. Without this step the
          // Supabase roles (anon/authenticated/service_role) can't see ANY
          // restored data — even logging in fails because employee_accounts
          // is invisible. Mirrors database/003_rls.sql which is the single
          // source of truth for the grant policy; keep them in sync.
          // Also NOTIFY pgrst so PostgREST refreshes its schema cache
          // immediately instead of after the next poll interval.
          controller.enqueue(
            encoder.encode(">>> Re-applying schema privileges + reloading PostgREST cache...\n")
          );
          try {
            await runPsqlCommand(POSTGRES_BACKUP_URL!, POST_RESTORE_GRANTS_SQL);
            controller.enqueue(
              encoder.encode("    ✓ Privileges re-applied; pgrst cache reload notified\n\n")
            );
          } catch (grantErr) {
            // Don't fail the restore — data IS there, just privileges need
            // attention. Surface the error loudly so the operator can run
            // the GRANT block manually.
            const msg = grantErr instanceof Error ? grantErr.message : String(grantErr);
            controller.enqueue(
              encoder.encode(
                `    ⚠ WARN: re-grant failed: ${msg}\n` +
                  `      Data is restored but Supabase roles may not see it until you run:\n` +
                  `      docker exec -i supabase-db psql -U postgres -d postgres < <(cat <<'SQL'\n${POST_RESTORE_GRANTS_SQL}SQL\n)\n\n`
              )
            );
          }
          controller.enqueue(encoder.encode("===END=== status=success\n"));
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
          // Restore failed AFTER the destructive DROP — pre-restore snapshot
          // is the rollback path. Surface it loudly in the response.
          const rollback = preRestoreDumpPath
            ? ` ROLLBACK: psql "$POSTGRES_BACKUP_URL" < "${preRestoreDumpPath}"`
            : " (no pre-restore snapshot — manual recovery needed)";
          controller.enqueue(
            encoder.encode(
              `\n===END=== status=failed (exit ${code})${rollback}\n`
            )
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
        // If snapshot succeeded earlier, surface the rollback path. The
        // snapshot-failure path returns before reaching this catch, so any
        // exception here means the destructive DROP may have already run.
        const rollback = preRestoreDumpPath
          ? ` ROLLBACK: psql "$POSTGRES_BACKUP_URL" < "${preRestoreDumpPath}"`
          : "";
        controller.enqueue(
          encoder.encode(`\n===END=== status=failed (${msg})${rollback}\n`)
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
    cancel() {
      if (proc) {
        proc.kill();
        proc = null;
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

/**
 * Run `pg_dump --schema=public` to the given output path. Plain SQL format
 * (matches /api/backup/full output), so the snapshot is directly pipeable
 * back into psql for rollback. Throws on non-zero exit.
 */
function runPgDumpToFile(url: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("pg_dump", [
      "--schema=public",
      "--no-owner",
      "--no-privileges",
      "--format=plain",
      "--file",
      outputPath,
      url,
    ]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`pg_dump exit ${code}: ${stderr.slice(-500) || "(no stderr)"}`)
        );
    });
    proc.on("error", (e) => reject(e));
  });
}

/**
 * Sanity-check a freshly-written pg_dump file. Verifies size >= MIN bytes
 * AND header matches PG_DUMP_HEADER_REGEX. Throws if invalid.
 * Caller is responsible for cleaning up partial files on failure.
 */
function verifyPgDumpFile(path: string): void {
  const st = statSync(path);
  if (st.size < MIN_PRE_RESTORE_BYTES) {
    throw new Error(
      `snapshot too small (${st.size} bytes, min ${MIN_PRE_RESTORE_BYTES}) — refusing to proceed`
    );
  }
  // Read first 500 bytes to validate header (synchronous, file is tiny here)
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(500);
    const n = readSync(fd, buf, 0, 500, 0);
    const header = buf.subarray(0, n).toString("utf-8");
    if (!PG_DUMP_HEADER_REGEX.test(header)) {
      throw new Error("snapshot header does not match expected pg_dump format");
    }
  } finally {
    closeSync(fd);
  }
}
