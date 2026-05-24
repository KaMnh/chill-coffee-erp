# Backup & Restore Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner click 1 button → download SQL backup; upload SQL file → confirm → restore với log streaming real-time. Track 10 latest runs với log persist trong `backup_runs` table.

**Architecture:** Reuse existing `/api/backup/full` (pg_dump streaming) + add new `/api/backup/restore` (psql with DROP SCHEMA + restore, stderr streaming). Owner-only Settings tab với 3 sub-panels (Backup, Restore, History). Logs persist vào `backup_runs.log_text` để owner xem lại sau.

**Tech Stack:** Next.js 15 App Router, React 19, Postgres 15 (Supabase docker), Tailwind v4, TanStack Query v5, vitest, pgTAP. POSTGRES_BACKUP_URL env var + postgresql15-client trong Dockerfile (đã có).

**Spec:** `docs/superpowers/specs/2026-05-24-backup-restore-design.md`

---

## Task 1: Schema migration cho `backup_runs` table

**Files:**
- Create: `database/migrations/2026-05-24-backup-runs.sql`

- [ ] **Step 1: Write migration SQL**

```sql
-- =============================================================================
-- Migration: add backup_runs table cho UI backup/restore feature (Phase 1).
-- Tracks mỗi backup/restore run với log persist + history.
-- =============================================================================

create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('backup','restore')),
  status text not null default 'running' check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  byte_size bigint,
  log_text text default '',
  error_message text,
  created_by uuid references auth.users(id),
  filename text
);
create index if not exists backup_runs_started_idx on public.backup_runs(started_at desc);

alter table public.backup_runs enable row level security;

drop policy if exists backup_runs_owner_read on public.backup_runs;
create policy backup_runs_owner_read on public.backup_runs for select
  using (public.app_role() = 'owner');

-- Note: KHÔNG có INSERT/UPDATE policy cho authenticated → ngăn direct manipulation.
-- Write paths đi qua service_role trong REST API endpoints (bypass RLS).
```

- [ ] **Step 2: Apply migration vào dev DB**

Run:
```powershell
docker compose exec -T db psql -U postgres -d postgres -f /docker-entrypoint-initdb.d/migrations/2026-05-24-backup-runs.sql
```
Hoặc nếu volume mount khác:
```powershell
Get-Content "database/migrations/2026-05-24-backup-runs.sql" | docker compose exec -T db psql -U postgres -d postgres
```
Expected: `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE`, `CREATE POLICY` (4 lines).

- [ ] **Step 3: Verify schema**

```powershell
docker compose exec -T db psql -U postgres -c "\d public.backup_runs"
```
Expected: 10 columns (id, kind, status, started_at, finished_at, byte_size, log_text, error_message, created_by, filename) + 1 index + 1 RLS policy.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026-05-24-backup-runs.sql
git commit -m "feat(backup): add backup_runs table for run history + log persist

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: pgTAP tests cho `backup_runs` schema invariants

**Files:**
- Create: `database/tests/210_backup_runs.sql`

- [ ] **Step 1: Write pgTAP test**

```sql
-- =============================================================================
-- pgTAP: backup_runs table schema + RLS invariants
-- =============================================================================
begin;
select plan(11);

-- Existence
select has_table('public', 'backup_runs', 'backup_runs table exists');
select has_column('public', 'backup_runs', 'id', 'has id column');
select has_column('public', 'backup_runs', 'kind', 'has kind column');
select has_column('public', 'backup_runs', 'status', 'has status column');
select has_column('public', 'backup_runs', 'log_text', 'has log_text column');

-- Types
select col_type_is('public', 'backup_runs', 'id', 'uuid', 'id is uuid');
select col_type_is('public', 'backup_runs', 'byte_size', 'bigint', 'byte_size is bigint');

-- CHECK constraints (validate kind + status enums)
prepare bad_kind as
  insert into public.backup_runs (kind, status) values ('invalid', 'running');
select throws_ok('bad_kind', '23514', null, 'kind CHECK rejects invalid value');

prepare bad_status as
  insert into public.backup_runs (kind, status) values ('backup', 'pending');
select throws_ok('bad_status', '23514', null, 'status CHECK rejects invalid value');

-- Indexes
select has_index('public', 'backup_runs', 'backup_runs_started_idx', 'started_at index exists');

-- RLS
select policies_are('public', 'backup_runs',
  array['backup_runs_owner_read'],
  'owner_read policy exists');

select * from finish();
rollback;
```

- [ ] **Step 2: Run pgTAP**

Run: `npm run pgtap`

Expected: section `>>> database\tests\210_backup_runs.sql` shows `ok 1..11` (11/11 pass).

