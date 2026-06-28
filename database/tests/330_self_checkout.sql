-- 330 — Self-checkout (Phase 2a): check_out_self (atomic close + payroll + cash
-- event), idempotent, final cash-close guard (Codex #1), privilege lock-down,
-- update_checkin_network_config self_checkout_enabled, get_my_checkin_status.
-- Runs on the throwaway DB (auth-mock + 001 + 002 + 003 + migrations).

begin;
select plan(22);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

-- Fixtures
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@test.local',    '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000004', 'emp@test.local',      '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000005', 'unlinked@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000006', 'emp2@test.local',     '', now(), '00000000-0000-0000-0000-000000000000');

insert into public.employees (id, name, hourly_rate) values
  ('e0000000-0000-0000-0000-000000000001', 'NV Self',  30000),
  ('e0000000-0000-0000-0000-000000000002', 'NV Self2', 30000);

insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null,                                   'owner',                 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001', 'employee_self_service', 'active'),
  ('a0000000-0000-0000-0000-000000000005', null,                                   'employee_self_service', 'active'),
  ('a0000000-0000-0000-0000-000000000006', 'e0000000-0000-0000-0000-000000000002', 'employee_self_service', 'active');

-- Open shift for emp1, check_in_at = 2h ago → checkout computes 120 min (now() frozen in txn).
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
        current_date, now() - interval '2 hours', 'checked_in',
        'a0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004');

-- Throwaway DB KHÔNG có row checkin_network (không seed 004) → gate check_in_self
-- (Group H) mặc định 05:30, flaky theo wall-clock. Đặt 00:00 để mở cổng. MERGE ở
-- Group F (update_checkin_network_config) sẽ GIỮ key này.
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"shift_start_time":"00:00"}'::jsonb, false)
  on conflict (key) do update set value = public.app_settings.value || excluded.value;

-- ===== Group A — check_out_self closes shift + chốt lương + cash event =====
create temp table _co as
  select public.check_out_self('a0000000-0000-0000-0000-000000000004'::uuid,
    '203.0.113.7'::inet, 'Mozilla/5.0 (Out)') as r;

