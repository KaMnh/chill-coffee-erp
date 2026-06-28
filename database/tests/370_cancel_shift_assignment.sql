-- 370 — cancel_shift_assignment (huỷ ca không lương) + cancel_open_shifts_for_employee
-- (dọn ca khi xoá TK). Throwaway DB (auth-mock + 001 + 002 + 003 + migrations).
begin;
select plan(17);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000003','op@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employees (id, name, hourly_rate, is_active) values
  ('e0000000-0000-0000-0000-000000000001','NV Treo',30000,true),
  ('e0000000-0000-0000-0000-000000000002','NV Đã ngừng',30000,false),
  ('e0000000-0000-0000-0000-000000000003','NV Gate',30000,true);
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active'),
  ('a0000000-0000-0000-0000-000000000003', null, 'staff_operator','active');

-- Ca đang mở: 1 hôm nay (NV Treo), 2 của NV Đã ngừng (test bulk), 1 cho gate test
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001', current_date, now() - interval '90 minutes','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000021','e0000000-0000-0000-0000-000000000002', current_date - 2, (current_date - 2) + time '08:00','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000022','e0000000-0000-0000-0000-000000000002', current_date - 1, (current_date - 1) + time '08:00','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000031','e0000000-0000-0000-0000-000000000003', current_date, now() - interval '30 minutes','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');

-- ===== Group A — cancel_shift_assignment: huỷ ca, KHÔNG lương/cash, audit =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000001'::uuid, 'NV bỏ về không ra ca');
select is((select status from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  'cancelled', 'A1 ca → cancelled');
select isnt((select check_out_at from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  null, 'A2 check_out_at được set');
select is((select count(*)::int from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000001'),
  0, 'A3 KHÔNG sinh payroll');
select is((select count(*)::int from public.cash_drawer_events ce
  join public.shift_assignments sa on sa.id='5a000000-0000-0000-0000-000000000001'
  where ce.business_date = sa.business_date and ce.event_type='payroll_cash_out' and ce.amount > 0
    and ce.note ilike '%lương%' and ce.occurred_at >= now() - interval '1 minute'),
  0, 'A4 KHÔNG sinh cash_drawer payroll');
select is((select count(*)::int from public.audit_log where entity_id='5a000000-0000-0000-0000-000000000001'
  and action='shift_assignments.cancel' and diff_json->>'reason'='NV bỏ về không ra ca'),
  1, 'A5 audit reason ghi đúng 1 dòng');

-- idempotent: huỷ lại ca đã đóng → raise
select throws_like(
  $$ select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000001'::uuid, 'x') $$,
  '%không tồn tại hoặc đã đóng%', 'A6 huỷ lại ca đã đóng → raise');

-- lý do rỗng → raise
select throws_like(
  $$ select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000031'::uuid, '   ') $$,
  '%lý do%', 'A7 lý do rỗng → raise');

-- ===== Group B — gate quyền =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003'); -- staff_operator
select throws_like(
  $$ select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000031'::uuid, 'x') $$,
  '%chủ quán hoặc quản lý%', 'B1 staff_operator KHÔNG huỷ được ca');
select is((select status from public.shift_assignments where id='5a000000-0000-0000-0000-000000000031'),
  'checked_in', 'B2 ca vẫn checked_in sau khi staff bị chặn');

-- ===== Group C — cancel_open_shifts_for_employee (service-role, bulk by employee) =====
-- session role pgTAP = superuser (BYPASSRLS) → gọi trực tiếp được hàm service-role-only.
reset role;
-- set_config(..., null, ...) lưu '' → auth.uid() làm ''::jsonb (lỗi parse) khi
-- trigger _audit_attendance_change chạy trên UPDATE bulk. Dùng JSON rỗng '{}'
-- để auth.uid() trả NULL sạch (giống ngữ cảnh service-role không có sub).
select set_config('request.jwt.claims', '{}', true);
create temp table _bulk as select public.cancel_open_shifts_for_employee(
  'e0000000-0000-0000-0000-000000000002'::uuid, 'Huỷ do xoá tài khoản',
  'a0000000-0000-0000-0000-000000000001'::uuid) as r;
select is(((select r from _bulk)->>'cancelled_count')::int, 2, 'C1 huỷ 2 ca treo của NV đã ngừng');
select is((select count(*)::int from public.shift_assignments
  where employee_id='e0000000-0000-0000-0000-000000000002' and status='cancelled'),
  2, 'C2 cả 2 ca → cancelled');
select is((select count(*)::int from public.shift_assignments
  where employee_id='e0000000-0000-0000-0000-000000000002' and status='checked_in'),
  0, 'C3 không còn ca checked_in');
select is((select count(*)::int from public.shift_payroll_records
  where employee_id='e0000000-0000-0000-0000-000000000002'),
  0, 'C4 bulk KHÔNG sinh payroll');
select is((select count(*)::int from public.audit_log
  where entity_type='shift_assignments' and action='shift_assignments.cancel'
    and actor_user_id='a0000000-0000-0000-0000-000000000001'
    and diff_json->>'reason'='Huỷ do xoá tài khoản'),
  2, 'C5 audit actor + reason cho cả 2 ca');

-- ===== Group D — dashboard_daily_ops active count + active_shifts giảm sau khi huỷ =====
-- dashboard_daily_ops có gate quyền riêng → cần ngữ cảnh owner đã đăng nhập.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
-- NV Treo (đã huỷ ở A) thuộc current_date; trước huỷ active=2 (NV Treo + NV Gate), sau huỷ còn 1.
select is((select (public.dashboard_daily_ops(current_date)->>'active_staff')::int),
  1, 'D1 active_staff hôm nay = 1 (chỉ còn NV Gate)');
-- active_shifts là input của chi phí lương real-time (002:356) → ca đã huỷ phải biến mất.
select is((select jsonb_array_length(public.dashboard_daily_ops(current_date)->'active_shifts')),
  1, 'D1b active_shifts còn 1 (ca huỷ rời khỏi chi phí lương tạm tính)');

-- bulk-by-employee: NV không có ca mở → count 0 (idempotent)
create temp table _bulk2 as select public.cancel_open_shifts_for_employee(
  'e0000000-0000-0000-0000-000000000002'::uuid, 'x', 'a0000000-0000-0000-0000-000000000001'::uuid) as r;
select is(((select r from _bulk2)->>'cancelled_count')::int, 0, 'D2 bulk lần 2 → 0 (no-op)');

select * from finish();
rollback;
