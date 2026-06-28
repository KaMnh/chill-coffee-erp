-- =============================================================================
-- Chill Manager v2 — RPC functions + audit triggers
-- Apply order: 001 → 002 → 003 → 004
-- Fully idempotent — re-run an toàn (functions: create or replace; triggers: drop if exists).
-- Bao gồm:
--   - Auth helpers: app_role, app_is_owner_manager, app_is_staff_or_above
--   - Cash flow: compute_cash_theory, save_cash_day_opening, save_cash_count,
--     finalize_cash_close_report, void_cash_close_report, list_cash_counts,
--     get_cash_close_report, get_cash_close_reports_by_date
--   - Dashboard: dashboard_daily_ops
--   - Expenses: create_expense, create_expense_template
--   - Shifts: check_in_employee, check_out_employee, edit_shift_payroll_record
--   - Self-check-in: check_in_self, get_my_checkin_status, add_shop_anchor,
--     remove_shop_anchor, record_shop_anchor_heartbeat, update_checkin_network_config,
--     fresh_anchor_ips
--   - POS sync: ingest_kiotviet_batch, get_last_sync_cursor
--   - Handover: get_or_create_handover_session, update_handover_task,
--     update_handover_note, complete_handover_session,
--     update_handover_default_tasks, update_handover_session_tasks
--   - Settings: update_sidebar_defaults, update_user_sidebar_config
--   - Audit: _audit_row_change + 8 trigger audit_*
-- =============================================================================

create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((
    select role from public.employee_accounts
    where auth_user_id = auth.uid() and status = 'active'
    limit 1
  ), 'anonymous');
$$;

create or replace function public.app_is_owner_manager()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$ select public.app_role() in ('owner','manager'); $$;

create or replace function public.app_is_staff_or_above()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$ select public.app_role() in ('owner','manager','staff_operator'); $$;

create or replace function public.app_is_owner()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select public.app_role() = 'owner'; $$;

create or replace view public.daily_product_summary_view
with (security_invoker = true) as
select
  so.business_date,
  soi.product_id,
  soi.product_code,
  soi.product_name,
  soi.category_name,
  sum(soi.quantity) as total_quantity,
  sum(soi.line_total) as total_revenue,
  count(distinct so.id) as order_count
from public.sales_orders so
join public.sales_order_items soi on soi.sales_order_id = so.id
group by so.business_date, soi.product_id, soi.product_code, soi.product_name, soi.category_name;

create or replace view public.product_sales_hourly_view
with (security_invoker = true) as
select
  so.business_date,
  date_trunc('hour', so.purchase_at) as sale_hour,
  soi.product_name,
  sum(soi.quantity) as total_quantity,
  sum(soi.line_total) as total_revenue
from public.sales_orders so
join public.sales_order_items soi on soi.sales_order_id = so.id
group by so.business_date, date_trunc('hour', so.purchase_at), soi.product_name;

create or replace view public.cash_drawer_timeline_view
with (security_invoker = true) as
select
  e.*,
  sum(case when e.direction = 'in' then e.amount when e.direction = 'out' then -e.amount else 0 end)
    over (partition by e.business_date order by e.occurred_at, e.created_at, e.id) as running_balance_delta
from public.cash_drawer_events e;

create or replace view public.cash_reconciliation_input_view
with (security_invoker = true) as
with openings as (
  select business_date, sum(opening_total) opening_cash from public.cash_day_openings group by business_date
), pos_cash as (
  select so.business_date, sum(sp.amount) pos_cash_total
  from public.sales_orders so join public.sales_payments sp on sp.sales_order_id = so.id
  where sp.payment_method = 'cash'
  group by so.business_date
), expenses as (
  select business_date, sum(amount) expense_cash_total from public.expenses where payment_method = 'cash' group by business_date
), payroll as (
  select business_date, sum(total_pay) payroll_cash_total from public.shift_payroll_records where payment_method = 'cash' group by business_date
)
select
  coalesce(o.business_date, p.business_date, e.business_date, pr.business_date) as business_date,
  coalesce(o.opening_cash, 0) as opening_cash,
  coalesce(p.pos_cash_total, 0) as pos_cash_total,
  coalesce(e.expense_cash_total, 0) as expense_cash_total,
  coalesce(pr.payroll_cash_total, 0) as payroll_cash_total,
  coalesce(o.opening_cash, 0) + coalesce(p.pos_cash_total, 0) - coalesce(e.expense_cash_total, 0) - coalesce(pr.payroll_cash_total, 0) as theory_cash
from openings o
full join pos_cash p using (business_date)
full join expenses e using (business_date)
full join payroll pr using (business_date);

create or replace view public.daily_cash_summary_view
with (security_invoker = true) as
select
  c.business_date,
  c.opening_cash,
  c.pos_cash_total,
  c.expense_cash_total,
  c.payroll_cash_total,
  c.theory_cash,
  cc.total_physical as latest_physical_cash,
  cc.difference as latest_difference,
  cc.counted_at as latest_counted_at
from public.cash_reconciliation_input_view c
left join lateral (
  select total_physical, difference, counted_at
  from public.cash_counts cc
  where cc.business_date = c.business_date
  order by counted_at desc
  limit 1
) cc on true;

-- Drop trước khi create để re-apply idempotent: r.* expand cash_close_reports.*
-- nên khi v2.2 add column safe_deposit_amount + leave_for_next_day, vị trí cột
-- closed_by_name dịch xuống → CREATE OR REPLACE VIEW fail (PG 42P16). CASCADE
-- drop cả get_cash_close_report + get_cash_close_reports_by_date +
-- get_cash_close_reports_by_period (SQL funcs),
-- chúng sẽ được create or replace lại bên dưới trong cùng file.
drop view if exists public.daily_cash_close_report_view cascade;

create view public.daily_cash_close_report_view
with (security_invoker = true) as
select
  r.*,
  coalesce(p.display_name, e.name) as closed_by_name
from public.cash_close_reports r
left join public.profiles p on p.id = r.closed_by
left join public.employee_accounts ea on ea.auth_user_id = r.closed_by
left join public.employees e on e.id = ea.employee_id;

