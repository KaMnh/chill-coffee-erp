-- 065 — void_cash_close_report hoàn CẢ 2 quỹ + re-finalize xóa void-metadata.
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

-- Seed finalized report: cash deposit 800k + transfer deposit 500k.
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date','2026-02-01','denominations_json', jsonb_build_object('100000',2),'safe_withdrawal_amount',0));
CREATE TEMP TABLE _count AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date','2026-02-01','denominations_json', jsonb_build_object('100000',10),
  'total_physical',1000000,'bank_transfer_confirmed',500000,'count_type','shift_close',
  'pos_total',1500000,'pos_cash_total',1000000,'pos_non_cash_total',500000
)))->>'cash_count_id')::uuid AS id;
CREATE TEMP TABLE _report AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count), 200000))->>'report_id')::uuid AS id;

-- ACT 1: VOID
SELECT public.void_cash_close_report((SELECT id FROM _report), 'Hủy test 2 quỹ');

SELECT is(
  (SELECT report_status FROM public.cash_close_reports WHERE id=(SELECT id FROM _report)),
  'voided', 'report_status = voided');
-- Dùng sum(amount) (ledger net) thay safe_fund_balance_now: trong 1 transaction
-- test mọi row chung created_at=now() → tie-break id(uuid) bất định. Production:
-- finalize/void ở 2 transaction khác nhau → created_at khác → helper đúng.
-- sum(amount) là ground-truth số dư (mỗi amount là delta từ 0).
SELECT is((SELECT coalesce(sum(amount),0)::numeric FROM public.safe_transactions WHERE fund='cash'),
  0::numeric, 'quỹ cash net = 0 sau void (deposit 800k − reverse 800k)');
SELECT is((SELECT coalesce(sum(amount),0)::numeric FROM public.safe_transactions WHERE fund='transfer'),
  0::numeric, 'quỹ transfer net = 0 sau void (deposit 500k − reverse 500k)');
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions
   WHERE cash_close_report_id=(SELECT id FROM _report) AND transaction_type='adjustment'),
  2, '2 row adjustment reverse (cash + transfer)');

-- ACT 2: RE-FINALIZE cùng cash_count → final + balances khôi phục + metadata void sạch
SELECT public.finalize_cash_close_report((SELECT id FROM _count), 200000);

SELECT is(
  (SELECT report_status FROM public.cash_close_reports WHERE id=(SELECT id FROM _report)),
  'final', 're-finalize → status final');
SELECT ok(
  (SELECT void_reason FROM public.cash_close_reports WHERE id=(SELECT id FROM _report)) IS NULL,
  're-finalize xóa void_reason (metadata void sạch)');
SELECT is((SELECT coalesce(sum(amount),0)::numeric FROM public.safe_transactions WHERE fund='cash'),
  800000::numeric, 'quỹ cash net = 800k sau re-finalize (800 − 800 + 800)');

SELECT * FROM finish();
ROLLBACK;
