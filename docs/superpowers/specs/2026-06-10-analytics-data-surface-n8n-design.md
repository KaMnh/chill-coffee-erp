# Spec — Mặt dữ liệu phân tích cho n8n (P&L cash-basis + dòng tiền)

**Date:** 2026-06-10
**Feature cluster:** D — Phân tích / Tích hợp n8n
**Status:** Design đã chốt với user. Brainstorm-only — KHÔNG lập plan/code ở chat này.
**Phụ thuộc:** Sổ quỹ 2 phần (dòng tiền/vị thế 2 quỹ). COGS xấp xỉ dựa trên `ingredients.last_unit_price` (F1) — **chỉ dùng cho view hoãn**, xem §COGS.

## Mục tiêu

Cung cấp **mặt dữ liệu analysis-ready** để **n8n PULL** (qua service_role) phân tích **lợi
nhuận** và **điểm yếu dòng tiền**. App tính sẵn các **view tổng hợp**; n8n đọc + trực quan hóa
+ cảnh báo. Không push, không sửa nghiệp vụ hiện có.

## Quyết định đã chốt

- **Cơ chế:** n8n **PULL trực tiếp** từ Supabase bằng **service_role** (khớp tiền lệ
  `safe_attachments` polling). Không có push/webhook ở phiên này.
- **Phân chia:** **app tính sẵn view phân tích**; n8n chỉ đọc.
- **Lợi nhuận = cash basis:** doanh thu − (chi phí + mua NL + lương). **KHÔNG dùng COGS** ở
  P&L → không trùng giá vốn.
- **COGS (xấp xỉ `last_unit_price`)**: **chưa kích hoạt**. Chỉ là lăng kính biên lợi nhuận/món
  để **sau này**. DB đã sẵn sàng (F1) → thêm sau **không cần sửa DB** (xem §COGS).

## Kiến trúc

- Schema riêng **`analytics`** chứa các **view** (đọc-only). Mỗi view có cột `business_date`
  để n8n lọc theo kỳ.
- Quyền: `grant usage on schema analytics to service_role` + `grant select on all tables in
  schema analytics to service_role`. (Tùy chọn cứng hơn: role read-only riêng cho n8n thay vì
  service_role.)
- View là `security definer`-tương đương (đọc bảng nguồn trực tiếp; service_role bypass RLS) —
  KHÔNG đặt role-guard kiểu `app_is_staff_or_above()` (n8n không có JWT user).

## Bộ view (kích hoạt phiên này)

### 1. `analytics.daily_pnl` — Lợi nhuận tiền mặt theo ngày
Mỗi `business_date`:
- `revenue` = Σ `sales_orders.net_amount`.
- `revenue_cash` / `revenue_transfer` = tách theo `sales_payments.payment_method` (cơ cấu thu).
- `expenses_total` = Σ `expenses.amount` (chi từ két quầy).
- `safe_outflow_operating` = Σ `safe_transactions` `withdraw_other` (rút quỹ trả thuê/điện/mua NL).
- `payroll_total` = Σ `shift_payroll_records.total_pay`.
- `net_profit_cash` = `revenue − expenses_total − safe_outflow_operating − payroll_total`.

> ⚠️ Chi phí vận hành chảy qua **2 nguồn rời nhau** (`expenses` ở két quầy + `safe_transactions`
> rút quỹ) → cộng cả hai, KHÔNG trùng. Mua NL (F1) nằm ở `safe_transactions` (category inventory)
> → đã gộp trong `safe_outflow_operating`. Bỏ qua `deposit_close`/`withdraw_open`/`adjustment`
> (luân chuyển nội bộ, không phải chi phí).

### 2. `analytics.daily_cashflow` — Dòng tiền vào/ra theo ngày
Mỗi `business_date`, tách nhóm:
- **Vào:** `pos_cash_in`, `bank_transfer_in` (CK khách trả).
- **Ra:** `expense_cash_out`, `payroll_cash_out`, `safe_withdraw` (theo category), `purchase` (NL).
- `net_cashflow` = Σ vào − Σ ra.
- Nguồn: `cash_drawer_events` (theo `event_type`/`direction`) + `safe_transactions` (2 quỹ).

### 3. `analytics.cash_position` — Vị thế tiền cuối ngày
Mỗi `business_date`:
- `drawer_leave` = `cash_close_reports.leave_for_next_day` (tiền để lại trong két).
- `safe_cash` = số dư quỹ tiền mặt cuối ngày; `safe_transfer` = số dư quỹ CK cuối ngày.
- `total_position` = `drawer_leave + safe_cash + safe_transfer`.
- → n8n dò ngày tụt thấp / xu hướng.

