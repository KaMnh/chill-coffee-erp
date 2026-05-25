-- =============================================================================
-- Migration: add pre_restore_dump_path to backup_runs.
-- Restore endpoint now snapshots the CURRENT public schema BEFORE running
-- DROP SCHEMA public CASCADE — the snapshot path goes here so the UI can
-- show "Rollback available" and operators can recover from a bad restore.
-- =============================================================================

alter table public.backup_runs
  add column if not exists pre_restore_dump_path text;

comment on column public.backup_runs.pre_restore_dump_path is
  'Path inside the chill-erp-db-backups volume (mounted at /backups in app + backup-cron) '
  'where the pre-restore snapshot was written. Only set for restore runs that '
  'successfully completed the snapshot step. NULL means restore was aborted '
  'before destructive operations OR pre-snapshot failed and restore did not proceed.';