- [ ] **Step 3: Commit**

```bash
git add database/tests/210_backup_runs.sql
git commit -m "test(backup): add pgTAP for backup_runs schema invariants

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Append DDL vào 001_schema.sql + 003_rls.sql (fresh-init idempotency)

**Files:**
- Modify: `database/001_schema.sql` (append sau handover_tasks block)
- Modify: `database/003_rls.sql` (append sau handover policies)

- [ ] **Step 1: Locate insertion point trong 001_schema.sql**

Find line cuối của handover_tasks block:
```sql
create index if not exists handover_tasks_session_idx on public.handover_tasks(session_id, sort_order);
```

- [ ] **Step 2: Append backup_runs DDL sau handover block**

Insert ngay sau line trên:

```sql

-- -----------------------------------------------------------------------------
-- 9. Backup runs (Phase 1 backup/restore UI)
-- -----------------------------------------------------------------------------
create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('backup','restore')),
  status text not null default 'running' check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  byte_size bigint,
  log_text text default '',
  error_message text,
  created_by uuid references auth.users(id),
  filename text
);
create index if not exists backup_runs_started_idx on public.backup_runs(started_at desc);
```

- [ ] **Step 3: Append RLS policy vào 003_rls.sql**

Find cuối file 003_rls.sql, append:

```sql

-- backup_runs (Phase 1 backup/restore)
alter table public.backup_runs enable row level security;
drop policy if exists backup_runs_owner_read on public.backup_runs;
create policy backup_runs_owner_read on public.backup_runs for select
  using (public.app_role() = 'owner');
```

- [ ] **Step 4: Verify db:init idempotency**

Run:
```powershell
npm run db:init
```

Expected: schema script chạy lại không error (NOTICE skipping trên backup_runs là OK), RLS policy được CREATE (or replace).

- [ ] **Step 5: Commit**

```bash
git add database/001_schema.sql database/003_rls.sql
git commit -m "feat(backup): append backup_runs DDL to base schema for fresh-init

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: TypeScript types cho BackupRun

**Files:**
- Modify: `src/lib/types.ts` (append sau existing types)

- [ ] **Step 1: Locate position to insert**

Open `src/lib/types.ts`, scroll xuống cuối file (sau type definitions cuối cùng).

- [ ] **Step 2: Append types**

```typescript

// -----------------------------------------------------------------------------
// Backup/Restore (Phase 1)
// -----------------------------------------------------------------------------
export type BackupRunKind = "backup" | "restore";
export type BackupRunStatus = "running" | "success" | "failed";

export interface BackupRun {
  id: string;
  kind: BackupRunKind;
  status: BackupRunStatus;
  started_at: string;       // ISO timestamp
  finished_at: string | null;
  byte_size: number | null;
  error_message: string | null;
  filename: string | null;
  created_by: string | null;
}

// Detail variant với log_text (chỉ trả từ GET /runs/:id/log)
export interface BackupRunWithLog extends BackupRun {
  log_text: string;
}
```

- [ ] **Step 3: Verify TypeScript compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(backup): add BackupRun TypeScript types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Format helpers (TDD) — formatBytes, formatDuration, statusIcon

**Files:**
- Create: `src/lib/format/backup.ts`
- Create: `src/lib/format/__tests__/backup.test.ts`

- [ ] **Step 1: Write failing tests**

`src/lib/format/__tests__/backup.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatBackupStatus } from "../backup";

describe("formatBytes", () => {
  it("formats 0 as 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
  it("formats bytes under 1KB", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats KB with 1 decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  it("formats MB with 1 decimal", () => {
    expect(formatBytes(2_156_234)).toBe("2.1 MB");
  });
  it("formats GB with 1 decimal", () => {
    expect(formatBytes(1_500_000_000)).toBe("1.4 GB");
  });
  it("handles null gracefully", () => {
    expect(formatBytes(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("returns dash if no end time", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", null)).toBe("—");
  });
  it("formats milliseconds", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", "2026-05-24T10:00:00.500Z")).toBe("500ms");
  });
  it("formats seconds with 1 decimal", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", "2026-05-24T10:00:01.200Z")).toBe("1.2s");
  });
  it("formats minutes", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", "2026-05-24T10:02:30Z")).toBe("2m 30s");
  });
});

describe("formatBackupStatus", () => {
  it("running has spinner semantic", () => {
    expect(formatBackupStatus("running")).toEqual({ label: "Đang chạy", semantic: "info", icon: "spinner" });
  });
  it("success has check icon", () => {
    expect(formatBackupStatus("success")).toEqual({ label: "Thành công", semantic: "success", icon: "check" });
  });
  it("failed has x icon", () => {
    expect(formatBackupStatus("failed")).toEqual({ label: "Lỗi", semantic: "danger", icon: "x" });
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm run test:run -- backup`
Expected: FAIL with "Cannot find module '../backup'"

