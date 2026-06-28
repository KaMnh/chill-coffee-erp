-- 350 — Manager checkout (làm tròn 15') + check_out_employee final-close guard
-- (Codex #1) + check_in_self gate 05:30 + update_checkin_network_config validate/merge
-- (Codex #3). Throwaway DB (auth-mock + 001 + 002 + 003 + migrations; KHÔNG có 004 seed).
begin;
select plan(13);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000003','op@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000004','self@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employees (id, name, hourly_rate) values
  ('e0000000-0000-0000-0000-000000000001','NV 65',30000),
  ('e0000000-0000-0000-0000-000000000002','NV 60',30000),
  ('e0000000-0000-0000-0000-000000000003','NV Final',30000),
  ('e0000000-0000-0000-0000-000000000004','NV Self',30000);
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active'),
  ('a0000000-0000-0000-0000-000000000003', null, 'staff_operator','active'),
  ('a0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000004','employee_self_service','active');

insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-000000000065','e0000000-0000-0000-0000-000000000001', current_date, now() - interval '65 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000060','e0000000-0000-0000-0000-000000000002', current_date, now() - interval '60 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f1','e0000000-0000-0000-0000-000000000003', current_date - 1, (current_date - 1) + time '08:00', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
insert into public.cash_counts (id, business_date) values ('cc000000-0000-0000-0000-0000000000f1', current_date - 1);
insert into public.cash_close_reports (business_date, cash_count_id, report_status) values (current_date - 1, 'cc000000-0000-0000-0000-0000000000f1', 'final');

-- ===== Group A — check_out_employee_now (làm tròn + quyền + final-close) =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
create temp table _c1 as select public.check_out_employee_now('5a000000-0000-0000-0000-000000000065'::uuid) as r;
select is((select status from public.shift_assignments where id='5a000000-0000-0000-0000-000000000065'),
  'checked_out', 'manager đóng ca → checked_out');
select is((select total_minutes from public.shift_assignments where id='5a000000-0000-0000-0000-000000000065'),
  75, '65 phút làm tròn lên 75 (bội số 15)');
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000065'),
  38000::numeric(14,2), 'total_pay = 38000 (75 phút)');
select is((select amount from public.cash_drawer_events
  where shift_payroll_record_id=(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000065')
    and event_type='payroll_cash_out'),
  38000::numeric(14,2), 'cash_drawer_events = total_pay');
select public.check_out_employee_now('5a000000-0000-0000-0000-000000000060'::uuid);
select is((select total_minutes from public.shift_assignments where id='5a000000-0000-0000-0000-000000000060'),
  60, '60 phút giữ nguyên 60');
select throws_like(
  $$ select public.check_out_employee_now('5a000000-0000-0000-0000-000000000065'::uuid) $$,
  '%không tồn tại hoặc đã đóng%', 'đóng lại ca đã đóng → raise');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
select throws_like(
  $$ select public.check_out_employee_now('5a000000-0000-0000-0000-0000000000f1'::uuid) $$,
  '%chủ quán hoặc quản lý%', 'staff_operator KHÔNG đóng ca hộ');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select public.check_out_employee_now('5a000000-0000-0000-0000-0000000000f1'::uuid) $$,
  '%chốt két%', 'manager đóng ca ngày final → raise');

-- ===== Group B — check_out_employee (owner full) final-close guard (Codex #1) =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
select throws_like(
  $$ select public.check_out_employee(json_build_object(
       'shift_assignment_id','5a000000-0000-0000-0000-0000000000f1',
       'employee_id','e0000000-0000-0000-0000-000000000003',
       'business_date', (current_date - 1)::text)::jsonb) $$,
  '%chốt két%', 'owner check_out_employee ngày final → raise (Codex #1)');

-- ===== Group C — check_in_self gate 05:30 =====
-- throwaway DB KHÔNG có row checkin_network → phải INSERT (không UPDATE).
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"shift_start_time":"00:00"}'::jsonb, false)
  on conflict (key) do update set value = public.app_settings.value || excluded.value;
select lives_ok(
  $$ select public.check_in_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  'shift_start_time=00:00 → check_in_self KHÔNG bị chặn');
update public.app_settings set value = value || '{"shift_start_time":"23:59"}'::jsonb where key='checkin_network';
select throws_like(
  $$ select public.check_in_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  '%Chưa tới giờ vào ca%', 'shift_start_time=23:59 → check_in_self bị chặn');

-- ===== Group D — update_checkin_network_config validate + merge =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
select throws_like(
  $$ select public.update_checkin_network_config(
       '{"enabled":false,"reject_message":"x","grace_hours":12,"shift_start_time":"25:00"}'::jsonb) $$,
  '%HH:MM%', 'shift_start_time 25:00 → raise');
select public.update_checkin_network_config('{"enabled":false,"reject_message":"x","grace_hours":12,"shift_start_time":"06:00"}'::jsonb);
select public.update_checkin_network_config('{"enabled":false,"reject_message":"x","grace_hours":12}'::jsonb);
select is(
  (select value->>'shift_start_time' from public.app_settings where key='checkin_network'),
  '06:00', 'config shape cũ KHÔNG xoá shift_start_time (merge, Codex #3)');

select * from finish();
rollback;
