-- 320 — repoint_account RPC: re-point một tài khoản đã gắn sang NV đích chưa có TK,
-- deactivate NV nguồn (KHÔNG xoá → dữ liệu con giữ nguyên), upsert profile display_name,
-- stale-source guard, target-already-account / inactive / missing, unlinked, target==source,
-- và privilege lock-down (service-role-only).
--
-- Chạy trên throwaway DB (auth-mock + 001 + 002 + 003 + migrations) — xem
-- scripts/ci/apply-schema.mjs. [NB-NEW] Test #16-18 (grant) verify trạng thái HIỆU LỰC
-- cuối cùng sau khi áp cả 003 lẫn migrations; phần re-assert ở 003_rls.sql (cho DB sạch
-- tương lai không có migration) được đảm bảo thêm bằng code review.
-- Spec: docs/superpowers/specs/2026-06-26-repoint-account-design.md §7.1

begin;
select plan(18);

-- -------------------------------------------------------------------------
-- Fixtures
-- -------------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000010', 'hp@test.local',    '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000012', 'hp2@test.local',   '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000020', 'wd@test.local',    '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000030', 'tha@test.local',   '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000031', 'thasrc@test.local','', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000041', 'misc@test.local',  '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000050', 'unlinked@test.local','', now(), '00000000-0000-0000-0000-000000000000');

insert into public.employees (id, name, hourly_rate, is_active) values
  ('e0000000-0000-0000-0000-000000000010', 'HP Source',   30000, true),
  ('e0000000-0000-0000-0000-000000000011', 'HP Target',   30000, true),
  ('e0000000-0000-0000-0000-000000000012', 'HP2 Source',  30000, true),
  ('e0000000-0000-0000-0000-000000000013', 'HP2 Target',  30000, true),
  ('e0000000-0000-0000-0000-000000000020', 'WD Source',   30000, true),
  ('e0000000-0000-0000-0000-000000000021', 'WD Target',   30000, true),
  ('e0000000-0000-0000-0000-000000000030', 'THA Target',  30000, true),
  ('e0000000-0000-0000-0000-000000000031', 'THA Source',  30000, true),
  ('e0000000-0000-0000-0000-000000000040', 'Inactive Tgt',30000, false),
  ('e0000000-0000-0000-0000-000000000041', 'Misc Source', 30000, true);

insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000010', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000012', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000020', 'e0000000-0000-0000-0000-000000000020', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000030', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000031', 'e0000000-0000-0000-0000-000000000031', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000041', 'e0000000-0000-0000-0000-000000000041', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000050', null,                                   'employee_viewer', 'active');

-- Pre-existing profile for HP2 (test upsert OVERWRITE); HP has NO profile (test upsert CREATE).
insert into public.profiles (id, display_name) values
  ('a0000000-0000-0000-0000-000000000012', 'Tên cũ HP2');

-- WD source child data (must survive re-point, attached to source).
insert into public.shift_assignments (id, employee_id, business_date, status) values
  ('5a000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000020', current_date, 'checked_out');
insert into public.shift_payroll_records (id, employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay) values
  ('5b000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000020', current_date, 480, 30000, 240000, 240000);
insert into public.expense_history_permissions (id, employee_id, date_from, date_to) values
  ('5c000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000020', current_date, current_date);

-- =========================================================================
-- Group A — error paths (throws; KHÔNG mutate vì pgTAP bắt lỗi trong subtxn)
-- =========================================================================

-- 1: target đã có tài khoản → 23505
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000031'::uuid,   -- account on THA Source
       'e0000000-0000-0000-0000-000000000030'::uuid,   -- target THA (already accounted)
       'e0000000-0000-0000-0000-000000000031'::uuid) $$,
  '23505', NULL, 'target đã có tài khoản → 23505');

-- 2: target inactive → P0002
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-000000000040'::uuid,   -- inactive target
       'e0000000-0000-0000-0000-000000000041'::uuid) $$,
  'P0002', NULL, 'target inactive → P0002');

-- 3: target không tồn tại → P0002
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-0000000000ff'::uuid,   -- missing target
       'e0000000-0000-0000-0000-000000000041'::uuid) $$,
  'P0002', NULL, 'target không tồn tại → P0002');

-- 4: account chưa gắn NV (employee_id null) → P0001
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000050'::uuid,   -- unlinked account
       'e0000000-0000-0000-0000-000000000011'::uuid,
       'e0000000-0000-0000-0000-000000000011'::uuid) $$,
  'P0001', NULL, 'account chưa gắn NV → P0001');

