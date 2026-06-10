# Spec — Rút sổ quỹ chỉnh được ngày (F4)

**Date:** 2026-06-10
**Feature cluster:** B — Rút sổ quỹ → kho
**Status:** Design đã chốt với user. Brainstorm-only — KHÔNG lập plan/code ở chat này.
**Nền tảng cho:** F1 (nhập nguyên liệu → kho) sẽ tái dùng trường ngày này.

## Vấn đề

Form **"Rút mục đích khác"** (`WithdrawSafeModal` → RPC `safe_withdraw_other`) luôn ghi
giao dịch ở thời điểm `now()`. User cần **chỉnh được ngày** (vd ghi muộn khoản chi đã
xảy ra hôm qua).

## Bối cảnh kỹ thuật (đã verify trong code)

- `safe_transactions` đã có sẵn `occurred_at timestamptz` (thời điểm xảy ra) tách biệt
  `created_at` (lúc ghi). Hiện cả hai = `now()` cho mọi row (insert không set occurred_at
  → default `now()`).
- Sổ quỹ là **running-balance**: `safe_balance_now()` và các RPC rút/điều chỉnh lấy số dư
  bằng `order by occurred_at desc, id desc limit 1` → `balance_after` của giao dịch có
  `occurred_at` mới nhất.
- ⚠️ **Bug nếu back-date ngây thơ:** giao dịch ngày quá khứ không phải "mới nhất theo
  occurred_at" → `safe_balance_now()` bỏ qua nó → khoản rút biến mất khỏi số dư hiện tại.

## Quyết định (Option A — số dư giảm ngay)

Tiền mặt *đã ra khỏi két* khi ghi nhận → **số dư hiện tại giảm ngay**; `occurred_at` chỉ
là **nhãn ngày** cho lịch sử/báo cáo. Để đúng, đổi cơ sở "số dư hiện tại":

> **Invariant mới:** Số dư hiện tại = `balance_after` của giao dịch được **GHI gần nhất**
> (`created_at`), KHÔNG phải `occurred_at` mới nhất.

Vì occurred_at hiện = created_at cho mọi row cũ → đổi cơ sở thứ tự **không đổi hành vi dữ
liệu hiện có**; chỉ các row back-date mới sau này mới khác.

## Phạm vi & file đụng tới

| Tầng | File | Loại sửa |
|------|------|----------|
| DB/RPC | `database/002_functions.sql` | `safe_withdraw_other` +param ngày; đổi cơ sở số dư |
| Data | `src/lib/data/safe.ts` | `withdrawSafeOther` truyền `p_occurred_at` |
| Mutation | `src/hooks/mutations/use-safe-mutations.ts` | `WithdrawSafeOtherInput` +`occurredAt` |
| Modal | `src/features/safe/withdraw-safe-modal.tsx` | thêm ô chọn ngày |
| (tùy) Validation | `src/lib/validation.ts` | chặn ngày tương lai |
| Test | `database/tests/070_*` / `080_*` | cập nhật nếu assert thứ tự số dư |

**KHÔNG đụng:** sửa ngày cho giao dịch đã tạo (tách riêng); các loại giao dịch khác
(`deposit_close`/`withdraw_open`/`adjustment`) — chỉ chạm cơ sở số dư chung, không thêm UI ngày.

## Chi tiết

### 1. RPC `safe_withdraw_other` (`002_functions.sql`)
- Thêm param `p_occurred_at timestamptz default now()` (cuối danh sách, có default → tương
  thích ngược; nhớ `drop function` signature cũ trước `create` vì đổi chữ ký — xem note
  ambiguity ở finalize làm mẫu, dòng ~2218).
- Insert set `occurred_at = coalesce(p_occurred_at, now())`.
- Đổi lookup số dư: `order by occurred_at desc, id desc` → **`order by created_at desc, id desc`**
  (giữ `for update` để chống race). `v_next := v_balance - p_amount`; vẫn chặn `v_next < 0`.
- Cập nhật `grant execute` cho chữ ký mới.

