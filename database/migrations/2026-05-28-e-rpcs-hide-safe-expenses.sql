-- =============================================================================
-- Hide safe-sourced expenses from non-owner in security-definer RPCs (2026-05-28)
--
-- Three RPCs query expenses table without payment_method='cash' filter:
--   - dashboard_daily_ops: v_expense_list JSONB aggregate
--   - expense_summary_by_category: per-category totals
--   - cash_flow_overview: outs CTE + cat_totals CTE + v_out + v_prev_out
--
-- All run SECURITY DEFINER → bypass RLS. Add inline predicate:
--   AND (e.safe_transaction_id IS NULL OR public.app_role() = 'owner')
--
-- Idempotent: create or replace function.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) dashboard_daily_ops — v_expense_list filter added
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_daily_ops(p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_sales numeric(14,2) := 0;
  v_cash numeric(14,2) := 0;
  v_non_cash numeric(14,2) := 0;
  v_opening numeric(14,2) := 0;
  v_expenses numeric(14,2) := 0;
  v_payroll numeric(14,2) := 0;
  v_active integer := 0;
  v_latest_count jsonb;
  v_latest_sync jsonb;
  v_expense_list jsonb;
  v_sales_list jsonb;
begin
  if not public.app_is_staff_or_above() and public.app_role() <> 'employee_viewer' then
    raise exception 'Bạn chưa có quyền xem dashboard.';
  end if;

  select coalesce(sum(net_amount), 0) into v_sales from public.sales_orders where business_date = p_business_date;
  select coalesce(sum(sp.amount), 0) into v_cash from public.sales_orders so join public.sales_payments sp on sp.sales_order_id = so.id where so.business_date = p_business_date and sp.payment_method = 'cash';
  v_non_cash := greatest(0, v_sales - v_cash);
  select coalesce(sum(opening_total), 0) into v_opening from public.cash_day_openings where business_date = p_business_date;
  select coalesce(sum(amount), 0) into v_expenses from public.expenses where business_date = p_business_date and payment_method = 'cash';
  select coalesce(sum(total_pay), 0) into v_payroll from public.shift_payroll_records where business_date = p_business_date and payment_method = 'cash';
  select count(*) into v_active from public.shift_assignments where business_date = p_business_date and status = 'checked_in';

  select to_jsonb(cc) into v_latest_count from (select id, business_date, count_type, counted_at, total_physical, total_theory, difference, pos_total, pos_cash_total, pos_non_cash_total, opening_cash, bank_transfer_confirmed, reconciliation_total from public.cash_counts where business_date = p_business_date order by counted_at desc limit 1) cc;
  select to_jsonb(sr) into v_latest_sync from (select id, source, status, started_at, finished_at from public.sales_sync_runs where business_date_from <= p_business_date and business_date_to >= p_business_date order by finished_at desc nulls last limit 1) sr;

  -- v_expense_list: includes ALL payment_methods (not just cash). Filter
  -- safe-sourced rows for non-owner roles via inline predicate.
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'business_date', e.business_date, 'description', e.description, 'quantity', e.quantity, 'unit', e.unit, 'unit_price', e.unit_price, 'amount', e.amount, 'note', e.note, 'created_at', e.created_at, 'category_id', e.category_id, 'category_name', c.name) order by e.created_at desc), '[]'::jsonb)
  into v_expense_list
  from public.expenses e left join public.expense_categories c on c.id = e.category_id
  where e.business_date = p_business_date
    and (e.safe_transaction_id is null or public.app_role() = 'owner');

  select coalesce(jsonb_agg(jsonb_build_object('id', so.id, 'invoice_code', so.invoice_code, 'order_code', so.table_or_order_code, 'sold_by_name', so.sold_by_name, 'payment_method', coalesce(sp.payment_method, 'mixed'), 'net_amount', so.net_amount, 'total_payment', so.total_payment, 'purchase_at', so.purchase_at) order by so.purchase_at desc), '[]'::jsonb)
  into v_sales_list
  from public.sales_orders so
  left join lateral (select payment_method from public.sales_payments sp where sp.sales_order_id = so.id order by amount desc limit 1) sp on true
  where so.business_date = p_business_date;

  return jsonb_build_object('business_date', p_business_date, 'total_sales', v_sales, 'cash_sales', v_cash, 'non_cash_sales', v_non_cash, 'opening_cash', v_opening, 'total_expenses', v_expenses, 'payroll_paid', v_payroll, 'active_staff', v_active, 'latest_cash_count', v_latest_count, 'latest_sync', v_latest_sync, 'expenses', v_expense_list, 'sales_orders', v_sales_list);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) expense_summary_by_category — predicate in main SELECT
