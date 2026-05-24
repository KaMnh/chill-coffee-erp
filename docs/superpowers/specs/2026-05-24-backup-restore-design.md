# Backup & Restore Feature — Phase 1 Design

**Status**: Draft — pending user review before plan
**Date**: 2026-05-24
**Phase**: Phase 1 (foundation). Phase 2 (JSON portability) + Phase 3 (scheduled + storage history) sẽ có spec riêng.

## Context

Sau migration v2→v4 thủ công (cần script tooling phức tạp, ~15 files), owner muốn tính năng **backup + restore tự phục vụ** trên web ERP để chủ động phòng disaster recovery + có safety net trước thao tác rủi ro. Yêu cầu cốt lõi: **"khung logs check lỗi đầy đủ khi chạy"** → log không được mất khi refresh page, owner phải xem lại được history nếu lỗi xảy ra.

Discovery: project đã có sẵn `POST /api/backup/full` (pg_dump streaming, owner-only, 5min timeout) nhưng chưa có UI button, không có restore endpoint, không có history tracking.

**Mục tiêu Phase 1**:
- Owner click 1 button → download SQL backup ngay
- Owner upload file → confirm → restore full replace với log streaming real-time
- 10 lần backup/restore gần nhất hiển thị history với log đầy đủ để check sau

**Out of scope Phase 1** (defer):
- JSON per-table export (Phase 2)
- Scheduled backup tự động + Supabase Storage history (Phase 3)
- Auto-backup trước restore (overlap với Phase 3)
- Selective restore (chỉ scope nhất định)

## Decisions confirmed với user

| Decision | Choice | Reason |
|---|---|---|
| Use case | All 3 (disaster recovery + safety net + portability) | User chọn; decompose thành 3 phases |
| Phase order | Phase 1 đầu (SQL backup UI + restore + logs) | Phase 1 cover 2/3 use cases; Phase 2/3 sau |
| Restore semantic | Full replace (DROP SCHEMA + restore) | Mirror state snapshot — disaster recovery thuần |
| UI placement | New tab trong Settings page | Pattern nhất quán với Users, KiotViet, Sidebar tabs |
| Approach | B (Minimal + backup_runs tracking) | Đáp ứng "log đầy đủ" mà không over-engineer |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Settings page (owner-only tab "Sao lưu / Khôi phục")       │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ <BackupRestoreSection>                               │  │
│  │   ├─ <BackupPanel>      → POST /api/backup/full      │  │
│  │   ├─ <RestorePanel>     → POST /api/backup/restore   │  │
│  │   └─ <HistoryPanel>     → GET  /api/backup/runs      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Next.js API routes (owner-only, requireAuth)               │
│  ├─ POST /api/backup/full         → spawn pg_dump, stream   │
│  ├─ POST /api/backup/restore      → spawn psql, stream      │
│  ├─ GET  /api/backup/runs         → list 10 latest runs     │
│  └─ GET  /api/backup/runs/:id/log → log_text 1 run (modal)  │
│                                                              │
│  Wrap mỗi run với:                                          │
│    INSERT backup_runs(status=running) → execute → UPDATE    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Postgres (Supabase docker)                                 │
│  ├─ public.* (data)                                         │
│  └─ public.backup_runs (new — audit trail + log persist)    │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### Schema delta migration

File: `database/migrations/2026-05-24-backup-runs.sql`

```sql
create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('backup','restore')),
  status text not null default 'running' check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  byte_size bigint,                         -- bytes transferred (file size)
  log_text text default '',                 -- full stderr captured (truncate >1MB)
  error_message text,                       -- last 500 chars stderr nếu failed
  created_by uuid references auth.users(id),
  filename text                             -- backup: generated name; restore: user file name
);
create index backup_runs_started_idx on public.backup_runs(started_at desc);

alter table public.backup_runs enable row level security;

create policy backup_runs_owner_read on public.backup_runs for select
  using (public.app_role() = 'owner');

-- Write paths đi qua service_role (REST API endpoints) — bypass RLS
-- Không tạo INSERT/UPDATE policy cho authenticated → ngăn direct manipulation
```

