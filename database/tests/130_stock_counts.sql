-- Phase 4.A — Stock counts RPC.
--
-- 3 assertions (top-level SELECT pattern):
--   1. count_correction delta = actual - theoretical_before
--   2. balance reflects count after correction
--   3. count with zero variance still emits delta=0 row

begin;
select plan(3);

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

create temp table _t_ing (id uuid);
create temp table _t_count (id uuid);

insert into _t_ing select public.create_ingredient('Count test', 'kg', null, null);

-- Seed +100 then count to 95 — delta should be -5
select public.record_stock_movement((select id from _t_ing), 100, 'purchase_received', null);
insert into _t_count
  select public.record_stock_count((select id from _t_ing), 95, 'first count');

-- Test 1: delta = -5
select is(
  (select quantity_delta from public.stock_movements where id = (select id from _t_count)),
  (-5)::numeric,
  'count_correction delta = actual - theoretical'
);

-- Test 2: balance reflects count
select is(
  public.stock_balance_now((select id from _t_ing)),
  95::numeric,
  'balance reflects count'
);

-- Test 3: re-count at same value emits delta=0 row
create temp table _t_count2 (id uuid);
insert into _t_count2
  select public.record_stock_count((select id from _t_ing), 95, 'second count, no change');
select is(
  (select quantity_delta from public.stock_movements where id = (select id from _t_count2)),
  0::numeric,
  'count_correction emits delta=0 when no variance'
);

select * from finish();
rollback;
