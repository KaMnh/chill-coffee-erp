-- Migration 2026-06-28: rule "ra ca het moi chot" + advisory lock per-business_date
-- (cash_close:<business_date>) chong lech luong khi chot ket. Dual-write byte-identical
-- voi database/002_functions.sql. Spec: 2026-06-28-finalize-shift-lock.

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

  -- Serialize per-business_date (idiom safe_fund:*): chống lệch lương khi
  -- chốt két chạy đồng thời với check-in / sửa lương cùng ngày. Đặt SỚM,
  -- trước rule-check + snapshot. Transaction-scoped → tự nhả khi commit/rollback.
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_count.business_date::text));
  -- rule: phải ra ca hết trước khi chốt (UX + đóng race close↔finalize)
  if exists (select 1 from public.shift_assignments
             where business_date = v_count.business_date and status = 'checked_in') then
    raise exception 'Còn ca chưa ra ca trong ngày % — đóng/ra hết ca trước khi chốt két.', v_count.business_date;
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
  -- Serialize per-business_date với chốt két + chặn vào ca trên ngày đã chốt két
  -- (chống lệch lương / ca kẹt; xem spec 2026-06-28-finalize-shift-lock).
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két — không thể vào ca. Báo quản lý/chủ quán.', v_date;
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

  -- Serialize per-business_date với chốt két + chặn vào ca trên ngày đã chốt két.
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két — không thể vào ca.', v_date;
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
