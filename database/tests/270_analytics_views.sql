-- =============================================================================
-- pgTAP: analytics schema — 4 view cho n8n (daily_pnl / daily_cashflow /
-- cash_position / cash_variance) + grants service_role-only + security_invoker
-- =============================================================================
begin;
select plan(20);

-- ---------- fixtures (rollback ở cuối) ----------
insert into public.employees (id, name)
values ('00000000-0000-4000-8000-00000000e001', 'NV Test Analytics');

insert into public.sales_orders (id, kiotviet_invoice_id, purchase_at, business_date, net_amount)
values ('00000000-0000-4000-8000-0000000000a1', 'TEST-ANL-1',
        timestamptz '2026-06-01 09:30+07', date '2026-06-01', 100000);

insert into public.sales_payments (sales_order_id, payment_method, amount) values
  ('00000000-0000-4000-8000-0000000000a1', 'cash', 60000),
  ('00000000-0000-4000-8000-0000000000a1', 'bank_transfer', 40000);

-- safe ledger: 2 quỹ, chuỗi balance_after theo created_at; dòng cuối là rút BACK-DATE
insert into public.safe_transactions
  (id, transaction_type, amount, balance_after, fund, reason_category, occurred_at, created_at) values
  ('00000000-0000-4000-8000-0000000000b1', 'initial_setup',  500000, 500000, 'cash',     null,
     timestamptz '2026-06-01 08:00+07', timestamptz '2026-06-01 08:00+07'),
  ('00000000-0000-4000-8000-0000000000b2', 'initial_setup',  300000, 300000, 'transfer', null,
     timestamptz '2026-06-01 08:00:01+07', timestamptz '2026-06-01 08:00:01+07'),
  ('00000000-0000-4000-8000-0000000000b3', 'withdraw_other', -20000, 480000, 'cash',     'utilities',
     timestamptz '2026-06-01 10:00+07', timestamptz '2026-06-01 10:00+07'),
  ('00000000-0000-4000-8000-0000000000b4', 'withdraw_other', -50000, 250000, 'transfer', 'inventory',
     timestamptz '2026-06-01 11:00+07', timestamptz '2026-06-01 11:00+07'),
  ('00000000-0000-4000-8000-0000000000b5', 'withdraw_other', -30000, 450000, 'cash',     'rent',
     timestamptz '2026-06-01 09:00+07', timestamptz '2026-06-02 09:00+07'); -- occurred 1/6, created 2/6

insert into public.expenses (business_date, description, amount, safe_transaction_id) values
  (date '2026-06-01', 'chi két quầy (đếm)', 10000, null),
  (date '2026-06-01', 'mirror rút quỹ (KHÔNG được đếm)', 20000, '00000000-0000-4000-8000-0000000000b3');

insert into public.shift_payroll_records (employee_id, business_date, total_pay)
values ('00000000-0000-4000-8000-00000000e001', date '2026-06-01', 30000);

insert into public.cash_counts (id, business_date, count_type, difference, counted_at) values
  ('00000000-0000-4000-8000-0000000000c1', date '2026-06-01', 'shift_close', -5000, timestamptz '2026-06-01 14:00+07'),
  ('00000000-0000-4000-8000-0000000000c2', date '2026-06-01', 'shift_close', -5000, timestamptz '2026-06-01 18:00+07'),
  ('00000000-0000-4000-8000-0000000000c3', date '2026-06-01', 'day_close',       0, timestamptz '2026-06-01 22:00+07'),
  ('00000000-0000-4000-8000-0000000000c4', date '2026-06-01', 'day_close',       0, timestamptz '2026-06-01 21:00+07');

insert into public.cash_close_reports (business_date, cash_count_id, report_status, leave_for_next_day) values
  (date '2026-06-01', '00000000-0000-4000-8000-0000000000c3', 'final',  200000),
  (date '2026-06-01', '00000000-0000-4000-8000-0000000000c4', 'voided', 999999); -- phải bị loại

insert into public.safe_counts (total_physical, expected_balance, difference, counted_at)
values (480000, 481000, -1000, timestamptz '2026-06-01 20:00+07');

-- ---------- 1-9: tồn tại + security_invoker ----------
select has_schema('analytics', 'schema analytics tồn tại');
select has_view('analytics', 'daily_pnl',      'view daily_pnl tồn tại');
select has_view('analytics', 'daily_cashflow', 'view daily_cashflow tồn tại');
select has_view('analytics', 'cash_position',  'view cash_position tồn tại');
select has_view('analytics', 'cash_variance',  'view cash_variance tồn tại');

create or replace function pg_temp.has_security_invoker(p_view text) returns boolean
language sql stable as $fn$
  select coalesce(
    array_to_string(reloptions, ',') like '%security_invoker=on%' or
    array_to_string(reloptions, ',') like '%security_invoker=true%',
    false
  )
  from pg_class
  where relname = p_view
    and relnamespace = 'analytics'::regnamespace
    and relkind = 'v';
