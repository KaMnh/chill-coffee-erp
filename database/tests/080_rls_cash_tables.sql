-- Phase 3B.2b.ii.b — RLS tests for cash_* tables (role gradients).
--
-- 6 assertions:
--   1. Staff_operator SELECT cash_day_openings → works
--   2. Staff_operator INSERT cash_day_openings → policy violation
--   3. Manager INSERT cash_day_openings → works
--   4. Staff_operator INSERT cash_counts → works (staff-all policy)
--   5. Staff_operator SELECT cash_close_reports → works
--   6. Staff_operator UPDATE cash_close_reports → policy violation

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

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('22222222-2222-2222-2222-222222222222', 'manager@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'staff@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Manager'),
  ('33333333-3333-3333-3333-333333333333', 'Staff');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('22222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'staff_operator', 'active');

-- Seed a cash_day_opening + cash_close_report as superuser for SELECT tests
INSERT INTO public.cash_day_openings (business_date, denominations_json, opening_total)
VALUES ('2026-01-15', '{}'::jsonb, 100000);

INSERT INTO public.cash_counts (business_date, count_type, denominations_json, total_physical)
VALUES ('2026-01-15', 'shift_close', '{}'::jsonb, 500000);

INSERT INTO public.cash_close_reports (
  business_date, cash_count_id, physical_cash, report_status
)
SELECT '2026-01-15', id, 500000, 'final'
FROM public.cash_counts WHERE business_date = '2026-01-15' LIMIT 1;

-- Test 1: Staff SELECT cash_day_openings → works (≥1 row visible)
SELECT pg_temp.act_as('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.cash_day_openings),
  '>=',
  1,
  'staff_operator can SELECT from cash_day_openings'
);

-- Test 2: Staff INSERT cash_day_openings → policy violation
SELECT throws_ok(
  $$INSERT INTO public.cash_day_openings (business_date, opening_total)
    VALUES ('2026-01-20', 100000)$$,
  NULL, NULL,
  'staff_operator direct INSERT to cash_day_openings blocked by RLS'
);

-- Test 3: Manager INSERT cash_day_openings → works
RESET ROLE;
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.cash_day_openings (business_date, opening_total)
    VALUES ('2026-01-21', 100000)$$,
  'manager direct INSERT to cash_day_openings allowed'
);

-- Test 4: Staff INSERT cash_counts → works (staff-all policy)
RESET ROLE;
SELECT pg_temp.act_as('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$INSERT INTO public.cash_counts (business_date, count_type, denominations_json, total_physical)
    VALUES ('2026-01-22', 'spot_audit', '{}'::jsonb, 0)$$,
  'staff_operator INSERT into cash_counts allowed (staff-all policy)'
);

-- Test 5: Staff SELECT cash_close_reports → works
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.cash_close_reports),
  '>=',
  1,
  'staff_operator can SELECT from cash_close_reports'
);

-- Test 6: Staff UPDATE cash_close_reports → 0 rows affected (RLS USING filters all)
-- The cash_reports_admin_update policy uses USING(app_is_owner_manager()), so for
-- staff the UPDATE silently affects 0 rows (no error, rows just filtered out).
-- We run the UPDATE then verify the note column is still NULL (unchanged).
UPDATE public.cash_close_reports SET note = 'staff edit' WHERE 1=1;

SELECT is(
  (SELECT count(*)::int FROM public.cash_close_reports WHERE note = 'staff edit'),
  0,
  'staff_operator UPDATE on cash_close_reports affects 0 rows (RLS USING filter)'
);

SELECT * FROM finish();
ROLLBACK;