**Cũng cần append vào `database/001_schema.sql`** (để fresh init có table này) sau section handover_tasks.

### Trade-off chú ý

- `log_text` lưu raw stderr → có thể chứa thông tin nhạy cảm (paths, connection strings). Acceptable vì owner-only RLS.
- Limit log_text 1MB (truncate cuối nếu vượt) — tránh blow table size.

## API Endpoints

### `POST /api/backup/full` — MODIFY existing

**Hiện trạng**: `src/app/api/backup/full/route.ts` đã có; stream pg_dump output trực tiếp.

**Thay đổi**:
1. Trước stream: INSERT backup_runs row với kind=backup, status=running → giữ `run_id`
2. Trong loop stream: count bytes
3. Sau khi stream xong: UPDATE backup_runs SET status=success, byte_size, finished_at, log_text=(stderr captured)
4. Lỗi: UPDATE status=failed, error_message=last 500 chars stderr

**Diff size**: ~20 lines wrap quanh logic cũ. Không đổi response format (vẫn stream SQL).

### `POST /api/backup/restore` — NEW

File: `src/app/api/backup/restore/route.ts`

**Request**:
- Method: POST
- Auth: header `Authorization: Bearer <jwt>` → `requireAuth(authHeader, ["owner"])`
- Body: multipart/form-data, field `file` (SQL dump)

**Validation gates** (fail-fast, trước khi tạo backup_runs):
1. File size ≤ 100MB (env var `BACKUP_MAX_SIZE_MB`, default 100)
2. First 500 bytes phải match `/-- PostgreSQL database dump/i`
3. Auth check owner role

**Execution flow**:
```
1. INSERT backup_runs(kind=restore, status=running, filename, created_by)
2. Pre-restore: spawn `psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;
                                GRANT ALL ON SCHEMA public TO authenticated, anon, service_role;"`
   (separate psql process, fail-fast nếu lỗi)
3. Spawn psql --single-transaction -v ON_ERROR_STOP=1 với POSTGRES_BACKUP_URL
4. Stream uploaded file ĐI THẲNG vào psql.stdin (KHÔNG ghi temp file —
   tiết kiệm disk + nhanh hơn cho large files)
5. Capture stderr line-by-line:
   a. Append vào in-memory buffer (truncate ở 1MB)
   b. Write line + '\n' vào response ReadableStream
6. On psql exit:
   - exit 0: UPDATE backup_runs SET status=success, finished_at, log_text=buffer
   - exit !=0: UPDATE status=failed, error_message=last 500 chars stderr
