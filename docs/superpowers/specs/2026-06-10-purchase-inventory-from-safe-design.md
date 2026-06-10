# Spec — Rút quỹ nhập nguyên liệu → kho (F1 + F2)

**Date:** 2026-06-10
**Feature cluster:** B — Rút sổ quỹ → kho
**Status:** Design đã chốt với user. Brainstorm-only — KHÔNG lập plan/code ở chat này.
**Phụ thuộc:** F4 (cơ sở "số dư hiện tại = giao dịch ghi gần nhất") để back-date mua hàng
giảm số dư đúng. Nên làm sau F4.

## Mục tiêu

Một thao tác **rút sổ quỹ dạng "nhập nguyên liệu"**: nhập nhiều dòng hàng mua → vừa **trừ
tiền sổ quỹ** vừa **đẩy tồn vào kho**, trong **một giao dịch atomic**. F2 = quy đổi
**2 chiều** Số lượng ↔ Thành tiền theo đơn giá, ngay trong từng dòng.

## Quyết định đã chốt

- Form **nhiều dòng**: mỗi dòng `{nguyên liệu, số lượng, đơn giá, thành tiền}`.
- **F2 quy đổi 2 chiều:** `thành tiền = SL × đơn giá`; sửa thành tiền → `SL = thành tiền / đơn giá`
  (khi đơn giá > 0). Đi được cả 2 hướng.
- **Tổng = Σ thành tiền = số tiền rút sổ quỹ.**
- **Nhớ đơn giá:** thêm `ingredients.last_unit_price`; auto-fill lần sau, ghi đè sau mỗi lần mua.
- **Modal riêng** `purchase-inventory-modal.tsx`, mở từ màn Sổ quỹ.
- **Tạo nguyên liệu mới ngay trong form** (tái dùng `IngredientFormModal`).
- **KHÔNG** upload hóa đơn ở bước này (có thể thêm sau).
- **KHÔNG** lưu lịch sử giá vốn từng lần (chỉ `last_unit_price` mới nhất trên ingredient).

## Bối cảnh kỹ thuật (đã verify)

- `ingredients` (001_schema.sql:626) chưa có giá → thêm cột (mẫu `expense_templates.last_unit_price`, 001:100).
- `stock_movements` (001:688): `purchase_received` ⇒ `quantity_delta > 0` (CHECK
  `stock_movements_sign_matches_reason`), có `occurred_at default now()`, KHÔNG có trường tiền.
- Tạo nguyên liệu: RPC `create_ingredient(p_name, p_unit, p_low_stock_threshold, p_notes)`
  → id; hook `useCreateIngredient`; đơn vị từ `STOCK_UNITS`/`STOCK_UNIT_LABELS_VI`.
- Số dư sổ quỹ: `safe_balance_now()` (xem F4 — đổi sang cơ sở ghi-sổ).

## Phạm vi & file đụng tới

| Tầng | File | Loại sửa |
|------|------|----------|
| Schema | `database/001_schema.sql` | +`ingredients.last_unit_price numeric(14,2) not null default 0` |
| RPC | `database/002_functions.sql` | RPC mới `safe_purchase_inventory` + grant; `list_ingredients` trả thêm `last_unit_price` |
| RLS | `database/003_rls.sql` | grant execute RPC mới (nếu pattern yêu cầu) |
| Type | `src/lib/types.ts` | `Ingredient.last_unit_price: number` |
| Helper | `src/features/inventory/purchase-math.ts` (mới) | `lineAmount`, `deriveQuantity`, `purchaseTotal` thuần |
| Test (unit) | `.../inventory/__tests__/purchase-math.test.ts` | Vitest cho helper |
| Data | `src/lib/data/safe.ts` | `safePurchaseInventory(...)` gọi RPC; map `last_unit_price` ở `listIngredients` (`inventory.ts`) |
| Mutation | `src/hooks/mutations/use-safe-mutations.ts` | `useSafePurchaseInventory` |
| Modal | `src/features/safe/purchase-inventory-modal.tsx` (mới) | form nhiều dòng |
| Wiring | `src/features/safe/safe-view.tsx` | +nút "Nhập nguyên liệu", load ingredients, nested `IngredientFormModal` |
| Test (pgTAP) | `database/tests/` | RPC mới: atomic, balance, sign, last_unit_price |

## Chi tiết

### 1. Pure helper `purchase-math.ts`
```ts
/** Thành tiền một dòng = SL × đơn giá. */
export function lineAmount(quantity: number, unitPrice: number): number {
  return (Number(quantity) || 0) * (Number(unitPrice) || 0);
}
/** Quy đổi ngược: SL = thành tiền / đơn giá (đơn giá ≤ 0 → 0). */
export function deriveQuantity(amount: number, unitPrice: number): number {
  const p = Number(unitPrice) || 0;
  return p > 0 ? (Number(amount) || 0) / p : 0;
}
/** Tổng = Σ thành tiền. */
export function purchaseTotal(lines: ReadonlyArray<{ quantity: number; unitPrice: number }>): number {
  return lines.reduce((s, l) => s + lineAmount(l.quantity, l.unitPrice), 0);
}
```
+ Vitest: `lineAmount(2, 100_000)=200_000`; `deriveQuantity(200_000, 100_000)=2`;
`deriveQuantity(x, 0)=0`; `purchaseTotal([...])` cộng đúng.

