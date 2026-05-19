-- =============================================================================
-- 000_reset.sql — DESTRUCTIVE
-- =============================================================================
-- DROP toàn bộ schema `public` rồi tạo lại empty.
-- Mọi table, view, function, trigger, sequence, type, index trong schema `public`
-- sẽ bị xóa sạch. KHÔNG ảnh hưởng schema `auth` (Supabase Auth) hoặc `storage`.
--
-- Khi nào dùng:
--   1. DB lần đầu setup (sau khi tạo Supabase project mới)
--   2. Rebuild từ đầu khi schema cũ partial / corrupt / không xóa được hết qua UI
--   3. Sau khi đổi major version mà migration delta phức tạp
--
-- KHÔNG dùng khi:
--   - DB production có data thật (sẽ mất hết!)
--   - Chỉ muốn update schema (dùng 001-004 idempotent là đủ)
--
-- Flow chuẩn:
--   1. Chạy 000_reset.sql       (DESTRUCTIVE — confirm trước)
--   2. Chạy 001_schema.sql
--   3. Chạy 002_functions.sql
--   4. Chạy 003_rls.sql
--   5. Chạy 004_seed.sql
-- =============================================================================

drop schema if exists public cascade;
create schema public;

-- Restore default grants (Supabase mặc định cho phép anon/authenticated/service_role)
grant usage on schema public to anon, authenticated, service_role;
grant create on schema public to postgres, service_role;

-- Re-enable extensions Supabase mặc định trong schema public
create extension if not exists "uuid-ossp" with schema public;
create extension if not exists pgcrypto with schema public;

-- =============================================================================
-- Verify (chạy ngay sau 000 để confirm sạch)
-- =============================================================================
-- select count(*) from information_schema.tables where table_schema = 'public';
-- → phải trả 0
--
-- select count(*) from pg_proc
-- where pronamespace = 'public'::regnamespace and prokind = 'f';
-- → phải trả 0 (functions đã bị drop, sẽ tạo lại ở 002)
