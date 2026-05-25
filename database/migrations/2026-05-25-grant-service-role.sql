-- =============================================================================
-- Migration: restore service_role GRANTs on public schema.
--
-- Symptom (production, 2026-05-25):
--   POST /api/backup/restore returned 500 "Cannot create backup_runs row:
--   permission denied for table backup_runs". The same error blocks
--   /api/backup/full and /api/backup/runs because all three use the
--   service_role client to write/read backup_runs.
--
-- Root cause:
--   service_role has BYPASSRLS but Postgres still requires table-level GRANTs.
--   database/003_rls.sql (pre-fix) only granted to `authenticated` and `anon`,
--   relying on the Supabase image's default privileges for service_role. Those
--   defaults can drift: any REVOKE-style hardening from supabase advisor, or
--   tables created before the default-privilege grant was set, lose service_role
--   access silently. The backup_runs migration (2026-05-24) hit exactly this gap.
--
-- Fix:
--   Idempotently re-grant on every table + function in public to service_role,
--   AND set default privileges so future tables inherit the grant.
--   The migrator service runs this on every `docker compose up` (see
--   deploy/dockge/compose.yaml migrator container), so existing production
--   databases get fixed on the next recreate.
-- =============================================================================

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
