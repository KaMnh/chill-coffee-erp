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
