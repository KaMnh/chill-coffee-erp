-- =============================================================================
-- pgTAP — cash_flow_overview RPC
--
-- 8 assertions across 3 scenarios:
--   Scenario 1: empty period (4 assertions)
--     1. in = 0
--     2. out = 0
--     3. by_day has 3 entries (one per day, all zero)
--     4. top_categories is empty
--
--   Scenario 2: correct sums across all three sources (3 assertions)
--     5. in = 100 (one sales_order with net_amount=100)
--     6. out = 80  (expense 30 + payroll 50)
--     7. net = 20
--
--   Scenario 3: top_categories ordering (1 assertion)
--     8. top_categories[0].category_name = 'CFO Cat Big' (highest-amount category first)
-- =============================================================================

begin;
select plan(8);

-- ---------------------------------------------------------------------------
-- Auth bypass (same idiom as 170_sales_reports.sql, 180_expense_payroll_reports.sql)
-- ---------------------------------------------------------------------------
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
-- Scenario 1: empty period — far-future dates that have no data
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
  (select jsonb_array_length(public.cash_flow_overview('2099-01-01', '2099-01-03') -> 'top_categories')),
  0,
  'empty: top_categories is empty'
);

-- ===========================================================================
-- Scenario 2: correct sums — 1 sales_order (in=100) + 1 expense (30) + 1 payroll (50)
-- ===========================================================================

-- Insert a category for the expense
create temp table _t_cfo_cat (id uuid);
with c as (
  insert into public.expense_categories (name, sort_order)
    values ('CFO Test Cat S2', 999)
    returning id
)
insert into _t_cfo_cat select id from c;

-- Insert an employee for the payroll record
create temp table _t_cfo_emp (id uuid);
with e as (
  insert into public.employees (name, hourly_rate)
    values ('CFO Test Employee', 100000)
    returning id
)
insert into _t_cfo_emp select id from e;

-- sales_order: kiotviet_invoice_id is NOT NULL UNIQUE; use a fixed far-future value
insert into public.sales_orders (
  kiotviet_invoice_id, purchase_at, business_date, net_amount
) values (
  'CFO-TEST-INV-001', '2099-02-01 10:00+07', '2099-02-01', 100
);

-- expense
insert into public.expenses (business_date, description, amount, category_id)
values ('2099-02-01', 'CFO test expense', 30, (select id from _t_cfo_cat));

-- payroll
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
-- Scenario 3: top_categories ordering — 3 expense rows with different amounts
-- Categories: Big (500), Medium (200), Small (50) — all on a distinct far-future date
-- Expected: top_categories[0].category_name = 'CFO Cat Big'
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
  (select public.cash_flow_overview('2099-03-01', '2099-03-01') -> 'top_categories' -> 0 ->> 'category_name'),
  'CFO Cat Big',
  'top_categories: first entry is highest amount (Big = 500)'
);

select * from finish();
rollback;
