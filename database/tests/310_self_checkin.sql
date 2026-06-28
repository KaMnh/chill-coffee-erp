-- 310 — Employee self-check-in: check_in_self RPC, privilege lock-down,
-- fresh_anchor_ips, get_my_checkin_status, anchor owner-only RPCs,
-- employee_accounts(employee_id) unique invariant, and operational-table
-- RLS lockdown for the new `employee_self_service` role.
--
-- Runs on the throwaway DB (auth-mock + 001 + 002 + 003 + migrations).
-- See docs/superpowers/plans/2026-06-25-employee-login-self-checkin.md Task 4.

begin;
select plan(28);

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

-- -------------------------------------------------------------------------
-- Fixtures: users / accounts / employees
-- -------------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001', 'owner@test.local',    '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002', 'manager@test.local',  '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000003', 'staff@test.local',    '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000004', 'emp@test.local',      '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000005', 'unlinked@test.local', '', now(), '00000000-0000-0000-0000-000000000000');

insert into public.employees (id, name, hourly_rate) values
  ('e0000000-0000-0000-0000-000000000001', 'Nhân viên Self', 30000),
  ('e0000000-0000-0000-0000-000000000002', 'Nhân viên Staff', 30000);

insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null,                                       'owner',                 'active'),
  ('a0000000-0000-0000-0000-000000000002', null,                                       'manager',               'active'),
  ('a0000000-0000-0000-0000-000000000003', 'e0000000-0000-0000-0000-000000000002',     'staff_operator',        'active'),
  ('a0000000-0000-0000-0000-000000000004', 'e0000000-0000-0000-0000-000000000001',     'employee_self_service', 'active'),
  ('a0000000-0000-0000-0000-000000000005', null,                                       'employee_self_service', 'active');

-- Throwaway DB KHÔNG có row checkin_network (không seed 004) → gate check_in_self
-- mặc định 05:30 (flaky theo wall-clock). Đặt shift_start_time=00:00 để mở cổng.
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"shift_start_time":"00:00"}'::jsonb, false)
  on conflict (key) do update set value = public.app_settings.value || excluded.value;

-- =========================================================================
-- Group A — check_in_self stamps own employee/created_by/ip/ua, now(), idempotent
-- =========================================================================
create temp table _ci as
  select public.check_in_self(
    'a0000000-0000-0000-0000-000000000004'::uuid,
    '203.0.113.7'::inet,
    'Mozilla/5.0 (TestPhone)'
  ) as r;

-- 1: a checked_in row exists today for the linked employee
select ok(
  exists (
    select 1 from public.shift_assignments
    where employee_id = 'e0000000-0000-0000-0000-000000000001'
      and business_date = current_date and status = 'checked_in'
  ),
  'check_in_self creates a checked_in row today for the linked employee'
);

-- 2: created_by = p_auth_user_id
select is(
  (select created_by from public.shift_assignments
   where employee_id = 'e0000000-0000-0000-0000-000000000001'
     and business_date = current_date and status = 'checked_in'),
  'a0000000-0000-0000-0000-000000000004'::uuid,
  'created_by is the passed auth_user_id'
);

-- 3: check_in_ip stored
select is(
  (select check_in_ip from public.shift_assignments
   where employee_id = 'e0000000-0000-0000-0000-000000000001'
     and business_date = current_date and status = 'checked_in'),
  '203.0.113.7'::inet,
  'check_in_ip is stamped'
);

-- 4: check_in_user_agent stored
select is(
  (select check_in_user_agent from public.shift_assignments
   where employee_id = 'e0000000-0000-0000-0000-000000000001'
     and business_date = current_date and status = 'checked_in'),
  'Mozilla/5.0 (TestPhone)',
  'check_in_user_agent is stamped'
);

-- 5: check_in_at ~ now() (within a minute) and first call not already_checked_in
select ok(
  (select (r->>'already_checked_in')::boolean = false
     and ((r->>'check_in_at')::timestamptz) > now() - interval '1 minute'
   from _ci),
  'first check_in_self: server-side now(), already_checked_in=false'
);

-- 6: idempotent — 2nd call returns already_checked_in=true and only one row total
create temp table _ci2 as
  select public.check_in_self(
    'a0000000-0000-0000-0000-000000000004'::uuid,
    '203.0.113.9'::inet,
    'Mozilla/5.0 (OtherPhone)'
  ) as r;