create or replace function public.compute_cash_theory(
  p_business_date date,
  p_counted_at timestamptz default now(),
  p_bank_transfer_confirmed numeric default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_opening numeric(14,2) := 0;
  v_pos_total numeric(14,2) := 0;
  v_pos_cash numeric(14,2) := 0;
  v_pos_non_cash numeric(14,2) := 0;
  v_expense numeric(14,2) := 0;
  v_payroll numeric(14,2) := 0;
  v_expected_cash numeric(14,2) := 0;
  v_sync timestamptz;
begin
  if p_counted_at > now() + interval '5 minutes' then
    raise exception 'p_counted_at không được trong tương lai (>5 phút).';
  end if;
  if p_counted_at < (p_business_date::timestamptz - interval '7 days') then
    raise exception 'p_counted_at quá xa quá khứ (>7 ngày so với business_date).';
  end if;

  select coalesce(sum(opening_total), 0) into v_opening from public.cash_day_openings where business_date = p_business_date;
  -- Restore time filter `purchase_at <= p_counted_at` cho spot audit precision:
  -- giữa ngày user kiểm két nhanh, chỉ count orders đã xảy ra. Sau khi DB
  -- session đổi sang VN + backfill data cũ -7h (migration 2026-05-04-fix-
  -- kiotviet-tz.sql), purchase_at là UTC instant đúng → comparison an toàn.
  select coalesce(sum(net_amount), 0) into v_pos_total
  from public.sales_orders
  where business_date = p_business_date and purchase_at <= p_counted_at;
  select coalesce(sum(sp.amount), 0) into v_pos_cash
  from public.sales_orders so join public.sales_payments sp on sp.sales_order_id = so.id
  where so.business_date = p_business_date and sp.payment_method = 'cash' and so.purchase_at <= p_counted_at;
  v_pos_non_cash := greatest(0, v_pos_total - v_pos_cash);
  select coalesce(sum(amount), 0) into v_expense from public.expenses where business_date = p_business_date and payment_method = 'cash' and created_at <= p_counted_at;
  select coalesce(sum(total_pay), 0) into v_payroll from public.shift_payroll_records where business_date = p_business_date and payment_method = 'cash' and created_at <= p_counted_at;
  select max(finished_at) into v_sync from public.sales_sync_runs where status = 'success' and business_date_from <= p_business_date and business_date_to >= p_business_date;
  v_expected_cash := v_opening + v_pos_cash - v_expense - v_payroll;

  return jsonb_build_object(
    'business_date', p_business_date,
    'pos_total', v_pos_total,
    'opening_cash', v_opening,
    'pos_cash_total', v_pos_cash,
    'pos_non_cash_total', v_pos_non_cash,
    'bank_transfer_confirmed', coalesce(p_bank_transfer_confirmed, 0),
    'expense_cash_total', v_expense,
    'payroll_cash_total', v_payroll,
    'theory_cash', v_expected_cash,
    'sync_snapshot_at', v_sync
  );
end;
$$;

create or replace function public.save_cash_day_opening(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_date date := coalesce((p_payload->>'business_date')::date, current_date);
  v_denominations jsonb := coalesce(p_payload->'denominations_json', '{}'::jsonb);
  v_carried boolean := coalesce((p_payload->>'carried_from_previous_day')::boolean, false);
  v_total numeric(14,2) := 0;
  v_role text := public.app_role();
  v_existing public.cash_day_openings%rowtype;
  v_row public.cash_day_openings%rowtype;
begin
  if v_role not in ('owner','manager') then
    raise exception 'Bạn không có quyền nhập tiền đầu ngày.';
  end if;

  perform 1
  from jsonb_each_text(v_denominations) as d(k, v)
  where not (
    k ~ '^(1000|2000|5000|10000|20000|50000|100000|200000|500000)$'
    and v ~ '^[0-9]+$'
    and v::numeric between 0 and 10000
  );
  if found then
    raise exception 'denominations_json: chỉ chấp nhận mệnh giá VND 1k-500k và số lượng 0-10000.';
  end if;

  select coalesce(sum(key::numeric * value::numeric), 0)
  into v_total
  from jsonb_each_text(v_denominations);

  select * into v_existing
  from public.cash_day_openings
  where business_date = v_date;

  if found then
    if v_role <> 'owner' then
      raise exception 'Tiền đầu ngày đã lưu, chỉ chủ quán được chỉnh sửa.';
    end if;

    update public.cash_day_openings
    set denominations_json = v_denominations,
        opening_total = v_total,
        carried_from_previous_day = v_carried
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.cash_day_openings (
      business_date,
      denominations_json,
      opening_total,
      carried_from_previous_day,
      created_by
    )
    values (
      v_date,
      v_denominations,
      v_total,
      v_carried,
      auth.uid()
    )
    returning * into v_row;
  end if;

  delete from public.cash_drawer_events
  where business_date = v_date
    and event_type = 'opening_cash'
    and source = 'app_action';

  if v_total > 0 then
    insert into public.cash_drawer_events (
      business_date,
      occurred_at,
      event_type,
      direction,
      amount,
      created_by,
      source,
      note,
      raw_json
    )
    values (
      v_date,
      now(),
      'opening_cash',
      'in',
      v_total,
      auth.uid(),
      'app_action',
      'Tiền đầu ngày',
      to_jsonb(v_row)
    );
  end if;

  return to_jsonb(v_row);
end;
$$;

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

create or replace function public.create_expense(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_amount numeric(14,2);
  v_date date;
  v_template_id uuid;
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền tạo khoản chi.'; end if;
  if length(coalesce(p_payload->>'description','')) > 500 then
    raise exception 'description vượt 500 ký tự.';
  end if;
  if length(coalesce(p_payload->>'note','')) > 1000 then
    raise exception 'note vượt 1000 ký tự.';
  end if;
  v_amount := coalesce((p_payload->>'amount')::numeric, 0);
  v_date := coalesce((p_payload->>'business_date')::date, current_date);
  if v_amount < 0 or v_amount > 1000000000 then
    raise exception 'amount phải >= 0 và <= 1,000,000,000.';
  end if;
  if coalesce((p_payload->>'quantity')::numeric, 0) < 0
     or coalesce((p_payload->>'unit_price')::numeric, 0) < 0 then
    raise exception 'quantity/unit_price không được âm.';
  end if;
  v_template_id := nullif(p_payload->>'template_id','')::uuid;
  insert into public.expenses (business_date, category_id, template_id, description, quantity, unit, unit_price, amount, payment_method, note, created_by)
  values (v_date, nullif(p_payload->>'category_id','')::uuid, v_template_id, p_payload->>'description', coalesce((p_payload->>'quantity')::numeric, 1), p_payload->>'unit', coalesce((p_payload->>'unit_price')::numeric, 0), v_amount, coalesce(p_payload->>'payment_method','cash'), p_payload->>'note', auth.uid())
  returning id into v_id;

  -- Đếm lượt dùng mẫu chi: tăng usage_count + last_used_at để rail "Dùng nhiều
  -- nhất" (sort usage_count desc ở src/lib/data/expenses.ts) phản ánh đúng tần suất.
  if v_template_id is not null then
    update public.expense_templates
    set usage_count = usage_count + 1,
        last_used_at = now()
    where id = v_template_id;
  end if;

  if coalesce(p_payload->>'payment_method','cash') = 'cash' and v_amount > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, expense_id, created_by, source, note)
    values (v_date, now(), 'expense_cash_out', 'out', v_amount, v_id, auth.uid(), 'app_action', p_payload->>'description');
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;

-- Delete expense + cleanup cash_drawer_events tương ứng. cash_drawer_events
-- có FK ON DELETE SET NULL nên DELETE expense thẳng sẽ giữ event row với
-- expense_id=NULL nhưng `amount` còn → cash flow / theory_cash lệch. RPC này
-- xóa event trước, expense sau. Owner/manager only.
create or replace function public.delete_expense(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_expense public.expenses%rowtype;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ owner/manager được xóa khoản chi.';
  end if;

  select * into v_expense from public.expenses where id = p_id;
  if not found then
    raise exception 'Không tìm thấy khoản chi % để xóa.', p_id;
  end if;

  -- Dọn cash_drawer_events tương ứng TRƯỚC (audit_log trigger capture).
  -- Chỉ xóa event_type='expense_cash_out' để tránh động đến event types khác
  -- nếu sau này có (defensive).
  delete from public.cash_drawer_events
  where expense_id = p_id and event_type = 'expense_cash_out';

  -- DELETE expense (audit_log trigger capture event riêng).
  delete from public.expenses where id = p_id;

  return jsonb_build_object(
    'id', p_id,
    'business_date', v_expense.business_date,
    'amount', v_expense.amount,
    'payment_method', v_expense.payment_method
  );
end;
$$;

grant execute on function public.delete_expense(uuid) to authenticated;

create or replace function public.create_expense_template(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_label text := trim(coalesce(p_payload->>'label', ''));
  v_category uuid := nullif(p_payload->>'default_category_id','')::uuid;
  v_unit text := nullif(trim(coalesce(p_payload->>'default_unit', '')), '');
  v_price numeric(14,2) := coalesce(nullif(p_payload->>'last_unit_price','')::numeric, 0);
  v_row public.expense_templates%rowtype;
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền tạo mẫu chi.'; end if;
  if v_label = '' then raise exception 'Tên mẫu chi không được để trống.'; end if;

  select * into v_row
  from public.expense_templates
  where is_active and lower(trim(label)) = lower(v_label)
  limit 1;

  if found then
    update public.expense_templates
    set default_category_id = coalesce(v_category, default_category_id),
        default_unit = coalesce(v_unit, default_unit),
        last_unit_price = case when v_price > 0 then v_price else last_unit_price end,
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
  else
    insert into public.expense_templates (label, default_category_id, default_unit, last_unit_price, usage_count, is_active)
    values (v_label, v_category, v_unit, v_price, 0, true)
    returning * into v_row;
  end if;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.check_in_employee(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_employee uuid := (p_payload->>'employee_id')::uuid;
  v_date date := coalesce((p_payload->>'business_date')::date, current_date);
  v_check_in timestamptz := coalesce((p_payload->>'check_in_at')::timestamptz, now());
  v_id uuid;
begin
  if not public.app_is_owner() then raise exception 'Chỉ chủ quán được vào ca hộ. Nhân viên tự vào ca ở màn Chấm công.'; end if;

  -- Validate giờ vào ca trong cùng business_date (chống bypass frontend).
  -- DB session timezone = 'Asia/Ho_Chi_Minh' (set globally) → ::date cast tự
  -- extract VN local date. Trước đây phải explicit `at time zone` vì session
  -- UTC; giờ session VN nên không cần.
  if v_check_in::date <> v_date then
    raise exception 'Giờ vào ca % không khớp với ngày làm việc %.', v_check_in::date, v_date;
  end if;
  -- Reject giờ trong tương lai (>5 phút sai số đồng hồ)
  if v_check_in > now() + interval '5 minutes' then
    raise exception 'Giờ vào ca không được trong tương lai.';
  end if;

  -- Idempotency: nếu hôm nay đã có row checked_in cho employee này, trả về id đó
  -- (tránh tạo duplicate nếu user click "Vào ca" 2 lần). MUST filter business_date —
  -- nếu thiếu, stale checked_in row từ ngày khác (vd: hôm qua quên ra ca) sẽ match,
  -- RPC skip insert và trả về id ngày khác → frontend filter today không thấy →
  -- nhân viên không hiện ở "Đang làm việc" → không ra ca được.
  select id into v_id from public.shift_assignments
    where employee_id = v_employee
      and business_date = v_date
      and status = 'checked_in'
    order by check_in_at desc limit 1;
  if v_id is null then
    insert into public.shift_assignments (employee_id, business_date, check_in_at, status, created_by, updated_by)
    values (v_employee, v_date, v_check_in, 'checked_in', auth.uid(), auth.uid()) returning id into v_id;
  end if;
  return jsonb_build_object('shift_assignment_id', v_id);
end;
$$;

create or replace function public.check_out_employee(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_shift uuid := (p_payload->>'shift_assignment_id')::uuid;
  v_employee uuid := (p_payload->>'employee_id')::uuid;
  v_date date := coalesce((p_payload->>'business_date')::date, current_date);
  v_in timestamptz := coalesce((p_payload->>'check_in_at')::timestamptz, now());
  v_out timestamptz := coalesce((p_payload->>'check_out_at')::timestamptz, now());
  v_minutes integer;
  v_rate numeric(14,2);
  v_base numeric(14,2);
  v_allowance numeric(14,2) := coalesce((p_payload->>'allowance_amount')::numeric, 0);
  v_total numeric(14,2);
  v_payroll_id uuid;
begin
  if not public.app_is_owner() then raise exception 'Chỉ chủ quán được ra ca hộ. Nhân viên tự ra ca ở màn Chấm công.'; end if;
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;
  if v_out < v_in then raise exception 'Giờ ra không được nhỏ hơn giờ vào.'; end if;
  select hourly_rate into v_rate from public.employees where id = v_employee;
  v_minutes := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
  v_total := v_base + v_allowance;

  update public.shift_assignments set check_in_at = v_in, check_out_at = v_out, total_minutes = v_minutes, status = 'checked_out', updated_by = auth.uid() where id = v_shift;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, note, edited_by, edited_at, created_by)
  values (v_shift, v_employee, v_date, v_in, v_out, v_minutes, coalesce(v_rate, 0), v_base, v_allowance, v_total, p_payload->>'note', auth.uid(), now(), auth.uid())
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, note = excluded.note, edited_by = auth.uid(), edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, auth.uid(), 'app_action', 'Lương theo lượt ra ca');
  end if;

  return jsonb_build_object('shift_assignment_id', v_shift, 'payroll_record_id', v_payroll_id, 'total_pay', v_total);
end;
$$;

create or replace function public.edit_shift_payroll_record(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_payroll_id uuid := (p_payload->>'payroll_record_id')::uuid;
  v_record public.shift_payroll_records%rowtype;
  v_in timestamptz;
  v_out timestamptz;
  v_minutes integer;
  v_base numeric(14,2);
  v_allowance numeric(14,2);
  v_total numeric(14,2);
  v_note text;
begin
  if not public.app_is_owner() then raise exception 'Chỉ chủ quán được sửa lượt lương đã chốt.'; end if;

  select * into v_record
  from public.shift_payroll_records
  where id = v_payroll_id;

  if not found then
    raise exception 'Không tìm thấy dòng lương cần sửa.';
  end if;

  -- Chống sửa lương của ngày đã chốt két (final): cash_close_reports giữ
  -- payroll_cash_total dưới dạng snapshot khi finalize; sửa total_pay sau khi
  -- chốt sẽ làm lệch báo cáo so với ledger (cash_drawer_events). Flow sửa đúng
  -- = hủy báo cáo (void_cash_close_report) → sửa lương → finalize lại. Đồng bộ
  -- với guard sẵn có ở update_cash_count.
  if exists (
    select 1 from public.cash_close_reports
    where business_date = v_record.business_date and report_status = 'final'
  ) then
    raise exception 'Ngày % đã chốt két (final). Hủy báo cáo (qua flow void) trước khi sửa lương.', v_record.business_date;
  end if;

  v_in := coalesce((p_payload->>'check_in_at')::timestamptz, v_record.check_in_at);
  v_out := coalesce((p_payload->>'check_out_at')::timestamptz, v_record.check_out_at);
  v_allowance := coalesce((p_payload->>'allowance_amount')::numeric, v_record.allowance_amount, 0);
  v_note := case when p_payload ? 'note' then p_payload->>'note' else v_record.note end;

  if v_in is null or v_out is null then
    raise exception 'Thiếu giờ vào hoặc giờ ra.';
  end if;

  if v_out < v_in then
    raise exception 'Giờ ra không được nhỏ hơn giờ vào.';
  end if;

  v_minutes := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  v_base := round(((v_minutes::numeric / 60) * coalesce(v_record.hourly_rate, 0)) / 1000) * 1000;
  v_total := v_base + v_allowance;

  if v_record.shift_assignment_id is not null then
    update public.shift_assignments
    set check_in_at = v_in,
        check_out_at = v_out,
        total_minutes = v_minutes,
        status = 'checked_out',
        updated_by = auth.uid()
    where id = v_record.shift_assignment_id;
  end if;

  update public.shift_payroll_records
  set check_in_at = v_in,
      check_out_at = v_out,
      total_minutes = v_minutes,
      base_pay = v_base,
      allowance_amount = v_allowance,
      total_pay = v_total,
      note = v_note,
      edited_by = auth.uid(),
      edited_at = now()
  where id = v_payroll_id
  returning * into v_record;

  delete from public.cash_drawer_events
  where shift_payroll_record_id = v_payroll_id
    and event_type = 'payroll_cash_out';

  if v_total > 0 then
    insert into public.cash_drawer_events (
      business_date,
      occurred_at,
      event_type,
      direction,
      amount,
      shift_payroll_record_id,
      created_by,
      source,
      note
    )
    values (
      v_record.business_date,
      v_out,
      'payroll_cash_out',
      'out',
      v_total,
      v_payroll_id,
      auth.uid(),
      'app_action',
      'Sửa lượt lương đã chốt'
    );
  end if;

  return jsonb_build_object(
    'payroll_record_id', v_payroll_id,
    'shift_assignment_id', v_record.shift_assignment_id,
    'total_minutes', v_minutes,
    'base_pay', v_base,
    'allowance_amount', v_allowance,
    'total_pay', v_total
  );
end;
$$;

create or replace function public.save_cash_count(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_date date := coalesce((p_payload->>'business_date')::date, current_date);
  v_counted_at timestamptz := coalesce((p_payload->>'counted_at')::timestamptz, now());
  v_physical numeric(14,2) := coalesce((p_payload->>'total_physical')::numeric, 0);
  v_bank_transfer numeric(14,2) := coalesce((p_payload->>'bank_transfer_confirmed')::numeric, 0);
  v_theory jsonb;
  v_theory_cash numeric(14,2);
  v_pos_total numeric(14,2);
  v_pos_cash numeric(14,2);
  v_pos_non_cash numeric(14,2);
  v_opening numeric(14,2);
  v_expense numeric(14,2);
  v_payroll numeric(14,2);
  v_reconciliation numeric(14,2);
  v_difference numeric(14,2);
  v_id uuid;
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền kiểm két.'; end if;

  perform 1
  from jsonb_each_text(coalesce(p_payload->'denominations_json','{}'::jsonb)) as d(k, v)
  where not (
    k ~ '^(1000|2000|5000|10000|20000|50000|100000|200000|500000)$'
    and v ~ '^[0-9]+$'
    and v::numeric between 0 and 10000
  );
  if found then
    raise exception 'denominations_json: chỉ chấp nhận mệnh giá VND 1k-500k và số lượng 0-10000.';
  end if;

  v_theory := public.compute_cash_theory(v_date, v_counted_at, v_bank_transfer);
  v_theory_cash := (v_theory->>'theory_cash')::numeric;
  -- Manual POS override: nếu nhân viên nhập tay (POS không sync được, không kết nối...)
  -- thì ưu tiên giá trị từ payload. Validate: phải >= 0 và <= 1B VND.
  v_pos_total := coalesce(nullif(p_payload->>'pos_total','')::numeric, (v_theory->>'pos_total')::numeric);
  v_pos_cash := coalesce(nullif(p_payload->>'pos_cash_total','')::numeric, (v_theory->>'pos_cash_total')::numeric);
  v_pos_non_cash := coalesce(nullif(p_payload->>'pos_non_cash_total','')::numeric, (v_theory->>'pos_non_cash_total')::numeric);
  if v_pos_total < 0 or v_pos_cash < 0 or v_pos_non_cash < 0
     or v_pos_total > 1000000000 or v_pos_cash > 1000000000 or v_pos_non_cash > 1000000000 then
    raise exception 'POS manual override: giá trị không hợp lệ (phải 0–1.000.000.000).';
  end if;
  v_opening := (v_theory->>'opening_cash')::numeric;
  v_expense := (v_theory->>'expense_cash_total')::numeric;
  v_payroll := (v_theory->>'payroll_cash_total')::numeric;
  v_reconciliation := (v_physical - v_opening) + v_bank_transfer + v_expense + v_payroll;
  v_difference := v_pos_total - v_reconciliation;

  insert into public.cash_counts (business_date, counted_at, count_type, denominations_json, total_physical, total_theory, difference, pos_total, pos_cash_total, pos_non_cash_total, opening_cash, bank_transfer_confirmed, reconciliation_total, note, counted_by, sales_snapshot_at)
  values (v_date, v_counted_at, coalesce(p_payload->>'count_type','spot_audit'), coalesce(p_payload->'denominations_json','{}'::jsonb), v_physical, v_theory_cash, v_difference, v_pos_total, v_pos_cash, v_pos_non_cash, v_opening, v_bank_transfer, v_reconciliation, p_payload->>'note', auth.uid(), nullif(v_theory->>'sync_snapshot_at','')::timestamptz)
  returning id into v_id;

  insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, cash_count_id, created_by, source, note, raw_json)
  values (v_date, v_counted_at, 'cash_count_snapshot', 'snapshot', v_physical, v_id, auth.uid(), 'app_action', p_payload->>'note', v_theory);

  return jsonb_build_object('cash_count_id', v_id, 'difference', v_difference, 'reconciliation_total', v_reconciliation, 'theory', v_theory);
end;
$$;

-- Edit cash_count đã tạo (denominations + bank_transfer + note). Recompute
-- total_physical, theory, reconciliation, difference. Sync cash_drawer_events
-- snapshot row. Owner/manager only. Reject nếu shift_close + report final
-- (workflow: void report trước, dùng RPC void_cash_close_report).
create or replace function public.update_cash_count(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_count public.cash_counts%rowtype;
  v_denominations jsonb;
  v_physical numeric(14,2) := 0;
  v_bank_transfer numeric(14,2);
  v_note text;
  v_theory jsonb;
  v_theory_cash numeric(14,2);
  v_pos_total numeric(14,2);
  v_pos_cash numeric(14,2);
  v_pos_non_cash numeric(14,2);
  v_opening numeric(14,2);
  v_expense numeric(14,2);
  v_payroll numeric(14,2);
  v_reconciliation numeric(14,2);
  v_difference numeric(14,2);
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ owner/manager được sửa cash_count.';
  end if;

  select * into v_count from public.cash_counts where id = v_id for update;
  if not found then
    raise exception 'Không tìm thấy cash_count % để sửa.', v_id;
  end if;

  -- Reject nếu shift_close có report final
  if v_count.count_type = 'shift_close' and exists (
    select 1 from public.cash_close_reports
    where cash_count_id = v_id and report_status = 'final'
  ) then
    raise exception 'Báo cáo chốt két ngày % đã final. Hủy báo cáo (qua flow void) trước khi sửa count.', v_count.business_date;
  end if;

  -- Validate + extract denominations (reuse logic từ save_cash_count)
  v_denominations := coalesce(p_payload->'denominations_json', v_count.denominations_json);
  perform 1
  from jsonb_each_text(v_denominations) as d(k, v)
  where not (
    k ~ '^(1000|2000|5000|10000|20000|50000|100000|200000|500000)$'
    and v ~ '^[0-9]+$'
    and v::numeric between 0 and 10000
  );
  if found then
    raise exception 'denominations_json: chỉ chấp nhận mệnh giá VND 1k-500k và số lượng 0-10000.';
  end if;

  select coalesce(sum(key::numeric * value::numeric), 0)
  into v_physical
  from jsonb_each_text(v_denominations);

  -- bank_transfer_confirmed: NULL = giữ nguyên, else override
  v_bank_transfer := coalesce(
    nullif(p_payload->>'bank_transfer_confirmed','')::numeric,
    v_count.bank_transfer_confirmed
  );
  if v_bank_transfer < 0 or v_bank_transfer > 1000000000 then
    raise exception 'bank_transfer_confirmed phải 0..1.000.000.000.';
  end if;

  -- note: NULL = giữ nguyên, '' = clear
  v_note := case
    when p_payload ? 'note' then p_payload->>'note'
    else v_count.note
  end;

  -- Recompute theory dùng counted_at gốc + bank_transfer mới
  v_theory := public.compute_cash_theory(v_count.business_date, v_count.counted_at, v_bank_transfer);
  v_theory_cash := (v_theory->>'theory_cash')::numeric;
  v_pos_total := coalesce(nullif(v_count.pos_total, 0), (v_theory->>'pos_total')::numeric);
  v_pos_cash := coalesce(nullif(v_count.pos_cash_total, 0), (v_theory->>'pos_cash_total')::numeric);
  v_pos_non_cash := coalesce(nullif(v_count.pos_non_cash_total, 0), (v_theory->>'pos_non_cash_total')::numeric);
  v_opening := (v_theory->>'opening_cash')::numeric;
  v_expense := (v_theory->>'expense_cash_total')::numeric;
  v_payroll := (v_theory->>'payroll_cash_total')::numeric;
  v_reconciliation := (v_physical - v_opening) + v_bank_transfer + v_expense + v_payroll;
  v_difference := v_pos_total - v_reconciliation;

  -- UPDATE cash_counts
  update public.cash_counts set
    denominations_json = v_denominations,
    total_physical = v_physical,
    total_theory = v_theory_cash,
    bank_transfer_confirmed = v_bank_transfer,
    reconciliation_total = v_reconciliation,
    difference = v_difference,
    pos_total = v_pos_total,
    pos_cash_total = v_pos_cash,
    pos_non_cash_total = v_pos_non_cash,
    opening_cash = v_opening,
    note = v_note
  where id = v_id;

  -- Sync cash_drawer_events.cash_count_snapshot
  update public.cash_drawer_events set
    amount = v_physical,
    note = v_note,
    raw_json = v_theory
  where cash_count_id = v_id and event_type = 'cash_count_snapshot';

  return jsonb_build_object(
    'cash_count_id', v_id,
    'total_physical', v_physical,
    'difference', v_difference,
    'reconciliation_total', v_reconciliation
  );
end;
$$;

grant execute on function public.update_cash_count(jsonb) to authenticated;

-- finalize_cash_close_report 1-arg version đã được thay thế bởi 3-arg version
-- ở dưới (cùng file). Lý do bỏ: trước đây có 3 overload (1/2/3 args) gây
-- ambiguous resolution. v4.1.11+ chỉ giữ 3-arg với defaults — backward compatible
-- cho mọi client cũ.

-- Void báo cáo chốt két + reverse safe deposit nếu có. Phase 1 v2.2.x:
-- trước đây chỉ set status='voided' → safe_transactions.deposit_close vẫn còn
-- → balance không đúng. Giờ: insert adjustment ngược (-safe_deposit_amount)
-- để balance về đúng trạng thái trước khi finalize. Giữ deposit gốc + voided
-- row + adjustment cho audit trail đầy đủ.
create or replace function public.void_cash_close_report(p_report_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_report public.cash_close_reports%rowtype;
  v_adjustment_id uuid;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ owner/manager được hủy báo cáo chốt két.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Lý do hủy phải ≥ 5 ký tự.';
  end if;

  select * into v_report from public.cash_close_reports where id = p_report_id for update;
  if not found then
    raise exception 'Không tìm thấy báo cáo % để hủy.', p_report_id;
  end if;
  if v_report.report_status <> 'final' then
    raise exception 'Báo cáo % đang ở trạng thái %, không thể hủy (chỉ hủy được báo cáo final).', p_report_id, v_report.report_status;
  end if;

  -- Validate từng quỹ đủ để reverse: cash = safe_deposit_amount; transfer = bank_transfer_confirmed.
  if v_report.safe_deposit_amount > 0
     and public.safe_fund_balance_now('cash') < v_report.safe_deposit_amount then
    raise exception 'Quỹ tiền mặt không đủ để hủy báo cáo này. Cần %, hiện có %. Hoàn tác mở két ngày sau trước khi hủy.',
      v_report.safe_deposit_amount, public.safe_fund_balance_now('cash');
  end if;
  if coalesce(v_report.bank_transfer_confirmed, 0) > 0
     and public.safe_fund_balance_now('transfer') < v_report.bank_transfer_confirmed then
    raise exception 'Quỹ chuyển khoản không đủ để hủy báo cáo này. Cần %, hiện có %.',
      v_report.bank_transfer_confirmed, public.safe_fund_balance_now('transfer');
  end if;

  -- Update report status (audit_cash_close trigger sẽ log change vào audit_log)
  update public.cash_close_reports
  set report_status = 'voided',
      void_reason = p_reason,
      voided_by = auth.uid(),
      voided_at = now()
  where id = p_report_id;

  -- Reverse deposit theo TỪNG quỹ qua adjustment ngược (KHÔNG xóa deposit_close gốc).
  if v_report.safe_deposit_amount > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund,
      description, cash_close_report_id, created_by
    ) values (
      'adjustment',
      -v_report.safe_deposit_amount,
      public.safe_fund_balance_now('cash') - v_report.safe_deposit_amount,
      'cash',
      'Reverse tiền mặt từ chốt két ngày ' || v_report.business_date::text || ' (voided): ' || left(p_reason, 80),
      p_report_id,
      auth.uid()
    ) returning id into v_adjustment_id;
  end if;
  if coalesce(v_report.bank_transfer_confirmed, 0) > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund,
      description, cash_close_report_id, created_by
    ) values (
      'adjustment',
      -v_report.bank_transfer_confirmed,
      public.safe_fund_balance_now('transfer') - v_report.bank_transfer_confirmed,
      'transfer',
      'Reverse chuyển khoản từ chốt két ngày ' || v_report.business_date::text || ' (voided): ' || left(p_reason, 80),
      p_report_id,
      auth.uid()
    );
  end if;

  return jsonb_build_object(
    'report_id', p_report_id,
    'status', 'voided',
    'reversed_safe_amount', coalesce(v_report.safe_deposit_amount, 0),
    'adjustment_id', v_adjustment_id
  );
end;
$$;

grant execute on function public.void_cash_close_report(uuid, text) to authenticated;

-- Edit báo cáo chốt két đã final. Cho phép sửa note + leave_for_next_day.
-- Side effect: leave đổi → safe_deposit_amount đổi → INSERT adjustment để
-- bù sai khoản trong sổ quỹ. Các snapshot field khác (POS, opening, physical)
-- immutable — muốn đổi phải void + finalize lại với cash_count mới.
create or replace function public.edit_cash_close_report(
  p_report_id uuid,
  p_note text default null,
  p_leave_for_next_day numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_report public.cash_close_reports%rowtype;
  v_new_leave numeric(14,2);
  v_new_deposit numeric(14,2);
  v_diff numeric(14,2);
  v_safe_balance numeric(14,2);
  v_adjustment_id uuid;
  v_new_note text;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ owner/manager được sửa báo cáo chốt két.';
  end if;

  select * into v_report from public.cash_close_reports where id = p_report_id for update;
  if not found then
    raise exception 'Không tìm thấy báo cáo % để sửa.', p_report_id;
  end if;
  if v_report.report_status <> 'final' then
    raise exception 'Báo cáo % đang ở trạng thái %, không thể sửa (chỉ sửa được báo cáo final).', p_report_id, v_report.report_status;
  end if;

  -- Note: NULL = giữ nguyên, '' (empty) = clear
  v_new_note := case when p_note is null then v_report.note else p_note end;

  -- leave_for_next_day: NULL = giữ nguyên
  v_new_leave := coalesce(p_leave_for_next_day, v_report.leave_for_next_day);
  if v_new_leave < 0 then
    raise exception 'leave_for_next_day không được âm.';
  end if;
  if v_new_leave > v_report.physical_cash then
    raise exception 'leave_for_next_day (%) không được vượt physical_cash (%).', v_new_leave, v_report.physical_cash;
  end if;

  v_new_deposit := v_report.physical_cash - v_new_leave;
  v_diff := v_new_deposit - v_report.safe_deposit_amount;

  -- Validate balance nếu phải rút bớt khỏi safe (diff < 0).
  -- Leave-change chỉ ảnh hưởng QUỸ TIỀN MẶT (deposit cash); quỹ CK giữ nguyên.
  if v_diff < 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    v_safe_balance := public.safe_fund_balance_now('cash');
    if v_safe_balance < abs(v_diff) then
      raise exception 'Quỹ tiền mặt không đủ để giảm khoản nạp. Cần rút %, hiện có %. Hoàn tác mở két ngày sau (rút từ sổ quỹ) trước.',
        abs(v_diff), v_safe_balance;
    end if;
  elsif v_diff > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
  end if;

  -- Update report
  update public.cash_close_reports
  set note = v_new_note,
      leave_for_next_day = v_new_leave,
      safe_deposit_amount = v_new_deposit,
      updated_at = now()
  where id = p_report_id;

  -- Insert adjustment nếu safe_deposit thay đổi — chain từ QUỸ TIỀN MẶT.
  if v_diff <> 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund,
      description, cash_close_report_id, created_by
    ) values (
      'adjustment',
      v_diff,
      public.safe_fund_balance_now('cash') + v_diff,
      'cash',
      'Sửa chốt két ngày ' || v_report.business_date::text || ': leave ' ||
        v_report.leave_for_next_day::text || ' → ' || v_new_leave::text,
      p_report_id,
      auth.uid()
    ) returning id into v_adjustment_id;
  end if;

  return jsonb_build_object(
    'report_id', p_report_id,
    'note', v_new_note,
    'leave_for_next_day', v_new_leave,
    'safe_deposit_amount', v_new_deposit,
    'safe_diff', v_diff,
    'adjustment_id', v_adjustment_id
  );
end;
$$;

grant execute on function public.edit_cash_close_report(uuid, text, numeric) to authenticated;

create or replace function public.list_cash_counts(p_business_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_result jsonb;
begin
  -- Reuse RLS contract: staff_or_above mới được xem lịch sử kiểm két.
  if not public.app_is_staff_or_above() then
    raise exception 'Bạn không có quyền xem lịch sử kiểm két.';
  end if;

  select coalesce(jsonb_agg(item order by item->>'counted_at' desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', cc.id,
      'business_date', cc.business_date,
      'count_type', cc.count_type,
      'counted_at', cc.counted_at,
      'total_physical', cc.total_physical,
      'total_theory', cc.total_theory,
      'difference', cc.difference,
      'pos_total', cc.pos_total,
      'pos_cash_total', cc.pos_cash_total,
      'pos_non_cash_total', cc.pos_non_cash_total,
      'opening_cash', cc.opening_cash,
      'bank_transfer_confirmed', cc.bank_transfer_confirmed,
      'reconciliation_total', cc.reconciliation_total,
      'denominations_json', cc.denominations_json,
      'note', cc.note,
      'report_id', ccr.id,
      'report_status', ccr.report_status
    ) as item
    from public.cash_counts cc
    left join public.cash_close_reports ccr on ccr.cash_count_id = cc.id
    where cc.business_date = p_business_date
  ) sub;

  return v_result;
end$$;

grant execute on function public.list_cash_counts(date) to authenticated;

create or replace function public.get_cash_close_report(p_report_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select to_jsonb(r) from public.daily_cash_close_report_view r where r.id = p_report_id and (public.app_is_owner_manager() or public.app_role() = 'staff_operator');
$$;

create or replace function public.get_cash_close_reports_by_date(p_business_date date)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.closed_at desc), '[]'::jsonb)
  from public.daily_cash_close_report_view r
  where r.business_date = p_business_date and (public.app_is_owner_manager() or public.app_role() = 'staff_operator');
$$;

create or replace function public.get_cash_close_reports_by_period(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.business_date desc, r.closed_at desc), '[]'::jsonb)
  from public.daily_cash_close_report_view r
  where r.business_date between p_from and p_to and (public.app_is_owner_manager() or public.app_role() = 'staff_operator');
$$;

grant execute on function public.get_cash_close_reports_by_period(date, date) to authenticated;

create or replace function public.ingest_kiotviet_batch(p_payload jsonb)
returns jsonb
language plpgsql
security definer
-- 'extensions' phải có trong search_path để tìm được crypt() (pgcrypto).
-- Supabase mặc định cài pgcrypto vào schema 'extensions' (không phải public).
set search_path = public, extensions, auth
as $$
declare
  v_client_id text := p_payload->>'client_id';
  v_client_secret text := p_payload->>'client_secret';
  v_client uuid;
  v_batch text := coalesce(p_payload->>'batch_id', gen_random_uuid()::text);
  v_run_id uuid;
  v_order jsonb;
  v_item jsonb;
  v_payment jsonb;
  v_order_id uuid;
  v_payment_id uuid;
  v_order_key text;
  v_idx integer;
  v_orders integer := 0;
  v_items integer := 0;
  v_payments integer := 0;
  v_payment_method text;
  v_payment_amount numeric(14,2);
  v_cash_received numeric(14,2);
  v_change_given numeric(14,2);
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_net numeric(14,2);
  v_total_payment numeric(14,2);
  v_qty numeric;
  v_price numeric;
  v_item_disc numeric;
  v_line_total numeric;
  v_max_amount constant numeric := 1000000000;
  v_max_qty constant numeric := 9999;
begin
  select id into v_client from public.integration_clients
  where client_id = v_client_id
    and is_active = true
    and client_secret_hash = crypt(v_client_secret, client_secret_hash)
  limit 1;
  if v_client is null then raise exception 'Integration client không hợp lệ.'; end if;

  update public.integration_clients set last_used_at = now() where id = v_client;

  insert into public.sales_sync_runs (batch_id, source, status, started_at, finished_at, business_date_from, business_date_to, raw_json)
  values (v_batch, coalesce(p_payload->>'source','kiotviet'), 'running', coalesce((p_payload->>'started_at')::timestamptz, now()), null, nullif(p_payload->>'business_date_from','')::date, nullif(p_payload->>'business_date_to','')::date, p_payload)
  on conflict (batch_id) do update set status = 'running', started_at = excluded.started_at, raw_json = excluded.raw_json
  returning id into v_run_id;

  for v_order in select * from jsonb_array_elements(coalesce(p_payload->'orders','[]'::jsonb)) loop
    v_order_key := coalesce(nullif(v_order->>'kiotviet_invoice_id',''), nullif(v_order->>'kiotviet_id',''), nullif(v_order->>'id',''), nullif(v_order->>'invoiceId',''), nullif(v_order->>'invoice_code',''), gen_random_uuid()::text);

    v_gross := coalesce(nullif(v_order->>'gross_amount','')::numeric, 0);
    v_discount := coalesce(nullif(v_order->>'discount_amount','')::numeric, 0);
    v_net := coalesce(nullif(v_order->>'net_amount','')::numeric, coalesce(nullif(v_order->>'total_payment','')::numeric, 0));
    v_total_payment := coalesce(nullif(v_order->>'total_payment','')::numeric, coalesce(nullif(v_order->>'net_amount','')::numeric, 0));
    if v_gross < 0 or v_discount < 0 or v_net < 0 or v_total_payment < 0 then
      raise exception 'ingest_kiotviet_batch: số tiền âm tại order=%', v_order_key;
    end if;
    if v_gross > v_max_amount or v_net > v_max_amount or v_total_payment > v_max_amount then
      raise exception 'ingest_kiotviet_batch: số tiền vượt ngưỡng (>%) tại order=%', v_max_amount, v_order_key;
    end if;

    insert into public.sales_orders (
      kiotviet_invoice_id, invoice_uuid, invoice_code, kiotviet_order_id, order_uuid, table_or_order_code,
      purchase_at, business_date, branch_id, branch_name, sold_by_id, sold_by_name, customer_code, customer_name,
      gross_amount, discount_amount, net_amount, total_payment, status_code, status_value, using_cod, source_created_at, sync_run_id, raw_json
    ) values (
      v_order_key,
      nullif(v_order->>'invoice_uuid',''),
      coalesce(v_order->>'invoice_code', v_order->>'code'),
      nullif(v_order->>'kiotviet_order_id',''),
      nullif(v_order->>'order_uuid',''),
      coalesce(v_order->>'table_or_order_code', v_order->>'order_code'),
      coalesce(nullif(v_order->>'purchase_at','')::timestamptz, now()),
      coalesce(nullif(v_order->>'business_date','')::date, coalesce(nullif(v_order->>'purchase_at','')::timestamptz, now())::date),
      nullif(v_order->>'branch_id',''),
      v_order->>'branch_name',
      nullif(v_order->>'sold_by_id',''),
      v_order->>'sold_by_name',
      v_order->>'customer_code',
      v_order->>'customer_name',
      v_gross,
      v_discount,
      v_net,
      v_total_payment,
      v_order->>'status_code',
      v_order->>'status_value',
      nullif(v_order->>'using_cod','')::boolean,
      nullif(v_order->>'source_created_at','')::timestamptz,
      v_run_id,
      v_order
    )
    on conflict (kiotviet_invoice_id) do update set
      invoice_uuid = excluded.invoice_uuid,
      invoice_code = excluded.invoice_code,
      kiotviet_order_id = excluded.kiotviet_order_id,
      order_uuid = excluded.order_uuid,
      table_or_order_code = excluded.table_or_order_code,
      purchase_at = excluded.purchase_at,
      business_date = excluded.business_date,
      branch_id = excluded.branch_id,
      branch_name = excluded.branch_name,
      sold_by_id = excluded.sold_by_id,
      sold_by_name = excluded.sold_by_name,
      customer_code = excluded.customer_code,
      customer_name = excluded.customer_name,
      gross_amount = excluded.gross_amount,
      discount_amount = excluded.discount_amount,
      net_amount = excluded.net_amount,
      total_payment = excluded.total_payment,
      status_code = excluded.status_code,
      status_value = excluded.status_value,
      using_cod = excluded.using_cod,
      source_created_at = excluded.source_created_at,
      sync_run_id = excluded.sync_run_id,
      raw_json = excluded.raw_json
    returning id into v_order_id;

    delete from public.sales_order_items where sales_order_id = v_order_id;
    delete from public.cash_drawer_events where sales_order_id = v_order_id and source = 'pos_sync';
    delete from public.sales_payments where sales_order_id = v_order_id;

    v_idx := 0;
    for v_item in select * from jsonb_array_elements(coalesce(v_order->'invoice_details', v_order->'items', '[]'::jsonb)) loop
      v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
      v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, 0);
      v_item_disc := coalesce(nullif(v_item->>'discount_amount','')::numeric, 0);
      v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, v_qty * v_price);
      if v_qty < 0 or v_price < 0 or v_item_disc < 0 or v_line_total < 0 then
        raise exception 'ingest_kiotviet_batch: numeric âm tại order=% item=%', v_order_key, v_idx;
      end if;
      if v_qty > v_max_qty or v_price > v_max_amount or v_line_total > v_max_amount then
        raise exception 'ingest_kiotviet_batch: vượt ngưỡng tại order=% item=%', v_order_key, v_idx;
      end if;

      insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, quantity, unit_price, discount_amount, discount_ratio, line_total, note, return_quantity, category_name, raw_json)
      values (
        v_order_id,
        v_idx,
        coalesce(nullif(v_item->>'item_key',''), nullif(v_item->>'id',''), coalesce(v_item->>'product_id','product') || '-' || v_idx::text),
        nullif(v_item->>'product_id',''),
        nullif(v_item->>'product_code',''),
        coalesce(v_item->>'product_name', v_item->>'name', 'Sản phẩm'),
        v_qty,
        v_price,
        v_item_disc,
        coalesce(nullif(v_item->>'discount_ratio','')::numeric, 0),
        v_line_total,
        v_item->>'note',
        coalesce(nullif(v_item->>'return_quantity','')::numeric, 0),
        v_item->>'category_name',
        v_item
      );
      v_idx := v_idx + 1;
      v_items := v_items + 1;
    end loop;

    for v_payment in select * from jsonb_array_elements(coalesce(v_order->'payments', jsonb_build_array(jsonb_build_object('payment_method', coalesce(v_order->>'payment_method', case when coalesce(nullif(v_order->>'using_cod','')::boolean, false) then 'cash' else 'unknown' end), 'amount', coalesce(v_order->>'total_payment', v_order->>'net_amount'))))) loop
      v_payment_method := lower(coalesce(v_payment->>'payment_method', v_payment->>'method', 'unknown'));
      v_payment_amount := coalesce(nullif(v_payment->>'amount','')::numeric, 0);
      v_cash_received := nullif(v_payment->>'cash_received','')::numeric;
      v_change_given := nullif(v_payment->>'change_given','')::numeric;
      if v_payment_amount < 0 or coalesce(v_cash_received, 0) < 0 or coalesce(v_change_given, 0) < 0 then
        raise exception 'ingest_kiotviet_batch: payment âm tại order=%', v_order_key;
      end if;
      if v_payment_amount > v_max_amount
         or coalesce(v_cash_received, 0) > v_max_amount
         or coalesce(v_change_given, 0) > v_max_amount then
        raise exception 'ingest_kiotviet_batch: payment vượt ngưỡng tại order=%', v_order_key;
      end if;
      if v_payment_method = 'cash'
         and v_cash_received is not null
         and v_cash_received < v_payment_amount then
        raise exception 'ingest_kiotviet_batch: cash_received (%) < amount (%) tại order=%', v_cash_received, v_payment_amount, v_order_key;
      end if;

      insert into public.sales_payments (sales_order_id, payment_method, amount, cash_received, change_given, payment_time, source, confidence, raw_json)
      values (v_order_id, v_payment_method, v_payment_amount, v_cash_received, v_change_given, coalesce(nullif(v_payment->>'payment_time','')::timestamptz, (v_order->>'purchase_at')::timestamptz, now()), coalesce(v_payment->>'source','kiotviet'), coalesce(v_payment->>'confidence', case when v_payment ? 'amount' then 'exact' else 'derived' end), v_payment)
      returning id into v_payment_id;

      if v_payment_method = 'cash' then
        if v_cash_received is not null and v_change_given is not null then
          insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
          select business_date, purchase_at, 'customer_cash_received', 'in', v_cash_received, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
          if v_change_given > 0 then
            insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
            select business_date, purchase_at, 'change_given', 'out', v_change_given, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
          end if;
        else
          insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
          select business_date, purchase_at, 'pos_cash_in', 'in', v_payment_amount, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
        end if;
      end if;
      v_payments := v_payments + 1;
    end loop;

    v_orders := v_orders + 1;
  end loop;

  update public.sales_sync_runs set status = 'success', finished_at = now(), order_count = v_orders, item_count = v_items, payment_count = v_payments where id = v_run_id;
  return jsonb_build_object('run_id', v_run_id, 'inserted_or_updated_orders', v_orders, 'items', v_items, 'payments', v_payments, 'status', 'success');
end;
$$;

-- =============================================================================
-- import_sales_from_excel — owner-only manual KiotViet Excel re-import.
-- Mirror of database/migrations/2026-05-29-import-sales-from-excel.sql (keep in
-- lockstep). Matches existing orders by invoice_code; p_commit=false = dry-run.
-- =============================================================================
create or replace function public.import_sales_from_excel(
  p_payload jsonb,
  p_commit  boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, auth
as $$
declare
  v_order jsonb;
  v_item jsonb;
  v_payment jsonb;
  v_order_id uuid;
  v_payment_id uuid;
  v_existing_id uuid;
  v_old_bdate date;
  v_new_bdate date;
  v_code text;
  v_run_id uuid;
  v_batch text := coalesce(nullif(p_payload->>'batch_id',''), 'excel-' || gen_random_uuid()::text);
  v_idx integer;
  v_would_update integer := 0;
  v_would_insert integer := 0;
  v_orders integer := 0;
  v_items integer := 0;
  v_payments integer := 0;
  v_corrections jsonb := '[]'::jsonb;
  v_payment_method text;
  v_payment_amount numeric(14,2);
  v_cash_received numeric(14,2);
  v_change_given numeric(14,2);
  v_gross numeric(14,2);
  v_discount numeric(14,2);
  v_net numeric(14,2);
  v_total_payment numeric(14,2);
  v_qty numeric;
  v_price numeric;
  v_item_disc numeric;
  v_line_total numeric;
  v_max_amount constant numeric := 1000000000;
  v_max_qty constant numeric := 9999;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được import Excel.';
  end if;

  if p_commit then
    insert into public.sales_sync_runs (batch_id, source, status, started_at, raw_json)
    values (v_batch, 'excel_import', 'running', now(), p_payload)
    on conflict (batch_id) do update set status = 'running', started_at = excluded.started_at, raw_json = excluded.raw_json
    returning id into v_run_id;
  end if;

  for v_order in select * from jsonb_array_elements(coalesce(p_payload->'orders','[]'::jsonb)) loop
    v_code := nullif(v_order->>'invoice_code','');
    if v_code is null then
      raise exception 'import_sales_from_excel: thiếu invoice_code';
    end if;

    v_gross := coalesce(nullif(v_order->>'gross_amount','')::numeric, 0);
    v_discount := coalesce(nullif(v_order->>'discount_amount','')::numeric, 0);
    v_net := coalesce(nullif(v_order->>'net_amount','')::numeric, coalesce(nullif(v_order->>'total_payment','')::numeric, 0));
    v_total_payment := coalesce(nullif(v_order->>'total_payment','')::numeric, v_net);
    if v_gross < 0 or v_discount < 0 or v_net < 0 or v_total_payment < 0 then
      raise exception 'import_sales_from_excel: số tiền âm tại order=%', v_code;
    end if;
    if v_gross > v_max_amount or v_net > v_max_amount or v_total_payment > v_max_amount then
      raise exception 'import_sales_from_excel: số tiền vượt ngưỡng (>%) tại order=%', v_max_amount, v_code;
    end if;

    v_new_bdate := coalesce(
      nullif(v_order->>'business_date','')::date,
      (nullif(v_order->>'purchase_at','')::timestamptz)::date
    );

    select id, business_date into v_existing_id, v_old_bdate
      from public.sales_orders where invoice_code = v_code order by created_at limit 1;

    if v_existing_id is not null then
      v_would_update := v_would_update + 1;
      if v_old_bdate is distinct from v_new_bdate and jsonb_array_length(v_corrections) < 50 then
        v_corrections := v_corrections || jsonb_build_object('invoice_code', v_code, 'from', v_old_bdate, 'to', v_new_bdate);
      end if;
    else
      v_would_insert := v_would_insert + 1;
      if jsonb_array_length(v_corrections) < 50 then
        v_corrections := v_corrections || jsonb_build_object('invoice_code', v_code, 'from', null, 'to', v_new_bdate);
      end if;
    end if;

    if not p_commit then
      continue;
    end if;

    if v_existing_id is not null then
      update public.sales_orders set
        purchase_at = coalesce(nullif(v_order->>'purchase_at','')::timestamptz, purchase_at),
        business_date = v_new_bdate,
        gross_amount = v_gross,
        discount_amount = v_discount,
        net_amount = v_net,
        total_payment = v_total_payment,
        branch_name = coalesce(v_order->>'branch_name', branch_name),
        sold_by_name = coalesce(v_order->>'sold_by_name', sold_by_name),
        customer_name = coalesce(v_order->>'customer_name', customer_name),
        status_value = coalesce(v_order->>'status_value', status_value),
        sync_run_id = v_run_id,
        raw_json = v_order,
        updated_at = now()
      where id = v_existing_id
      returning id into v_order_id;
    else
      insert into public.sales_orders (
        kiotviet_invoice_id, invoice_code, table_or_order_code, purchase_at, business_date,
        branch_name, sold_by_name, customer_name,
        gross_amount, discount_amount, net_amount, total_payment, status_value, sync_run_id, raw_json
      ) values (
        'excel:' || v_code,
        v_code,
        nullif(v_order->>'table_or_order_code',''),
        coalesce(nullif(v_order->>'purchase_at','')::timestamptz, now()),
        v_new_bdate,
        v_order->>'branch_name',
        v_order->>'sold_by_name',
        v_order->>'customer_name',
        v_gross, v_discount, v_net, v_total_payment,
        v_order->>'status_value', v_run_id, v_order
      )
      returning id into v_order_id;
    end if;

    delete from public.sales_order_items where sales_order_id = v_order_id;
    delete from public.cash_drawer_events where sales_order_id = v_order_id and source = 'pos_sync';
    delete from public.sales_payments where sales_order_id = v_order_id;

    v_idx := 0;
    for v_item in select * from jsonb_array_elements(coalesce(v_order->'invoice_details', v_order->'items', '[]'::jsonb)) loop
      v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
      v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, 0);
      v_item_disc := coalesce(nullif(v_item->>'discount_amount','')::numeric, 0);
      v_line_total := coalesce(nullif(v_item->>'line_total','')::numeric, v_qty * v_price);
      if v_qty < 0 or v_price < 0 or v_item_disc < 0 or v_line_total < 0 then
        raise exception 'import_sales_from_excel: numeric âm tại order=% item=%', v_code, v_idx;
      end if;
      if v_qty > v_max_qty or v_price > v_max_amount or v_line_total > v_max_amount then
        raise exception 'import_sales_from_excel: vượt ngưỡng tại order=% item=%', v_code, v_idx;
      end if;

      insert into public.sales_order_items (sales_order_id, line_index, item_key, product_id, product_code, product_name, quantity, unit_price, discount_amount, discount_ratio, line_total, note, return_quantity, category_name, raw_json)
      values (
        v_order_id,
        v_idx,
        coalesce(nullif(v_item->>'item_key',''), nullif(v_item->>'id',''), coalesce(v_item->>'product_code','product') || '-' || v_idx::text),
        nullif(v_item->>'product_id',''),
        nullif(v_item->>'product_code',''),
        coalesce(v_item->>'product_name', v_item->>'name', 'Sản phẩm'),
        v_qty, v_price, v_item_disc,
        coalesce(nullif(v_item->>'discount_ratio','')::numeric, 0),
        v_line_total,
        v_item->>'note',
        coalesce(nullif(v_item->>'return_quantity','')::numeric, 0),
        v_item->>'category_name',
        v_item
      );
      v_idx := v_idx + 1;
      v_items := v_items + 1;
    end loop;

    for v_payment in select * from jsonb_array_elements(coalesce(v_order->'payments', jsonb_build_array(jsonb_build_object('payment_method', 'unknown', 'amount', coalesce(v_order->>'total_payment', v_order->>'net_amount'))))) loop
      v_payment_method := lower(coalesce(v_payment->>'payment_method', v_payment->>'method', 'unknown'));
      v_payment_amount := coalesce(nullif(v_payment->>'amount','')::numeric, 0);
      v_cash_received := nullif(v_payment->>'cash_received','')::numeric;
      v_change_given := nullif(v_payment->>'change_given','')::numeric;
      if v_payment_amount < 0 or coalesce(v_cash_received, 0) < 0 or coalesce(v_change_given, 0) < 0 then
        raise exception 'import_sales_from_excel: payment âm tại order=%', v_code;
      end if;
      if v_payment_amount > v_max_amount or coalesce(v_cash_received, 0) > v_max_amount or coalesce(v_change_given, 0) > v_max_amount then
        raise exception 'import_sales_from_excel: payment vượt ngưỡng tại order=%', v_code;
      end if;
      if v_payment_method = 'cash' and v_cash_received is not null and v_cash_received < v_payment_amount then
        raise exception 'import_sales_from_excel: cash_received (%) < amount (%) tại order=%', v_cash_received, v_payment_amount, v_code;
      end if;

      insert into public.sales_payments (sales_order_id, payment_method, amount, cash_received, change_given, payment_time, source, confidence, raw_json)
      values (v_order_id, v_payment_method, v_payment_amount, v_cash_received, v_change_given, coalesce(nullif(v_payment->>'payment_time','')::timestamptz, (v_order->>'purchase_at')::timestamptz, now()), coalesce(v_payment->>'source','kiotviet'), coalesce(v_payment->>'confidence', case when v_payment ? 'amount' then 'exact' else 'derived' end), v_payment)
      returning id into v_payment_id;

      if v_payment_method = 'cash' then
        if v_cash_received is not null and v_change_given is not null then
          insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
          select business_date, purchase_at, 'customer_cash_received', 'in', v_cash_received, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
          if v_change_given > 0 then
            insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
            select business_date, purchase_at, 'change_given', 'out', v_change_given, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
          end if;
        else
          insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, sales_order_id, sales_payment_id, source, note, raw_json)
          select business_date, purchase_at, 'pos_cash_in', 'in', v_payment_amount, id, v_payment_id, 'pos_sync', invoice_code, v_payment from public.sales_orders where id = v_order_id;
        end if;
      end if;
      v_payments := v_payments + 1;
    end loop;

    v_orders := v_orders + 1;
  end loop;

  if p_commit then
    update public.sales_sync_runs set status = 'success', finished_at = now(), order_count = v_orders, item_count = v_items, payment_count = v_payments where id = v_run_id;
  end if;

  return jsonb_build_object(
    'committed', p_commit,
    'would_update', v_would_update,
    'would_insert', v_would_insert,
    'date_corrections', v_corrections,
    'orders', v_orders,
    'items', v_items,
    'payments', v_payments,
    'run_id', v_run_id,
    'status', 'success'
  );
