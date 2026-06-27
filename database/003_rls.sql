-- =============================================================================
-- Chill Manager v2 — Row Level Security policies
-- Apply order: 001 → 002 → 003 → 004
-- Fully idempotent — drop + create pattern.
--
-- Quy tắc tổng quan:
--   - app_role()       — JWT của user (owner/manager/staff_operator/employee_viewer)
--   - app_is_owner_manager()    — admin role
--   - app_is_staff_or_above()   — staff trở lên (loại trừ employee_viewer)
--   - Sales* + Cash* + Audit*   — write qua security definer RPC, KHÔNG trực tiếp
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.employee_accounts enable row level security;
alter table public.signup_requests enable row level security;
alter table public.expense_categories enable row level security;
alter table public.expense_templates enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_history_permissions enable row level security;
alter table public.shift_assignments enable row level security;
alter table public.shift_payroll_records enable row level security;
alter table public.sales_sync_runs enable row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_order_items enable row level security;
alter table public.sales_payments enable row level security;
alter table public.cash_day_openings enable row level security;
alter table public.cash_counts enable row level security;
alter table public.cash_drawer_events enable row level security;
alter table public.cash_close_reports enable row level security;
alter table public.app_settings enable row level security;
alter table public.integration_clients enable row level security;
alter table public.pos_sync_attempts enable row level security;
alter table public.audit_log enable row level security;

-- =============================================================================
-- Schema-level grants — single source of truth.
--
-- Mirror this in src/app/api/backup/restore/route.ts POST_RESTORE_GRANTS_SQL.
-- The restore endpoint replays this block (minus NOTIFY) because
-- DROP SCHEMA public CASCADE wipes every grant and pg_dump --no-privileges
-- (used by /api/backup/full for portability) produces dumps without GRANTs.
-- service_role has BYPASSRLS but Postgres still requires table-level GRANTs.
-- =============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- Tables — existing
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;

-- Sequences — needed for auto-increment / nextval() access
grant usage, select on all sequences in schema public to authenticated, anon, service_role;

-- Functions — RPC + helpers
grant execute on all functions in schema public to anon, authenticated, service_role;

-- Self-check-in (2026-06-25): các hàm SERVICE-ROLE-ONLY — re-assert NGAY SAU blanket
-- grant ở trên (blanket grant vừa cấp lại cho anon/authenticated). Client không được
-- gọi thẳng để bỏ qua cổng IP / giả mạo IP/UA/giờ (check_in_self) hoặc đọc anchor IP
-- (fresh_anchor_ips). Restore endpoint replay khối 003 này nên phải giữ REVOKE tại đây.
revoke execute on function public.check_in_self(uuid, inet, text) from public, anon, authenticated;
grant execute on function public.check_in_self(uuid, inet, text) to service_role;
revoke execute on function public.check_out_self(uuid, inet, text) from public, anon, authenticated;
grant execute on function public.check_out_self(uuid, inet, text) to service_role;
revoke execute on function public.fresh_anchor_ips(numeric) from public, anon, authenticated;
grant execute on function public.fresh_anchor_ips(numeric) to service_role;
-- record_shop_anchor_heartbeat (2026-06-26): service-role-only. The heartbeat route
-- authenticates by the device token (no owner session) then writes via service role,
-- so the shop anchor device keeps its IP fresh under ANY session (manager/staff).
revoke execute on function public.record_shop_anchor_heartbeat(uuid, inet) from public, anon, authenticated;
grant execute on function public.record_shop_anchor_heartbeat(uuid, inet) to service_role;
-- Re-point account (2026-06-26): service-role-only (route verify owner JWT → trusted
-- p_auth_user_id). Re-assert sau blanket grant để client không gọi thẳng RPC này.
revoke execute on function public.repoint_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.repoint_account(uuid, uuid, uuid) to service_role;