- [ ] **Step 3: Implement formatters**

`src/lib/format/backup.ts`:
```typescript
import type { BackupRunStatus } from "@/lib/types";

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export interface BackupStatusDisplay {
  label: string;
  semantic: "info" | "success" | "danger";
  icon: "spinner" | "check" | "x";
}

export function formatBackupStatus(status: BackupRunStatus): BackupStatusDisplay {
  switch (status) {
    case "running": return { label: "Đang chạy", semantic: "info", icon: "spinner" };
    case "success": return { label: "Thành công", semantic: "success", icon: "check" };
    case "failed":  return { label: "Lỗi", semantic: "danger", icon: "x" };
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:run -- backup`
Expected: 13/13 pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format/backup.ts src/lib/format/__tests__/backup.test.ts
git commit -m "feat(backup): add format helpers (bytes, duration, status)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Data layer cho backup REST API

**Files:**
- Create: `src/lib/data/backup.ts`

- [ ] **Step 1: Implement data layer**

`src/lib/data/backup.ts`:
```typescript
import type { BackupRun, BackupRunWithLog } from "@/lib/types";

/** GET /api/backup/runs?limit=N — list các runs gần nhất. Owner-only. */
export async function listBackupRuns(authHeader: string, limit = 10): Promise<BackupRun[]> {
  const res = await fetch(`/api/backup/runs?limit=${limit}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`listBackupRuns failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.runs as BackupRun[];
}

/** GET /api/backup/runs/:id/log — get full log_text. */
export async function getBackupRunLog(authHeader: string, id: string): Promise<BackupRunWithLog> {
  const res = await fetch(`/api/backup/runs/${id}/log`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`getBackupRunLog failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BackupRunWithLog;
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/backup.ts
git commit -m "feat(backup): add data layer for backup runs API

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: API endpoint GET /api/backup/runs

**Files:**
- Create: `src/app/api/backup/runs/route.ts`

- [ ] **Step 1: Implement list endpoint**

`src/app/api/backup/runs/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const auth = await requireAuth(authHeader, ["owner"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "10");
  const limit = Math.min(Math.max(1, isFinite(limitRaw) ? limitRaw : 10), 50);

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("backup_runs")
    .select("id, kind, status, started_at, finished_at, byte_size, error_message, filename, created_by")
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ runs: data ?? [] });
}
```

- [ ] **Step 2: Manual verify via curl**

Start dev server: `npm run dev`. Login as owner, get JWT from browser devtools.

```powershell
$jwt = "Bearer eyJhbGc..."
Invoke-RestMethod -Uri "http://localhost:3009/api/backup/runs?limit=5" -Headers @{ Authorization = $jwt }
```
Expected: `{ runs: [] }` (empty array vì chưa có data).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/backup/runs/route.ts
git commit -m "feat(backup): add GET /api/backup/runs endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: API endpoint GET /api/backup/runs/[id]/log

**Files:**
- Create: `src/app/api/backup/runs/[id]/log/route.ts`

- [ ] **Step 1: Implement log detail endpoint**

`src/app/api/backup/runs/[id]/log/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const authHeader = req.headers.get("authorization") ?? "";
  const auth = await requireAuth(authHeader, ["owner"]);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("backup_runs")
    .select("id, kind, status, started_at, finished_at, byte_size, log_text, error_message, filename, created_by")
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
```

- [ ] **Step 2: Manual verify**

After Task 11 inserts 1 row qua backup, test:
```powershell
$id = "<run-id-from-runs-list>"
Invoke-RestMethod -Uri "http://localhost:3009/api/backup/runs/$id/log" -Headers @{ Authorization = $jwt }
```
Expected: full BackupRunWithLog object với `log_text`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/backup/runs/[id]/log/route.ts
git commit -m "feat(backup): add GET /api/backup/runs/[id]/log endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Modify POST /api/backup/full để wrap với backup_runs tracking

**Files:**
- Modify: `src/app/api/backup/full/route.ts`

- [ ] **Step 1: Read current implementation**

Open `src/app/api/backup/full/route.ts` để hiểu pattern hiện tại (~100 lines, stream pg_dump output).

- [ ] **Step 2: Wrap với backup_runs INSERT/UPDATE**

