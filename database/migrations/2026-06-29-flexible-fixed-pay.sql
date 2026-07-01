-- 2026-06-29 — Loại lương "cố định" (per-day) cho nhân viên.
-- Idempotent: chạy lại an toàn. Mỗi function body DƯỚI ĐÂY phải BYTE-IDENTICAL
-- với bản canonical trong database/002_functions.sql (dual-write).

alter table public.employees add column if not exists pay_type text not null default 'hourly';
alter table public.employees add column if not exists default_daily_pay numeric(14,2);
alter table public.shift_payroll_records add column if not exists pay_type text not null default 'hourly';
alter table public.shift_payroll_records add column if not exists override_pay numeric(14,2);

do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'employees_pay_type_check') then
    alter table public.employees add constraint employees_pay_type_check
      check (pay_type in ('hourly','fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_default_daily_pay_check') then
    alter table public.employees add constraint employees_default_daily_pay_check
      check (default_daily_pay is null or (default_daily_pay >= 0 and default_daily_pay <= 100000000));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_pay_type_check') then
    alter table public.shift_payroll_records add constraint payroll_pay_type_check
      check (pay_type in ('hourly','fixed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_override_pay_check') then
    alter table public.shift_payroll_records add constraint payroll_override_pay_check
      check (override_pay is null or (override_pay >= 0 and override_pay <= 100000000));
  end if;
end $do$;

-- ===== check_out_employee (dual-write byte-identical với 002_functions.sql) =====
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
  v_pay_type text;
  v_default_daily numeric(14,2);
  v_override numeric(14,2) := (p_payload->>'override_pay')::numeric;
  v_base numeric(14,2);
  v_allowance numeric(14,2) := coalesce((p_payload->>'allowance_amount')::numeric, 0);
  v_total numeric(14,2);
  v_snapshot_rate numeric(14,2);
  v_snapshot_override numeric(14,2);
  v_payroll_id uuid;
begin
  if not public.app_is_owner() then raise exception 'Chỉ chủ quán được ra ca hộ. Nhân viên tự ra ca ở màn Chấm công.'; end if;
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;
  if v_out < v_in then raise exception 'Giờ ra không được nhỏ hơn giờ vào.'; end if;
  select hourly_rate, coalesce(pay_type, 'hourly'), default_daily_pay
    into v_rate, v_pay_type, v_default_daily
    from public.employees where id = v_employee;
  v_minutes := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  if v_pay_type = 'fixed' then
    v_base := coalesce(v_override, v_default_daily, 0);
    v_snapshot_rate := 0;
    v_snapshot_override := v_base;
  else
    v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
    v_snapshot_rate := coalesce(v_rate, 0);
    v_snapshot_override := null;
  end if;
  v_total := v_base + v_allowance;

  update public.shift_assignments set check_in_at = v_in, check_out_at = v_out, total_minutes = v_minutes, status = 'checked_out', updated_by = auth.uid() where id = v_shift;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, pay_type, override_pay, note, edited_by, edited_at, created_by)
  values (v_shift, v_employee, v_date, v_in, v_out, v_minutes, v_snapshot_rate, v_base, v_allowance, v_total, v_pay_type, v_snapshot_override, p_payload->>'note', auth.uid(), now(), auth.uid())
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, pay_type = excluded.pay_type, override_pay = excluded.override_pay, note = excluded.note, edited_by = auth.uid(), edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, auth.uid(), 'app_action', 'Lương theo lượt ra ca');
  end if;

  return jsonb_build_object('shift_assignment_id', v_shift, 'payroll_record_id', v_payroll_id, 'total_pay', v_total);
end;
$$;

-- ===== edit_shift_payroll_record (dual-write byte-identical với 002_functions.sql) =====
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
  v_override numeric(14,2);
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

  -- Serialize per-business_date với chốt két (chống race edit↔finalize làm lệch
  -- snapshot lương; xem spec 2026-06-28-finalize-shift-lock).
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_record.business_date::text));

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
  if coalesce(v_record.pay_type, 'hourly') = 'fixed' then
    v_override := coalesce((p_payload->>'override_pay')::numeric, v_record.override_pay, 0);
    v_base := v_override;
  else
    v_override := null;
    v_base := round(((v_minutes::numeric / 60) * coalesce(v_record.hourly_rate, 0)) / 1000) * 1000;
  end if;
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
      override_pay = v_override,
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

