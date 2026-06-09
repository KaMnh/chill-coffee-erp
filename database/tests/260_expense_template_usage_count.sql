-- 260_expense_template_usage_count.sql — create_expense phải tăng usage_count
-- + set last_used_at của expense_template khi dùng mẫu, để rail "Dùng nhiều
-- nhất" (sort usage_count desc, src/lib/data/expenses.ts) phản ánh đúng tần suất.
--
-- 4 assertions:
--   1. create_expense với template_id → usage_count = 1
--   2. last_used_at không còn null sau khi dùng mẫu
--   3. dùng lại template → usage_count = 2 (tăng dần, không reset)
--   4. create_expense KHÔNG có template_id → không đụng usage_count (giữ 2)

BEGIN;
SELECT plan(4);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
END;
$$ LANGUAGE plpgsql;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

-- Mẫu chi cố định, usage_count khởi tạo = 0 (chủ động, không phụ thuộc seed)
INSERT INTO public.expense_templates (id, label, usage_count, last_used_at, is_active) VALUES
  ('33333333-3333-3333-3333-333333333333', 'pgTAP usage_count fixture', 0, NULL, true);

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Dùng mẫu lần 1
SELECT public.create_expense(jsonb_build_object(
  'business_date', '2026-01-15',
  'description', 'Test chi 1',
  'amount', 50000,
  'payment_method', 'cash',
  'template_id', '33333333-3333-3333-3333-333333333333'
));

SELECT is(
  (SELECT usage_count FROM public.expense_templates WHERE id = '33333333-3333-3333-3333-333333333333'),
  1,
  'create_expense with template_id increments usage_count to 1'
);

SELECT ok(
  (SELECT last_used_at IS NOT NULL FROM public.expense_templates WHERE id = '33333333-3333-3333-3333-333333333333'),
  'create_expense with template_id sets last_used_at'
);

-- Dùng mẫu lần 2 → tăng dần (không reset về 1)
SELECT public.create_expense(jsonb_build_object(
  'business_date', '2026-01-15',
  'description', 'Test chi 2',
  'amount', 30000,
  'payment_method', 'cash',
  'template_id', '33333333-3333-3333-3333-333333333333'
));

SELECT is(
  (SELECT usage_count FROM public.expense_templates WHERE id = '33333333-3333-3333-3333-333333333333'),
  2,
  'second use increments usage_count to 2 (cumulative, not reset)'
);

-- create_expense KHÔNG có template → không đụng template
SELECT public.create_expense(jsonb_build_object(
  'business_date', '2026-01-15',
  'description', 'Test chi khong mau',
  'amount', 20000,
  'payment_method', 'cash'
));

SELECT is(
  (SELECT usage_count FROM public.expense_templates WHERE id = '33333333-3333-3333-3333-333333333333'),
  2,
  'create_expense without template_id leaves usage_count untouched'
);

SELECT * FROM finish();
ROLLBACK;
