-- =============================================================================
-- pgTAP — void_period_close: latest-only + refund + re-anchor
-- 7 assertions:
--   1. lý do < 5 ký tự bị chặn
--   2. void kỳ KHÔNG phải gần nhất bị chặn
--   3. void OK: status='voided' + void_reason/voided_by/voided_at set
--   4. refund: balance 2 quỹ về như trước khi kết kỳ 2
--   5. adjustment refund gắn period_close_id (2 dòng dương)
--   6. void lần nữa bị chặn (đã voided)
--   7. preview re-anchor = close_date kỳ 1 + 1
-- =============================================================================
begin;
select plan(7);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner_void@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'OwnerVoid');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner', 'active');
select pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd');

-- ⚠️ created_at frozen trong 1 transaction → đóng dấu tăng dần sau mỗi call
-- đổi số dư (xem 290 — safe_fund_balance_now tie-break id desc = uuid random).
select public.safe_adjust('cash', 4000000, 'fixture void 292');
update public.safe_transactions set created_at = now() + interval '1 second' where created_at = now();
select public.safe_adjust('transfer', 1000000, 'fixture void 292');
update public.safe_transactions set created_at = now() + interval '2 seconds' where created_at = now();
-- Neo hoạt động TRƯỚC ngày kết kỳ 1 — trên CI DB sạch anchor sẽ là ngày này
-- (nếu không, anchor = hôm nay (safe_adjust) > close_date hôm kia → finalize raise).
insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount)
  values ('PC-INV-292', now(), (now() at time zone 'Asia/Ho_Chi_Minh')::date - 3, 10);

-- Kỳ 1: hôm kia (backdate), không rút. Kỳ 2: hôm nay, rút 1tr mặt + 200k CK.
create temp table _k1 as select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date - 2, 0, 0, 'ky 1') as r;
create temp table _bal_before_k2 as select
  public.safe_fund_balance_now('cash') as c, public.safe_fund_balance_now('transfer') as t;
create temp table _k2 as select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date, 1000000, 200000, 'ky 2') as r;
update public.safe_transactions set created_at = now() + interval '3 seconds' where created_at = now();

select throws_like(
  $q$ select public.void_period_close((((select r from _k2) ->> 'id')::uuid), 'abc') $q$,
  '%5 ký tự%', '1. ly do ngan bi chan');
select throws_like(
  $q$ select public.void_period_close((((select r from _k1) ->> 'id')::uuid), 'huy ky cu thu') $q$,
  '%gần nhất%', '2. chi huy duoc lan ket gan nhat');

select public.void_period_close((((select r from _k2) ->> 'id')::uuid), 'huy ky 2 de ket lai');
update public.safe_transactions set created_at = now() + interval '4 seconds' where created_at = now();

select ok(
  (select status = 'voided' and void_reason is not null and voided_by is not null and voided_at is not null
     from public.period_closes where id = (((select r from _k2) ->> 'id')::uuid)),
  '3. status + void metadata day du');
select ok(
  public.safe_fund_balance_now('cash') = (select c from _bal_before_k2)
  and public.safe_fund_balance_now('transfer') = (select t from _bal_before_k2),
  '4. refund du 2 quy ve muc truoc ky 2');
select is(
  (select count(*) from public.safe_transactions
    where transaction_type = 'adjustment' and amount > 0
      and period_close_id = (((select r from _k2) ->> 'id')::uuid)),
  2::bigint, '5. 2 adjustment refund gan period_close_id');
select throws_like(
  $q$ select public.void_period_close((((select r from _k2) ->> 'id')::uuid), 'huy lan nua thu') $q$,
  '%đã bị huỷ%', '6. khong void 2 lan');
select is(
  (public.period_close_preview() ->> 'period_start')::date,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date - 1,
  '7. re-anchor = close_date ky 1 + 1');

select * from finish();
rollback;
