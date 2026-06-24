# Chill Manager v2 — Database Setup

Tất cả SQL cho Chill Manager v2 (ERP + KiotViet POS sync + Audit log + Settings).

## Files

| File | Type | Nội dung |
|------|------|----------|
| `000_reset.sql` | **DESTRUCTIVE** (optional) | Drop + recreate schema `public`. Chỉ dùng khi rebuild từ đầu. |
| `001_schema.sql` | Idempotent | Tables (~25), indexes, base triggers `set_updated_at`, 10 CHECK constraints |
| `002_functions.sql` | Idempotent | ~29 RPC functions (auth, cash, expenses, shifts, POS ingest, handover, settings, KiotViet) + 8 audit triggers |
| `003_rls.sql` | Idempotent | Row Level Security cho mọi bảng (read/write theo role) |
| `004_seed.sql` | Idempotent | Default expense categories + templates + app_settings (sidebar defaults, denominations, handover tasks, KiotViet placeholder) |

## Quick start cho DB mới hoàn toàn (empty)

Apply theo đúng thứ tự **001 → 002 → 003 → 004**.

## Khi DB cũ còn leftover state (CẦN rebuild)

Triệu chứng: chạy 001 báo lỗi như `column "X" does not exist`, `relation "Y" already exists`, hoặc dropdown table còn bảng cũ schema không khớp.

→ Chạy `000_reset.sql` TRƯỚC, sau đó mới apply 001-004:
**000 (reset) → 001 → 002 → 003 → 004**

⚠️ **CẢNH BÁO**: `000_reset.sql` xóa toàn bộ data trong schema `public`. KHÔNG dùng nếu có data production cần giữ.

### Cách apply

**Supabase Studio (UI)**:
1. Mở SQL Editor → New query
2. Mở từng file `001 → 002 → 003 → 004` trên máy
3. Copy nội dung → paste → bấm **Run**
4. Lặp lại cho từng file theo thứ tự

**psql (CLI)**:
```bash
PSQL_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"

# Optional: full reset (DESTRUCTIVE — chạy nếu DB cũ còn state)
# psql "$PSQL_URL" -f database/000_reset.sql

psql "$PSQL_URL" -f database/001_schema.sql
psql "$PSQL_URL" -f database/002_functions.sql
psql "$PSQL_URL" -f database/003_rls.sql
psql "$PSQL_URL" -f database/004_seed.sql
```

Files 001-004 **fully idempotent** — re-run an toàn nhiều lần. File 000 destructive, chỉ chạy khi cần.

---

## Sau khi apply 4 file

### Bước 1: Tạo integration_clients row (cho POS ingest RPC)

Next.js API route `/api/kiotviet/sync` authenticate với `ingest_kiotviet_batch` RPC qua row trong `integration_clients`. Generate secret an toàn rồi insert:

```sql
-- Generate random secret 32+ ký tự (Linux/Mac)
-- $ openssl rand -base64 32
-- Hoặc dùng password manager / 1Password

insert into public.integration_clients (client_id, client_secret_hash, is_active)
values (
  'chill-erp',
  crypt('REPLACE-THIS-WITH-YOUR-RANDOM-SECRET', gen_salt('bf')),
  true
);

-- Verify
select client_id, is_active, created_at
from public.integration_clients;
```

Sau đó set 2 env vars trong Next.js (`.env.local` cho dev, server `.env` cho prod):
```env
INGEST_CLIENT_ID=chill-erp
INGEST_CLIENT_SECRET=REPLACE-THIS-WITH-YOUR-RANDOM-SECRET
```

### Bước 2: Tạo owner account đầu tiên

```sql
-- 2a. Đăng ký user qua Supabase Auth (Auth → Users → Add user → Email invite)
--     hoặc qua login form của app (sẽ tạo signup_request).
-- 2b. Sau khi user xác nhận email, manually insert employee_accounts:

-- Bước b.1: tạo employee row
insert into public.employees (name, position, hourly_rate, is_active)
values ('Owner Name', 'Chủ quán', 0, true)
returning id;

-- Bước b.2: link auth_user_id với employee_id (lấy auth_user_id từ Auth dashboard)
insert into public.employee_accounts (employee_id, auth_user_id, role, status)
values (
  '<employee_id từ bước b.1>',
  '<auth_user_id từ Auth dashboard>',
  'owner',
  'active'
);
```

