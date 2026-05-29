-- =============================================================================
-- pgTAP — import_sales_from_excel RPC (manual KiotViet Excel re-import)
--
-- 10 assertions:
--   A: dry-run reports would_insert and writes NOTHING
--   B: commit backfills a missing invoice (synthetic kiotviet_invoice_id + item)
--   C: matches an EXISTING order by invoice_code (≠ kiotviet_invoice_id) and
--      corrects its business_date — no duplicate row
--   D: owner gate — non-owner is rejected
--   E: amount validation — negative net raises
-- =============================================================================

begin;
select plan(10);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end;
$$ language plpgsql;

-- One owner + one staff_operator (for the gate test).
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('33333333-3333-3333-3333-333333333333', 'owner_imp@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('44444444-4444-4444-4444-444444444444', 'staff_imp@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('33333333-3333-3333-3333-333333333333', 'OwnerImp'),
  ('44444444-4444-4444-4444-444444444444', 'StaffImp');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('33333333-3333-3333-3333-333333333333', 'owner', 'active'),
  ('44444444-4444-4444-4444-444444444444', 'staff_operator', 'active');

-- Build a one-invoice payload (one cash payment + one line item).
create or replace function pg_temp.payload(p_code text, p_bdate text, p_net numeric)
returns jsonb as $$
  select jsonb_build_object('orders', jsonb_build_array(jsonb_build_object(
    'invoice_code', p_code,
    'purchase_at', p_bdate || 'T15:00:00',
    'business_date', p_bdate,
    'gross_amount', p_net, 'net_amount', p_net, 'total_payment', p_net,
    'status_value', 'Hoàn thành',
    'invoice_details', jsonb_build_array(jsonb_build_object(
      'product_code', 'SP1', 'product_name', 'Test', 'quantity', 1, 'unit_price', p_net, 'line_total', p_net)),
    'payments', jsonb_build_array(jsonb_build_object(
      'payment_method', 'cash', 'amount', p_net, 'cash_received', p_net, 'change_given', 0))
  )));
$$ language sql;

select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

-- ===== A: dry-run =====
select is((select count(*)::int from public.sales_orders where invoice_code = 'IMPTEST_A'), 0, 'A0: no row before');
select is(
  (public.import_sales_from_excel(pg_temp.payload('IMPTEST_A', '2026-06-01', 50000), false) ->> 'would_insert')::int,
  1, 'A1: dry-run reports would_insert=1');
select is((select count(*)::int from public.sales_orders where invoice_code = 'IMPTEST_A'), 0, 'A2: dry-run wrote nothing');

-- ===== B: commit backfill =====
select is(
  (public.import_sales_from_excel(pg_temp.payload('IMPTEST_A', '2026-06-01', 50000), true) ->> 'committed')::boolean,
  true, 'B1: commit committed=true');
select is(
  (select kiotviet_invoice_id from public.sales_orders where invoice_code = 'IMPTEST_A'),
  'excel:IMPTEST_A', 'B2: backfill uses synthetic kiotviet_invoice_id');
select is(
  (select count(*)::int from public.sales_order_items i join public.sales_orders o on o.id = i.sales_order_id where o.invoice_code = 'IMPTEST_A'),
  1, 'B3: line item created');

-- ===== C: update existing by invoice_code (different kiotviet_invoice_id) =====
insert into public.sales_orders (kiotviet_invoice_id, invoice_code, purchase_at, business_date, net_amount)
values ('99999', 'IMPTEST_C', '2026-01-01T10:00:00+07', '2026-01-01', 10000);
select public.import_sales_from_excel(pg_temp.payload('IMPTEST_C', '2026-06-02', 10000), true);
select is(
  (select business_date::text from public.sales_orders where invoice_code = 'IMPTEST_C'),
  '2026-06-02', 'C1: matched by code → business_date corrected');
select is((select count(*)::int from public.sales_orders where invoice_code = 'IMPTEST_C'), 1, 'C2: still one row (no dup)');

-- ===== E: amount validation (still owner) =====
select throws_ok(
  $q$ select public.import_sales_from_excel('{"orders":[{"invoice_code":"IMPTEST_E","purchase_at":"2026-06-04T10:00:00","business_date":"2026-06-04","net_amount":-5}]}'::jsonb, true) $q$,
  'P0001', 'import_sales_from_excel: số tiền âm tại order=IMPTEST_E', 'E1: negative amount rejected');

-- ===== D: owner gate =====
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
select throws_ok(
  $q$ select public.import_sales_from_excel(pg_temp.payload('IMPTEST_D', '2026-06-03', 1000), true) $q$,
  'P0001', 'Chỉ owner được import Excel.', 'D1: non-owner rejected');

select * from finish();
rollback;
