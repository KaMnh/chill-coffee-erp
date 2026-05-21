-- Phase 4.A — Menu items CRUD RPCs.
--
-- 6 assertions total:
--   1a. create_menu_item returns uuid
--   1b. external_product_name preserved on storage
--   2.  nullable external_product_name accepted
--   3.  duplicate name raises unique_violation
--   4.  update can soft-delete
--   5.  delete hard-fails when active recipe references

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

-- Capture created id for re-use across tests
create temp table _t_menu (id uuid);

-- Test 1a: create_menu_item returns uuid
insert into _t_menu
  select public.create_menu_item('Cà phê đen đá M', 'Cafe den da M', null);
select ok((select id from _t_menu) is not null, 'create_menu_item returns uuid');

-- Test 1b: external_product_name preserved on storage
select is(
  (select external_product_name from public.menu_items where id = (select id from _t_menu)),
  'Cafe den da M',
  'external_product_name stored as-is (trimmed)'
);

-- Test 2: nullable external_product_name (1 assertion)
select ok(
  public.create_menu_item('No matcher', null, null) is not null,
  'nullable external_product_name accepted'
);

-- Test 3: duplicate name (1 assertion)
select throws_ok(
  $$ select public.create_menu_item('Cà phê đen đá M', null, null) $$,
  '23505',
  null,
  'duplicate menu_item name rejected'
);

-- Test 4: update soft-delete (1 assertion)
select public.update_menu_item(
  (select id from _t_menu),
  'Cà phê đen đá M',
  'Cafe den da M',
  null,
  false
);
select is(
  (select is_active from public.menu_items where id = (select id from _t_menu)),
  false,
  'update_menu_item soft-deletes via is_active=false'
);

-- Test 5: delete hard-fails when active recipe references (1 assertion)
-- Seed a recipe row directly (no dependency on upsert_recipe from T5).
insert into public.recipes (menu_item_id) values ((select id from _t_menu));
select throws_like(
  format('select public.delete_menu_item(%L::uuid)', (select id from _t_menu)),
  '%đang có công thức%',
  'delete_menu_item fails when recipe exists'
);

select * from finish();
rollback;
