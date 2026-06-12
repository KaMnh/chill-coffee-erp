-- =============================================================================
-- Migration: Kết toán kỳ (Period Close & Owner Draw) — period_closes +
-- transaction_type 'owner_draw' (KHÔNG mirror expenses) + 4 RPC owner-only.
-- Trích nguyên văn từ 001_schema.sql / 002_functions.sql / 003_rls.sql (dual-write).
-- Lưu ý: view analytics.daily_cashflow (+safe_draw_owner) nằm trong migration
-- 2026-06-11-analytics-views.sql (đã tái sinh từ khối marker — byte-identical).
-- Spec: docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
-- =============================================================================

-- CHECK constraints cho safe_transactions amount sign.
-- owner_draw (2026-06-12): CASE có `else false` nên DB cũ PHẢI drop/re-add cả
-- transaction_type check lẫn sign check — nếu không mọi insert owner_draw fail.
-- Idempotent: chỉ drop khi definition hiện tại CHƯA chứa 'owner_draw'.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'safe_transactions_transaction_type_check'
     and c.conrelid = 'public.safe_transactions'::regclass;
  if v_def is not null and position('owner_draw' in v_def) = 0 then
    alter table public.safe_transactions drop constraint safe_transactions_transaction_type_check;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'safe_transactions_transaction_type_check'
                    and conrelid = 'public.safe_transactions'::regclass) then
    alter table public.safe_transactions add constraint safe_transactions_transaction_type_check
      check (transaction_type in ('initial_setup','deposit_close','withdraw_open','withdraw_other','adjustment','owner_draw'));
  end if;

  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'safe_transactions_amount_sign_check'
     and c.conrelid = 'public.safe_transactions'::regclass;
  if v_def is not null and position('owner_draw' in v_def) = 0 then
    alter table public.safe_transactions drop constraint safe_transactions_amount_sign_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'safe_transactions_amount_sign_check') then
    alter table public.safe_transactions add constraint safe_transactions_amount_sign_check check (
      case transaction_type
        when 'initial_setup'  then amount >= 0
        when 'deposit_close'  then amount >= 0
        when 'withdraw_open'  then amount <= 0
        when 'withdraw_other' then amount <= 0
        when 'owner_draw'     then amount <= 0
        when 'adjustment'     then true
        else false
      end
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'safe_transactions_balance_check') then
    alter table public.safe_transactions add constraint safe_transactions_balance_check
      check (balance_after >= 0);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Kết toán kỳ (period close) — snapshot mỗi lần chủ kết sổ + rút lợi nhuận.
-- expenses_total = TOÀN BỘ expenses trong kỳ theo góc nhìn owner (gồm cả
-- expense-mirror của rút quỹ vận hành) — khớp cash_flow_overview owner.
-- owner_draw KHÔNG có mirror nên không bao giờ lọt vào đây.
-- Ghi qua RPC security-definer (002); RLS owner-read trong 003.
-- Spec: docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
-- -----------------------------------------------------------------------------
create table if not exists public.period_closes (
  id              uuid primary key default gen_random_uuid(),
  close_date      date not null,
  period_start    date not null,
  period_end      date not null,
  revenue         numeric(14,2) not null default 0,
  expenses_total  numeric(14,2) not null default 0,
  payroll_total   numeric(14,2) not null default 0,
  profit          numeric(14,2) not null default 0,
  opening_total       numeric(14,2) not null default 0,
  balance_before_cash     numeric(14,2) not null default 0,
  balance_before_transfer numeric(14,2) not null default 0,
  draw_cash       numeric(14,2) not null default 0,
  draw_transfer   numeric(14,2) not null default 0,
  draw_total      numeric(14,2) not null default 0,
  closing_cash     numeric(14,2) not null default 0,
  closing_transfer numeric(14,2) not null default 0,
  closing_total    numeric(14,2) not null default 0,
  note            text,
  status          text not null default 'final' check (status in ('final','voided')),
  void_reason     text,
  voided_by       uuid references auth.users(id),
  voided_at       timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint period_closes_range_check check (period_start <= period_end)
);
create index if not exists period_closes_date_idx on public.period_closes(close_date desc);

-- Link owner_draw / adjustment-refund → kỳ kết (mẫu cash_close_report_id).
alter table public.safe_transactions
  add column if not exists period_close_id uuid null
    references public.period_closes(id) on delete set null;
create index if not exists safe_transactions_period_close_id_idx
  on public.safe_transactions(period_close_id)
  where period_close_id is not null;

