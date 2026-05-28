-- =============================================================================
-- Cash Flow Overview RPC (2026-05-28) — Per-day safe_deposit + expense breakdown
--
-- Extends the existing function (created 2026-05-23):
--   * by_day[].safe_deposit: numeric — sum of cash_close_reports.safe_deposit_amount
--     per business_date where status <> 'voided'
--   * expense_breakdown[]: REPLACES top_categories[] — full list of categories
--     (sorted by amount desc) with nested expenses array for drill-down.
--
-- Auth: SECURITY DEFINER; first line raises if caller is not owner/manager.
-- Idempotent: create or replace function (signature unchanged).
-- =============================================================================

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

  -- IN / OUT for the current period
  select coalesce(sum(net_amount), 0)
    into v_in
    from public.sales_orders
   where business_date between p_start and p_end;

  select coalesce((select sum(amount) from public.expenses
                    where business_date between p_start and p_end), 0)
       + coalesce((select sum(total_pay) from public.shift_payroll_records
                    where business_date between p_start and p_end), 0)
    into v_out;

  -- by_day: every day in the range, even days with zero activity
  -- Now includes safe_deposit per day (from cash_close_reports.safe_deposit_amount,
  -- excluding voided reports).
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
       and status <> 'voided'
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

  -- expense_breakdown: ALL categories with nested expense list per category,
  -- ordered by total amount desc. Payroll is excluded (matches prior behavior).
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
          'occurred_at', to_char(e.occurred_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS'),
          'note', e.note
        ) order by e.occurred_at desc
      ) as expenses
    from public.expenses e
    left join public.expense_categories ec on ec.id = e.category_id
    where e.business_date between p_start and p_end
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
                      where business_date between p_compare_start and p_compare_end), 0)
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

revoke all on function public.cash_flow_overview(date, date, date, date) from public;
grant execute on function public.cash_flow_overview(date, date, date, date) to authenticated;

comment on function public.cash_flow_overview(date, date, date, date) is
  'Cash-flow overview JSONB for owner/manager. v2 (2026-05-28): + safe_deposit per day, expense_breakdown (replaces top_categories). Spec: docs/superpowers/specs/2026-05-28-cashflow-per-day-breakdown-design.md';
