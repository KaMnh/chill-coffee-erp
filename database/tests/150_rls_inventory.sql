-- Phase 4.A — Inventory RLS tests.
--
-- 6 assertions (top-level SELECT pattern):
--   1. authenticated SELECT from ingredients works (read all)
--   2. direct INSERT into ingredients blocked by RLS (42501)
--   3. direct INSERT into stock_movements blocked by RLS
--   4. employee_viewer rejected by role gate in create_ingredient
--   5. staff_operator CAN call record_stock_movement (staff+ allowed)
--   6. staff_operator CANNOT call upsert_recipe (owner+manager only)

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

-- Three users with different roles
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local',  '', now(), '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'staff@test.local',  '', now(), '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'viewer@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner'),
  ('22222222-2222-2222-2222-222222222222', 'Staff'),
  ('33333333-3333-3333-3333-333333333333', 'Viewer');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'staff_operator', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'employee_viewer', 'active');

-- Seed fixtures as owner (SECURITY DEFINER RPCs check JWT from act_as).
-- Remain in superuser context so temp table reads are always allowed.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
create temp table _t_ing  as select public.create_ingredient('Seed RLS', 'kg', null, null) as id;
create temp table _t_menu as select public.create_menu_item('Recipe target T8', null, null) as id;

-- Stash UUIDs into session variables so we can read them even after SET LOCAL ROLE.
select set_config('test.ing_id',  (select id::text from _t_ing),  true);
select set_config('test.menu_id', (select id::text from _t_menu), true);

-- Test 1: authenticated SELECT works
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;

select ok(
  (select count(*)::int from public.ingredients) >= 1,
  'authenticated can SELECT from ingredients'
);

-- Test 2: direct INSERT into ingredients blocked by RLS
select throws_ok(
  $$ insert into public.ingredients (name, unit) values ('Direct insert', 'kg') $$,
  '42501',
  null,
  'direct INSERT into ingredients blocked by RLS'
);

-- Test 3: direct INSERT into stock_movements blocked by RLS
select throws_ok(
  $$ insert into public.stock_movements (ingredient_id, quantity_delta, reason)
     values ('00000000-0000-0000-0000-000000000000'::uuid, 1, 'purchase_received') $$,
  '42501',
  null,
  'direct INSERT into stock_movements blocked by RLS'
);

-- Test 4: employee_viewer cannot call create_ingredient
reset role;
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select throws_like(
  $$ select public.create_ingredient('Should fail', 'g', null, null) $$,
  '%không có quyền%',
  'employee_viewer rejected from create_ingredient'
);

-- Test 5: staff_operator CAN call record_stock_movement.
-- Back to superuser context; SECURITY DEFINER RPC checks JWT claim.
reset role;
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
create temp table _t_mvmt as
  select public.record_stock_movement(
    current_setting('test.ing_id')::uuid, 10, 'purchase_received', 'staff stock'
  ) as id;

select ok((select id from _t_mvmt) is not null, 'staff_operator can record_stock_movement');

-- Test 6: staff_operator CANNOT call upsert_recipe (owner+manager only gate).
-- SECURITY DEFINER RPC checks JWT; run in superuser context with staff JWT claim.
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

select throws_like(
  format(
    $sql$select public.upsert_recipe(%L::uuid, true, null, '[]'::jsonb)$sql$,
    current_setting('test.menu_id')::uuid
  ),
  '%không có quyền%',
  'staff_operator cannot upsert_recipe'
);

select * from finish();
rollback;
