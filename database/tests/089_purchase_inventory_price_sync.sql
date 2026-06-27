-- 089 — safe_purchase_inventory: cờ per-line sync_price đồng bộ
-- ingredient_reference_prices (spec 2026-06-24). true→set/ghi đè/round;
-- false→giữ nguyên; thiếu field→mặc định true. Vẫn ghi last_unit_price +
-- stock_movements + safe_transactions.
BEGIN;
SELECT plan(9);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role','authenticated')::text, true);
END;
$$ LANGUAGE plpgsql;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111','owner@test.local','',now(),'00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111','Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111','owner','active');

-- NL #1: chưa có giá định giá (test SET mới + round). NL #2: đã có giá 50000
-- (test GHI ĐÈ khi sync=true / GIỮ khi sync=false).
INSERT INTO public.ingredients (id, name, unit, last_unit_price) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'NL set 089', 'kg', 0),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'NL giữ 089', 'kg', 0);
INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', 50000);

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SELECT public.safe_setup_initial(5000000, 0, 'seed 089');
UPDATE public.safe_transactions SET created_at = now() - interval '4 hours';

-- ⚠️ Tổng MỖI call phải là số nguyên: RPC check `v_cash + v_transfer <> round(v_total,2)`.
-- ⚠️ Stagger created_at THEO ID dòng vừa tạo (không theo reason_category) để balance
--    chain (created_at desc, id desc) xác định qua nhiều call (giống 088:70).
-- Call 1: NL#1 sync=true, qty 5 × 100000.4 = 502002 (nguyên) → round(100000.4)=100000;
--         NL#2 sync=false, 1 × 999999 = 999999 → KHÔNG đổi (giữ 50000).
--         Tổng = 1.502.001, trả hết cash.
CREATE TEMP TABLE _p1 AS
SELECT public.safe_purchase_inventory(
  1502001, 0,
  jsonb_build_array(
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',5,'unit_price',100000.4,'sync_price',true),
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000002','quantity',1,'unit_price',999999,'sync_price',false)
  ),
  'sync test 089', now() - interval '1 day'
) AS r;
UPDATE public.safe_transactions SET created_at = now() - interval '3 hours'
  WHERE id = (SELECT (r->>'cash_id')::uuid FROM _p1);

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000001'),
  100000::bigint, 'sync=true: SET giá mới + round(100000.4)=100000');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000002'),
  50000::bigint, 'sync=false: GIỮ nguyên giá cũ 50000 (không đè 999999)');
SELECT is(
  (SELECT last_unit_price FROM public.ingredients WHERE id='aaaaaaaa-0000-0000-0000-000000000002'),
  999999::numeric, 'last_unit_price VẪN ghi đè kể cả khi sync=false');
SELECT is(
  (SELECT count(*)::int FROM public.stock_movements WHERE reason='purchase_received'),
  2, 'vẫn ghi 2 stock_movements');
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions WHERE reason_category='inventory'),
  1, 'vẫn ghi safe_transactions (1 cash row)');

-- Call 2: NL#1 sync=true, 1 × 120000 → GHI ĐÈ 100000→120000.
CREATE TEMP TABLE _p2 AS
SELECT public.safe_purchase_inventory(
  120000, 0,
  jsonb_build_array(
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',1,'unit_price',120000,'sync_price',true)
  ),
  'overwrite 089', now() - interval '1 day'
) AS r;
UPDATE public.safe_transactions SET created_at = now() - interval '2 hours'
  WHERE id = (SELECT (r->>'cash_id')::uuid FROM _p2);

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000001'),
  120000::bigint, 'sync=true: GHI ĐÈ giá đã có 100000→120000');

-- Call 3: THIẾU field sync_price → mặc định true → set giá cho NL#1 = 130000.
CREATE TEMP TABLE _p3 AS
SELECT public.safe_purchase_inventory(
  130000, 0,
  jsonb_build_array(
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',1,'unit_price',130000)
  ),
  'default sync 089', now() - interval '1 day'
) AS r;
UPDATE public.safe_transactions SET created_at = now() - interval '1 hour'
  WHERE id = (SELECT (r->>'cash_id')::uuid FROM _p3);

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000001'),
  130000::bigint, 'thiếu sync_price → mặc định true → đồng bộ 130000');

-- Số dòng giá định giá vẫn = 2 (không tạo thừa).
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  2, 'không tạo row giá thừa (vẫn 2 NL có giá)');

-- last_unit_price NL#1 = 130000 (lần cuối).
SELECT is(
  (SELECT last_unit_price FROM public.ingredients WHERE id='aaaaaaaa-0000-0000-0000-000000000001'),
  130000::numeric, 'last_unit_price NL#1 = 130000 (lần nhập cuối)');

SELECT * FROM finish();
ROLLBACK;
