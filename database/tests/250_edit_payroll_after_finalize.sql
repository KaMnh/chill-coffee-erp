-- 250_edit_payroll_after_finalize.sql — guard: payroll của một ngày đã chốt
-- két (cash_close_reports.report_status='final') không được sửa trực tiếp.
-- Flow sửa đúng = hủy báo cáo (void) → sửa lương → finalize lại, và lần
-- finalize lại phải recompute payroll_cash_total live (không lệch snapshot).
--
-- 4 assertions:
--   1. Finalize chụp snapshot payroll_cash_total = 100k.
--   2. edit_shift_payroll_record BỊ CHẶN khi ngày đang final.
--   3. Sau void, sửa lương thành công → total_pay = 200k.
--   4. Finalize lại recompute payroll_cash_total = 200k (snapshot bám ledger).

BEGIN;
SELECT plan(4);

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

-- Owner (mọi RPC dưới đây đều owner/manager-gated)
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

-- Nhân viên giờ công: rate 100k/h → 60 phút = 100k (payment_method mặc định 'cash')
INSERT INTO public.employees (id, name, hourly_rate) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Nhân viên A', 100000);

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Vào ca + ra ca trên 2026-01-15: 09:00 → 10:00 = 60 phút → total_pay 100k
CREATE TEMP TABLE _shift AS
SELECT ((public.check_in_employee(jsonb_build_object(
  'employee_id', '22222222-2222-2222-2222-222222222222',
  'business_date', '2026-01-15',
  'check_in_at', '2026-01-15T09:00:00+07:00'
)))->>'shift_assignment_id')::uuid AS id;

CREATE TEMP TABLE _payroll AS
SELECT ((public.check_out_employee(jsonb_build_object(
  'shift_assignment_id', (SELECT id FROM _shift),
  'employee_id', '22222222-2222-2222-2222-222222222222',
  'business_date', '2026-01-15',
  'check_in_at', '2026-01-15T09:00:00+07:00',
  'check_out_at', '2026-01-15T10:00:00+07:00'
)))->>'payroll_record_id')::uuid AS id;

-- Mở két + kiểm két + chốt. leave = physical = 100k → safe_deposit = 0
-- (tránh chạm safe-balance guard ở void).
SELECT public.save_cash_day_opening(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 1),
  'safe_withdrawal_amount', 0
));

CREATE TEMP TABLE _count AS
SELECT ((public.save_cash_count(jsonb_build_object(
  'business_date', '2026-01-15',
  'denominations_json', jsonb_build_object('100000', 1),
  'total_physical', 100000,
  'bank_transfer_confirmed', 0,
  'count_type', 'shift_close',
  'pos_total', 100000,
  'pos_cash_total', 100000,
  'pos_non_cash_total', 0
)))->>'cash_count_id')::uuid AS id;

CREATE TEMP TABLE _report AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count), 100000))->>'report_id')::uuid AS id;

-- Test 1: snapshot payroll_cash_total = 100k
SELECT is(
  (SELECT payroll_cash_total FROM public.cash_close_reports WHERE id = (SELECT id FROM _report)),
  100000::numeric,
  'finalize snapshots payroll_cash_total = 100k'
);

-- Test 2: sửa lương bị chặn khi ngày đang final. Khớp ĐÚNG message của guard
-- ('đã chốt két') thay vì throws_ok bất kỳ exception — nếu không, một lỗi khác
-- trên cùng code path (sai quyền, not-found, ...) cũng làm test xanh và che
-- regression của chính guard này.
SELECT throws_like(
  format($$SELECT public.edit_shift_payroll_record(jsonb_build_object(
    'payroll_record_id', %L,
    'check_out_at', '2026-01-15T11:00:00+07:00'
  ))$$, (SELECT id FROM _payroll)),
  '%đã chốt két%',
  'edit_shift_payroll_record blocked by finalized-day guard (message) while final'
);

-- Test 3: void → sửa lương thành công, total_pay = 200k (120 phút @ 100k/h)
SELECT public.void_cash_close_report((SELECT id FROM _report), 'Sửa lương ngày đã chốt');

SELECT public.edit_shift_payroll_record(jsonb_build_object(
  'payroll_record_id', (SELECT id FROM _payroll),
  'check_out_at', '2026-01-15T11:00:00+07:00'
));

SELECT is(
  (SELECT total_pay FROM public.shift_payroll_records WHERE id = (SELECT id FROM _payroll)),
  200000::numeric,
  'after void, edit succeeds and total_pay updates to 200k'
);

-- Test 4: finalize lại recompute payroll_cash_total = 200k (bám ledger, không lệch)
CREATE TEMP TABLE _report2 AS
SELECT ((public.finalize_cash_close_report((SELECT id FROM _count), 100000))->>'report_id')::uuid AS id;

SELECT is(
  (SELECT payroll_cash_total FROM public.cash_close_reports WHERE id = (SELECT id FROM _report2)),
  200000::numeric,
  're-finalize recomputes payroll_cash_total = 200k (snapshot follows ledger)'
);

SELECT * FROM finish();
ROLLBACK;
