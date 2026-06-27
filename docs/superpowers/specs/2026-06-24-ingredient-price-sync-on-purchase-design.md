# Đồng bộ giá nguyên liệu khi nhập từ sổ quỹ + cho dễ tìm

**Ngày:** 2026-06-24
**Loại:** Feature (kết nối giá nhập ↔ giá định giá + UX)
**Trạng thái:** Spec đã duyệt (brainstorm) — chờ chuyển sang chat coding/planning

---

## 1. Context / Vấn đề
Owner "không thấy giá nguyên liệu ở đâu", muốn **giá đồng bộ khi nhập nguyên liệu từ sổ quỹ** và **sửa giá trực tiếp lúc nhập (update giá)**.

Thực tế codebase (đã khảo sát kỹ): phần lớn **đã có sẵn**, thiếu mỗi **tự đồng bộ** + **khó tìm**.

## 2. Hiện trạng (đã xác minh)
**Hai trường giá khác nhau:**
| Trường | Vai trò | Ai dùng |
|---|---|---|
| `ingredients.last_unit_price` `numeric(14,2)` (`database/001_schema.sql:750`) | "giá nhập gần nhất" — chỉ gợi ý auto-fill; **tự ghi đè mỗi lần nhập** (RPC) | không gì dùng ngoài gợi ý |
| `ingredient_reference_prices.unit_price` `bigint` (`database/001_schema.sql:773-778`, RLS **owner-only**) | **giá định giá thật** → tính **"Giá trị kho"** | `src/features/inventory/stock-value.ts` (consumer DUY NHẤT) |

- **Editor giá định giá:** `src/features/inventory/ingredient-price-modal.tsx` (đã có nút "Giá nhập gần nhất — Dùng giá này"); CRUD `src/lib/data/ingredient-prices.ts`; mở từ `src/features/inventory/stock-tab.tsx` bằng **bấm vào giá trên dòng** (owner-only) → khó nhận ra.
- **Modal nhập từ sổ quỹ** `src/features/safe/purchase-inventory-modal.tsx`: mỗi dòng `{ingredientId, qtyStr, priceStr, amountStr}`, ô **"Đơn giá" sửa được** (auto-fill từ `last_unit_price`, 2-way link qty/price/amount). Flow: modal → `useSafePurchaseInventory` → `safePurchaseInventory` → RPC `safe_purchase_inventory` (`p_lines[].unit_price`), server tự tính lại total.
- **RPC** `database/migrations/2026-06-10-purchase-inventory-from-safe.sql`: ghi `safe_transactions` (tổng VND), `stock_movements` (chỉ số lượng, **không có cột giá**), và **ghi đè `ingredients.last_unit_price`** (~line 168). **KHÔNG đụng `ingredient_reference_prices`.**
- ⇒ **Điểm đứt:** nhập xong, giá định giá owner thấy **không đổi** — phải vào modal giá bấm "Dùng giá này" thủ công. Đây là cái cần tự động.
- **Không có** giá vốn/COGS theo món (recipe chỉ trừ kho khi bán). Spec liên quan: `docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md`.

## 3. Thiết kế

### A. Đồng bộ giá khi nhập (phần chính)
- **Modal nhập** (`purchase-inventory-modal.tsx`), mỗi dòng:
  - Hiện **"Giá cũ: {ingredient_reference_prices.unit_price}"** cạnh ô "Đơn giá" (hoặc "chưa có giá") → thấy giá cũ khi gõ giá mới.
  - **Checkbox "Cập nhật giá định giá" — mặc định BẬT** (per-line). Tắt được nếu lần mua giá lạ không muốn đổi định giá.
  - Khi đơn giá nhập **lệch nhiều** so với giá cũ → **tô màu cảnh báo** (vẫn cho nhập). Ngưỡng "lệch nhiều" lấy đơn giản (vd ±20%); tinh chỉnh sau.
- **Submit:** truyền cờ per-line (vd `p_lines[].sync_price boolean default true`) vào RPC. RPC `safe_purchase_inventory`:
  - Với dòng `sync_price=true`: **upsert `ingredient_reference_prices.unit_price = round(unit_price)`** (atomic cùng giao dịch nhập). Trống → set; có → ghi đè.
  - Vẫn ghi `last_unit_price` như cũ (giữ 2 trường, không gộp — ít rủi ro).
  - ⚠️ Kiểu dữ liệu: `unit_price` nhập (numeric) → `ingredient_reference_prices` là **bigint (VND nguyên)** → làm tròn khi upsert.
  - ⚠️ Quyền: `ingredient_reference_prices` RLS owner-only; RPC security-definer ghi được, nhưng **xác nhận**: ai được chạy `safe_purchase_inventory` (owner? owner/manager?) và việc nhập của non-owner có được phép cập nhật giá định giá không. Mặc định: cho phép (nhập là thao tác kho hợp lệ) — chat code verify lại theo RLS/role hiện có.
- **Sửa tay** ở `ingredient-price-modal.tsx` giữ nguyên.

### B. Cho dễ tìm (discoverability)
- Tab Tồn kho đã hiện giá mỗi dòng nhưng phải bấm mới biết sửa → thêm **icon/nhãn "sửa giá"** rõ ràng trên dòng (owner-only như cũ) ở `stock-tab.tsx`.

### C. Backfill (1 lần, idempotent)
- Migration seed `ingredient_reference_prices` từ `ingredients.last_unit_price` cho nguyên liệu **chưa có giá định giá** mà `last_unit_price > 0` → có giá ngay, giảm "chưa có giá". Round → bigint.

### D. Ngoài phạm vi (YAGNI)
- Giá vốn/COGS/lời theo món; lịch sử giá per-purchase (stock_movements vẫn không cột giá); moving-average cost; gộp 2 trường giá thành 1.

## 4. Kiểm thử
- **pgTAP** cho `safe_purchase_inventory` (sửa đổi): `sync_price=true` → upsert `ingredient_reference_prices` đúng (trống→set, có→ghi đè, round bigint); `sync_price=false` → **không** đổi giá định giá; vẫn ghi `last_unit_price` + `stock_movements` + `safe_transactions` như cũ. Dual-write `002_functions.sql` + `verify:mirror`. (Lưu ý tie-break `created_at` nếu fixture nhiều giao dịch chung transaction.)
- **pgTAP/idempotent** cho migration backfill (chạy 2 lần không nhân đôi).
- **Component/Vitest** cho modal: hiện "Giá cũ", checkbox mặc định bật, cảnh báo khi lệch nhiều, truyền `sync_price` đúng.

## 5. Tiêu chí hoàn thành
- [ ] Nhập từ sổ quỹ (dòng bật đồng bộ) → giá định giá (`ingredient_reference_prices`) + "Giá trị kho" cập nhật ngay, không cần thao tác thủ công.
- [ ] Mỗi dòng nhập hiện **giá cũ** + checkbox đồng bộ (mặc định bật) + cảnh báo khi lệch nhiều; tắt checkbox thì giữ giá cũ.
- [ ] Giá nguyên liệu dễ tìm hơn ở tab Tồn kho (affordance "sửa giá").
- [ ] Backfill seed giá cho nguyên liệu đã từng nhập mà chưa có giá.
- [ ] pgTAP + Vitest xanh; không vỡ luồng nhập/định giá hiện có.
