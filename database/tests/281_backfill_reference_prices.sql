-- 281 — backfill ingredient_reference_prices từ last_unit_price (spec
-- 2026-06-24). Idempotent: NL chưa có giá & last_unit_price>0 → set (round);
-- NL đã có giá → KHÔNG đè; last_unit_price=0 → bỏ qua; chạy 2 lần ổn định.
-- Câu backfill PHẢI khớp database/migrations/2026-06-27-ingredient-price-sync-on-purchase.sql.
BEGIN;
SELECT plan(7);

-- 4 NL: A chưa có giá last=185000.6 (set, round→185001); B đã có giá 50000
-- nhưng last=999999 (giữ 50000); C last=0 (bỏ qua, không tạo row);
-- D last=100000.5 (test half-up: round(100000.5)=100001, away-from-zero).
INSERT INTO public.ingredients (id, name, unit, last_unit_price) VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'A 281', 'kg', 185000.6),
  ('cccccccc-0000-0000-0000-00000000000b', 'B 281', 'kg', 999999),
  ('cccccccc-0000-0000-0000-00000000000c', 'C 281', 'kg', 0),
  ('cccccccc-0000-0000-0000-00000000000d', 'D 281', 'kg', 100000.5);
INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price) VALUES
  ('cccccccc-0000-0000-0000-00000000000b', 50000);

CREATE OR REPLACE FUNCTION pg_temp.run_backfill() RETURNS void AS $$
  insert into public.ingredient_reference_prices (ingredient_id, unit_price, updated_at)
  select i.id, round(i.last_unit_price)::bigint, now()
  from public.ingredients i
  where i.last_unit_price > 0
  on conflict (ingredient_id) do nothing;
$$ LANGUAGE sql;

-- Lần 1
SELECT pg_temp.run_backfill();

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000a'),
  185001::bigint, 'A: set từ last_unit_price 185000.6 → round 185001');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000b'),
  50000::bigint, 'B: GIỮ giá đã có 50000 (không đè 999999)');
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000c'),
  0, 'C: last_unit_price=0 → KHÔNG tạo row');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000d'),
  100001::bigint, 'D: half-up round(100000.5)=100001 (away-from-zero)');

-- Lần 2 (idempotent): không thay đổi gì.
SELECT pg_temp.run_backfill();
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices
   WHERE ingredient_id IN (
     'cccccccc-0000-0000-0000-00000000000a',
     'cccccccc-0000-0000-0000-00000000000b',
     'cccccccc-0000-0000-0000-00000000000c',
     'cccccccc-0000-0000-0000-00000000000d')),
  3, 'chạy lần 2: vẫn đúng 3 row (A + B + D), không nhân đôi');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000a'),
  185001::bigint, 'A: giá không đổi sau lần 2');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000d'),
  100001::bigint, 'D: giá half-up không đổi sau lần 2');

SELECT * FROM finish();
ROLLBACK;
