# Spec — Sổ quỹ 2 phần: tiền mặt + chuyển khoản + tổng quỹ (F7 v2)

**Date:** 2026-06-10
**Feature cluster:** B — Sổ quỹ
**Status:** Design đã chốt với user. Brainstorm-only — KHÔNG lập plan/code ở chat này.
**Thay thế:** [F7 reporting-only](2026-06-10-end-of-day-fund-bank-transfer-design.md) (SUPERSEDED).
**Ripple:** F4 và F1 thêm phần "tách quỹ" (xem addendum trong 2 spec đó).
**Quy mô:** Redesign lõi module sổ quỹ — lớn nhất loạt; code nên **phân pha** (xem cuối).

## Mục tiêu

Tách sổ quỹ thành **2 quỹ chạy số dư riêng**: **quỹ tiền mặt** và **quỹ chuyển khoản**, kèm
**tổng quỹ hiện tại = tiền mặt + chuyển khoản**. Mỗi khoản chi có thể **tách một phần tiền
mặt + một phần chuyển khoản** (CK không đủ → tiền mặt bù). Quỹ CK ≈ sổ theo dõi tài khoản ngân hàng.

Cách này thay cho F7 reporting-only và **giải quyết đúng vấn đề gốc** (chuyển khoản vào quỹ
riêng, KHÔNG làm số dư tiền mặt / đếm két lệch).

## Mô hình ledger

- `safe_transactions` thêm cột **`fund text not null default 'cash' check (fund in ('cash','transfer'))`**.
  Mọi row hiện có → `cash` (default).
- Mỗi row tác động **đúng 1 quỹ**; `balance_after` = số dư **quỹ đó** sau row.
- Số dư một quỹ = `balance_after` của row **ghi gần nhất** (`created_at desc, id desc`) của quỹ đó
  — đồng bộ cơ sở số dư của [F4](2026-06-10-safe-withdraw-adjustable-date-design.md).
- **Tổng quỹ = số dư cash + số dư transfer.**

## Dòng tiền theo loại giao dịch

| Giao dịch | Quỹ | Ghi chú |
|-----------|-----|---------|
| **Setup** | cash + transfer | Nhập **2** số dư mở đầu → tối đa 2 row `initial_setup` |
| **Chốt két** `deposit_close` | cash ← (physical−để lại); transfer ← `bank_transfer_confirmed` | 2 row khi mỗi phần > 0 |
| **Rút khác** (F4) | cash + transfer (tách) | 1–2 row tuỳ phân bổ |
| **Nhập NL** (F1) | cash + transfer (tách) | 1–2 row safe + N stock movements |
| **Rút mở két** `withdraw_open` | cash | lấy tiền mặt ra quầy |
| **Đếm sổ quỹ** `count` | cash | CK không đếm tay |
| **Điều chỉnh** `adjust` | chọn 1 quỹ | per-fund |

## UX tách quỹ (dùng chung cho F4 rút khác + F1 nhập NL)

- Form hiển thị **Tổng** cần chi (F4: số tiền nhập; F1: Σ thành tiền các dòng).
- 2 ô: **"Trả từ chuyển khoản"** + **"Trả từ tiền mặt"** (cộng = Tổng).
- **Mặc định thông minh:** `transfer = min(Tổng, số dư CK)`, `cash = Tổng − transfer` (CK trước,
  tiền mặt bù phần thiếu). Cả 2 ô **sửa được**.
- Validate: `cash ≤ số dư cash`, `transfer ≤ số dư transfer`, `cash + transfer = Tổng`.
  Nếu `số dư cash + số dư transfer < Tổng` → không đủ, chặn submit.
- Pure helper (Vitest): `defaultFundSplit(total, transferBalance) → {cash, transfer}`;
  `isFundSplitValid({cash, transfer}, total, cashBal, transferBal)`.

## Hiển thị

- `SafeBalanceCard`: 3 số — **Quỹ tiền mặt** · **Quỹ chuyển khoản** · **Tổng quỹ hiện tại** (nổi bật).
- `SafeHistorySection` / `SafeTransactionDetailModal`: badge quỹ (Tiền mặt / Chuyển khoản) mỗi dòng.

## Phạm vi & file đụng tới