-- =============================================================================
-- Kết toán kỳ (Period Close & Owner Draw) — 2026-06-12
-- Spec: docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
-- owner_draw KHÔNG tạo expenses (khác hẳn safe_withdraw_other) → lợi nhuận
-- không bị trừ. "Hôm nay" = ngày VN (KHÔNG current_date — UTC lệch sau 0h VN).
-- =============================================================================

-- Neo đầu kỳ: (kết final gần nhất + 1) → ngày HOẠT ĐỘNG KINH DOANH sớm nhất
-- (least qua sales/expenses/payroll/sổ quỹ). Adversarial review 2026-06-12:
-- KHÔNG neo riêng initial_setup — dữ liệu bán hàng import (KiotViet) có thể
-- CŨ HƠN ngày lập sổ quỹ, neo theo setup sẽ bỏ sót P&L kỳ đầu.
-- least()/greatest() của Postgres bỏ qua NULL. KHÔNG grant authenticated (nội bộ).
create or replace function public.period_close_period_start(p_as_of date)
returns date
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select max(close_date) + 1 from public.period_closes where status = 'final'),
    least(
      (select min(business_date) from public.sales_orders),
      (select min(business_date) from public.expenses),
      (select min(business_date) from public.shift_payroll_records),
      (select min((occurred_at at time zone 'Asia/Ho_Chi_Minh')::date) from public.safe_transactions)
    ),
    p_as_of
  );
$$;
revoke all on function public.period_close_period_start(date) from public;

