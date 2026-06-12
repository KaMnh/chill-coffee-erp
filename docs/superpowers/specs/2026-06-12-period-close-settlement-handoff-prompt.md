# Prompt bàn giao — Kết toán kỳ (dán vào chat code)

> Copy nguyên khối dưới đây sang chat coding. Spec đầy đủ:
> `docs/superpowers/specs/2026-06-12-period-close-settlement-design.md`

---

Triển khai tính năng **"Kết toán kỳ" (Period Close & Owner Draw)** cho Chill Coffee ERP theo
spec đã chốt: `docs/superpowers/specs/2026-06-12-period-close-settlement-design.md`. **Đọc spec
trước**, rồi lập plan và code. Bắt đầu bằng `/writing-plans` (hoặc lập plan theo chuẩn của bạn),
TDD nếu được.

## Mục tiêu một dòng
Chủ quán kết sổ vào ngày bất kỳ; kỳ = từ lần kết trước → nay; xem thu–chi từng ngày; để lại float;
**rút lợi nhuận (owner's draw) KHÔNG bị tính là chi phí** (lỗi hiện tại của nút "Rút sổ quỹ" F4).

## Bất biến / điều TUYỆT ĐỐI không được sai
1. **`owner_draw` KHÔNG tạo dòng `expenses`.** Đây là điểm sống còn — nhờ vậy lợi nhuận trong
   `cash_flow_overview` / `dashboard_daily_ops` / `analytics.daily_pnl` không bị trừ oan. (Khác F4
   `safe_withdraw_other` — F4 là chi phí thật nên có mirror.)
2. **Owner-only.** Mọi RPC chặn `app_role() <> 'owner'`; bảng `period_closes` RLS owner-read +
   no-direct-write (ghi qua RPC security-definer). Copy đúng khuôn `safe_transactions` trong
   `database/003_rls.sql`.
3. **Số dư quỹ theo `created_at`** (không phải `occurred_at`) — giữ đúng invariant của
   `safe_fund_balance_now` / F4. Chặn rút quá số dư **từng quỹ** (cash, transfer) với
   `pg_advisory_xact_lock`.
4. **Số nguyên VND, chặn âm, chặn ngày tương lai** — bám style `safe_withdraw_other`.

## Quy ước repo phải bám theo (rất quan trọng)
- **Dual-write SQL:** sửa canonical trong `database/001_schema.sql` / `002_functions.sql` /
  `003_rls.sql`, **đồng thời** tạo migration `database/migrations/2026-06-12-period-close-settlement.sql`
  trích **nguyên văn**. DB mới áp `001/002/003` trước `migrations`.
- **Retrofit cột/constraint cho DB cũ:** `create table if not exists` bị skip trên DB có sẵn, nên
  cột mới (`safe_transactions.period_close_id`) và việc thêm `'owner_draw'` vào CHECK constraint
  phải có block `alter ... add column if not exists` + `do $$ ... pg_constraint ... drop/add
  constraint ... $$` idempotent **ngay trong `001`** (theo đúng tiền lệ `safe_transactions_fund_check`
  và `expenses.safe_transaction_id` đã có trong `001_schema.sql`), và lặp lại trong migration.

## Việc cần làm (chi tiết trong spec §3–§7)
- DB: thêm `transaction_type='owner_draw'`; bảng `period_closes`; cột
  `safe_transactions.period_close_id`; RLS owner-only.
- RPC: `period_close_preview`, `finalize_period_close`, `list_period_closes`, `void_period_close`
  (chỉ huỷ lần gần nhất). Preview **tái dùng** `cash_flow_overview(period_start, period_end)` cho
  `by_day` + `expense_breakdown` (đừng lặp logic).
- FE: feature mới `src/features/period-close/` (`period-close-view.tsx`, `period-close-modal.tsx`);
  hooks queries/mutations theo mẫu `use-safe-mutations.ts`; types trong `src/lib/types.ts`; badge
  "Rút lợi nhuận" cho `owner_draw` trong lịch sử quỹ; nav owner-only. Tái dùng `CashFlowChart`,
  `ExpenseBreakdownTable`, `LunarCalendarWidget`, và UX tách quỹ của `withdraw-safe-modal.tsx` +
  `fund-split.ts`.
- Test: pgTAP trong `database/tests/` (mẫu `045_*`, `065_*`, `075_*`); Vitest cho logic float/split
  thuần TS. **Bắt buộc có** regression test: có `owner_draw` thì `cash_flow_overview.net` KHÔNG đổi.

## Môi trường test (local Supabase — KHÔNG phải cloud MCP)
- Query DB local: `docker exec -i supabase-db psql -U postgres -d postgres < file.sql`
  (hoặc `-c "..."`). Tài khoản test: **owner@chill.local**.
- Chạy lại migration/test theo `database/README.md` + `scripts/`.
- ⚠️ **Đừng `npm run build` khi `next dev` (cổng 3009) đang chạy** — sẽ clobber `.next` gây 404
  chunks / kẹt "Đang tải". Nếu cần build: kill 3009, `rm -rf .next`, restart dev.

## Ngoài phạm vi (đừng làm)
Khoá cứng kỳ; quý dương/âm cố định + roll-up; sửa lần kết ở giữa; đa tiền tệ/thuế. (Xem spec §8.)

Khi xong: chạy đủ test DB + Vitest, xác minh nút kết kỳ tạo owner_draw đúng và lợi nhuận không bị
trừ, rồi mở PR theo chuẩn repo.