Modify endpoint:
1. Trước khi spawn pg_dump: `INSERT INTO backup_runs(kind='backup', status='running', filename, created_by)` → giữ `runId`
2. Track total bytes streamed
3. Sau khi pg_dump exit thành công: `UPDATE backup_runs SET status='success', finished_at=now(), byte_size, log_text=stderrBuffer`
4. Khi pg_dump fail: `UPDATE backup_runs SET status='failed', finished_at=now(), error_message=stderrBuffer.slice(-500)`

Diff pattern (insert sau auth check, trước spawn):
```typescript
// ... existing auth check ...

const supabase = getServiceRoleClient();
const filename = `chill-backup-${formatVnTimestamp()}.sql`;
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
const runId = runRow.id;

// ... existing spawn pg_dump ...

let totalBytes = 0;
let stderrBuffer = "";

// Trong stream loop, count bytes của mỗi chunk → totalBytes += chunk.length
// Trong proc.stderr.on('data', ...) → stderrBuffer += data.toString() (cap 1MB)

// Trong proc.on('exit', async (code) => { ... })
const finishedAt = new Date().toISOString();
if (code === 0) {
  await supabase.from("backup_runs").update({
    status: "success",
    finished_at: finishedAt,
    byte_size: totalBytes,
    log_text: stderrBuffer.slice(0, 1_000_000),
  }).eq("id", runId);
} else {
  await supabase.from("backup_runs").update({
    status: "failed",
    finished_at: finishedAt,
    byte_size: totalBytes,
    log_text: stderrBuffer.slice(0, 1_000_000),
    error_message: stderrBuffer.slice(-500),
  }).eq("id", runId);
}
```

Helper `formatVnTimestamp()` (inline trong file):
```typescript
function formatVnTimestamp(): string {
  const d = new Date(Date.now() + 7 * 60 * 60 * 1000); // shift to VN
  return d.toISOString().slice(0, 16).replace(/[:T]/g, "-").replace(/-(\d{2}):/, "-$1");
  // Format: YYYY-MM-DD-HHMM
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verify**

```powershell
$jwt = "Bearer ..."
$resp = Invoke-WebRequest -Uri "http://localhost:3009/api/backup/full" -Method POST -Headers @{ Authorization = $jwt } -OutFile backup-test.sql
Get-Item backup-test.sql | Select-Object Length

Invoke-RestMethod -Uri "http://localhost:3009/api/backup/runs?limit=1" -Headers @{ Authorization = $jwt }
```
Expected: file downloaded, runs list có 1 row với kind=backup, status=success, byte_size matching file size.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/backup/full/route.ts
git commit -m "feat(backup): wrap /api/backup/full with backup_runs tracking

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: API endpoint POST /api/backup/restore (BIGGEST — 180 lines)

**Files:**
- Create: `src/app/api/backup/restore/route.ts`

- [ ] **Step 1: Implement restore endpoint**

`src/app/api/backup/restore/route.ts`:
```typescript
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
  const authHeader = req.headers.get("authorization") ?? "";
  const auth = await requireAuth(authHeader, ["owner"]);
  if ("error" in auth) {
    return new Response(auth.error, { status: auth.status });
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
    return new Response(`File quá lớn (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`, { status: 400 });
  }

  // 3. Validate pg_dump header (first 500 bytes)
  const headerBuf = await file.slice(0, 500).text();
  if (!PG_DUMP_HEADER_REGEX.test(headerBuf)) {
    return new Response("File không phải pg_dump format (header invalid)", { status: 400 });
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
    return new Response(`Cannot create backup_runs row: ${insertErr?.message}`, { status: 500 });
  }
  const runId = runRow.id;

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
          "-v", "ON_ERROR_STOP=1",
        ]);

        // Stream uploaded file → psql stdin
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
          await supabase.from("backup_runs").update({
            status: "success",
            finished_at: finishedAt,
            log_text: stderrBuffer.slice(0, 1_000_000),
          }).eq("id", runId);
        } else {
          controller.enqueue(encoder.encode(`\n===END=== status=failed (exit ${code})\n`));
          await supabase.from("backup_runs").update({
            status: "failed",
            finished_at: finishedAt,
            log_text: stderrBuffer.slice(0, 1_000_000),
            error_message: stderrBuffer.slice(-500),
          }).eq("id", runId);
        }
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        controller.enqueue(encoder.encode(`\n===END=== status=failed (${msg})\n`));
        await supabase.from("backup_runs").update({
          status: "failed",
          finished_at: new Date().toISOString(),
          log_text: stderrBuffer.slice(0, 1_000_000),
          error_message: msg.slice(0, 500),
        }).eq("id", runId);
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