select ok(
  (select (r->>'already_checked_in')::boolean from _ci2) = true
  and (select count(*)::int from public.shift_assignments
       where employee_id = 'e0000000-0000-0000-0000-000000000001'
         and business_date = current_date and status = 'checked_in') = 1,
  'second check_in_self is idempotent: already_checked_in=true, exactly one open row'
);

-- 7: unlinked account (active, employee_id null) → throws
select throws_like(
  $$ select public.check_in_self('a0000000-0000-0000-0000-000000000005'::uuid, null, null) $$,
  '%chưa gắn nhân viên%',
  'check_in_self on an unlinked account raises'
);

-- =========================================================================
-- Group B — privilege lock-down (exact signatures, N4)
-- =========================================================================
-- 8-10: check_in_self(uuid, inet, text)
select ok(
  not has_function_privilege('anon', 'public.check_in_self(uuid, inet, text)', 'execute'),
  'anon CANNOT execute check_in_self'
);
select ok(
  not has_function_privilege('authenticated', 'public.check_in_self(uuid, inet, text)', 'execute'),
  'authenticated CANNOT execute check_in_self'
);
select ok(
  has_function_privilege('service_role', 'public.check_in_self(uuid, inet, text)', 'execute'),
  'service_role CAN execute check_in_self'
);

-- 11-13: fresh_anchor_ips(numeric)
select ok(
  not has_function_privilege('anon', 'public.fresh_anchor_ips(numeric)', 'execute'),
  'anon CANNOT execute fresh_anchor_ips'
);
select ok(
  not has_function_privilege('authenticated', 'public.fresh_anchor_ips(numeric)', 'execute'),
  'authenticated CANNOT execute fresh_anchor_ips'
);
select ok(
  has_function_privilege('service_role', 'public.fresh_anchor_ips(numeric)', 'execute'),
  'service_role CAN execute fresh_anchor_ips'
);

-- record_shop_anchor_heartbeat(uuid, inet) — service-role-only (token-only route, no owner session)
select ok(
  not has_function_privilege('anon', 'public.record_shop_anchor_heartbeat(uuid, inet)', 'execute'),
  'anon CANNOT execute record_shop_anchor_heartbeat'
);
select ok(
  not has_function_privilege('authenticated', 'public.record_shop_anchor_heartbeat(uuid, inet)', 'execute'),
  'authenticated CANNOT execute record_shop_anchor_heartbeat'
);
select ok(
  has_function_privilege('service_role', 'public.record_shop_anchor_heartbeat(uuid, inet)', 'execute'),
  'service_role CAN execute record_shop_anchor_heartbeat'
);

-- =========================================================================
-- Group C — fresh_anchor_ips: fresh returned, stale + null-IP excluded
-- =========================================================================
insert into public.checkin_anchor (id, label, device_token_hash, current_public_ip, last_heartbeat_at, is_active) values
  ('c0000000-0000-0000-0000-000000000001', 'POS fresh', repeat('a', 64), '198.51.100.10'::inet, now(),                    true),
  ('c0000000-0000-0000-0000-000000000002', 'POS stale', repeat('b', 64), '198.51.100.20'::inet, now() - interval '13 hours', true),
  ('c0000000-0000-0000-0000-000000000003', 'POS no-ip', repeat('c', 64), null,                  now(),                    true);

-- 14: fresh anchor IP is returned
select ok(
  '198.51.100.10' in (select public.fresh_anchor_ips(12)),
  'fresh_anchor_ips returns a fresh anchor IP'
);

-- 15: stale + null-IP anchors are excluded
select ok(
  '198.51.100.20' not in (select public.fresh_anchor_ips(12))
  and (select count(*)::int from public.fresh_anchor_ips(12)) = 1,
  'fresh_anchor_ips excludes stale and null-IP anchors'
);

-- =========================================================================
-- Group D — get_my_checkin_status returns caller status
-- =========================================================================
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');

-- 16: caller already checked in today (from Group A), correct name
select ok(
  (select (public.get_my_checkin_status()->>'checked_in_today')::boolean) = true
  and (select public.get_my_checkin_status()->>'employee_name') = 'Nhân viên Self',
  'get_my_checkin_status reports the caller status and name'
);

