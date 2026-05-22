-- Phase 5.A — Inventory analytics reports.
--
-- 10 assertions (top-level SELECT pattern):
--   inventory_consumption_by_ingredient (6 assertions):
--     1. Empty range returns 0 rows
--     2. Sums abs(quantity_delta) correctly across multiple sale_theoretical rows
--     3. Excludes non-sale_theoretical reasons (purchase_received, count_correction)
--     4. sale_count counts distinct source_order_id values correctly
--     5. Date filter inclusive on both p_from and p_to ends
--     6. Sort is ORDER BY total_consumed DESC
--
--   inventory_variance_audit (4 assertions):
--     7. Empty range returns 0 rows
--     8. Returns ONLY reason='count_correction' rows
--     9. Sort is ORDER BY occurred_at DESC (function-native)
--    10. Joins ingredients.name + ingredients.unit correctly

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

-- Two ingredients used across all tests
create temp table _t_ing_milk (id uuid);
create temp table _t_ing_bean (id uuid);
insert into _t_ing_milk select public.create_ingredient('Milk T160',   'ml', null, null);
insert into _t_ing_bean select public.create_ingredient('Coffee T160', 'g',  null, null);

-- ------------------------------------------------------------------
-- Test 1: empty range returns 0 rows
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.inventory_consumption_by_ingredient(
     current_date - 30, current_date - 29)),
  0,
  'consumption: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Test 2: sums abs(quantity_delta) correctly across multiple rows
-- ------------------------------------------------------------------
create temp table _t_ord1 (id uuid);
create temp table _t_ord2 (id uuid);
with i1 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-160-ord1', current_date - 1, current_date - 1, 50000, 50000)
  returning id
)
insert into _t_ord1 select id from i1;
with i2 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-160-ord2', current_date - 1, current_date - 1, 30000, 30000)
  returning id
)
insert into _t_ord2 select id from i2;

insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, source_order_id, created_by)
values
  ((select id from _t_ing_milk), -100, 'sale_theoretical', (current_date - 1) + time '10:00', (select id from _t_ord1), '11111111-1111-1111-1111-111111111111'),
  ((select id from _t_ing_milk),  -50, 'sale_theoretical', (current_date - 1) + time '11:00', (select id from _t_ord2), '11111111-1111-1111-1111-111111111111');

select is(
  (select total_consumed from public.inventory_consumption_by_ingredient(
     current_date - 2, current_date)
   where ingredient_id = (select id from _t_ing_milk)),
  150::numeric,
  'consumption: sums abs(quantity_delta) across 2 movements = 150'
);

-- ------------------------------------------------------------------
-- Test 3: excludes non-sale_theoretical reasons
-- ------------------------------------------------------------------
insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, created_by)
values
  ((select id from _t_ing_milk),  500, 'purchase_received', (current_date - 1) + time '12:00', '11111111-1111-1111-1111-111111111111'),
  ((select id from _t_ing_milk),  -10, 'count_correction',  (current_date - 1) + time '13:00', '11111111-1111-1111-1111-111111111111');

select is(
  (select total_consumed from public.inventory_consumption_by_ingredient(
     current_date - 2, current_date)
   where ingredient_id = (select id from _t_ing_milk)),
  150::numeric,
  'consumption: excludes purchase_received and count_correction'
);

-- ------------------------------------------------------------------
-- Test 4: sale_count is count(distinct source_order_id)
-- ------------------------------------------------------------------
select is(
  (select sale_count from public.inventory_consumption_by_ingredient(
     current_date - 2, current_date)
   where ingredient_id = (select id from _t_ing_milk)),
  2::int,
  'consumption: sale_count = count(distinct source_order_id) = 2'
);

-- ------------------------------------------------------------------
-- Test 5: date filter inclusive on both ends
-- ------------------------------------------------------------------
select is(
  (select total_consumed from public.inventory_consumption_by_ingredient(
     current_date - 1, current_date - 1)
   where ingredient_id = (select id from _t_ing_milk)),
  150::numeric,
  'consumption: date filter is inclusive on both p_from and p_to'
);

-- ------------------------------------------------------------------
-- Test 6: sort is ORDER BY total_consumed DESC
-- ------------------------------------------------------------------
create temp table _t_ord3 (id uuid);
with i3 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-160-ord3', current_date - 1, current_date - 1, 25000, 25000)
  returning id
)
insert into _t_ord3 select id from i3;

insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, source_order_id, created_by)
values
  ((select id from _t_ing_bean), -30, 'sale_theoretical', (current_date - 1) + time '14:00', (select id from _t_ord3), '11111111-1111-1111-1111-111111111111');

-- See Test 9 rationale: language sql function output order is preserved
-- when consumed without an outer ORDER BY.
select is(
  (select ingredient_id from public.inventory_consumption_by_ingredient(current_date - 2, current_date) limit 1),
  (select id from _t_ing_milk),
  'consumption: first row is the largest total_consumed (milk, 150 > bean, 30)'
);

-- ==================================================================
-- inventory_variance_audit tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 7: empty range returns 0 rows
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.inventory_variance_audit(
     current_date - 60, current_date - 50)),
  0,
  'variance: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Test 8: returns ONLY reason='count_correction' rows
-- ------------------------------------------------------------------
-- So far: -100, -50 sale_theoretical + 500 purchase + -10 count_correction
-- Plus -30 sale_theoretical for bean. So variance audit in last 2 days = 1 row.
select is(
  (select count(*)::int from public.inventory_variance_audit(
     current_date - 2, current_date)),
  1,
  'variance: returns only reason=count_correction rows'
);

-- ------------------------------------------------------------------
-- Test 9: sort is ORDER BY occurred_at DESC (function-native)
-- ------------------------------------------------------------------
insert into public.stock_movements (ingredient_id, quantity_delta, reason, occurred_at, created_by)
values
  ((select id from _t_ing_milk), 5, 'count_correction', (current_date - 1) + time '20:00', '11111111-1111-1111-1111-111111111111');

-- A language sql function with a top-level ORDER BY is inlined and its
-- output order is preserved when consumed without an outer ORDER BY.
-- We exploit that here: limit 1 against the function's natural output
-- must give the row with the latest occurred_at.
select is(
  (select quantity_delta from public.inventory_variance_audit(current_date - 2, current_date) limit 1),
  5::numeric,
  'variance: first row from function is the most recent (occurred_at DESC sort)'
);

-- ------------------------------------------------------------------
-- Test 10: joins ingredients.name + ingredients.unit correctly
-- ------------------------------------------------------------------
select is(
  (select ingredient_name || '|' || unit
   from public.inventory_variance_audit(
     current_date - 2, current_date)
   order by occurred_at desc
   limit 1),
  'Milk T160|ml',
  'variance: joins ingredients.name + ingredients.unit correctly'
);

select * from finish();
rollback;