7. Write `===END=== status=<status>\n` vào stream, close
```

**Note connection string**: Cả backup/full lẫn restore đều dùng env var `POSTGRES_BACKUP_URL` (existing, đã có cho backup endpoint). Yêu cầu `postgresql15-client` trong Dockerfile của Next.js (đã có theo backup/full pattern).

**Response**: `Content-Type: text/plain; charset=utf-8`, transfer-encoding chunked. UI parse stream incrementally.

**Failure modes** (chi tiết trong section Error Handling).

### `GET /api/backup/runs` — NEW

File: `src/app/api/backup/runs/route.ts`

**Query**: `?limit=10` (default 10, max 50)

**Auth**: owner-only

**Response**:
```json
{
  "runs": [
    { "id": "...", "kind": "backup", "status": "success",
      "started_at": "...", "finished_at": "...",
      "byte_size": 2156234, "filename": "chill-backup-2026-05-24-10-30.sql",
      "error_message": null }
  ]
}
```

Lưu ý: KHÔNG trả `log_text` ở list endpoint (large). Thêm endpoint detail nếu cần xem log.

### `GET /api/backup/runs/:id/log` — NEW (cho "View log" button)

Trả `log_text` của 1 run cụ thể. Owner-only.

## UI Component

### `BackupRestoreSection`

File: `src/features/settings/backup-restore-section.tsx` (~280 lines)

**Internal structure**:
```tsx
export function BackupRestoreSection() {
  // Role gate: chỉ render khi role === "owner"
  // Chặt hơn các tab khác (owner+manager) vì restore destructive

  return (
    <Card>
      <BackupPanel />     {/* Download button + last backup info */}
      <Separator />
      <RestorePanel />    {/* Upload + log streaming */}
      <Separator />
      <HistoryPanel />    {/* Last 10 runs table */}
    </Card>
  );
}
```

### `<BackupPanel>` flow

1. Query `useBackupRunsQuery({ kind: "backup", limit: 1 })` → hiển thị "Last backup: 2026-05-24 10:30 (2.1 MB)"
2. Click "Download backup ngay":
   - `fetch("/api/backup/full", { method: "POST", headers: { Authorization } })`
   - Response body = ReadableStream → convert sang Blob (collect chunks)
   - `URL.createObjectURL(blob)` → tạo `<a download="chill-backup-..." />` → programmatic click → cleanup
   - Toast success với size
   - Invalidate `backup-runs` query → history panel auto refresh

### `<RestorePanel>` flow

1. File input `accept=".sql"`, hidden — click qua button "Chọn file backup"
2. After file selected:
   - Client validate: `file.size <= 100 * 1024 * 1024` (100MB)
   - Show file name + size
   - Enable "Restore" button
3. Click "Restore" → mở `<ConfirmRestoreModal>`:
   - Show warning: "Sẽ XÓA toàn bộ data hiện tại"
   - Show file info: name, size
   - Type-to-confirm input: phải gõ chính xác `RESTORE` mới enable "Confirm" button
   - Checkbox: "Tôi đã có backup gần đây (recommended)"
4. Confirm submit:
   - `fetch("/api/backup/restore", { method: "POST", body: formData })`
   - Reader = `response.body.getReader()`
   - `while (!done) { append chunks vào logLines state }`
   - Auto-scroll log panel
   - Khi gặp `===END===` line: parse status, toast success/error, queryClient.invalidateQueries() (all data changed)
5. Log panel:
   - `<pre className="font-mono">` scroll vertical
   - Auto-scroll khi có dòng mới
   - Button "Copy log" + button "Clear"

### `<HistoryPanel>`

1. Query `useBackupRunsQuery({ limit: 10 })` → bảng:
   | Type | Status | Started | Size | Filename | Actions |
   |---|---|---|---|---|---|
   | Backup | ✓ | 10:30 24/05 | 2.1MB | chill-backup-... | [👁 View log] |
   | Restore | ✗ | 09:15 24/05 | 1.8MB | v2-dump.sql | [👁 View log] |
2. Status icons: success=green check, failed=red X, running=blue spinner
3. "View log" button → modal hiển thị `log_text` (fetch GET /api/backup/runs/:id/log)
4. Auto-refresh mỗi 5s khi có run với status=running (polling)

### Settings page integration

File: `src/features/settings/settings-view.tsx` (modify ~15 lines)

```tsx
<Tabs>
  <TabsList>
    <TabsTrigger value="users">Người dùng</TabsTrigger>
    <TabsTrigger value="sidebar">Sidebar</TabsTrigger>
    <TabsTrigger value="kiotviet">KiotViet</TabsTrigger>
    <TabsTrigger value="handover">Bàn giao</TabsTrigger>
    <TabsTrigger value="backup">Sao lưu / Khôi phục</TabsTrigger>   {/* NEW */}
  </TabsList>
  ...
  <TabsContent value="backup">
    <BackupRestoreSection />
  </TabsContent>
</Tabs>
```

## Data Flow (sequence)

### Backup flow
```
[User] Click "Download backup"
   ↓
[Browser] POST /api/backup/full với Authorization header
   ↓
[Server]
  1. requireAuth → owner ✓
  2. INSERT backup_runs(kind=backup, status=running, filename) → run_id
  3. Spawn pg_dump qua POSTGRES_BACKUP_URL
  4. Pipe stdout → response stream (count bytes)
  5. Pipe stderr → in-memory buffer (truncate >1MB)
  6. On exit 0:
     UPDATE backup_runs SET status=success, byte_size, finished_at, log_text
     Close response (browser nhận được full SQL)
  7. On exit !=0:
     UPDATE status=failed, error_message
     Close response với error (browser nhận partial + error sentinel)
   ↓
