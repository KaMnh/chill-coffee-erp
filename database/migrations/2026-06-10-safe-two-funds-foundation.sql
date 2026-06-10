-- 2026-06-10-safe-two-funds-foundation.sql
-- Sổ quỹ 2 quỹ (tiền mặt + chuyển khoản) — Phase 1 nền.
-- Thêm cột `fund` + index per-fund + helper số dư per-fund (basis created_at).
-- Mọi row hiện có → fund='cash'; quỹ transfer khởi đầu 0. Behavior-neutral cho
-- dữ liệu cũ (occurred_at == created_at cho mọi row hiện hữu).

-- 1) Cột fund -----------------------------------------------------------------
alter table public.safe_transactions
  add column if not exists fund text not null default 'cash';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'safe_transactions_fund_check'
  ) then
    alter table public.safe_transactions
      add constraint safe_transactions_fund_check check (fund in ('cash','transfer'));
  end if;
end $$;

create index if not exists safe_transactions_fund_created_idx
  on public.safe_transactions (fund, created_at desc, id desc) include (balance_after);

-- 2) Helper số dư per-fund (basis created_at — invariant F4, áp per-fund) ------
-- Số dư một quỹ = balance_after của row GHI gần nhất (created_at desc, id desc)
-- của quỹ đó. KHÔNG dùng occurred_at (để back-date không làm "biến mất" số dư).
create or replace function public.safe_fund_balance_now(p_fund text)
returns numeric
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select balance_after from public.safe_transactions
     where fund = p_fund
     order by created_at desc, id desc
     limit 1),
    0
  );
$$;

grant execute on function public.safe_fund_balance_now(text) to authenticated;

-- Tổng hợp 3 số cho UI: { cash, transfer, total }.
create or replace function public.safe_balances_now()
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select jsonb_build_object(
    'cash', public.safe_fund_balance_now('cash'),
    'transfer', public.safe_fund_balance_now('transfer'),
    'total', public.safe_fund_balance_now('cash') + public.safe_fund_balance_now('transfer')
  );
$$;

grant execute on function public.safe_balances_now() to authenticated;
