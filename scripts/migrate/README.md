# Migration tooling: Supabase v2.x → Chill Coffee ERP v4

Quy trình **một lần duy nhất** để migrate master data + cash/expense/shift lịch sử từ phiên bản trước của Chill Coffee ERP (Supabase v2.x) sang schema v4.

> **KHÔNG** migrate sales (sync lại từ KiotViet), inventory (v2.x chưa có), safe ledger (v2.x chưa có).

## Tổng quan 5 stages

| Stage | Script | Mục đích |
|---|---|---|
| 0 | `00-check-dump.mjs` | Pre-flight check dump file: pg_dump meta, row counts, sample rows, risk flags |
| 1 | `01-inspect-dump.mjs` | Parse dump v2 + diff với schema v4 → markdown report |
| 2 | `02-load-staging.mjs` | Áp dump vào schema `legacy_v2` + load CSV auth.users vào `legacy_v2_auth.users` |
| 3 | `03-run-all.mjs` | Migrate 8 nhóm: employees → expense_masters → expenses → cash → shifts → safe → handover → cash_events |
| 4 | `04-verify.mjs` | Count diff, FK integrity, TZ sanity, match ratio report |

## Pre-requisites (CHUẨN BỊ TRƯỚC)

### 1. Backup v4 hiện tại (rollback point)
```powershell
New-Item -ItemType Directory -Force backup
docker compose exec -T db pg_dump -U postgres -d postgres `
  | Out-File -Encoding utf8 "backup\v4-pre-migration-$(Get-Date -Format yyyyMMdd-HHmm).sql"
```

### 2. Tải dump v2.x từ Supabase Dashboard
- Vào project v2.x → **Settings → Database → Backups → Download** (Plain SQL format)
- Hoặc dùng CLI nếu link được: `supabase db dump --linked > v2-dump.sql`
- Đặt file tại: `migration/v2-dump.sql`

### 3. Dump auth.users riêng (Supabase Dashboard KHÔNG tự dump schema auth)
**Quan trọng**: Backup từ Dashboard chỉ dump `public`, không có `auth.*`. Mà email mapping CẦN bảng `auth.users`.
- Vào project v2.x → **SQL Editor** → chạy:
  ```sql
  select id, email from auth.users;
  ```
- Click **Download CSV** → save file vào: `migration/v2-auth-users.csv`
- Format CSV: header `id,email`, mỗi row là 1 user

Nếu skip bước này: migration vẫn chạy nhưng tất cả `created_by`/`counted_by`/`closed_by` sẽ NULL (mất audit cũ).

### 4. Đăng ký lại owner/manager trên v4
Migration dùng **email_match** để map `auth.users.id` v2 → v4. Trước khi chạy Stage 3:
- Tất cả owner/manager active trong v2 **phải được tạo lại trên v4** với **cùng email**
- Cách dễ nhất: dùng `npm run db:seed` cho owner đầu tiên + signup flow cho phần còn lại
- Email không match → user đó sẽ bị skip insert vào `employee_accounts` (log vào `migration/unmapped-users.csv`)

### 4. Stack v4 phải running healthy
```powershell
docker compose ps db    # phải healthy
npm run db:init         # nếu chưa init
npm run db:seed         # nếu chưa có owner
npm run pgtap           # baseline tests pass
```

### 5. Env vars
- `.env`: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `supabase/.env`: `POSTGRES_PASSWORD`

---

## Workflow

### Stage 0 — Pre-flight check on dump file (no Docker required)
```powershell
npm run migrate:check
# Output: docs/migration/v2-dump-inspection.md (+ console summary)
```
Verify:
- File integrity (pg_dump format, Postgres version)
- Per-table row counts (whitelist coverage)
- Sample 3 rows mỗi bảng scope
- Risk flags (sales table size, auth.users presence, encoding warnings)

Nếu có flag `error` → fix trước khi tiếp tục.

### Stage 1 — Schema diff (no Docker required)
```powershell
npm run migrate:inspect
# Output: docs/migration/v2-to-v4-schema-diff.md
```
Mở report, review:
- `OK` → không cần xử lý
- `NEW_v4` → cột mới có default, an toàn (data v2 sẽ null/default)
- `TYPE_DIFF` → ⚠️  đặc biệt nếu `timestamp` vs `timestamptz` → cần explicit TZ trong INSERT (script đã handle)
- `DROPPED_v4` → ⚠️  data v2 có cột này nhưng v4 không có → mất nếu không xử lý
- `NULLABLE_DIFF`, `DEFAULT_DIFF` → review nếu rely

### Stage 2 — Load to staging (Docker required)
```powershell
npm run migrate:load
# Output: migration/v2-dump-staged.sql (pre-processed)
#         schemas legacy_v2 + legacy_v2_auth trong DB
```
Stage 2 cũng auto-load `migration/v2-auth-users.csv` vào `legacy_v2_auth.users` nếu file tồn tại.

Verify nhanh:
```powershell
docker compose exec -T db psql -U postgres -c "\dt legacy_v2.*"
docker compose exec -T db psql -U postgres -c "select count(*) from legacy_v2.employees;"
docker compose exec -T db psql -U postgres -c "select count(*) from legacy_v2_auth.users;"
```

### Stage 3 — Migrate (Docker required)
**Khuyến nghị lần đầu chạy `--dry-run` từng bước:**
```powershell
node scripts/migrate/03a-employees.mjs --dry-run        # preview
node scripts/migrate/03a-employees.mjs                  # execute
node scripts/migrate/03b-expense-masters.mjs
node scripts/migrate/03c-expenses.mjs
node scripts/migrate/03d-cash.mjs
node scripts/migrate/03e-shifts.mjs
node scripts/migrate/03f-safe.mjs              # safe_transactions
node scripts/migrate/03g-handover.mjs          # handover sessions + tasks
node scripts/migrate/03h-cash-events.mjs       # cash_drawer_events
```

Hoặc chạy tất cả 8 steps:
```powershell
npm run migrate:apply
# Output: migration/migration-log-YYYY-MM-DD-HH-MM-SS.json
```

Per-script logic:
- Detect cột thực tế trong `legacy_v2.<table>` (vì v2 có thể thiếu cột)
- Build `_mig_idmap_<table>` (real table trong `legacy_v2`) để stage sau lookup FK
- `SET LOCAL session_replication_role = 'replica'` → disable audit triggers
- `ON CONFLICT DO NOTHING` hoặc `WHERE NOT EXISTS` → idempotent

### Stage 4 — Verify
```powershell
npm run migrate:verify
npm run pgtap                       # đảm bảo schema invariants OK
# Output: docs/migration/v2-to-v4-verify-report.md
```

Spot check thủ công:
```powershell
docker compose exec -T db psql -U postgres -c `
  "select business_date, count(*), sum(amount) from public.expenses group by 1 order by 1 desc limit 10;"
```