// Helper: run single psql command, throw if fail
function runPsqlCommand(url: string, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql]);
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exit ${code}: ${stderr.slice(-500)}`));
    });
  });
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verify happy path**

```powershell
$jwt = "Bearer ..."
$file = "backup-test.sql"  # từ Task 9
$resp = curl -X POST -H "Authorization: $jwt" -F "file=@$file" http://localhost:3009/api/backup/restore
```
Expected: streaming text output showing DROP SCHEMA, RESTORE statements, final `===END=== status=success`. Check via:
```powershell
Invoke-RestMethod -Uri "http://localhost:3009/api/backup/runs?limit=1" -Headers @{ Authorization = $jwt }
```
Latest run: kind=restore, status=success.

- [ ] **Step 4: Manual verify error path**

Upload file rác:
```powershell
"not a real backup" | Out-File bad-file.sql
curl -X POST -H "Authorization: $jwt" -F "file=@bad-file.sql" http://localhost:3009/api/backup/restore
```
Expected: 400 with "File không phải pg_dump format".

- [ ] **Step 5: Commit**

```bash
git add src/app/api/backup/restore/route.ts
git commit -m "feat(backup): add POST /api/backup/restore with streaming logs

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: React Query hook + mutations

**Files:**
- Create: `src/hooks/queries/use-backup-runs-query.ts`
- Create: `src/hooks/mutations/use-backup-mutations.ts`

- [ ] **Step 1: Implement query hook**

`src/hooks/queries/use-backup-runs-query.ts`:
```typescript
import { useQuery } from "@tanstack/react-query";
import { listBackupRuns, getBackupRunLog } from "@/lib/data/backup";

const KEY = ["backup-runs"] as const;

export function useBackupRunsQuery(authHeader: string | null, limit = 10, enabled = true) {
  return useQuery({
    queryKey: [...KEY, limit],
    queryFn: () => listBackupRuns(authHeader!, limit),
    enabled: enabled && Boolean(authHeader),
    refetchInterval: (q) => {
      // Auto-refresh mỗi 5s nếu có run đang chạy
      const runs = q.state.data;
      const hasRunning = runs?.some((r) => r.status === "running");
      return hasRunning ? 5000 : false;
    },
    staleTime: 10_000,
  });
}

export function useBackupRunLogQuery(authHeader: string | null, id: string | null) {
  return useQuery({
    queryKey: [...KEY, "log", id],
    queryFn: () => getBackupRunLog(authHeader!, id!),
    enabled: Boolean(authHeader && id),
    staleTime: Infinity, // log không đổi sau khi run xong
  });
}

export const BACKUP_RUNS_QUERY_KEY = KEY;
```

- [ ] **Step 2: Implement mutations**

`src/hooks/mutations/use-backup-mutations.ts`:
```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BACKUP_RUNS_QUERY_KEY } from "@/hooks/queries/use-backup-runs-query";

/** Download backup: fetch /api/backup/full, trigger browser download. */
export function useDownloadBackupMutation(authHeader: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!authHeader) throw new Error("Not authenticated");
      const res = await fetch("/api/backup/full", {
        method: "POST",
        headers: { Authorization: authHeader },
      });
      if (!res.ok) throw new Error(`Backup failed: ${res.status} ${await res.text()}`);

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `chill-backup-${Date.now()}.sql`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      return { filename, size: blob.size };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BACKUP_RUNS_QUERY_KEY });
    },
  });
}

/**
 * Restore backup: upload file, stream stderr.
 * Returns AsyncIterable<string> để consumer (UI) iterate log lines.
 */
export interface RestoreProgress {
  line: string;
  done: boolean;
  status?: "success" | "failed";
}

export async function* streamRestore(
  authHeader: string,
  file: File
): AsyncIterableIterator<RestoreProgress> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/backup/restore", {
    method: "POST",
    headers: { Authorization: authHeader },
    body: formData,
  });

  if (!res.ok) {
    yield { line: `❌ Server error: ${res.status} ${await res.text()}`, done: true, status: "failed" };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer) yield { line: buffer, done: false };
      yield { line: "", done: true };
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const endMatch = line.match(/===END=== status=(\w+)/);
      if (endMatch) {
        yield { line, done: true, status: endMatch[1] as "success" | "failed" };
        return;
      }
      yield { line, done: false };
    }
  }
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/queries/use-backup-runs-query.ts src/hooks/mutations/use-backup-mutations.ts
git commit -m "feat(backup): add React Query hooks + restore stream iterator

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: UI BackupRestoreSection component

**Files:**
- Create: `src/features/settings/backup-restore-section.tsx`
- Create: `src/features/settings/__tests__/backup-restore-section.test.tsx`

- [ ] **Step 1: Write failing tests**

`src/features/settings/__tests__/backup-restore-section.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BackupRestoreSection } from "../backup-restore-section";

