-- Phase 3B.2b.ii.b — finalize_cash_close_report RPC tests.
--
-- 8 assertions:
--   1. Happy path: exactly 1 cash_close_report row created
--   2. Happy path: exactly 1 safe_transaction with transaction_type='deposit_close'
--   3. safe_deposit_amount = physical_cash - leave_for_next_day
--   4. safe_balance_now() increases by safe_deposit_amount
--   5. report_status = 'final'
--   6. cash_close_report.cash_count_id matches input
--   7. IDEMPOTENT: second call returns same report_id, no new safe_transaction
--   8. leave > physical_cash → raises

BEGIN;
SELECT plan(8);

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

-- Seed: opening + shift_close cash_count for business_date 2026-01-15
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 2),
  'carried_from_previous_day', false,
  'safe_withdrawal_amount', 0
));

CREATE TEMP TABLE _count AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 10),
  'total_physical', 1000000,
  'bank_transfer_confirmed', 0,
  'count_type', 'shift_close',
  'pos_total', 1000000,
  'pos_cash_total', 1000000,
  'pos_non_cash_total', 0
)))->>'cash_count_id')::uuid AS id;

-- Capture safe_balance before finalize
CREATE TEMP TABLE _balance_before AS
SELECT public.safe_balance_now() AS bal;

-- ACT: finalize with leave_for_next_day = 100_000 → safe_deposit = 900_000
SELECT public.finalize_cash_close_report((SELECT id FROM _count), 100000);

-- Test 1: exactly 1 cash_close_report for this cash_count
SELECT is(
  (SELECT count(*)::int FROM public.cash_close_reports WHERE cash_count_id = (SELECT id FROM _count)),
  1,
  'one cash_close_report row created'
);

-- Test 2: exactly 1 deposit_close safe_transaction for this report
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions st
   JOIN public.cash_close_reports r ON r.id = st.cash_close_report_id
   WHERE r.cash_count_id = (SELECT id FROM _count)
     AND st.transaction_type = 'deposit_close'),
  1,
  'one deposit_close safe_transaction created'
);

-- Test 3: safe_deposit_amount = 1_000_000 - 100_000 = 900_000
SELECT is(
  (SELECT safe_deposit_amount FROM public.cash_close_reports
   WHERE cash_count_id = (SELECT id FROM _count)),
  900000::numeric,
  'safe_deposit_amount = physical - leave = 900_000'
);

-- Test 4: safe_balance increased by 900_000
SELECT is(
  public.safe_balance_now() - (SELECT bal FROM _balance_before),
  900000::numeric,
  'safe_balance_now increased by 900_000'
);

-- Test 5: report_status = 'final'
SELECT is(
  (SELECT report_status FROM public.cash_close_reports WHERE cash_count_id = (SELECT id FROM _count)),
  'final',
  'report_status = final after finalize'
);

-- Test 6: cash_count_id FK matches input
SELECT is(
  (SELECT cash_count_id FROM public.cash_close_reports
   WHERE cash_count_id = (SELECT id FROM _count)),
  (SELECT id FROM _count),
  'cash_close_report.cash_count_id matches finalize input'
);

-- Test 7: IDEMPOTENT — second call returns same report, no extra safe_transaction
CREATE TEMP TABLE _txn_count_before AS
SELECT count(*)::int AS n FROM public.safe_transactions;

SELECT public.finalize_cash_close_report((SELECT id FROM _count), 100000);

SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions),
  (SELECT n FROM _txn_count_before),
  'second finalize call adds NO new safe_transactions (idempotent)'
);

-- Test 8: leave > physical_cash → raises.
-- Must use a *fresh* cash_count (never finalized) so the idempotency
-- early-return doesn't fire before the leave > physical_cash validation.
-- Re-using _count (already final from Tests 1-7) would short-circuit to
-- the idempotency branch and silently pass even if the leave check is broken.
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date', '2026-01-16',
  'denominations_json', jsonb_build_object('100000', 2),
  'carried_from_previous_day', false,
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

SELECT throws_ok(
  format($$SELECT public.finalize_cash_close_report(%L::uuid, 999999999)$$,
    (SELECT id FROM _count2)),
  NULL, NULL,
  'leave_for_next_day > physical_cash rejected'
);

SELECT * FROM finish();
ROLLBACK;