end;
$$;

revoke all on function public.import_sales_from_excel(jsonb, boolean) from public;
grant execute on function public.import_sales_from_excel(jsonb, boolean) to authenticated;

create or replace function public.handover_session_payload(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'id', s.id,
    'business_date', s.business_date,
    'status', s.status,
    'note', s.note,
    'created_by', s.created_by,
    'created_at', s.created_at,
    'completed_at', s.completed_at,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'task_key', t.task_key,
        'label', t.label,
        'is_done', t.is_done,
        'checked_by', t.checked_by,
        'checked_at', t.checked_at,
        'sort_order', t.sort_order
      ) order by t.sort_order, t.created_at)
      from public.handover_tasks t
      where t.session_id = s.id
    ), '[]'::jsonb)
  )
  from public.handover_sessions s
  where s.id = p_session_id;
$$;

create or replace function public.get_or_create_handover_session(p_business_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_session_id uuid;
  v_task jsonb;
  v_tasks jsonb := coalesce((select value from public.app_settings where key = 'handover_default_tasks'), '[{"key":"clean_counter","label":"Đã vệ sinh quầy và máy pha"},{"key":"restock","label":"Đã kiểm tra nguyên liệu cần bổ sung"},{"key":"cash_ready","label":"Đã chuẩn bị tiền lẻ/két cho ca sau"},{"key":"handover_note","label":"Đã ghi chú bàn giao cho ca sau"}]'::jsonb);
  v_sort integer := 10;
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền xem sổ bàn giao.'; end if;

  insert into public.handover_sessions (business_date, created_by)
  values (p_business_date, auth.uid())
  on conflict (business_date) do update set business_date = excluded.business_date
  returning id into v_session_id;

  if not exists (select 1 from public.handover_tasks where session_id = v_session_id) then
    for v_task in select * from jsonb_array_elements(v_tasks) loop
      insert into public.handover_tasks (session_id, task_key, label, sort_order)
      values (v_session_id, coalesce(v_task->>'key', 'task_' || v_sort::text), coalesce(v_task->>'label', 'Việc cần làm'), v_sort)
      on conflict (session_id, task_key) do nothing;
      v_sort := v_sort + 10;
    end loop;
  end if;

  return public.handover_session_payload(v_session_id);
end;
$$;

create or replace function public.update_handover_task(p_task_id uuid, p_is_done boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_session_id uuid;
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền cập nhật checklist bàn giao.'; end if;

  update public.handover_tasks
  set is_done = p_is_done,
      checked_by = case when p_is_done then auth.uid() else null end,
      checked_at = case when p_is_done then now() else null end
  where id = p_task_id
  returning session_id into v_session_id;

  if v_session_id is null then raise exception 'Không tìm thấy checklist bàn giao.'; end if;
  return public.handover_session_payload(v_session_id);
end;
$$;

create or replace function public.update_handover_note(p_session_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền cập nhật ghi chú bàn giao.'; end if;
  update public.handover_sessions set note = p_note where id = p_session_id;
  return public.handover_session_payload(p_session_id);
end;
$$;

create or replace function public.complete_handover_session(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền hoàn tất bàn giao.'; end if;
  update public.handover_sessions set status = 'completed', completed_at = now() where id = p_session_id;
  return public.handover_session_payload(p_session_id);
end;
$$;

-- Audit log trigger function: capture INSERT/UPDATE/DELETE on sensitive tables.
create or replace function public._audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_action text;
  v_entity_id uuid;
  v_diff jsonb;
begin
  v_action := tg_table_name || '.' || lower(tg_op);
  v_entity_id := case
    when tg_op = 'DELETE' then (to_jsonb(old)->>'id')::uuid
    else (to_jsonb(new)->>'id')::uuid
  end;
  v_diff := case
    when tg_op = 'UPDATE' then jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new))
    when tg_op = 'INSERT' then jsonb_build_object('after', to_jsonb(new))
    else jsonb_build_object('before', to_jsonb(old))
  end;
  insert into public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, diff_json)
  values (auth.uid(), public.app_role(), v_action, tg_table_name, v_entity_id, v_diff);
  return coalesce(new, old);
end;
$$;

-- Attendance audit (Phase 2b, Codex #2): self check-in/out chạy bằng service_role
-- (auth.uid() null) → coalesce actor từ updated_by/edited_by/created_by để audit
-- không bao giờ null actor; role tra từ employee_accounts của actor đó.
create or replace function public._audit_attendance_change()
returns trigger language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_actor uuid;
  v_role text;
begin
  v_actor := coalesce(
    auth.uid(),
    (v_new->>'updated_by')::uuid, (v_new->>'edited_by')::uuid, (v_new->>'created_by')::uuid,
    (v_old->>'updated_by')::uuid, (v_old->>'created_by')::uuid
  );
  v_role := coalesce(
    (select role from public.employee_accounts where auth_user_id = v_actor and status = 'active' limit 1),
    public.app_role()
  );
  insert into public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, diff_json)
  values (
    v_actor, v_role,
    tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid),
    case tg_op
      when 'UPDATE' then jsonb_build_object('before', v_old, 'after', v_new)
      when 'INSERT' then jsonb_build_object('after', v_new)
      else jsonb_build_object('before', v_old) end
  );
  return coalesce(new, old);
