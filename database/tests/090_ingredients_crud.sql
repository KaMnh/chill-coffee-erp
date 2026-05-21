-- Phase 4.A — Ingredients CRUD RPCs.
--
-- 7 assertions:
--   1. create_ingredient returns a uuid; row exists with trimmed name  (2 assertions: ok + is)
--   2. Duplicate name throws unique violation
--   3. Blank name throws CHECK constraint violation
--   4. update_ingredient can soft-delete (is_active = false)
--   5. delete_ingredient succeeds when no references
--   6. delete_ingredient hard-fails when stock_movement references

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

-- Test 1: create_ingredient returns a uuid; name trimmed
do $$
declare v_id uuid;
begin
  v_id := public.create_ingredient('  Sữa tươi  ', 'L', 5, 'Carton 1L');
  perform ok(v_id is not null, 'create_ingredient returns uuid');
  perform is(
    (select name from public.ingredients where id = v_id),
    'Sữa tươi',
    'name stored trimmed'
  );
end $$;

-- Test 2: Duplicate name throws
select throws_ok(
  $$ select public.create_ingredient('Sữa tươi', 'L', null, null) $$,
  '23505',  -- unique_violation
  null,
  'duplicate ingredient name rejected'
);

-- Test 3: Blank name throws CHECK
select throws_ok(
  $$ select public.create_ingredient('   ', 'L', null, null) $$,
  '23514',  -- check_violation
  null,
  'blank ingredient name rejected by CHECK'
);

-- Test 4: update_ingredient sets is_active=false
do $$
declare v_id uuid;
begin
  select id into v_id from public.ingredients where name = 'Sữa tươi';
  perform public.update_ingredient(v_id, 'Sữa tươi', 'L', 5, null, false);
  perform is(
    (select is_active from public.ingredients where id = v_id),
    false,
    'update_ingredient sets is_active=false'
  );
end $$;

-- Test 5: delete_ingredient succeeds when no references
do $$
declare v_id uuid;
begin
  v_id := public.create_ingredient('Đường', 'kg', null, null);
  perform public.delete_ingredient(v_id);
  perform ok(
    not exists (select 1 from public.ingredients where id = v_id),
    'delete_ingredient removes row when no references'
  );
end $$;

-- Test 6: delete_ingredient hard-fails when referenced by stock_movement
do $$
declare v_id uuid;
begin
  v_id := public.create_ingredient('Cà phê hạt', 'kg', null, null);
  perform public.record_stock_movement(v_id, 5, 'purchase_received', 'seed');
  perform throws_like(
    format('select public.delete_ingredient(%L::uuid)', v_id),
    '%giao dịch tồn kho%',
    'delete fails when stock_movements reference'
  );
end $$;

select * from finish();
rollback;
