-- 087 — safe_withdraw_other v4: tách quỹ (CK + tiền mặt) + F4 chỉnh ngày.
-- Số dư GIẢM NGAY cả khi back-date (cơ sở số dư = created_at, occurred_at chỉ là
-- nhãn ngày); rút tách 2 quỹ tạo 1–2 row; vượt 1 quỹ → rollback toàn bộ.
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

-- Seed: cash=1M, transfer=500k (stagger created_at để chain xác định).
SELECT public.safe_setup_initial(1000000, 500000, 'seed 087');
UPDATE public.safe_transactions SET created_at = now() - interval '4 hours' WHERE fund='cash';
UPDATE public.safe_transactions SET created_at = now() - interval '4 hours' WHERE fund='transfer';

-- Test 1-4: rút tách 300k CK + 200k cash (hôm qua) → 2 row đúng quỹ, đúng occurred_at.
CREATE TEMP TABLE _wd AS
SELECT public.safe_withdraw_other(200000, 300000, 'inventory', 'mua đồ 087',
  (now() - interval '1 day')) AS r;

SELECT is((SELECT (r->>'cash_balance_after')::numeric FROM _wd), 800000::numeric,
  'quỹ cash giảm NGAY 200k dù back-date (1M → 800k)');
SELECT is((SELECT (r->>'transfer_balance_after')::numeric FROM _wd), 200000::numeric,
  'quỹ transfer giảm NGAY 300k (500k → 200k)');
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions
   WHERE transaction_type='withdraw_other'
     AND occurred_at::date = (now() - interval '1 day')::date),
  2, '2 row withdraw_other mang nhãn ngày HÔM QUA (occurred_at)');
SELECT is(
  (SELECT count(*)::int FROM public.expenses
   WHERE safe_transaction_id = (SELECT (r->>'cash_id')::uuid FROM _wd)
     AND amount = 500000
     AND business_date = (now() - interval '1 day')::date),
  1, '1 expense row cho TỔNG 500k, business_date = ngày đã chọn');

-- Stagger 2 row vừa tạo để các bước sau chain xác định.
UPDATE public.safe_transactions SET created_at = now() - interval '3 hours'
  WHERE transaction_type='withdraw_other';

-- Test 5: rút chỉ-CK (cash=0) → đúng 1 row transfer, không row cash amount=0.
CREATE TEMP TABLE _wd2 AS
SELECT public.safe_withdraw_other(0, 100000, 'other', 'chi CK 087') AS r;

SELECT is(
  (SELECT (r->>'cash_id') IS NULL AND (r->>'transfer_id') IS NOT NULL FROM _wd2),
  true, 'rút 0 cash + 100k CK → chỉ 1 row transfer (skip row amount=0)');
UPDATE public.safe_transactions SET created_at = now() - interval '2 hours'
  WHERE id = (SELECT (r->>'transfer_id')::uuid FROM _wd2);

-- Test 6: vượt quỹ CK (còn 100k, rút 200k CK) → raise + KHÔNG ghi gì (atomic).
CREATE TEMP TABLE _n_before AS SELECT count(*)::int AS n FROM public.safe_transactions;
SELECT throws_ok(
  $$SELECT public.safe_withdraw_other(50000, 200000, 'other', 'vượt CK 087')$$,
  NULL, NULL, 'vượt quỹ CK → raise');
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions),
  (SELECT n FROM _n_before),
  'rollback atomic: không row nào được ghi khi 1 quỹ thiếu');

-- Test 8: tổng = 0 → raise.
SELECT throws_ok(
  $$SELECT public.safe_withdraw_other(0, 0, 'other', 'rỗng 087')$$,
  NULL, NULL, 'tổng 0 → raise');

-- Test 9: ngày tương lai → raise.
SELECT throws_ok(
  format($$SELECT public.safe_withdraw_other(1000, 0, 'other', 'tương lai 087', %L::timestamptz)$$,
    (now() + interval '2 days')::text),
  NULL, NULL, 'ngày tương lai → raise');

-- Test 10: số lẻ (không nguyên VND) → raise.
SELECT throws_ok(
  $$SELECT public.safe_withdraw_other(1000.5, 0, 'other', 'lẻ xu 087')$$,
  NULL, NULL, 'số tiền không nguyên VND → raise');

-- Test 11+12: safe_adjust quỹ transfer → row fund=transfer, quỹ cash không đổi.
CREATE TEMP TABLE _adj AS
SELECT public.safe_adjust('transfer', 150000, 'điều chỉnh quỹ CK 087') AS r;

SELECT is(
  (SELECT fund || '|' || (r->>'difference') FROM public.safe_transactions, _adj
   WHERE id = (SELECT (r->>'id')::uuid FROM _adj)),
  'transfer|50000.00', 'safe_adjust(transfer): row fund=transfer, diff = 150k − 100k = +50k');
SELECT is(
  (SELECT coalesce(sum(amount),0)::numeric FROM public.safe_transactions WHERE fund='cash'),
  800000::numeric, 'quỹ cash không đổi khi điều chỉnh quỹ transfer');

SELECT * FROM finish();
ROLLBACK;
