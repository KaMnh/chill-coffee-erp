# F5 + F6 — Đếm tiền UX + Copy mệnh giá để lại — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** F5 — input lưới mệnh giá ẩn số 0 (hiển thị rỗng) + bôi đen khi focus. F6 — nút "Copy từ đếm thực" ở Step 2 wizard để prefill lưới "để lại ngày mai" từ đếm cuối ngày (điểm xuất phát để bớt phần nạp két, **chừa lại một phần**).

**Architecture:** Thuần client UI. F5 sửa component lưới dùng chung `DenominationGrid` → lan toả mọi consumer (Step 1 + Step 2 wizard, các modal). F6 thêm 1 action trong `CashCountWizard` (đã có sẵn lưới Step 2). Không backend, không state mới ở `cash-view`.

**Tech Stack:** Next.js 15 client components, TypeScript strict. Không logic thuần mới (reuse `computeDenominationTotal`). Verify = `npx tsc --noEmit` + `npm run test:run` (regression).

**Reconciliation (spec gốc viết trên cây 175-commit cũ):** F6 core (đổi `TextField` → lưới mệnh giá) **ĐÃ** có trong `CashCountWizard` Step 2 trên `origin/main`. Phần còn lại của F6 = đúng nút Copy. Mục đích nút (user xác nhận 2026-06-10): prefill từ đếm thực để chừa lại **một phần**, không phải để lại tất cả.

---

### Task 1 — F5: hành vi input `DenominationGrid`

**Files:** Modify `src/features/cash/denomination-grid.tsx` (thẻ `<input>` ~dòng 93–115)

- [ ] **Step 1:** `value={count}` → `value={count === 0 ? "" : count}`; thêm `onFocus={(e) => e.currentTarget.select()}`. Không thêm placeholder.
- [ ] **Step 2:** `npx tsc --noEmit` → sạch.
- [ ] **Step 3:** commit (`feat(cash): F5 — ẩn 0 + bôi đen khi focus lưới mệnh giá`).

### Task 2 — F6: nút "Copy từ đếm thực" (Step 2 wizard)

**Files:** Modify `src/features/cash/cash-count-wizard.tsx` (Step 2 expanded, ngay trước `<DenominationGrid value={nextDayDenominations}>`)

- [ ] **Step 1:** thêm action row + Button "Copy từ đếm thực", `onClick={() => onNextDayChange({ ...todayDenominations })}`, `disabled={disabled || todayTotal === 0}`, `leadingIcon={<Icon name="clipboardList" size={16} />}`. Không toast (thay đổi nhìn thấy ngay).
- [ ] **Step 2:** `npx tsc --noEmit` → sạch.
- [ ] **Step 3:** `npm run test:run` → không regression.
- [ ] **Step 4:** commit (`feat(cash): F6 — nút Copy từ đếm thực vào lưới để lại`).

### Verify thủ công (sau cùng)

1. Lưới đếm: ô count=0 hiển thị **rỗng** (không "0"); focus ô có số → bôi đen → gõ ghi đè; mũi tên Up/Down/Left/Right vẫn chạy.
2. Step 2: bấm "Copy từ đếm thực" → lưới để lại = đếm cuối ngày; bớt vài tờ → "Nạp sổ quỹ" tăng đúng phần chênh.
3. Chốt két: `safe_deposit` đúng như trước; lưới reset sau chốt.

⚠️ KHÔNG `npm run build` khi `next dev` (3009) đang chạy — clobber `.next`.

### Out of scope (YAGNI)

Không lưu breakdown mệnh giá phần để lại; không đụng `EditCashCloseModal` / `LeaveDenominationPopup` / backend / DB.
