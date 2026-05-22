-- Phase 5.D — Hourly trends report.
--
-- 10 assertions (top-level SELECT pattern):
--   sales_hourly_summary (10):
--     1. Always returns exactly 24 rows even with empty range
--     2. Empty range returns rows with all zero values
--     3. TZ boundary: 02:00 UTC sale (= 09:00 Vietnam) buckets to hour=9
--     4. TZ boundary: 17:00 UTC sale (= 00:00 next-day Vietnam) buckets
--        to hour=0 (verifying the business_date filter correctly
--        includes the next Vietnam date)
--     5. sum(line_total) correct across 2 sales in same hour
--     6. sum(quantity) correct across 2 sales in same hour
--     7. order_count = count(distinct sales_order_id) per hour
--     8. business_date filter excludes purchases outside range
--     9. Sort is ASC by sale_hour (first row's sale_hour = 0)
--    10. coalesce zeros: empty hour returns total_revenue=0 (not NULL)

begin;
select plan(10);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- ==================================================================
-- Test 1: always returns 24 rows even with empty range
-- ==================================================================
select is(
  (select count(*)::int from public.sales_hourly_summary(
     current_date - 30, current_date - 29)),
  24,
  'hourly: always returns exactly 24 rows even when empty'
);

-- ==================================================================
-- Test 2: empty range has all zero values
-- ==================================================================
select is(
  (select sum(total_revenue)::numeric from public.sales_hourly_summary(
     current_date - 30, current_date - 29)),
  0::numeric,
  'hourly: empty range — sum of total_revenue across 24 rows = 0'
);

-- ==================================================================
-- Test 3: TZ boundary — 02:00 UTC sale = 09:00 Vietnam → hour=9
-- ==================================================================
create temp table _t_ord_tz1 (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-tz1',
    ((current_date - 1)::timestamp + time '02:00') at time zone 'UTC',
    current_date - 1,
    100000, 100000
  )
  returning id
)
insert into _t_ord_tz1 select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_tz1), 0, 'test-190-tz1-l0', 'TZ Test 1', 1, 100000
);

select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  100000::numeric,
  'hourly: TZ boundary — 02:00 UTC sale = hour=9 Vietnam'
);

-- ==================================================================
-- Test 4: TZ boundary — 17:00 UTC sale = 00:00 next-day Vietnam → hour=0
-- ==================================================================
create temp table _t_ord_tz2 (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-tz2',
    ((current_date - 2)::timestamp + time '17:00') at time zone 'UTC',
    current_date - 1,  -- Vietnam-time business_date for this purchase
    50000, 50000
  )
  returning id
)
insert into _t_ord_tz2 select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_tz2), 0, 'test-190-tz2-l0', 'TZ Test 2', 1, 50000
);

select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 0),
  50000::numeric,
  'hourly: TZ boundary — 17:00 UTC sale = hour=0 next-day Vietnam'
);

-- ==================================================================
-- Tests 5 + 6: sum(line_total) + sum(quantity) across 2 sales in
-- the same hour
-- ==================================================================
create temp table _t_ord_h9b (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-h9b',
    ((current_date - 1)::timestamp + time '02:30') at time zone 'UTC',
    current_date - 1,
    75000, 75000
  )
  returning id
)
insert into _t_ord_h9b select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_h9b), 0, 'test-190-h9b-l0', 'Hour9b', 2, 75000
);

-- Test 5: sum(line_total) for hour=9 = 100000 + 75000 = 175000
select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  175000::numeric,
  'hourly: sum(line_total) across 2 sales in same hour = 175000'
);

-- Test 6: sum(quantity) for hour=9 = 1 + 2 = 3
select is(
  (select total_quantity from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  3::numeric,
  'hourly: sum(quantity) across 2 sales in same hour = 3'
);

-- ==================================================================
-- Test 7: order_count = count(distinct sales_order_id) per hour
-- ==================================================================
insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_h9b), 1, 'test-190-h9b-l1', 'Hour9b-extra', 1, 25000
);

select is(
  (select order_count from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  2::int,
  'hourly: order_count = count(distinct sales_order_id) = 2 (not 3)'
);

-- ==================================================================
-- Test 8: business_date filter excludes purchases outside range
-- ==================================================================
create temp table _t_ord_old (id uuid);
with i as (
  insert into public.sales_orders (
    kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment
  ) values (
    'test-190-old',
    ((current_date - 10)::timestamp + time '02:00') at time zone 'UTC',
    current_date - 10,
    999999, 999999
  )
  returning id
)
insert into _t_ord_old select id from i;

insert into public.sales_order_items (
  sales_order_id, line_index, item_key, product_name, quantity, line_total
) values (
  (select id from _t_ord_old), 0, 'test-190-old-l0', 'Excluded', 1, 999999
);

select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 9),
  200000::numeric,
  'hourly: business_date filter excludes sales outside range'
);

-- ==================================================================
-- Test 9: sort is ASC by sale_hour (first row sale_hour = 0)
-- ==================================================================
select is(
  (select sale_hour from public.sales_hourly_summary(
     current_date - 2, current_date) limit 1),
  0::int,
  'hourly: sort ASC by sale_hour (first row = 0)'
);

-- ==================================================================
-- Test 10: coalesce — hour with no sales returns total_revenue=0 (NOT NULL)
-- ==================================================================
select is(
  (select total_revenue from public.sales_hourly_summary(
     current_date - 2, current_date)
   where sale_hour = 11),
  0::numeric,
  'hourly: coalesce — empty hour returns total_revenue=0 (not NULL)'
);

select * from finish();
rollback;
