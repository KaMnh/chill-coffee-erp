-- 360 — Chống lệch lương khi chốt két: rule no-open-shift (finalize) + final-close
-- guard cho check-in. (Advisory lock không test được contention trong 1 transaction.)
begin;
select plan(5);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222','self@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values ('11111111-1111-1111-1111-111111111111','Owner');
insert into public.employees (id, name, hourly_rate) values
  ('ee000000-0000-0000-0000-000000000001','NV',30000);
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', null, 'owner','active'),
  ('22222222-2222-2222-2222-222222222222','ee000000-0000-0000-0000-000000000001','employee_self_service','active');

-- ===== Phần A — rule: finalize từ chối khi còn ca mở cùng business_date =====
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select public.save_cash_day_opening(jsonb_build_object(
  'business_date','2026-01-15','denominations_json',jsonb_build_object('100000',2),
  'carried_from_previous_day',false,'safe_withdrawal_amount',0));
create temp table _count as
  select ((public.save_cash_count(jsonb_build_object(
    'business_date','2026-01-15','denominations_json',jsonb_build_object('100000',10),
    'total_physical',1000000,'bank_transfer_confirmed',0,'count_type','shift_close',
    'pos_total',1000000,'pos_cash_total',1000000,'pos_non_cash_total',0)))->>'cash_count_id')::uuid as id;

insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-0000000000a1','ee000000-0000-0000-0000-000000000001',
        '2026-01-15', '2026-01-15 08:00+07', 'checked_in',
        '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');
select throws_like(
  $$ select public.finalize_cash_close_report((select id from _count), 100000) $$,
  '%chưa ra ca%', 'finalize bị chặn khi còn ca mở cùng ngày (rule)');

update public.shift_assignments set status='checked_out', check_out_at='2026-01-15 17:00+07'
  where id='5a000000-0000-0000-0000-0000000000a1';
-- ca ngày KHÁC vẫn mở → không được chặn finalize 2026-01-15
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-0000000000a2','ee000000-0000-0000-0000-000000000001',
        '2026-01-16', '2026-01-16 08:00+07', 'checked_in',
        '11111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.finalize_cash_close_report((select id from _count), 100000) $$,
  'finalize OK khi ngày 2026-01-15 đã ra hết (ca ngày khác không chặn)');
select is(
  (select report_status from public.cash_close_reports where business_date='2026-01-15'),
  'final', 'báo cáo 2026-01-15 = final');

-- ===== Phần B — final-close guard cho check-in trên ngày đã chốt két =====
insert into public.app_settings (key, value, is_public) values
  ('checkin_network','{"shift_start_time":"00:00"}'::jsonb,false)
  on conflict (key) do update set value = public.app_settings.value || excluded.value;
insert into public.cash_counts (id, business_date) values ('cc000000-0000-0000-0000-0000000000b1', current_date);
insert into public.cash_close_reports (business_date, cash_count_id, report_status)
  values (current_date, 'cc000000-0000-0000-0000-0000000000b1', 'final');
select throws_like(
  $$ select public.check_in_self('22222222-2222-2222-2222-222222222222'::uuid, null, null) $$,
  '%đã chốt két%', 'check_in_self bị chặn trên ngày đã chốt két');
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_like(
  $$ select public.check_in_employee(json_build_object(
       'employee_id','ee000000-0000-0000-0000-000000000001','business_date',current_date::text)::jsonb) $$,
  '%đã chốt két%', 'check_in_employee bị chặn trên ngày đã chốt két');

select * from finish();
rollback;
