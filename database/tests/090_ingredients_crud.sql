-- Phase 4.A — Ingredients CRUD RPCs.
--
-- 6 assertions (top-level pattern; DO-block perform does not emit TAP):
--   1a. create_ingredient returns uuid
--   1b. name stored trimmed
--   2.  duplicate name raises unique_violation (23505)
--   3.  blank name raises check_violation (23514)
--   4.  update_ingredient soft-deletes via is_active=false
--   5.  delete_ingredient succeeds when no references
--   6.  delete_ingredient hard-fails when stock_movement references
--       (seeded via direct INSERT to avoid T6 RPC dependency)

begin;
select plan(7);

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

-- Fixtures: owner user
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Capture created id for re-use across tests
create temp table _t_ing (id uuid);

-- Test 1a: create_ingredient returns uuid (with leading/trailing whitespace in name)
insert into _t_ing
  select public.create_ingredient('  Sữa tươi  ', 'L', 5, 'Carton 1L');
select ok((select id from _t_ing) is not null, 'create_ingredient returns uuid');

-- Test 1b: name stored trimmed
select is(
  (select name from public.ingredients where id = (select id from _t_ing)),
  'Sữa tươi',
  'name stored trimmed'
);

-- Test 2: Duplicate name throws
select throws_ok(
  $$ select public.create_ingredient('Sữa tươi', 'L', null, null) $$,
  '23505',
  null,
  'duplicate ingredient name rejected'
);

-- Test 3: Blank name throws CHECK
select throws_ok(
  $$ select public.create_ingredient('   ', 'L', null, null) $$,
  '23514',
  null,
  'blank ingredient name rejected by CHECK'
);

-- Test 4: update_ingredient sets is_active=false
select public.update_ingredient(
  (select id from _t_ing),
  'Sữa tươi', 'L', 5, null, false
);
select is(
  (select is_active from public.ingredients where id = (select id from _t_ing)),
  false,
  'update_ingredient sets is_active=false'
);

-- Test 5: delete_ingredient succeeds when no references
-- Use a separate ingredient (not the one in _t_ing) to avoid disturbing Test 6 prep.
create temp table _t_ing2 (id uuid);
insert into _t_ing2 select public.create_ingredient('Đường', 'kg', null, null);
select public.delete_ingredient((select id from _t_ing2));
select ok(
  not exists (select 1 from public.ingredients where id = (select id from _t_ing2)),
  'delete_ingredient removes row when no references'
);

-- Test 6: delete_ingredient hard-fails when referenced by stock_movement
-- Seed stock_movements directly via INSERT (avoids T6 record_stock_movement dependency).
-- Running as superuser bypasses RLS; the constraint we are testing is the
-- application-level guard inside delete_ingredient, not RLS.
create temp table _t_ing3 (id uuid);
insert into _t_ing3 select public.create_ingredient('Cà phê hạt', 'kg', null, null);
insert into public.stock_movements (ingredient_id, quantity_delta, reason, notes, created_by)
  values ((select id from _t_ing3), 5, 'purchase_received', 'seed', '11111111-1111-1111-1111-111111111111');
select throws_like(
  format('select public.delete_ingredient(%L::uuid)', (select id from _t_ing3)),
  '%giao dịch tồn kho%',
  'delete fails when stock_movements reference'
);

select * from finish();
rollback;
