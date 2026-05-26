-- =============================================================================
-- pgTAP: 6 public views phải luôn có security_invoker=on
-- =============================================================================
-- Guard rằng ai recreate view trong tương lai mà quên WITH (security_invoker=true)
-- sẽ bị CI chặn. Linter Supabase đã từng flag 6 view này (level ERROR / SECURITY).

begin;
select plan(6);

create or replace function pg_temp.has_security_invoker(p_view text) returns boolean
language sql stable as $fn$
  select coalesce(
    array_to_string(reloptions, ',') like '%security_invoker=on%' or
    array_to_string(reloptions, ',') like '%security_invoker=true%',
    false
  )
  from pg_class
  where relname = p_view
    and relnamespace = 'public'::regnamespace
    and relkind = 'v';
$fn$;

select ok(pg_temp.has_security_invoker('daily_product_summary_view'),
          'daily_product_summary_view: security_invoker=on');
select ok(pg_temp.has_security_invoker('product_sales_hourly_view'),
          'product_sales_hourly_view: security_invoker=on');
select ok(pg_temp.has_security_invoker('cash_drawer_timeline_view'),
          'cash_drawer_timeline_view: security_invoker=on');
select ok(pg_temp.has_security_invoker('cash_reconciliation_input_view'),
          'cash_reconciliation_input_view: security_invoker=on');
select ok(pg_temp.has_security_invoker('daily_cash_summary_view'),
          'daily_cash_summary_view: security_invoker=on');
select ok(pg_temp.has_security_invoker('daily_cash_close_report_view'),
          'daily_cash_close_report_view: security_invoker=on');

select * from finish();
rollback;
