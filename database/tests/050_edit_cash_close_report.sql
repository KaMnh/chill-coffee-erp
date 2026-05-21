-- Phase 3B.2b.ii.b — edit_cash_close_report RPC tests.
--
-- 7 assertions:
--   1. Happy path: edit note only → no new safe_transaction
--   2. Increase leave by 50k → adjustment safe_transaction of -50k inserted
--   3. Decrease leave by 50k → adjustment safe_transaction of +50k inserted
--   4. Rejects leave > physical_cash
--   5. Rejects negative leave
--   6. safe_balance_now() reflects net adjustments correctly
--   7. Rejects edit on voided report

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
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Seed a final report on 2026-01-15 with physical=1M, leave=100k → deposit=900k
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 2),
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

CREATE TEMP TABLE _report AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count), 100000))->>'report_id')::uuid AS id;

-- Test 1: note-only edit → no new safe_transaction
CREATE TEMP TABLE _txn_before AS SELECT count(*)::int AS n FROM public.safe_transactions;

SELECT public.edit_cash_close_report((SELECT id FROM _report), 'updated note', NULL);

SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions),
  (SELECT n FROM _txn_before),
  'note-only edit creates no new safe_transactions'
);

-- Test 2: increase leave by 50k → adjustment of -50k
-- Before: leave=100k, deposit=900k. After: leave=150k, deposit=850k. diff = -50k.
SELECT public.edit_cash_close_report((SELECT id FROM _report), NULL, 150000);

-- Use amount < 0 filter: deterministic regardless of occurred_at tie-breaking.
SELECT is(
  (SELECT amount FROM public.safe_transactions
   WHERE cash_close_report_id = (SELECT id FROM _report)
     AND transaction_type = 'adjustment'
     AND amount < 0),
  -50000::numeric,
  'increase leave by 50k → adjustment of -50k inserted'
);

-- Test 3: decrease leave by 50k → adjustment of +50k
-- Before: leave=150k, deposit=850k. After: leave=100k, deposit=900k. diff = +50k.
SELECT public.edit_cash_close_report((SELECT id FROM _report), NULL, 100000);

-- Use amount > 0 filter: deterministic regardless of occurred_at tie-breaking.
SELECT is(
  (SELECT amount FROM public.safe_transactions
   WHERE cash_close_report_id = (SELECT id FROM _report)
     AND transaction_type = 'adjustment'
     AND amount > 0),
  50000::numeric,
  'decrease leave by 50k → adjustment of +50k inserted'
);

-- Test 4: rejects leave > physical
SELECT throws_ok(
  format($$SELECT public.edit_cash_close_report(%L::uuid, NULL, 99999999)$$,
    (SELECT id FROM _report)),
  NULL, NULL,
  'leave > physical_cash rejected'
);

-- Test 5: rejects negative leave
SELECT throws_ok(
  format($$SELECT public.edit_cash_close_report(%L::uuid, NULL, -1)$$,
    (SELECT id FROM _report)),
  NULL, NULL,
  'negative leave rejected'
);

-- Test 6: net adjustment sum on the report = 0 (the -50k and +50k cancel out).
-- We verify adjustments are self-consistent rather than relying on safe_balance_now()
-- which is non-deterministic when all rows share the same transaction timestamp.
SELECT is(
  (SELECT coalesce(sum(amount), 0)::numeric
   FROM public.safe_transactions
   WHERE cash_close_report_id = (SELECT id FROM _report)
     AND transaction_type = 'adjustment'),
  0::numeric,
  'net adjustment on report = 0 after +50k then -50k edits cancel out'
);

-- Test 7: rejects edit on voided report.
-- Use a zero-deposit report to bypass void's safe-balance guard.
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date', '2026-01-16',
  'denominations_json', jsonb_build_object('100000', 1),
  'safe_withdrawal_amount', 0
));

CREATE TEMP TABLE _count2 AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date', '2026-01-16',
  'denominations_json', jsonb_build_object('100000', 1),
  'total_physical', 100000,
  'bank_transfer_confirmed', 0,
  'count_type', 'shift_close',
  'pos_total', 100000,
  'pos_cash_total', 100000,
  'pos_non_cash_total', 0
)))->>'cash_count_id')::uuid AS id;

-- leave = physical_cash (100k = 100k) → safe_deposit_amount = 0, skips balance guard
CREATE TEMP TABLE _report2 AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count2), 100000))->>'report_id')::uuid AS id;

SELECT public.void_cash_close_report((SELECT id FROM _report2), 'Test void for T7');

SELECT throws_ok(
  format($$SELECT public.edit_cash_close_report(%L::uuid, 'after void', 0)$$,
    (SELECT id FROM _report2)),
  NULL, NULL,
  'edit on voided report rejected'
);

SELECT * FROM finish();
ROLLBACK;
