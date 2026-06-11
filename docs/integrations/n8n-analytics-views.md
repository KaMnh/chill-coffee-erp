# Hợp đồng dữ liệu — Analytics views cho n8n

**Ngày:** 2026-06-11 · **Schema:** `analytics` (4 view đọc-only) · **Consumer:** n8n PULL qua PostgREST.

## Cách gọi (REST qua Kong)

```
GET {SUPABASE_URL}/rest/v1/<view>?<filter>
Headers:
  apikey: <SERVICE_ROLE_KEY>
  Authorization: Bearer <SERVICE_ROLE_KEY>
  Accept-Profile: analytics        ← BẮT BUỘC (schema không phải public)
```

Ví dụ — P&L 30 ngày gần nhất:

```
GET /rest/v1/daily_pnl?business_date=gte.2026-06-01&business_date=lte.2026-06-30&order=business_date.desc
```

Chỉ `service_role` đọc được; anon/authenticated bị `permission denied` (42501). n8n node
HTTP Request (không phải node Supabase mặc định — node đó không gửi Accept-Profile).

## 1. `analytics.daily_pnl` — Lợi nhuận cash-basis theo ngày

| Cột | Ý nghĩa |
|---|---|
| `business_date` | Ngày kinh doanh (khóa lọc) |
| `revenue` | Σ `sales_orders.net_amount` (không lọc status — khớp `cash_flow_overview`) |
| `revenue_cash` / `revenue_transfer` | Cơ cấu thu theo `sales_payments.payment_method` (`cash` / `bank_transfer`) |
| `expenses_total` | Σ chi két quầy — **đã loại** expense mirror của rút quỹ (`safe_transaction_id is null`) |
| `safe_outflow_operating` | Σ rút quỹ `withdraw_other` (gồm mua nguyên liệu), số dương |
| `payroll_total` | Σ `shift_payroll_records.total_pay` |
| `net_profit_cash` | `revenue − expenses_total − safe_outflow_operating − payroll_total` |

Bucket ngày của rút quỹ theo `occurred_at` (nhãn ngày user chọn — rút **back-date** sẽ vào
P&L của ngày nhãn, không phải ngày bấm nút).

## 2. `analytics.daily_cashflow` — Dòng tiền vào/ra theo ngày

| Cột | Ý nghĩa |
|---|---|
| `cash_in_pos` / `transfer_in` | Thu tiền mặt / CK từ bán hàng (`sales_payments`) |
| `expense_out` | Chi két quầy (đã loại mirror) |
| `payroll_out` | Chi lương |
| `safe_withdraw_inventory` | Rút quỹ mua nguyên liệu (`reason_category='inventory'`) |
| `safe_withdraw_other_ops` | Rút quỹ vận hành khác (thuê, điện nước, bảo trì, khác) |
| `total_in` / `total_out` / `net_cashflow` | Tổng vào / ra / ròng |

**Loại khỏi cashflow** (luân chuyển nội bộ, không phải dòng tiền với bên ngoài):
`deposit_close` (két→quỹ), `withdraw_open` (quỹ→két), `adjustment` (hiệu chỉnh + bù trừ
void), `initial_setup` (vốn ban đầu).

## 3. `analytics.cash_position` — Vị thế tiền cuối ngày

| Cột | Ý nghĩa |
|---|---|
| `drawer_leave` | `leave_for_next_day` của báo cáo chốt két `final` (voided/draft bị loại) |
| `safe_cash_recorded` / `safe_transfer_recorded` | Số dư 2 quỹ cuối ngày **theo sổ cái như-đã-ghi** (cắt `created_at` < 0h hôm sau, giờ VN) |
| `total_position` | Tổng 3 khoản |

⚠️ **Cố ý khác `daily_pnl`:** position cắt theo `created_at` (ngày GHI SỔ). Một lần rút
back-date (ghi hôm nay, nhãn tuần trước) sẽ: (a) vào `daily_pnl` của ngày nhãn; (b) chỉ làm
giảm `safe_*_recorded` từ ngày GHI SỔ trở đi — **không viết lại lịch sử position**. n8n so
sánh 2 view cần hiểu lệch này là by-design, không phải bug.

## 4. `analytics.cash_variance` — Lệch đếm (tín hiệu rò rỉ)

| Cột | Ý nghĩa |
|---|---|
| `drawer_shift_diff` / `drawer_shift_counts` | Σ lệch + số lần đếm chốt ca |
| `drawer_dayclose_diff` / `drawer_dayclose_counts` | Σ lệch + số lần đếm chốt ngày |
| `drawer_spot_diff` / `drawer_spot_counts` | Σ lệch + số lần đếm đột xuất |
| `safe_diff` / `safe_counts_n` | Σ lệch + số lần đếm sổ quỹ (ngày theo `counted_at` giờ VN) |

Cột `*_diff` để **NULL** khi không có lần đếm nào (NULL = "không đếm" ≠ 0 = "đếm khớp").

## Ops — bật trên prod (1 lần)

1. Sửa `.env` của stack (Dockge): `PGRST_DB_SCHEMAS=public,storage,graphql_public,analytics`
2. `docker compose up -d rest` — **bắt buộc recreate container** (đổi env; `notify pgrst`
   không đủ). Migrator của release chứa migration `2026-06-11-analytics-views.sql` sẽ tự tạo
   schema + view + grant khi `docker compose up -d`.
3. Smoke: `curl -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Accept-Profile: analytics" "$URL/rest/v1/daily_pnl?limit=1"` → HTTP 200.

**Sau khi restore backup:** backup chỉ chứa schema `public` (`pg_dump --schema=public`) —
analytics views bị drop theo CASCADE khi restore. Chạy lại migrator (`docker compose up -d
migrator` hoặc redeploy) để tái tạo. Grants đã được restore route tự re-áp.
