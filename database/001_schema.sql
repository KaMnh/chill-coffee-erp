-- =============================================================================
-- Chill Manager v2 — Schema (tables, indexes, CHECK constraints, base triggers)
-- Apply order: 001 → 002 → 003 → 004
-- Fully idempotent — re-run an toàn trên DB đã có data.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 0. Helper: trigger function set_updated_at()
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. Profiles + Auth-linked tables
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  avatar_url text,
  sidebar_config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  position text,
  hourly_rate numeric(14,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists employees_set_updated_at on public.employees;
create trigger employees_set_updated_at before update on public.employees
  for each row execute function public.set_updated_at();

create table if not exists public.employee_accounts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references public.employees(id) on delete set null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','staff_operator','employee_viewer')),
  status text not null default 'active' check (status in ('active','pending','disabled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique(auth_user_id)
);

create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  email text not null,
  name text,
  employee_code text,
  status text not null default 'pending_approval'
    check (status in ('pending_email_verification','pending_approval','approved','rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  note text
);

-- -----------------------------------------------------------------------------
-- 2. Expenses (categories, templates, line items, history permissions)
-- -----------------------------------------------------------------------------
create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'expense',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists expense_categories_name_active_uniq
  on public.expense_categories (lower(trim(name))) where is_active;
drop trigger if exists expense_categories_set_updated_at on public.expense_categories;
create trigger expense_categories_set_updated_at before update on public.expense_categories
  for each row execute function public.set_updated_at();

create table if not exists public.expense_templates (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  default_category_id uuid references public.expense_categories(id),
  default_unit text,
  last_unit_price numeric(14,2) not null default 0,
  usage_count integer not null default 0,
  last_used_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists expense_templates_label_active_uniq
  on public.expense_templates (lower(trim(label))) where is_active;
drop trigger if exists expense_templates_set_updated_at on public.expense_templates;
create trigger expense_templates_set_updated_at before update on public.expense_templates
  for each row execute function public.set_updated_at();

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  category_id uuid references public.expense_categories(id),
  template_id uuid references public.expense_templates(id),
  description text not null,
  quantity numeric(14,3) not null default 1,
  unit text,
  unit_price numeric(14,2) not null default 0,
  amount numeric(14,2) not null,
  payment_method text not null default 'cash',
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_business_date_idx on public.expenses(business_date);
drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

create table if not exists public.expense_history_permissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. Shifts + Payroll
-- -----------------------------------------------------------------------------
create table if not exists public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  business_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  confirmed_by_manager boolean not null default true,
  total_minutes integer,
  status text not null default 'checked_in' check (status in ('checked_in','checked_out','cancelled')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shift_assignments_employee_date_idx on public.shift_assignments(employee_id, business_date);
drop trigger if exists shift_assignments_set_updated_at on public.shift_assignments;
create trigger shift_assignments_set_updated_at before update on public.shift_assignments
  for each row execute function public.set_updated_at();

create table if not exists public.shift_payroll_records (
  id uuid primary key default gen_random_uuid(),
  shift_assignment_id uuid unique references public.shift_assignments(id) on delete set null,
  employee_id uuid not null references public.employees(id),
  business_date date not null,
  check_in_at timestamptz,
  check_out_at timestamptz,
  total_minutes integer not null default 0,
  hourly_rate numeric(14,2) not null default 0,
  base_pay numeric(14,2) not null default 0,
  allowance_amount numeric(14,2) not null default 0,
  total_pay numeric(14,2) not null default 0,
  payment_method text not null default 'cash',
  note text,
  edited_by uuid references auth.users(id),
  edited_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists shift_payroll_records_date_idx on public.shift_payroll_records(business_date);

-- -----------------------------------------------------------------------------
-- 4. Sales (POS — populated by ingest_kiotviet_batch RPC)
-- -----------------------------------------------------------------------------
create table if not exists public.sales_sync_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id text not null unique,
  source text not null default 'kiotviet',
  status text not null default 'running' check (status in ('running','success','failed','partial')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  business_date_from date,
  business_date_to date,
  order_count integer not null default 0,
  item_count integer not null default 0,
  payment_count integer not null default 0,
  error_message text,
  raw_json jsonb
);

create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  kiotviet_invoice_id text not null unique,
  invoice_uuid text unique,
  invoice_code text,
  kiotviet_order_id text,
  order_uuid text,
  table_or_order_code text,
  purchase_at timestamptz not null,
  business_date date not null,
  branch_id text,
  branch_name text,
  sold_by_id text,
  sold_by_name text,
  customer_code text,
  customer_name text,
  gross_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  total_payment numeric(14,2) not null default 0,
  status_code text,
  status_value text,
  using_cod boolean,
  source_created_at timestamptz,
  sync_run_id uuid references public.sales_sync_runs(id),
  raw_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sales_orders_business_date_idx on public.sales_orders(business_date);
-- One row per invoice_code (manual Excel import upsert key; guards backfill dupes).
create unique index if not exists sales_orders_invoice_code_uidx
  on public.sales_orders(invoice_code) where invoice_code is not null;
drop trigger if exists sales_orders_set_updated_at on public.sales_orders;
create trigger sales_orders_set_updated_at before update on public.sales_orders
  for each row execute function public.set_updated_at();

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  line_index integer not null default 0,
  item_key text not null,
  product_id text,
  product_code text,
  product_name text not null,
  quantity numeric(14,3) not null default 0,
  unit_price numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  discount_ratio numeric(8,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  note text,
  return_quantity numeric(14,3) not null default 0,
  category_name text,
  raw_json jsonb,
  unique(sales_order_id, item_key)
);
create index if not exists sales_order_items_product_idx on public.sales_order_items(product_name);

create table if not exists public.sales_payments (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  payment_method text not null,
  amount numeric(14,2) not null default 0,
  cash_received numeric(14,2),
  change_given numeric(14,2),
  payment_time timestamptz,
  source text not null default 'kiotviet'
    check (source in ('kiotviet','derived','manual_adjustment')),
  confidence text not null default 'derived'
    check (confidence in ('exact','derived','manual')),
  raw_json jsonb
);
create index if not exists sales_payments_order_idx on public.sales_payments(sales_order_id);

-- -----------------------------------------------------------------------------
-- 5. Cash drawer (opening, count, drawer events, close report)
-- -----------------------------------------------------------------------------
create table if not exists public.cash_day_openings (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  denominations_json jsonb not null default '{}'::jsonb,
  opening_total numeric(14,2) not null default 0,
  carried_from_previous_day boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists cash_day_openings_set_updated_at on public.cash_day_openings;
create trigger cash_day_openings_set_updated_at before update on public.cash_day_openings
  for each row execute function public.set_updated_at();

create table if not exists public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  counted_at timestamptz not null default now(),
  count_type text not null default 'spot_audit'
    check (count_type in ('spot_audit','shift_close','day_close')),
  denominations_json jsonb not null default '{}'::jsonb,
  total_physical numeric(14,2) not null default 0,
  total_theory numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  pos_total numeric(14,2) not null default 0,
  pos_cash_total numeric(14,2) not null default 0,
  pos_non_cash_total numeric(14,2) not null default 0,
  opening_cash numeric(14,2) not null default 0,
  bank_transfer_confirmed numeric(14,2) not null default 0,
  reconciliation_total numeric(14,2) not null default 0,
  note text,
  counted_by uuid references auth.users(id),
  sync_run_id uuid references public.sales_sync_runs(id),
  sales_snapshot_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cash_counts_date_idx on public.cash_counts(business_date, counted_at desc);

create table if not exists public.cash_drawer_events (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  occurred_at timestamptz not null default now(),
  event_type text not null check (event_type in (
    'opening_cash','pos_cash_in','customer_cash_received','change_given',
    'expense_cash_out','payroll_cash_out','cash_count_snapshot','manual_adjustment'
  )),
  direction text not null check (direction in ('in','out','snapshot')),
  amount numeric(14,2) not null default 0,
  balance_after numeric(14,2),
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  sales_payment_id uuid references public.sales_payments(id) on delete set null,
  expense_id uuid references public.expenses(id) on delete set null,
  shift_payroll_record_id uuid references public.shift_payroll_records(id) on delete set null,
  cash_count_id uuid references public.cash_counts(id) on delete set null,
  created_by uuid references auth.users(id),
  source text not null default 'app_action'
    check (source in ('pos_sync','app_action','system')),
  note text,
  raw_json jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cash_drawer_events_date_idx on public.cash_drawer_events(business_date, occurred_at);

create table if not exists public.cash_close_reports (
  id uuid primary key default gen_random_uuid(),
  business_date date not null,
  cash_count_id uuid not null unique references public.cash_counts(id) on delete restrict,
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id),
  pos_total numeric(14,2) not null default 0,
  opening_cash numeric(14,2) not null default 0,
  pos_cash_total numeric(14,2) not null default 0,
  pos_non_cash_total numeric(14,2) not null default 0,
  bank_transfer_confirmed numeric(14,2) not null default 0,
  expense_cash_total numeric(14,2) not null default 0,
  payroll_cash_total numeric(14,2) not null default 0,
  theory_cash numeric(14,2) not null default 0,
  reconciliation_total numeric(14,2) not null default 0,
  physical_cash numeric(14,2) not null default 0,
  difference numeric(14,2) not null default 0,
  denominations_json jsonb not null default '{}'::jsonb,
  sync_snapshot_at timestamptz,
  note text,
  report_status text not null default 'final' check (report_status in ('draft','final','voided')),
  void_reason text,
  voided_by uuid references auth.users(id),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cash_close_reports_date_idx on public.cash_close_reports(business_date, closed_at desc);
drop trigger if exists cash_close_reports_set_updated_at on public.cash_close_reports;
create trigger cash_close_reports_set_updated_at before update on public.cash_close_reports
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 6. App settings + integrations
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  is_public boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.integration_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,
  client_secret_hash text not null,
  name text not null default 'integration',
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Rate-limit log cho POS sync (Edge Function + Next.js API route)
create table if not exists public.pos_sync_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  force boolean not null default false,
  reason text
);
create index if not exists pos_sync_attempts_user_time_idx
  on public.pos_sync_attempts(user_id, requested_at desc);

-- Audit log cho 8 trigger audit_* (xem 002_functions.sql)
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_user_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  diff_json jsonb,
  request_meta jsonb
);
create index if not exists audit_log_entity_idx on public.audit_log(entity_type, entity_id);
create index if not exists audit_log_actor_idx on public.audit_log(actor_user_id, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Sổ quỹ (cash safe / vault) — owner-only ledger tách biệt với két ca
-- -----------------------------------------------------------------------------

-- Tất cả giao dịch sổ quỹ. balance_after là số dư sau giao dịch (denormalized
-- để query nhanh + dễ audit). Mọi insert đi qua security definer RPC trong
-- 002_functions.sql; direct insert bị RLS block.
create table if not exists public.safe_transactions (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  transaction_type text not null check (transaction_type in (
    'initial_setup',
    'deposit_close',
    'withdraw_open',
    'withdraw_other',
    'adjustment'
  )),
  amount numeric(14,2) not null,
  balance_after numeric(14,2) not null,
  reason_category text,
  description text,
  cash_close_report_id uuid references public.cash_close_reports(id) on delete set null,
  cash_day_opening_id uuid references public.cash_day_openings(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists safe_transactions_time_idx on public.safe_transactions(occurred_at desc);
create index if not exists safe_transactions_type_idx on public.safe_transactions(transaction_type, occurred_at desc);

-- Snapshot mệnh giá khi owner đếm thực tế (Hybrid model — total tracked tự động,
-- denomination chỉ snapshot khi cần). KHÔNG tự adjust balance — owner phải gọi
-- explicit safe_adjust nếu muốn fix discrepancy.
create table if not exists public.safe_counts (
  id uuid primary key default gen_random_uuid(),
  counted_at timestamptz not null default now(),
  denominations_json jsonb not null default '{}'::jsonb,
  total_physical numeric(14,2) not null,
  expected_balance numeric(14,2) not null,
  difference numeric(14,2) not null,
  note text,
  counted_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists safe_counts_time_idx on public.safe_counts(counted_at desc);

-- Attachments cho safe_transactions: ảnh hóa đơn upload từ owner.
-- Phase 1: lưu trữ + xem lại. Phase 2: n8n sẽ poll `where processed_at is null`
-- để OCR/extract data, ghi kết quả vào extracted_data jsonb.
-- Storage path format cố định: 'safe-receipts/{transaction_id}/{uuid}.{ext}' —
-- n8n parse được transaction_id từ path nếu cần.
create table if not exists public.safe_attachments (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.safe_transactions(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  file_size integer not null check (file_size > 0 and file_size <= 5242880),
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  -- Phase 2 reserve (n8n fills in):
  processed_at timestamptz,
  extracted_data jsonb
);
create index if not exists safe_attachments_tx_idx on public.safe_attachments(transaction_id);
-- Partial index cho n8n poll Phase 2: filter unprocessed cực nhanh.
create index if not exists safe_attachments_unprocessed_idx on public.safe_attachments(uploaded_at)
  where processed_at is null;

-- Cap 5 attachments / transaction (defense-in-depth — frontend cũng validate).
create or replace function public.safe_attachments_count_check()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.safe_attachments where transaction_id = new.transaction_id) >= 5 then
    raise exception 'Tối đa 5 file hóa đơn cho 1 giao dịch.';
  end if;
  return new;
end$$;

drop trigger if exists safe_attachments_max5_trigger on public.safe_attachments;
create trigger safe_attachments_max5_trigger before insert on public.safe_attachments
  for each row execute function public.safe_attachments_count_check();

-- CHECK constraints cho safe_transactions amount sign
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'safe_transactions_amount_sign_check') then
    alter table public.safe_transactions add constraint safe_transactions_amount_sign_check check (
      case transaction_type
        when 'initial_setup'  then amount >= 0
        when 'deposit_close'  then amount >= 0
        when 'withdraw_open'  then amount <= 0
        when 'withdraw_other' then amount <= 0
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

-- Thêm cột tracking trên cash_close_reports + cash_day_openings để link với
-- safe_transactions (cash close → deposit_close, cash open → withdraw_open).
alter table public.cash_close_reports
  add column if not exists safe_deposit_amount numeric(14,2) not null default 0,
  add column if not exists leave_for_next_day numeric(14,2) not null default 0;

-- Enforce: chỉ 1 báo cáo final per business_date. Voided rows không match
-- partial WHERE → cho phép void cũ + finalize mới. Defense-in-depth cùng
-- pre-check trong finalize_cash_close_report (raise message thân thiện).
create unique index if not exists cash_close_reports_one_final_per_day
  on public.cash_close_reports(business_date)
  where report_status = 'final';

alter table public.cash_day_openings
  add column if not exists safe_withdrawal_amount numeric(14,2) not null default 0,
  add column if not exists carried_amount numeric(14,2) not null default 0;
create index if not exists audit_log_time_idx on public.audit_log(occurred_at desc);

-- -----------------------------------------------------------------------------
-- 7. Handover (end-of-day checklist)
-- -----------------------------------------------------------------------------
create table if not exists public.handover_sessions (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  status text not null default 'draft' check (status in ('draft','completed')),
  note text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
drop trigger if exists handover_sessions_set_updated_at on public.handover_sessions;
create trigger handover_sessions_set_updated_at before update on public.handover_sessions
  for each row execute function public.set_updated_at();

create table if not exists public.handover_tasks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.handover_sessions(id) on delete cascade,
  task_key text not null,
  label text not null,
  is_done boolean not null default false,
  checked_by uuid references auth.users(id),
  checked_at timestamptz,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  unique(session_id, task_key)
);
create index if not exists handover_tasks_session_idx on public.handover_tasks(session_id, sort_order);

-- -----------------------------------------------------------------------------
-- 8. Numeric integrity CHECK constraints (idempotent via DO block)
--    Nếu fail vì có row vi phạm, run `select * from <table> where <invariant>`
--    để dọn manual rồi rerun.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employees_hourly_rate_check') then
    alter table public.employees add constraint employees_hourly_rate_check
      check (hourly_rate >= 0 and hourly_rate <= 10000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_amount_check') then
    alter table public.expenses add constraint expenses_amount_check
      check (amount >= 0 and amount <= 1000000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_quantity_check') then
    alter table public.expenses add constraint expenses_quantity_check
      check (quantity >= 0 and quantity <= 99999);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'expenses_unit_price_check') then
    alter table public.expenses add constraint expenses_unit_price_check
      check (unit_price >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'payroll_pay_check') then
    alter table public.shift_payroll_records add constraint payroll_pay_check
      check (base_pay >= 0 and total_pay >= 0 and allowance_amount >= 0 and hourly_rate >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_orders_amount_check') then
    alter table public.sales_orders add constraint sales_orders_amount_check
      check (net_amount >= 0 and total_payment >= 0 and gross_amount >= 0 and discount_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_items_quantity_check') then
    alter table public.sales_order_items add constraint sales_items_quantity_check
      check (quantity >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_items_price_check') then
    alter table public.sales_order_items add constraint sales_items_price_check
      check (unit_price >= 0 and line_total >= 0 and discount_amount >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_counts_total_check') then
    alter table public.cash_counts add constraint cash_counts_total_check
      check (total_physical >= 0 and pos_total >= 0 and pos_cash_total >= 0 and pos_non_cash_total >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cash_opening_total_check') then
    alter table public.cash_day_openings add constraint cash_opening_total_check
      check (opening_total >= 0);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Backup runs (Phase 1 backup/restore UI)
-- -----------------------------------------------------------------------------
create table if not exists public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('backup','restore')),
  status text not null default 'running' check (status in ('running','success','failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  byte_size bigint,
  log_text text default '',
  error_message text,
  created_by uuid references auth.users(id),
  filename text
);
create index if not exists backup_runs_started_idx on public.backup_runs(started_at desc);

-- =====================================================================
-- Phase 4.A — Inventory module
-- =====================================================================

create table if not exists public.ingredients (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  unit                  text not null,
  low_stock_threshold   numeric(18, 4),
  is_active             boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id),
  constraint ingredients_name_not_empty check (length(trim(name)) > 0),
  constraint ingredients_unit_not_empty check (length(trim(unit)) > 0),
  constraint ingredients_threshold_non_negative check (
    low_stock_threshold is null or low_stock_threshold >= 0
  )
);

create index if not exists idx_ingredients_active
  on public.ingredients(is_active) where is_active = true;

create table if not exists public.menu_items (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null unique,
  external_product_name   text,
  is_active               boolean not null default true,
  notes                   text,
  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users(id),
  constraint menu_items_name_not_empty check (length(trim(name)) > 0),
  constraint menu_items_external_name_not_empty check (
    external_product_name is null or length(trim(external_product_name)) > 0
  )
);

create index if not exists idx_menu_items_ext_name_active
  on public.menu_items (lower(trim(external_product_name)))
  where external_product_name is not null and is_active = true;

create table if not exists public.recipes (
  id              uuid primary key default gen_random_uuid(),
  menu_item_id    uuid not null unique references public.menu_items(id),
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_recipes_active
  on public.recipes(menu_item_id) where is_active = true;

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();

create table if not exists public.recipe_items (
  recipe_id       uuid not null references public.recipes(id) on delete cascade,
  ingredient_id   uuid not null references public.ingredients(id),
  quantity        numeric(18, 4) not null,
  constraint recipe_items_quantity_positive check (quantity > 0),
  primary key (recipe_id, ingredient_id)
);

create table if not exists public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  ingredient_id     uuid not null references public.ingredients(id),
  quantity_delta    numeric(18, 4) not null,
  reason            text not null,
  occurred_at       timestamptz not null default now(),
  source_order_id   uuid references public.sales_orders(id),
  source_recipe_id  uuid references public.recipes(id),
  notes             text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint stock_movements_reason_valid check (reason in (
    'purchase_received',
    'sale_theoretical',
    'manual_adjustment_in',
    'manual_adjustment_out',
    'count_correction',
    'waste'
  )),
  constraint stock_movements_delta_nonzero check (
    quantity_delta != 0 or reason = 'count_correction'
  ),
  constraint stock_movements_sign_matches_reason check (
    case
      when reason = 'purchase_received'     then quantity_delta > 0
      when reason = 'manual_adjustment_in'  then quantity_delta > 0
      when reason = 'manual_adjustment_out' then quantity_delta < 0
      when reason = 'waste'                 then quantity_delta < 0
      when reason = 'sale_theoretical'      then quantity_delta < 0
      when reason = 'count_correction'      then true
      else false
    end
  )
);

create index if not exists idx_stock_movements_ingredient_occurred
  on public.stock_movements (ingredient_id, occurred_at desc);
create index if not exists idx_stock_movements_reason
  on public.stock_movements (reason);
