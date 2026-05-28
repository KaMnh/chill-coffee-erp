-- =============================================================================
-- Schema: link expenses to safe withdrawals (2026-05-28)
--
-- Adds expenses.safe_transaction_id uuid NULL FK → safe_transactions(id).
-- NULL = manual expense. NOT NULL = sinh ra tự động bởi safe_withdraw_other.
--
-- Partial index — đa số expense là NULL, chỉ index khi NOT NULL.
-- =============================================================================

alter table public.expenses
  add column if not exists safe_transaction_id uuid null
    references public.safe_transactions(id) on delete restrict;

create index if not exists expenses_safe_transaction_id_idx
  on public.expenses(safe_transaction_id)
  where safe_transaction_id is not null;

comment on column public.expenses.safe_transaction_id is
  'Link to safe_transactions when expense was auto-created by safe_withdraw_other. NULL = manual expense. Visibility rule: NOT NULL → owner only (see RLS policies + RPC filters).';
