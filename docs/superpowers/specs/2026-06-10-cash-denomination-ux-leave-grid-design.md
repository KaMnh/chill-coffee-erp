# Spec — Đếm tiền UX + Lưới "để lại ngày mai" (F5 + F6)

**Date:** 2026-06-10
**Feature cluster:** A — Két / Chốt két (cash)
**Status:** Design đã chốt với user. Sẵn sàng sang writing-plans.

Gộp 2 tính năng vào 1 spec vì cùng động tới lưới đếm tiền (`DenominationGrid`):
- **F5** — Hành vi ô nhập: ô có giá trị → bôi đen khi focus; ô = 0 → rỗng hoàn toàn.
- **F6** — Ô "để lại ngày mai" → lưới mệnh giá + nút "Copy từ đếm thực".

## Phạm vi & file đụng tới

| Mục | File | Loại sửa |
|-----|------|----------|
| F5 | `src/features/cash/denomination-grid.tsx` | Sửa `<input>` của lưới mệnh giá dùng chung |
| F6 | `src/features/cash/cash-view.tsx` | Đổi state + UI ô "để lại" thành lưới mệnh giá |

**KHÔNG đụng:** `EditCashCloseModal`, `LeaveDenominationPopup` (luồng sửa sau khi chốt,
tách biệt), backend/RPC (`use-cash-mutations`), DB. **Không migration.**

## F5 — Hành vi ô nhập (DenominationGrid)

Sửa thẻ `<input>` trong [denomination-grid.tsx](../../src/features/cash/denomination-grid.tsx)
(hiện ~dòng 93–115):

1. **Ẩn 0 → rỗng hoàn toàn**: `value={count}` → `value={count === 0 ? "" : count}`.
   **Không** thêm placeholder. Ô count = 0 hiển thị trống.
2. **Bôi đen khi focus**: thêm `onFocus={(e) => e.currentTarget.select()}`. Click / tab /
   mũi tên vào ô có số đều tự chọn toàn bộ → gõ là ghi đè, không cần xóa tay.
3. `normalizeCount` giữ nguyên: gõ vào ô rỗng ra số đúng; xóa hết → 0 → hiện rỗng;
   `setCount("")` → `normalizeCount("")` → 0.
4. `.select()` cũ trong `focusDenominationInput` ([denominations.ts](../../src/features/cash/denominations.ts))
   trở nên dư thừa nhưng vô hại → **giữ nguyên** (surgical, không xóa code có sẵn).

**Tác động lan toả (có chủ đích):** mọi consumer của `DenominationGrid` (đếm chính,
`OpeningCashModal`, `EditCashCountModal`, `LeaveDenominationPopup`, và lưới để lại mới)
đều hưởng UX này → đồng nhất.

## F6 — Lưới mệnh giá "để lại ngày mai" (cash-view)

Trong [cash-view.tsx](../../src/features/cash/cash-view.tsx):

1. **State**: `const [leaveForNextDay, setLeaveForNextDay] = useState("")` (dòng 65)
   → `const [leaveCounts, setLeaveCounts] = useState<Record<string, number>>({})`.
2. **Tính tổng**: `const leaveAmount = moneyFromInput(leaveForNextDay)` (dòng 120)
   → `const leaveAmount = computeDenominationTotal(leaveCounts)` (đã import sẵn dòng 31).
3. `safeDepositPreview = Math.max(0, physical - leaveAmount)` — **không đổi**.
4. **Validity**: thêm `const leaveValid = isLeaveAmountValid(leaveAmount, physical)`
   (import `isLeaveAmountValid` từ `./cash-math`).
5. **UI** — thay khối `TextField` "Để lại cho ngày mai" (dòng 299–309) bằng một section:
   - Nhãn "Để lại cho ngày mai".
   - Nút **"Copy từ đếm thực"** → `onClick={() => setLeaveCounts({ ...counts })}`;
     `disabled={isBusy || physical === 0}`. Không cần toast (thay đổi nhìn thấy ngay).
   - `<DenominationGrid value={leaveCounts} onChange={setLeaveCounts}
     showQuickAdd={false} disabled={isBusy} totalLabel="Tổng để lại" />`.
   - Giữ helper "Sổ quỹ sẽ nhận {formatVND(safeDepositPreview)}".
   - `AlertBanner variant="danger"` khi `!leaveValid` ("Để lại vượt đếm thực").
6. **Guard chốt**: nút "Chốt két & tạo báo cáo" thêm điều kiện disable `|| !leaveValid`
   (giữ `physical === 0` sẵn có). "Kiểm két nhanh" không đổi (không dùng leave).
7. **Reset sau shift_close**: `setLeaveForNextDay("")` (dòng 182) → `setLeaveCounts({})`.
8. **Gọi finalize**: `leave_for_next_day: leaveAmount` (dòng 166) — **không đổi**
   (leaveAmount giờ tính từ lưới).

## Dữ liệu / backend

Không thay đổi. `leave_for_next_day` vẫn là **số tổng** truyền vào RPC `finalizeCashClose`.
Breakdown mệnh giá của phần để lại **không lưu** — lưới chỉ là công cụ nhập (giống hành
vi hiện tại với ô số).

## Testing & verify

Không phát sinh logic thuần mới (tái dùng `computeDenominationTotal`, `isLeaveAmountValid`
— đã có test Vitest trong `cash/__tests__/cash-math.test.ts`) → **không cần unit test mới**.

`npx tsc --noEmit` phải sạch (đổi kiểu state leave).

**Verify thủ công:**
1. Lưới đếm: ô rỗng hiển thị trống (không "0"); gõ ra số; focus ô có số → bôi đen →
   gõ ghi đè; điều hướng mũi tên Up/Down/Left/Right vẫn chạy.
2. "Copy từ đếm thực": lưới để lại khớp số tờ đã đếm; "Tổng để lại" = đếm thực; bớt 1 tờ
   → "Sổ quỹ sẽ nhận" tăng đúng phần chênh.
3. Chốt két: số để lại + safe_deposit đúng như trước khi sửa; lưới để lại reset sau chốt.
4. ⚠️ Không chạy `npm run build` khi `next dev` (3009) đang chạy (clobber `.next`).

## Ngoài phạm vi (YAGNI)

- Không lưu breakdown mệnh giá phần để lại.
- Không đụng `EditCashCloseModal` / `LeaveDenominationPopup`.
- Không thêm placeholder, không thêm toast cho nút copy.
- Không đổi backend/RPC/DB.

## Thứ tự triển khai

1. F5 (`denomination-grid.tsx`) → verify lưới đếm chính trước.
2. F6 (`cash-view.tsx`) → lưới để lại tự thừa hưởng UX F5.
3. `tsc --noEmit` + verify thủ công theo checklist.