### Cleanup (sau khi verify OK)
```powershell
docker compose exec -T db psql -U postgres -c `
  "drop schema legacy_v2 cascade; drop schema legacy_v2_auth cascade;"
```

Lưu trữ dump file ra ngoài repo (đã gitignore):
```powershell
Move-Item migration\v2-dump.sql ..\archive\
```

---

## Rollback

Nếu Stage 4 verify FAIL nặng và muốn restore v4 trước migration:
```powershell
docker compose exec -T db psql -U postgres -c "drop schema public cascade;"
docker compose exec -T db psql -U postgres < backup\v4-pre-migration-YYYYMMDD-HHMM.sql
```

---

## Reset (rerun migration sạch)

Nếu migration đã chạy 1 phần (do bug, do test, v.v.) và muốn re-run từ đầu, dùng reset script:

```powershell
# Dry-run preview (in counts, không xóa)
npm run migrate:reset

# Execute thực sự (yêu cầu --confirm)
node scripts/migrate/03z-reset.mjs --confirm
# Hoặc qua env: $env:RESET_CONFIRMED="1"; npm run migrate:reset
```

Reset sẽ:
- **GIỮ** seed owner (1 employee_accounts với role=owner đầu tiên theo created_at) + auth user của owner đó
- **XÓA** tất cả rows ở 14 bảng whitelist (employees, employee_accounts, expense_categories, expense_templates, expenses, cash_*, shift_*, safe_*, handover_*)
- **DROP** tất cả `legacy_v2._mig_idmap_*` tables (id_maps stale)

KHÔNG đụng: app_settings, integration_clients, profiles, audit_log, sales_*, inventory_*

Sau reset:
```powershell
npm run migrate:apply
npm run migrate:verify
```

---

## Bug history (đã fix trong các script)

Khi chạy với dump v2 thật, phát hiện 3 bugs:

### Bug 1 — `\restrict` / `\unrestrict` không tương thích psql 15
- pg_dump 18.3 emit meta-commands này (security guards search-path, added PG 17)
- psql 15 trong container Supabase không hiểu → abort
- **Fix**: `02-load-staging.mjs` strip 2 commands + `SET transaction_timeout` (Postgres 17+ GUC)

### Bug 2 — CSV auth.users CRLF + trailing empty line
- CSV từ Supabase Dashboard có CRLF endings + trailing newline
- psql COPY FROM stdin báo `unquoted newline found in data`
- **Fix**: `02-load-staging.mjs` normalize BOM/CRLF→LF/drop empty lines

### Bug 3 — id_map cardinality blow-up khi v2 employees có code=NULL + duplicate names
- v2 dump có nhân viên cùng tên (vd: 3× "Nhật Anh") + tất cả `code=NULL`
- ON CONFLICT (code) DO NOTHING không fire (NULL ≠ NULL trong SQL)
- id_map JOIN fallback theo name → 3×3 = 9 rows (lẽ ra 3) → cascading vào shift_assignments → fanout duplicate
- **Fix**: `03a-employees.mjs` generate unique code `'V2-' || substring(le.id::text, 1, 12)` cho mọi v2 employee khi code=NULL; id_map JOIN chỉ qua code (1:1); tất cả id_maps thêm `DISTINCT ON (legacy_id)` defense

---

## Auth user mapping

**Cách script tìm v4 `auth.users.id` cho legacy reference:**

```sql
-- Trong mọi script Stage 3 có cột FK đến auth.users (created_by, counted_by, ...)
(select u4.id from legacy_v2_auth.users lu
   join auth.users u4 on lower(u4.email) = lower(lu.email)
   where lu.id = le.<col> limit 1)
