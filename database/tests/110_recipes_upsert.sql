-- Phase 4.A — Recipes upsert + delete + lookups.
--
-- 6 assertions (top-level SELECT pattern):
--   1. upsert_recipe inserts when no recipe exists (returns uuid)
--   2. recipe_items count = 1 after insert
--   3. Second upsert returns same recipe_id (update path, atomic replace)
--   4. recipe_items count = 2 after update (atomic replace)
--   5. zero or negative quantity raises Vietnamese error
--   6. delete_recipe cascades recipe_items

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

-- Setup fixtures: one menu_item, two ingredients
create temp table _t_menu (id uuid);
create temp table _t_ing1 (id uuid);
create temp table _t_ing2 (id uuid);
create temp table _t_recipe (id uuid);

insert into _t_menu  select public.create_menu_item('Cà phê sữa đá', 'Cafe sua da', null);
insert into _t_ing1  select public.create_ingredient('Cà phê hạt', 'g', null, null);
insert into _t_ing2  select public.create_ingredient('Sữa đặc', 'ml', null, null);

-- Test 1: insert path returns uuid
insert into _t_recipe
  select public.upsert_recipe(
    (select id from _t_menu),
    true,
    'v1',
    jsonb_build_array(
      jsonb_build_object('ingredient_id', (select id from _t_ing1), 'quantity', 18)
    )
  );
select ok((select id from _t_recipe) is not null, 'upsert_recipe returns uuid on insert');

-- Test 2: recipe_items count = 1 after insert
select is(
  (select count(*)::int from public.recipe_items where recipe_id = (select id from _t_recipe)),
  1,
  'recipe_items count = 1 after insert'
);

-- Test 3: second upsert with same menu_item_id returns same recipe id
-- (compare to original via a separate temp table)
create temp table _t_recipe_v2 (id uuid);
insert into _t_recipe_v2
  select public.upsert_recipe(
    (select id from _t_menu),
    true,
    'v2',
    jsonb_build_array(
      jsonb_build_object('ingredient_id', (select id from _t_ing1), 'quantity', 20),
      jsonb_build_object('ingredient_id', (select id from _t_ing2), 'quantity', 25)
    )
  );
select is(
  (select id from _t_recipe_v2),
  (select id from _t_recipe),
  'second upsert returns same recipe id (update path)'
);

-- Test 4: recipe_items replaced atomically (count = 2)
select is(
  (select count(*)::int from public.recipe_items where recipe_id = (select id from _t_recipe)),
  2,
  'recipe_items replaced atomically (count = 2)'
);

-- Test 5: negative quantity rejected
-- Need a separate menu_item to avoid conflicts with the existing recipe.
create temp table _t_menu_bad (id uuid);
create temp table _t_ing_bad (id uuid);
insert into _t_menu_bad select public.create_menu_item('Bad recipe target', null, null);
insert into _t_ing_bad  select public.create_ingredient('Bad ing', 'g', null, null);

select throws_like(
  format(
    $sql$select public.upsert_recipe(%L::uuid, true, null, %L::jsonb)$sql$,
    (select id from _t_menu_bad),
    jsonb_build_array(jsonb_build_object('ingredient_id', (select id from _t_ing_bad), 'quantity', -5))::text
  ),
  '%lớn hơn 0%',
  'upsert with quantity <= 0 raises Vietnamese error'
);

-- Test 6: delete cascades recipe_items
create temp table _t_menu_del (id uuid);
create temp table _t_ing_del (id uuid);
create temp table _t_recipe_del (id uuid);
insert into _t_menu_del   select public.create_menu_item('To be deleted', null, null);
insert into _t_ing_del    select public.create_ingredient('Del ing', 'g', null, null);
insert into _t_recipe_del select public.upsert_recipe(
  (select id from _t_menu_del),
  true, null,
  jsonb_build_array(jsonb_build_object('ingredient_id', (select id from _t_ing_del), 'quantity', 5))
);

select public.delete_recipe((select id from _t_recipe_del));

select ok(
  not exists (select 1 from public.recipe_items where recipe_id = (select id from _t_recipe_del)),
  'delete_recipe cascades recipe_items'
);

select * from finish();
rollback;
