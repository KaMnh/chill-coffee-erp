-- Phase 5.B — Sales reports.
--
-- 11 assertions (top-level SELECT pattern):
--   sales_product_summary (5):
--     1. Empty range returns 0 rows
--     2. sum(quantity) correct across multiple orders for same product
--     3. sum(line_total) correct (revenue match)
--     4. order_count = count(distinct sales_order_id)
--     5. Sort is ORDER BY total_revenue DESC (verified via limit 1)
--
--   sales_category_summary (6):
--     6. Empty range returns 0 rows
--     7. Groups by category — 2 products in same category roll up to one row
--     8a. sum(quantity) correct after roll-up
--     8b. sum(line_total) correct after roll-up
--     9. NULL category_name produces its own row
--    10. Sort is ORDER BY total_revenue DESC

begin;
select plan(11);

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

-- ------------------------------------------------------------------
-- Test 1: empty range returns 0 rows (product)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.sales_product_summary(
     current_date - 30, current_date - 29)),
  0,
  'product: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Tests 2, 3, 4: same product across multiple orders + dup in one order
-- ------------------------------------------------------------------
-- Order 1: Espresso x2 (qty=2, line_total=50000)
-- Order 2: Espresso x1 (qty=1, line_total=25000)
-- Order 2: Espresso (DUPLICATE line, qty=1, line_total=25000)
--   -> 3 lines, 2 distinct order IDs
--   -> total_quantity = 4, total_revenue = 100000, order_count = 2
create temp table _t_ord1 (id uuid);
create temp table _t_ord2 (id uuid);

with i1 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord1', current_date - 1, current_date - 1, 50000, 50000)
  returning id
)
insert into _t_ord1 select id from i1;

with i2 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord2', current_date - 1, current_date - 1, 50000, 50000)
  returning id
)
insert into _t_ord2 select id from i2;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord1), 0, 'test-170-l1-0', 'prod-Esp', 'ESP', 'Espresso', 'Ca phe', 2, 50000),
  ((select id from _t_ord2), 0, 'test-170-l2-0', 'prod-Esp', 'ESP', 'Espresso', 'Ca phe', 1, 25000),
  ((select id from _t_ord2), 1, 'test-170-l2-1', 'prod-Esp', 'ESP', 'Espresso', 'Ca phe', 1, 25000);

-- Test 2: sum quantity = 4
select is(
  (select total_quantity from public.sales_product_summary(
     current_date - 2, current_date)
   where product_id = 'prod-Esp'),
  4::numeric,
  'product: sum(quantity) across multiple lines = 4'
);

-- Test 3: sum revenue = 100000
select is(
  (select total_revenue from public.sales_product_summary(
     current_date - 2, current_date)
   where product_id = 'prod-Esp'),
  100000::numeric,
  'product: sum(line_total) = 100000'
);

-- Test 4: order_count = count(distinct sales_order_id) = 2
select is(
  (select order_count from public.sales_product_summary(
     current_date - 2, current_date)
   where product_id = 'prod-Esp'),
  2::int,
  'product: order_count = count(distinct sales_order_id) = 2'
);

-- ------------------------------------------------------------------
-- Test 5: sort is ORDER BY total_revenue DESC (product table)
-- ------------------------------------------------------------------
create temp table _t_ord3 (id uuid);
with i3 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord3', current_date - 1, current_date - 1, 15000, 15000)
  returning id
)
insert into _t_ord3 select id from i3;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord3), 0, 'test-170-l3-0', 'prod-Tea', 'TEA', 'Tra dao', 'Tra', 1, 15000);

-- limit 1 against function output relies on language-sql inlining to
-- preserve the function's top-level ORDER BY. Same pattern as 5.A.
select is(
  (select product_id from public.sales_product_summary(current_date - 2, current_date) limit 1),
  'prod-Esp',
  'product: first row is highest revenue (Espresso 100000 > Tea 15000)'
);

-- ==================================================================
-- sales_category_summary tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 6: empty range returns 0 rows (category)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.sales_category_summary(
     current_date - 60, current_date - 50)),
  0,
  'category: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Test 7: 2 products in same category roll up to one row
-- ------------------------------------------------------------------
-- Add a 2nd product in "Ca phe" -- should merge with Espresso into 1 row.
create temp table _t_ord4 (id uuid);
with i4 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord4', current_date - 1, current_date - 1, 30000, 30000)
  returning id
)
insert into _t_ord4 select id from i4;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord4), 0, 'test-170-l4-0', 'prod-Latte', 'LAT', 'Latte', 'Ca phe', 1, 30000);

-- Ca phe now: Espresso (4 qty, 100k) + Latte (1 qty, 30k) -> 1 row
select is(
  (select count(*)::int from public.sales_category_summary(current_date - 2, current_date)
   where category_name = 'Ca phe'),
  1,
  'category: 2 products in same category roll up to 1 row'
);

-- Test 8: sum quantity + revenue after roll-up (Ca phe: 5 qty, 130000)
select is(
  (select total_quantity from public.sales_category_summary(current_date - 2, current_date)
   where category_name = 'Ca phe'),
  5::numeric,
  'category: sum(quantity) correct after roll-up = 5'
);

select is(
  (select total_revenue from public.sales_category_summary(current_date - 2, current_date)
   where category_name = 'Ca phe'),
  130000::numeric,
  'category: sum(line_total) correct after roll-up = 130000'
);

-- ------------------------------------------------------------------
-- Test 9: NULL category_name produces its own row
-- ------------------------------------------------------------------
create temp table _t_ord5 (id uuid);
with i5 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-170-ord5', current_date - 1, current_date - 1, 8000, 8000)
  returning id
)
insert into _t_ord5 select id from i5;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, category_name, quantity, line_total)
values
  ((select id from _t_ord5), 0, 'test-170-l5-0', 'prod-Misc', 'MISC', 'Khan lanh', null, 1, 8000);

select is(
  (select count(*)::int from public.sales_category_summary(current_date - 2, current_date)
   where category_name is null),
  1,
  'category: NULL category_name produces its own row'
);

-- ------------------------------------------------------------------
-- Test 10: sort ORDER BY total_revenue DESC (category)
-- ------------------------------------------------------------------
-- Categories: Ca phe 130000 > Tra 15000 > NULL 8000
select is(
  (select category_name from public.sales_category_summary(current_date - 2, current_date) limit 1),
  'Ca phe',
  'category: first row is highest revenue (Ca phe 130000)'
);

select * from finish();
rollback;