-- Default privileges — applies to FUTURE objects created by this role
-- (typically `postgres` via scripts/db-init.mjs or the migrator container).
-- Without these, every new table relies on inherited Supabase defaults that
-- can silently drift — the exact failure mode that broke /api/backup/restore.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to authenticated, anon, service_role;
alter default privileges in schema public
  grant execute on functions to authenticated, anon, service_role;

-- profiles
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid() or public.app_is_owner_manager());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid() or public.app_is_owner_manager()) with check (id = auth.uid() or public.app_is_owner_manager());
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert to authenticated with check (id = auth.uid() or public.app_is_owner_manager());

-- employee accounts and employees
drop policy if exists employee_accounts_select on public.employee_accounts;
create policy employee_accounts_select on public.employee_accounts for select to authenticated using (auth_user_id = auth.uid() or public.app_is_owner_manager());
drop policy if exists employee_accounts_admin_write on public.employee_accounts;
create policy employee_accounts_admin_write on public.employee_accounts for all to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

drop policy if exists employees_staff_read on public.employees;
create policy employees_staff_read on public.employees for select to authenticated using (public.app_is_staff_or_above() or public.app_role() = 'employee_viewer');
drop policy if exists employees_admin_write on public.employees;
create policy employees_admin_write on public.employees for all to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

-- signup requests
drop policy if exists signup_insert_self on public.signup_requests;
create policy signup_insert_self on public.signup_requests for insert to authenticated with check (auth_user_id = auth.uid());
drop policy if exists signup_select_self_admin on public.signup_requests;
create policy signup_select_self_admin on public.signup_requests for select to authenticated using (auth_user_id = auth.uid() or public.app_is_owner_manager());
drop policy if exists signup_admin_update on public.signup_requests;
create policy signup_admin_update on public.signup_requests for update to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

-- expense categories/templates
drop policy if exists expense_categories_read on public.expense_categories;
create policy expense_categories_read on public.expense_categories for select to authenticated using (is_active or public.app_is_owner_manager());
drop policy if exists expense_categories_admin_write on public.expense_categories;
create policy expense_categories_admin_write on public.expense_categories for all to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

drop policy if exists expense_templates_read on public.expense_templates;
create policy expense_templates_read on public.expense_templates for select to authenticated using (is_active or public.app_is_owner_manager());
drop policy if exists expense_templates_admin_write on public.expense_templates;
create policy expense_templates_admin_write on public.expense_templates for all to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

-- expenses
drop policy if exists expenses_staff_read on public.expenses;
create policy expenses_staff_read on public.expenses for select to authenticated using (
  public.app_is_staff_or_above()
  or (
    public.app_role() = 'employee_viewer'
    and exists (
      select 1 from public.employee_accounts ea
      join public.expense_history_permissions p on p.employee_id = ea.employee_id
      where ea.auth_user_id = auth.uid()
        and expenses.business_date between p.date_from and p.date_to
    )
  )
);
drop policy if exists expenses_staff_insert on public.expenses;
create policy expenses_staff_insert on public.expenses for insert to authenticated with check (public.app_is_staff_or_above());
drop policy if exists expenses_manager_update on public.expenses;
create policy expenses_manager_update on public.expenses for update to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());
drop policy if exists expenses_manager_delete on public.expenses;
create policy expenses_manager_delete on public.expenses for delete to authenticated using (public.app_is_owner_manager());

drop policy if exists expense_permissions_admin on public.expense_history_permissions;
create policy expense_permissions_admin on public.expense_history_permissions for all to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

-- shifts and payroll
drop policy if exists shifts_staff_read on public.shift_assignments;
create policy shifts_staff_read on public.shift_assignments for select to authenticated using (public.app_is_staff_or_above());

drop policy if exists payroll_staff_read on public.shift_payroll_records;
create policy payroll_staff_read on public.shift_payroll_records for select to authenticated using (public.app_is_staff_or_above());

