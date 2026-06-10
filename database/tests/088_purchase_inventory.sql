-- 088 — safe_purchase_inventory (F1+F2): atomic trừ quỹ tách fund + đẩy kho +
-- nhớ đơn giá. Stagger created_at (superuser) giữa các bước để chain xác định
-- trong 1 transaction test (production: mỗi RPC 1 txn riêng).
BEGIN;
SELECT plan(12);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role','authenticated')::text, true);
END;
$$ LANGUAGE plpgsql;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111','owner@test.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222','manager@test.local','',now(),'00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111','Owner'),
  ('22222222-2222-2222-2222-222222222222','Manager');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111','owner','active'),
  ('22222222-2222-2222-2222-222222222222','manager','active');

-- Seed nguyên liệu (superuser) + sổ quỹ cash=1M / transfer=300k.
INSERT INTO public.ingredients (id, name, unit, last_unit_price) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Cà phê 088', 'kg', 0),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Sữa 088', 'hop', 0);

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SELECT public.safe_setup_initial(1000000, 300000, 'seed 088');
UPDATE public.safe_transactions SET created_at = now() - interval '4 hours';

-- Test 1-7: happy path — 2 dòng (2kg×100k + 10×25k = 450k), tách CK 300k + cash 150k, hôm qua.
CREATE TEMP TABLE _p AS
SELECT public.safe_purchase_inventory(
  150000, 300000,
  jsonb_build_array(
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',2,'unit_price',100000),
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000002','quantity',10,'unit_price',25000)
  ),
  'Nhập đầu tuần 088',
  now() - interval '1 day'
) AS r;

SELECT is((SELECT (r->>'total')::numeric FROM _p), 450000::numeric,
  'tổng server-side = 450k (2×100k + 10×25k)');
SELECT is((SELECT (r->>'cash_balance_after')::numeric FROM _p), 850000::numeric,
  'quỹ cash 1M − 150k = 850k');
SELECT is((SELECT (r->>'transfer_balance_after')::numeric FROM _p), 0::numeric,
  'quỹ transfer 300k − 300k = 0');
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions
   WHERE transaction_type='withdraw_other' AND reason_category='inventory'),
  2, '2 row sổ quỹ (cash + transfer), reason inventory');
SELECT is(
  (SELECT count(*)::int FROM public.stock_movements
   WHERE reason='purchase_received'
     AND occurred_at::date = (now() - interval '1 day')::date),
  2, '2 stock movements purchase_received, nhãn ngày hôm qua');
SELECT is(
  (SELECT quantity_delta FROM public.stock_movements
   WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000001' AND reason='purchase_received'),
  2::numeric, 'cà phê +2kg');
SELECT is(
  (SELECT last_unit_price || '|' ||
     (SELECT last_unit_price FROM public.ingredients WHERE id='aaaaaaaa-0000-0000-0000-000000000002')
   FROM public.ingredients WHERE id='aaaaaaaa-0000-0000-0000-000000000001'),
  '100000.00|25000.00', 'last_unit_price ghi đè 100k / 25k');

UPDATE public.safe_transactions SET created_at = now() - interval '3 hours'
  WHERE reason_category='inventory';

-- Test 8: tách quỹ không khớp tổng → raise.
SELECT throws_ok(
  $$SELECT public.safe_purchase_inventory(100000, 100000,
      jsonb_build_array(jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',1,'unit_price',150000)))$$,
  NULL, NULL, 'tách quỹ 200k ≠ tổng dòng 150k → raise');

-- Test 9: vượt quỹ → raise + KHÔNG ghi gì (atomic: cả safe row lẫn stock movement).
CREATE TEMP TABLE _n AS
SELECT (SELECT count(*) FROM public.safe_transactions) AS st,
       (SELECT count(*) FROM public.stock_movements) AS sm;
SELECT throws_ok(
  $$SELECT public.safe_purchase_inventory(2000000, 0,
      jsonb_build_array(jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',20,'unit_price',100000)))$$,
  NULL, NULL, 'vượt quỹ cash → raise');
SELECT is(
  (SELECT count(*) FROM public.safe_transactions) - (SELECT st FROM _n)
  + (SELECT count(*) FROM public.stock_movements) - (SELECT sm FROM _n),
  0::bigint, 'rollback atomic: không safe row / stock movement nào được ghi');

-- Test 11: SL ≤ 0 → raise.
SELECT throws_ok(
  $$SELECT public.safe_purchase_inventory(0, 100000,
      jsonb_build_array(jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',0,'unit_price',100000)))$$,
  NULL, NULL, 'quantity 0 → raise');

-- Test 12: non-owner → raise.
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SELECT throws_ok(
  $$SELECT public.safe_purchase_inventory(1000, 0,
      jsonb_build_array(jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',1,'unit_price',1000)))$$,
  NULL, NULL, 'manager bị chặn (owner-only)');

SELECT * FROM finish();
ROLLBACK;
