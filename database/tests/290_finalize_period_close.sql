-- =============================================================================
-- pgTAP — finalize_period_close + period_close_preview (spec 2026-06-12)
-- Chạy được trên CẢ dev DB có dữ liệu thật lẫn CI DB sạch: assert về tổng P&L
-- dùng DELTA trước/sau fixture; số dư quỹ deterministic nhờ safe_adjust (đặt
-- số dư TUYỆT ĐỐI).
-- ⚠️ Nếu dev DB đã có period_closes 'final' với close_date = hôm nay (do test
-- tay) thì PHẢI void trước khi chạy suite.
-- 12 assertions:
--   1. anchor: period_start <= hôm nay khi chưa có kỳ
--   2. DELTA preview sau fixture: rev +100, expenses_total +50 (30 thường +
--      20 MIRROR rút quỹ vận hành — chốt brainstorm 2026-06-12), pay +50, profit +0
--   3. staff bị chặn finalize
--   4. chặn ngày tương lai
--   5. chặn draw âm
--   6. chặn draw không nguyên VND
--   7. chặn rút quá số dư TỪNG quỹ (transfer 2tr, đòi 3tr)
--   8. finalize OK: đúng 2 owner_draw âm gắn period_close_id
--   9. KHÔNG có dòng expenses mới (đếm trước/sau)
--  10. closing_total = (4.999.980 + 2.000.000) − 1.500.000 = 5.499.980
--  11. kết lần 2 cùng ngày bị chặn
--  12. preview sau kết: period_start = close_date + 1
-- =============================================================================
begin;
select plan(12);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner_pc@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'staff_pc@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OwnerPC'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'StaffPC');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'staff_operator', 'active');

select pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Quỹ: đặt số dư TUYỆT ĐỐI → deterministic trên mọi DB.
-- ⚠️ Trong 1 transaction pgTAP, mọi row đều có created_at = now() (frozen) →
-- safe_fund_balance_now tie-break bằng id desc = uuid NGẪU NHIÊN. Phải đóng
-- dấu created_at tăng dần sau MỖI call đổi số dư (production không bị —
-- mỗi RPC một transaction riêng).
select public.safe_adjust('cash', 5000000, 'fixture PC 290');
update public.safe_transactions set created_at = now() + interval '1 second' where created_at = now();
select public.safe_adjust('transfer', 2000000, 'fixture PC 290');
update public.safe_transactions set created_at = now() + interval '2 seconds' where created_at = now();

-- 1. anchor
select ok(
  (public.period_close_preview() ->> 'period_start')::date
    <= (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  '1. preview anchor <= hom nay');

-- Snapshot preview TRƯỚC fixture P&L (delta pattern — dev DB có dữ liệu thật)
create temp table _pv0 as select
  (public.period_close_preview() ->> 'revenue')::numeric        as rev,
  (public.period_close_preview() ->> 'expenses_total')::numeric as exp,
  (public.period_close_preview() ->> 'payroll_total')::numeric  as pay,
  (public.period_close_preview() ->> 'profit')::numeric         as pft;

-- Fixture P&L hôm nay: revenue 100, expense thường 30, payroll 50,
-- rút quỹ vận hành 20 (tạo mirror; cash 5.000.000 → 4.999.980).
insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount)
  values ('PC-INV-290', now(), (now() at time zone 'Asia/Ho_Chi_Minh')::date, 100);
insert into public.expenses (business_date, description, amount)
  values ((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'PC expense 290', 30);
create temp table _pc_emp (id uuid);
with e as (insert into public.employees (name, hourly_rate) values ('PC Emp 290', 100000) returning id)
insert into _pc_emp select id from e;
insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
  values ((select id from _pc_emp), (now() at time zone 'Asia/Ho_Chi_Minh')::date, 60, 100000, 50, 50);
select public.safe_withdraw_other(20, 0, 'utilities', 'PC mirror 290');
update public.safe_transactions set created_at = now() + interval '3 seconds' where created_at = now();

-- 2. DELTA: expenses_total tăng đúng 50 (30 + mirror 20) — chốt brainstorm
select ok(
  ((public.period_close_preview() ->> 'revenue')::numeric        - (select rev from _pv0)) = 100 and
  ((public.period_close_preview() ->> 'expenses_total')::numeric - (select exp from _pv0)) = 50  and
  ((public.period_close_preview() ->> 'payroll_total')::numeric  - (select pay from _pv0)) = 50  and
  ((public.period_close_preview() ->> 'profit')::numeric         - (select pft from _pv0)) = 0,
  '2. delta preview: rev+100 / exp+50 (gom mirror) / pay+50 / profit+0');

-- 3..7 validations
select pg_temp.act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 0) $q$,
  '%Chỉ owner được kết toán kỳ%', '3. staff bi chan finalize');
select pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select throws_like(
  $q$ select public.finalize_period_close(((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1), 0, 0) $q$,
  '%tương lai%', '4. chan ngay tuong lai');
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, -1, 0) $q$,
  '%không được âm%', '5. chan draw am');
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 1000.5, 0) $q$,
  '%số nguyên%', '6. chan draw le');
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 3000000) $q$,
  '%không đủ%', '7. chan rut qua quy chuyen khoan');

-- 8..10 finalize thành công: rút 1tr mặt + 500k CK
create temp table _exp_cnt as select count(*) c from public.expenses;
create temp table _pc_result as
select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date, 1000000, 500000, 'ket thu 290') as r;

select is(
  (select count(*) from public.safe_transactions
    where transaction_type = 'owner_draw'
      and period_close_id = (((select r from _pc_result) ->> 'id')::uuid)
      and amount < 0),
  2::bigint, '8. tao dung 2 owner_draw am gan period_close_id');
select is(
  (select count(*) from public.expenses), (select c from _exp_cnt),
  '9. owner_draw KHONG tao dong expenses');
select is(
  (select (r ->> 'closing_total')::numeric from _pc_result),
  5499980::numeric,
  '10. closing_total = 4.999.980 + 2.000.000 - 1.500.000');

-- 11..12
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 0) $q$,
  '%Đã có kỳ kết%', '11. khong ket 2 lan cung ngay');
select is(
  (public.period_close_preview() ->> 'period_start')::date,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1,
  '12. period_start moi = close_date + 1');

select * from finish();
rollback;