end; $$;

drop trigger if exists audit_shift_assignments on public.shift_assignments;
create trigger audit_shift_assignments after insert or update or delete on public.shift_assignments
  for each row execute function public._audit_attendance_change();

drop trigger if exists audit_payroll on public.shift_payroll_records;
create trigger audit_payroll after insert or update or delete on public.shift_payroll_records
  for each row execute function public._audit_attendance_change();

drop trigger if exists audit_cash_close on public.cash_close_reports;
create trigger audit_cash_close
  after insert or update or delete on public.cash_close_reports
  for each row execute function public._audit_row_change();

drop trigger if exists audit_expenses on public.expenses;
create trigger audit_expenses
  after insert or update or delete on public.expenses
  for each row execute function public._audit_row_change();

drop trigger if exists audit_cash_opening on public.cash_day_openings;
create trigger audit_cash_opening
  after insert or update or delete on public.cash_day_openings
  for each row execute function public._audit_row_change();

drop trigger if exists audit_app_settings on public.app_settings;
create trigger audit_app_settings
  after update on public.app_settings
  for each row execute function public._audit_row_change();

drop trigger if exists audit_employees on public.employees;
create trigger audit_employees
  after update or delete on public.employees
  for each row execute function public._audit_row_change();

drop trigger if exists audit_employee_accounts on public.employee_accounts;
create trigger audit_employee_accounts
  after insert or update or delete on public.employee_accounts
  for each row execute function public._audit_row_change();

drop trigger if exists audit_integration_clients on public.integration_clients;
create trigger audit_integration_clients
  after insert or update or delete on public.integration_clients
  for each row execute function public._audit_row_change();

-- =============================================================================
-- UI Settings RPCs (sidebar defaults + per-user override + handover defaults)
-- =============================================================================

create or replace function public.update_sidebar_defaults(p_role text, p_items text[])
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_defaults jsonb;
  v_items jsonb;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Bạn không có quyền cập nhật quyền xem trang.';
  end if;
  if p_role not in ('owner','manager','staff_operator','employee_viewer') then
    raise exception 'Role không hợp lệ.';
  end if;
  v_items := coalesce(to_jsonb(p_items), '[]'::jsonb);
  v_defaults := coalesce((select value from public.app_settings where key = 'sidebar_defaults'), '{}'::jsonb);
  v_defaults := jsonb_set(v_defaults, array[p_role], v_items, true);
  insert into public.app_settings (key, value, is_public, updated_by)
  values ('sidebar_defaults', v_defaults, true, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = true, updated_by = auth.uid(), updated_at = now();
  return v_defaults;
end;
$$;

create or replace function public.update_user_sidebar_config(p_profile_id uuid, p_items text[] default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_value jsonb := case when p_items is null then null else to_jsonb(p_items) end;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Bạn không có quyền cập nhật override nhân viên.';
  end if;
  insert into public.profiles (id, sidebar_config, updated_at)
  values (p_profile_id, v_value, now())
  on conflict (id) do update set sidebar_config = excluded.sidebar_config, updated_at = now();
  return jsonb_build_object('profile_id', p_profile_id, 'sidebar_config', v_value);
end;
$$;

create or replace function public.update_handover_default_tasks(p_tasks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not public.app_is_owner_manager() then
    raise exception 'Bạn không có quyền cập nhật mẫu checklist.';
  end if;
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách checklist không hợp lệ.';
  end if;
  insert into public.app_settings (key, value, is_public, updated_by)
  values ('handover_default_tasks', p_tasks, true, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = true, updated_by = auth.uid(), updated_at = now();
  return p_tasks;
end;
$$;

create or replace function public.update_handover_session_tasks(p_session_id uuid, p_tasks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_task jsonb;
  v_id uuid;
  v_keep uuid[] := '{}';
  v_sort integer := 10;
  v_key text;
  v_label text;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Bạn không có quyền chỉnh nội dung checklist trong ngày.';
  end if;
  if not exists (select 1 from public.handover_sessions where id = p_session_id) then
    raise exception 'Không tìm thấy checklist trong ngày.';
  end if;
  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) <> 'array' then
    raise exception 'Danh sách checklist không hợp lệ.';
  end if;
  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb)) loop
    v_label := trim(coalesce(v_task->>'label', ''));
    if v_label = '' then continue; end if;
    v_key := coalesce(nullif(v_task->>'key', ''), 'task_' || v_sort::text);
    v_id := nullif(v_task->>'id', '')::uuid;
    if v_id is not null and exists (select 1 from public.handover_tasks where id = v_id and session_id = p_session_id) then
      update public.handover_tasks set task_key = v_key, label = v_label, sort_order = coalesce((v_task->>'sort_order')::integer, v_sort) where id = v_id and session_id = p_session_id;
    else
      insert into public.handover_tasks (session_id, task_key, label, sort_order)
      values (p_session_id, v_key, v_label, coalesce((v_task->>'sort_order')::integer, v_sort))
      on conflict (session_id, task_key) do update set label = excluded.label, sort_order = excluded.sort_order
      returning id into v_id;
    end if;
    v_keep := array_append(v_keep, v_id);
    v_sort := v_sort + 10;
  end loop;
  delete from public.handover_tasks where session_id = p_session_id and not (id = any(v_keep));
  return public.handover_session_payload(p_session_id);
end;
$$;

grant execute on function public.update_sidebar_defaults(text, text[]) to authenticated;
grant execute on function public.update_user_sidebar_config(uuid, text[]) to authenticated;
grant execute on function public.update_handover_default_tasks(jsonb) to authenticated;
grant execute on function public.update_handover_session_tasks(uuid, jsonb) to authenticated;

-- =============================================================================
-- KiotViet sync helper: get_last_sync_cursor (cho polling future)
-- =============================================================================

create or replace function public.get_last_sync_cursor(p_source text default 'kiotviet')
returns timestamptz
language sql
stable
security definer
set search_path = public, auth
as $$
  select max(finished_at)
  from public.sales_sync_runs
  where source = p_source
    and status = 'success'
    and finished_at is not null;
$$;

grant execute on function public.get_last_sync_cursor(text) to authenticated;

-- =============================================================================
-- Sổ quỹ (cash safe) RPCs — owner-only ledger
--
-- Architecture: All insert/update phải qua các function dưới (security definer +
-- check role). Direct INSERT bị RLS block. Owner role-check qua app_role().
--
-- balance_after là số dư SAU giao dịch — denormalized để query nhanh.
-- Mỗi insert: tính next_balance = current_balance + amount, validate >= 0,
-- rồi insert với balance_after = next_balance.
-- =============================================================================

-- Số dư một quỹ (cash|transfer) = balance_after của row GHI gần nhất (created_at
-- desc, id desc) của quỹ đó. Basis created_at (invariant F4) áp per-fund — để
-- giao dịch back-date không làm "biến mất" số dư hiện tại.
create or replace function public.safe_fund_balance_now(p_fund text)
returns numeric
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select balance_after from public.safe_transactions
     where fund = p_fund
     order by created_at desc, id desc
     limit 1),
    0
  );
$$;

grant execute on function public.safe_fund_balance_now(text) to authenticated;

-- ⚠️ Legacy display-only helper. Sổ quỹ 2 quỹ: trả về TỔNG (cash + transfer).
-- KHÔNG BAO GIỜ dùng để chain balance_after của row mới — mỗi row thuộc đúng 1
-- quỹ và phải chain từ safe_fund_balance_now(fund) tương ứng.
-- (Định nghĩa SAU safe_fund_balance_now vì body SQL được validate lúc create.)
create or replace function public.safe_balance_now()
returns numeric
language sql
stable
security definer
set search_path = public, auth
as $$
  select public.safe_fund_balance_now('cash') + public.safe_fund_balance_now('transfer');
$$;

grant execute on function public.safe_balance_now() to authenticated;

-- Tổng hợp 3 số cho UI: { cash, transfer, total }.
create or replace function public.safe_balances_now()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'cash', public.safe_fund_balance_now('cash'),
    'transfer', public.safe_fund_balance_now('transfer'),
    'total', public.safe_fund_balance_now('cash') + public.safe_fund_balance_now('transfer')
  );
$$;

grant execute on function public.safe_balances_now() to authenticated;

-- Setup ban đầu: chỉ chạy được 1 lần khi chưa có transaction nào. Owner only.
-- Sổ quỹ 2 quỹ: nhập số dư mở đầu cho quỹ tiền mặt + quỹ chuyển khoản.
-- DROP signature cũ (numeric, text) trước khi tạo chữ ký mới (tránh PostgREST ambiguity).
drop function if exists public.safe_setup_initial(numeric, text);
create or replace function public.safe_setup_initial(
  p_cash numeric,
  p_transfer numeric default 0,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_cash_id uuid;
  v_transfer_id uuid;
  v_transfer numeric := coalesce(p_transfer, 0);
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được thiết lập sổ quỹ ban đầu.';
  end if;
  if exists (select 1 from public.safe_transactions) then
    raise exception 'Sổ quỹ đã có giao dịch. Dùng safe_adjust thay vì safe_setup_initial.';
  end if;
  if p_cash < 0 or p_cash > 1000000000 or v_transfer < 0 or v_transfer > 1000000000 then
    raise exception 'Số dư ban đầu mỗi quỹ phải 0–1.000.000.000.';
  end if;

  -- Luôn ghi row quỹ tiền mặt (kể cả 0) để đánh dấu sổ quỹ đã khởi tạo.
  insert into public.safe_transactions (
    transaction_type, amount, balance_after, fund, description, created_by
  ) values (
    'initial_setup', p_cash, p_cash, 'cash',
    coalesce(nullif(trim(p_note), ''), 'Khởi tạo quỹ tiền mặt'),
    auth.uid()
  ) returning id into v_cash_id;

  if v_transfer > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, description, created_by
    ) values (
      'initial_setup', v_transfer, v_transfer, 'transfer',
      coalesce(nullif(trim(p_note), ''), 'Khởi tạo quỹ chuyển khoản'),
      auth.uid()
    ) returning id into v_transfer_id;
  end if;

  return jsonb_build_object(
    'cash_id', v_cash_id, 'transfer_id', v_transfer_id,
    'cash', p_cash, 'transfer', v_transfer,
    'balance', p_cash + v_transfer
  );
end;
$$;

grant execute on function public.safe_setup_initial(numeric, numeric, text) to authenticated;

-- Rút sổ quỹ cho mục đích khác (tiền điện, thuê, mua nguyên liệu, ...).
-- p_category: 'utilities' | 'rent' | 'inventory' | 'maintenance' | 'other'
-- v2 (2026-05-28): auto-insert expense row link về safe_transaction.
-- v3 (2026-06-10): fund-aware — rút từ quỹ tiền mặt.
-- v4 (2026-06-10): tách quỹ (p_cash_amount + p_transfer_amount, CK trước tiền mặt
--   bù — UI default) + F4 chỉnh được ngày (p_occurred_at = nhãn ngày; số dư GIẢM
--   NGAY vì cơ sở số dư là created_at). DROP chữ ký cũ tránh PostgREST ambiguity.
drop function if exists public.safe_withdraw_other(numeric, text, text);
create or replace function public.safe_withdraw_other(
  p_cash_amount numeric,
  p_transfer_amount numeric,
  p_category text,
  p_description text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_cash numeric := coalesce(p_cash_amount, 0);
  v_transfer numeric := coalesce(p_transfer_amount, 0);
  v_total numeric := coalesce(p_cash_amount, 0) + coalesce(p_transfer_amount, 0);
  v_occurred timestamptz := coalesce(p_occurred_at, now());
  v_balance numeric;
  v_cash_id uuid;
  v_transfer_id uuid;
  v_cash_after numeric;
  v_transfer_after numeric;
  v_expense_id uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được rút sổ quỹ.';
  end if;
  if v_cash < 0 or v_transfer < 0 then
    raise exception 'Số tiền mỗi quỹ không được âm.';
  end if;
  if v_cash <> floor(v_cash) or v_transfer <> floor(v_transfer) then
    raise exception 'Số tiền phải là số nguyên VND.';
  end if;
  if v_total <= 0 or v_total > 1000000000 then
    raise exception 'Tổng tiền rút phải 1–1.000.000.000.';
  end if;
  if p_category not in ('utilities', 'rent', 'inventory', 'maintenance', 'other') then
    raise exception 'Loại chi không hợp lệ.';
  end if;
  if length(coalesce(p_description, '')) > 500 then
    raise exception 'Mô tả vượt 500 ký tự.';
  end if;
  if v_occurred::date > current_date then
    raise exception 'Ngày rút không được ở tương lai.';
  end if;

  -- Mỗi quỹ > 0: advisory lock + validate + insert (KHÔNG insert row amount=0).
  if v_cash > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    v_balance := public.safe_fund_balance_now('cash');
    if v_balance < v_cash then
      raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, rút %.', v_balance, v_cash;
    end if;
    v_cash_after := v_balance - v_cash;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_cash, v_cash_after, 'cash', v_occurred,
      p_category, p_description, auth.uid()
    ) returning id into v_cash_id;
  end if;

  if v_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    v_balance := public.safe_fund_balance_now('transfer');
    if v_balance < v_transfer then
      raise exception 'Quỹ chuyển khoản không đủ. Số dư hiện tại %, rút %.', v_balance, v_transfer;
    end if;
    v_transfer_after := v_balance - v_transfer;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_transfer, v_transfer_after, 'transfer', v_occurred,
      p_category, p_description, auth.uid()
    ) returning id into v_transfer_id;
  end if;

  -- Auto-create MỘT expense row cho TỔNG khoản chi (link để ẩn khỏi non-owner;
  -- không phải till expense). Link vào row cash nếu có, không thì row transfer.
  -- business_date theo ngày đã chọn (F4) — khớp lịch sử/báo cáo.
  insert into public.expenses (
    business_date,
    description,
    amount,
    payment_method,
    category_id,
    safe_transaction_id,
    created_by
  ) values (
    v_occurred::date,
    coalesce(nullif(trim(p_description), ''), 'Rút quỹ — ' || p_category),
    v_total,
    'other',
    null,
    coalesce(v_cash_id, v_transfer_id),
    auth.uid()
  ) returning id into v_expense_id;

  return jsonb_build_object(
    'cash_id', v_cash_id,
    'transfer_id', v_transfer_id,
    'cash_balance_after', v_cash_after,
    'transfer_balance_after', v_transfer_after,
    'total', v_total,
    'expense_id', v_expense_id
  );
end;
$$;

grant execute on function public.safe_withdraw_other(numeric, numeric, text, text, timestamptz) to authenticated;

-- Nhập nguyên liệu từ sổ quỹ (F1+F2): MỘT giao dịch atomic = trừ quỹ (tách CK +
-- tiền mặt, pattern safe_withdraw_other v4) + đẩy tồn kho (stock_movements
-- purchase_received per line) + cập nhật ingredients.last_unit_price.
-- p_lines: jsonb array [{ingredient_id, quantity, unit_price}]. Tổng được tính
-- SERVER-side (không tin client); p_cash + p_transfer phải khớp tổng.
-- Nguyên liệu mới phải được tạo TRƯỚC qua create_ingredient (client) — RPC chỉ
-- nhận ingredient_id đã tồn tại & active. KHÔNG tạo expense row (khác withdraw
-- thường — kho + sổ quỹ đã track; theo spec YAGNI không thêm FK/bảng header).
create or replace function public.safe_purchase_inventory(
  p_cash_amount numeric,
  p_transfer_amount numeric,
  p_lines jsonb,
  p_description text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_cash numeric := coalesce(p_cash_amount, 0);
  v_transfer numeric := coalesce(p_transfer_amount, 0);
  v_occurred timestamptz := coalesce(p_occurred_at, now());
  v_total numeric := 0;
  v_line jsonb;
  v_ing_id uuid;
  v_qty numeric;
  v_price numeric;
  v_balance numeric;
  v_cash_id uuid;
  v_transfer_id uuid;
  v_cash_after numeric;
  v_transfer_after numeric;
  v_movement_ids uuid[] := '{}';
  v_mid uuid;
  v_note text;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được nhập nguyên liệu từ sổ quỹ.';
  end if;
  if v_cash < 0 or v_transfer < 0 then
    raise exception 'Số tiền mỗi quỹ không được âm.';
  end if;
  if v_cash <> floor(v_cash) or v_transfer <> floor(v_transfer) then
    raise exception 'Số tiền phải là số nguyên VND.';
  end if;
  if v_occurred::date > current_date then
    raise exception 'Ngày nhập không được ở tương lai.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Cần ít nhất 1 dòng nguyên liệu.';
  end if;
  if length(coalesce(p_description, '')) > 500 then
    raise exception 'Mô tả vượt 500 ký tự.';
  end if;

  -- Validate từng dòng + tính tổng server-side.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    if v_ing_id is null then
      raise exception 'Dòng thiếu ingredient_id.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Số lượng phải > 0.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Đơn giá không được âm.';
    end if;
    if not exists (select 1 from public.ingredients where id = v_ing_id and is_active) then
      raise exception 'Nguyên liệu % không tồn tại hoặc đã ẩn.', v_ing_id;
    end if;
    v_total := v_total + v_qty * v_price;
  end loop;

  v_total := round(v_total, 2);
  if v_total <= 0 or v_total > 1000000000 then
    raise exception 'Tổng tiền nhập phải 1–1.000.000.000 (hiện %).', v_total;
  end if;
  if v_cash + v_transfer <> v_total then
    raise exception 'Tách quỹ (%) không khớp tổng các dòng (%).', v_cash + v_transfer, v_total;
  end if;

  v_note := coalesce(nullif(trim(p_description), ''), 'Nhập nguyên liệu — rút sổ quỹ ' || v_occurred::date);

  -- Trừ quỹ per-fund (advisory lock, skip phần 0) — giống safe_withdraw_other v4.
  if v_cash > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    v_balance := public.safe_fund_balance_now('cash');
    if v_balance < v_cash then
      raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, cần %.', v_balance, v_cash;
    end if;
    v_cash_after := v_balance - v_cash;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_cash, v_cash_after, 'cash', v_occurred,
      'inventory', v_note, auth.uid()
    ) returning id into v_cash_id;
  end if;

  if v_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    v_balance := public.safe_fund_balance_now('transfer');
    if v_balance < v_transfer then
      raise exception 'Quỹ chuyển khoản không đủ. Số dư hiện tại %, cần %.', v_balance, v_transfer;
    end if;
    v_transfer_after := v_balance - v_transfer;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_transfer, v_transfer_after, 'transfer', v_occurred,
      'inventory', v_note, auth.uid()
    ) returning id into v_transfer_id;
  end if;

  -- Đẩy kho + nhớ đơn giá cho từng dòng.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    insert into public.stock_movements (
      ingredient_id, quantity_delta, reason, occurred_at, notes, created_by
    ) values (
      v_ing_id, v_qty, 'purchase_received', v_occurred, v_note, auth.uid()
    ) returning id into v_mid;
    v_movement_ids := v_movement_ids || v_mid;
    update public.ingredients set last_unit_price = v_price where id = v_ing_id;
  end loop;

  return jsonb_build_object(
    'cash_id', v_cash_id,
    'transfer_id', v_transfer_id,
    'cash_balance_after', v_cash_after,
    'transfer_balance_after', v_transfer_after,
    'total', v_total,
    'movement_ids', to_jsonb(v_movement_ids)
  );
