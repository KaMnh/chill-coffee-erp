-- =============================================================================
-- safe_withdraw_other RPC v2 (2026-05-28): auto-insert expense row
--
-- Same owner-only / validation / lock pattern as v1. After successful
-- safe_transactions INSERT, also INSERTs into public.expenses with:
--   - safe_transaction_id = vừa tạo (links expense back to safe withdraw)
--   - amount, description copied from input
--   - business_date = current_date (server side, TZ Asia/Ho_Chi_Minh)
--   - payment_method = 'other' (NOT 'cash' — tiền từ safe vault, không phải till)
--   - category_id = NULL (no mapping from reason_category → expense_category v1)
--   - created_by = auth.uid()
--
-- Idempotent: create or replace function.
-- =============================================================================

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

  -- Lock row gần nhất để chống race condition
  select balance_after into v_balance
  from public.safe_transactions
  order by occurred_at desc, id desc
  limit 1
  for update;

  v_balance := coalesce(v_balance, 0);
  v_next := v_balance - p_amount;
  if v_next < 0 then
    raise exception 'Sổ quỹ không đủ. Số dư hiện tại %, rút %.', v_balance, p_amount;
  end if;

  insert into public.safe_transactions (
    transaction_type, amount, balance_after,
    reason_category, description, created_by
  ) values (
    'withdraw_other', -p_amount, v_next,
    p_category, p_description, auth.uid()
  ) returning id into v_id;

  -- NEW: auto-create expense row linked to this safe withdrawal.
  -- payment_method='other' → no cash_drawer_events side effect.
  -- category_id=NULL → row appears as "(chưa phân loại)" in cashflow breakdown.
  -- Description fallback: if user passed null/empty, use category as label so
  -- owner can identify the row in sổ chi.
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