[Browser]
  1. Collect chunks → Blob
  2. createObjectURL → trigger download
  3. Invalidate backup-runs query → HistoryPanel refresh
  4. Toast "Backup xong (2.1 MB)"
```

### Restore flow
```
[User] Select file → modal confirm "RESTORE" → submit
   ↓
[Browser] POST /api/backup/restore (multipart)
   ↓
[Server]
  1. requireAuth → owner ✓
  2. Validate file size + pg_dump header signature
  3. INSERT backup_runs(kind=restore, status=running, filename, byte_size) → run_id
  4. Pre-restore: psql -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT...;"
  5. Spawn psql --single-transaction -v ON_ERROR_STOP=1
  6. Pipe uploaded file → psql.stdin
  7. Capture stderr line-by-line:
     a. Append vào buffer (truncate ở 1MB)
     b. Write line + '\n' vào response stream
  8. On exit 0: UPDATE status=success, log_text, finished_at
     Write "===END=== status=success\n" → close stream
  9. On exit !=0: UPDATE status=failed, error_message
     Write "===END=== status=failed\n" → close
   ↓
[Browser]
  1. Reader loop: chunks → append vào logLines state → re-render <pre>
  2. Auto-scroll log panel khi có chunk mới
  3. Detect "===END===" line:
     - Parse status
     - Toast success / red banner if failed
     - queryClient.invalidateQueries() — ALL queries (data đã đổi)
     - Invalidate backup-runs → history refresh