```

**Match không tìm thấy:**
- `employee_accounts`: SKIP row (FK NOT NULL) — log vào `migration/unmapped-users.csv`
- Các bảng transactional khác (`created_by`, `counted_by`...): SET NULL (mất audit của user cũ, giữ data)

**Khắc phục unmapped users sau migration:**
1. Tạo các email thiếu trên v4 qua signup flow
2. Re-run `03a-employees.mjs` — chỉ insert phần thiếu
3. Re-run `03c-expenses.mjs`, `03d-cash.mjs`, `03e-shifts.mjs` — sẽ link lại `created_by` cho rows mới insert (rows cũ vẫn null)

---

## Mapping rules (optional)

Nếu Stage 1 phát hiện nhiều `RENAMED_?` hoặc `TYPE_DIFF` phức tạp → tạo `migration/mapping-rules.json`:
```json
{
  "employees": {
    "column_renames": {"old_name": "new_name"},
    "default_values": {"hourly_rate": 0}
  }
}
```

Hiện tại các script **không tự đọc** file này — bạn cần copy logic vào script tương ứng và rerun.

---

## Troubleshooting

### "Không tìm thấy POSTGRES_PASSWORD"
- Check `supabase/.env` có `POSTGRES_PASSWORD=...`
- Có thể stack chưa init: `docker compose up -d` rồi rerun

### "legacy_v2.X không tồn tại" trong Stage 3
- v2.x không có bảng X (out of scope cho phiên bản đó) — script tự skip
- Hoặc Stage 2 chưa chạy → chạy `npm run migrate:load`

### Stage 3 chạy chậm
- Bảng `legacy_v2.sales_orders` (KiotViet) có thể to nếu user không exclude khi pg_dump
- Script Stage 3 KHÔNG đụng sales — chỉ là dump file lớn → Stage 2 chậm
- Khắc phục: dump v2 với `--exclude-table-data='sales_*'`

### Email không match
- Confirm v4 đã có owner: `select email from auth.users;`
- Email phân biệt hoa thường? Script đã `lower()` cả 2 phía → không phải.
- Whitespace? Check: `select email, length(email) from auth.users;`

### Re-run sau lỗi
- Tất cả script idempotent (`ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`)
- Stage 2 drop staging trước khi tạo lại
- An toàn chạy lại từ đầu

---

## File structure

```
scripts/migrate/
├── _lib/
│   ├── env.mjs           # readEnvValue helper
│   ├── psql.mjs          # docker psql wrapper (exec + query)
│   └── sql-parser.mjs    # regex parser CREATE TABLE (Stage 1)
├── 01-inspect-dump.mjs   # Stage 1
├── 02-load-staging.mjs   # Stage 2
├── 03-run-all.mjs        # Stage 3 orchestrator
├── 03a-employees.mjs
├── 03b-expense-masters.mjs
├── 03c-expenses.mjs
├── 03d-cash.mjs
├── 03e-shifts.mjs
├── 03f-safe.mjs          # Stage 3f — safe_transactions
├── 03g-handover.mjs      # Stage 3g — handover sessions + tasks
├── 03h-cash-events.mjs   # Stage 3h — cash_drawer_events
├── 04-verify.mjs         # Stage 4
└── README.md             # tài liệu này

migration/                 # user-managed, gitignored
├── v2-dump.sql            # input từ user (pg_dump SQL)
├── v2-auth-users.csv      # input từ user (id,email từ Supabase SQL Editor)
├── v2-dump-staged.sql     # generated bởi Stage 2
├── unmapped-users.csv     # generated bởi Stage 3a
└── migration-log-*.json   # generated bởi Stage 3 orchestrator

docs/migration/            # reports
├── v2-dump-inspection.md      # Stage 0
├── v2-to-v4-schema-diff.md    # Stage 1
└── v2-to-v4-verify-report.md  # Stage 4

backup/                    # rollback dumps, gitignored
└── v4-pre-migration-*.sql
```
