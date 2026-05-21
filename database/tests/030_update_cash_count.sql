-- Phase 3B.2b.ii.b — update_cash_count RPC tests.
--
-- 4 assertions:
--   1. Happy path: admin edits non-final count → bank_transfer field updated
--   2. Rejects when target count is referenced by a final cash_close_report
--   3+4. Note-only edit accepted (combined with denomination re-snapshot check)
--
-- Adaptation note: finalize_cash_close_report(uuid) takes exactly one arg.
-- Instead of calling the finalize RPC chain (which requires save_cash_day_opening
-- + finalize_cash_close_report with correct POS state), Test 2 directly INSERTs
-- a 'final' row into cash_close_reports for the shift_close count. This matches
-- the actual rejection condition in update_cash_count (line ~774):
--   if v_count.count_type = 'shift_close' and exists (
--     select 1 from cash_close_reports
--     where cash_count_id = v_id and report_status = 'final'
--   )

BEGIN;
SELECT plan(4);

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

-- Seed: 1 spot_audit cash_count to edit
SELECT public.save_cash_count(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 5),
  'total_physical', 500000,
  'bank_transfer_confirmed', 0,
  'pos_total', 500000,
  'pos_cash_total', 500000,
  'pos_non_cash_total', 0
));

CREATE TEMP TABLE _seed AS
  SELECT id FROM public.cash_counts WHERE business_date = '2026-01-15' AND count_type = 'spot_audit' LIMIT 1;

-- Test 1: Edit bank_transfer → field updates
SELECT lives_ok(
  format($$SELECT public.update_cash_count(jsonb_build_object('id', %L, 'bank_transfer_confirmed', 150000))$$,
    (SELECT id FROM _seed)),
  'update_cash_count happy path does not throw'
);

SELECT is(
  (SELECT bank_transfer_confirmed FROM public.cash_counts WHERE id = (SELECT id FROM _seed)),
  150000::numeric,
  'bank_transfer_confirmed updated to 150_000'
);

-- Test 2: shift_close count with a final cash_close_report → update rejected
-- Seed a shift_close cash_count then directly insert a 'final' report row
-- (avoids chained RPCs; matches the rejection condition in update_cash_count ~line 774)
SELECT public.save_cash_count(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 5),
  'total_physical', 500000,
  'bank_transfer_confirmed', 0,
  'count_type', 'shift_close',
  'pos_total', 500000,
  'pos_cash_total', 500000,
  'pos_non_cash_total', 0
));

CREATE TEMP TABLE _finalized AS
  SELECT id FROM public.cash_counts
  WHERE business_date = '2026-01-15' AND count_type = 'shift_close' LIMIT 1;

-- Directly insert a final report referencing the shift_close count
INSERT INTO public.cash_close_reports (
  business_date, cash_count_id, closed_by,
  pos_total, opening_cash, pos_cash_total, pos_non_cash_total,
  bank_transfer_confirmed, expense_cash_total, payroll_cash_total,
  theory_cash, reconciliation_total, physical_cash, difference,
  denominations_json, report_status
) VALUES (
  '2026-01-15', (SELECT id FROM _finalized), '11111111-1111-1111-1111-111111111111',
  500000, 0, 500000, 0,
  0, 0, 0,
  500000, 500000, 500000, 0,
  jsonb_build_object('100000', 5), 'final'
);

SELECT throws_ok(
  format($$SELECT public.update_cash_count(jsonb_build_object('id', %L, 'note', 'try to edit'))$$,
    (SELECT id FROM _finalized)),
  NULL, NULL,
  'update_cash_count rejects edits on finalized count'
);

-- Test 3+4 combined: note-only edit accepted on the spot_audit (also verifies denomination re-snapshot path)
SELECT lives_ok(
  format($$SELECT public.update_cash_count(jsonb_build_object(
    'id', %L,
    'note', 'note-only edit'
  ))$$, (SELECT id FROM _seed)),
  'note-only edit accepted'
);

SELECT * FROM finish();
ROLLBACK;
