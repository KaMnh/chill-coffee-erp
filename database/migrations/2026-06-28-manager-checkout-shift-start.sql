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