create or replace function public.period_close_preview(p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_start date;
  v_revenue numeric; v_expenses numeric; v_payroll numeric;
  v_cash numeric; v_transfer numeric;
  v_overview jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được xem kết toán kỳ.';
  end if;
  if v_as_of > v_today then
    raise exception 'Ngày kết không được ở tương lai.';
  end if;
  v_start := public.period_close_period_start(v_as_of);

  select coalesce(sum(net_amount), 0) into v_revenue
    from public.sales_orders where business_date between v_start and v_as_of;
  -- Owner: TOÀN BỘ expenses (gồm mirror rút quỹ vận hành) — khớp cash_flow_overview.
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where business_date between v_start and v_as_of;
  select coalesce(sum(total_pay), 0) into v_payroll
    from public.shift_payroll_records where business_date between v_start and v_as_of;

  v_cash := public.safe_fund_balance_now('cash');
  v_transfer := public.safe_fund_balance_now('transfer');

  -- by_day + expense_breakdown tái dùng cash_flow_overview (owner đã pass check trên;
  -- function sống trong migration 2026-05-28-e — resolve lúc CHẠY, không phải lúc CREATE).
  if v_start <= v_as_of then
    v_overview := public.cash_flow_overview(v_start, v_as_of);
  else
    v_overview := jsonb_build_object('by_day', '[]'::jsonb, 'expense_breakdown', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'period_start', v_start,
    'period_end', v_as_of,
    'can_close', v_start <= v_as_of,
    'revenue', v_revenue,
    'expenses_total', v_expenses,
    'payroll_total', v_payroll,
    'profit', v_revenue - v_expenses - v_payroll,
    'balance_cash', v_cash,
    'balance_transfer', v_transfer,
    'balance_total', v_cash + v_transfer,
    'opening_total', (select closing_total from public.period_closes
                       where status = 'final'
                       order by close_date desc, created_at desc limit 1),
    'by_day', coalesce(v_overview -> 'by_day', '[]'::jsonb),
    'expense_breakdown', coalesce(v_overview -> 'expense_breakdown', '[]'::jsonb)
  );
end;
$$;
grant execute on function public.period_close_preview(date) to authenticated;

create or replace function public.finalize_period_close(
  p_close_date date,
  p_draw_cash numeric,
  p_draw_transfer numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_draw_cash numeric := coalesce(p_draw_cash, 0);
  v_draw_transfer numeric := coalesce(p_draw_transfer, 0);
  v_start date;
  v_revenue numeric; v_expenses numeric; v_payroll numeric;
  v_before_cash numeric; v_before_transfer numeric;
  v_opening numeric;
  v_close_id uuid; v_cash_tx uuid; v_transfer_tx uuid;
  v_desc text;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được kết toán kỳ.';
  end if;
  if p_close_date is null or p_close_date > v_today then
    raise exception 'Ngày kết không được ở tương lai.';
  end if;
  if v_draw_cash < 0 or v_draw_transfer < 0 then
    raise exception 'Số tiền rút mỗi quỹ không được âm.';
  end if;
  if v_draw_cash <> floor(v_draw_cash) or v_draw_transfer <> floor(v_draw_transfer) then
    raise exception 'Số tiền phải là số nguyên VND.';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'Ghi chú vượt 500 ký tự.';
  end if;

  -- Chống 2 finalize/void đồng thời (đọc anchor + insert snapshot là 1 đơn vị).
  perform pg_advisory_xact_lock(hashtext('period_close'));

  v_start := public.period_close_period_start(p_close_date);
  if v_start > p_close_date then
    if exists (select 1 from public.period_closes where status = 'final') then
      raise exception 'Đã có kỳ kết đến ngày %. Huỷ lần kết gần nhất nếu muốn kết lại.',
        to_char(v_start - 1, 'DD/MM/YYYY');
    else
      raise exception 'Chưa có hoạt động kinh doanh nào trước ngày kết (đầu kỳ tính được là %).',
        to_char(v_start, 'DD/MM/YYYY');
    end if;
  end if;

  select coalesce(sum(net_amount), 0) into v_revenue
    from public.sales_orders where business_date between v_start and p_close_date;
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where business_date between v_start and p_close_date;
  select coalesce(sum(total_pay), 0) into v_payroll
    from public.shift_payroll_records where business_date between v_start and p_close_date;
  select closing_total into v_opening from public.period_closes
   where status = 'final' order by close_date desc, created_at desc limit 1;

  -- Số dư & chặn rút quá TỪNG quỹ — lock cả 2 quỹ theo thứ tự cố định (cash trước,
  -- nhất quán mọi RPC khác để tránh deadlock).
  perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
  perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
  v_before_cash := public.safe_fund_balance_now('cash');
  v_before_transfer := public.safe_fund_balance_now('transfer');
  if v_draw_cash > v_before_cash then
    raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, rút %.', v_before_cash, v_draw_cash;
  end if;
  if v_draw_transfer > v_before_transfer then
    raise exception 'Quỹ chuyển khoản không đủ. Số dư hiện tại %, rút %.', v_before_transfer, v_draw_transfer;
  end if;

  -- Insert snapshot TRƯỚC owner_draw (FK period_close_id immediate — adversarial
  -- review: thứ tự trong spec gốc §4.2 sẽ fail).
  insert into public.period_closes (
    close_date, period_start, period_end,
    revenue, expenses_total, payroll_total, profit,
    opening_total, balance_before_cash, balance_before_transfer,
    draw_cash, draw_transfer, draw_total,
    closing_cash, closing_transfer, closing_total,
    note, created_by
  ) values (
    p_close_date, v_start, p_close_date,
    v_revenue, v_expenses, v_payroll, v_revenue - v_expenses - v_payroll,
    coalesce(v_opening, 0), v_before_cash, v_before_transfer,
    v_draw_cash, v_draw_transfer, v_draw_cash + v_draw_transfer,
    v_before_cash - v_draw_cash, v_before_transfer - v_draw_transfer,
    (v_before_cash - v_draw_cash) + (v_before_transfer - v_draw_transfer),
    nullif(trim(p_note), ''), auth.uid()
  ) returning id into v_close_id;

  v_desc := 'Rút lợi nhuận kỳ ' || to_char(v_start, 'DD/MM') || '–' || to_char(p_close_date, 'DD/MM/YYYY');
  if v_draw_cash > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      description, period_close_id, created_by
    ) values (
      'owner_draw', -v_draw_cash, v_before_cash - v_draw_cash, 'cash',
      p_close_date::timestamptz, v_desc, v_close_id, auth.uid()
    ) returning id into v_cash_tx;
  end if;
  if v_draw_transfer > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      description, period_close_id, created_by
    ) values (
      'owner_draw', -v_draw_transfer, v_before_transfer - v_draw_transfer, 'transfer',
      p_close_date::timestamptz, v_desc, v_close_id, auth.uid()
    ) returning id into v_transfer_tx;
  end if;
  -- LƯU Ý: KHÔNG insert public.expenses — điểm sống còn của thiết kế (bất biến #1).

  return jsonb_build_object(
    'id', v_close_id,
    'period_start', v_start, 'period_end', p_close_date,
    'revenue', v_revenue, 'expenses_total', v_expenses,
    'payroll_total', v_payroll, 'profit', v_revenue - v_expenses - v_payroll,
    'draw_cash', v_draw_cash, 'draw_transfer', v_draw_transfer,
    'draw_total', v_draw_cash + v_draw_transfer,
    'closing_cash', v_before_cash - v_draw_cash,
    'closing_transfer', v_before_transfer - v_draw_transfer,
    'closing_total', (v_before_cash - v_draw_cash) + (v_before_transfer - v_draw_transfer),
    'cash_tx_id', v_cash_tx, 'transfer_tx_id', v_transfer_tx
  );
end;
$$;
grant execute on function public.finalize_period_close(date, numeric, numeric, text) to authenticated;

create or replace function public.list_period_closes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner xem được lịch sử kết toán kỳ.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.close_date desc, p.created_at desc), '[]'::jsonb)
    into v_result
  from public.period_closes p;
  return v_result;
