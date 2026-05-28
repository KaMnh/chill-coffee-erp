-- =============================================================================
-- pgTAP — cash_flow_overview RPC (v2: per-day breakdown + safe_deposit line)
--
-- 10 assertions across 4 scenarios:
--   Scenario 1: empty period (4 assertions)
--     1. in = 0
--     2. out = 0
--     3. by_day has 3 entries (one per day, all zero including safe_deposit)
--     4. expense_breakdown is empty
--
--   Scenario 2: correct sums across all three sources (3 assertions)
--     5. in = 100 (one sales_order with net_amount=100)
--     6. out = 80  (expense 30 + payroll 50)
--     7. net = 20
--
--   Scenario 3: expense_breakdown ordering + nested expenses (2 assertions)
--     8. expense_breakdown[0].category_name = 'CFO Cat Big'
--     9. expense_breakdown[0].expenses[0].amount = 500
--
--   Scenario 4: safe_deposit per day excludes voided reports (1 assertion)
--    10. by_day[0].safe_deposit = 100000 (only the 'final' report counts)
-- =============================================================================

begin;
select plan(10);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('22222222-2222-2222-2222-222222222222', 'owner_cfo@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('22222222-2222-2222-2222-222222222222', 'OwnerCFO');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('22222222-2222-2222-2222-222222222222', 'owner', 'active');

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');

-- ===========================================================================
-- Scenario 1: empty period
-- ===========================================================================

select is(
  (select (public.cash_flow_overview('2099-01-01', '2099-01-03') ->> 'in')::numeric),
  0::numeric,
  'empty: in is 0'
);

select is(
  (select (public.cash_flow_overview('2099-01-01', '2099-01-03') ->> 'out')::numeric),
  0::numeric,
  'empty: out is 0'
);

select is(
  (select jsonb_array_length(public.cash_flow_overview('2099-01-01', '2099-01-03') -> 'by_day')),
  3,
  'empty: by_day has 3 entries (one per day)'
);

select is(
  (select jsonb_array_length(public.cash_flow_overview('2099-01-01', '2099-01-03') -> 'expense_breakdown')),
  0,
  'empty: expense_breakdown is empty'
);

-- ===========================================================================
-- Scenario 2: correct sums — 1 sales_order (in=100) + 1 expense (30) + 1 payroll (50)
-- ===========================================================================

create temp table _t_cfo_cat (id uuid);
with c as (
  insert into public.expense_categories (name, sort_order)
    values ('CFO Test Cat S2', 999)
    returning id
)
insert into _t_cfo_cat select id from c;

create temp table _t_cfo_emp (id uuid);
with e as (
  insert into public.employees (name, hourly_rate)
    values ('CFO Test Employee', 100000)
    returning id
)
insert into _t_cfo_emp select id from e;

insert into public.sales_orders (
  kiotviet_invoice_id, purchase_at, business_date, net_amount
) values (
  'CFO-TEST-INV-001', '2099-02-01 10:00+07', '2099-02-01', 100
);

insert into public.expenses (business_date, description, amount, category_id)
values ('2099-02-01', 'CFO test expense', 30, (select id from _t_cfo_cat));

insert into public.shift_payroll_records (
  employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay
) values (
  (select id from _t_cfo_emp), '2099-02-01', 60, 100000, 50, 50
);

select is(
  (select (public.cash_flow_overview('2099-02-01', '2099-02-01') ->> 'in')::numeric),
  100::numeric,
  'sums: in = 100 (one sales_order)'
);

select is(
  (select (public.cash_flow_overview('2099-02-01', '2099-02-01') ->> 'out')::numeric),
  80::numeric,
  'sums: out = 80 (expense 30 + payroll 50)'
);

select is(
  (select (public.cash_flow_overview('2099-02-01', '2099-02-01') ->> 'net')::numeric),
  20::numeric,
  'sums: net = 20 (100 - 80)'
);

-- ===========================================================================
-- Scenario 3: expense_breakdown ordering + nested expenses
-- ===========================================================================

create temp table _t_cfo_cat_big    (id uuid);
create temp table _t_cfo_cat_medium (id uuid);
create temp table _t_cfo_cat_small  (id uuid);

with c as (insert into public.expense_categories (name, sort_order) values ('CFO Cat Big',    998) returning id)
insert into _t_cfo_cat_big    select id from c;
with c as (insert into public.expense_categories (name, sort_order) values ('CFO Cat Medium', 997) returning id)
insert into _t_cfo_cat_medium select id from c;
with c as (insert into public.expense_categories (name, sort_order) values ('CFO Cat Small',  996) returning id)
insert into _t_cfo_cat_small  select id from c;

insert into public.expenses (business_date, description, amount, category_id) values
  ('2099-03-01', 'big expense',    500, (select id from _t_cfo_cat_big)),
  ('2099-03-01', 'medium expense', 200, (select id from _t_cfo_cat_medium)),
  ('2099-03-01', 'small expense',   50, (select id from _t_cfo_cat_small));

select is(
  (select public.cash_flow_overview('2099-03-01', '2099-03-01') -> 'expense_breakdown' -> 0 ->> 'category_name'),
  'CFO Cat Big',
  'expense_breakdown: first entry is highest amount (Big = 500)'
);

select is(
  (select (public.cash_flow_overview('2099-03-01', '2099-03-01') -> 'expense_breakdown' -> 0 -> 'expenses' -> 0 ->> 'amount')::numeric),
  500::numeric,
  'expense_breakdown[0].expenses[0].amount = 500'
);

-- ===========================================================================
-- Scenario 4: safe_deposit excludes voided reports
-- Insert 2 cash_close_reports for 2099-04-01:
--   - one final with safe_deposit_amount = 100000  (counts)
--   - one voided with safe_deposit_amount = 50000  (NOT counted)
-- Expected: by_day[0].safe_deposit = 100000
-- ===========================================================================

create temp table _t_cfo_cc_final (id uuid);
create temp table _t_cfo_cc_void  (id uuid);

with cc as (
  insert into public.cash_counts (
    business_date, count_type, counted_at, denominations_json, total_physical, counted_by
  ) values (
    '2099-04-01', 'shift_close', '2099-04-01 22:00+07', '{}'::jsonb, 100000,
    '22222222-2222-2222-2222-222222222222'
  ) returning id
)
insert into _t_cfo_cc_final select id from cc;

with cc as (
  insert into public.cash_counts (
    business_date, count_type, counted_at, denominations_json, total_physical, counted_by
  ) values (
    '2099-04-01', 'shift_close', '2099-04-01 22:30+07', '{}'::jsonb, 50000,
    '22222222-2222-2222-2222-222222222222'
  ) returning id
)
insert into _t_cfo_cc_void select id from cc;

insert into public.cash_close_reports (
  cash_count_id, business_date, report_status, safe_deposit_amount, leave_for_next_day, closed_by
) values (
  (select id from _t_cfo_cc_final), '2099-04-01', 'final', 100000, 0,
  '22222222-2222-2222-2222-222222222222'
);

insert into public.cash_close_reports (
  cash_count_id, business_date, report_status, safe_deposit_amount, leave_for_next_day, closed_by, void_reason
) values (
  (select id from _t_cfo_cc_void), '2099-04-01', 'voided', 50000, 0,
  '22222222-2222-2222-2222-222222222222', 'Test void scenario for pgTAP'
);

select is(
  (select (public.cash_flow_overview('2099-04-01', '2099-04-01') -> 'by_day' -> 0 ->> 'safe_deposit')::numeric),
  100000::numeric,
  'safe_deposit: voided reports excluded (only final 100000 counted)'
);

select * from finish();
rollback;