### 2. Modal `purchase-inventory-modal.tsx`
- **Ô ngày** (mặc định hôm nay) — áp cho cả giao dịch quỹ lẫn `occurred_at` mọi dòng nhập kho.
- **Danh sách dòng** (thêm/xóa, ≥1 dòng), mỗi dòng:
  - `Nguyên liệu` (Select từ ingredients) + mục **"+ Tạo nguyên liệu mới"** → mở nested
    `IngredientFormModal` (create mode); on success refetch ingredients + auto-chọn vào dòng đó.
  - `Số lượng`, `Đơn giá` (auto-fill `last_unit_price`, sửa được), `Thành tiền`.
  - Logic 2 chiều: sửa SL hoặc đơn giá → tính lại thành tiền; sửa thành tiền → `deriveQuantity`.
- **Tổng = `purchaseTotal`**; hiển thị + chặn submit nếu `Tổng > số dư` hoặc `Tổng ≤ 0` hoặc có dòng SL≤0.
- Submit → `useSafePurchaseInventory`. Toast thành công, đóng modal.
- Reset state khi mở.

### 3. RPC atomic `safe_purchase_inventory` (`002_functions.sql`)
Chữ ký gợi ý: `(p_occurred_at timestamptz, p_lines jsonb, p_description text default null)`
với mỗi line `{ ingredient_id uuid, quantity numeric, unit_price numeric }`.

Trong 1 transaction (plpgsql security definer):
1. `app_role() = 'owner'` (đồng bộ `safe_withdraw_other`); ≥1 line; mỗi line SL>0, đơn giá≥0;
   ingredient tồn tại & active.
2. `v_total := Σ(quantity*unit_price)` (tính server-side, không tin client). `v_total > 0`.
3. Lấy `v_balance := safe_balance_now()`; `v_next := v_balance - v_total`; nếu `< 0` → raise
   "Sổ quỹ không đủ".
4. Insert `safe_transactions`: `withdraw_other`, `reason_category='inventory'`, `amount=-v_total`,
   `balance_after=v_next`, `occurred_at=coalesce(p_occurred_at, now())`, `description`.
5. Mỗi line: insert `stock_movements` (`purchase_received`, `+quantity`, `occurred_at=p_occurred_at`,
   `notes` tham chiếu giao dịch) **và** `update ingredients set last_unit_price = unit_price where id = ingredient_id`.
6. Return `jsonb_build_object('transaction_id', ..., 'balance_after', v_next, 'movement_ids', ...)`.

Lưu ý: nguyên liệu mới đã được tạo TRƯỚC qua `create_ingredient` (client) → RPC chỉ làm việc
với `ingredient_id` đã tồn tại. Nếu purchase fail, nguyên liệu mới là orphan vô hại (tồn 0).

### 4. `list_ingredients` + type + data
- RPC `list_ingredients` trả thêm `last_unit_price` → `Ingredient.last_unit_price: number` →
  `listIngredients` (data) map field → modal auto-fill đơn giá.

## Liên kết quỹ ↔ kho

Loose link (YAGNI): RPC tạo cả hai cùng lúc; `safe_transactions.description` tóm tắt nội dung
mua; `stock_movements.notes` tham chiếu (vd "Nhập mua — rút sổ quỹ <date>"). Không thêm FK/bảng header.

## Testing & verify

- **Vitest:** `purchase-math` (xanh).
- **pgTAP** `safe_purchase_inventory`:
  - 2 dòng → 1 safe_transaction (đúng `-total`, balance_after) + 2 stock_movements (+SL) + `last_unit_price` cập nhật.
  - Tổng > số dư → raise, KHÔNG ghi gì (atomic rollback).
  - SL ≤ 0 / line rỗng → raise.
  - Non-owner → raise.
- `npx tsc --noEmit` sạch.
- **Verify thủ công:**
  1. Mở từ Sổ quỹ → 2 dòng (cà phê 2kg×100k, sữa 10×25k) → Tổng 450k; submit → số dư −450k;
     Kho: cà phê +2, sữa +10; mở lại thấy đơn giá auto-fill 100k/25k.
  2. Sửa "Thành tiền" 1 dòng → SL tự đổi (đơn giá giữ nguyên).
  3. "+ Tạo nguyên liệu mới" → tạo xong tự chọn vào dòng.
  4. Tổng > số dư → nút submit bị chặn.
  5. ⚠️ Không chạy `npm run build` khi `next dev` (3009) đang chạy.

## Ngoài phạm vi (YAGNI)

- Upload hóa đơn (có thể thêm sau, tái dùng `SafeAttachmentUpload`).
- Lịch sử giá vốn từng lần (unit_cost trên movement).
- Sửa/hoàn lại một lần nhập (void) — nếu cần, thiết kế riêng.
- FK/bảng header liên kết quỹ ↔ kho.

## ⚠️ Addendum — tách quỹ (mô hình 2 quỹ)

Sau khi viết spec này, user chốt [Sổ quỹ 2 phần (tiền mặt + chuyển khoản)](2026-06-10-safe-two-funds-cash-transfer-design.md).
Vì vậy thanh toán lần nhập có thể **tách**: form thêm 2 ô "Trả từ CK" + "Trả từ tiền mặt"
(cộng = Tổng = Σ thành tiền), mặc định CK trước / tiền mặt bù (dùng `defaultFundSplit`). RPC
`safe_purchase_inventory` nhận thêm `p_cash_amount` + `p_transfer_amount`, insert 1–2 row safe
theo fund (thay cho 1 row `withdraw_other` cash thuần). Stock movements + `last_unit_price`
giữ nguyên. Làm sau khi mô hình 2 quỹ đã có nền.