-- Phase 2b: KHÔNG cho authenticated ghi trực tiếp. Mọi write qua security-definer RPC.
drop policy if exists shifts_staff_write on public.shift_assignments;
drop policy if exists shifts_staff_update on public.shift_assignments;
drop policy if exists payroll_staff_write on public.shift_payroll_records;
drop policy if exists payroll_staff_update on public.shift_payroll_records;

-- sales read-only for app users, writes only through security definer RPC
drop policy if exists sales_sync_staff_read on public.sales_sync_runs;
create policy sales_sync_staff_read on public.sales_sync_runs for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists sales_orders_staff_read on public.sales_orders;
create policy sales_orders_staff_read on public.sales_orders for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists sales_items_staff_read on public.sales_order_items;
create policy sales_items_staff_read on public.sales_order_items for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists sales_payments_staff_read on public.sales_payments;
create policy sales_payments_staff_read on public.sales_payments for select to authenticated using (public.app_is_staff_or_above());

-- cash operations
drop policy if exists cash_openings_staff on public.cash_day_openings;
drop policy if exists cash_openings_staff_read on public.cash_day_openings;
create policy cash_openings_staff_read on public.cash_day_openings for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists cash_openings_owner_manager_insert on public.cash_day_openings;
create policy cash_openings_owner_manager_insert on public.cash_day_openings for insert to authenticated with check (public.app_role() in ('owner','manager'));
drop policy if exists cash_openings_owner_update on public.cash_day_openings;
create policy cash_openings_owner_update on public.cash_day_openings for update to authenticated using (public.app_role() = 'owner') with check (public.app_role() = 'owner');
drop policy if exists cash_counts_staff on public.cash_counts;
create policy cash_counts_staff on public.cash_counts for all to authenticated using (public.app_is_staff_or_above()) with check (public.app_is_staff_or_above());
drop policy if exists cash_events_staff_read on public.cash_drawer_events;
create policy cash_events_staff_read on public.cash_drawer_events for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists cash_events_staff_insert on public.cash_drawer_events;
create policy cash_events_staff_insert on public.cash_drawer_events for insert to authenticated with check (public.app_is_staff_or_above());

drop policy if exists cash_reports_staff_read on public.cash_close_reports;
create policy cash_reports_staff_read on public.cash_close_reports for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists cash_reports_admin_update on public.cash_close_reports;
create policy cash_reports_admin_update on public.cash_close_reports for update to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

-- settings and integrations
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (is_public or public.app_is_owner_manager());
drop policy if exists app_settings_admin_write on public.app_settings;
create policy app_settings_admin_write on public.app_settings for all to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());

drop policy if exists integration_clients_no_direct_read on public.integration_clients;
create policy integration_clients_no_direct_read on public.integration_clients for select to authenticated using (false);
drop policy if exists integration_clients_admin_insert on public.integration_clients;
create policy integration_clients_admin_insert on public.integration_clients for insert to authenticated with check (public.app_is_owner_manager());
drop policy if exists integration_clients_admin_update on public.integration_clients;
create policy integration_clients_admin_update on public.integration_clients for update to authenticated using (public.app_is_owner_manager()) with check (public.app_is_owner_manager());
drop policy if exists integration_clients_admin_delete on public.integration_clients;
create policy integration_clients_admin_delete on public.integration_clients for delete to authenticated using (public.app_is_owner_manager());

drop policy if exists pos_sync_attempts_admin_read on public.pos_sync_attempts;
create policy pos_sync_attempts_admin_read on public.pos_sync_attempts for select to authenticated using (public.app_is_owner_manager());
drop policy if exists pos_sync_attempts_self_insert on public.pos_sync_attempts;
create policy pos_sync_attempts_self_insert on public.pos_sync_attempts for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log for select to authenticated using (public.app_is_owner_manager());
drop policy if exists audit_log_no_direct_write on public.audit_log;
create policy audit_log_no_direct_write on public.audit_log for insert to authenticated with check (false);

