-- =============================================================================
-- Cash Flow Overview RPC (2026-05-23)
--
-- Returns the entire dashboard payload as JSONB:
--   { in, out, net, by_day[], top_categories[], prev_in?, prev_out?, prev_net? }
--
-- Auth: SECURITY DEFINER; first line raises if caller is not owner/manager.
-- Idempotent: CREATE OR REPLACE FUNCTION.
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
  v_top jsonb;
  v_result jsonb;
begin
  if not public.app_is_owner_manager() then
    raise exception 'forbidden: cash_flow_overview requires owner/manager';
  end if;

  -- IN / OUT for the current period
  select coalesce(sum(net_amount), 0)
    into v_in
    from public.sales_orders
   where purchase_at::date between p_start and p_end;

  select coalesce((select sum(amount) from public.expenses
                    where business_date between p_start and p_end), 0)
       + coalesce((select sum(total_pay) from public.shift_payroll_records
                    where business_date between p_start and p_end), 0)
    into v_out;

  -- by_day: every day in the range, even those with zero activity
  with d as (
    select dd::date as day
      from generate_series(p_start, p_end, interval '1 day') dd
  ),
  ins as (
    select purchase_at::date as day, sum(net_amount) as amt
      from public.sales_orders
     where purchase_at::date between p_start and p_end
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
  )
  select jsonb_agg(jsonb_build_object(
           'date', to_char(d.day, 'YYYY-MM-DD'),
           'in', coalesce(ins.amt, 0),
           'out', coalesce(outs.amt, 0)
         ) order by d.day)
    into v_by_day
    from d
    left join ins on ins.day = d.day
    left join outs on outs.day = d.day;

  -- top_categories: top-5 expense categories (payroll excluded)
  with totals as (
    select coalesce(ec.name, '(chưa phân loại)') as name, sum(e.amount) as amt
      from public.expenses e
      left join public.expense_categories ec on ec.id = e.category_id
     where e.business_date between p_start and p_end
     group by 1
     order by amt desc
     limit 5
  )
  select jsonb_agg(jsonb_build_object(
           'category_name', name,
           'amount', amt,
           'pct', case when v_out = 0 then 0 else amt / v_out end
         ) order by amt desc)
    into v_top
    from totals;

  v_result := jsonb_build_object(
    'in', v_in,
    'out', v_out,
    'net', v_in - v_out,
    'by_day', coalesce(v_by_day, '[]'::jsonb),
    'top_categories', coalesce(v_top, '[]'::jsonb)
  );

  if p_compare_start is not null and p_compare_end is not null then
    select coalesce(sum(net_amount), 0)
      into v_prev_in
      from public.sales_orders
     where purchase_at::date between p_compare_start and p_compare_end;
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
  'Cash-flow overview JSONB for owner/manager. Spec: docs/superpowers/specs/2026-05-23-cash-flow-overview-design.md';
