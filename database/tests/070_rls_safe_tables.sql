-- Phase 3B.2b.ii.b — RLS tests for safe_* tables (owner-only read).
--
-- 6 assertions:
--   1. Owner can SELECT from safe_transactions → rows returned
--   2. Manager SELECT from safe_transactions → 0 rows (RLS filters)
--   3. Staff_operator SELECT from safe_transactions → 0 rows
--   4. Manager direct INSERT into safe_transactions → policy violation
--   5. Owner can SELECT from safe_counts; manager cannot
--   6. Owner can SELECT from safe_attachments; manager cannot

BEGIN;
SELECT plan(6);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
END;
$$ LANGUAGE plpgsql;

-- Fixtures
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'manager@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'staff@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Owner'),
  ('22222222-2222-2222-2222-222222222222', 'Manager'),
  ('33333333-3333-3333-3333-333333333333', 'Staff');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'staff_operator', 'active');

-- Seed a safe_transaction so SELECTs have something to filter.
-- This INSERT runs as superuser (currently postgres), bypassing RLS.
INSERT INTO public.safe_transactions (transaction_type, amount, balance_after, description)
VALUES ('initial_setup', 1000000, 1000000, 'seed for RLS test');

-- Test 1: Owner SELECT → 1 row
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions),
  1,
  'owner can SELECT from safe_transactions (1 row visible)'
);

-- Test 2: Manager SELECT → 0 rows
RESET ROLE;
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions),
  0,
  'manager SELECT from safe_transactions returns 0 rows (RLS filter)'
);

-- Test 3: Staff SELECT → 0 rows
RESET ROLE;
SELECT pg_temp.act_as('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions),
  0,
  'staff_operator SELECT from safe_transactions returns 0 rows'
);

-- Test 4: Manager direct INSERT → policy violation
RESET ROLE;
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$INSERT INTO public.safe_transactions (transaction_type, amount, balance_after, description)
    VALUES ('initial_setup', 1, 1, 'manager direct insert')$$,
  NULL, NULL,
  'manager direct INSERT to safe_transactions blocked by RLS'
);

-- Test 5: safe_counts owner-only. Insert as superuser, then verify role-based visibility.
RESET ROLE;
INSERT INTO public.safe_counts (denominations_json, total_physical, expected_balance, difference)
VALUES ('{}'::jsonb, 0, 0, 0);

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _owner_safe_counts AS SELECT count(*)::int AS n FROM public.safe_counts;
RESET ROLE;

SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _manager_safe_counts AS SELECT count(*)::int AS n FROM public.safe_counts;
RESET ROLE;

SELECT is(
  (SELECT n FROM _owner_safe_counts) - (SELECT n FROM _manager_safe_counts),
  1,
  'owner sees safe_counts row; manager sees 0 (diff = 1)'
);

-- Test 6: safe_attachments owner-only. Need a safe_transaction first (FK).
INSERT INTO public.safe_attachments (
  transaction_id, storage_path, file_name, mime_type, file_size
) VALUES (
  (SELECT id FROM public.safe_transactions LIMIT 1),
  'safe-receipts/test/x.png',
  'x.png',
  'image/png',
  1024
);

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _owner_attach AS SELECT count(*)::int AS n FROM public.safe_attachments;
RESET ROLE;

SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE _manager_attach AS SELECT count(*)::int AS n FROM public.safe_attachments;
RESET ROLE;

SELECT is(
  (SELECT n FROM _owner_attach) - (SELECT n FROM _manager_attach),
  1,
  'owner sees safe_attachments row; manager sees 0 (diff = 1)'
);

SELECT * FROM finish();
ROLLBACK;