-- ---------------------------------------------------------------------------
create or replace function public.expense_summary_by_category(
  p_from date,
  p_to   date
) returns table (
  category_id    uuid,
  category_name  text,
  total_amount   numeric,
  expense_count  int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.category_id,
    c.name                       as category_name,
    sum(e.amount)::numeric       as total_amount,
    count(*)::int                as expense_count
  from public.expenses e
  left join public.expense_categories c on c.id = e.category_id
  where e.business_date >= p_from
    and e.business_date <= p_to
    and (e.safe_transaction_id is null or public.app_role() = 'owner')
  group by e.category_id, c.name
  order by total_amount desc;
$$;

-- ---------------------------------------------------------------------------
-- 3) cash_flow_overview — full redefine. Predicates added in v_out sum,
--    outs CTE, cat_totals CTE, v_prev_out sum (4 sites total).
--    Body mirrors v2 in 2026-05-28-a-cashflow-breakdown.sql with patches.
-- ---------------------------------------------------------------------------
create or replace function public.cash_flow_overview(
  p_start date,
  p_end date,
  p_compare_start date default null,
  p_compare_end date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in numeric;
  v_out numeric;
  v_prev_in numeric;
  v_prev_out numeric;
  v_by_day jsonb;
  v_breakdown jsonb;
  v_result jsonb;
begin
  if not public.app_is_owner_manager() then
    raise exception 'forbidden: cash_flow_overview requires owner/manager';
  end if;

  select coalesce(sum(net_amount), 0)
    into v_in
    from public.sales_orders
   where business_date between p_start and p_end;

  -- v_out: total OUT includes payroll + ALL expenses, BUT safe-sourced only count for owner.
  select coalesce((select sum(amount) from public.expenses
                    where business_date between p_start and p_end
                      and (safe_transaction_id is null or public.app_role() = 'owner')), 0)
       + coalesce((select sum(total_pay) from public.shift_payroll_records
                    where business_date between p_start and p_end), 0)
    into v_out;

  with d as (
    select dd::date as day
      from generate_series(p_start, p_end, interval '1 day') dd
  ),
  ins as (
    select business_date as day, sum(net_amount) as amt
      from public.sales_orders
     where business_date between p_start and p_end
     group by 1
  ),
  outs as (
    select day, sum(amt) as amt from (
      select business_date as day, sum(amount) as amt
        from public.expenses
       where business_date between p_start and p_end
         and (safe_transaction_id is null or public.app_role() = 'owner')
       group by 1
      union all
      select business_date as day, sum(total_pay) as amt
        from public.shift_payroll_records
       where business_date between p_start and p_end
       group by 1
    ) u group by day
  ),
  deposits as (
    select business_date as day, coalesce(sum(safe_deposit_amount), 0) as amt
      from public.cash_close_reports
     where business_date between p_start and p_end
       and report_status <> 'voided'
     group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'date', to_char(d.day, 'YYYY-MM-DD'),
           'in', coalesce(ins.amt, 0),
           'out', coalesce(outs.amt, 0),
           'safe_deposit', coalesce(deposits.amt, 0)
         ) order by d.day)
    into v_by_day
    from d
    left join ins on ins.day = d.day
    left join outs on outs.day = d.day
    left join deposits on deposits.day = d.day;

  with cat_totals as (
    select
      ec.id as category_id,
      coalesce(ec.name, '(chưa phân loại)') as category_name,
      sum(e.amount) as amount,
      jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'business_date', to_char(e.business_date, 'YYYY-MM-DD'),
          'description', e.description,
          'amount', e.amount,
          'occurred_at', to_char(e.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS'),
          'note', e.note
        ) order by e.created_at desc
      ) as expenses
    from public.expenses e
    left join public.expense_categories ec on ec.id = e.category_id
    where e.business_date between p_start and p_end
      and (e.safe_transaction_id is null or public.app_role() = 'owner')
    group by ec.id, ec.name
  )
  select jsonb_agg(jsonb_build_object(
           'category_id', category_id,
           'category_name', category_name,
           'amount', amount,
           'pct', case when v_out = 0 then 0 else amount / v_out end,
           'expenses', expenses
         ) order by amount desc)
    into v_breakdown
    from cat_totals;

  v_result := jsonb_build_object(
    'in', v_in,
    'out', v_out,
    'net', v_in - v_out,
    'by_day', coalesce(v_by_day, '[]'::jsonb),
    'expense_breakdown', coalesce(v_breakdown, '[]'::jsonb)
  );

  if p_compare_start is not null and p_compare_end is not null then
    select coalesce(sum(net_amount), 0)
      into v_prev_in
      from public.sales_orders
     where business_date between p_compare_start and p_compare_end;
    select coalesce((select sum(amount) from public.expenses
                      where business_date between p_compare_start and p_compare_end
                        and (safe_transaction_id is null or public.app_role() = 'owner')), 0)
         + coalesce((select sum(total_pay) from public.shift_payroll_records
                      where business_date between p_compare_start and p_compare_end), 0)
      into v_prev_out;
    v_result := v_result || jsonb_build_object(
      'prev_in', v_prev_in,
      'prev_out', v_prev_out,
      'prev_net', v_prev_in - v_prev_out
    );
  end if;

  return v_result;
end;
$$;
