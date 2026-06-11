-- 280 — ingredient_reference_prices: owner-only RLS (đọc + ghi), cascade.
-- Spec: docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md
BEGIN;
SELECT plan(8);

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

-- Fixtures (chuẩn 070): 3 user owner/manager/staff
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'manager@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'staff@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Owner'),
  ('22222222-2222-2222-2222-222222222222', 'Manager'),
  ('33333333-3333-3333-3333-333333333333', 'Staff');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'staff_operator', 'active');

INSERT INTO public.ingredients (id, name, unit, last_unit_price)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Cà phê test', 'kg', 185000);

-- 1. Bảng tồn tại
SELECT has_table('public', 'ingredient_reference_prices', 'bảng ingredient_reference_prices tồn tại');

-- 2. Owner INSERT được
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 200000);
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  1, 'owner INSERT + SELECT thấy 1 row'
);

-- 3. Owner UPDATE được
UPDATE public.ingredient_reference_prices SET unit_price = 210000
WHERE ingredient_id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT unit_price::int FROM public.ingredient_reference_prices
   WHERE ingredient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  210000, 'owner UPDATE được giá'
);

-- 4. Manager SELECT → 0 rows
RESET ROLE;
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  0, 'manager SELECT trả 0 rows (RLS chặn đọc)'
);

-- 5. Manager INSERT → policy violation
SELECT throws_ok(
  $$ INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1) $$,
  '42501', NULL, 'manager INSERT bị chặn'
);

-- 6. Staff SELECT → 0 rows
RESET ROLE;
SELECT pg_temp.act_as('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  0, 'staff SELECT trả 0 rows'
);

-- 7. check unit_price >= 0
RESET ROLE;
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.ingredient_reference_prices SET unit_price = -1 $$,
  '23514', NULL, 'unit_price âm bị check constraint chặn'
);

-- 8. Cascade: xóa ingredient → row giá biến mất
RESET ROLE;
DELETE FROM public.ingredients WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  0, 'xóa ingredient cascade xóa giá'
);

SELECT * FROM finish();
ROLLBACK;