-- =========================================================================
-- Group E — anchor RPCs owner-only + heartbeat + config guard
-- =========================================================================
-- 17: manager cannot add an anchor (owner-only)
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
select throws_like(
  format($$ select public.add_shop_anchor('Trộm', %L) $$, repeat('d', 64)),
  '%quyền%',
  'manager CANNOT add_shop_anchor (owner-only)'
);

-- 18: owner heartbeat stamps IP + last_heartbeat_at
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
create temp table _hb as
  select public.record_shop_anchor_heartbeat(
    'c0000000-0000-0000-0000-000000000002'::uuid, '198.51.100.99'::inet
  ) as r;
select ok(
  (select current_public_ip from public.checkin_anchor
   where id = 'c0000000-0000-0000-0000-000000000002') = '198.51.100.99'::inet
  and (select last_heartbeat_at from public.checkin_anchor
       where id = 'c0000000-0000-0000-0000-000000000002') > now() - interval '1 minute',
  'record_shop_anchor_heartbeat stamps current_public_ip and last_heartbeat_at'
);

-- 19: update_checkin_network_config cannot enable without any anchor IP
-- Remove every anchor IP first so the guard trips.
update public.checkin_anchor set current_public_ip = null;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');
select throws_like(
  $$ select public.update_checkin_network_config(
       '{"enabled": true, "reject_message": "x", "grace_hours": 12}'::jsonb) $$,
  '%IP%',
  'update_checkin_network_config cannot enable the gate with no anchor IP'
);

-- =========================================================================
-- Group F — employee_accounts(employee_id) unique blocks a 2nd link
-- =========================================================================
-- 20: linking a second account to employee e...0001 (already linked) → unique violation
select throws_ok(
  $$ insert into public.employee_accounts (auth_user_id, employee_id, role, status)
     values ('a0000000-0000-0000-0000-000000000001'::uuid,
             'e0000000-0000-0000-0000-000000000001'::uuid,
             'employee_self_service', 'active') $$,
  '23505',
  null,
  'employee_accounts(employee_id) unique blocks a second link to one employee'
);

-- =========================================================================
-- Group G — operational-table RLS lockdown (C5/R5)
-- =========================================================================
-- Seed one row in each operational table as superuser (RLS does not apply to
-- the table owner / superuser, so direct inserts are fine here).
insert into public.ingredients (id, name, unit) values
  ('11111111-aaaa-0000-0000-000000000001', 'RLS Ing', 'kg');
insert into public.menu_items (id, name) values
  ('11111111-aaaa-0000-0000-000000000002', 'RLS Menu');
insert into public.recipes (id, menu_item_id, is_active) values
  ('11111111-aaaa-0000-0000-000000000003', '11111111-aaaa-0000-0000-000000000002', true);
insert into public.recipe_items (recipe_id, ingredient_id, quantity) values
  ('11111111-aaaa-0000-0000-000000000003', '11111111-aaaa-0000-0000-000000000001', 1);
insert into public.stock_movements (ingredient_id, quantity_delta, reason) values
  ('11111111-aaaa-0000-0000-000000000001', 5, 'purchase_received');

-- employee_self_service must see 0 rows from all five operational tables.
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');
set local role authenticated;

-- 21: ingredients
select is(
  (select count(*)::int from public.ingredients), 0,
  'employee_self_service sees 0 ingredients'
);
-- 22: menu_items
select is(
  (select count(*)::int from public.menu_items), 0,
  'employee_self_service sees 0 menu_items'
);
-- 23: recipes
select is(
  (select count(*)::int from public.recipes), 0,
  'employee_self_service sees 0 recipes'
);
-- 24: recipe_items + stock_movements both locked down
select is(
  (select count(*)::int from public.recipe_items)
    + (select count(*)::int from public.stock_movements),
  0,
  'employee_self_service sees 0 recipe_items and 0 stock_movements'
);

-- 25: a staff role still reads operational data (> 0)
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
set local role authenticated;
select ok(
  (select count(*)::int from public.ingredients) > 0,
  'staff_operator still reads operational data (ingredients > 0)'
);

reset role;
select * from finish();
rollback;