```

## Error Handling

| Scenario | Detection | Recovery / UX |
|---|---|---|
| File >100MB | Client + server | Toast/400 "File quá lớn (max 100MB)" |
| File không phải pg_dump | Server check first 500 bytes | 400 + log_text="Invalid format" + status=failed |
| psql exit non-zero | spawn `.on('exit', code)` | log_text full + error_message=last 500 stderr; UI red banner |
| Connection drop mid-restore | `req.signal.aborted` + `child.kill()` | `finally` block UPDATE status=failed; DB ở trạng thái không xác định → warn user phải restore lại |
| DROP SCHEMA fail (active conn) | psql stderr "cannot drop" | Retry 1 lần với `pg_terminate_backend`; nếu vẫn fail → status=failed + suggest restart docker |
| Restore CHECK constraint fail | psql ON_ERROR_STOP aborts | log_text có dòng cụ thể; UI hiển thị + suggest fix dump |
| OOM during large restore | Process killed by OS | error_message="Process killed (likely OOM)" + suggest tăng memory |
| Auth fail (non-owner) | `requireAuth` | 403 trước khi tạo backup_runs |
| Timeout 5 min | Next.js maxDuration hard cap | `finally` UPDATE status=failed; restore có thể đã commit 1 phần → file vẫn còn để retry |

**Critical**: nếu restore fail giữa chừng, public schema đã `DROP CASCADE` rồi → DB trống. User PHẢI rerun restore. UI cần hiển thị cảnh báo rõ trong banner: "⚠️  Restore fail. DB hiện đang trống. Upload backup lại ngay để khôi phục."

## Testing Strategy

### Vitest unit (`src/features/settings/__tests__/`)

- `backup-restore-section.test.tsx`:
  - Role gate: non-owner → `EmptyState` rendered
  - File size validation: 101MB file → button disabled
  - Type-to-confirm: chỉ "RESTORE" (case-sensitive) enable confirm
  - Log panel: append chunks, auto-scroll
- `backup-runs-format.test.ts`:
  - `formatBytes(2156234)` → "2.1 MB"
  - `statusIcon("failed")` → red X
  - `formatDuration(...)` → "1.2s"

### pgTAP (`database/tests/210_backup_runs.sql`)

- Table `public.backup_runs` exists với 10 columns expected types
- CHECK constraint: `kind in (...)`, `status in (...)`
- RLS enabled
- Owner SELECT works, non-owner SELECT trả 0 rows
- Index `backup_runs_started_idx` tồn tại

### Manual integration (dev box, 1-2 rounds)

1. Backup → download → mở SQL file → confirm có CREATE TABLE statements
2. Modify 1 expense → trigger restore với backup vừa download → confirm expense revert
3. Upload `.txt` file rác → expect 400 + history row status=failed
4. Mid-restore: Ctrl+C tab → check backup_runs status=failed + DB ở trạng thái trống
5. Owner-only check: switch sang staff_operator account → tab disabled

### KHÔNG làm
- E2E Playwright (over-engineering cho owner-only flow, 1-2 lần/tháng)
- Load testing (single-tenant, low concurrency)

## Critical Files

### Sẽ tạo mới
- `database/migrations/2026-05-24-backup-runs.sql` — schema delta + RLS
- `database/tests/210_backup_runs.sql` — pgTAP tests
- `src/app/api/backup/restore/route.ts` — restore endpoint (~180 lines)
- `src/app/api/backup/runs/route.ts` — list endpoint (~40 lines)
- `src/app/api/backup/runs/[id]/log/route.ts` — log detail endpoint (~30 lines)
- `src/features/settings/backup-restore-section.tsx` — main UI component (~280 lines)
- `src/features/settings/__tests__/backup-restore-section.test.tsx` — unit tests
- `src/hooks/queries/use-backup-runs-query.ts` — React Query hook
- `src/hooks/mutations/use-backup-mutations.ts` — backup + restore mutations
- `src/lib/data/backup.ts` — data layer wrappers (parallel với `src/lib/data/safe.ts`)
- `src/lib/format/backup.ts` — formatters (bytes, duration, status icons)

### Sẽ sửa
- `src/app/api/backup/full/route.ts` — wrap với backup_runs INSERT/UPDATE (~20 lines diff)
- `src/features/settings/settings-view.tsx` — thêm TabsTrigger + TabsContent "backup" (~15 lines diff)
- `database/001_schema.sql` — append backup_runs DDL sau handover_tasks (idempotent, dùng IF NOT EXISTS)
- `database/003_rls.sql` — append backup_runs policies (đồng bộ với schema delta)
- `src/lib/types.ts` — thêm `BackupRun` type interface (~10 lines)

### Reuse (không sửa)
- `src/app/api/backup/full/route.ts` — pg_dump streaming pattern → mirror cho psql restore
- `src/lib/supabase/server.ts:14-44` — `getServiceRoleClient()` + `requireAuth()`
- `src/components/ui/{toast,dialog,table,card,separator,tabs}.tsx`
- `src/features/settings/settings-view.tsx` — role gate pattern
- `scripts/migrate/02-load-staging.mjs:preprocessDump()` — reuse logic strip `\restrict`/`\unrestrict` nếu user upload dump pg_dump 17+

## Verification (sau implement)

```powershell
# 1. Schema migration
docker compose exec -T db psql -U postgres -f /database/migrations/2026-05-24-backup-runs.sql

# 2. Verify table + RLS
docker compose exec -T db psql -U postgres -c "\d public.backup_runs"
docker compose exec -T db psql -U postgres -c "select * from pg_policies where tablename='backup_runs';"

# 3. Unit tests
npm run test:run

# 4. pgTAP
npm run pgtap

# 5. TypeScript + build
npm run build

# 6. E2E manual (dev server)
npm run dev
# → login owner → settings → "Sao lưu / Khôi phục" tab
# → Click "Download backup" → verify .sql file mở được
# → Modify 1 expense (UI hoặc psql)
# → Upload backup vừa download → confirm "RESTORE" → check log panel streaming
# → Verify expense revert + history table có 2 rows mới (backup + restore)
# → Click "View log" → modal hiển thị stderr đầy đủ
# → Logout, login non-owner → verify tab disabled / EmptyState
```

## Open questions (để follow-up sau Phase 1)

1. **Phase 2 scope**: JSON per-table export sẽ làm sau, format Excel-friendly (header row + values)? Hay generic JSON array?
2. **Phase 3 scope**: Cron schedule (daily 2AM?) + retention (giữ 30 ngày?) + upload Supabase Storage bucket `backups`?
3. **Notification**: Sau khi backup/restore xong, có gửi email/push notification cho owner không? (Phase 3)
4. **Encryption**: Backup có encrypt khi store ở Storage không? (Phase 3 consideration cho PII compliance)