-- Sổ quỹ — owner only đọc trực tiếp. Manager + staff đọc được balance qua
-- safe_balance_now() RPC (function security definer bypass RLS). Trực tiếp
-- table → owner only. Insert/update đi qua security definer RPCs → không
-- cần policy write.
alter table public.safe_transactions enable row level security;
alter table public.safe_counts enable row level security;

drop policy if exists safe_transactions_owner_read on public.safe_transactions;
create policy safe_transactions_owner_read on public.safe_transactions
  for select to authenticated using (public.app_role() = 'owner');
drop policy if exists safe_transactions_no_direct_write on public.safe_transactions;
create policy safe_transactions_no_direct_write on public.safe_transactions
  for insert to authenticated with check (false);

drop policy if exists safe_counts_owner_read on public.safe_counts;
create policy safe_counts_owner_read on public.safe_counts
  for select to authenticated using (public.app_role() = 'owner');
drop policy if exists safe_counts_no_direct_write on public.safe_counts;
create policy safe_counts_no_direct_write on public.safe_counts
  for insert to authenticated with check (false);

-- safe_attachments → owner only. Insert/delete đi qua RPC security definer.
alter table public.safe_attachments enable row level security;

drop policy if exists safe_attachments_owner_read on public.safe_attachments;
create policy safe_attachments_owner_read on public.safe_attachments
  for select to authenticated using (public.app_role() = 'owner');
drop policy if exists safe_attachments_no_direct_write on public.safe_attachments;
create policy safe_attachments_no_direct_write on public.safe_attachments
  for insert to authenticated with check (false);

-- Kết toán kỳ — owner only đọc; mọi write qua RPC security definer
-- (finalize_period_close / void_period_close). Update/delete không có policy
-- → mặc định deny. Khuôn y hệt safe_transactions.
-- Spec: docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
alter table public.period_closes enable row level security;

drop policy if exists period_closes_owner_read on public.period_closes;
create policy period_closes_owner_read on public.period_closes
  for select to authenticated using (public.app_role() = 'owner');
drop policy if exists period_closes_no_direct_write on public.period_closes;
create policy period_closes_no_direct_write on public.period_closes
  for insert to authenticated with check (false);

-- Đơn giá tham chiếu tồn kho — owner only cả đọc lẫn ghi (ghi trực tiếp qua
-- RLS, không cần RPC vì upsert single-row đơn giản).
-- Spec: docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md
alter table public.ingredient_reference_prices enable row level security;

drop policy if exists ingredient_ref_prices_owner_all on public.ingredient_reference_prices;
create policy ingredient_ref_prices_owner_all on public.ingredient_reference_prices
  for all to authenticated
  using (public.app_role() = 'owner')
  with check (public.app_role() = 'owner');

grant select, insert, update, delete
  on public.ingredient_reference_prices to authenticated;
grant all on public.ingredient_reference_prices to service_role;


alter table public.handover_sessions enable row level security;
alter table public.handover_tasks enable row level security;

drop policy if exists handover_sessions_staff_read on public.handover_sessions;
create policy handover_sessions_staff_read on public.handover_sessions for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists handover_sessions_staff_insert on public.handover_sessions;
create policy handover_sessions_staff_insert on public.handover_sessions for insert to authenticated with check (public.app_is_staff_or_above());
drop policy if exists handover_sessions_staff_update on public.handover_sessions;
create policy handover_sessions_staff_update on public.handover_sessions for update to authenticated using (public.app_is_staff_or_above()) with check (public.app_is_staff_or_above());

drop policy if exists handover_tasks_staff_read on public.handover_tasks;
create policy handover_tasks_staff_read on public.handover_tasks for select to authenticated using (public.app_is_staff_or_above());
drop policy if exists handover_tasks_staff_insert on public.handover_tasks;
create policy handover_tasks_staff_insert on public.handover_tasks for insert to authenticated with check (public.app_is_staff_or_above());
drop policy if exists handover_tasks_staff_update on public.handover_tasks;
create policy handover_tasks_staff_update on public.handover_tasks for update to authenticated using (public.app_is_staff_or_above()) with check (public.app_is_staff_or_above());

