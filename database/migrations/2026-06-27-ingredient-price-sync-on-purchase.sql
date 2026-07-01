-- 2026-06-27-ingredient-price-sync-on-purchase.sql
-- Đồng bộ giá định giá khi nhập NL từ sổ quỹ (spec 2026-06-24):
--   safe_purchase_inventory: thêm cờ per-line p_lines[].sync_price (default
--     true). Dòng bật → upsert ingredient_reference_prices.unit_price =
--     round(unit_price)::bigint (atomic cùng giao dịch nhập). Vẫn ghi
--     last_unit_price + stock_movements + safe_transactions như cũ.
--   Backfill 1 lần (idempotent): seed ingredient_reference_prices từ
--     last_unit_price cho NL chưa có giá định giá mà last_unit_price > 0.
-- Thân function trích NGUYÊN VĂN từ canonical database/002_functions.sql
-- (dual-write — giữ hai nơi giống hệt).

create or replace function public.safe_purchase_inventory(
  p_cash_amount numeric,
  p_transfer_amount numeric,
  p_lines jsonb,
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
  v_occurred timestamptz := coalesce(p_occurred_at, now());
  v_total numeric := 0;
  v_line jsonb;
  v_ing_id uuid;
  v_qty numeric;
  v_price numeric;
  v_sync boolean;
  v_balance numeric;
  v_cash_id uuid;
  v_transfer_id uuid;
  v_cash_after numeric;
  v_transfer_after numeric;
  v_movement_ids uuid[] := '{}';
  v_mid uuid;
  v_note text;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được nhập nguyên liệu từ sổ quỹ.';
  end if;
  if v_cash < 0 or v_transfer < 0 then
    raise exception 'Số tiền mỗi quỹ không được âm.';
  end if;
  if v_cash <> floor(v_cash) or v_transfer <> floor(v_transfer) then
    raise exception 'Số tiền phải là số nguyên VND.';
  end if;
  if v_occurred::date > current_date then
    raise exception 'Ngày nhập không được ở tương lai.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Cần ít nhất 1 dòng nguyên liệu.';
  end if;
  if length(coalesce(p_description, '')) > 500 then
    raise exception 'Mô tả vượt 500 ký tự.';
  end if;

  -- Validate từng dòng + tính tổng server-side.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    if v_ing_id is null then
      raise exception 'Dòng thiếu ingredient_id.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Số lượng phải > 0.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Đơn giá không được âm.';
    end if;
    if not exists (select 1 from public.ingredients where id = v_ing_id and is_active) then
      raise exception 'Nguyên liệu % không tồn tại hoặc đã ẩn.', v_ing_id;
    end if;
    v_total := v_total + v_qty * v_price;
  end loop;

  v_total := round(v_total, 2);
  if v_total <= 0 or v_total > 1000000000 then
    raise exception 'Tổng tiền nhập phải 1–1.000.000.000 (hiện %).', v_total;
  end if;
  if v_cash + v_transfer <> v_total then
    raise exception 'Tách quỹ (%) không khớp tổng các dòng (%).', v_cash + v_transfer, v_total;
  end if;

  v_note := coalesce(nullif(trim(p_description), ''), 'Nhập nguyên liệu — rút sổ quỹ ' || v_occurred::date);

  -- Trừ quỹ per-fund (advisory lock, skip phần 0) — giống safe_withdraw_other v4.
  if v_cash > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    v_balance := public.safe_fund_balance_now('cash');
    if v_balance < v_cash then
      raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, cần %.', v_balance, v_cash;
    end if;
    v_cash_after := v_balance - v_cash;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_cash, v_cash_after, 'cash', v_occurred,
      'inventory', v_note, auth.uid()
    ) returning id into v_cash_id;
  end if;

  if v_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    v_balance := public.safe_fund_balance_now('transfer');
    if v_balance < v_transfer then
      raise exception 'Quỹ chuyển khoản không đủ. Số dư hiện tại %, cần %.', v_balance, v_transfer;
    end if;
    v_transfer_after := v_balance - v_transfer;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_transfer, v_transfer_after, 'transfer', v_occurred,
      'inventory', v_note, auth.uid()
    ) returning id into v_transfer_id;
  end if;

  -- Đẩy kho + nhớ đơn giá + (tùy cờ) đồng bộ giá định giá cho từng dòng.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_sync := coalesce((v_line->>'sync_price')::boolean, true);
    insert into public.stock_movements (
      ingredient_id, quantity_delta, reason, occurred_at, notes, created_by
    ) values (
      v_ing_id, v_qty, 'purchase_received', v_occurred, v_note, auth.uid()
    ) returning id into v_mid;
    v_movement_ids := v_movement_ids || v_mid;
    update public.ingredients set last_unit_price = v_price where id = v_ing_id;
    if v_sync then
      insert into public.ingredient_reference_prices (ingredient_id, unit_price, updated_at)
      values (v_ing_id, round(v_price)::bigint, now())
      on conflict (ingredient_id) do update
        set unit_price = excluded.unit_price,
            updated_at = excluded.updated_at;
    end if;
  end loop;

  return jsonb_build_object(
    'cash_id', v_cash_id,
    'transfer_id', v_transfer_id,
    'cash_balance_after', v_cash_after,
    'transfer_balance_after', v_transfer_after,
    'total', v_total,
    'movement_ids', to_jsonb(v_movement_ids)
  );
end;
$$;

grant execute on function public.safe_purchase_inventory(numeric, numeric, jsonb, text, timestamptz) to authenticated;

-- ===== Backfill 1 lần (idempotent) =====
-- Seed giá định giá từ last_unit_price cho NL CHƯA có giá mà last_unit_price>0.
-- ON CONFLICT DO NOTHING ⇒ chạy lại không nhân đôi, không đè giá owner đã đặt.
-- (Đồng bộ với database/tests/281_backfill_reference_prices.sql.)
insert into public.ingredient_reference_prices (ingredient_id, unit_price, updated_at)
select i.id, round(i.last_unit_price)::bigint, now()
from public.ingredients i
where i.last_unit_price > 0
on conflict (ingredient_id) do nothing;
