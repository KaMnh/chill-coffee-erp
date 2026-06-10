-- =============================================================================
-- pgTAP — safe withdraw → expense link + owner-only visibility
--
-- 8 assertions:
--   1. safe_withdraw_other creates an expense row with safe_transaction_id set
--   2a. Expense amount matches the safe withdraw input
--   2b. Expense description matches the safe withdraw input
--   3. payment_method='other' (NOT 'cash')
--   4. category_id IS NULL
--   5. Owner select sees the safe-sourced expense
--   6. Manager select returns 0 rows for safe-sourced expenses
--   7. cash_flow_overview for manager excludes the amount from `out`
-- =============================================================================

begin;
select plan(8);

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

-- Owner + manager test users
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('33333333-3333-3333-3333-333333333333', 'owner_sel@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('44444444-4444-4444-4444-444444444444', 'manager_sel@test.local', '', now(), '00000000-0000-0000-0000-000000000000');

insert into public.profiles (id, display_name) values
  ('33333333-3333-3333-3333-333333333333', 'OwnerSEL'),
  ('44444444-4444-4444-4444-444444444444', 'ManagerSEL');

insert into public.employee_accounts (auth_user_id, role, status) values
  ('33333333-3333-3333-3333-333333333333', 'owner', 'active'),
  ('44444444-4444-4444-4444-444444444444', 'manager', 'active');

-- Seed safe with initial deposit so owner can withdraw (as superuser, bypasses RLS)
insert into public.safe_transactions (
  transaction_type, amount, balance_after,
  reason_category, description, created_by
) values (
  'initial_setup', 5000000, 5000000,
  null, 'pgTAP test init', '33333333-3333-3333-3333-333333333333'
);

-- Owner withdraws 200000 with reason (v4 signature: cash 200k + transfer 0)
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select public.safe_withdraw_other(200000, 0, 'rent', 'pgTAP test withdrawal');

reset role;

-- Capture the safe_transaction_id from the most recent withdraw_other by this owner
create temp table _t_sel_safe_id (id uuid);
insert into _t_sel_safe_id
select id from public.safe_transactions
 where transaction_type = 'withdraw_other'
   and created_by = '33333333-3333-3333-3333-333333333333'
 order by occurred_at desc, id desc
 limit 1;
-- Grant access so authenticated role can join against this temp table
grant select on _t_sel_safe_id to authenticated;

-- ===========================================================================
-- Assertions 1-4: structure of the auto-created expense
-- ===========================================================================

select is(
  (select count(*)::int
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  1,
  '1. safe_withdraw_other creates exactly 1 expense row linked by safe_transaction_id'
);

select is(
  (select e.amount
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  200000::numeric,
  '2a. Expense amount matches safe withdraw input'
);

select is(
  (select e.description
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  'pgTAP test withdrawal'::text,
  '2b. Expense description matches safe withdraw input (text)'
);

select is(
  (select e.payment_method
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  'other'::text,
  '3. payment_method is "other" (avoids cash_drawer double-count)'
);

select is(
  (select e.category_id
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  null::uuid,
  '4. category_id is NULL (no reason_category mapping v1)'
);

-- ===========================================================================
-- Assertions 5-6: owner sees, manager does not
-- ===========================================================================

-- Owner sees the row
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
set local role authenticated;

select is(
  (select count(*)::int
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  1,
  '5. Owner SELECT sees the safe-sourced expense (RLS allows)'
);

-- Manager does not see the row
reset role;
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');
set local role authenticated;

select is(
  (select count(*)::int
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  0,
  '6. Manager SELECT does NOT see the safe-sourced expense (RLS blocks)'
);

-- ===========================================================================
-- Assertion 7: cash_flow_overview as manager excludes the amount
-- ===========================================================================

-- Manager role is still active from assertion 6.
-- The expense is on current_date; query the day's `out` total as manager.
-- The only expense on current_date in this test is the safe-sourced 200000.
-- For manager, the `out` total should be 0 (the safe-sourced row is filtered).
select is(
  (select (public.cash_flow_overview(current_date, current_date) ->> 'out')::numeric),
  0::numeric,
  '7. Manager cash_flow_overview `out` excludes safe-sourced amount'
);

reset role;

select * from finish();
rollback;