-- =====================================================================
-- Phase 4.A — Inventory RLS
-- =====================================================================

alter table public.ingredients     enable row level security;
alter table public.menu_items      enable row level security;
alter table public.recipes         enable row level security;
alter table public.recipe_items    enable row level security;
alter table public.stock_movements enable row level security;

-- SELECT: operational roles read all 5 tables. employee_self_service is EXCLUDED
-- (C5/R5) — ẩn nav không phải authorization boundary; role mới không được đọc giá
-- nguyên liệu / lịch sử kho qua PostgREST.
drop policy if exists ingredients_select_all     on public.ingredients;
drop policy if exists menu_items_select_all      on public.menu_items;
drop policy if exists recipes_select_all         on public.recipes;
drop policy if exists recipe_items_select_all    on public.recipe_items;
drop policy if exists stock_movements_select_all on public.stock_movements;

create policy ingredients_select_all on public.ingredients for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
create policy menu_items_select_all on public.menu_items for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
create policy recipes_select_all on public.recipes for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
create policy recipe_items_select_all on public.recipe_items for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));
create policy stock_movements_select_all on public.stock_movements for select to authenticated
  using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'));

-- WRITE: deny direct INSERT/UPDATE/DELETE from authenticated clients.
-- All writes go through SECURITY DEFINER RPCs (or the trigger which is also SECURITY DEFINER).
drop policy if exists ingredients_no_direct_write     on public.ingredients;
drop policy if exists menu_items_no_direct_write      on public.menu_items;
drop policy if exists recipes_no_direct_write         on public.recipes;
drop policy if exists recipe_items_no_direct_write    on public.recipe_items;
drop policy if exists stock_movements_no_direct_write on public.stock_movements;

create policy ingredients_no_direct_write on public.ingredients
  for all to authenticated using (false) with check (false);
create policy menu_items_no_direct_write on public.menu_items
  for all to authenticated using (false) with check (false);
create policy recipes_no_direct_write on public.recipes
  for all to authenticated using (false) with check (false);
create policy recipe_items_no_direct_write on public.recipe_items
  for all to authenticated using (false) with check (false);
create policy stock_movements_no_direct_write on public.stock_movements
  for all to authenticated using (false) with check (false);

-- backup_runs (Phase 1 backup/restore)
alter table public.backup_runs enable row level security;
drop policy if exists backup_runs_owner_read on public.backup_runs;
create policy backup_runs_owner_read on public.backup_runs for select
  using (public.app_role() = 'owner');

-- checkin_anchor (self-check-in 2026-06-25): owner-only read; mọi ghi trực tiếp bị
-- chặn — chỉ qua RPC SECURITY DEFINER (add/remove/heartbeat). Anchor IP không lộ.
alter table public.checkin_anchor enable row level security;
drop policy if exists checkin_anchor_owner_read on public.checkin_anchor;
create policy checkin_anchor_owner_read on public.checkin_anchor for select
  using (public.app_role() = 'owner');
drop policy if exists checkin_anchor_no_direct_write on public.checkin_anchor;
create policy checkin_anchor_no_direct_write on public.checkin_anchor
  for all to authenticated using (false) with check (false);

-- ============================================================== ANALYTICS-GRANTS-BEGIN
-- Schema analytics: CHỈ service_role (n8n). KHÔNG grant anon/authenticated.
-- Mirror trong src/app/api/backup/restore/route.ts POST_RESTORE_GRANTS_SQL.
-- Khối này được trích nguyên văn vào migration 2026-06-11-analytics-views.sql.
grant usage on schema analytics to service_role;
grant select on all tables in schema analytics to service_role;
alter default privileges in schema analytics
  grant select on tables to service_role;
-- ============================================================== ANALYTICS-GRANTS-END