end;
$$;

grant execute on function public.safe_purchase_inventory(numeric, numeric, jsonb, text, timestamptz) to authenticated;

-- Adjust sổ quỹ khi count thực tế lệch (mất, lẫn lộn, sai sót).
-- Owner only. Note bắt buộc (audit trail).
-- Sổ quỹ 2 quỹ: chọn quỹ điều chỉnh (p_fund 'cash' | 'transfer').
-- DROP chữ ký cũ (numeric, text) tránh PostgREST ambiguity.
drop function if exists public.safe_adjust(numeric, text);
create or replace function public.safe_adjust(p_fund text, p_new_balance numeric, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_balance numeric;
  v_diff numeric;
  v_id uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được điều chỉnh sổ quỹ.';
  end if;
  if p_fund not in ('cash', 'transfer') then
    raise exception 'Quỹ không hợp lệ (cash | transfer).';
  end if;
  if p_new_balance < 0 or p_new_balance > 1000000000 then
    raise exception 'Số dư mới phải 0–1.000.000.000.';
  end if;
  if length(coalesce(trim(p_note), '')) < 5 then
    raise exception 'Phải nhập lý do điều chỉnh (>= 5 ký tự) cho audit trail.';
  end if;
  if length(p_note) > 500 then
    raise exception 'Lý do vượt 500 ký tự.';
  end if;

  perform pg_advisory_xact_lock(hashtext('safe_fund:' || p_fund));
  v_balance := public.safe_fund_balance_now(p_fund);
  v_diff := p_new_balance - v_balance;
  if v_diff = 0 then
    raise exception 'Số dư mới giống số dư hiện tại — không cần điều chỉnh.';
  end if;

  insert into public.safe_transactions (
    transaction_type, amount, balance_after, fund, description, created_by
  ) values (
    'adjustment', v_diff, p_new_balance, p_fund, p_note, auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'fund', p_fund, 'balance_after', p_new_balance, 'difference', v_diff);
end;
$$;

grant execute on function public.safe_adjust(text, numeric, text) to authenticated;

-- Snapshot mệnh giá thực tế. KHÔNG auto-adjust — chỉ ghi nhận difference.
-- Owner muốn fix → gọi safe_adjust riêng.
create or replace function public.safe_count(p_denominations_json jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_total numeric := 0;
  v_balance numeric;
  v_diff numeric;
  v_id uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được đếm sổ quỹ.';
  end if;

  -- Whitelist mệnh giá VND 1k-500k, count 0-10000 (giống save_cash_count)
  perform 1
  from jsonb_each_text(coalesce(p_denominations_json, '{}'::jsonb)) as d(k, v)
  where not (
    k ~ '^(1000|2000|5000|10000|20000|50000|100000|200000|500000)$'
    and v ~ '^[0-9]+$'
    and v::numeric between 0 and 10000
  );
  if found then
    raise exception 'denominations_json: chỉ chấp nhận mệnh giá VND 1k-500k và số lượng 0-10000.';
  end if;

  select coalesce(sum(key::numeric * value::numeric), 0)
  into v_total
  from jsonb_each_text(coalesce(p_denominations_json, '{}'::jsonb));

  -- Đếm tay = tiền mặt vật lý → so với QUỸ TIỀN MẶT (CK không đếm tay được).
  v_balance := public.safe_fund_balance_now('cash');
  v_diff := v_total - v_balance;

  insert into public.safe_counts (
    denominations_json, total_physical, expected_balance, difference, note, counted_by
  ) values (
    coalesce(p_denominations_json, '{}'::jsonb),
    v_total, v_balance, v_diff, p_note, auth.uid()
  ) returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'total_physical', v_total,
    'expected_balance', v_balance,
    'difference', v_diff
  );
end;
$$;

grant execute on function public.safe_count(jsonb, text) to authenticated;

-- List transactions với optional filter ngày + type
create or replace function public.safe_list_transactions(
  p_from date default null,
  p_to date default null,
  p_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner xem được lịch sử sổ quỹ.';
  end if;

  select coalesce(jsonb_agg(item order by item->>'occurred_at' desc), '[]'::jsonb)
  into v_result
  from (
    select jsonb_build_object(
      'id', t.id,
      'occurred_at', t.occurred_at,
      'transaction_type', t.transaction_type,
      'fund', t.fund,
      'amount', t.amount,
      'balance_after', t.balance_after,
      'reason_category', t.reason_category,
      'description', t.description,
      'cash_close_report_id', t.cash_close_report_id,
      'cash_day_opening_id', t.cash_day_opening_id,
      'created_by', t.created_by,
      'created_at', t.created_at,
      'attachment_count', (
        select count(*) from public.safe_attachments a where a.transaction_id = t.id
      )
    ) as item
    from public.safe_transactions t
    where (p_from is null or t.occurred_at::date >= p_from)
      and (p_to is null or t.occurred_at::date <= p_to)
      and (p_type is null or t.transaction_type = p_type)
  ) sub;

  return v_result;
end;
$$;

grant execute on function public.safe_list_transactions(date, date, text) to authenticated;

-- =============================================================================
-- Safe attachments — owner upload ảnh hóa đơn, Phase 2 n8n sẽ OCR.
-- =============================================================================

-- Sau khi browser upload file lên Storage 'safe-receipts/{tx_id}/{uuid}.{ext}',
-- gọi RPC này để insert metadata. RPC verify owner role + insert.
create or replace function public.safe_attachment_create(p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_tx_id uuid := (p_payload->>'transaction_id')::uuid;
  v_id uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner mới được attach hóa đơn vào sổ quỹ.';
  end if;
  -- Verify transaction tồn tại (FK on delete cascade sẽ tự dọn nếu tx bị xóa,
  -- nhưng check trước để return error rõ hơn).
  if not exists (select 1 from public.safe_transactions where id = v_tx_id) then
    raise exception 'Transaction % không tồn tại.', v_tx_id;
  end if;
  insert into public.safe_attachments (
    transaction_id, storage_path, file_name, mime_type, file_size, uploaded_by
  ) values (
    v_tx_id,
    p_payload->>'storage_path',
    p_payload->>'file_name',
    p_payload->>'mime_type',
    (p_payload->>'file_size')::integer,
    auth.uid()
  ) returning id into v_id;
  return jsonb_build_object('attachment_id', v_id);
end$$;

grant execute on function public.safe_attachment_create(jsonb) to authenticated;

-- Xóa metadata. Caller PHẢI xóa storage object trước (browser side) — RPC chỉ
-- xóa row trong DB. Trả về storage_path để caller verify nếu cần.
create or replace function public.safe_attachment_delete(p_attachment_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, auth
as $$
declare v_path text;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner mới được xóa hóa đơn.';
  end if;
  delete from public.safe_attachments where id = p_attachment_id returning storage_path into v_path;
  if v_path is null then
    raise exception 'Không tìm thấy attachment % để xóa.', p_attachment_id;
  end if;
  return jsonb_build_object('storage_path', v_path);
end$$;

grant execute on function public.safe_attachment_delete(uuid) to authenticated;

-- List attachments cho 1 transaction. Owner only (mirror safe_list_transactions).
create or replace function public.safe_list_attachments(p_transaction_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner xem được hóa đơn sổ quỹ.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'transaction_id', transaction_id,
    'storage_path', storage_path,
    'file_name', file_name,
    'mime_type', mime_type,
    'file_size', file_size,
    'uploaded_at', uploaded_at,
    'processed_at', processed_at
  ) order by uploaded_at desc), '[]'::jsonb) into v_result
  from public.safe_attachments
  where transaction_id = p_transaction_id;
  return v_result;
end$$;

grant execute on function public.safe_list_attachments(uuid) to authenticated;

-- =============================================================================
-- Cập nhật finalize_cash_close_report + save_cash_day_opening để tích hợp
-- safe_transactions (deposit_close + withdraw_open).
-- =============================================================================

-- Sửa save_cash_day_opening: accept safe_withdrawal_amount trong payload.
-- 3 scenarios:
--   1. carry-over only: safe_withdrawal = 0
--   2. withdraw safe: safe_withdrawal = opening_total
--   3. combine: 0 < safe_withdrawal < opening_total
create or replace function public.save_cash_day_opening(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_date date := coalesce((p_payload->>'business_date')::date, current_date);
  v_denominations jsonb := coalesce(p_payload->'denominations_json', '{}'::jsonb);
  v_carried boolean := coalesce((p_payload->>'carried_from_previous_day')::boolean, false);
  v_safe_withdrawal numeric(14,2) := coalesce((p_payload->>'safe_withdrawal_amount')::numeric, 0);
  v_total numeric(14,2) := 0;
  v_carried_amount numeric(14,2) := 0;
  v_role text := public.app_role();
  v_existing public.cash_day_openings%rowtype;
  v_row public.cash_day_openings%rowtype;
  v_safe_balance numeric(14,2);
begin
  if v_role not in ('owner','manager') then
    raise exception 'Bạn không có quyền nhập tiền đầu ngày.';
  end if;

  perform 1
  from jsonb_each_text(v_denominations) as d(k, v)
  where not (
    k ~ '^(1000|2000|5000|10000|20000|50000|100000|200000|500000)$'
    and v ~ '^[0-9]+$'
    and v::numeric between 0 and 10000
  );
  if found then
    raise exception 'denominations_json: chỉ chấp nhận mệnh giá VND 1k-500k và số lượng 0-10000.';
  end if;

  select coalesce(sum(key::numeric * value::numeric), 0)
  into v_total
  from jsonb_each_text(v_denominations);

  -- Validate safe_withdrawal: 0 ≤ amount ≤ opening_total
  if v_safe_withdrawal < 0 then
    raise exception 'safe_withdrawal_amount không được âm.';
  end if;
  if v_safe_withdrawal > v_total then
    raise exception 'safe_withdrawal_amount (%) không được vượt opening_total (%).', v_safe_withdrawal, v_total;
  end if;
  if v_safe_withdrawal > 0 then
    -- Owner-only enforce thêm
    if v_role <> 'owner' then
      raise exception 'Chỉ owner được rút từ sổ quỹ. Manager chỉ carry-over.';
    end if;
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    v_safe_balance := public.safe_fund_balance_now('cash');
    if v_safe_balance < v_safe_withdrawal then
      raise exception 'Quỹ tiền mặt không đủ. Số dư %, rút %.', v_safe_balance, v_safe_withdrawal;
    end if;
  end if;
  v_carried_amount := v_total - v_safe_withdrawal;

  select * into v_existing
  from public.cash_day_openings
  where business_date = v_date;

  if found then
    if v_role <> 'owner' then
      raise exception 'Tiền đầu ngày đã lưu, chỉ chủ quán được chỉnh sửa.';
    end if;

    update public.cash_day_openings
    set denominations_json = v_denominations,
        opening_total = v_total,
        carried_from_previous_day = v_carried,
        carried_amount = v_carried_amount,
        safe_withdrawal_amount = v_safe_withdrawal
    where id = v_existing.id
    returning * into v_row;
  else
    insert into public.cash_day_openings (
      business_date,
      denominations_json,
      opening_total,
      carried_from_previous_day,
      carried_amount,
      safe_withdrawal_amount,
      created_by
    )
    values (
      v_date,
      v_denominations,
      v_total,
      v_carried,
      v_carried_amount,
      v_safe_withdrawal,
      auth.uid()
    )
    returning * into v_row;
  end if;

  delete from public.cash_drawer_events
  where business_date = v_date
    and event_type = 'opening_cash'
    and source = 'app_action';

  if v_total > 0 then
    insert into public.cash_drawer_events (
      business_date,
      occurred_at,
      event_type,
      direction,
      amount,
      created_by,
      source,
      note,
      raw_json
    )
    values (
      v_date,
      now(),
      'opening_cash',
      'in',
      v_total,
      auth.uid(),
      'app_action',
      case when v_safe_withdrawal > 0 then 'Rút từ sổ quỹ ' || v_safe_withdrawal::text else 'Carry-over' end,
      jsonb_build_object('opening_id', v_row.id, 'safe_withdrawal', v_safe_withdrawal)
    );
  end if;

  -- Insert safe_transaction nếu rút từ sổ quỹ — rút từ QUỸ TIỀN MẶT (mở két = tiền mặt).
  if v_safe_withdrawal > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund,
      description, cash_day_opening_id, created_by
    ) values (
      'withdraw_open',
      -v_safe_withdrawal,
      public.safe_fund_balance_now('cash') - v_safe_withdrawal,
      'cash',
      'Rút mở két ngày ' || v_date::text,
      v_row.id,
      auth.uid()
    );
  end if;

  return to_jsonb(v_row);
end;
$$;

-- Sửa finalize_cash_close_report: accept p_leave_for_next_day, auto-deposit dư
-- vào sổ quỹ.
--
-- DROP signature cũ (uuid) trước khi CREATE signature mới (uuid, numeric).
-- CREATE OR REPLACE FUNCTION chỉ replace function CÙNG signature — 2 signatures
-- khác nhau sẽ coexist như overloads → PostgREST raise "Could not choose the
-- best candidate function" khi frontend gọi RPC. Phải drop explicit để tránh
-- ambiguity, kể cả file này còn định nghĩa 1-param version ở line ~690 (nơi đó
-- được khai báo cho audit/migration history; signature mới thay thế hoàn toàn).
drop function if exists public.finalize_cash_close_report(uuid);

-- finalize_cash_close_report — 3-arg version (v4.1.11):
-- + p_next_day_denominations jsonb: nếu non-null, UPSERT cash_day_openings cho
--   business_date+1 với denominations + total = sum(denomination × count). Tổng
--   được tính server-side là source of truth (override p_leave_for_next_day nếu lệch).
create or replace function public.finalize_cash_close_report(
  p_cash_count_id uuid,
  p_leave_for_next_day numeric default 0,
  p_next_day_denominations jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_count public.cash_counts%rowtype;
  v_theory jsonb;
  v_report_id uuid;
  v_existing public.cash_close_reports%rowtype;
  v_pos_total numeric(14,2);
  v_pos_cash numeric(14,2);
  v_pos_non_cash numeric(14,2);
  v_opening numeric(14,2);
  v_bank_transfer numeric(14,2);
  v_expense numeric(14,2);
  v_payroll numeric(14,2);
  v_theory_cash numeric(14,2);
  v_reconciliation numeric(14,2);
  v_difference numeric(14,2);
  v_safe_deposit numeric(14,2);
  v_leave numeric(14,2) := coalesce(p_leave_for_next_day, 0);
  v_next_total numeric(14,2);
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền chốt báo cáo két.'; end if;
  select * into v_count from public.cash_counts where id = p_cash_count_id;
  if not found then raise exception 'Không tìm thấy bản kiểm két.'; end if;
  select * into v_existing from public.cash_close_reports where cash_count_id = p_cash_count_id;
  if found and v_existing.report_status = 'final' then
    return jsonb_build_object('report_id', v_existing.id, 'status', 'final');
  end if;

  -- Pre-check: 1 final report per business_date.
  if exists (
    select 1 from public.cash_close_reports
    where business_date = v_count.business_date
      and report_status = 'final'
      and cash_count_id <> p_cash_count_id
  ) then
    raise exception 'Ngày % đã có báo cáo chốt két (final) cho cash_count khác. Hủy báo cáo cũ trước khi chốt mới.', v_count.business_date;
  end if;

  -- Nếu client gửi next_day_denominations, server tính tổng và dùng làm
  -- canonical leave_for_next_day (chống tampering qua p_leave_for_next_day).
  if p_next_day_denominations is not null then
    if jsonb_typeof(p_next_day_denominations) <> 'object' then
      raise exception 'p_next_day_denominations phải là JSON object {denom: count}.';
    end if;
    select coalesce(sum((key)::numeric * (value::text)::numeric), 0)
      into v_next_total
      from jsonb_each(p_next_day_denominations)
      where key ~ '^\d+$' and (value::text) ~ '^\d+$';
    v_leave := v_next_total;
  end if;

  if v_leave < 0 then
    raise exception 'leave_for_next_day không được âm.';
  end if;
  if v_leave > v_count.total_physical then
    raise exception 'leave_for_next_day (%) không được vượt physical_cash (%).', v_leave, v_count.total_physical;
  end if;
  v_safe_deposit := v_count.total_physical - v_leave;

  v_theory := public.compute_cash_theory(v_count.business_date, v_count.counted_at, v_count.bank_transfer_confirmed);
  v_pos_total := coalesce(nullif(v_count.pos_total, 0), (v_theory->>'pos_total')::numeric);
  v_pos_cash := coalesce(nullif(v_count.pos_cash_total, 0), (v_theory->>'pos_cash_total')::numeric);
  v_pos_non_cash := coalesce(nullif(v_count.pos_non_cash_total, 0), (v_theory->>'pos_non_cash_total')::numeric);
  v_opening := coalesce(nullif(v_count.opening_cash, 0), (v_theory->>'opening_cash')::numeric);
  v_bank_transfer := coalesce(v_count.bank_transfer_confirmed, (v_theory->>'bank_transfer_confirmed')::numeric, 0);
  v_expense := (v_theory->>'expense_cash_total')::numeric;
  v_payroll := (v_theory->>'payroll_cash_total')::numeric;
  v_theory_cash := (v_theory->>'theory_cash')::numeric;
  v_reconciliation := coalesce(nullif(v_count.reconciliation_total, 0), (v_count.total_physical - v_opening) + v_bank_transfer + v_expense + v_payroll);
  v_difference := coalesce(v_count.difference, v_pos_total - v_reconciliation);

  insert into public.cash_close_reports (
    business_date, cash_count_id, closed_at, closed_by,
    pos_total, opening_cash, pos_cash_total, pos_non_cash_total, bank_transfer_confirmed,
    expense_cash_total, payroll_cash_total, theory_cash, reconciliation_total,
    physical_cash, difference, denominations_json, sync_snapshot_at, note,
    safe_deposit_amount, leave_for_next_day,
    report_status
  ) values (
    v_count.business_date, p_cash_count_id, now(), auth.uid(),
    v_pos_total, v_opening, v_pos_cash, v_pos_non_cash, v_bank_transfer,
    v_expense, v_payroll, v_theory_cash, v_reconciliation,
    v_count.total_physical, v_difference, v_count.denominations_json, v_count.sales_snapshot_at, v_count.note,
    v_safe_deposit, v_leave,
    'final'
  )
  on conflict (cash_count_id) do update set
    closed_at = excluded.closed_at,
    closed_by = excluded.closed_by,
    pos_total = excluded.pos_total,
    opening_cash = excluded.opening_cash,
    pos_cash_total = excluded.pos_cash_total,
    pos_non_cash_total = excluded.pos_non_cash_total,
    bank_transfer_confirmed = excluded.bank_transfer_confirmed,
    expense_cash_total = excluded.expense_cash_total,
    payroll_cash_total = excluded.payroll_cash_total,
    theory_cash = excluded.theory_cash,
    reconciliation_total = excluded.reconciliation_total,
    physical_cash = excluded.physical_cash,
    difference = excluded.difference,
    denominations_json = excluded.denominations_json,
    sync_snapshot_at = excluded.sync_snapshot_at,
    note = excluded.note,
    safe_deposit_amount = excluded.safe_deposit_amount,
    leave_for_next_day = excluded.leave_for_next_day,
    report_status = 'final',
    void_reason = null,
    voided_by = null,
    voided_at = null
  returning id into v_report_id;

  -- Auto-deposit vào sổ quỹ, TÁCH theo quỹ (Sổ quỹ 2 quỹ):
  --   tiền mặt (physical − leave) → quỹ cash; chuyển khoản đã nhận → quỹ transfer.
  -- Chỉ ghi row khi phần đó > 0. Advisory lock per-fund chống race read-then-write.
  if v_safe_deposit > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund,
      description, cash_close_report_id, created_by
    ) values (
      'deposit_close',
      v_safe_deposit,
      public.safe_fund_balance_now('cash') + v_safe_deposit,
      'cash',
      'Nạp tiền mặt từ chốt két ngày ' || v_count.business_date::text,
      v_report_id,
      auth.uid()
    );
  end if;
  if v_bank_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund,
      description, cash_close_report_id, created_by
    ) values (
      'deposit_close',
      v_bank_transfer,
      public.safe_fund_balance_now('transfer') + v_bank_transfer,
      'transfer',
      'Nạp chuyển khoản từ chốt két ngày ' || v_count.business_date::text,
      v_report_id,
      auth.uid()
    );
  end if;

  -- Upsert cash_day_openings cho business_date+1 nếu client gửi denominations.
  -- Overwrite nếu tomorrow opening đã tồn tại (user đã agree với hành vi này).
  -- Void close report KHÔNG rollback opening đã tạo — user tự quyết.
  if p_next_day_denominations is not null then
    insert into public.cash_day_openings (
      business_date, denominations_json, opening_total,
      carried_from_previous_day, carried_amount, created_by
    ) values (
      v_count.business_date + 1, p_next_day_denominations, v_leave,
      true, v_leave, auth.uid()
    )
    on conflict (business_date) do update set
      denominations_json = excluded.denominations_json,
      opening_total = excluded.opening_total,
      carried_from_previous_day = true,
      carried_amount = excluded.carried_amount,
      updated_at = now();
  end if;

  return jsonb_build_object('report_id', v_report_id, 'status', 'final', 'safe_deposit', v_safe_deposit);
end;
$$;

-- Audit triggers cho safe_transactions + safe_counts
drop trigger if exists audit_safe_transactions on public.safe_transactions;
create trigger audit_safe_transactions
  after insert or update or delete on public.safe_transactions
  for each row execute function public._audit_row_change();

-- =====================================================================
-- Phase 4.A — Menu items CRUD
-- =====================================================================

create or replace function public.create_menu_item(
  p_name                  text,
  p_external_product_name text default null,
  p_notes                 text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền tạo sản phẩm.';
  end if;

  insert into public.menu_items (name, external_product_name, notes, created_by)
  values (
    trim(p_name),
    case when p_external_product_name is null then null else trim(p_external_product_name) end,
    p_notes,
    auth.uid()
  )
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'menu_item_created', 'menu_item', v_new_id,
    jsonb_build_object('name', trim(p_name),
                       'external_product_name', p_external_product_name)
  );

  return v_new_id;
end;
$$;

create or replace function public.update_menu_item(
  p_id                    uuid,
  p_name                  text,
  p_external_product_name text,
  p_notes                 text,
  p_is_active             boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền chỉnh sửa sản phẩm.';
  end if;

  update public.menu_items
     set name = trim(p_name),
         external_product_name = case when p_external_product_name is null then null else trim(p_external_product_name) end,
         notes = p_notes,
         is_active = p_is_active
   where id = p_id;

  if not found then
    raise exception 'Không tìm thấy sản phẩm với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'menu_item_updated', 'menu_item', p_id,
    jsonb_build_object('name', trim(p_name), 'is_active', p_is_active)
  );
end;
$$;

create or replace function public.delete_menu_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền xóa sản phẩm.';
  end if;

  if exists (select 1 from public.recipes where menu_item_id = p_id) then
    raise exception 'Không thể xóa: sản phẩm đang có công thức. Hãy xóa công thức trước.';
  end if;

  delete from public.menu_items where id = p_id;

  if not found then
    raise exception 'Không tìm thấy sản phẩm với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'menu_item_deleted', 'menu_item', p_id,
    jsonb_build_object()
  );
