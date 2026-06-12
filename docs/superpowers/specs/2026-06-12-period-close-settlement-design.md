# Kết toán kỳ (Period Close & Owner Draw) — Design Spec

- **Ngày:** 2026-06-12
- **Trạng thái:** Đã chốt qua brainstorm, sẵn sàng để lập plan + code (ở chat khác).
- **Phương án:** A — Sổ kết kỳ có lưu vết (persisted period close).
- **Phạm vi:** MỘT tính năng "Kết toán kỳ" — kết sổ theo kỳ linh hoạt, neo vào lần kết trước.

---

## 1. Bối cảnh & Vấn đề

Cuối mỗi tháng âm lịch (thực tế: **một ngày bất kỳ**), chủ quán **kết sổ và rút quỹ** — rút phần
**lợi nhuận** tích luỹ về cho cá nhân, để lại một ít **vốn vận hành (float)** cho quán chạy tiếp.

**Vấn đề hiện tại:** Nút **"Rút sổ quỹ" (F4 — `safe_withdraw_other`)** được thiết kế cho
**chi phí kinh doanh** (điện/nước, thuê, nhập hàng, sửa chữa, khác). Mỗi lần rút nó **tự tạo một
dòng `expenses`** (gắn `safe_transaction_id`). Trong `cash_flow_overview`, với vai trò **owner**,
chi phí từ quỹ **được cộng vào "Tổng ra"** → **"Chênh lệch" (≈ lợi nhuận) bị trừ đúng bằng số tiền
rút**. Nghĩa là tiền lãi đã kiếm được, khi rút ra lại bị trừ lần nữa → **sai bản chất kế toán**
(rút lợi nhuận là **owner's draw**, không phải chi phí; không được làm giảm lợi nhuận đã báo cáo).

**Người dùng đã xác nhận (brainstorm):**
- Khoản rút cuối kỳ = **rút lợi nhuận về cho chủ** (owner's draw), KHÔNG phải chi phí.
- Kết sổ vào **ngày bất kỳ**; kỳ báo cáo = **từ lần kết gần nhất → ngày kết này**.
- Có thể **để lại một số vốn cụ thể** (float) cho quán vận hành; rút phần còn lại.
- Cần **báo cáo chi tiết thu–chi từng ngày** trong kỳ để chủ quán xem.
- "Kết toán quý" chỉ là cách gọi loose; thực chất cần **cơ chế kết sổ theo kỳ** (không phải quý cố định).

---

## 2. Khái niệm cốt lõi

### 2.1 Lợi nhuận (P&L) ≠ Tiền rút được (số dư quỹ)
Phải phân biệt và hiển thị **cả hai**:

- **Lợi nhuận kỳ** = `doanh thu − chi phí − lương` (cash-basis, từ `sales_orders` / `expenses` /
  `shift_payroll_records`). Đây là **thước đo hiệu quả**, không phải tiền mặt sẵn có.
- **Số dư quỹ** = `safe_fund_balance_now('cash') + safe_fund_balance_now('transfer')`. Đây mới là
  **tiền thực rút được**.

Khi kết: **rút = số dư quỹ − float để lại**. Báo cáo hiển thị: "Kỳ này lãi **X**, đang giữ **Y**
trong quỹ, rút **Z**, để lại float **F** (= số dư cuối)".

### 2.2 `owner_draw` KHÔNG tạo dòng chi phí (quyết định then chốt)
Khoản rút lợi nhuận chỉ ghi vào `safe_transactions` với `transaction_type = 'owner_draw'`,
**KHÔNG** tạo dòng `expenses` (khác hẳn F4). Hệ quả thiết kế quan trọng:

> Vì **mọi** báo cáo lợi nhuận/chi phí đều chạy từ bảng `expenses`, một `owner_draw` không có
> mirror sẽ **tự động không lọt vào** `cash_flow_overview` / `dashboard_daily_ops` /
> `expense_summary_by_category` / `analytics.daily_pnl`. → Không phải sửa rải rác nhiều RPC, blast
> radius nhỏ, ít rủi ro hồi quy.

Số dư quỹ **vẫn giảm** đúng (tiền mặt rời két) vì đó là một `safe_transactions` row bình thường.

---

## 3. Thay đổi Database

> **Quy ước dual-write của repo:** RPC/schema canonical nằm trong `database/001_schema.sql`,
> `002_functions.sql`, `003_rls.sql`; **đồng thời** tạo một migration trong `database/migrations/`
> trích **nguyên văn** phần thay đổi (cho prod migrator chạy trên DB đã có dữ liệu). DB mới áp
> `001/002/003` TRƯỚC `migrations`, nên cột/constraint mới phải vừa nằm trong `001` (cho DB mới)
> vừa có ALTER idempotent retrofit (cho DB cũ). **Tiền lệ phải bám theo:** cách cột `fund` và
> `expenses.safe_transaction_id` được retrofit trong `001_schema.sql` (block `alter table ... add
> column if not exists` + `do $$ ... pg_constraint ... $$`).

### 3.1 Thêm `transaction_type = 'owner_draw'`
`safe_transactions.transaction_type` hiện check in (`initial_setup`, `deposit_close`,
`withdraw_open`, `withdraw_other`, `adjustment`). **Thêm `owner_draw`.**

- Trong `001_schema.sql`: thêm `'owner_draw'` vào danh sách inline của create-table (cho DB mới).
- Retrofit cho DB cũ (constraint không tự đổi khi `create table if not exists` bị skip): block
  idempotent `do $$ ... drop constraint ... add constraint ... $$` — **theo đúng mẫu**
  `safe_transactions_fund_check` đã có trong `001`. Migration `2026-06-12-...` lặp lại block này.

### 3.2 Bảng mới `public.period_closes`
Snapshot mỗi lần kết kỳ (RLS owner-only; ghi qua RPC security-definer).

```sql
create table if not exists public.period_closes (
  id              uuid primary key default gen_random_uuid(),
  close_date      date not null,                 -- ngày chủ bấm kết
  period_start    date not null,                 -- tự = (close_date lần trước + 1); lần đầu = setup
  period_end      date not null,                 -- = close_date
  -- P&L kỳ
  revenue         numeric(14,2) not null default 0,
  expenses_total  numeric(14,2) not null default 0,   -- expenses where safe_transaction_id is null
  payroll_total   numeric(14,2) not null default 0,
  profit          numeric(14,2) not null default 0,   -- = revenue - expenses_total - payroll_total
  -- Tiền mặt: số dư quỹ TRƯỚC khi rút
  opening_total       numeric(14,2) not null default 0,  -- = closing_total của lần kết trước
  balance_before_cash     numeric(14,2) not null default 0,
  balance_before_transfer numeric(14,2) not null default 0,
  -- Rút (owner draw)
  draw_cash       numeric(14,2) not null default 0,
  draw_transfer   numeric(14,2) not null default 0,
  draw_total      numeric(14,2) not null default 0,
  -- Float để lại = số dư cuối (sau rút)
  closing_cash     numeric(14,2) not null default 0,
  closing_transfer numeric(14,2) not null default 0,
  closing_total    numeric(14,2) not null default 0,   -- = float để lại
  note            text,
  status          text not null default 'final' check (status in ('final','voided')),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);
create index if not exists period_closes_date_idx on public.period_closes(close_date desc);
```

### 3.3 Link owner_draw → kỳ kết
Thêm cột `safe_transactions.period_close_id uuid null references public.period_closes(id) on
delete set null` (mẫu giống `cash_close_report_id`). Mỗi owner_draw của một lần kết trỏ về kỳ đó →
huỷ kỳ thì truy ngược được. (Retrofit trong `001` + migration theo cùng pattern.)

### 3.4 RLS (003_rls.sql)
`period_closes`: **owner-only read**, **no direct write** (ghi qua RPC) — copy đúng khuôn
`safe_transactions` (`for select using app_role()='owner'`; `for insert with check (false)`).

---

## 4. RPCs mới (002_functions.sql + migration)

Tất cả `security definer`, dòng đầu chặn không phải owner (`if public.app_role() <> 'owner' then
raise exception ...`). Số nguyên VND, chặn âm, chặn ngày tương lai — theo đúng style
`safe_withdraw_other`.

### 4.1 `period_close_preview(p_as_of date default current_date) returns jsonb`
Xem trước kỳ hiện tại — **không ghi gì**. Trả:
- `period_start` (= `(select max(close_date) from period_closes where status='final') + 1`; nếu
  chưa có lần kết nào → ngày của `initial_setup` trong `safe_transactions`; fallback cuối: min
  `sales_orders.business_date`), `period_end = p_as_of`.
- `revenue`, `expenses_total`, `payroll_total`, `profit` cho `[period_start, period_end]`.
  (Dùng lại đúng công thức của `cash_flow_overview`: expenses lọc `safe_transaction_id is null`.)
- `balance_cash`, `balance_transfer`, `balance_total` hiện tại (`safe_fund_balance_now`).
- `suggested_draw_total` = `balance_total` (gợi ý rút hết, UI sẽ trừ float).
- `by_day` + `expense_breakdown`: **tái dùng** `cash_flow_overview(period_start, period_end)` cho
  chi tiết thu–chi từng ngày (không lặp lại logic).

### 4.2 `finalize_period_close(p_close_date date, p_draw_cash numeric, p_draw_transfer numeric, p_note text default null) returns jsonb`
Thực hiện kết kỳ:
1. Validate owner; `p_close_date` không ở tương lai; draw ≥ 0, số nguyên VND.
2. `pg_advisory_xact_lock` theo từng quỹ (mẫu F4). Lấy `balance_before_*` = `safe_fund_balance_now`.
   Chặn `draw_cash > balance_before_cash`, `draw_transfer > balance_before_transfer`.
3. Tính `period_start` (như 4.1). Tính `revenue/expenses_total/payroll_total/profit`.
4. Tạo **owner_draw** `safe_transactions` (1 row/quỹ nếu amount > 0; **bỏ qua** quỹ = 0), gắn
   `period_close_id`. **KHÔNG** tạo `expenses`.
5. Insert `period_closes` snapshot (`closing_* = balance_before_* − draw_*`; `draw_total`,
   `closing_total`, `opening_total` = closing_total kỳ trước nếu có).
6. Trả full snapshot + id.

> **Lưu ý ngữ nghĩa số dư:** owner_draw dùng `occurred_at = p_close_date` (nhãn ngày kết), nhưng
> cơ sở tính số dư theo `created_at` — **theo đúng invariant F4** (`safe_fund_balance_now` dựa
> `created_at desc`). Giữ nhất quán để chọn ngày quá khứ không làm "biến mất" số dư.

### 4.3 `list_period_closes() returns jsonb`
Lịch sử các lần kết (owner-only), mới nhất trước, kèm các trường snapshot để hiển thị.

### 4.4 `void_period_close(p_id uuid, p_reason text) returns jsonb` — huỷ lần kết gần nhất
Chỉ cho huỷ **lần kết `final` mới nhất** (đơn giản, tránh phá vỡ chuỗi neo kỳ). Hành vi:
- Set `status='voided'`.
- Tạo `adjustment` (hoặc đảo) trên `safe_transactions` để **hoàn lại** số đã rút vào quỹ — hoặc
  đơn giản hơn: chèn các `safe_transactions` đảo dấu (`+draw_cash`, `+draw_transfer`) link
  `period_close_id`. (Chọn cách nhất quán với cách void của `cash_close_reports` — coi tiền lệ đó.)
- Sau void, kỳ kế tiếp tự neo lại từ lần `final` mới nhất còn lại.

---

## 5. Frontend (`src/features/period-close/`)

Tạo feature folder mới (đừng nhồi vào `safe/`). Tái dùng tối đa component cashflow có sẵn.

- **`period-close-view.tsx`** — màn chính:
  - **Thẻ kỳ đang mở**: "Từ `period_start` đến nay", KPI **Doanh thu / Chi phí / Lương / Lợi
    nhuận**, **Số dư quỹ** (mặt + CK + tổng), nút **"Kết toán kỳ"**. (gọi `period_close_preview`).
  - **Chi tiết thu–chi theo ngày**: tái dùng `CashFlowChart` + `ExpenseBreakdownTable` +
    `LunarCalendarWidget` với range = `[period_start, today]`.
  - **Lịch sử kết kỳ**: list snapshot (`list_period_closes`), mỗi dòng cho mở chi tiết; cho
    **huỷ lần gần nhất**.
- **`period-close-modal.tsx`** — modal kết:
  - Hiển thị số dư quỹ (mặt/CK). Input **"Số vốn để lại (float)"** (tổng, ưu tiên để lại tiền mặt;
    cả 2 ô mặt/CK sửa được như F4). Tự tính **số rút = số dư − float**, tách `draw_cash/transfer`.
  - Ô **ghi chú** (tùy chọn). Nút xác nhận gọi `finalize_period_close`.
  - **Mượn UX tách quỹ của F4** (`withdraw-safe-modal.tsx` + `fund-split.ts`): khi sửa 1 ô, ô kia
    tự bù để tổng khớp.
- **Hooks**: `src/hooks/queries.ts` (preview + list), `src/hooks/mutations/use-period-close-mutations.ts`
  (finalize + void) — theo mẫu `use-safe-mutations.ts`, invalidate query liên quan (safe balances,
  cashflow, period preview/list).
- **Types**: thêm vào `src/lib/types.ts` (`PeriodClosePreview`, `PeriodCloseRecord`, ...).
- **Badge lịch sử quỹ**: trong `safe-history-section.tsx` / `safe-transaction-detail-modal.tsx`,
  thêm nhãn **"Rút lợi nhuận"** cho `owner_draw` (phân biệt với "Chi phí" của `withdraw_other`).
- **Nav**: đăng ký mục mới trong nhóm sidebar phù hợp (xem `src/features/navigation/`), **owner-only**.

---

## 6. Phân tích / n8n (tùy chọn — ghi rõ là optional)

`analytics.daily_pnl` / `daily_cashflow` đã loại expense-mirror (`safe_transaction_id is null`) nên
**owner_draw không có mirror sẽ không lọt vào `expenses_total`** (đúng). Nhưng `safe_outflow_operating
= withdraw_other` hiện gộp mọi rút quỹ vận hành. **Đề xuất** thêm cột riêng `safe_draw_owner` (sum
các `owner_draw`) tách khỏi outflow vận hành, để báo cáo phân tích không trộn rút-lãi vào chi-phí.
*(Có thể làm sau; không chặn bản chính.)*

---

## 7. Testing

- **DB (pgTAP, `database/tests/`)** — thêm file mới, theo mẫu các test safe đã có
  (`045_finalize_two_funds.sql`, `065_void_two_funds.sql`, `075_safe_fund_balances.sql`):
  - `finalize_period_close`: tạo đúng owner_draw 1–2 quỹ, **KHÔNG** tạo `expenses`, snapshot đúng
    (profit = revenue − expenses − payroll; closing = before − draw).
  - Chặn rút quá số dư từng quỹ; chặn không phải owner; chặn ngày tương lai; số nguyên VND.
  - `period_start` tự neo: lần đầu = setup; lần sau = (kết trước + 1).
  - `cash_flow_overview` / `daily_pnl` **không đổi** khi có owner_draw (regression: lợi nhuận
    không bị trừ).
  - `void_period_close`: chỉ huỷ được lần gần nhất; hoàn tiền vào quỹ; neo kỳ tính lại đúng.
  - RLS: non-owner không đọc được `period_closes`.
- **TS (Vitest)** — nếu tách logic tách-quỹ/float ra `*.ts` thuần thì unit test (mẫu
  `fund-split.test.ts`, `cash-math.test.ts`).

---

## 8. Ngoài phạm vi (YAGNI)

- ❌ Khoá cứng kỳ đã kết (immutable lock các expense/sales trong kỳ). Chỉ snapshot + cho void lần
  gần nhất.
- ❌ Quý dương/âm lịch cố định, roll-up nhiều kỳ thành quý/năm.
- ❌ Sửa một lần kết ở giữa lịch sử (chỉ huỷ lần gần nhất rồi làm lại).
- ❌ Đa tiền tệ, thuế, sổ cái kép.

---

## 9. Tóm tắt "các nội dung cần thay đổi" (trả lời trực tiếp câu hỏi gốc)

| # | Nội dung | Thay đổi |
|---|----------|----------|
| 1 | Loại giao dịch quỹ | + `owner_draw` (tách khỏi `withdraw_other` chi phí) |
| 2 | Sổ chi `expenses` | owner_draw **không** tạo dòng chi phí → lợi nhuận không bị trừ oan |
| 3 | Báo cáo dòng tiền | Không phải sửa (vì không có mirror); kỳ-close hiển thị riêng "Lợi nhuận đã rút" |
| 4 | Bảng mới | `period_closes` (snapshot kỳ) + `safe_transactions.period_close_id` |
| 5 | RPC | `period_close_preview`, `finalize_period_close`, `list_period_closes`, `void_period_close` |
| 6 | UI | Feature `period-close/` + badge "Rút lợi nhuận" trong lịch sử quỹ + nav owner-only |
| 7 | Phân tích | (optional) tách `safe_draw_owner` khỏi `safe_outflow_operating` |