end;
$$;
grant execute on function public.list_period_closes() to authenticated;

create or replace function public.void_period_close(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_close public.period_closes%rowtype;
  v_latest uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được huỷ kết toán kỳ.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Lý do huỷ phải ≥ 5 ký tự.';
  end if;

  perform pg_advisory_xact_lock(hashtext('period_close'));

  select * into v_close from public.period_closes where id = p_id for update;
  if not found then
    raise exception 'Không tìm thấy kỳ kết để huỷ.';
  end if;
  if v_close.status <> 'final' then
    raise exception 'Kỳ kết này đã bị huỷ trước đó.';
  end if;
  select id into v_latest from public.period_closes
   where status = 'final' order by close_date desc, created_at desc limit 1;
  if v_latest <> p_id then
    raise exception 'Chỉ huỷ được lần kết gần nhất.';
  end if;

  update public.period_closes
     set status = 'voided', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
   where id = p_id;

  -- Hoàn từng quỹ qua adjustment dương (tiền lệ void_cash_close_report —
  -- KHÔNG xoá owner_draw gốc, giữ audit trail).
  if v_close.draw_cash > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, description, period_close_id, created_by
    ) values (
      'adjustment', v_close.draw_cash,
      public.safe_fund_balance_now('cash') + v_close.draw_cash, 'cash',
      'Hoàn rút lợi nhuận do huỷ kỳ kết ' || to_char(v_close.close_date, 'DD/MM/YYYY') || ': ' || left(p_reason, 80),
      p_id, auth.uid()
    );
  end if;
  if v_close.draw_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, description, period_close_id, created_by
    ) values (
      'adjustment', v_close.draw_transfer,
      public.safe_fund_balance_now('transfer') + v_close.draw_transfer, 'transfer',
      'Hoàn rút lợi nhuận do huỷ kỳ kết ' || to_char(v_close.close_date, 'DD/MM/YYYY') || ': ' || left(p_reason, 80),
      p_id, auth.uid()
    );
  end if;

  return jsonb_build_object(
    'id', p_id, 'status', 'voided',
    'refunded_cash', v_close.draw_cash, 'refunded_transfer', v_close.draw_transfer
  );
end;
$$;
grant execute on function public.void_period_close(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Data-fix (CHỈ DB cũ): sidebar_defaults / sidebar_config đã LƯU qua Settings
-- là danh sách đóng — view mới 'period-close' sẽ bị ẩn vĩnh viễn với owner nếu
-- không chèn. Append cuối mảng là đủ: getVisibleNav render theo thứ tự
-- NAV_ITEMS canonical, không theo thứ tự mảng lưu. Idempotent.
-- (DB mới không có row này → fallback DEFAULT_SIDEBAR_BY_ROLE đã chứa key.)
-- ---------------------------------------------------------------------------
update public.app_settings
   set value = jsonb_set(value, '{owner}', (value -> 'owner') || '"period-close"'::jsonb)
 where key = 'sidebar_defaults'
   and jsonb_typeof(value -> 'owner') = 'array'
   and not (value -> 'owner') ? 'period-close';

update public.profiles p
   set sidebar_config = p.sidebar_config || '"period-close"'::jsonb
  from public.employee_accounts ea
 where ea.auth_user_id = p.id
   and ea.role = 'owner'
   and p.sidebar_config is not null
   and jsonb_typeof(p.sidebar_config) = 'array'
   and not p.sidebar_config ? 'period-close';

-- Kết toán kỳ — owner only đọc; mọi write qua RPC security definer
-- (finalize_period_close / void_period_close). Update/delete không có policy
-- → mặc định deny. Khuôn y hệt safe_transactions.
alter table public.period_closes enable row level security;

drop policy if exists period_closes_owner_read on public.period_closes;
create policy period_closes_owner_read on public.period_closes
  for select to authenticated using (public.app_role() = 'owner');
drop policy if exists period_closes_no_direct_write on public.period_closes;
create policy period_closes_no_direct_write on public.period_closes
  for insert to authenticated with check (false);