end;
$$;

create or replace function public.list_menu_items()
returns table (
  id                    uuid,
  name                  text,
  external_product_name text,
  is_active             boolean,
  notes                 text,
  created_at            timestamptz,
  recipe_count          bigint
)
language sql
stable
set search_path = public
as $$
  select m.id, m.name, m.external_product_name, m.is_active, m.notes, m.created_at,
         (select count(*) from public.recipes r where r.menu_item_id = m.id)::bigint as recipe_count
  from public.menu_items m
  order by m.name;
$$;

drop trigger if exists audit_safe_counts on public.safe_counts;
create trigger audit_safe_counts
  after insert or update or delete on public.safe_counts
  for each row execute function public._audit_row_change();

-- =====================================================================
-- Phase 4.A — Inventory: auto-deduction trigger
-- =====================================================================

create or replace function public._apply_sale_deductions_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_item_id  uuid;
  v_recipe_id     uuid;
  v_item          record;
  v_purchase_at   timestamptz;
begin
  -- Lookup parent order's purchase time for semantic correctness
  select purchase_at into v_purchase_at
  from public.sales_orders
  where id = new.sales_order_id;

  -- 1. Match menu_item by case-insensitive trimmed external_product_name
  select id into v_menu_item_id
  from public.menu_items
  where external_product_name is not null
    and lower(trim(external_product_name)) = lower(trim(new.product_name))
    and is_active = true
  limit 1;

  if v_menu_item_id is null then
    return new;
  end if;

  -- 2. Active recipe?
  select id into v_recipe_id
  from public.recipes
  where menu_item_id = v_menu_item_id and is_active = true
  limit 1;

  if v_recipe_id is null then
    return new;
  end if;

  -- 3. Emit one stock_movement per recipe_item, scaled by new.quantity
  for v_item in
    select ingredient_id, quantity from public.recipe_items where recipe_id = v_recipe_id
  loop
    insert into public.stock_movements (
      ingredient_id, quantity_delta, reason, occurred_at,
      source_order_id, source_recipe_id, created_by
    ) values (
      v_item.ingredient_id,
      -(v_item.quantity * new.quantity),
      'sale_theoretical',
      coalesce(v_purchase_at, now()),
      new.sales_order_id,
      v_recipe_id,
      null
    );
  end loop;

  return new;

exception when others then
  -- Defense-in-depth: never break ingest. Log + return new.
  -- Nested EXCEPTION guards audit_log INSERT itself.
  begin
    insert into public.audit_log (
      actor_user_id, actor_role, action, entity_type, entity_id, diff_json
    ) values (
      null, null, 'inventory_deduction_error', 'sales_order_item', new.id,
      jsonb_build_object(
        'sales_order_id', new.sales_order_id,
        'product_name', new.product_name,
        'sqlstate', SQLSTATE,
        'message', SQLERRM
      )
    );
  exception when others then
    null;  -- swallow secondary failure; ingest must continue
  end;
  return new;
end;
$$;

drop trigger if exists trg_apply_sale_deductions on public.sales_order_items;
drop trigger if exists sales_order_items_apply_deductions on public.sales_order_items;

create trigger sales_order_items_apply_deductions
after insert on public.sales_order_items
for each row
execute function public._apply_sale_deductions_row();

-- =====================================================================
-- Phase 4.A — Ingredients CRUD
-- =====================================================================

create or replace function public.create_ingredient(
  p_name                text,
  p_unit                text,
  p_low_stock_threshold numeric default null,
  p_notes               text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền tạo nguyên liệu.';
  end if;

  insert into public.ingredients (name, unit, low_stock_threshold, notes, created_by)
  values (trim(p_name), trim(p_unit), p_low_stock_threshold, p_notes, auth.uid())
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'ingredient_created', 'ingredient', v_new_id,
    jsonb_build_object('name', trim(p_name), 'unit', trim(p_unit),
                       'low_stock_threshold', p_low_stock_threshold)
  );

  return v_new_id;
end;
$$;

create or replace function public.update_ingredient(
  p_id                  uuid,
  p_name                text,
  p_unit                text,
  p_low_stock_threshold numeric,
  p_notes               text,
  p_is_active           boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền chỉnh sửa nguyên liệu.';
  end if;

  update public.ingredients
     set name = trim(p_name),
         unit = trim(p_unit),
         low_stock_threshold = p_low_stock_threshold,
         notes = p_notes,
         is_active = p_is_active
   where id = p_id;

  if not found then
    raise exception 'Không tìm thấy nguyên liệu với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'ingredient_updated', 'ingredient', p_id,
    jsonb_build_object('name', trim(p_name), 'is_active', p_is_active)
  );
end;
$$;

create or replace function public.delete_ingredient(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền xóa nguyên liệu.';
  end if;

  if exists (select 1 from public.stock_movements where ingredient_id = p_id) then
    raise exception 'Không thể xóa: nguyên liệu đã có giao dịch tồn kho. Hãy đặt is_active = false để vô hiệu hóa.';
  end if;

  if exists (select 1 from public.recipe_items where ingredient_id = p_id) then
    raise exception 'Không thể xóa: nguyên liệu đang được dùng trong công thức. Hãy xóa khỏi công thức trước.';
  end if;

  delete from public.ingredients where id = p_id;

  if not found then
    raise exception 'Không tìm thấy nguyên liệu với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'ingredient_deleted', 'ingredient', p_id,
    jsonb_build_object()
  );
end;
$$;

-- DROP trước: 2026-06-10 thêm OUT-column last_unit_price — create or replace
-- không đổi được return type của function returns table trên DB đã có bản cũ.
drop function if exists public.list_ingredients();
create or replace function public.list_ingredients()
returns table (
  id                  uuid,
  name                text,
  unit                text,
  low_stock_threshold numeric,
  last_unit_price     numeric,
  is_active           boolean,
  notes               text,
  created_at          timestamptz
)
language sql
stable
set search_path = public
as $$
  select i.id, i.name, i.unit, i.low_stock_threshold,
         i.last_unit_price, i.is_active, i.notes, i.created_at
  from public.ingredients i
  order by i.name;
$$;

-- =====================================================================
-- Phase 4.A — Recipes
-- =====================================================================

create or replace function public.upsert_recipe(
  p_menu_item_id uuid,
  p_is_active    boolean,
  p_notes        text,
  p_items        jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_recipe_id   uuid;
  v_item        jsonb;
  v_qty         numeric;
  v_ing_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền chỉnh sửa công thức.';
  end if;

  select id into v_recipe_id from public.recipes where menu_item_id = p_menu_item_id;
  if v_recipe_id is null then
    insert into public.recipes (menu_item_id, is_active, notes, created_by)
    values (p_menu_item_id, p_is_active, p_notes, auth.uid())
    returning id into v_recipe_id;
  else
    update public.recipes
       set is_active = p_is_active, notes = p_notes, updated_at = now()
     where id = v_recipe_id;
  end if;

  delete from public.recipe_items where recipe_id = v_recipe_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_ing_id := (v_item->>'ingredient_id')::uuid;
      v_qty    := (v_item->>'quantity')::numeric;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Số lượng cho mỗi nguyên liệu phải lớn hơn 0.';
      end if;
      if v_ing_id is null then
        raise exception 'ingredient_id thiếu hoặc không hợp lệ.';
      end if;
      insert into public.recipe_items (recipe_id, ingredient_id, quantity)
      values (v_recipe_id, v_ing_id, v_qty);
    end loop;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'recipe_upserted', 'recipe', v_recipe_id,
    jsonb_build_object('menu_item_id', p_menu_item_id,
                       'item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb)))
  );

  return v_recipe_id;
end;
$$;

create or replace function public.delete_recipe(p_recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_menu_id     uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền xóa công thức.';
  end if;

  select menu_item_id into v_menu_id from public.recipes where id = p_recipe_id;
  if v_menu_id is null then
    raise exception 'Không tìm thấy công thức với id %.', p_recipe_id;
  end if;

  delete from public.recipes where id = p_recipe_id;  -- cascades to recipe_items

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'recipe_deleted', 'recipe', p_recipe_id,
    jsonb_build_object('menu_item_id', v_menu_id)
  );
end;
$$;

create or replace function public.list_recipes()
returns table (
  recipe_id      uuid,
  menu_item_id   uuid,
  menu_item_name text,
  is_active      boolean,
  item_count     bigint,
  updated_at     timestamptz,
  notes          text
)
language sql
stable
set search_path = public
as $$
  select r.id as recipe_id,
         r.menu_item_id,
         m.name as menu_item_name,
         r.is_active,
         (select count(*) from public.recipe_items ri where ri.recipe_id = r.id)::bigint as item_count,
         r.updated_at,
         r.notes
  from public.recipes r
  join public.menu_items m on m.id = r.menu_item_id
  order by m.name;
$$;

create or replace function public.get_recipe_by_menu_item(p_menu_item_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case
    when r.id is null then null
    else jsonb_build_object(
      'recipe_id', r.id,
      'menu_item_id', r.menu_item_id,
      'is_active', r.is_active,
      'notes', r.notes,
      'items', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'ingredient_id', ri.ingredient_id,
            'ingredient_name', i.name,
            'unit', i.unit,
            'quantity', ri.quantity
          ) order by i.name)
         from public.recipe_items ri
         join public.ingredients i on i.id = ri.ingredient_id
         where ri.recipe_id = r.id),
        '[]'::jsonb
      )
    )
  end
  from public.recipes r
  where r.menu_item_id = p_menu_item_id
  limit 1;
$$;

-- =====================================================================
-- Phase 4.A — Stock movements + counts + balances
-- =====================================================================

create or replace function public.record_stock_movement(
  p_ingredient_id  uuid,
  p_quantity_delta numeric,
  p_reason         text,
  p_notes          text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager', 'staff_operator') then
    raise exception 'Bạn không có quyền nhập xuất kho.';
  end if;

  if p_reason not in ('purchase_received', 'manual_adjustment_in',
                      'manual_adjustment_out', 'waste') then
    raise exception 'Lý do không hợp lệ. Chỉ chấp nhận: purchase_received, manual_adjustment_in, manual_adjustment_out, waste.';
  end if;

  if p_reason in ('purchase_received', 'manual_adjustment_in') and p_quantity_delta <= 0 then
    raise exception 'Số lượng phải lớn hơn 0 cho lý do %.', p_reason;
  end if;
  if p_reason in ('manual_adjustment_out', 'waste') and p_quantity_delta >= 0 then
    raise exception 'Số lượng phải nhỏ hơn 0 cho lý do %.', p_reason;
  end if;

  insert into public.stock_movements (
    ingredient_id, quantity_delta, reason, notes, created_by
  ) values (p_ingredient_id, p_quantity_delta, p_reason, p_notes, auth.uid())
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'stock_movement_recorded', 'stock_movement', v_new_id,
    jsonb_build_object(
      'movement_id', v_new_id,
      'ingredient_id', p_ingredient_id,
      'delta', p_quantity_delta,
      'reason', p_reason
    )
  );

  return v_new_id;
end;
$$;

create or replace function public.record_stock_count(
  p_ingredient_id   uuid,
  p_actual_quantity numeric,
  p_notes           text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role         text;
  v_theoretical_before  numeric;
  v_delta               numeric;
  v_new_id              uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager', 'staff_operator') then
    raise exception 'Bạn không có quyền kiểm kê.';
  end if;

  if p_actual_quantity < 0 then
    raise exception 'Số lượng thực tế không thể âm.';
  end if;

  select coalesce(sum(quantity_delta), 0) into v_theoretical_before
  from public.stock_movements
  where ingredient_id = p_ingredient_id;

  v_delta := p_actual_quantity - v_theoretical_before;

  insert into public.stock_movements (
    ingredient_id, quantity_delta, reason, notes, created_by
  ) values (p_ingredient_id, v_delta, 'count_correction', p_notes, auth.uid())
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'stock_count_recorded', 'stock_movement', v_new_id,
    jsonb_build_object(
      'movement_id', v_new_id,
      'ingredient_id', p_ingredient_id,
      'theoretical_before', v_theoretical_before,
      'actual', p_actual_quantity,
      'delta', v_delta
    )
  );

  return v_new_id;
end;
$$;

create or replace function public.stock_balance_now(p_ingredient_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(quantity_delta), 0)::numeric
  from public.stock_movements
  where ingredient_id = p_ingredient_id;
$$;

