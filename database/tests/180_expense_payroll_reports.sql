-- Phase 5.C — Expense + payroll reports.
--
-- 10 assertions (top-level SELECT pattern):
--   expense_summary_by_category (5):
--     1. Empty range returns 0 rows
--     2. sum(amount) correct across multiple expenses in same category
--     3. expense_count = count(*) per category
--     4. NULL category_id produces its own row with category_name = NULL
--     5. Sort is ORDER BY total_amount DESC (verified via limit 1)
--
--   payroll_summary_by_employee (5):
--     6. Empty range returns 0 rows
--     7. sum(total_pay) correct across multiple shifts for same employee
--     8. shift_count = count(*) per employee
--     9. sum(total_minutes) correct across shifts
--    10. Sort is ORDER BY total_pay DESC (verified via limit 1)

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
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- ==================================================================
-- expense_summary_by_category tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 1: empty range returns 0 rows (expense)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.expense_summary_by_category(
     current_date - 30, current_date - 29)),
  0,
  'expense: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Tests 2 + 3: sum(amount) + expense_count across multiple rows
-- ------------------------------------------------------------------
-- Create 2 categories: Rent + Utilities
-- Insert 3 expenses against Rent: 5000000, 3000000, 2000000 => sum 10000000, count 3
-- Insert 1 expense against Utilities: 800000 => sum 800000, count 1
create temp table _t_cat_rent (id uuid);
create temp table _t_cat_util (id uuid);

with r as (
  insert into public.expense_categories (name, sort_order) values ('Rent T180', 100) returning id
)
insert into _t_cat_rent select id from r;
with u as (
  insert into public.expense_categories (name, sort_order) values ('Utilities T180', 110) returning id
)
insert into _t_cat_util select id from u;

-- Insert expenses
insert into public.expenses (business_date, category_id, description, amount)
values
  (current_date - 1, (select id from _t_cat_rent), 'Rent expense 1', 5000000),
  (current_date - 1, (select id from _t_cat_rent), 'Rent expense 2', 3000000),
  (current_date - 1, (select id from _t_cat_rent), 'Rent expense 3', 2000000),
  (current_date - 1, (select id from _t_cat_util), 'Util expense 1', 800000);

-- Test 2: sum(amount) for Rent = 10000000
select is(
  (select total_amount from public.expense_summary_by_category(
     current_date - 2, current_date)
   where category_id = (select id from _t_cat_rent)),
  10000000::numeric,
  'expense: sum(amount) across 3 rent expenses = 10000000'
);

-- Test 3: expense_count for Rent = 3
select is(
  (select expense_count from public.expense_summary_by_category(
     current_date - 2, current_date)
   where category_id = (select id from _t_cat_rent)),
  3::int,
  'expense: expense_count = count(*) per category = 3'
);

-- ------------------------------------------------------------------
-- Test 4: NULL category_id produces its own row
-- ------------------------------------------------------------------
insert into public.expenses (business_date, category_id, description, amount)
values
  (current_date - 1, null, 'Uncategorised expense', 150000);

select is(
  (select count(*)::int from public.expense_summary_by_category(
     current_date - 2, current_date)
   where category_id is null),
  1,
  'expense: NULL category_id produces its own row'
);

-- ------------------------------------------------------------------
-- Test 5: sort ORDER BY total_amount DESC (expense)
-- ------------------------------------------------------------------
-- Categories so far: Rent (10000000) > Utilities (800000) > NULL (150000)
-- Expected first row: Rent T180
select is(
  (select category_name from public.expense_summary_by_category(current_date - 2, current_date) limit 1),
  'Rent T180',
  'expense: first row is highest total_amount (Rent 10000000)'
);

-- ==================================================================
-- payroll_summary_by_employee tests
-- ==================================================================

-- ------------------------------------------------------------------
-- Test 6: empty range returns 0 rows (payroll)
-- ------------------------------------------------------------------
select is(
  (select count(*)::int from public.payroll_summary_by_employee(
     current_date - 60, current_date - 50)),
  0,
  'payroll: empty range returns 0 rows'
);

-- ------------------------------------------------------------------
-- Tests 7 + 8 + 9: sum(total_pay) + shift_count + sum(total_minutes)
-- ------------------------------------------------------------------
-- Create employees: Alice + Bob
-- Alice: 2 shifts, total_pay 500000 + 400000 = 900000, total_minutes 300 + 240 = 540
-- Bob: 1 shift, total_pay 350000, total_minutes 180
create temp table _t_emp_alice (id uuid);
create temp table _t_emp_bob (id uuid);
with a as (
  insert into public.employees (name, hourly_rate) values ('Alice T180', 100000) returning id
)
insert into _t_emp_alice select id from a;
with b as (
  insert into public.employees (name, hourly_rate) values ('Bob T180', 100000) returning id
)
insert into _t_emp_bob select id from b;

insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
values
  ((select id from _t_emp_alice), current_date - 1, 300, 100000, 500000, 500000),
  ((select id from _t_emp_alice), current_date - 1, 240, 100000, 400000, 400000),
  ((select id from _t_emp_bob),   current_date - 1, 180, 100000, 350000, 350000);

-- Test 7: sum(total_pay) for Alice = 900000
select is(
  (select total_pay from public.payroll_summary_by_employee(
     current_date - 2, current_date)
   where employee_id = (select id from _t_emp_alice)),
  900000::numeric,
  'payroll: sum(total_pay) across 2 Alice shifts = 900000'
);

-- Test 8: shift_count for Alice = 2
select is(
  (select shift_count from public.payroll_summary_by_employee(
     current_date - 2, current_date)
   where employee_id = (select id from _t_emp_alice)),
  2::int,
  'payroll: shift_count = count(*) per employee = 2'
);

-- Test 9: sum(total_minutes) for Alice = 540
select is(
  (select total_minutes from public.payroll_summary_by_employee(
     current_date - 2, current_date)
   where employee_id = (select id from _t_emp_alice)),
  540::int,
  'payroll: sum(total_minutes) across Alice shifts = 540'
);

-- ------------------------------------------------------------------
-- Test 10: sort ORDER BY total_pay DESC (payroll)
-- ------------------------------------------------------------------
-- Employees: Alice (900000) > Bob (350000)
select is(
  (select employee_name from public.payroll_summary_by_employee(current_date - 2, current_date) limit 1),
  'Alice T180',
  'payroll: first row is highest total_pay (Alice 900000)'
);

select * from finish();
rollback;
