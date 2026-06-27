-- =============================================================================
-- Migration: Self-checkout (tự ra ca) + công tắc self_checkout_enabled (Phase 2a)
-- Spec: docs/superpowers/specs/2026-06-26-self-checkout-toggle-design.md
-- Dual-write: các function dưới đây byte-identical với database/002_functions.sql;
-- cột với 001_schema.sql; re-assert quyền với 003_rls.sql.
-- =============================================================================

-- Cột audit lượt tự ra ca.
alter table public.shift_assignments add column if not exists check_out_ip inet;
alter table public.shift_assignments add column if not exists check_out_user_agent text;

-- get_my_checkin_status — thêm shift_assignment_id / checked_out_today / check_out_at
-- / self_checkout_enabled (giữ field cũ để không vỡ client cũ).
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

-- update_checkin_network_config — nhận thêm self_checkout_enabled (boolean) + guard anchor-IP.
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
  on conflict (key) do update set value = excluded.value, is_public = false, updated_by = auth.uid(), updated_at = now();
  return p_config;
end; $$;

-- check_out_self — TỰ RA CA. Service-role-only. Atomic transition + final-close guard.
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

  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể tự ra ca. Báo quản lý/chủ quán.', v_date;
  end if;

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

-- Data-fix (DB cũ): thêm self_checkout_enabled:false vào row checkin_network đã lưu
-- nếu thiếu (seed dùng on conflict do nothing nên không tự thêm). Idempotent.
update public.app_settings
   set value = value || '{"self_checkout_enabled": false}'::jsonb
 where key = 'checkin_network' and not (value ? 'self_checkout_enabled');
