-- 2026-06-09-expense-template-usage-count.sql
-- create_expense giờ tăng usage_count + set last_used_at của expense_template
-- khi khoản chi được tạo từ một mẫu (template_id != null). Trước đây usage_count
-- không bao giờ tăng (Phase-1 deferral, xem src/hooks/mutations/use-expense-
-- mutations.ts) nên rail "Dùng nhiều nhất" — sort theo usage_count desc ở
-- src/lib/data/expenses.ts — luôn bằng 0 (sort vô nghĩa).
--
-- Idempotent: create or replace, giữ nguyên signature (jsonb). create-or-replace
-- không reset quyền nên grant execute hiện có (bulk grant ở 003_rls.sql) vẫn còn.

create or replace function public.create_expense(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_amount numeric(14,2);
  v_date date;
  v_template_id uuid;
begin
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền tạo khoản chi.'; end if;
  if length(coalesce(p_payload->>'description','')) > 500 then
    raise exception 'description vượt 500 ký tự.';
  end if;
  if length(coalesce(p_payload->>'note','')) > 1000 then
    raise exception 'note vượt 1000 ký tự.';
  end if;
  v_amount := coalesce((p_payload->>'amount')::numeric, 0);
  v_date := coalesce((p_payload->>'business_date')::date, current_date);
  if v_amount < 0 or v_amount > 1000000000 then
    raise exception 'amount phải >= 0 và <= 1,000,000,000.';
  end if;
  if coalesce((p_payload->>'quantity')::numeric, 0) < 0
     or coalesce((p_payload->>'unit_price')::numeric, 0) < 0 then
    raise exception 'quantity/unit_price không được âm.';
  end if;
  v_template_id := nullif(p_payload->>'template_id','')::uuid;
  insert into public.expenses (business_date, category_id, template_id, description, quantity, unit, unit_price, amount, payment_method, note, created_by)
  values (v_date, nullif(p_payload->>'category_id','')::uuid, v_template_id, p_payload->>'description', coalesce((p_payload->>'quantity')::numeric, 1), p_payload->>'unit', coalesce((p_payload->>'unit_price')::numeric, 0), v_amount, coalesce(p_payload->>'payment_method','cash'), p_payload->>'note', auth.uid())
  returning id into v_id;

  -- Đếm lượt dùng mẫu chi: tăng usage_count + last_used_at để rail "Dùng nhiều
  -- nhất" (sort usage_count desc ở src/lib/data/expenses.ts) phản ánh đúng tần suất.
  if v_template_id is not null then
    update public.expense_templates
    set usage_count = usage_count + 1,
        last_used_at = now()
    where id = v_template_id;
  end if;

  if coalesce(p_payload->>'payment_method','cash') = 'cash' and v_amount > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, expense_id, created_by, source, note)
    values (v_date, now(), 'expense_cash_out', 'out', v_amount, v_id, auth.uid(), 'app_action', p_payload->>'description');
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;
