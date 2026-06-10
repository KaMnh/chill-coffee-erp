-- 2026-06-10-safe-two-funds-outflow-f4.sql
-- Sổ quỹ 2 quỹ — Phase 3: chi tách quỹ + F4 (rút chỉnh được ngày).
--   safe_withdraw_other v4: (p_cash_amount, p_transfer_amount, p_category,
--     p_description, p_occurred_at) — tách 2 quỹ (1–2 row, skip amount=0),
--     occurred_at = nhãn ngày (số dư giảm NGAY, cơ sở created_at), chặn ngày
--     tương lai + số lẻ VND; 1 expense row cho TỔNG (business_date = ngày chọn).
--     DROP chữ ký cũ (numeric,text,text) — bản v2/v3 do migration trước tạo lại.
--   safe_adjust: thêm p_fund ('cash'|'transfer'), DROP chữ ký cũ (numeric,text).
--   safe_list_transactions: trả thêm 'fund' cho badge lịch sử.
-- Thân hàm trích NGUYÊN VĂN từ canonical database/002_functions.sql.

-- ===== safe_withdraw_other v4 (tách quỹ + ngày) =====
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

-- ===== safe_adjust (chọn quỹ) =====
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

-- ===== safe_list_transactions (+fund) =====
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
