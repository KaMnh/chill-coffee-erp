-- 086 — Regression: legacy RPC phải fund-aware khi quỹ transfer có row.
-- Lỗ hổng (adversarial review 2026-06-10): withdraw/adjust/count/edit đọc số dư
-- CROSS-FUND ("row mới nhất" không lọc fund) rồi chain row fund='cash' → khi row
-- transfer là row mới nhất, quỹ cash bị phá (phantom cash / chặn rút sai).
-- Test này dựng đúng kịch bản đó: row transfer LÀ row ghi gần nhất cross-fund,
-- rồi assert mọi RPC cash vẫn đọc/chain đúng QUỸ CASH.
-- created_at được stagger thủ công (superuser) giữa các bước để giữ chain
-- xác định trong 1 transaction test (production: mỗi RPC 1 txn riêng).
BEGIN;
SELECT plan(12);

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

-- Seed: cash=1M, transfer=5M. Stagger: cash cũ hơn → row TRANSFER là row ghi
-- gần nhất cross-fund (trigger của lỗ hổng: code cũ sẽ đọc 5M cho thao tác cash).
SELECT public.safe_setup_initial(1000000, 5000000, 'seed 086');
UPDATE public.safe_transactions SET created_at = now() - interval '4 hours' WHERE fund='cash';
UPDATE public.safe_transactions SET created_at = now() - interval '210 minutes' WHERE fund='transfer';

-- Test 1: rút 2M cash — quỹ cash chỉ 1M (dù transfer 5M là row mới nhất) → PHẢI chặn.
SELECT throws_ok(
  $$SELECT public.safe_withdraw_other(2000000, 'other', 'quá quỹ cash')$$,
  NULL, NULL,
  'rút 2M bị chặn: validate theo QUỸ CASH (1M), không phải row transfer mới nhất (5M)');

-- Test 2+3+4: rút 400k → row fund=cash, chain từ quỹ cash (1M − 400k = 600k), có expense link.
CREATE TEMP TABLE _wd AS
SELECT public.safe_withdraw_other(400000, 'utilities', 'tiền điện 086') AS r;

SELECT is(
  (SELECT fund FROM public.safe_transactions WHERE id = (SELECT (r->>'id')::uuid FROM _wd)),
  'cash', 'row rút thuộc quỹ cash');
SELECT is(
  (SELECT balance_after FROM public.safe_transactions WHERE id = (SELECT (r->>'id')::uuid FROM _wd)),
  600000::numeric, 'balance_after chain từ quỹ cash: 1M − 400k = 600k (không phải 5M − 400k)');
SELECT is(
  (SELECT count(*)::int FROM public.expenses WHERE safe_transaction_id = (SELECT (r->>'id')::uuid FROM _wd)),
  1, 'expense link v2 vẫn được tạo');
UPDATE public.safe_transactions SET created_at = now() - interval '3 hours'
  WHERE id = (SELECT (r->>'id')::uuid FROM _wd);

-- Test 5+6: điều chỉnh quỹ cash về 1.5M → diff +900k, row fund=cash.
CREATE TEMP TABLE _adj AS
SELECT public.safe_adjust(1500000, 'điều chỉnh 086 lên 1.5M') AS r;

SELECT is((SELECT (r->>'difference')::numeric FROM _adj), 900000::numeric,
  'safe_adjust diff = 1.5M − 600k = +900k (so quỹ cash, không phải transfer)');
SELECT is(
  (SELECT fund FROM public.safe_transactions WHERE id = (SELECT (r->>'id')::uuid FROM _adj)),
  'cash', 'row điều chỉnh thuộc quỹ cash');
UPDATE public.safe_transactions SET created_at = now() - interval '2 hours'
  WHERE id = (SELECT (r->>'id')::uuid FROM _adj);

-- Test 7: đếm sổ quỹ 1.5M (3×500k) → expected = QUỸ CASH 1.5M → difference 0.
SELECT is(
  ((public.safe_count(jsonb_build_object('500000', 3), 'đếm 086'))->>'difference')::numeric,
  0::numeric, 'safe_count so với quỹ cash (1.5M) → difference 0');

-- Test 8: safe_balance_now() (display-only) = tổng 2 quỹ = 1.5M + 5M.
SELECT is(public.safe_balance_now(), 6500000::numeric,
  'safe_balance_now = TỔNG 2 quỹ (display-only)');

-- Fixture finalize: chốt két 2026-03-01, physical 500k, bank 300k, leave 100k
-- → deposit cash 400k + deposit transfer 300k.
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date','2026-03-01','denominations_json', jsonb_build_object('100000',1),'safe_withdrawal_amount',0));
CREATE TEMP TABLE _count AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date','2026-03-01','denominations_json', jsonb_build_object('100000',5),
  'total_physical',500000,'bank_transfer_confirmed',300000,'count_type','shift_close',
  'pos_total',800000,'pos_cash_total',500000,'pos_non_cash_total',300000
)))->>'cash_count_id')::uuid AS id;
CREATE TEMP TABLE _report AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count), 100000))->>'report_id')::uuid AS id;
UPDATE public.safe_transactions SET created_at = now() - interval '1 hour'
  WHERE cash_close_report_id = (SELECT id FROM _report);

-- Test 9: sửa leave 100k → 200k (deposit 400k → 300k, diff −100k) → adjustment
-- fund=cash, chain từ quỹ cash (1.9M − 100k = 1.8M).
CREATE TEMP TABLE _edit AS
SELECT public.edit_cash_close_report((SELECT id FROM _report), null, 200000) AS r;

SELECT is(
  (SELECT fund || '|' || balance_after::text FROM public.safe_transactions
   WHERE id = (SELECT (r->>'adjustment_id')::uuid FROM _edit)),
  'cash|1800000.00',
  'edit leave: adjustment thuộc quỹ cash, chain 1.9M − 100k = 1.8M');

-- Test 10+11+12: ledger net từng quỹ + helper khớp.
SELECT is(
  (SELECT coalesce(sum(amount),0)::numeric FROM public.safe_transactions WHERE fund='cash'),
  1800000::numeric, 'net quỹ cash = 1.8M (1M − 400k + 900k + 400k − 100k)');
SELECT is(
  (SELECT coalesce(sum(amount),0)::numeric FROM public.safe_transactions WHERE fund='transfer'),
  5300000::numeric, 'net quỹ transfer = 5.3M (5M + 300k) — KHÔNG bị thao tác cash đụng');
SELECT is(public.safe_fund_balance_now('transfer'), 5300000::numeric,
  'safe_fund_balance_now(transfer) khớp net (chain transfer nguyên vẹn)');

SELECT * FROM finish();
ROLLBACK;
