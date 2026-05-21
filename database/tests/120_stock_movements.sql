-- Phase 4.A — Stock movements RPC.
--
-- 5 assertions (top-level SELECT pattern):
--   1. record_stock_movement returns uuid; stock_balance_now reflects delta
--   2. multiple movements sum correctly
--   3. sign validation: purchase_received with negative qty raises
--   4. system-only reasons rejected (sale_theoretical)
--   5. audit_log entry written

begin;
select plan(5);

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
create temp table _t_mvmt (id uuid);

insert into _t_ing select public.create_ingredient('Milk T6', 'L', null, null);

-- Test 1: purchase_received +100; record_stock_movement returns uuid;
-- stock_balance_now reflects delta (combined assertion via is comparing balance)
insert into _t_mvmt
  select public.record_stock_movement((select id from _t_ing), 100, 'purchase_received', 'Initial stock');
select is(
  public.stock_balance_now((select id from _t_ing)),
  100::numeric,
  'balance = 100 after purchase_received +100'
);

-- Test 2: multiple movements sum correctly
select public.record_stock_movement((select id from _t_ing), 50, 'manual_adjustment_in', 'Found extra');
select public.record_stock_movement((select id from _t_ing), -20, 'waste', 'Spilled');
select is(
  public.stock_balance_now((select id from _t_ing)),
  130::numeric,
  'balance = 130 after 100 +50 -20'
);

-- Test 3: sign validation — purchase_received with negative qty rejected
create temp table _t_ing_sign (id uuid);
insert into _t_ing_sign select public.create_ingredient('Sign test ing', 'g', null, null);
select throws_like(
  format('select public.record_stock_movement(%L::uuid, -5, ''purchase_received'', null)',
         (select id from _t_ing_sign)),
  '%phải lớn hơn 0%',
  'negative qty with purchase_received raises Vietnamese error'
);

-- Test 4: system-only reasons rejected (sale_theoretical)
create temp table _t_ing_sys (id uuid);
insert into _t_ing_sys select public.create_ingredient('System reason test', 'g', null, null);
select throws_like(
  format('select public.record_stock_movement(%L::uuid, -5, ''sale_theoretical'', null)',
         (select id from _t_ing_sys)),
  '%Lý do không hợp lệ%',
  'sale_theoretical rejected from RPC (trigger-only)'
);

-- Test 5: audit_log entry written for stock_movement_recorded
select is(
  (select count(*)::int from public.audit_log
   where action = 'stock_movement_recorded'
     and (diff_json->>'movement_id')::uuid = (select id from _t_mvmt)),
  1,
  'audit_log row written for stock_movement'
);

select * from finish();
rollback;
