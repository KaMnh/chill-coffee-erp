-- Phase 4.A — Auto-deduction trigger on sales_order_items.
--
-- 6 assertions (top-level SELECT pattern):
--   1. Backward compat: no menu_items + sales_order_items insert -> no movements
--   2. Match + active recipe: 1 sale x recipe = correct stock_movement
--   3. Case-insensitive trimmed match works
--   4. Inactive recipe -> trigger no-op
--   5. Inactive menu_item -> trigger no-op
--   6. Multi-item recipe -> one stock_movement per ingredient

begin;
select plan(6);

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
-- Test 1: Backward compat - no menu_items, insert sales_order_items -> no movements
-- ------------------------------------------------------------------
create temp table _t_order1 (id uuid);

with ins1 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-T7-999001', now(), current_date, 50000, 50000)
  returning id
)
insert into _t_order1 select id from ins1;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_name, quantity, line_total)
values ((select id from _t_order1), 0, 'item-T7-999001-0', 'Ca phe sua da', 2, 50000);

select is(
  (select count(*)::int from public.stock_movements
   where source_order_id = (select id from _t_order1)),
  0,
  'no menu_items -> no stock_movements emitted (backward compat)'
);

-- ------------------------------------------------------------------
-- Test 2: Match + active recipe + 1 sale -> correct movements
-- ------------------------------------------------------------------
create temp table _t_menu2  (id uuid);
create temp table _t_ing2   (id uuid);
create temp table _t_order2 (id uuid);

insert into _t_menu2 select public.create_menu_item('Espresso shot', 'Espresso', null);
insert into _t_ing2  select public.create_ingredient('Ca phe hat T7', 'g', null, null);

select public.upsert_recipe(
  (select id from _t_menu2),
  true,
  null,
  jsonb_build_array(jsonb_build_object('ingredient_id', (select id from _t_ing2), 'quantity', 18))
);

with ins2 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-T7-999002', now(), current_date, 50000, 50000)
  returning id
)
insert into _t_order2 select id from ins2;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_name, quantity, line_total)
values ((select id from _t_order2), 0, 'item-T7-999002-0', 'Espresso', 2, 50000);

select is(
  (select quantity_delta from public.stock_movements
   where ingredient_id = (select id from _t_ing2)
     and reason = 'sale_theoretical'
     and source_order_id = (select id from _t_order2)),
  (-36)::numeric,
  'sale 2 x 18g coffee = -36g stock_movement'
);

-- ------------------------------------------------------------------
-- Test 3: Case-insensitive trimmed match
-- ------------------------------------------------------------------
create temp table _t_order3 (id uuid);

with ins3 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-T7-999003', now(), current_date, 25000, 25000)
  returning id
)
insert into _t_order3 select id from ins3;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_name, quantity, line_total)
values ((select id from _t_order3), 0, 'item-T7-999003-0', '  ESPRESSO  ', 1, 25000);

select is(
  (select count(*)::int from public.stock_movements
   where source_order_id = (select id from _t_order3)),
  1,
  'case-insensitive trimmed match emits movement (1 row)'
);

-- ------------------------------------------------------------------
-- Test 4: Inactive recipe -> no movements
-- ------------------------------------------------------------------
create temp table _t_menu4  (id uuid);
create temp table _t_ing4   (id uuid);
create temp table _t_order4 (id uuid);

insert into _t_menu4 select public.create_menu_item('Inactive recipe test', 'inactive_test', null);
insert into _t_ing4  select public.create_ingredient('Inactive ing', 'g', null, null);

select public.upsert_recipe(
  (select id from _t_menu4),
  false,
  null,
  jsonb_build_array(jsonb_build_object('ingredient_id', (select id from _t_ing4), 'quantity', 10))
);

with ins4 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-T7-999004', now(), current_date, 25000, 25000)
  returning id
)
insert into _t_order4 select id from ins4;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_name, quantity, line_total)
values ((select id from _t_order4), 0, 'item-T7-999004-0', 'inactive_test', 1, 25000);

select is(
  (select count(*)::int from public.stock_movements
   where ingredient_id = (select id from _t_ing4)),
  0,
  'inactive recipe -> no stock_movements'
);

-- ------------------------------------------------------------------
-- Test 5: Inactive menu_item -> no movements
-- ------------------------------------------------------------------
create temp table _t_menu5  (id uuid);
create temp table _t_ing5   (id uuid);
create temp table _t_order5 (id uuid);

insert into _t_menu5 select public.create_menu_item('Inactive menu test', 'inactive_menu', null);
insert into _t_ing5  select public.create_ingredient('Inactive menu ing', 'g', null, null);

select public.upsert_recipe(
  (select id from _t_menu5),
  true,
  null,
  jsonb_build_array(jsonb_build_object('ingredient_id', (select id from _t_ing5), 'quantity', 10))
);

select public.update_menu_item(
  (select id from _t_menu5),
  'Inactive menu test', 'inactive_menu', null, false
);

with ins5 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-T7-999005', now(), current_date, 25000, 25000)
  returning id
)
insert into _t_order5 select id from ins5;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_name, quantity, line_total)
values ((select id from _t_order5), 0, 'item-T7-999005-0', 'inactive_menu', 1, 25000);

select is(
  (select count(*)::int from public.stock_movements
   where ingredient_id = (select id from _t_ing5)),
  0,
  'inactive menu_item -> no stock_movements'
);

-- ------------------------------------------------------------------
-- Test 6: Multi-item recipe -> multiple stock_movements emitted
-- ------------------------------------------------------------------
create temp table _t_menu6   (id uuid);
create temp table _t_coffee6 (id uuid);
create temp table _t_milk6   (id uuid);
create temp table _t_order6  (id uuid);

insert into _t_menu6   select public.create_menu_item('Latte T6', 'Latte_T6', null);
insert into _t_coffee6 select public.create_ingredient('Coffee T6', 'g', null, null);
insert into _t_milk6   select public.create_ingredient('Milk T6', 'ml', null, null);

select public.upsert_recipe(
  (select id from _t_menu6),
  true,
  null,
  jsonb_build_array(
    jsonb_build_object('ingredient_id', (select id from _t_coffee6), 'quantity', 18),
    jsonb_build_object('ingredient_id', (select id from _t_milk6),   'quantity', 200)
  )
);

with ins6 as (
  insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount, total_payment)
  values ('test-T7-999006', now(), current_date, 35000, 35000)
  returning id
)
insert into _t_order6 select id from ins6;

insert into public.sales_order_items (sales_order_id, line_index, item_key, product_name, quantity, line_total)
values ((select id from _t_order6), 0, 'item-T7-999006-0', 'Latte_T6', 3, 35000);

select is(
  (select count(*)::int from public.stock_movements
   where source_order_id = (select id from _t_order6)),
  2,
  'multi-item recipe emits one row per ingredient (2 rows)'
);

select * from finish();
rollback;
