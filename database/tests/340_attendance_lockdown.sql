-- 340 — Attendance lockdown Phase 2b: manual chấm công + sửa lương owner-only;
-- bỏ direct-write RLS (Codex #1); audit attendance actor-indexable (Codex #2).
-- Throwaway DB only (auth-mock + 001 + 002 + 003 + migrations).
begin;
select plan(17);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

-- Giả lập service role (không 'sub') → auth.uid() null, như self check-in/out chạy thật.
create or replace function pg_temp.act_as_service()
returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
end; $$ language plpgsql;

-- Đếm số row mà UPDATE thẳng chạm tới (RLS lọc → 0). Data-modifying CTE phải ở
-- top-level của một câu lệnh → bọc trong function (security invoker: RLS theo
-- role/JWT của caller lúc gọi). Không thể inline trong subquery của is().
create or replace function pg_temp.direct_update_payroll_total()
returns int as $$
  with u as (update public.shift_payroll_records set total_pay = 999
             where id='9a000000-0000-0000-0000-0000000000aa' returning 1)
  select count(*)::int from u;
$$ language sql;

-- ===== Fixtures =====
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000003','op@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000004','self@t.local','',now(),'00000000-0000-0000-0000-000000000000');

insert into public.employees (id, name, hourly_rate) values
  ('e0000000-0000-0000-0000-000000000001','NV Target',30000),
  ('e0000000-0000-0000-0000-000000000004','NV Self',30000);

insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active'),
  ('a0000000-0000-0000-0000-000000000003', null, 'staff_operator','active'),
  ('a0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000004','employee_self_service','active');

-- Fixture ca + lương đã đóng (actor cols = owner → audit fixture không có null actor).
insert into public.shift_assignments
  (id, employee_id, business_date, check_in_at, check_out_at, total_minutes, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-000000000001', current_date,
        now()-interval '2 hours', now()-interval '1 hour', 60, 'checked_out',
        'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
insert into public.shift_payroll_records
  (id, shift_assignment_id, employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay, created_by, edited_by, edited_at)
values ('9a000000-0000-0000-0000-0000000000aa','5a000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-000000000001',
        current_date, 60, 30000, 30000, 30000,
        'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001', now());

-- ===== Group A — manual RPC owner-only =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select throws_like(
  $$ select public.check_in_employee('{"employee_id":"e0000000-0000-0000-0000-000000000001"}'::jsonb) $$,
  '%chủ quán%', 'manager KHÔNG check_in_employee được (owner-only)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003'); -- staff_operator
select throws_like(
  $$ select public.check_out_employee('{"shift_assignment_id":"5a000000-0000-0000-0000-0000000000aa","employee_id":"e0000000-0000-0000-0000-000000000001"}'::jsonb) $$,
  '%chủ quán%', 'staff_operator KHÔNG check_out_employee được (owner-only)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select throws_like(
  $$ select public.edit_shift_payroll_record('{"payroll_record_id":"9a000000-0000-0000-0000-0000000000aa"}'::jsonb) $$,
  '%chủ quán%', 'manager KHÔNG edit_shift_payroll_record được (owner-only)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
select lives_ok(
  $$ select public.check_in_employee(json_build_object('employee_id','e0000000-0000-0000-0000-000000000001','business_date',current_date::text)::jsonb) $$,
  'owner check_in_employee vẫn được');

-- ===== Group B — RLS no-direct-write (Codex #1: owner cũng bị chặn) =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
set local role authenticated;
select throws_ok(
  $$ insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
     values ('e0000000-0000-0000-0000-000000000001', current_date, 1, 1, 1, 1) $$,
  '42501', null, 'owner KHÔNG INSERT thẳng shift_payroll_records (RLS deny)');
select throws_ok(
  $$ insert into public.shift_assignments (employee_id, business_date, check_in_at, status)
     values ('e0000000-0000-0000-0000-000000000004', current_date, now(), 'checked_out') $$,
  '42501', null, 'owner KHÔNG INSERT thẳng shift_assignments (RLS deny)');
select is(
  pg_temp.direct_update_payroll_total(),
  0, 'owner UPDATE thẳng shift_payroll_records → 0 rows (RLS deny)');
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
set local role authenticated;
select throws_ok(
  $$ insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
     values ('e0000000-0000-0000-0000-000000000001', current_date, 1, 1, 1, 1) $$,
  '42501', null, 'manager KHÔNG INSERT thẳng shift_payroll_records');
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003'); -- operator
set local role authenticated;
select ok((select count(*)::int from public.shift_payroll_records) > 0,
  'staff_operator vẫn ĐỌC được shift_payroll_records (read không bị siết)');
reset role;

-- ===== Group C — self check-in/out KHÔNG vỡ (service role, definer bypass RLS) =====
select pg_temp.act_as_service(); -- auth.uid() null
select lives_ok(
  $$ select public.check_in_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  'check_in_self chạy dù đã bỏ write policy (definer bypass)');
select is(
  (select status from public.shift_assignments
   where employee_id='e0000000-0000-0000-0000-000000000004' and business_date=current_date
   order by check_in_at desc limit 1),
  'checked_in', 'self check-in tạo ca checked_in');
select lives_ok(
  $$ select public.check_out_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  'check_out_self chạy (definer bypass)');
select is(
  (select count(*)::int from public.shift_payroll_records where employee_id='e0000000-0000-0000-0000-000000000004'),
  1, 'self check-out tạo 1 payroll row');

-- ===== Group D — audit actor (Codex #2) =====
select ok(exists(
  select 1 from public.audit_log
  where action='shift_assignments.insert'
    and actor_user_id='a0000000-0000-0000-0000-000000000004'
    and actor_role='employee_self_service'),
  'audit self check-in: actor=emp4 + role NV (không null/anonymous)');
select ok(exists(
  select 1 from public.audit_log
  where action='shift_payroll_records.insert'
    and actor_user_id='a0000000-0000-0000-0000-000000000004'),
  'audit self check-out payroll: actor=emp4');
select ok(exists(
  select 1 from public.audit_log
  where action='shift_assignments.insert'
    and actor_user_id='a0000000-0000-0000-0000-000000000001'
    and actor_role='owner'),
  'audit owner manual: actor=owner');
select is(
  (select count(*)::int from public.audit_log where action like 'shift_%' and actor_user_id is null),
  0, 'KHÔNG audit attendance nào có actor_user_id null (Codex #2)');

select * from finish();
rollback;
