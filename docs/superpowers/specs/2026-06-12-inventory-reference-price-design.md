# Đơn giá tham chiếu cho tồn kho (owner-only)

**Ngày:** 2026-06-12 · **Trạng thái:** Spec đã duyệt qua brainstorm, chờ plan + implement
**Yêu cầu gốc (owner):** "thêm chức năng đơn giá sản phẩm tồn trong kho"

## Bối cảnh

Tab Kho → Tồn kho (`stock_balances` view) hiện chỉ có tên + số lượng tồn +
cảnh báo sắp hết — không có giá, không biết vốn đang nằm trong kho bao nhiêu.
`ingredients.last_unit_price` (giá NHẬP gần nhất, tự cập nhật khi nhập NL từ
sổ quỹ — F1/F2) đã tồn tại nhưng là giá thực tế của lần mua cuối, không phải
giá owner muốn dùng làm chuẩn định giá tồn.

## 5 quyết định đã chốt (brainstorm 2026-06-12)

1. **Giá nhập tay riêng** — cột giá mới do owner chủ động đặt
   (`reference price`), tách hẳn khỏi `last_unit_price`. KHÔNG đụng flow
   nhập NL hiện tại.
2. **Hiển thị**: tab Tồn kho (đơn giá + giá trị tồn từng dòng + **tổng giá
   trị kho**) **và** card "Tồn kho hiện tại" trên Bảng vận hành.
3. **Quyền: chỉ owner** — sửa VÀ thấy. Manager/staff nhìn tồn kho y như
   hiện tại (không giá, không tổng).
4. **Nhập giá**: sửa nhanh ngay tại dòng trong tab Tồn kho (owner-only).
5. **Kiến trúc**: bảng riêng + RLS owner ở tầng DB (như Sổ quỹ) — không phải
   ẩn UI; manager/staff gọi API trực tiếp cũng không đọc được giá.

## 1. Dữ liệu & bảo mật

### Bảng mới

```sql
create table public.ingredient_reference_prices (
  ingredient_id uuid primary key
    references public.ingredients(id) on delete cascade,
  unit_price bigint not null check (unit_price >= 0),  -- VND/đơn vị của ingredient
  updated_at timestamptz not null default now()
);
```

### RLS + grants

- `enable row level security`.
- Policy **owner-only cho cả 4 thao tác** (select/insert/update/delete) —
  dùng helper kiểm owner sẵn có của Sổ quỹ (xác minh tên chính xác trong
  `003_rls.sql` khi viết plan; KHÔNG dùng `app_is_owner_manager`).
- Grant `select/insert/update/delete` cho `authenticated` (RLS là cổng thật),
  full cho `service_role`.
- **Dual-write canonical**: bảng vào `001_schema.sql`, RLS/grant vào
  `003_rls.sql`, migration `database/migrations/2026-06-12-ingredient-reference-prices.sql`
  (kiểm tra md5/nội dung khớp canonical theo quy ước repo). Lưu ý bài học
  retrofit: bảng MỚI không bị vấn đề cột-thiếu-trong-001 vì không view/func
  canonical nào tham chiếu nó trước migration.

### Ghi dữ liệu

Upsert trực tiếp từ client qua RLS (`upsert` on conflict ingredient_id) —
single-row đơn giản, không cần RPC. Xóa giá = `delete` row.

## 2. Client data flow

- `useIngredientPricesQuery(supabase, enabled)` — `enabled = role === "owner"`;
  trả `Map<ingredient_id, { unit_price, updated_at }>`. (Non-owner mà query
  thì RLS trả 0 rows — gate `enabled` chỉ để khỏi gọi thừa.)
