-- 2026-06-24-realtime-labor-cost.sql
-- Feature: "Lương hôm nay (tạm tính)" trên Dashboard.
-- (1) dashboard_daily_ops trả thêm 3 trường để client tính chi phí lương real-time:
--       payroll_total_all  = Σ total_pay đã chốt hôm nay (MỌI payment_method;
--                            khác payroll_paid/payroll_cash_total chỉ tiền mặt).
--       active_shifts      = [{check_in_at, hourly_rate}] các ca đang mở hôm nay.
--       shift_bonus_config = config phụ cấp (đọc trong RPC security definer nên
--                            mọi role xem dashboard đều có — kể cả employee_viewer).
--     RPC security definer ⇒ employee_viewer (bị RLS chặn đọc thẳng shift_*) vẫn
--     thấy đúng số. KHÔNG query thẳng bảng shift_* ở client.
-- (2) Bật Supabase Realtime cho shift_assignments + shift_payroll_records để
--     vào/ra ca & sửa lương invalidate dashboard ngay. Idempotent (có guard).
--
-- Idempotent: create or replace (giữ signature + grant cũ ở 003_rls.sql).

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
  v_payroll_all numeric(14,2) := 0;
  v_active integer := 0;
  v_active_shifts jsonb;
  v_bonus_config jsonb;
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
  select coalesce(sum(total_pay), 0) into v_payroll_all from public.shift_payroll_records where business_date = p_business_date;
  select count(*) into v_active from public.shift_assignments where business_date = p_business_date and status = 'checked_in';

  select coalesce(jsonb_agg(jsonb_build_object('check_in_at', sa.check_in_at, 'hourly_rate', coalesce(e.hourly_rate, 0)) order by sa.check_in_at), '[]'::jsonb)
  into v_active_shifts
  from public.shift_assignments sa
  join public.employees e on e.id = sa.employee_id
  where sa.business_date = p_business_date
    and sa.status = 'checked_in'
    and sa.check_out_at is null
    and sa.check_in_at is not null;

  select value into v_bonus_config from public.app_settings where key = 'shift_bonus_config';
  v_bonus_config := coalesce(v_bonus_config, '{"threshold_hours": 7, "bonus_amount": 10000}'::jsonb);

  select to_jsonb(cc) into v_latest_count from (select id, business_date, count_type, counted_at, total_physical, total_theory, difference, pos_total, pos_cash_total, pos_non_cash_total, opening_cash, bank_transfer_confirmed, reconciliation_total from public.cash_counts where business_date = p_business_date order by counted_at desc limit 1) cc;
  select to_jsonb(sr) into v_latest_sync from (select id, source, status, started_at, finished_at from public.sales_sync_runs where business_date_from <= p_business_date and business_date_to >= p_business_date order by finished_at desc nulls last limit 1) sr;

  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'business_date', e.business_date, 'description', e.description, 'quantity', e.quantity, 'unit', e.unit, 'unit_price', e.unit_price, 'amount', e.amount, 'note', e.note, 'created_at', e.created_at, 'category_id', e.category_id, 'category_name', c.name) order by e.created_at desc), '[]'::jsonb)
  into v_expense_list
  from public.expenses e left join public.expense_categories c on c.id = e.category_id
  where e.business_date = p_business_date;

  select coalesce(jsonb_agg(jsonb_build_object('id', so.id, 'invoice_code', so.invoice_code, 'order_code', so.table_or_order_code, 'sold_by_name', so.sold_by_name, 'payment_method', coalesce(sp.payment_method, 'mixed'), 'net_amount', so.net_amount, 'total_payment', so.total_payment, 'purchase_at', so.purchase_at) order by so.purchase_at desc), '[]'::jsonb)
  into v_sales_list
  from public.sales_orders so
  left join lateral (select payment_method from public.sales_payments sp where sp.sales_order_id = so.id order by amount desc limit 1) sp on true
  where so.business_date = p_business_date;

  return jsonb_build_object('business_date', p_business_date, 'total_sales', v_sales, 'cash_sales', v_cash, 'non_cash_sales', v_non_cash, 'opening_cash', v_opening, 'total_expenses', v_expenses, 'payroll_paid', v_payroll, 'payroll_total_all', v_payroll_all, 'active_staff', v_active, 'active_shifts', v_active_shifts, 'shift_bonus_config', v_bonus_config, 'latest_cash_count', v_latest_count, 'latest_sync', v_latest_sync, 'expenses', v_expense_list, 'sales_orders', v_sales_list);
end;
$$;

-- Realtime publication cho ca/lương (idempotent — chỉ add nếu chưa là member).
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_assignments') then
    alter publication supabase_realtime add table public.shift_assignments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_payroll_records') then
    alter publication supabase_realtime add table public.shift_payroll_records;
  end if;
end $$;
