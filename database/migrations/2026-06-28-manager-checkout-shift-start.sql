-- 2026-06-28 — Manager checkout + shift-start gate
-- =================================================
-- Áp dụng cho DB đã chạy bản trước (idempotent: create or replace + data-fix có guard).
-- Mỗi function body Ở ĐÂY phải BYTE-IDENTICAL với bản canonical trong
-- database/002_functions.sql (dual-write). Migration tự đứng độc lập (full body).
--
-- Nội dung:
--   1) check_out_employee_now — QUẢN LÝ (owner+manager) đóng ca hộ ở giờ hiện tại,
--      làm tròn phút LÊN bội số 15 (tối đa +14). Chốt lương (phụ cấp 0). Guard final-close.
--   2) check_out_employee — thêm guard final-close (Codex #1).
--   3) check_in_self — chặn vào ca trước giờ bắt đầu (shift_start_time, mặc định 05:30).
--   4) update_checkin_network_config — validate shift_start_time (HH:MM) + MERGE config
--      giữ key cũ (Codex #3).
--   5) seed data-fix — vá shift_start_time=05:30 vào row checkin_network hiện hữu (nếu thiếu).

-- ---------------------------------------------------------------------------
-- 1) check_out_employee_now — QUẢN LÝ đóng ca hộ (owner+manager). Đóng ở giờ hiện tại
-- + LÀM TRÒN phút lên bội số 15 (tối đa +14). Chốt lương (phụ cấp 0). Guard
-- final-close. Authenticated-callable (guard nội bộ); actor = auth.uid().
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2) check_out_employee — thêm guard final-close (Codex #1). Full body dual-write.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3) check_in_self — chặn vào ca trước shift_start_time (mặc định 05:30). Full body.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) update_checkin_network_config — validate shift_start_time (HH:MM) + MERGE
--    config giữ key cũ (Codex #3). Full body dual-write.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 5) Data-fix — vá shift_start_time=05:30 vào row checkin_network hiện hữu nếu thiếu.
-- ---------------------------------------------------------------------------
update public.app_settings
   set value = value || '{"shift_start_time": "05:30"}'::jsonb
 where key = 'checkin_network' and not (value ? 'shift_start_time');
