-- Phase 3B.2b.ii.b — save_cash_count RPC tests.
--
-- 7 assertions:
--   1a. Happy path: lives_ok — RPC does not throw
--   1b. Happy path: exactly one cash_counts row inserted
--   2. Invalid denomination key "100" → raises
--   3. Denomination count > 10000 → raises
--   4. pos_total > 1B → raises (POS validation)
--   5. bank_transfer_confirmed = 0 accepted
--   6. count_type='shift_close' accepted

BEGIN;
SELECT plan(7);

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
  ('33333333-3333-3333-3333-333333333333', 'staff@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('33333333-3333-3333-3333-333333333333', 'Staff Test');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('33333333-3333-3333-3333-333333333333', 'staff_operator', 'active');

SELECT pg_temp.act_as('33333333-3333-3333-3333-333333333333');

-- Test 1: happy path → cash_counts row + cash_drawer_events snapshot
SELECT lives_ok(
  $$SELECT public.save_cash_count(jsonb_build_object(
      'business_date', '2026-01-15',
      'denominations_json', jsonb_build_object('100000', 5, '50000', 2),
      'total_physical', 600000,
      'bank_transfer_confirmed', 0,
      'count_type', 'spot_audit',
      'note', 'happy path test',
      'pos_total', 600000,
      'pos_cash_total', 600000,
      'pos_non_cash_total', 0
    ))$$,
  'save_cash_count happy path does not throw'
);

SELECT is(
  (SELECT count(*)::int FROM public.cash_counts WHERE business_date = '2026-01-15'),
  1,
  'exactly one cash_counts row inserted for the date'
);

-- Test 2: invalid denomination key '100' → raises
SELECT throws_ok(
  $$SELECT public.save_cash_count(jsonb_build_object(
      'business_date', '2026-01-15',
      'denominations_json', jsonb_build_object('100', 5),
      'total_physical', 500,
      'bank_transfer_confirmed', 0
    ))$$,
  NULL, NULL,
  'invalid denomination key "100" rejected'
);

-- Test 3: denomination count > 10000 → raises
SELECT throws_ok(
  $$SELECT public.save_cash_count(jsonb_build_object(
      'business_date', '2026-01-15',
      'denominations_json', jsonb_build_object('1000', 10001),
      'total_physical', 10001000,
      'bank_transfer_confirmed', 0
    ))$$,
  NULL, NULL,
  'denomination count > 10000 rejected'
);

-- Test 4: pos_total > 1B → raises (manual POS override validation)
SELECT throws_ok(
  $$SELECT public.save_cash_count(jsonb_build_object(
      'business_date', '2026-01-15',
      'denominations_json', jsonb_build_object('100000', 1),
      'total_physical', 100000,
      'bank_transfer_confirmed', 0,
      'pos_total', 1000000001
    ))$$,
  NULL, NULL,
  'pos_total > 1B rejected'
);

-- Test 5: bank_transfer_confirmed = 0 explicitly accepted
SELECT lives_ok(
  $$SELECT public.save_cash_count(jsonb_build_object(
      'business_date', '2026-01-16',
      'denominations_json', jsonb_build_object('100000', 1),
      'total_physical', 100000,
      'bank_transfer_confirmed', 0,
      'pos_total', 100000,
      'pos_cash_total', 100000,
      'pos_non_cash_total', 0
    ))$$,
  'bank_transfer_confirmed = 0 accepted'
);

-- Test 6: count_type='shift_close' accepted
SELECT lives_ok(
  $$SELECT public.save_cash_count(jsonb_build_object(
      'business_date', '2026-01-17',
      'denominations_json', jsonb_build_object('100000', 1),
      'total_physical', 100000,
      'bank_transfer_confirmed', 0,
      'count_type', 'shift_close',
      'pos_total', 100000,
      'pos_cash_total', 100000,
      'pos_non_cash_total', 0
    ))$$,
  'count_type=shift_close accepted'
);

SELECT * FROM finish();
ROLLBACK;