### 4. `analytics.cash_variance` — Rò rỉ / kiểm soát
Mỗi ngày:
- `drawer_difference` = `cash_counts.difference` (lệch két, shift_close).
- `safe_difference` = `safe_counts.difference` (lệch sổ quỹ).
- → tín hiệu thất thoát / kiểm soát yếu.

## COGS (HOÃN — DB đã sẵn sàng)

- **Không tạo** `analytics.product_margin` ở phiên này.
- Khi cần: thêm **view thuần** `analytics.product_margin` (mỗi sản phẩm/kỳ: `qty`, `revenue`,
  `cogs`, `margin`, `margin_pct`) bằng cách nổ `recipes`/`recipe_items` × `ingredients.last_unit_price`
  (F1) trên `sales_order_items`. **Không cần sửa schema** vì `last_unit_price` đã có.
- Chỉ khi muốn COGS **chính xác theo thời điểm bán** mới phát sinh schema mới (snapshot
  `cost_per_unit` lên `stock_movements`) — quyết định sau, ngoài phạm vi.

## Phạm vi & file đụng tới

| Tầng | File | Sửa |
|------|------|-----|
| Schema/View | `database/002_functions.sql` (hoặc file view riêng) | tạo schema `analytics` + 4 view |
| Grant | `database/003_rls.sql` | grant usage/select cho service_role |
| Test | `database/tests/` (pgTAP) | mỗi view: cột đúng, số đúng trên seed |
| (KHÔNG) app UI/data | — | feature thuần DB; app Next.js không đổi |

> Đây là feature **thuần DB** (view + grant). Không đụng frontend, không RPC mutation. n8n là
> consumer duy nhất.

## Testing & verify

- **pgTAP:** seed một ngày có bán/chi/lương/rút quỹ → kiểm `daily_pnl.net_profit_cash`,
  `daily_cashflow.net_cashflow`, `cash_position.total_position`, `cash_variance` đúng.
- Xác nhận đọc được bằng service_role (không cần JWT user); RLS không chặn.
- Không cần `npm test`/`tsc` (không đổi TS) — trừ khi thêm type cho app (không có ở phiên này).

## Tài liệu cho n8n (kèm spec)

Khi code xong, ghi 1 trang "Hợp đồng dữ liệu": tên 4 view + cột + ý nghĩa + ví dụ truy vấn lọc
kỳ, để cấu hình n8n. (Có thể đặt `docs/integrations/n8n-analytics-views.md`.)

## Ngoài phạm vi (YAGNI)

- COGS / `product_margin` (hoãn — xem §COGS).
- Push/webhook sang n8n (đã chọn pull).
- Materialized view / cache (volume nhỏ, view thường đủ).
- Đối soát sao kê ngân hàng; nhiều tài khoản.
- OCR hóa đơn (đã có đường riêng `safe_attachments`).

## Addendum 2026-06-11 — hiệu chỉnh sau validation + adversarial review

1. Cột thật: `safe_transactions.transaction_type` / `reason_category` (spec viết tắt `type`/`category`).
2. **Chống đếm đôi:** `safe_withdraw_other` tự tạo 1 dòng `expenses` mirror (`safe_transaction_id` not null) → `expenses_total`/`expense_out` phải lọc `safe_transaction_id is null` (tiền lệ `2026-05-28-e-rpcs-hide-safe-expenses.sql`).
3. `daily_cashflow` tính từ bảng nghiệp vụ gốc (`sales_payments`, `expenses`, `shift_payroll_records`, `safe_transactions`) — KHÔNG dùng `cash_drawer_events` (live data không ghi outflow events). `deposit_close`/`withdraw_open`/`adjustment`/`initial_setup` loại khỏi cashflow (luân chuyển nội bộ / vốn / bù trừ void).
4. REST: thêm `analytics` vào `PGRST_DB_SCHEMAS` (supabase/.env, supabase/.env.example, deploy/dockge/.env.example + prod .env thủ công). Đổi env phải **restart container `rest`** — `notify pgrst` không đủ. n8n gọi với header `Accept-Profile: analytics`.
5. **Ngữ nghĩa ngày cố ý lệch:** `daily_pnl`/`daily_cashflow` bucket theo `occurred_at` (nhãn ngày user, back-date được); `cash_position` cắt theo `created_at` (chuỗi số dư as-recorded) → cột tên `safe_cash_recorded`/`safe_transfer_recorded`. Rút back-date sẽ vào P&L của ngày nhãn nhưng KHÔNG đổi position lịch sử.
6. `cash_variance`: một ngày có thể nhiều lần đếm cùng loại → Σ difference + count per `count_type`; sum để NULL khi không có lần đếm (0 ≠ không đếm).
7. Doanh thu = Σ `net_amount` không lọc status (khớp `cash_flow_overview`).
8. View `security_invoker=true`; grant chỉ `service_role`, lặp tường minh trong migration. Sau restore backup cần chạy lại migrator nếu dump không chứa schema analytics.
