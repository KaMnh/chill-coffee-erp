# Handoff — Cụm A (Két) + Cụm B (Sổ quỹ → kho)

**Date:** 2026-06-10
**Branch:** `claude/magical-lalande-d19b85`
**Trạng thái:** Brainstorm xong, **spec đã chốt + commit**. Code + plan làm ở **chat khác**.

Chat này chỉ brainstorm/logic hóa. Mỗi spec dưới đây là **prompt triển khai** đã bám đúng
file/dòng/RPC thật của project. Cụm C (OCR) đã bỏ.

## Thứ tự triển khai đề xuất

| # | Spec | Backend? | Phụ thuộc | Ghi chú |
|---|------|----------|-----------|---------|
| 1 | [F5+F6 — Đếm tiền UX + lưới để lại](specs/2026-06-10-cash-denomination-ux-leave-grid-design.md) | Không | — | UI thuần, rủi ro thấp, làm trước |
| 2 | [Sổ quỹ 2 phần (tiền mặt + chuyển khoản)](specs/2026-06-10-safe-two-funds-cash-transfer-design.md) | Có (RPC + schema) | — | **Redesign lõi sổ quỹ. Lớn nhất — code phân pha.** Gộp luôn F4 + nền cho F1 |
| 3 | [F4 — Rút quỹ chỉnh được ngày](specs/2026-06-10-safe-withdraw-adjustable-date-design.md) | Có (RPC) | gộp vào #2 | Ô ngày — triển khai chung đợt sửa `safe_withdraw_other` của #2 |
| 4 | [F1+F2 — Nhập nguyên liệu → kho](specs/2026-06-10-purchase-inventory-from-safe-design.md) | Có (RPC + schema) | **#2** | Modal nhiều dòng; thanh toán tách quỹ (addendum) |
| — | [F7 — Tổng quỹ cuối ngày (reporting-only)](specs/2026-06-10-end-of-day-fund-bank-transfer-design.md) | — | — | ⛔ **SUPERSEDED bởi #2** — KHÔNG triển khai |

**Luồng:** #1 độc lập (làm bất cứ lúc nào). #2 là nền sổ quỹ → làm trước #3/#4. #3 (ngày)
gộp vào đợt sửa `safe_withdraw_other` của #2. #4 dựa trên nền 2 quỹ của #2.

## Quyết định cốt lõi (tóm tắt)

- **F5:** ô đếm tiền — bôi đen (select) khi focus; count=0 → rỗng hoàn toàn (không placeholder).
- **F6:** đổi ô "để lại ngày mai" thành lưới mệnh giá ở main view + nút "Copy từ đếm thực".
  Không lưu breakdown; không đụng backend.
- **Sổ quỹ 2 phần (F7 v2):** thêm cột `fund` (cash|transfer); 2 số dư chạy riêng + **tổng quỹ**.
  Chốt két: tiền mặt → quỹ tiền mặt, chuyển khoản → quỹ CK (auto). Chi (rút/nhập NL) **tách**
  CK + tiền mặt (CK trước, tiền mặt bù). Setup nhập 2 số dư. Đếm/rút mở két = cash; điều chỉnh
  chọn quỹ. → giải quyết đúng vấn đề F7 mà không làm đếm két lệch.
- **F4:** ô chọn ngày khi rút quỹ; `occurred_at` = nhãn ngày; số dư giảm ngay (cơ sở `created_at`,
  per-fund). Gộp vào #2.
- **F1+F2:** modal riêng từ Sổ quỹ, nhiều dòng `{NL, SL, đơn giá, thành tiền}`, quy đổi 2 chiều;
  1 RPC atomic = trừ quỹ (tách) + đẩy kho + cập nhật `last_unit_price`; tạo NL mới inline (reuse
  `IngredientFormModal`); KHÔNG upload hóa đơn.

## Lưu ý chung khi code

- Verify: `npm test` + `npx tsc --noEmit`. ⚠️ KHÔNG `npm run build` khi `next dev` (3009) đang chạy.
- Backend áp dụng theo cách của repo (sửa/append trong `database/00x_*.sql` rồi re-apply);
  đổi chữ ký RPC nhớ `drop function` bản cũ (xem note ambiguity ở finalize).
- DB test = pgTAP trong `database/tests/`.
- #2 chạm `finalize`/`void`/`edit` cash close (tách deposit theo fund) — test kỹ luồng chốt két.