### 2. Đồng bộ cơ sở số dư (cùng file)
Đổi sang `created_at desc, id desc` ở các nơi đọc "số dư mới nhất" để nhất quán:
- `safe_balance_now()` (dòng ~1725).
- `safe_adjust` lookup (dòng ~1851).
- (Kiểm tra `safe_count` nếu nó đọc số dư trực tiếp; nếu gọi `safe_balance_now()` thì tự
  hưởng sửa.)
- `finalize` dùng `safe_balance_now()` → tự hưởng, không sửa riêng.

### 3. Data layer `withdrawSafeOther` (`safe.ts`)
- Payload thêm `occurredAt?: string` (ISO). Gọi RPC kèm `p_occurred_at: payload.occurredAt ?? null`.

### 4. Mutation `useWithdrawSafeOther`
- `WithdrawSafeOtherInput` thêm `occurredAt?: string`; truyền xuống `withdrawSafeOther`.

### 5. Modal `withdraw-safe-modal.tsx`
- State `occurredDate` (mặc định hôm nay, `YYYY-MM-DD`). Thêm ô chọn ngày (input ngày
  native hoặc component sẵn có) trong form Phase A, cạnh "Số tiền rút".
- Khi submit: gửi `occurredAt` = **ngày chọn + giờ hiện tại** dạng ISO (ghép giờ hiện tại
  để tránh lệch ngày do timezone Asia/Ho_Chi_Minh khi cast timestamptz).
- Reset `occurredDate` về hôm nay khi mở modal.

### 6. (Tùy chọn) Validation
- `validateSafeWithdraw` thêm: `occurredAt` không vượt quá hôm nay (chặn ngày tương lai).
  Cho phép quá khứ. Nếu thêm, báo lỗi trên ô ngày.

## Hành vi & cosmetic đã biết

- Lịch sử (`safe_list_transactions` order/filter theo `occurred_at::date`) → giao dịch
  back-date hiện đúng dưới ngày đã chọn. ✓
- Cosmetic chấp nhận: `balance_after` của một row back-date phản ánh số dư *lúc ghi*, nên
  có thể không tăng/giảm đều theo ngày khi đứng cạnh các row khác trong lịch sử. Đúng theo
  quyết định "số dư giảm ngay".

## Testing & verify

- pgTAP: cập nhật test số dư/RLS safe nếu assert thứ tự `occurred_at`; thêm test back-date:
  rút ngày quá khứ → `safe_balance_now()` vẫn giảm đúng.
- `npx tsc --noEmit` sạch (đổi kiểu payload/input).
- **Verify thủ công:**
  1. Rút 100k, ngày = hôm nay → số dư giảm 100k, lịch sử hiện hôm nay.
  2. Rút 50k, ngày = hôm qua → **số dư giảm thêm 50k ngay**; lịch sử hiện khoản đó dưới
     ngày hôm qua.
  3. Đổi ngày sang tương lai (nếu bật validation) → bị chặn.
  4. ⚠️ Không chạy `npm run build` khi `next dev` (3009) đang chạy.

## Ngoài phạm vi (YAGNI)

- Không sửa ngày giao dịch đã tạo.
- Không recompute ledger theo dòng thời gian (đã loại — quá phức tạp).
- Không thêm ô ngày cho nạp chốt két / rút mở két / điều chỉnh.

## ⚠️ Addendum — gộp với mô hình 2 quỹ

Sau khi viết spec này, user chốt [Sổ quỹ 2 phần (tiền mặt + chuyển khoản)](2026-06-10-safe-two-funds-cash-transfer-design.md).
`safe_withdraw_other` vì vậy **gộp luôn**: ngoài `p_occurred_at` (spec này), còn nhận
`p_cash_amount` + `p_transfer_amount` (tách quỹ) và insert 1–2 row theo fund. Cơ sở "số dư
ghi gần nhất" của spec này áp dụng **per-fund**. Triển khai F4 + tách quỹ trong cùng đợt sửa
`safe_withdraw_other` / `withdraw-safe-modal`.