$fn$;

select ok(pg_temp.has_security_invoker('daily_pnl'),      'daily_pnl: security_invoker=on');
select ok(pg_temp.has_security_invoker('daily_cashflow'), 'daily_cashflow: security_invoker=on');
select ok(pg_temp.has_security_invoker('cash_position'),  'cash_position: security_invoker=on');
select ok(pg_temp.has_security_invoker('cash_variance'),  'cash_variance: security_invoker=on');

-- ---------- 10-12: grants ----------
select ok(has_schema_privilege('service_role', 'analytics', 'USAGE'),
          'service_role có USAGE trên analytics');
select ok(not has_schema_privilege('anon', 'analytics', 'USAGE'),
          'anon KHÔNG có USAGE trên analytics');
select ok(not has_schema_privilege('authenticated', 'analytics', 'USAGE'),
          'authenticated KHÔNG có USAGE trên analytics');

-- ---------- 13-14: daily_pnl ----------
-- revenue 100k; cash/transfer 60/40; expenses 10k (mirror bị loại);
-- safe_outflow 100k (20k+50k+30k — gồm cả back-date theo occurred_at); payroll 30k
-- net = 100k − 10k − 100k − 30k = −40k
select results_eq(
  $$select revenue, revenue_cash, revenue_transfer, expenses_total,
           safe_outflow_operating, payroll_total, net_profit_cash
      from analytics.daily_pnl where business_date = date '2026-06-01'$$,
  $$values (100000::numeric, 60000::numeric, 40000::numeric, 10000::numeric,
            100000::numeric, 30000::numeric, -40000::numeric)$$,
  'daily_pnl 2026-06-01 đúng (mirror expense bị loại, back-date tính theo occurred_at)');

select is((select count(*)::int from analytics.daily_pnl where business_date = date '2026-06-02'),
          0, 'daily_pnl KHÔNG có dòng 2026-06-02 (back-date thuộc về ngày nhãn)');

-- ---------- 15-16: daily_cashflow ----------
select results_eq(
  $$select cash_in_pos, transfer_in, expense_out, payroll_out,
           safe_withdraw_inventory, safe_withdraw_other_ops, total_in, total_out, net_cashflow
      from analytics.daily_cashflow where business_date = date '2026-06-01'$$,
  $$values (60000::numeric, 40000::numeric, 10000::numeric, 30000::numeric,
            50000::numeric, 50000::numeric, 100000::numeric, 140000::numeric, -40000::numeric)$$,
  'daily_cashflow 2026-06-01 đúng');

select is(
  (select net_profit_cash from analytics.daily_pnl where business_date = date '2026-06-01'),
  (select net_cashflow from analytics.daily_cashflow where business_date = date '2026-06-01'),
  'net P&L = net cashflow trên fixture này (cross-check)');

-- ---------- 17-18: cash_position ----------
-- 1/6: cắt created_at < 2/6 00:00 VN → cash 480k (back-date created 2/6 bị loại), transfer 250k,
--      drawer_leave 200k (chỉ final, KHÔNG lấy 999999 của voided) → total 930k
select results_eq(
  $$select drawer_leave, safe_cash_recorded, safe_transfer_recorded, total_position
      from analytics.cash_position where business_date = date '2026-06-01'$$,
  $$values (200000::numeric, 480000::numeric, 250000::numeric, 930000::numeric)$$,
  'cash_position 2026-06-01: as-recorded, voided report bị loại');

-- 2/6: dòng sinh từ created_at của rút back-date → cash 450k, transfer 250k, drawer 0 → 700k
select results_eq(
  $$select drawer_leave, safe_cash_recorded, safe_transfer_recorded, total_position
      from analytics.cash_position where business_date = date '2026-06-02'$$,
  $$values (0::numeric, 450000::numeric, 250000::numeric, 700000::numeric)$$,
  'cash_position 2026-06-02: rút back-date hiện ở ngày GHI SỔ (created_at)');

-- ---------- 19: cash_variance ----------
select results_eq(
  $$select drawer_shift_diff, drawer_shift_counts::int, drawer_dayclose_diff, drawer_dayclose_counts::int,
           drawer_spot_diff, drawer_spot_counts::int, safe_diff, safe_counts_n::int
      from analytics.cash_variance where business_date = date '2026-06-01'$$,
  $$values (-10000::numeric, 2, 0::numeric, 2, null::numeric, 0, -1000::numeric, 1)$$,
  'cash_variance 2026-06-01: Σ + count per loại; spot không đếm → NULL/0');

-- ---------- 20: service_role đọc được thật ----------
set local role service_role;
select is((select count(*)::int from analytics.daily_pnl where business_date = date '2026-06-01'),
          1, 'service_role SELECT được daily_pnl (BYPASSRLS + grants)');
reset role;

select * from finish();
rollback;
