-- 380 — Fixed (per-day) pay type: schema idempotency + RPC branching.
-- Throwaway DB (auth-mock + 001 + 002 + 003 + migrations; KHÔNG có 004 seed).
--
-- Bao phủ:
--   * schema idempotency (has_column pay_type/default_daily_pay/override_pay)
--   * check_out_employee: fixed branch + hourly non-regression
--   * edit_shift_payroll_record: edit fixed daily pay + owner-only (manager denied)
--       + snapshot pay_type KHÔNG đổi
--   * check_out_employee_now: fixed fallback → default_daily_pay
--   * check_out_self: fixed fallback → default_daily_pay (service-role)
--   * Codex #5 edge cases: override_pay=0 honored (không coalesce về default),
--       fixed checkout KHÔNG override → dùng default_daily_pay,
--       snapshot persists sau khi employee.pay_type đổi,
--       old/pre-migration row default 'hourly'.
begin;
select plan(26);

-- ===== Schema idempotency (has_column) =====
select has_column('public', 'employees', 'pay_type', 'employees.pay_type exists');
select has_column('public', 'employees', 'default_daily_pay', 'employees.default_daily_pay exists');
select has_column('public', 'shift_payroll_records', 'pay_type', 'shift_payroll_records.pay_type exists');
select has_column('public', 'shift_payroll_records', 'override_pay', 'shift_payroll_records.override_pay exists');

-- ===== Shared fixture: owner + manager + one fixed NV + one hourly NV =====
create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active');

insert into public.employees (id, name, hourly_rate, pay_type, default_daily_pay) values
  ('e0000000-0000-0000-0000-0000000000f1','NV Fixed', 0, 'fixed', 250000),
  ('e0000000-0000-0000-0000-0000000000a1','NV Hourly', 30000, 'hourly', null);

insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f1','e0000000-0000-0000-0000-0000000000f1', current_date, now() - interval '120 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-0000000000a1','e0000000-0000-0000-0000-0000000000a1', current_date, now() - interval '120 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');

select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner

-- ===== Group: check_out_employee fixed branch =====
-- Fixed NV: override_pay nhập tay = 300000, allowance 20000 → base=300000, total=320000.
create temp table _f1 as select public.check_out_employee(jsonb_build_object(
  'shift_assignment_id','5a000000-0000-0000-0000-0000000000f1',
  'employee_id','e0000000-0000-0000-0000-0000000000f1',
  'business_date', current_date::text,
  'check_in_at', (now() - interval '120 minutes')::text,
  'check_out_at', now()::text,
  'override_pay', 300000,
  'allowance_amount', 20000)) as r;

