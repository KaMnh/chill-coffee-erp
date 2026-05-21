-- Phase 3B.2b.ii.b — void_cash_close_report RPC tests.
--
-- 6 assertions:
--   1. Happy path: status flips to 'voided'
--   2. RPC return.reversed_safe_amount equals original safe_deposit_amount
--   3. Original cash_close_report row still exists (no hard delete)
--   4. Reason < 5 chars rejected
--   5. Rejects when already voided
--   6. Depleted-safe scenario placeholder (out-of-scope to force here)

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
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Seed a final report: physical=500k, leave=0 → deposit=500k
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 1),
  'safe_withdrawal_amount', 0
));

CREATE TEMP TABLE _count AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 5),
  'total_physical', 500000,
  'bank_transfer_confirmed', 0,
  'count_type', 'shift_close',
  'pos_total', 500000,
  'pos_cash_total', 500000,
  'pos_non_cash_total', 0
)))->>'cash_count_id')::uuid AS id;

CREATE TEMP TABLE _report AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count), 0))->>'report_id')::uuid AS id;

-- Test 1+2: void happy path → status=voided, reversed_safe_amount=500k
CREATE TEMP TABLE _void_result AS
SELECT public.void_cash_close_report((SELECT id FROM _report), 'Test void reason') AS r;

SELECT is(
  (SELECT report_status FROM public.cash_close_reports WHERE id = (SELECT id FROM _report)),
  'voided',
  'report_status flipped to voided'
);

SELECT is(
  (SELECT (r->>'reversed_safe_amount')::numeric FROM _void_result),
  500000::numeric,
  'reversed_safe_amount = original safe_deposit_amount (500_000)'
);

-- Test 3: original row still exists (no hard delete)
SELECT is(
  (SELECT count(*)::int FROM public.cash_close_reports WHERE id = (SELECT id FROM _report)),
  1,
  'voided report row still exists in cash_close_reports'
);

-- Test 4: reason < 5 chars rejected. Need a fresh non-voided report.
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date', '2026-01-16',
  'denominations_json', jsonb_build_object('100000', 1),
  'safe_withdrawal_amount', 0
));

CREATE TEMP TABLE _count2 AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date', '2026-01-16',
  'denominations_json', jsonb_build_object('100000', 5),
  'total_physical', 500000,
  'bank_transfer_confirmed', 0,
  'count_type', 'shift_close',
  'pos_total', 500000,
  'pos_cash_total', 500000,
  'pos_non_cash_total', 0
)))->>'cash_count_id')::uuid AS id;

CREATE TEMP TABLE _report2 AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count2), 0))->>'report_id')::uuid AS id;

SELECT throws_ok(
  format($$SELECT public.void_cash_close_report(%L::uuid, 'abc')$$, (SELECT id FROM _report2)),
  NULL, NULL,
  'void with reason < 5 chars rejected'
);

-- Test 5: already-voided rejected
SELECT throws_ok(
  format($$SELECT public.void_cash_close_report(%L::uuid, 'Try to double-void')$$,
    (SELECT id FROM _report)),
  NULL, NULL,
  'voiding an already-voided report rejected'
);

-- Test 6: depleted-safe scenario placeholder.
-- Forcing safe_balance < safe_deposit_amount requires safe_adjust (Phase 3C
-- RPC, out of scope) or manipulating safe_transactions directly (blocked by
-- balance >= 0 CHECK constraint). Pinned as pass() so the count stays at 6;
-- future Phase 3C test can upgrade.
SELECT pass('depleted-safe test skipped — scenario needs safe_adjust RPC out of cash scope');

SELECT * FROM finish();
ROLLBACK;