create or replace function public.stock_balances_all()
returns table (
  ingredient_id        uuid,
  name                 text,
  unit                 text,
  theoretical_balance  numeric,
  low_stock_threshold  numeric,
  is_low               boolean,
  last_movement_at     timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    i.id as ingredient_id,
    i.name,
    i.unit,
    coalesce(sum(sm.quantity_delta), 0)::numeric as theoretical_balance,
    i.low_stock_threshold,
    case
      when i.low_stock_threshold is null then false
      else coalesce(sum(sm.quantity_delta), 0) < i.low_stock_threshold
    end as is_low,
    max(sm.occurred_at) as last_movement_at
  from public.ingredients i
  left join public.stock_movements sm on sm.ingredient_id = i.id
  where i.is_active = true
  group by i.id, i.name, i.unit, i.low_stock_threshold
  order by i.name;
$$;

create or replace function public.list_stock_movements(
  p_ingredient_id uuid    default null,
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_limit         int     default 100,
  p_offset        int     default 0
) returns table (
  id               uuid,
  ingredient_id    uuid,
  ingredient_name  text,
  quantity_delta   numeric,
  reason           text,
  occurred_at      timestamptz,
  source_order_id  uuid,
  source_recipe_id uuid,
  notes            text,
  created_by       uuid,
  created_at       timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    sm.id, sm.ingredient_id, i.name as ingredient_name,
    sm.quantity_delta, sm.reason, sm.occurred_at,
    sm.source_order_id, sm.source_recipe_id,
    sm.notes, sm.created_by, sm.created_at
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where (p_ingredient_id is null or sm.ingredient_id = p_ingredient_id)
    and (p_from is null or sm.occurred_at >= p_from)
    and (p_to   is null or sm.occurred_at <= p_to)
  order by sm.occurred_at desc, sm.id desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
$$;

-- =====================================================================
-- Phase 5.A — Inventory analytics reports
-- =====================================================================

-- Top ingredients consumed by sales over a date range.
-- Filters strictly to reason = 'sale_theoretical' (excludes manual moves,
-- count corrections, purchases, waste).
-- Drop first: return type changed (name → ingredient_name); CREATE OR REPLACE
-- cannot change OUT-column names in PostgreSQL.
drop function if exists public.inventory_consumption_by_ingredient(date, date);
create or replace function public.inventory_consumption_by_ingredient(
  p_from date,
  p_to   date
) returns table (
  ingredient_id    uuid,
  ingredient_name  text,
  unit             text,
  total_consumed   numeric,
  sale_count       int
)
language sql
stable
set search_path = public
as $$
  select
    i.id           as ingredient_id,
    i.name as ingredient_name,
    i.unit,
    sum(abs(sm.quantity_delta))::numeric      as total_consumed,
    count(distinct sm.source_order_id)::int   as sale_count
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where sm.reason = 'sale_theoretical'
    and (sm.occurred_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from
    and (sm.occurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to
  group by i.id, i.name, i.unit
  order by total_consumed desc;
$$;

-- Audit log of count_correction movements over a date range.
-- Used by the Variance Audit report. No running balance computation —
-- owner drills into Stock tab for full ledger context.
--
-- Note: quantity_delta may be 0 for count_correction rows (a correction
-- that confirmed the existing balance). The schema constraint
-- stock_movements_delta_nonzero exempts count_correction from the
-- nonzero rule.
create or replace function public.inventory_variance_audit(
  p_from date,
  p_to   date
) returns table (
  movement_id      uuid,
  ingredient_id    uuid,
  ingredient_name  text,
  unit             text,
  quantity_delta   numeric,
  occurred_at      timestamptz,
  notes            text,
  created_by       uuid
)
language sql
stable
set search_path = public
as $$
  select
    sm.id           as movement_id,
    sm.ingredient_id,
    i.name          as ingredient_name,
    i.unit,
    sm.quantity_delta,
    sm.occurred_at,
    sm.notes,
    sm.created_by
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where sm.reason = 'count_correction'
    and (sm.occurred_at at time zone 'Asia/Ho_Chi_Minh')::date >= p_from
    and (sm.occurred_at at time zone 'Asia/Ho_Chi_Minh')::date <= p_to
  order by sm.occurred_at desc;
$$;

-- =====================================================================
-- Phase 5.B — Sales reports
-- =====================================================================

-- Sales by product over a date range. Aggregates sales_order_items
-- joined to sales_orders, filtered by sales_orders.business_date.
-- Groups by (product_id, product_code, product_name, category_name) —
-- so a mid-period rename or recategorisation surfaces as 2 rows.
create or replace function public.sales_product_summary(
  p_from date,
  p_to   date
) returns table (
  product_id     text,
  product_code   text,
  product_name   text,
  category_name  text,
  total_quantity numeric,
  total_revenue  numeric,
  order_count    int
)
language sql
stable
set search_path = public
as $$
  select
    soi.product_id,
    soi.product_code,
    soi.product_name,
    soi.category_name,
    sum(soi.quantity)::numeric            as total_quantity,
    sum(soi.line_total)::numeric          as total_revenue,
    count(distinct so.id)::int            as order_count
  from public.sales_orders so
  join public.sales_order_items soi on soi.sales_order_id = so.id
  where so.business_date >= p_from
    and so.business_date <= p_to
  group by soi.product_id, soi.product_code, soi.product_name, soi.category_name
  order by total_revenue desc;
$$;

-- Sales by category over a date range. Same JOIN + WHERE filter; groups
-- by category_name only. Intentionally NO order_count column — one order
-- with multiple products in same category would overcount.
create or replace function public.sales_category_summary(
  p_from date,
  p_to   date
) returns table (
  category_name  text,
  total_quantity numeric,
  total_revenue  numeric
)
language sql
stable
set search_path = public
as $$
  select
    soi.category_name,
    sum(soi.quantity)::numeric   as total_quantity,
    sum(soi.line_total)::numeric as total_revenue
  from public.sales_orders so
  join public.sales_order_items soi on soi.sales_order_id = so.id
  where so.business_date >= p_from
    and so.business_date <= p_to
  group by soi.category_name
  order by total_revenue desc;
$$;

-- =====================================================================
-- Phase 5.C — Expense + payroll reports
-- =====================================================================

-- Expense aggregation by category over a date range.
-- LEFT JOIN because expenses.category_id is nullable — a NULL row
-- surfaces as its own bucket displayed as "Chưa phân loại" in UI.
-- No is_active filter on categories — historical expenses against
-- deactivated categories must surface.
--
-- SECURITY DEFINER: expense_categories_read RLS filters is_active
-- for non-owner roles, which would silently drop deactivated
-- category names from the LEFT JOIN for staff callers. Bypassing
-- RLS here preserves the "historical data must surface" intent for
-- all authorized report viewers (owner + manager + staff_operator,
-- gated upstream by NAV_ITEMS).
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
  group by e.category_id, c.name
  order by total_amount desc;
$$;

-- Payroll aggregation by employee over a date range.
-- INNER JOIN — schema enforces shift_payroll_records.employee_id NOT NULL.
-- Returns total_minutes as 5th column for "hours worked" display
-- (formatted client-side as "8 giờ 25").
-- No is_active filter on employees — historical pay records for
-- now-inactive employees must surface.
create or replace function public.payroll_summary_by_employee(
  p_from date,
  p_to   date
) returns table (
  employee_id    uuid,
  employee_name  text,
  total_pay      numeric,
  shift_count    int,
  total_minutes  int
)
language sql
stable
set search_path = public
as $$
  select
    p.employee_id,
    e.name                       as employee_name,
    sum(p.total_pay)::numeric    as total_pay,
    count(*)::int                as shift_count,
    sum(p.total_minutes)::int    as total_minutes
  from public.shift_payroll_records p
  join public.employees e on e.id = p.employee_id
  where p.business_date >= p_from
    and p.business_date <= p_to
  group by p.employee_id, e.name
  order by total_pay desc;
$$;

-- =====================================================================
-- Phase 5.D — Hourly trends report
-- =====================================================================

-- Sales aggregation by hour-of-day over a date range. Always returns
-- 24 rows (one per hour 0..23) via generate_series LEFT JOIN — zero
-- hours surface as zero bars in the UI chart, giving the owner
-- shop-hours context at a glance.
--
-- CRITICAL: AT TIME ZONE 'Asia/Ho_Chi_Minh' is applied BEFORE
-- extract(hour ...) so the bucket reflects Vietnam local time, not
-- UTC. Without this, a 02:00 UTC sale (= 09:00 Vietnam) would bucket
-- as hour=2 instead of hour=9. Same defense as 5.A T1's date-cast fix.
-- See pgTAP file 190 Tests 3 + 4 for explicit boundary verification.
--
-- business_date filter (not purchase_at directly) matches the 5.B
-- convention — date boundary handled at the sales_orders level,
-- hour bucket derived from purchase_at via the timezone-aware cast.
create or replace function public.sales_hourly_summary(
  p_from date,
  p_to   date
) returns table (
  sale_hour      int,
  total_quantity numeric,
  total_revenue  numeric,
  order_count    int
)
language sql
stable
set search_path = public
as $$
  with hours as (
    select generate_series(0, 23) as sale_hour
  ),
  agg as (
    select
      extract(hour from (so.purchase_at at time zone 'Asia/Ho_Chi_Minh'))::int as sale_hour,
      sum(soi.quantity)::numeric                                                as total_quantity,
      sum(soi.line_total)::numeric                                              as total_revenue,
      count(distinct so.id)::int                                                as order_count
    from public.sales_orders so
    join public.sales_order_items soi on soi.sales_order_id = so.id
    where so.business_date >= p_from
      and so.business_date <= p_to
    group by extract(hour from (so.purchase_at at time zone 'Asia/Ho_Chi_Minh'))
  )
  select
    h.sale_hour,
    coalesce(a.total_quantity, 0)::numeric as total_quantity,
    coalesce(a.total_revenue, 0)::numeric  as total_revenue,
    coalesce(a.order_count, 0)::int        as order_count
  from hours h
  left join agg a on a.sale_hour = h.sale_hour
  order by h.sale_hour asc;
$$;

-- =============================================================================
-- Kết toán kỳ (Period Close & Owner Draw) — 2026-06-12
-- Spec: docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
-- owner_draw KHÔNG tạo expenses (khác hẳn safe_withdraw_other) → lợi nhuận
-- không bị trừ. "Hôm nay" = ngày VN (KHÔNG current_date — UTC lệch sau 0h VN).
-- Khối này được trích nguyên văn vào migration 2026-06-12-period-close-settlement.sql.
-- =============================================================================

-- Neo đầu kỳ: (kết final gần nhất + 1) → ngày HOẠT ĐỘNG KINH DOANH sớm nhất
-- (least qua sales/expenses/payroll/sổ quỹ). Adversarial review 2026-06-12:
-- KHÔNG neo riêng initial_setup — dữ liệu bán hàng import (KiotViet) có thể
-- CŨ HƠN ngày lập sổ quỹ, neo theo setup sẽ bỏ sót P&L kỳ đầu.
-- least()/greatest() của Postgres bỏ qua NULL. KHÔNG grant authenticated (nội bộ).
create or replace function public.period_close_period_start(p_as_of date)
returns date
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select max(close_date) + 1 from public.period_closes where status = 'final'),
    least(
      (select min(business_date) from public.sales_orders),
      (select min(business_date) from public.expenses),
      (select min(business_date) from public.shift_payroll_records),
      (select min((occurred_at at time zone 'Asia/Ho_Chi_Minh')::date) from public.safe_transactions)
    ),
    p_as_of
  );
$$;
revoke all on function public.period_close_period_start(date) from public;

create or replace function public.period_close_preview(p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_start date;
  v_revenue numeric; v_expenses numeric; v_payroll numeric;
  v_cash numeric; v_transfer numeric;
  v_overview jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được xem kết toán kỳ.';
  end if;
  if v_as_of > v_today then
    raise exception 'Ngày kết không được ở tương lai.';
  end if;
  v_start := public.period_close_period_start(v_as_of);

  select coalesce(sum(net_amount), 0) into v_revenue
    from public.sales_orders where business_date between v_start and v_as_of;
  -- Owner: TOÀN BỘ expenses (gồm mirror rút quỹ vận hành) — khớp cash_flow_overview.
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where business_date between v_start and v_as_of;
  select coalesce(sum(total_pay), 0) into v_payroll
    from public.shift_payroll_records where business_date between v_start and v_as_of;

  v_cash := public.safe_fund_balance_now('cash');
  v_transfer := public.safe_fund_balance_now('transfer');

  -- by_day + expense_breakdown tái dùng cash_flow_overview (owner đã pass check trên;
  -- function sống trong migration 2026-05-28-e — resolve lúc CHẠY, không phải lúc CREATE).
  if v_start <= v_as_of then
    v_overview := public.cash_flow_overview(v_start, v_as_of);
  else
    v_overview := jsonb_build_object('by_day', '[]'::jsonb, 'expense_breakdown', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'period_start', v_start,
    'period_end', v_as_of,
    'can_close', v_start <= v_as_of,
    'revenue', v_revenue,
    'expenses_total', v_expenses,
    'payroll_total', v_payroll,
    'profit', v_revenue - v_expenses - v_payroll,
    'balance_cash', v_cash,
    'balance_transfer', v_transfer,
    'balance_total', v_cash + v_transfer,
    'opening_total', (select closing_total from public.period_closes
                       where status = 'final'
                       order by close_date desc, created_at desc limit 1),
    'by_day', coalesce(v_overview -> 'by_day', '[]'::jsonb),
    'expense_breakdown', coalesce(v_overview -> 'expense_breakdown', '[]'::jsonb)
  );
end;
$$;
grant execute on function public.period_close_preview(date) to authenticated;

create or replace function public.finalize_period_close(
  p_close_date date,
  p_draw_cash numeric,
  p_draw_transfer numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_draw_cash numeric := coalesce(p_draw_cash, 0);
  v_draw_transfer numeric := coalesce(p_draw_transfer, 0);
  v_start date;
  v_revenue numeric; v_expenses numeric; v_payroll numeric;
  v_before_cash numeric; v_before_transfer numeric;
  v_opening numeric;
  v_close_id uuid; v_cash_tx uuid; v_transfer_tx uuid;
  v_desc text;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được kết toán kỳ.';
  end if;
  if p_close_date is null or p_close_date > v_today then
    raise exception 'Ngày kết không được ở tương lai.';
  end if;
  if v_draw_cash < 0 or v_draw_transfer < 0 then
    raise exception 'Số tiền rút mỗi quỹ không được âm.';
  end if;
  if v_draw_cash <> floor(v_draw_cash) or v_draw_transfer <> floor(v_draw_transfer) then
    raise exception 'Số tiền phải là số nguyên VND.';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'Ghi chú vượt 500 ký tự.';
  end if;

  -- Chống 2 finalize/void đồng thời (đọc anchor + insert snapshot là 1 đơn vị).
  perform pg_advisory_xact_lock(hashtext('period_close'));

  v_start := public.period_close_period_start(p_close_date);
  if v_start > p_close_date then
    if exists (select 1 from public.period_closes where status = 'final') then
      raise exception 'Đã có kỳ kết đến ngày %. Huỷ lần kết gần nhất nếu muốn kết lại.',
        to_char(v_start - 1, 'DD/MM/YYYY');
    else
      raise exception 'Chưa có hoạt động kinh doanh nào trước ngày kết (đầu kỳ tính được là %).',
        to_char(v_start, 'DD/MM/YYYY');
    end if;
  end if;

  select coalesce(sum(net_amount), 0) into v_revenue
    from public.sales_orders where business_date between v_start and p_close_date;
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where business_date between v_start and p_close_date;
  select coalesce(sum(total_pay), 0) into v_payroll
    from public.shift_payroll_records where business_date between v_start and p_close_date;
  select closing_total into v_opening from public.period_closes
   where status = 'final' order by close_date desc, created_at desc limit 1;

  -- Số dư & chặn rút quá TỪNG quỹ — lock cả 2 quỹ theo thứ tự cố định (cash trước,
  -- nhất quán mọi RPC khác để tránh deadlock).
  perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
  perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
  v_before_cash := public.safe_fund_balance_now('cash');
  v_before_transfer := public.safe_fund_balance_now('transfer');
  if v_draw_cash > v_before_cash then
    raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, rút %.', v_before_cash, v_draw_cash;
  end if;
  if v_draw_transfer > v_before_transfer then
    raise exception 'Quỹ chuyển khoản không đủ. Số dư hiện tại %, rút %.', v_before_transfer, v_draw_transfer;
  end if;

  -- Insert snapshot TRƯỚC owner_draw (FK period_close_id immediate — adversarial
  -- review: thứ tự trong spec gốc §4.2 sẽ fail).
  insert into public.period_closes (
    close_date, period_start, period_end,
    revenue, expenses_total, payroll_total, profit,
    opening_total, balance_before_cash, balance_before_transfer,
    draw_cash, draw_transfer, draw_total,
    closing_cash, closing_transfer, closing_total,
    note, created_by
  ) values (
    p_close_date, v_start, p_close_date,
    v_revenue, v_expenses, v_payroll, v_revenue - v_expenses - v_payroll,
    coalesce(v_opening, 0), v_before_cash, v_before_transfer,
    v_draw_cash, v_draw_transfer, v_draw_cash + v_draw_transfer,
    v_before_cash - v_draw_cash, v_before_transfer - v_draw_transfer,
    (v_before_cash - v_draw_cash) + (v_before_transfer - v_draw_transfer),
    nullif(trim(p_note), ''), auth.uid()
  ) returning id into v_close_id;

  v_desc := 'Rút lợi nhuận kỳ ' || to_char(v_start, 'DD/MM') || '–' || to_char(p_close_date, 'DD/MM/YYYY');
  -- occurred_at = 0h VN của ngày kết, TƯỜNG MINH (adversarial review 2026-06-12:
  -- bare cast date::timestamptz ăn theo TimeZone GUC của session — offset > +7
  -- sẽ lệch nhãn ngày VN trong analytics bucket).
  if v_draw_cash > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      description, period_close_id, created_by
    ) values (
      'owner_draw', -v_draw_cash, v_before_cash - v_draw_cash, 'cash',
      p_close_date::timestamp at time zone 'Asia/Ho_Chi_Minh', v_desc, v_close_id, auth.uid()
    ) returning id into v_cash_tx;
  end if;
  if v_draw_transfer > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      description, period_close_id, created_by
    ) values (
      'owner_draw', -v_draw_transfer, v_before_transfer - v_draw_transfer, 'transfer',
      p_close_date::timestamp at time zone 'Asia/Ho_Chi_Minh', v_desc, v_close_id, auth.uid()
    ) returning id into v_transfer_tx;
  end if;
  -- LƯU Ý: KHÔNG insert public.expenses — điểm sống còn của thiết kế (bất biến #1).

  return jsonb_build_object(
    'id', v_close_id,
    'period_start', v_start, 'period_end', p_close_date,
    'revenue', v_revenue, 'expenses_total', v_expenses,
    'payroll_total', v_payroll, 'profit', v_revenue - v_expenses - v_payroll,
    'draw_cash', v_draw_cash, 'draw_transfer', v_draw_transfer,
    'draw_total', v_draw_cash + v_draw_transfer,
    'closing_cash', v_before_cash - v_draw_cash,
    'closing_transfer', v_before_transfer - v_draw_transfer,
    'closing_total', (v_before_cash - v_draw_cash) + (v_before_transfer - v_draw_transfer),
    'cash_tx_id', v_cash_tx, 'transfer_tx_id', v_transfer_tx
  );
end;
$$;
grant execute on function public.finalize_period_close(date, numeric, numeric, text) to authenticated;

create or replace function public.list_period_closes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner xem được lịch sử kết toán kỳ.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.close_date desc, p.created_at desc), '[]'::jsonb)
    into v_result
  from public.period_closes p;
  return v_result;
end;
$$;
grant execute on function public.list_period_closes() to authenticated;

create or replace function public.void_period_close(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_close public.period_closes%rowtype;
  v_latest uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được huỷ kết toán kỳ.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Lý do huỷ phải ≥ 5 ký tự.';
  end if;

  perform pg_advisory_xact_lock(hashtext('period_close'));

  select * into v_close from public.period_closes where id = p_id for update;
  if not found then
    raise exception 'Không tìm thấy kỳ kết để huỷ.';
  end if;
  if v_close.status <> 'final' then
    raise exception 'Kỳ kết này đã bị huỷ trước đó.';
  end if;
  select id into v_latest from public.period_closes
   where status = 'final' order by close_date desc, created_at desc limit 1;
  if v_latest <> p_id then
    raise exception 'Chỉ huỷ được lần kết gần nhất.';
  end if;

  update public.period_closes
     set status = 'voided', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
   where id = p_id;

  -- Hoàn từng quỹ qua adjustment dương (tiền lệ void_cash_close_report —
  -- KHÔNG xoá owner_draw gốc, giữ audit trail).
  if v_close.draw_cash > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, description, period_close_id, created_by
    ) values (
      'adjustment', v_close.draw_cash,
      public.safe_fund_balance_now('cash') + v_close.draw_cash, 'cash',
      'Hoàn rút lợi nhuận do huỷ kỳ kết ' || to_char(v_close.close_date, 'DD/MM/YYYY') || ': ' || left(p_reason, 80),
      p_id, auth.uid()
    );
  end if;
  if v_close.draw_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, description, period_close_id, created_by
    ) values (
      'adjustment', v_close.draw_transfer,
      public.safe_fund_balance_now('transfer') + v_close.draw_transfer, 'transfer',
      'Hoàn rút lợi nhuận do huỷ kỳ kết ' || to_char(v_close.close_date, 'DD/MM/YYYY') || ': ' || left(p_reason, 80),
      p_id, auth.uid()
    );
  end if;

  return jsonb_build_object(
    'id', p_id, 'status', 'voided',
    'refunded_cash', v_close.draw_cash, 'refunded_transfer', v_close.draw_transfer
  );
end;
$$;
grant execute on function public.void_period_close(uuid, text) to authenticated;

-- ============================================================== ANALYTICS-VIEWS-BEGIN
-- Analytics cho n8n (PULL qua PostgREST service_role, header Accept-Profile: analytics).
-- Spec: docs/superpowers/specs/2026-06-10-analytics-data-surface-n8n-design.md (+ Addendum).
-- Khối này được trích nguyên văn vào database/migrations/2026-06-11-analytics-views.sql
-- (dual-write byte-identical) — sửa ở đây thì PHẢI tái sinh migration.
-- Lưu ý ngữ nghĩa: daily_pnl/daily_cashflow bucket theo occurred_at (nhãn ngày user,
-- back-date được); cash_position cắt theo created_at (chuỗi số dư as-recorded).

create schema if not exists analytics;

drop view if exists analytics.daily_pnl cascade;
create view analytics.daily_pnl
with (security_invoker = true) as
with days as (
  select business_date from public.sales_orders
  union
  select business_date from public.expenses where safe_transaction_id is null
  union
  select business_date from public.shift_payroll_records
  union
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.safe_transactions where transaction_type = 'withdraw_other'
),
rev as (
  select business_date, sum(net_amount) as revenue
  from public.sales_orders group by 1
),
pay as (
  select so.business_date,
         sum(sp.amount) filter (where sp.payment_method = 'cash')          as revenue_cash,
         sum(sp.amount) filter (where sp.payment_method = 'bank_transfer') as revenue_transfer
  from public.sales_payments sp
  join public.sales_orders so on so.id = sp.sales_order_id
  group by 1
),
exp as (
  select business_date, sum(amount) as expenses_total
  from public.expenses where safe_transaction_id is null group by 1
),
saf as (
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date as business_date,
         -sum(amount) as safe_outflow_operating
  from public.safe_transactions
  where transaction_type = 'withdraw_other'
  group by 1
),
pr as (
  select business_date, sum(total_pay) as payroll_total
  from public.shift_payroll_records group by 1
)
select d.business_date,
       coalesce(rev.revenue, 0)                as revenue,
       coalesce(pay.revenue_cash, 0)           as revenue_cash,
       coalesce(pay.revenue_transfer, 0)       as revenue_transfer,
       coalesce(exp.expenses_total, 0)         as expenses_total,
       coalesce(saf.safe_outflow_operating, 0) as safe_outflow_operating,
       coalesce(pr.payroll_total, 0)           as payroll_total,
       coalesce(rev.revenue, 0) - coalesce(exp.expenses_total, 0)
         - coalesce(saf.safe_outflow_operating, 0) - coalesce(pr.payroll_total, 0) as net_profit_cash
from days d
left join rev using (business_date)
left join pay using (business_date)
left join exp using (business_date)
left join saf using (business_date)
left join pr  using (business_date);

comment on view analytics.daily_pnl is
  'P&L cash-basis theo ngày cho n8n. expenses_total đã loại expense mirror của rút quỹ '
  '(safe_transaction_id is null). safe_outflow_operating = withdraw_other (gồm mua NL), '
  'bucket theo occurred_at (nhãn ngày, back-date được).';

drop view if exists analytics.daily_cashflow cascade;
create view analytics.daily_cashflow
with (security_invoker = true) as
with days as (
  select so.business_date
  from public.sales_payments sp join public.sales_orders so on so.id = sp.sales_order_id
  union
  select business_date from public.expenses where safe_transaction_id is null
  union
  select business_date from public.shift_payroll_records
  union
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.safe_transactions where transaction_type in ('withdraw_other', 'owner_draw')
),
pay as (
  select so.business_date,
         sum(sp.amount) filter (where sp.payment_method = 'cash')          as cash_in_pos,
         sum(sp.amount) filter (where sp.payment_method = 'bank_transfer') as transfer_in
  from public.sales_payments sp
  join public.sales_orders so on so.id = sp.sales_order_id
  group by 1
),
exp as (
  select business_date, sum(amount) as expense_out
  from public.expenses where safe_transaction_id is null group by 1
),
pr as (
  select business_date, sum(total_pay) as payroll_out
  from public.shift_payroll_records group by 1
),
saf as (
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date as business_date,
         -sum(amount) filter (where transaction_type = 'withdraw_other' and reason_category = 'inventory')                 as safe_withdraw_inventory,
         -sum(amount) filter (where transaction_type = 'withdraw_other' and reason_category is distinct from 'inventory') as safe_withdraw_other_ops,
         -sum(amount) filter (where transaction_type = 'owner_draw')                                                      as safe_draw_owner
  from public.safe_transactions
  where transaction_type in ('withdraw_other', 'owner_draw')
  group by 1
)
select d.business_date,
       coalesce(pay.cash_in_pos, 0)              as cash_in_pos,
       coalesce(pay.transfer_in, 0)              as transfer_in,
       coalesce(exp.expense_out, 0)              as expense_out,
       coalesce(pr.payroll_out, 0)               as payroll_out,
       coalesce(saf.safe_withdraw_inventory, 0)  as safe_withdraw_inventory,
       coalesce(saf.safe_withdraw_other_ops, 0)  as safe_withdraw_other_ops,
       coalesce(saf.safe_draw_owner, 0)          as safe_draw_owner,
       coalesce(pay.cash_in_pos, 0) + coalesce(pay.transfer_in, 0) as total_in,
       coalesce(exp.expense_out, 0) + coalesce(pr.payroll_out, 0)
         + coalesce(saf.safe_withdraw_inventory, 0) + coalesce(saf.safe_withdraw_other_ops, 0)
         + coalesce(saf.safe_draw_owner, 0) as total_out,
       coalesce(pay.cash_in_pos, 0) + coalesce(pay.transfer_in, 0)
         - (coalesce(exp.expense_out, 0) + coalesce(pr.payroll_out, 0)
            + coalesce(saf.safe_withdraw_inventory, 0) + coalesce(saf.safe_withdraw_other_ops, 0)
            + coalesce(saf.safe_draw_owner, 0)) as net_cashflow