select is((select status from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  'checked_out', 'check_out_self đặt status=checked_out');
select ok((select check_out_at from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001') > now() - interval '1 minute',
  'check_out_at đóng dấu now()');
select is((select check_out_ip from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  '203.0.113.7'::inet, 'check_out_ip đóng dấu');
select is((select check_out_user_agent from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  'Mozilla/5.0 (Out)', 'check_out_user_agent đóng dấu');
select is((select total_minutes from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  120, 'total_minutes = 120 (2h)');
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000001'),
  60000::numeric(14,2), 'payroll total_pay = 60000 (120/60 × 30000, không phụ cấp)');
select is((select amount from public.cash_drawer_events
  where shift_payroll_record_id=(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000001')
    and event_type='payroll_cash_out'),
  60000::numeric(14,2), 'cash_drawer_events payroll_cash_out = total_pay');
select is((select (r->>'already_checked_out')::boolean from _co), false, 'lần đầu: already_checked_out=false');

-- ===== Group B — idempotent (lưới an toàn của atomic transition) =====
create temp table _co2 as
  select public.check_out_self('a0000000-0000-0000-0000-000000000004'::uuid,
    '203.0.113.9'::inet, 'Other') as r;
select ok(
  (select (r->>'already_checked_out')::boolean from _co2) = true
  and (select count(*)::int from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000001') = 1
  and (select count(*)::int from public.cash_drawer_events
       where shift_payroll_record_id=(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000001')
         and event_type='payroll_cash_out') = 1
  and (select check_out_ip from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001') = '203.0.113.7'::inet,
  'lần 2 idempotent: không nhân đôi payroll/cash, KHÔNG ghi đè ca cũ');

-- ===== Group C — chưa vào ca / unlinked → raise =====
select throws_like(
  $$ select public.check_out_self('a0000000-0000-0000-0000-000000000006'::uuid, null, null) $$,
  '%Chưa vào ca%', 'check_out_self không có ca mở → raise');
select throws_like(
  $$ select public.check_out_self('a0000000-0000-0000-0000-000000000005'::uuid, null, null) $$,
  '%chưa gắn nhân viên%', 'check_out_self account chưa gắn NV → raise');

-- ===== Group D — privilege lock-down =====
select ok(not has_function_privilege('anon', 'public.check_out_self(uuid, inet, text)', 'execute'),
  'anon KHÔNG execute được check_out_self');
select ok(not has_function_privilege('authenticated', 'public.check_out_self(uuid, inet, text)', 'execute'),
  'authenticated KHÔNG execute được check_out_self');
select ok(has_function_privilege('service_role', 'public.check_out_self(uuid, inet, text)', 'execute'),
  'service_role execute được check_out_self');

-- ===== Group E — final cash-close guard (Codex #1) =====
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-000000000002', 'e0000000-0000-0000-0000-000000000002',
        current_date, now() - interval '1 hour', 'checked_in',
        'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006');
insert into public.cash_counts (id, business_date) values
  ('cc000000-0000-0000-0000-000000000001', current_date);
insert into public.cash_close_reports (business_date, cash_count_id, report_status) values
  (current_date, 'cc000000-0000-0000-0000-000000000001', 'final');
select throws_like(
  $$ select public.check_out_self('a0000000-0000-0000-0000-000000000006'::uuid, null, null) $$,
  '%chốt két%', 'check_out_self bị chặn khi ngày đã chốt két final (finding #1)');

-- ===== Group F — update_checkin_network_config self_checkout_enabled =====
insert into public.checkin_anchor (id, label, device_token_hash, current_public_ip, last_heartbeat_at, is_active)
values ('c0000000-0000-0000-0000-000000000001', 'POS', repeat('a',64), '198.51.100.10'::inet, now(), true);
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.update_checkin_network_config(
       '{"enabled": false, "reject_message": "x", "grace_hours": 12, "self_checkout_enabled": true}'::jsonb) $$,
  'owner lưu được self_checkout_enabled');
select is(
  (select (value->>'self_checkout_enabled')::boolean from public.app_settings where key='checkin_network'),
  true, 'self_checkout_enabled được lưu');
update public.checkin_anchor set current_public_ip = null;
select throws_like(
  $$ select public.update_checkin_network_config(
       '{"enabled": false, "reject_message": "x", "grace_hours": 12, "self_checkout_enabled": true}'::jsonb) $$,
  '%IP%', 'không bật được self_checkout khi chưa có anchor IP');

-- ===== Group G — get_my_checkin_status phản ánh checkout + toggle =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');
select ok(
  (select (public.get_my_checkin_status()->>'checked_out_today')::boolean) = true
  and (select (public.get_my_checkin_status()->>'self_checkout_enabled')::boolean) = true,
  'get_my_checkin_status: checked_out_today=true + self_checkout_enabled lộ ra');

-- ===== Group H — vào lại ca sau khi ra ca (nhiều ca/ngày) =====
-- check_in_self sau khi đã ra ca → tạo CA MỚI: partial unique index
-- shift_assignments_one_open_per_day chỉ chặn ca checked_in trùng, cho phép nhiều
-- ca checked_out/ngày. UI hiện nút "Vào ca lượt mới".
create temp table _re as
  select public.check_in_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.8'::inet, 'UA2') as r;
select is((select (r->>'already_checked_in')::boolean from _re), false,
  're-check-in sau khi ra ca: tạo ca MỚI (already_checked_in=false)');
select is(
  (select count(*)::int from public.shift_assignments
   where employee_id='e0000000-0000-0000-0000-000000000001' and business_date=current_date),
  2, 'emp có 2 ca trong ngày (1 đã đóng + 1 mới mở)');
select is(
  (select status from public.shift_assignments
   where id=(select (r->>'shift_assignment_id')::uuid from _re)),
  'checked_in', 'ca mới ở trạng thái checked_in');

select * from finish();
rollback;
