-- 085 — safe_setup_initial 2 quỹ + save_cash_day_opening rút từ quỹ cash.
BEGIN;
SELECT plan(7);

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

-- ACT 1: setup 2 quỹ — cash 1M + transfer 2M.
SELECT public.safe_setup_initial(1000000, 2000000, 'Khởi tạo test');

SELECT is(public.safe_fund_balance_now('cash'), 1000000::numeric, 'setup quỹ cash = 1M');
SELECT is(public.safe_fund_balance_now('transfer'), 2000000::numeric, 'setup quỹ transfer = 2M');
SELECT is((public.safe_balances_now()->>'total')::numeric, 3000000::numeric, 'tổng = 3M');
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions WHERE transaction_type='initial_setup'),
  2, '2 row initial_setup (cash + transfer)');

-- setup lần 2 → bị chặn (đã có giao dịch)
SELECT throws_ok(
  $$SELECT public.safe_setup_initial(500000, 0, 'again')$$,
  NULL, NULL, 'setup lần 2 bị chặn');

-- ACT 2: mở két rút 300k từ sổ quỹ → trừ QUỸ CASH, transfer không đổi.
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date','2026-02-02',
  'denominations_json', jsonb_build_object('100000',3),
  'safe_withdrawal_amount',300000));

-- sum(amount) ledger net (xem note 065): nhiều row cash cùng created_at trong 1
-- transaction → tie-break id uuid bất định; production opening ở transaction riêng.
SELECT is((SELECT coalesce(sum(amount),0)::numeric FROM public.safe_transactions WHERE fund='cash'),
  700000::numeric, 'mở két rút 300k từ quỹ cash → net 700k');
-- transfer chỉ có 1 row (initial_setup) → safe_fund_balance_now xác định.
SELECT is(public.safe_fund_balance_now('transfer'), 2000000::numeric,
  'quỹ transfer KHÔNG đổi khi mở két (rút từ cash)');

SELECT * FROM finish();
ROLLBACK;
