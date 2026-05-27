-- 2026-05-27-a-finalize-with-next-day-opening.sql
-- Extend finalize_cash_close_report để auto-upsert cash_day_openings cho
-- business_date + 1. UX wizard ở client: user đếm mệnh giá tiền đầu ngày mai
-- ngay trên màn chốt két → server tạo opening sẵn cho ngày kế.
--
-- Behavior:
--   p_next_day_denominations = null  → backward compat, KHÔNG tạo opening.
--   p_next_day_denominations = jsonb → UPSERT cash_day_openings (business_date + 1).
--                                       Overwrite nếu tomorrow opening đã tồn tại.
--
-- Drop old overloads (1-arg + 2-arg) trước khi create 3-arg để tránh ambiguous call.

drop function if exists public.finalize_cash_close_report(uuid);
drop function if exists public.finalize_cash_close_report(uuid, numeric);

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

  -- NEW: nếu client gửi next_day_denominations, server compute tổng và verify
  -- khớp với p_leave_for_next_day. Nếu lệch → trust server-computed (canonical).
  if p_next_day_denominations is not null then
    if jsonb_typeof(p_next_day_denominations) <> 'object' then
      raise exception 'p_next_day_denominations phải là JSON object {denom: count}.';
    end if;
    select coalesce(sum((key)::numeric * (value::text)::numeric), 0)
      into v_next_total
      from jsonb_each(p_next_day_denominations)
      where key ~ '^\d+$' and (value::text) ~ '^\d+$';
    -- Nếu client gửi cả 2 mà lệch nhau → dùng v_next_total (denomination count
    -- là source of truth — tránh tampering qua p_leave_for_next_day).
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
    report_status = 'final'
  returning id into v_report_id;

  -- Auto-deposit dư vào sổ quỹ (nếu safe_deposit > 0)
  if v_safe_deposit > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after,
      description, cash_close_report_id, created_by
    ) values (
      'deposit_close',
      v_safe_deposit,
      public.safe_balance_now() + v_safe_deposit,
      'Nạp từ chốt két ngày ' || v_count.business_date::text,
      v_report_id,
      auth.uid()
    );
  end if;

  -- NEW: Upsert cash_day_openings cho business_date + 1 nếu client gửi denominations.
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

grant execute on function public.finalize_cash_close_report(uuid, numeric, jsonb) to authenticated;
