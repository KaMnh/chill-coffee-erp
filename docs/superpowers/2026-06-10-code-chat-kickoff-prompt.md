# Prompt khởi động cho chat code (dán nguyên khối bên dưới)

---

Tôi đã brainstorm xong một loạt tính năng ở chat khác và viết sẵn spec (mỗi spec là prompt
triển khai, bám đúng file/dòng/RPC thật). **Nhiệm vụ của chat này: lập kế hoạch + code theo các
spec đó.** Đừng brainstorm lại thiết kế trừ khi phát hiện spec sai/mâu thuẫn với code thật —
khi đó dừng lại báo tôi.

## Đọc trước (theo thứ tự)
1. `docs/superpowers/2026-06-10-cluster-AB-handoff.md` — index: thứ tự, phụ thuộc, tóm tắt quyết định.
2. Các spec trong `docs/superpowers/specs/`:
   - `2026-06-10-cash-denomination-ux-leave-grid-design.md` (F5+F6)
   - `2026-06-10-safe-two-funds-cash-transfer-design.md` (Sổ quỹ 2 phần — nền, lớn nhất)
   - `2026-06-10-safe-withdraw-adjustable-date-design.md` (F4 — gộp vào spec 2 quỹ)
   - `2026-06-10-purchase-inventory-from-safe-design.md` (F1+F2)
   - `2026-06-10-analytics-data-surface-n8n-design.md` (Phân tích n8n — thuần DB; COGS hoãn)
   - `2026-06-10-end-of-day-fund-bank-transfer-design.md` — ⛔ SUPERSEDED, KHÔNG triển khai.

## Thứ tự triển khai
1. **F5+F6** (UI thuần, không backend) — làm trước, rủi ro thấp.
2. **Sổ quỹ 2 phần** — redesign lõi sổ quỹ, **phân pha** theo mục "Phân pha đề xuất" trong spec
   (nền → nguồn vào CK qua finalize/void/edit → chi tách quỹ). **Gộp F4** (ô ngày) vào đợt sửa
   `safe_withdraw_other`.
3. **F1+F2** — dựa trên nền 2 quỹ.
4. **Phân tích n8n** — thuần DB (view), dựa trên nền 2 quỹ; COGS hoãn (không làm).

Làm từng spec một, verify xong mới sang spec kế. Trong mỗi spec làm theo mục "Phạm vi", "Chi tiết",
và checklist "Testing & verify".

## Ràng buộc môi trường (BẮT BUỘC)
- Mỗi spec có mục verify riêng. Chuẩn chung: `npm test` (Vitest) + `npx tsc --noEmit` phải sạch;
  DB test = pgTAP trong `database/tests/`.
- ⚠️ **KHÔNG chạy `npm run build` khi `next dev` (cổng 3009) đang chạy** — sẽ clobber `.next`,
  gây 404 chunks / kẹt "Đang tải". Muốn build sạch: kill 3009 → `rm -rf .next` → restart dev.
- DB là **Supabase local** (không phải MCP cloud). Query/apply qua `docker exec -i supabase-db psql`.
  Tài khoản test: `owner@chill.local`. Sổ quỹ là **owner-only**.
- Áp DB theo cách repo: sửa/append trong `database/001_schema.sql` / `002_functions.sql` /
  `003_rls.sql` rồi re-apply. **Đổi chữ ký RPC phải `drop function` bản cũ trước** (tránh
  PostgREST "could not choose best candidate" — xem note ở `finalize_cash_close_report`).
- Tuân theo TDD/verify trong spec; code bám pattern hiện có (feature folder, RPC + data layer +
  TanStack mutation/query, component UI).

## Cách làm việc
- Dùng skill phù hợp (writing-plans để lập plan, test-driven-development khi code).
- Thay đổi tối thiểu (surgical), không refactor ngoài phạm vi spec.
- Nếu spec có chỗ chưa khớp code thật → dừng, báo tôi, đừng tự suy diễn.

Bắt đầu bằng việc đọc handoff index + spec #1 (F5+F6) rồi đề xuất plan.

---
