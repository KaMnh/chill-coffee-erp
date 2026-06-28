-- =============================================================================
-- Chill Manager v2 — Seed data
-- Apply order: 001 → 002 → 003 → 004
-- Fully idempotent — `on conflict` patterns.
--
-- Sau khi chạy file này, OWNER cần làm thêm 2 bước thủ công:
--   1. Tạo integration_clients row (cho ingest_kiotviet_batch RPC):
--      insert into public.integration_clients (client_id, client_secret_hash, is_active)
--      values ('chill-erp', crypt('<YOUR-RANDOM-SECRET-32+chars>', gen_salt('bf')), true);
--      → Sau đó set INGEST_CLIENT_ID + INGEST_CLIENT_SECRET trong .env tương ứng.
--
--   2. Cấu hình KiotViet credentials qua UI Settings (hoặc UPDATE app_settings trực tiếp).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Expense categories (loại chi phí cơ bản)
-- -----------------------------------------------------------------------------
insert into public.expense_categories (name, type, sort_order, is_active) values
  ('Nguyên liệu', 'expense', 10, true),
  ('Vận hành', 'expense', 20, true),
  ('Lương', 'expense', 30, true),
  ('Khác', 'expense', 100, true)
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 2. Expense templates (3 mẫu hay dùng)
-- -----------------------------------------------------------------------------
insert into public.expense_templates (label, default_category_id, default_unit, last_unit_price, usage_count, is_active)
select 'Bánh mì', id, 'ổ', 6000, 0, true from public.expense_categories where name = 'Nguyên liệu'
on conflict do nothing;

insert into public.expense_templates (label, default_category_id, default_unit, last_unit_price, usage_count, is_active)
select 'Đá viên', id, 'bao', 30000, 0, true from public.expense_categories where name = 'Vận hành'
on conflict do nothing;

insert into public.expense_templates (label, default_category_id, default_unit, last_unit_price, usage_count, is_active)
select 'Trứng', id, 'quả', 2500, 0, true from public.expense_categories where name = 'Nguyên liệu'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. App settings — public configs (read được bởi mọi authenticated user)
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, is_public) values
  ('denominations',
   '[1000,2000,5000,10000,20000,50000,100000,200000,500000]'::jsonb,
   true),
  ('cash_diff_threshold',
   '{"warn": 200000, "critical": 500000}'::jsonb,
   true),
  ('sidebar_defaults',
   '{
     "owner":["dashboard","expenses","shifts","cash","reports","pivot","settings"],
     "manager":["dashboard","expenses","shifts","cash","reports","pivot","settings"],
     "staff_operator":["dashboard","expenses","shifts","cash","reports"],
     "employee_viewer":["dashboard"]
   }'::jsonb,
   true),
  ('handover_default_tasks',
   '[
     {"key":"clean_counter","label":"Đã vệ sinh quầy và máy pha"},
     {"key":"restock","label":"Đã kiểm tra nguyên liệu cần bổ sung"},
     {"key":"cash_ready","label":"Đã chuẩn bị tiền lẻ/két cho ca sau"},
     {"key":"handover_note","label":"Đã ghi chú bàn giao cho ca sau"}
   ]'::jsonb,
   true)
on conflict (key) do update
  set value = excluded.value,
      is_public = excluded.is_public,
      updated_at = now();

-- -----------------------------------------------------------------------------
-- 4. KiotViet credentials placeholder (is_public = false → owner/manager only)
--    Owner edit qua UI Settings → Section "KiotViet (FNB)".
--    KHÔNG hardcode credential vào seed — chỉ insert default schema.
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, is_public) values
  ('kiotviet_credentials',
   jsonb_build_object(
     'client_id', '',
     'client_secret', '',
     'retailer', '',
     'token_url', 'https://api.fnb.kiotviet.vn/identity/connect/token',
     'api_base', 'https://publicfnb.kiotapi.com',
     'scope', 'PublicApi.Access.FNB',
     'rate_limit_per_sec', 4,
     'is_active', false,
     'webhook_secret', ''
   ),
   false)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 5. Safe withdraw categories (cho rút sổ quỹ mục đích khác)
--    Public — UI dùng để render dropdown, không có sensitive info.
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, is_public) values
  ('safe_withdraw_categories',
   jsonb_build_array(
     jsonb_build_object('key', 'utilities',   'label', 'Tiền điện / nước / mạng'),
     jsonb_build_object('key', 'rent',        'label', 'Tiền thuê / dịch vụ'),
     jsonb_build_object('key', 'inventory',   'label', 'Mua nguyên liệu lớn'),
     jsonb_build_object('key', 'maintenance', 'label', 'Sửa chữa / bảo trì'),
     jsonb_build_object('key', 'other',       'label', 'Khác')
   ),
   true)
on conflict (key) do update
  set value = excluded.value,
      is_public = excluded.is_public,
      updated_at = now();

-- -----------------------------------------------------------------------------
-- 6. Check-in network gate (self-check-in 2026-06-25)
--    enabled:false = tính năng TẮT (503) cho tới khi owner cấu hình + có anchor IP.
-- -----------------------------------------------------------------------------
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"enabled": false, "reject_message": "Chỉ chấm công được khi ở tại quán (nối wifi quán).", "grace_hours": 12, "self_checkout_enabled": false, "shift_start_time": "05:30"}'::jsonb, false)
on conflict (key) do nothing;
