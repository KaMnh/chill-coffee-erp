-- =============================================================================
-- 2026-06-27 — Attendance Lockdown Phase 2b
-- =============================================================================
-- Mục tiêu (đối chiếu canonical 002_functions.sql + 003_rls.sql, dual-write byte-identical):
--   1. app_is_owner() helper — gate owner-only.
--   2. Khóa 3 RPC chấm công thủ công về OWNER-ONLY:
--        check_in_employee / check_out_employee / edit_shift_payroll_record.
--   3. Bỏ TẤT CẢ direct-write RLS trên shift_assignments + shift_payroll_records
--      (Codex #1): mọi write chỉ qua security-definer RPC. Read policy GIỮ NGUYÊN.
--   4. _audit_attendance_change() — audit trail actor-aware (Codex #2): coalesce
--      auth.uid() → created_by/updated_by/edited_by để self check-in/out (chạy bằng
--      service_role, auth.uid() null) vẫn ghi đúng actor. Gắn vào 2 trigger
--      audit_shift_assignments + audit_payroll.
--
-- Self-standing: chứa FULL body các function (không chỉ dòng đổi). Throwaway DB
-- runner áp dụng file này SAU 001/002/003 → create-or-replace ghi đè bản canonical.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- STEP 2 — app_is_owner() helper
-- ---------------------------------------------------------------------------
create or replace function public.app_is_owner()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select public.app_role() = 'owner'; $$;

-- ---------------------------------------------------------------------------
-- STEP 3 — Khóa 3 RPC chấm công thủ công về OWNER-ONLY (full body, byte-identical 002)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- STEP 4 — Bỏ direct-write RLS (Codex #1): mọi write qua security-definer RPC.
-- Read policy (shifts_staff_read / payroll_staff_read) GIỮ NGUYÊN ở 003.
-- ---------------------------------------------------------------------------
drop policy if exists shifts_staff_write on public.shift_assignments;
drop policy if exists shifts_staff_update on public.shift_assignments;
drop policy if exists payroll_staff_write on public.shift_payroll_records;
drop policy if exists payroll_staff_update on public.shift_payroll_records;

-- ---------------------------------------------------------------------------
-- STEP 5 — _audit_attendance_change() + 2 trigger (Codex #2).
-- audit_payroll chuyển từ _audit_row_change → _audit_attendance_change (replace
-- in-place). audit_shift_assignments là trigger MỚI. 7 audit_* trigger khác +
-- _audit_row_change GIỮ NGUYÊN.
-- ---------------------------------------------------------------------------
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