-- 5: target == source → P0001
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-000000000041'::uuid,   -- == current source
       'e0000000-0000-0000-0000-000000000041'::uuid) $$,
  'P0001', NULL, 'target == source → P0001');

-- 6: stale source (expected ≠ source hiện tại) → P0001
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-000000000011'::uuid,
       'e0000000-0000-0000-0000-0000000000aa'::uuid) $$, -- wrong expected source
  'P0001', NULL, 'stale source guard → P0001');

-- =========================================================================
-- Group B — happy path (no pre-existing profile) — call once, assert state
-- =========================================================================
create temp table _hp as
  select public.repoint_account(
    'a0000000-0000-0000-0000-000000000010'::uuid,
    'e0000000-0000-0000-0000-000000000011'::uuid,
    'e0000000-0000-0000-0000-000000000010'::uuid) as r;

-- 7: account giờ trỏ target
select is(
  (select employee_id from public.employee_accounts where auth_user_id = 'a0000000-0000-0000-0000-000000000010'),
  'e0000000-0000-0000-0000-000000000011'::uuid, 'happy: account.employee_id = target');

-- 8: NV nguồn bị deactivate (không xoá)
select is(
  (select is_active from public.employees where id = 'e0000000-0000-0000-0000-000000000010'),
  false, 'happy: source employee is_active=false');

-- 9: NV nguồn vẫn tồn tại (không xoá)
select is(
  (select count(*)::int from public.employees where id = 'e0000000-0000-0000-0000-000000000010'),
  1, 'happy: source employee row NOT deleted');

-- 10: profile được TẠO MỚI với display_name = tên target (upsert insert)
select is(
  (select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000010'),
  'HP Target', 'happy: profile created with target name');

-- =========================================================================
-- Group C — happy path with PRE-EXISTING profile (upsert overwrite)
-- =========================================================================
select public.repoint_account(
  'a0000000-0000-0000-0000-000000000012'::uuid,
  'e0000000-0000-0000-0000-000000000013'::uuid,
  'e0000000-0000-0000-0000-000000000012'::uuid);

-- 11: profile cũ bị ghi đè tên target
select is(
  (select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000012'),
  'HP2 Target', 'pre-existing profile overwritten with target name');

-- =========================================================================
-- Group D — re-point khi NV nguồn CÓ dữ liệu con: vẫn ok, data giữ nguyên trỏ source
-- =========================================================================
select public.repoint_account(
  'a0000000-0000-0000-0000-000000000020'::uuid,
  'e0000000-0000-0000-0000-000000000021'::uuid,
  'e0000000-0000-0000-0000-000000000020'::uuid);

-- 12: account trỏ target
select is(
  (select employee_id from public.employee_accounts where auth_user_id = 'a0000000-0000-0000-0000-000000000020'),
  'e0000000-0000-0000-0000-000000000021'::uuid, 'with-data: account re-pointed to target');

-- 13: source inactive
select is(
  (select is_active from public.employees where id = 'e0000000-0000-0000-0000-000000000020'),
  false, 'with-data: source deactivated');

-- 14: shift_assignments vẫn trỏ source
select is(
  (select employee_id from public.shift_assignments where id = '5a000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000020'::uuid, 'with-data: shift_assignments still on source');

-- 15: shift_payroll_records + expense_history_permissions vẫn trỏ source
select ok(
  (select employee_id from public.shift_payroll_records where id = '5b000000-0000-0000-0000-000000000001')
    = 'e0000000-0000-0000-0000-000000000020'::uuid
  and (select employee_id from public.expense_history_permissions where id = '5c000000-0000-0000-0000-000000000001')
    = 'e0000000-0000-0000-0000-000000000020'::uuid,
  'with-data: payroll + expense_history still on source');

-- =========================================================================
-- Group E — privilege lock-down (service-role-only)
-- =========================================================================
select ok(
  has_function_privilege('service_role', 'public.repoint_account(uuid, uuid, uuid)', 'execute'),
  'service_role CAN execute repoint_account');         -- 16
select ok(
  not has_function_privilege('authenticated', 'public.repoint_account(uuid, uuid, uuid)', 'execute'),
  'authenticated CANNOT execute repoint_account');     -- 17
select ok(
  not has_function_privilege('anon', 'public.repoint_account(uuid, uuid, uuid)', 'execute'),
  'anon CANNOT execute repoint_account');              -- 18

select * from finish();
rollback;
