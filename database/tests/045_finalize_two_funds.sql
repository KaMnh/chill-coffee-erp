-- 045 — finalize_cash_close_report tách deposit theo 2 quỹ (Sổ quỹ 2 quỹ).
-- Chốt két có bank_transfer>0 → 2 row deposit_close (cash + transfer); số dư mỗi
-- quỹ tăng đúng phần của nó.
BEGIN;
SELECT plan(5);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role','authenticated')::text, true);
END;
$$ LANGUAGE plpgsql;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111','owner@test.local','',now(),'00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111','Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111','owner','active');
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Seed: opening + shift_close count với bank_transfer_confirmed = 500k.
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date','2026-02-01','denominations_json', jsonb_build_object('100000',2),'safe_withdrawal_amount',0));

CREATE TEMP TABLE _count AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date','2026-02-01','denominations_json', jsonb_build_object('100000',10),
  'total_physical',1000000,'bank_transfer_confirmed',500000,'count_type','shift_close',
  'pos_total',1500000,'pos_cash_total',1000000,'pos_non_cash_total',500000
)))->>'cash_count_id')::uuid AS id;

-- ACT: finalize leave=200k → cash deposit 800k; transfer deposit = bank_transfer 500k.
CREATE TEMP TABLE _report AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count), 200000))->>'report_id')::uuid AS id;

SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions
   WHERE cash_close_report_id=(SELECT id FROM _report) AND transaction_type='deposit_close'),
  2, '2 row deposit_close (cash + transfer)');

SELECT is(public.safe_fund_balance_now('cash'), 800000::numeric,
  'quỹ cash += physical − leave = 800k');

SELECT is(public.safe_fund_balance_now('transfer'), 500000::numeric,
  'quỹ transfer += bank_transfer = 500k');

SELECT is((public.safe_balances_now()->>'total')::numeric, 1300000::numeric,
  'tổng quỹ = 1.3M');

SELECT is(
  (SELECT count(DISTINCT fund)::int FROM public.safe_transactions
   WHERE cash_close_report_id=(SELECT id FROM _report) AND transaction_type='deposit_close'),
  2, 'deposit rows thuộc 2 quỹ khác nhau');

SELECT * FROM finish();
ROLLBACK;