select is((select base_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  300000::numeric(14,2), 'fixed: base_pay = override_pay (bỏ giờ×rate)');
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  320000::numeric(14,2), 'fixed: total = override + allowance');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  'fixed', 'fixed: pay_type snapshot = fixed');
select is((select override_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  300000::numeric(14,2), 'fixed: override_pay snapshot');
select is((select hourly_rate from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  0::numeric(14,2), 'fixed: hourly_rate snapshot = 0');
select is((select amount from public.cash_drawer_events
  where shift_payroll_record_id=(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1')
    and event_type='payroll_cash_out'),
  320000::numeric(14,2), 'fixed: payroll_cash_out = total_pay');

-- Hourly NV NON-REGRESSION: 120 phút @ 30000 = 60000, allowance 0 → total 60000.
select public.check_out_employee(jsonb_build_object(
  'shift_assignment_id','5a000000-0000-0000-0000-0000000000a1',
  'employee_id','e0000000-0000-0000-0000-0000000000a1',
  'business_date', current_date::text,
  'check_in_at', (now() - interval '120 minutes')::text,
  'check_out_at', now()::text));
select is((select base_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000a1'),
  60000::numeric(14,2), 'hourly: base_pay = round(2h×30000) không đổi');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000a1'),
  'hourly', 'hourly: pay_type snapshot = hourly');
select is((select override_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000a1'),
  null, 'hourly: override_pay = null');

-- ===== Group: edit_shift_payroll_record fixed =====
-- payroll_record_id for the fixed NV row:
create temp table _fpid as select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1';
select public.edit_shift_payroll_record(jsonb_build_object(
  'payroll_record_id', (select id from _fpid),
  'override_pay', 280000,
  'allowance_amount', 0));
select is((select total_pay from public.shift_payroll_records where id=(select id from _fpid)),
  280000::numeric(14,2), 'edit fixed: sửa Lương ngày → total = override');
select is((select base_pay from public.shift_payroll_records where id=(select id from _fpid)),
  280000::numeric(14,2), 'edit fixed: base_pay = override');
select is((select pay_type from public.shift_payroll_records where id=(select id from _fpid)),
  'fixed', 'edit fixed: pay_type snapshot KHÔNG đổi');

-- manager bị từ chối (owner-only, KHÔNG đổi authz)
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select throws_like(
  $$ select public.edit_shift_payroll_record(jsonb_build_object('payroll_record_id',(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),'override_pay',999000)) $$,
  '%chủ quán%', 'edit_shift_payroll_record vẫn owner-only (manager bị chặn)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner

-- ===== Group: check_out_employee_now fixed fallback =====
-- fixed NV ca thứ 2 → manager đóng ca hộ → base = default_daily_pay (250000), total 250000.
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f2','e0000000-0000-0000-0000-0000000000f1', current_date, now() - interval '40 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager (allowed for *_now)
select public.check_out_employee_now('5a000000-0000-0000-0000-0000000000f2'::uuid);
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f2'),
  250000::numeric(14,2), 'now fixed: total = default_daily_pay (bỏ giờ×rate)');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f2'),
  'fixed', 'now fixed: pay_type snapshot = fixed');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- back to owner

-- ===== Group: check_out_self fixed fallback (service-role) =====
-- self-service NV cần employee_accounts để resolve theo auth_user_id.
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-0000000000f1','selffix@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-0000000000f1','e0000000-0000-0000-0000-0000000000f1','employee_self_service','active');
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f3','e0000000-0000-0000-0000-0000000000f1', current_date, now() - interval '30 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
-- check_out_self is service-role (guard-internal); call directly in the superuser test session.
select public.check_out_self('a0000000-0000-0000-0000-0000000000f1'::uuid, '203.0.113.9'::inet, 'UA');
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f3'),
  250000::numeric(14,2), 'self fixed: total = default_daily_pay (bỏ giờ×rate)');
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f3'),
  'fixed', 'self fixed: pay_type snapshot = fixed');
select is((select override_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f3'),
  250000::numeric(14,2), 'self fixed: override_pay = default snapshot');

-- ===== Codex #5 edge cases =====
-- (1) override_pay = 0 được HONORED (0 không null → không coalesce về default).
insert into public.employees (id, name, hourly_rate, pay_type, default_daily_pay) values
  ('e0000000-0000-0000-0000-0000000000f4','NV Fixed Zero', 0, 'fixed', 250000);
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f4','e0000000-0000-0000-0000-0000000000f4', current_date, now() - interval '50 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
select public.check_out_employee(jsonb_build_object(
  'shift_assignment_id','5a000000-0000-0000-0000-0000000000f4',
  'employee_id','e0000000-0000-0000-0000-0000000000f4',
  'business_date', current_date::text,
  'check_in_at', (now() - interval '50 minutes')::text,
  'check_out_at', now()::text,
  'override_pay', 0));
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f4'),
  0::numeric(14,2), 'edge: override_pay=0 honored (KHÔNG coalesce về default 250000)');

-- (2) fixed checkout KHÔNG có override → dùng default_daily_pay (250000).
insert into public.employees (id, name, hourly_rate, pay_type, default_daily_pay) values
  ('e0000000-0000-0000-0000-0000000000f5','NV Fixed NoOverride', 0, 'fixed', 250000);
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f5','e0000000-0000-0000-0000-0000000000f5', current_date, now() - interval '50 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
select public.check_out_employee(jsonb_build_object(
  'shift_assignment_id','5a000000-0000-0000-0000-0000000000f5',
  'employee_id','e0000000-0000-0000-0000-0000000000f5',
  'business_date', current_date::text,
  'check_in_at', (now() - interval '50 minutes')::text,
  'check_out_at', now()::text));
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f5'),
  250000::numeric(14,2), 'edge: fixed KHÔNG override → dùng default_daily_pay');

-- (3) snapshot persists sau khi employee.pay_type đổi.
-- NV Fixed (f1) đổi sang hourly SAU khi đã chốt slip fixed ở trên → slip vẫn 'fixed'.
update public.employees set pay_type = 'hourly', default_daily_pay = null
  where id = 'e0000000-0000-0000-0000-0000000000f1';
select is((select pay_type from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-0000000000f1'),
  'fixed', 'edge: snapshot pay_type PERSISTS sau khi employee.pay_type đổi sang hourly');

-- (4) old/pre-migration row default 'hourly': insert row KHÔNG set pay_type → default.
insert into public.employees (id, name, hourly_rate) values
  ('e0000000-0000-0000-0000-0000000000f6','NV Legacy', 30000);
select is((select pay_type from public.employees where id='e0000000-0000-0000-0000-0000000000f6'),
  'hourly', 'edge: old-row (KHÔNG set pay_type) default = hourly');

select * from finish();
rollback;
