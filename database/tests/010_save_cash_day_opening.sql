-- Phase 3B.2b.ii.b — save_cash_day_opening RPC tests.
--
-- 4 assertions:
--   1. Owner happy path: RPC does not throw (lives_ok)
--   2. Owner happy path verify: opening_total = sum(denom × count)
--   3. Manager allowed on a fresh date (lives_ok)
--   4. Staff_operator rejected (throws_ok)
--
-- Pattern: BEGIN ... pg_temp.act_as(uuid) ... assertions ... ROLLBACK.

BEGIN;
SELECT plan(4);

-- ────────────────────────────────────────────────────────────────────
-- Helper: switch JWT context for the rest of the transaction.
-- ────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────
-- Fixtures: 1 auth user + profile + employee_account per role we need.
-- We insert directly into auth.users with the minimal required columns
-- (id, email, encrypted_password, email_confirmed_at, instance_id) —
-- this is safe because the whole transaction ROLLBACKs at the end, so
-- no real Auth state persists. The RLS app_role() reads role from
-- employee_accounts.role by matching auth_user_id = auth.uid().
-- ────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id)
  VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'manager@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'staff@test.local', '', now(), '00000000-0000-0000-0000-000000000000');

INSERT INTO public.profiles (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Owner Test'),
  ('22222222-2222-2222-2222-222222222222', 'Manager Test'),
  ('33333333-3333-3333-3333-333333333333', 'Staff Test');

INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'staff_operator', 'active');

-- ────────────────────────────────────────────────────────────────────
-- Test 1: Owner happy path → row inserted with correct opening_total.
--   200k × 5 + 100k × 3 = 1.300.000
-- ────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

SELECT lives_ok(
  $$SELECT public.save_cash_day_opening(jsonb_build_object(
      'business_date', '2026-01-15',
      'denominations_json', jsonb_build_object('200000', 5, '100000', 3),
      'carried_from_previous_day', false,
      'safe_withdrawal_amount', 0
    ))$$,
  'owner save_cash_day_opening happy path does not throw'
);

SELECT is(
  (SELECT opening_total FROM public.cash_day_openings WHERE business_date = '2026-01-15'),
  1300000::numeric,
  'opening_total = 1.300.000 (5×200k + 3×100k)'
);

-- ────────────────────────────────────────────────────────────────────
-- Test 2: Manager allowed on a fresh date (manager hasn't been used yet,
--   and the existing row was created by owner, so update path requires
--   owner. We use a fresh business_date for the manager insert test).
-- ────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');

SELECT lives_ok(
  $$SELECT public.save_cash_day_opening(jsonb_build_object(
      'business_date', '2026-01-16',
      'denominations_json', jsonb_build_object('100000', 5),
      'carried_from_previous_day', false,
      'safe_withdrawal_amount', 0
    ))$$,
  'manager can save_cash_day_opening for a fresh date'
);

-- ────────────────────────────────────────────────────────────────────
-- Test 3: Staff_operator rejected.
-- ────────────────────────────────────────────────────────────────────
SELECT pg_temp.act_as('33333333-3333-3333-3333-333333333333');

SELECT throws_ok(
  $$SELECT public.save_cash_day_opening(jsonb_build_object(
      'business_date', '2026-01-17',
      'denominations_json', jsonb_build_object('100000', 1),
      'carried_from_previous_day', false,
      'safe_withdrawal_amount', 0
    ))$$,
  NULL, -- any SQLSTATE
  NULL, -- any message substring; we just need it to raise
  'staff_operator rejected from save_cash_day_opening'
);

SELECT * FROM finish();
ROLLBACK;
