-- 2026-06-28-z-writer-locks-cash-close.sql
-- (Áp SAU manager-checkout (#63) & shift-finalize-lock (#64) — prefix 'z-' để sort CUỐI,
--  nếu không các migration đó sẽ create-or-replace đè mất lock dưới đây.)
-- Bổ sung pg_advisory_xact_lock(hashtext('cash_close:'||business_date)) cho 4 đường ghi
-- mà #64 CHƯA khóa:
--   check_out_employee, check_out_self, update_cash_count  → đã có guard final-close
--     (từ #63/cũ) nhưng THIẾU lock → vẫn race check-then-write với finalize.
--   save_cash_day_opening → chưa đụng: thêm CẢ lock LẪN guard (opening_cash KHÔNG
--     time-bound trong compute_cash_theory nên lock một mình không đủ).
-- update_cash_count: finalize đọc cash_counts bằng plain SELECT → FOR UPDATE ở đó KHÔNG
--   chặn finalize → cần advisory lock chung mới serialize sửa-count vs chốt két.
-- Thứ tự lock toàn cục giữ: cash_close → safe_fund:cash → safe_fund:transfer (không deadlock).
--
-- Dual-write: FULL body 4 hàm byte-identical với 002_functions.sql (bản hiệu lực).
-- Lưu ý: save_cash_day_opening canonical = bản 002:~2647 (có safe_withdrawal), KHÔNG
-- phải bản dead ~219.


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

  -- Serialize ghi lương/két vs finalize_cash_close_report theo business_date (advisory
  -- xact lock, giữ tới commit). #64 đã khóa finalize/edit/check_in; bổ sung lock cho
  -- đường ra-ca-hộ — guard final-close đã có (từ #63) nhưng THIẾU lock → vẫn race
  -- check-then-write. Cùng key 'cash_close:<date>' với finalize.
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));

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

  -- Serialize vs finalize_cash_close_report theo business_date (xem check_out_employee):
  -- guard final-close đã có nhưng thiếu lock → bổ sung lock cho đường tự-ra-ca.
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));

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

  -- Serialize vs finalize_cash_close_report theo business_date (xem check_out_employee).
  -- opening_cash KHÔNG time-bound trong compute_cash_theory → lock một mình KHÔNG đủ,
  -- cần thêm GUARD chặn sửa sau khi đã chốt. #64 chưa đụng tới đường này (thiếu cả
  -- lock lẫn guard). Lock cash_close TRƯỚC safe_fund:cash bên dưới (giữ thứ tự, tránh deadlock).
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_date::text));
  if exists (
    select 1 from public.cash_close_reports
    where business_date = v_date and report_status = 'final'
  ) then
    raise exception 'Ngày % đã chốt két (final). Hủy báo cáo (qua flow void) trước khi sửa tiền đầu ngày.', v_date;
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

  -- Serialize vs finalize_cash_close_report theo business_date (xem check_out_employee).
  -- cash_counts là input GỐC finalize đọc bằng plain SELECT (FOR UPDATE ở trên KHÔNG
  -- chặn finalize) → cần advisory lock chung mới serialize sửa-count vs chốt két.
  perform pg_advisory_xact_lock(hashtext('cash_close:' || v_count.business_date::text));

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