| Tầng | File | Sửa |
|------|------|-----|
| Schema | `database/001_schema.sql` | +`safe_transactions.fund`; index `(fund, created_at desc)` |
| RPC | `database/002_functions.sql` | xem "Functions" |
| RLS | `database/003_rls.sql` | grant các chữ ký RPC mới |
| Type | `src/lib/types.ts` | `SafeTransaction.fund`; kiểu số dư {cash,transfer,total} |
| Helper | `src/features/safe/fund-split.ts` (mới) + test | `defaultFundSplit`, `isFundSplitValid` |
| Data | `src/lib/data/safe.ts` | setup/withdraw/adjust/count/balances theo fund |
| Query | `src/hooks/queries/*` | `useSafeBalanceQuery` → {cash,transfer,total} |
| Mutation | `src/hooks/mutations/use-safe-mutations.ts` | params fund/split |
| UI | `safe-balance-card`, `safe-view`, `withdraw-safe-modal`, `setup-safe-modal`, `adjust-safe-modal`, `count-safe-modal`, `safe-history-section`, `safe-transaction-detail-modal` | xem trên |
| Test | `database/tests/070_*`, `080_*` + mới | per-fund balance, split, deposit tách |

### Functions (`002_functions.sql`)
- **Số dư:** helper `safe_fund_balance_now(p_fund text)` = balance_after row ghi gần nhất của fund;
  `safe_balances_now()` → `jsonb {cash, transfer, total}` cho UI.
- **`safe_setup_initial`** → `(p_cash numeric, p_transfer numeric, p_note text)`; insert `initial_setup`
  cho mỗi quỹ > 0 với `fund` + `balance_after` tương ứng.
- **`finalize_cash_close_report`** → deposit_close: insert row `fund='cash'` (amount = safe_deposit)
  khi > 0 **và** row `fund='transfer'` (amount = `bank_transfer_confirmed`) khi > 0; `balance_after`
  per-fund.
- **`void_cash_close_report`** → reverse **cả hai** deposit (cash + transfer) qua adjustment ngược per-fund.
- **`edit_cash_close_report`** → đổi `leave` chỉ ảnh hưởng deposit **cash** (transfer giữ nguyên).
- **`safe_withdraw_other`** → `(p_occurred_at, p_cash_amount, p_transfer_amount, p_category, p_description)`;
  validate từng quỹ; insert 1–2 row (`withdraw_other`, fund tương ứng, amount âm). (Gộp với F4.)
- **`safe_purchase_inventory`** (F1) → thêm `p_cash_amount`, `p_transfer_amount` (tổng = Σ dòng);
  insert safe rows per-fund + stock movements + cập nhật `last_unit_price`.
- **`safe_adjust`** → `(p_fund, p_new_balance, p_note)`; điều chỉnh số dư quỹ chỉ định.
- **`safe_count`** → so với số dư **quỹ cash** (`expected_balance = safe_fund_balance_now('cash')`).

## Migration dữ liệu hiện có

- Cột `fund` default `'cash'` → mọi giao dịch cũ thuộc quỹ tiền mặt; quỹ CK = 0 ban đầu.
- Quán đã setup từ trước: nhập số dư CK ban đầu bằng **Điều chỉnh** trên quỹ CK (không cần migration đặc biệt).

## Testing & verify

- **Vitest:** `fund-split` (default split, validate).
- **pgTAP:**
  - Chốt két có CK → 2 row deposit; số dư 2 quỹ + tổng đúng.
  - Rút tách 300k CK + 200k cash → 2 row, 2 quỹ giảm đúng; tổng giảm 500k.
  - CK không đủ → default dồn tiền mặt; vượt cả 2 quỹ → raise, rollback.
  - Void báo cáo → hoàn cả 2 quỹ.
  - `safe_count` so quỹ cash.
- `npx tsc --noEmit` sạch.
- **Verify thủ công:** card hiện 3 số; chốt két đẩy CK vào quỹ CK (đếm két tiền mặt không lệch);
  rút tách 2 nguồn; setup nhập 2 số dư. ⚠️ Không `npm run build` khi `next dev` (3009) chạy.

## Phân pha đề xuất (cho chat code)

1. **Nền:** cột `fund` + `safe_fund_balance_now`/`safe_balances_now` + type + `useSafeBalanceQuery`
   + `SafeBalanceCard` 3 số (mọi giao dịch cũ = cash, transfer = 0).
2. **Nguồn vào CK:** `finalize` tách deposit + `void`/`edit` theo fund + setup 2 số dư.
3. **Chi tách quỹ:** `safe_withdraw_other` (gộp F4) + `safe_adjust`(fund) + `safe_count`(cash) + UI split.
4. **F1:** `safe_purchase_inventory` tách quỹ.

## Ngoài phạm vi (YAGNI)

- Đối soát quỹ CK với sao kê ngân hàng (chỉ là số dư chạy).
- Đếm mệnh giá cho quỹ CK (không áp dụng).
- Nhiều tài khoản ngân hàng (chỉ 1 quỹ CK).