-- ===== check_out_employee_now (dual-write byte-identical với 002_functions.sql) =====
create or replace function public.check_out_employee_now(p_shift_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_rate numeric(14,2); v_date date;
  v_pay_type text; v_default_daily numeric(14,2);
  v_in timestamptz; v_out timestamptz := now();
  v_raw integer; v_minutes integer; v_base numeric(14,2); v_total numeric(14,2);
  v_snapshot_rate numeric(14,2); v_snapshot_override numeric(14,2);
  v_payroll_id uuid;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được đóng ca hộ.';
  end if;

  select sa.employee_id, sa.business_date, sa.check_in_at, e.name, e.hourly_rate, coalesce(e.pay_type,'hourly'), e.default_daily_pay
    into v_employee, v_date, v_in, v_name, v_rate, v_pay_type, v_default_daily
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

  if v_pay_type = 'fixed' then
    v_base := coalesce(v_default_daily, 0);
    v_snapshot_rate := 0;
    v_snapshot_override := v_base;
  else
    v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
    v_snapshot_rate := coalesce(v_rate, 0);
    v_snapshot_override := null;
  end if;
  v_total := v_base;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, pay_type, override_pay, note, edited_by, edited_at, created_by)
  values (p_shift_assignment_id, v_employee, v_date, v_in, v_out, v_minutes, v_snapshot_rate, v_base, 0, v_total, v_pay_type, v_snapshot_override, null, auth.uid(), now(), auth.uid())
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, pay_type = excluded.pay_type, override_pay = excluded.override_pay, edited_by = auth.uid(), edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, auth.uid(), 'app_action', 'Lương theo lượt (quản lý đóng ca)');
  end if;

  return jsonb_build_object('shift_assignment_id', p_shift_assignment_id, 'employee_name', v_name,
    'check_out_at', v_out, 'total_minutes', v_minutes, 'total_pay', v_total);
end; $$;

-- ===== check_out_self (dual-write byte-identical với 002_functions.sql) =====
create or replace function public.check_out_self(p_auth_user_id uuid, p_ip inet, p_user_agent text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_rate numeric(14,2);
  v_pay_type text; v_default_daily numeric(14,2);
  v_snapshot_rate numeric(14,2); v_snapshot_override numeric(14,2);
  v_shift uuid; v_in timestamptz; v_out timestamptz := now(); v_date date := current_date;
  v_minutes integer; v_base numeric(14,2); v_total numeric(14,2);
  v_payroll_id uuid; v_existing_out timestamptz; v_existing_total numeric(14,2);
begin
  if p_auth_user_id is null then raise exception 'Thiếu danh tính.'; end if;
  select ea.employee_id, e.name, e.hourly_rate, coalesce(e.pay_type, 'hourly'), e.default_daily_pay
    into v_employee, v_name, v_rate, v_pay_type, v_default_daily
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

  if v_pay_type = 'fixed' then
    v_base := coalesce(v_default_daily, 0);
    v_snapshot_rate := 0;
    v_snapshot_override := v_base;
  else
    v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
    v_snapshot_rate := coalesce(v_rate, 0);
    v_snapshot_override := null;
  end if;
  v_total := v_base;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, pay_type, override_pay, note, edited_by, edited_at, created_by)
  values (v_shift, v_employee, v_date, v_in, v_out, v_minutes, v_snapshot_rate, v_base, 0, v_total, v_pay_type, v_snapshot_override, null, p_auth_user_id, now(), p_auth_user_id)
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, pay_type = excluded.pay_type, override_pay = excluded.override_pay, edited_by = p_auth_user_id, edited_at = now()
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

-- ===== dashboard_daily_ops (dual-write byte-identical với 002_functions.sql) =====
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

  select coalesce(jsonb_agg(jsonb_build_object('check_in_at', sa.check_in_at, 'hourly_rate', coalesce(e.hourly_rate, 0), 'pay_type', coalesce(e.pay_type, 'hourly')) order by sa.check_in_at), '[]'::jsonb)
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