### Bước 3: Cấu hình KiotViet credentials

Login vào ERP với owner account → **Settings** → section **KiotViet (FNB)**:
- Nhập `Retailer` (vd: `chillcoffeegarden`)
- Nhập `Client ID` + `Client Secret` (lấy từ KiotViet manager → Thiết lập → Kết nối API)
- Tích **Bật KiotViet sync**
- Bấm **Lưu cấu hình**
- Bấm **Force sync** để test

### Bước 4: Bật Supabase Realtime cho ERP UI

Để frontend auto-update khi có thay đổi (chốt két, sửa lương...):

```sql
alter publication supabase_realtime add table public.cash_counts;
alter publication supabase_realtime add table public.cash_close_reports;
alter publication supabase_realtime add table public.handover_tasks;
alter publication supabase_realtime add table public.expenses;
alter publication supabase_realtime add table public.sales_sync_runs;
alter publication supabase_realtime add table public.shift_assignments;
alter publication supabase_realtime add table public.shift_payroll_records;
```

---

## Verify deployment

Chạy các query này sau khi apply để confirm setup OK:

```sql
-- 1. Tables (phải thấy ~25 row)
select count(*) as total_tables
from information_schema.tables
where table_schema = 'public';

-- 2. RPCs (phải thấy ~26 row)
select count(*) as total_functions
from pg_proc
where pronamespace = 'public'::regnamespace
  and prokind = 'f';

-- 3. CHECK constraints (phải thấy 10)
select conname from pg_constraint
where conname like '%_check'
  and conname in (
    'employees_hourly_rate_check', 'expenses_amount_check',
    'expenses_quantity_check', 'expenses_unit_price_check',
    'payroll_pay_check', 'sales_orders_amount_check',
    'sales_items_quantity_check', 'sales_items_price_check',
    'cash_counts_total_check', 'cash_opening_total_check'
  )
order by conname;

-- 4. Audit triggers (phải thấy 8)
select tgname from pg_trigger
where tgname like 'audit_%'
order by tgname;

-- 5. RLS policies (phải thấy ~50+)
select schemaname, tablename, count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by 1, 2
order by 2;

-- 6. Seed data
select count(*) from public.expense_categories;     -- 4
select count(*) from public.expense_templates;      -- 3
select count(*) from public.app_settings;           -- 5 (denominations, cash_diff_threshold, sidebar_defaults, handover_default_tasks, kiotviet_credentials)
```

---

## Schema overview

```
auth.users (Supabase Auth, không sửa)
    │
    ├── profiles                   — Optional metadata + sidebar config per user
    └── employee_accounts          — Map auth user → employee + role
            │
            └── employees          — Nhân viên (rate, position, ...)
                    │
                    ├── shift_assignments
                    │       └── shift_payroll_records  ← edit_shift_payroll_record RPC
                    │
                    └── expense_history_permissions

expense_categories ─┐
expense_templates ──┴── expenses

cash_day_openings  ─┐
cash_counts ────────┴── cash_drawer_events
        └── cash_close_reports

sales_sync_runs ──┬── sales_orders ──┬── sales_order_items
                  │                  └── sales_payments
                  └── (created by ingest_kiotviet_batch)

app_settings  (kv_credentials, denominations, sidebar_defaults, ...)
integration_clients  (auth cho ingest_kiotviet_batch)
pos_sync_attempts    (rate limit log)
audit_log            (8 trigger audit_*)

handover_sessions
    └── handover_tasks
```

---

## Khi nào re-apply file

- **001**: Khi thêm bảng/index/CHECK mới (rerun an toàn)
- **002**: Khi sửa logic RPC hoặc thêm RPC (rerun an toàn)
- **003**: Khi đổi quyền RLS (rerun an toàn)
- **004**: Khi muốn reset default settings (CẨN THẬN — sẽ overwrite custom values như sidebar_defaults qua `do update`; chỉ `kiotviet_credentials` là `do nothing`)

KHÔNG cần script migration version vì cả 4 file đều idempotent. Mỗi lần deploy cứ chạy lại 001 → 002 → 003 → 004 là sạch.
