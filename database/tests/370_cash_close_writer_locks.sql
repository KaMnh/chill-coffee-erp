-- 370 — Bổ sung advisory lock cash_close cho 4 đường ghi mà #64 CHƯA khóa:
--   check_out_employee, check_out_self, update_cash_count  → đã có guard final-close,
--     thêm LOCK (serialize cross-session với finalize).
--   save_cash_day_opening → thêm CẢ lock LẪN guard (opening_cash KHÔNG time-bound).
-- pgTAP 1-session CHỈ kiểm được tầng GUARD (advisory xact lock re-entrant trong cùng
-- session → không quan sát được block cross-session; xem tools/race-cash-close.sh).
-- Hành vi MỚI duy nhất ở single-session = guard save_cash_day_opening (Test 4).
-- Lưu ý: #64 thêm rule "finalize yêu cầu mọi ca đã đóng" → ngày chốt phải KHÔNG có ca mở.
-- Throwaway DB only (auth-mock + 001 + 002 + 003 + migrations).
begin;
select plan(6);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('c0000000-0000-0000-0000-000000000001','owner370@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('c0000000-0000-0000-0000-000000000001', 'owner', 'active');
insert into public.employees (id, name, hourly_rate) values
  ('e7000000-0000-0000-0000-000000000001','NV 370',60000);
select pg_temp.act_as('c0000000-0000-0000-0000-000000000001');

-- ===== Ngày B (2026-02-12) CHƯA chốt: hàm chạy bình thường (lock không phá vỡ) =====
-- Test 1
select lives_ok(
  $$ select public.save_cash_day_opening(jsonb_build_object('business_date','2026-02-12','denominations_json',jsonb_build_object('100000',3))) $$,
  'save_cash_day_opening chạy bình thường (ngày chưa chốt)');

-- Test 2: check_out_employee chạy được (ngày chưa chốt) + lock không gây lỗi.
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('57000000-0000-0000-0000-0000000000b1','e7000000-0000-0000-0000-000000000001','2026-02-12','2026-02-12 09:00+07','checked_in',
        'c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.check_out_employee(json_build_object('shift_assignment_id','57000000-0000-0000-0000-0000000000b1','employee_id','e7000000-0000-0000-0000-000000000001','business_date','2026-02-12','check_in_at','2026-02-12 09:00+07','check_out_at','2026-02-12 17:00+07')::jsonb) $$,
  'check_out_employee chạy bình thường (ngày chưa chốt)');

-- ===== Ngày A (2026-02-11) — chốt két (KHÔNG có ca mở để qua rule "shifts closed" #64) =====
select public.save_cash_day_opening(jsonb_build_object('business_date','2026-02-11','denominations_json',jsonb_build_object('100000',2)));
create temp table _cc as
select ((public.save_cash_count(jsonb_build_object('business_date','2026-02-11','denominations_json',jsonb_build_object('100000',10),
  'total_physical',1000000,'bank_transfer_confirmed',0,'count_type','shift_close','pos_total',1000000,'pos_cash_total',1000000,'pos_non_cash_total',0)))->>'cash_count_id')::uuid as id;
-- Test 3
select lives_ok(
  $$ select public.finalize_cash_close_report((select id from _cc), 0) $$,
  'finalize_cash_close_report chạy (ngày A không có ca mở)');

-- Test 4 (HÀNH VI MỚI): save_cash_day_opening bị guard chặn trên ngày đã chốt.
select throws_like(
  $$ select public.save_cash_day_opening(jsonb_build_object('business_date','2026-02-11','denominations_json',jsonb_build_object('100000',5))) $$,
  '%đã chốt két%',
  'save_cash_day_opening bị chặn khi ngày đã chốt (guard MỚI)');

-- Test 5 (regression): update_cash_count bị chặn trên count đã final.
select throws_like(
  $$ select public.update_cash_count(json_build_object('id',(select id from _cc),'denominations_json',jsonb_build_object('100000',7))::jsonb) $$,
  '%đã final%',
  'update_cash_count vẫn bị chặn khi report đã final (guard + lock mới)');

-- Test 6 (regression): check_out_employee bị chặn trên ngày đã chốt.
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by)
values ('57000000-0000-0000-0000-0000000000a1','e7000000-0000-0000-0000-000000000001','2026-02-11','2026-02-11 09:00+07','checked_in',
        'c0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001');
select throws_like(
  $$ select public.check_out_employee(json_build_object('shift_assignment_id','57000000-0000-0000-0000-0000000000a1','employee_id','e7000000-0000-0000-0000-000000000001','business_date','2026-02-11','check_in_at','2026-02-11 09:00+07','check_out_at','2026-02-11 17:00+07')::jsonb) $$,
  '%đã chốt két%',
  'check_out_employee vẫn bị chặn khi ngày đã chốt (guard + lock mới)');

select * from finish();
rollback;
