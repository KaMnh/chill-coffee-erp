-- =============================================================================
-- pgTAP — REGRESSION: owner_draw KHÔNG ảnh hưởng lợi nhuận/chi phí,
-- NHƯNG hiện đúng trong analytics.daily_cashflow.safe_draw_owner
-- (bất biến #1 của spec 2026-06-12-period-close-settlement)
-- 8 assertions:
--   1-3. cash_flow_overview in/out/net TRƯỚC = SAU khi có owner_draw
--   4.   expenses row-count không đổi
--   5.   analytics.daily_pnl expenses_total + net_profit_cash không đổi
--   6.   safe_fund_balance_now('cash') GIẢM đúng số rút (tiền thật đã ra)
--   7.   daily_cashflow.safe_draw_owner hôm nay TĂNG đúng 2tr
--   8.   daily_cashflow.expense_out hôm nay KHÔNG đổi
-- =============================================================================
begin;
select plan(8);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner_reg@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'OwnerReg');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner', 'active');
select pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');

select public.safe_adjust('cash', 3000000, 'fixture reg 291');
insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount)
  values ('REG-INV-291', now(), (now() at time zone 'Asia/Ho_Chi_Minh')::date, 500000);

create temp table _before as select
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'in')::numeric  as i,
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'out')::numeric as o,
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'net')::numeric as n,
  (select count(*) from public.expenses) as ec,
  (select coalesce(sum(expenses_total),0) + coalesce(sum(net_profit_cash),0)
     from analytics.daily_pnl where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) as pnl,
  (select coalesce(sum(safe_draw_owner),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) as dco,
  (select coalesce(sum(expense_out),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) as deo,
  public.safe_fund_balance_now('cash') as bal;

select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 2000000, 0, 'reg test 291');

select is((select i from _before),
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'in')::numeric,
  '1. in khong doi sau owner_draw');
select is((select o from _before),
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'out')::numeric,
  '2. out khong doi sau owner_draw');
select is((select n from _before),
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'net')::numeric,
  '3. net (loi nhuan) KHONG bi tru boi owner_draw');
select is((select ec from _before), (select count(*) from public.expenses),
  '4. khong co dong expenses moi');
select is((select pnl from _before),
  (select coalesce(sum(expenses_total),0) + coalesce(sum(net_profit_cash),0)
     from analytics.daily_pnl where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  '5. analytics.daily_pnl khong doi');
select is(public.safe_fund_balance_now('cash'), (select bal from _before) - 2000000,
  '6. so du quy mat giam dung 2tr');
select is(
  (select coalesce(sum(safe_draw_owner),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  (select dco from _before) + 2000000,
  '7. daily_cashflow.safe_draw_owner tang dung 2tr');
select is(
  (select coalesce(sum(expense_out),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  (select deo from _before),
  '8. daily_cashflow.expense_out KHONG doi (owner_draw khong phai chi phi)');

select * from finish();
rollback;