function renderWithProviders(role: "owner" | "manager" | "staff_operator" | "employee_viewer") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BackupRestoreSection role={role} authHeader="Bearer test" />
    </QueryClientProvider>
  );
}

describe("BackupRestoreSection", () => {
  it("renders EmptyState for non-owner roles", () => {
    renderWithProviders("manager");
    expect(screen.getByText(/owner only/i)).toBeInTheDocument();
  });

  it("renders 3 panels for owner", () => {
    renderWithProviders("owner");
    expect(screen.getByRole("button", { name: /download backup/i })).toBeInTheDocument();
    expect(screen.getByText(/chọn file backup/i)).toBeInTheDocument();
    expect(screen.getByText(/history/i)).toBeInTheDocument();
  });

  it("disables restore button until file selected", () => {
    renderWithProviders("owner");
    const restoreBtn = screen.getByRole("button", { name: /^restore$/i });
    expect(restoreBtn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npm run test:run -- backup-restore`
Expected: FAIL with "Cannot find module".

Note: project hiện chưa có jsdom environment cho component tests. Nếu vitest fail vì env, skip component tests (Phase 6.B sẽ enable) và rely vào manual integration. Mark Task 12 sub-step 2 as "skipped if jsdom not configured".

- [ ] **Step 3: Implement BackupRestoreSection**

`src/features/settings/backup-restore-section.tsx`:
```typescript
"use client";

import { useState, useRef, useEffect } from "react";
import type { BackupRun, UserRole } from "@/lib/types";
import { useBackupRunsQuery, useBackupRunLogQuery } from "@/hooks/queries/use-backup-runs-query";
import { useDownloadBackupMutation, streamRestore } from "@/hooks/mutations/use-backup-mutations";
import { formatBytes, formatDuration, formatBackupStatus } from "@/lib/format/backup";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/ui/empty-state";

interface Props {
  role: UserRole;
  authHeader: string | null;
}

export function BackupRestoreSection({ role, authHeader }: Props) {
  if (role !== "owner") {
    return (
      <EmptyState
        icon="lock"
        title="Owner only"
        subtitle="Backup/restore là thao tác destructive — chỉ owner có quyền."
      />
    );
  }

  return (
    <div className="space-y-6">
      <BackupPanel authHeader={authHeader} />
      <RestorePanel authHeader={authHeader} />
      <HistoryPanel authHeader={authHeader} />
    </div>
  );
}

function BackupPanel({ authHeader }: { authHeader: string | null }) {
  const { toast } = useToast();
  const runs = useBackupRunsQuery(authHeader, 1).data;
  const lastBackup = runs?.find((r) => r.kind === "backup" && r.status === "success");
  const download = useDownloadBackupMutation(authHeader);

  const handleClick = async () => {
    try {
      const result = await download.mutateAsync();
      toast({ semantic: "success", message: `Backup xong: ${result.filename} (${formatBytes(result.size)})` });
    } catch (e) {
      toast({ semantic: "danger", message: e instanceof Error ? e.message : "Backup failed" });
    }
  };

  return (
    <Card className="p-4">
      <h3 className="text-lg font-semibold mb-2">Backup</h3>
      {lastBackup && (
        <p className="text-sm text-muted-foreground mb-3">
          Lần backup cuối: {new Date(lastBackup.started_at).toLocaleString("vi-VN")} ({formatBytes(lastBackup.byte_size)})
        </p>
      )}
      <Button onClick={handleClick} disabled={download.isPending}>
        {download.isPending ? "Đang backup..." : "↓ Download backup ngay"}
      </Button>
    </Card>
  );
}

function RestorePanel({ authHeader }: { authHeader: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 100 * 1024 * 1024) {
      toast({ semantic: "danger", message: `File quá lớn (${formatBytes(f.size)}, max 100MB)` });
      return;
    }
    setFile(f);
  };

  const handleConfirm = async () => {
    if (!file || !authHeader || confirmText !== "RESTORE") return;
    setConfirmOpen(false);
    setLogLines([]);
    setRestoring(true);
    try {
      for await (const { line, done, status } of streamRestore(authHeader, file)) {
        if (line) setLogLines((prev) => [...prev, line]);
        if (done) {
          if (status === "success") {
            toast({ semantic: "success", message: "Restore xong!" });
            qc.invalidateQueries();
          } else {
            toast({ semantic: "danger", message: "Restore failed (xem log)" });
          }
          break;
        }
      }
    } catch (e) {
      toast({ semantic: "danger", message: e instanceof Error ? e.message : "Restore error" });
    } finally {
      setRestoring(false);
      setConfirmText("");
    }
  };

  return (
    <>
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-2">Restore</h3>
        <p className="text-sm text-warning mb-3">⚠️ Sẽ XÓA toàn bộ data hiện tại!</p>
        <div className="flex gap-2 items-center mb-3">
          <input
            type="file"
            accept=".sql"
            onChange={handleFileChange}
            disabled={restoring}
            className="text-sm"
          />
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!file || restoring}
            variant="destructive"
          >
            Restore
          </Button>
        </div>
        {logLines.length > 0 && (
          <div className="mt-3">
            <div className="flex justify-between mb-1">
              <span className="text-sm font-medium">Log</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(logLines.join("\n"))}
              >
                Copy
              </Button>
            </div>
            <pre className="bg-muted p-3 rounded text-xs font-mono h-64 overflow-y-auto whitespace-pre-wrap">
              {logLines.join("\n")}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogTitle>Confirm Restore</DialogTitle>
          <div className="space-y-3">
            <p className="text-sm">
              File: <code>{file?.name}</code> ({formatBytes(file?.size ?? null)})
            </p>
            <p className="text-sm text-danger font-medium">
              Sẽ DROP toàn bộ public schema và restore từ file này. KHÔNG THỂ UNDO.
            </p>
            <label className="block text-sm">
              Gõ <code>RESTORE</code> để confirm:
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="block mt-1 w-full border rounded px-2 py-1"
              />
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={confirmText !== "RESTORE"}
              >
                Confirm Restore
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function HistoryPanel({ authHeader }: { authHeader: string | null }) {
  const { data: runs = [], isLoading } = useBackupRunsQuery(authHeader, 10);
  const [viewLogId, setViewLogId] = useState<string | null>(null);

  if (isLoading) return <Card className="p-4">Loading...</Card>;
  if (runs.length === 0) return <Card className="p-4">History (chưa có run nào)</Card>;

  return (
    <>
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-2">History (10 gần nhất)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Type</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration</th>
              <th>Size</th>
              <th>Filename</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const st = formatBackupStatus(r.status);
              return (
                <tr key={r.id} className="border-b">
                  <td className="py-2">{r.kind}</td>
                  <td className={`text-${st.semantic}`}>{st.label}</td>
                  <td>{new Date(r.started_at).toLocaleString("vi-VN")}</td>
                  <td>{formatDuration(r.started_at, r.finished_at)}</td>
                  <td>{formatBytes(r.byte_size)}</td>
                  <td className="truncate max-w-[200px]">{r.filename ?? "—"}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => setViewLogId(r.id)}>
                      View log
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {viewLogId && <LogModal authHeader={authHeader} id={viewLogId} onClose={() => setViewLogId(null)} />}
    </>
  );
}

function LogModal({
  authHeader,
  id,
  onClose,
}: {
  authHeader: string | null;
  id: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useBackupRunLogQuery(authHeader, id);
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogTitle>Log của run</DialogTitle>
        {isLoading ? (
          <p>Loading...</p>
        ) : (
          <pre className="bg-muted p-3 rounded text-xs font-mono h-96 overflow-y-auto whitespace-pre-wrap">
            {data?.log_text || "(empty log)"}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests (skip if no jsdom)**

Run: `npm run test:run -- backup-restore`
Expected: pass nếu vitest có jsdom; skip nếu chưa setup.

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/backup-restore-section.tsx src/features/settings/__tests__/backup-restore-section.test.tsx
git commit -m "feat(backup): add BackupRestoreSection UI with 3 sub-panels

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Integrate vào Settings page

**Files:**
- Modify: `src/features/settings/settings-view.tsx`

- [ ] **Step 1: Read current settings-view.tsx**

Open file để hiểu structure hiện tại (Tabs với các TabsTrigger + TabsContent).

- [ ] **Step 2: Verify SettingsView props**

Open file, locate `interface SettingsViewProps` (hoặc inline). Cần có ít nhất:
- `role: UserRole`
- `authHeader: string | null` (Supabase JWT header)

Nếu **đã có** cả 2: skip xuống Step 3.

Nếu **thiếu authHeader**: thêm vào props:
```tsx
interface SettingsViewProps {
  role: UserRole;
  authHeader: string | null;   // ← add this
  // ... existing props
}
```

Và update callsite (`src/app/page.tsx` hoặc nơi gọi `<SettingsView>`):
```tsx
const authHeader = session ? `Bearer ${session.access_token}` : null;
<SettingsView role={role} authHeader={authHeader} />
```

- [ ] **Step 3: Add tab "Sao lưu / Khôi phục"**

Add import ở đầu file:
```tsx
import { BackupRestoreSection } from "./backup-restore-section";
```

Trong `<TabsList>` thêm sau TabsTrigger cuối cùng:
```tsx
<TabsTrigger value="backup">Sao lưu / Khôi phục</TabsTrigger>
```

Trong body Tabs (sau TabsContent cuối):
```tsx
<TabsContent value="backup">
  <BackupRestoreSection role={role} authHeader={authHeader} />
</TabsContent>
```

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual visual verify**

Run: `npm run dev`
- Login owner → settings page → thấy tab "Sao lưu / Khôi phục"
- Click tab → see 3 panels
- Login non-owner (manager) → tab hiển thị nhưng nội dung là EmptyState "Owner only"

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/settings-view.tsx
git commit -m "feat(backup): integrate BackupRestoreSection into Settings page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: End-to-end manual verification

- [ ] **Step 1: Full backup → restore roundtrip**

```powershell
# 1. Pre-state
docker compose exec -T db psql -U postgres -c "select id, business_date, amount from public.expenses order by created_at desc limit 1;"
# Note: lưu lại 1 expense id + amount để verify sau

# 2. Login owner, settings → backup tab → click Download
# Expected: file chill-backup-YYYY-MM-DD-HHMM.sql tải xuống
# History panel: 1 row (kind=backup, status=success)

# 3. Modify expense qua UI hoặc psql
docker compose exec -T db psql -U postgres -c "update public.expenses set amount = 99999 where id = '<id-vừa-note>';"

# 4. UI restore: chọn file vừa download, type "RESTORE", confirm
# Expected: log panel streaming DROP SCHEMA, then INSERT statements
# Final: ===END=== status=success + toast success

# 5. Verify revert
docker compose exec -T db psql -U postgres -c "select amount from public.expenses where id = '<id>';"
# Expected: amount = original value (not 99999)

# 6. History panel: 2 rows (backup + restore, cả 2 status=success)
# Click "View log" của restore → modal hiển thị stderr đầy đủ
```

- [ ] **Step 2: Error paths**

```powershell
# A. Bad file
"random text" | Out-File bad.sql
# Upload bad.sql → expect 400 + history row status=failed với error_message

# B. Non-owner
# Login as manager/staff → settings → backup tab → EmptyState "Owner only"
```

- [ ] **Step 3: Edge case test — file 100MB+ (skip nếu không có)**

Generate large dummy file (100MB+) → upload → expect client-side validation block trước khi gửi.

- [ ] **Step 4: pgTAP final**

```powershell
npm run pgtap
```
Expected: 210_backup_runs.sql section pass.

- [ ] **Step 5: Build check**

```powershell
npm run build
```
Expected: no errors.

- [ ] **Step 6: Final commit + push**

```bash
git add docs/superpowers/plans/2026-05-24-backup-restore-phase-1.md docs/superpowers/specs/2026-05-24-backup-restore-design.md
git commit -m "docs(backup): add Phase 1 spec + plan

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"

# Optional: tag
git tag v4-phase-7a-backup-restore
```

---

## Spec Coverage Self-Review

| Spec Section | Tasks |
|---|---|
| Data Model (backup_runs table) | Task 1, 3 |
| pgTAP tests | Task 2 |
| Types | Task 4 |
| Format helpers | Task 5 |
| Data layer | Task 6 |
| GET /api/backup/runs | Task 7 |
| GET /api/backup/runs/[id]/log | Task 8 |
| POST /api/backup/full (modify) | Task 9 |
| POST /api/backup/restore (new) | Task 10 |
| React Query hooks + mutations | Task 11 |
| UI BackupRestoreSection | Task 12 |
| Settings page integration | Task 13 |
| Verification (manual E2E + pgTAP + build) | Task 14 |

All spec sections covered.

## Known caveats

- **Component test gating**: Project chưa setup jsdom cho vitest (Phase 6.B sẽ enable). Task 12 step 2 sẽ skip test nếu vitest env=node. Component logic verified qua Task 14 manual integration.
- **POSTGRES_BACKUP_URL**: Đã có env var, cần postgresql15-client trong Next.js Dockerfile (đã có theo backup/full pattern).
- **Failed restore = empty DB**: Nếu restore fail giữa chừng, public schema đã DROP CASCADE → DB trống. UI sẽ hiển thị red banner; user PHẢI rerun restore từ file. Document trong RestorePanel description.
