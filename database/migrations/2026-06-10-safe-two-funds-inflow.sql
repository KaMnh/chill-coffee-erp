-- 2026-06-10-safe-two-funds-inflow.sql
-- Sổ quỹ 2 quỹ — Phase 2: nguồn vào CK + fund-aware hóa TOÀN BỘ writer/reader sổ quỹ.
--   finalize_cash_close_report: tách deposit cash + transfer; clear void-metadata khi re-finalize.
--   void_cash_close_report: hoàn CẢ 2 quỹ (cash=safe_deposit_amount, transfer=bank_transfer_confirmed).
--   safe_setup_initial: nhập 2 số dư mở đầu (drop chữ ký cũ numeric,text).
--   save_cash_day_opening: rút mở két từ QUỸ TIỀN MẶT.
--   edit_cash_close_report / safe_withdraw_other(v3) / safe_adjust / safe_count:
--     đổi cơ sở số dư sang safe_fund_balance_now('cash') + fund='cash' + advisory lock
--     (fix lỗ hổng cross-fund read sau khi quỹ transfer có row — adversarial review 2026-06-10).
--   safe_balance_now(): redefine = TỔNG 2 quỹ, display-only — KHÔNG chain balance_after từ nó.
-- INVARIANT: mỗi DB transaction ghi TỐI ĐA 1 row mỗi quỹ (per-fund advisory lock + chain
-- từ safe_fund_balance_now(fund)); production mỗi RPC là 1 transaction riêng → cặp
-- (created_at, id) đọc "row ghi gần nhất" per-fund luôn xác định.
-- Yêu cầu: migration foundation (cột fund + safe_fund_balance_now) đã áp trước (alphabetical).
-- Thân hàm trích NGUYÊN VĂN từ canonical database/002_functions.sql (dual-write byte-identical).

-- ===== void_cash_close_report (reverse per-fund) =====
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

-- ===== edit_cash_close_report (leave-change -> quỹ cash) =====
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

-- ===== safe_balance_now (display-only: tổng 2 quỹ) =====
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

-- ===== safe_setup_initial (drop chữ ký cũ + 2 quỹ) =====
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

-- ===== safe_withdraw_other v3 (quỹ cash + expense link) =====
create or replace function public.safe_withdraw_other(
  p_amount numeric,
  p_category text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_balance numeric;
  v_next numeric;
  v_id uuid;
  v_expense_id uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được rút sổ quỹ.';
  end if;
  if p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Số tiền rút phải 1–1.000.000.000.';
  end if;
  if p_category not in ('utilities', 'rent', 'inventory', 'maintenance', 'other') then
    raise exception 'Loại chi không hợp lệ.';
  end if;
  if length(coalesce(p_description, '')) > 500 then
    raise exception 'Mô tả vượt 500 ký tự.';
  end if;

  -- Serialize per-fund chống race (advisory lock thay row-lock cross-fund cũ).
  perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
  v_balance := public.safe_fund_balance_now('cash');
  v_next := v_balance - p_amount;
  if v_next < 0 then
    raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, rút %.', v_balance, p_amount;
  end if;

  insert into public.safe_transactions (
    transaction_type, amount, balance_after, fund,
    reason_category, description, created_by
  ) values (
    'withdraw_other', -p_amount, v_next, 'cash',
    p_category, p_description, auth.uid()
  ) returning id into v_id;

  -- Auto-create expense row linked to this safe withdrawal.
  -- payment_method='other' → no cash_drawer_events side effect.
  -- category_id=NULL → row appears as "(chưa phân loại)" in cashflow breakdown.
  insert into public.expenses (
    business_date,
    description,
    amount,
    payment_method,
    category_id,
    safe_transaction_id,
    created_by
  ) values (
    current_date,
    coalesce(nullif(trim(p_description), ''), 'Rút quỹ — ' || p_category),
    p_amount,
    'other',
    null,
    v_id,
    auth.uid()
  ) returning id into v_expense_id;

  return jsonb_build_object(
    'id', v_id,
    'balance_after', v_next,
    'expense_id', v_expense_id
  );
end;
$$;

grant execute on function public.safe_withdraw_other(numeric, text, text) to authenticated;

-- ===== safe_adjust (quỹ cash) =====
create or replace function public.safe_adjust(p_new_balance numeric, p_note text)
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
  if p_new_balance < 0 or p_new_balance > 1000000000 then
    raise exception 'Số dư mới phải 0–1.000.000.000.';
  end if;
  if length(coalesce(trim(p_note), '')) < 5 then
    raise exception 'Phải nhập lý do điều chỉnh (>= 5 ký tự) cho audit trail.';
  end if;
  if length(p_note) > 500 then
    raise exception 'Lý do vượt 500 ký tự.';
  end if;

  -- Fund-aware (Sổ quỹ 2 quỹ): điều chỉnh QUỸ TIỀN MẶT (P3 sẽ thêm chọn quỹ).
  perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
  v_balance := public.safe_fund_balance_now('cash');
  v_diff := p_new_balance - v_balance;
  if v_diff = 0 then
    raise exception 'Số dư mới giống số dư hiện tại — không cần điều chỉnh.';
  end if;

  insert into public.safe_transactions (
    transaction_type, amount, balance_after, fund, description, created_by
  ) values (
    'adjustment', v_diff, p_new_balance, 'cash', p_note, auth.uid()
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'balance_after', p_new_balance, 'difference', v_diff);
end;
$$;

grant execute on function public.safe_adjust(numeric, text) to authenticated;

-- ===== safe_count (so quỹ cash) =====
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

-- ===== save_cash_day_opening (withdraw_open -> quỹ cash) =====
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

-- ===== finalize_cash_close_report (deposit split + clear void-metadata) =====
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