- `useUpsertIngredientPrice` / xóa — invalidate query trên thành công + toast.
- Helper thuần (đặt trong `src/features/inventory/stock-value.ts` + Vitest):
  - `rowValue(balance, price)` → `Math.round(balance × price)` (VND nguyên;
    tồn lẻ như 3,2 kg × 185.000 → 592.000), `null` nếu chưa có giá.
  - `stockTotals(balances, priceMap)` → `{ total, missingCount }` — tổng =
    Σ các `rowValue` đã làm tròn của dòng CÓ giá (kể cả giá trị âm khi tồn
    âm), `missingCount` = số NL chưa đặt giá.

## 3. UI — tab Tồn kho (owner)

- Header section "Tồn hiện tại": dòng tổng **"Giá trị kho: X ₫"**; khi
  `missingCount > 0` kèm chú thích nhỏ "(n NL chưa có giá)".
- Mỗi dòng: dưới `tên · tồn` thêm dòng phụ `đơn giá × tồn = giá trị`
  (tabular-nums; giá trị âm → `text-danger`). Chưa có giá → chữ mờ
  "Chưa có giá".
- **Nút sửa nhanh** (icon pencil, ≥44px, chỉ owner) trên từng dòng → mở
  **Modal hiện có** (centered, `w-[min(95vw,24rem)]`) "Đơn giá — {tên NL}"
  — nâng cấp thành bottom sheet khi làm phase Modal→Sheet của spec mobile:
  - Ô tiền `inputMode="numeric"`, font ≥16px, hiển thị dấu chấm nghìn.
  - Gợi ý "Giá nhập gần nhất: {last_unit_price} ₫" + nút **"Dùng giá này"**
    (copy vào ô — đỡ gõ tay).
  - Nút **Lưu** (disabled khi rỗng) và **Xóa giá** (chỉ hiện khi đã có giá).
- Manager/staff/viewer: tab Tồn kho giữ NGUYÊN — không cột giá, không tổng,
  không nút sửa.
- KHÔNG trộn vào `StockEntryModal` (modal ghi nhận xuất/nhập) — sheet giá là
  thành phần riêng.

## 4. UI — Dashboard (owner)

Card "Tồn kho hiện tại" (`DashboardStockList`): owner thấy thêm giá trị tồn
mỗi dòng + tổng nhỏ ở header card (cùng helper + query — không query mới).
Role khác: card giữ nguyên. Gate bằng `account.role` đã có sẵn trong props.

## 5. Edge cases

| Tình huống | Hành vi |
|---|---|
| Tồn âm (đã có cảnh báo "Âm") | giá trị âm, hiện đỏ, VẪN cộng vào tổng (trung thực) |
| NL chưa đặt giá | dòng "Chưa có giá", loại khỏi tổng, đếm vào `missingCount` |
| Xóa nguyên liệu | cascade xóa giá (FK on delete cascade) |
| NL inactive | giữ giá trong bảng; hiển thị theo list hiện tại (không đổi) |
| `last_unit_price` | KHÔNG bị ghi đè bởi tính năng này; chỉ dùng làm gợi ý |

## 6. Testing

- **pgTAP** (`database/tests/280_ingredient_reference_prices.sql`, chạy trên
  DB sạch theo quy trình CI): owner insert/update/select/delete ✓;
  manager + staff_operator: select trả 0 rows, insert/update bị chặn;
  anon bị chặn; delete ingredient → row giá biến mất (cascade).
- **Vitest** (TDD): `stock-value.ts` — giá null, tồn âm, tổng + missingCount,
  làm tròn (giá × số thập phân, vd 3,2 kg × 185.000).
- **UI verify**: 375px (sheet sửa giá 1 tay, không tràn ngang) + desktop;
  đăng nhập manager/staff xác nhận KHÔNG thấy giá ở cả Kho lẫn dashboard.

## Ngoài phạm vi (chốt để khỏi phình)

- Không bình quân gia quyền / lịch sử giá / định giá theo lô.
- Không sửa giá hàng loạt (bulk edit).
- Không đưa giá vào analytics views n8n (làm sau nếu cần — bảng owner-only,
  service_role đọc được nên thêm view sau này không vướng).
- Không thay đổi `last_unit_price` và flow nhập NL từ sổ quỹ.