from days d
left join pay using (business_date)
left join exp using (business_date)
left join pr  using (business_date)
left join saf using (business_date);

comment on view analytics.daily_cashflow is
  'Dòng tiền vào/ra theo ngày từ bảng nghiệp vụ gốc. Loại deposit_close/withdraw_open/'
  'adjustment/initial_setup (luân chuyển nội bộ, vốn, bù trừ void). Expense mirror của '
  'rút quỹ đã loại. safe_draw_owner = rút lợi nhuận (owner_draw) — TÍNH vào total_out '
  '(tiền rời doanh nghiệp) nhưng KHÔNG phải chi phí P&L. Bucket safe theo occurred_at.';

drop view if exists analytics.cash_position cascade;
create view analytics.cash_position
with (security_invoker = true) as
with days as (
  select business_date from public.cash_close_reports where report_status = 'final'
  union
  select (created_at at time zone 'Asia/Ho_Chi_Minh')::date from public.safe_transactions
),
drawer as (
  select business_date, leave_for_next_day
  from public.cash_close_reports
  where report_status = 'final'
)
select d.business_date,
       coalesce(drawer.leave_for_next_day, 0) as drawer_leave,
       coalesce(sc.balance_after, 0)          as safe_cash_recorded,
       coalesce(st.balance_after, 0)          as safe_transfer_recorded,
       coalesce(drawer.leave_for_next_day, 0) + coalesce(sc.balance_after, 0)
         + coalesce(st.balance_after, 0)      as total_position
from days d
left join drawer using (business_date)
left join lateral (
  select balance_after from public.safe_transactions
  where fund = 'cash'
    and created_at < ((d.business_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  order by created_at desc, id desc limit 1
) sc on true
left join lateral (
  select balance_after from public.safe_transactions
  where fund = 'transfer'
    and created_at < ((d.business_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  order by created_at desc, id desc limit 1
) st on true;

comment on view analytics.cash_position is
  'Vị thế tiền cuối ngày. safe_*_recorded cắt theo created_at (số dư sổ cái như đã ghi) '
  '— CỐ Ý khác daily_pnl (bucket occurred_at): rút back-date vào P&L ngày nhãn nhưng '
  'không sửa position lịch sử. drawer_leave chỉ lấy report final.';

drop view if exists analytics.cash_variance cascade;
create view analytics.cash_variance
with (security_invoker = true) as
with days as (
  select business_date from public.cash_counts
  union
  select (counted_at at time zone 'Asia/Ho_Chi_Minh')::date from public.safe_counts
),
drawer as (
  select business_date,
         sum(difference) filter (where count_type = 'shift_close') as drawer_shift_diff,
         count(*)        filter (where count_type = 'shift_close') as drawer_shift_counts,
         sum(difference) filter (where count_type = 'day_close')   as drawer_dayclose_diff,
         count(*)        filter (where count_type = 'day_close')   as drawer_dayclose_counts,
         sum(difference) filter (where count_type = 'spot_audit')  as drawer_spot_diff,
         count(*)        filter (where count_type = 'spot_audit')  as drawer_spot_counts
  from public.cash_counts
  group by 1
),
safe as (
  select (counted_at at time zone 'Asia/Ho_Chi_Minh')::date as business_date,
         sum(difference) as safe_diff,
         count(*)        as safe_counts_n
  from public.safe_counts
  group by 1
)
select d.business_date,
       drawer.drawer_shift_diff,
       coalesce(drawer.drawer_shift_counts, 0)    as drawer_shift_counts,
       drawer.drawer_dayclose_diff,
       coalesce(drawer.drawer_dayclose_counts, 0) as drawer_dayclose_counts,
       drawer.drawer_spot_diff,
       coalesce(drawer.drawer_spot_counts, 0)     as drawer_spot_counts,
       safe.safe_diff,
       coalesce(safe.safe_counts_n, 0)            as safe_counts_n
from days d
left join drawer using (business_date)
left join safe   using (business_date);

comment on view analytics.cash_variance is
  'Lệch đếm két/quỹ theo ngày (tín hiệu rò rỉ). Σ + count per loại; sum NULL khi '
  'không có lần đếm (0 ≠ không đếm).';
-- ============================================================== ANALYTICS-VIEWS-END

-- ============================================================== SELF-CHECKIN-BEGIN
-- Self-check-in (2026-06-25): check_in_self (service-role-only), get_my_checkin_status,
-- anchor RPCs (owner-only), fresh_anchor_ips (service-role-only).
-- Spec: docs/superpowers/specs/2026-06-25-employee-login-self-checkin-design.md §5.
-- =============================================================================

-- check_in_self — SERVICE-ROLE-ONLY (route đã verify JWT → trusted p_auth_user_id).
create or replace function public.check_in_self(p_auth_user_id uuid, p_ip inet, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_employee uuid; v_name text; v_id uuid; v_already boolean := false; v_check_in timestamptz := now(); v_date date := current_date; v_start time;
begin
  if p_auth_user_id is null then raise exception 'Thiếu danh tính.'; end if;
  select ea.employee_id, e.name into v_employee, v_name
    from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
    where ea.auth_user_id = p_auth_user_id and ea.status = 'active' limit 1;
  if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;
  v_start := coalesce(
    (select (value->>'shift_start_time')::time from public.app_settings where key = 'checkin_network'),
    '05:30'::time);
  -- giờ tường minh VN: cast `at time zone 'Asia/Ho_Chi_Minh'` KHÔNG ăn theo
  -- TimeZone GUC của session (bare now()::time có thể là UTC → gate sai wall-clock).
  if (now() at time zone 'Asia/Ho_Chi_Minh')::time < v_start then
    raise exception 'Chưa tới giờ vào ca (mở lúc %).', to_char(v_start, 'HH24:MI');
  end if;
  insert into public.shift_assignments
    (employee_id, business_date, check_in_at, status, created_by, updated_by, check_in_ip, check_in_user_agent)
  values (v_employee, v_date, v_check_in, 'checked_in', p_auth_user_id, p_auth_user_id, p_ip, p_user_agent)
  on conflict (employee_id, business_date) where status = 'checked_in' do nothing
  returning id into v_id;
  if v_id is null then
    v_already := true;
    select id into v_id from public.shift_assignments
      where employee_id = v_employee and business_date = v_date and status = 'checked_in'
      order by check_in_at desc limit 1;
  end if;
  select check_in_at into v_check_in from public.shift_assignments where id = v_id;
  return jsonb_build_object('shift_assignment_id', v_id, 'employee_name', v_name, 'check_in_at', v_check_in, 'already_checked_in', v_already);
end; $$;
revoke execute on function public.check_in_self(uuid, inet, text) from public, anon, authenticated;
grant execute on function public.check_in_self(uuid, inet, text) to service_role;

-- get_my_checkin_status — authenticated, đọc của CHÍNH caller.
create or replace function public.get_my_checkin_status()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v_employee uuid; v_name text; v_in_id uuid; v_in timestamptz; v_found boolean;
        v_out timestamptz; v_out_found boolean; v_self_checkout boolean;
begin
  select ea.employee_id, e.name into v_employee, v_name
    from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
    where ea.auth_user_id = auth.uid() and ea.status = 'active' limit 1;
  if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;
  select id, check_in_at into v_in_id, v_in from public.shift_assignments
    where employee_id = v_employee and business_date = current_date and status = 'checked_in'
    order by check_in_at desc limit 1;
  v_found := found;
  select check_out_at into v_out from public.shift_assignments
    where employee_id = v_employee and business_date = current_date and status = 'checked_out'
    order by check_out_at desc limit 1;
  v_out_found := found;
  select coalesce((value->>'self_checkout_enabled')::boolean, false) into v_self_checkout
    from public.app_settings where key = 'checkin_network';
  return jsonb_build_object(
    'employee_name', v_name,
    'checked_in_today', v_found,
    'check_in_at', case when v_found then v_in else null end,
    'shift_assignment_id', case when v_found then v_in_id else null end,
    'checked_out_today', coalesce(v_out_found, false),
    'check_out_at', case when v_out_found then v_out else null end,
    'self_checkout_enabled', coalesce(v_self_checkout, false)
  );
end; $$;

-- Anchor RPCs — owner-only (inlined, no external reference).
create or replace function public.add_shop_anchor(p_label text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v public.checkin_anchor%rowtype;
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cấu hình thiết bị quán.'; end if;
  if p_label is null or length(btrim(p_label)) = 0 then raise exception 'Nhãn thiết bị trống.'; end if;
  if p_token_hash is null or length(p_token_hash) <> 64 then raise exception 'Token thiết bị không hợp lệ.'; end if;
  insert into public.checkin_anchor (label, device_token_hash, is_active, created_by)
  values (btrim(p_label), lower(p_token_hash), true, auth.uid()) returning * into v;
  return jsonb_build_object('id', v.id, 'label', v.label, 'is_active', v.is_active);
end; $$;

create or replace function public.remove_shop_anchor(p_anchor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cấu hình thiết bị quán.'; end if;
  delete from public.checkin_anchor where id = p_anchor_id;
  return jsonb_build_object('removed', p_anchor_id);
end; $$;

-- SERVICE-ROLE-ONLY: /api/shop-presence/heartbeat verifies the device token
-- (constant-time) then calls this via service role. The device token IS the
-- credential — NO owner session required — so an always-on shop device keeps the
-- anchor IP fresh under ANY logged-in session (manager/staff). IP is route-read.
create or replace function public.record_shop_anchor_heartbeat(p_anchor_id uuid, p_public_ip inet)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare v public.checkin_anchor%rowtype;
begin
  update public.checkin_anchor set current_public_ip = p_public_ip, last_heartbeat_at = now()
   where id = p_anchor_id returning * into v;
  if not found then raise exception 'Không tìm thấy thiết bị quán.'; end if;
  return jsonb_build_object('id', v.id, 'current_public_ip', host(v.current_public_ip), 'last_heartbeat_at', v.last_heartbeat_at);
end; $$;
revoke execute on function public.record_shop_anchor_heartbeat(uuid, inet) from public, anon, authenticated;
grant execute on function public.record_shop_anchor_heartbeat(uuid, inet) to service_role;

create or replace function public.update_checkin_network_config(p_config jsonb)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not (public.app_role() = 'owner') then raise exception 'Bạn không có quyền cập nhật cấu hình check-in.'; end if;
  if jsonb_typeof(p_config) <> 'object' or not (p_config ? 'enabled') or not (p_config ? 'reject_message')
     or not (p_config ? 'grace_hours') or jsonb_typeof(p_config->'enabled') <> 'boolean'
     or (p_config->>'grace_hours')::numeric < 0 then raise exception 'Cấu hình check-in không hợp lệ.'; end if;
  -- self_checkout_enabled (tùy chọn) — bật tự ra ca độc lập với self check-in.
  if (p_config ? 'self_checkout_enabled') and jsonb_typeof(p_config->'self_checkout_enabled') <> 'boolean' then
    raise exception 'self_checkout_enabled phải là boolean.';
  end if;
  if (p_config ? 'shift_start_time') and
     (jsonb_typeof(p_config->'shift_start_time') <> 'string'
      or (p_config->>'shift_start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'shift_start_time phải là HH:MM (24 giờ).';
  end if;
  -- R7/C3 guard: cannot enable until at least one active anchor has a non-null IP.
  if (p_config->>'enabled')::boolean = true
     and not exists (select 1 from public.checkin_anchor where is_active and current_public_ip is not null) then
    raise exception 'Chưa có thiết bị quán nào có IP — không thể bật cổng check-in.';
  end if;
  -- self-checkout cũng qua cổng IP/anchor → cùng guard.
  if coalesce((p_config->>'self_checkout_enabled')::boolean, false) = true
     and not exists (select 1 from public.checkin_anchor where is_active and current_public_ip is not null) then
    raise exception 'Chưa có thiết bị quán nào có IP — không thể bật tự ra ca.';
  end if;
  insert into public.app_settings (key, value, is_public, updated_by)
  values ('checkin_network', p_config, false, auth.uid())
  on conflict (key) do update
    set value = public.app_settings.value || excluded.value,
        is_public = false, updated_by = auth.uid(), updated_at = now();
  return p_config;
end; $$;

-- fresh_anchor_ips — SERVICE-ROLE-ONLY read; freshness computed in Postgres (R7/S9/N3).
create or replace function public.fresh_anchor_ips(p_grace_hours numeric)
returns setof text language sql security definer set search_path = public, auth as $$
  select host(current_public_ip) from public.checkin_anchor
  where is_active and current_public_ip is not null
    and last_heartbeat_at > now() - make_interval(secs => greatest(0, p_grace_hours)::double precision * 3600);
$$;
revoke execute on function public.fresh_anchor_ips(numeric) from public, anon, authenticated;
grant execute on function public.fresh_anchor_ips(numeric) to service_role;

-- check_out_self — TỰ RA CA (Phase 2a). Service-role-only như check_in_self. Đóng
-- ca mở hôm nay + chốt lương (như check_out_employee nhưng KHÔNG phụ cấp, KHÔNG
-- sửa giờ tay). Owner sửa/duyệt sau qua edit_shift_payroll_record.
create or replace function public.check_out_self(p_auth_user_id uuid, p_ip inet, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_rate numeric(14,2);
  v_shift uuid; v_in timestamptz; v_out timestamptz := now(); v_date date := current_date;
  v_minutes integer; v_base numeric(14,2); v_total numeric(14,2);
  v_payroll_id uuid; v_existing_out timestamptz; v_existing_total numeric(14,2);
begin
  if p_auth_user_id is null then raise exception 'Thiếu danh tính.'; end if;
  select ea.employee_id, e.name, e.hourly_rate into v_employee, v_name, v_rate
    from public.employee_accounts ea join public.employees e on e.id = ea.employee_id
    where ea.auth_user_id = p_auth_user_id and ea.status = 'active' limit 1;
  if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;

  -- (Codex finding #1) Chặn tự ra ca khi ngày đã chốt két final — tránh lệch
  -- snapshot lương trong cash_close_reports (đồng bộ guard ở edit_shift_payroll_record).
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể tự ra ca. Báo quản lý/chủ quán.', v_date;
  end if;

  -- (Codex finding #2) Atomic transition: chỉ đóng khi CA còn 'checked_in'. Hai
  -- request đua nhau → chỉ MỘT thắng (RETURNING có row); cái còn lại 0 row → nhánh
  -- idempotent. total_minutes tính ngay trong UPDATE từ check_in_at của row.
  update public.shift_assignments sa
     set check_out_at = v_out,
         total_minutes = greatest(0, round(extract(epoch from (v_out - sa.check_in_at)) / 60)::integer),
         status = 'checked_out',
         updated_by = p_auth_user_id,
         check_out_ip = p_ip,
         check_out_user_agent = p_user_agent
   where sa.id = (
           select id from public.shift_assignments
            where employee_id = v_employee and business_date = v_date and status = 'checked_in'
            order by check_in_at desc limit 1)
     and sa.status = 'checked_in'
   returning sa.id, sa.check_in_at, sa.total_minutes into v_shift, v_in, v_minutes;

  if v_shift is null then
    -- Không có ca mở → đã đóng (idempotent) hoặc chưa vào ca.
    select sa.id, sa.check_out_at, p.total_pay
      into v_shift, v_existing_out, v_existing_total
      from public.shift_assignments sa
      left join public.shift_payroll_records p on p.shift_assignment_id = sa.id
      where sa.employee_id = v_employee and sa.business_date = v_date and sa.status = 'checked_out'
      order by sa.check_out_at desc limit 1;
    if v_shift is null then raise exception 'Chưa vào ca hôm nay.'; end if;
    return jsonb_build_object('shift_assignment_id', v_shift, 'employee_name', v_name,
      'check_out_at', v_existing_out, 'total_pay', coalesce(v_existing_total, 0), 'already_checked_out', true);
  end if;

  v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
  v_total := v_base;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, note, edited_by, edited_at, created_by)
  values (v_shift, v_employee, v_date, v_in, v_out, v_minutes, coalesce(v_rate, 0), v_base, 0, v_total, null, p_auth_user_id, now(), p_auth_user_id)
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, edited_by = p_auth_user_id, edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, p_auth_user_id, 'app_action', 'Lương theo lượt TỰ ra ca');
  end if;

  return jsonb_build_object('shift_assignment_id', v_shift, 'employee_name', v_name, 'check_out_at', v_out, 'total_pay', v_total, 'already_checked_out', false);
end; $$;
revoke execute on function public.check_out_self(uuid, inet, text) from public, anon, authenticated;
grant execute on function public.check_out_self(uuid, inet, text) to service_role;
-- ============================================================== SELF-CHECKIN-END

-- check_out_employee_now — QUẢN LÝ đóng ca hộ (owner+manager). Đóng ở giờ hiện tại
-- + LÀM TRÒN phút lên bội số 15 (tối đa +14). Chốt lương (phụ cấp 0). Guard
-- final-close. Authenticated-callable (guard nội bộ); actor = auth.uid().
create or replace function public.check_out_employee_now(p_shift_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_rate numeric(14,2); v_date date;
  v_in timestamptz; v_out timestamptz := now();
  v_raw integer; v_minutes integer; v_base numeric(14,2); v_total numeric(14,2);
  v_payroll_id uuid;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được đóng ca hộ.';
  end if;

  select sa.employee_id, sa.business_date, sa.check_in_at, e.name, e.hourly_rate
    into v_employee, v_date, v_in, v_name, v_rate
    from public.shift_assignments sa join public.employees e on e.id = sa.employee_id
   where sa.id = p_shift_assignment_id and sa.status = 'checked_in';
  if not found then raise exception 'Ca không tồn tại hoặc đã đóng.'; end if;

  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;

  v_raw := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  v_minutes := ((v_raw + 14) / 15) * 15;  -- làm tròn LÊN bội số 15 (tối đa +14)

  update public.shift_assignments
     set check_out_at = v_out, total_minutes = v_minutes, status = 'checked_out', updated_by = auth.uid()
   where id = p_shift_assignment_id and status = 'checked_in';
  if not found then raise exception 'Ca đã được đóng.'; end if;

  v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
  v_total := v_base;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, note, edited_by, edited_at, created_by)
  values (p_shift_assignment_id, v_employee, v_date, v_in, v_out, v_minutes, coalesce(v_rate,0), v_base, 0, v_total, null, auth.uid(), now(), auth.uid())
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, edited_by = auth.uid(), edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, auth.uid(), 'app_action', 'Lương theo lượt (quản lý đóng ca)');
  end if;

  return jsonb_build_object('shift_assignment_id', p_shift_assignment_id, 'employee_name', v_name,
    'check_out_at', v_out, 'total_minutes', v_minutes, 'total_pay', v_total);
end; $$;

-- ============================================================== REPOINT-ACCOUNT-BEGIN
-- Re-point account (2026-06-26): đổi nhân viên cho một tài khoản ĐÃ gắn sang NV đích
-- chưa có TK; deactivate NV nguồn (KHÔNG xoá → giữ FK con). SERVICE-ROLE-ONLY
-- (route verify owner JWT → p_auth_user_id tin cậy). Nguyên tử: FOR UPDATE +
-- atomic conditional UPDATE (chống TOCTOU). Spec: 2026-06-26-repoint-account-design.md
create or replace function public.repoint_account(
  p_auth_user_id uuid,
  p_target_employee_id uuid,
  p_expected_source_employee_id uuid
)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_source uuid;
  v_target_name text;
  v_target_active boolean;
  v_updated int;
begin
  if p_auth_user_id is null or p_target_employee_id is null or p_expected_source_employee_id is null then
    raise exception 'Thiếu tham số.' using errcode = 'P0001';
  end if;

  select employee_id into v_source
    from public.employee_accounts
    where auth_user_id = p_auth_user_id
    for update;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'P0002';
  end if;
  if v_source is null then
    raise exception 'Tài khoản chưa gắn nhân viên — dùng chức năng liên kết.' using errcode = 'P0001';
  end if;
  if v_source = p_target_employee_id then
    raise exception 'Tài khoản đã gắn đúng nhân viên này rồi.' using errcode = 'P0001';
  end if;

  select name, is_active into v_target_name, v_target_active
    from public.employees where id = p_target_employee_id;
  if not found or v_target_active is not true then
    raise exception 'Nhân viên đích không tồn tại hoặc đã nghỉ.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.employee_accounts where employee_id = p_target_employee_id) then
    raise exception 'Nhân viên đích đã có tài khoản.' using errcode = '23505';
  end if;

  update public.employee_accounts
     set employee_id = p_target_employee_id
   where auth_user_id = p_auth_user_id
     and employee_id = p_expected_source_employee_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Dữ liệu đã thay đổi — tải lại trang rồi thử lại.' using errcode = 'P0001';
  end if;

  update public.employees set is_active = false where id = v_source;

  insert into public.profiles (id, display_name)
  values (p_auth_user_id, v_target_name)
  on conflict (id) do update set display_name = excluded.display_name;

  return jsonb_build_object(
    'auth_user_id', p_auth_user_id,
    'employee_id', p_target_employee_id,
    'source_employee_id', v_source,
    'source_deactivated', true
  );
end; $$;
revoke execute on function public.repoint_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.repoint_account(uuid, uuid, uuid) to service_role;
-- ============================================================== REPOINT-ACCOUNT-END
