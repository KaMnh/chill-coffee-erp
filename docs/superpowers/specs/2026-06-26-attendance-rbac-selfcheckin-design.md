# Spec — Attendance RBAC: self-checkin cho mọi role dưới owner + chuẩn bị khóa operator về owner-only

> Status: approved plan, pending Codex adversarial review. Stack: Next.js 15 App Router · React 19 · TypeScript · Supabase local (Postgres) · pgTAP · Vitest. Base off `origin/main`.

## Context (vì sao làm)

Mô hình chấm công đang lệch với nhu cầu vận hành quán:

- **Thiếu self-checkin cho cấp dưới owner.** Hôm nay CHỈ `employee_self_service` được tự chấm công (3 lớp gate: `NAV_ITEMS["checkin"].roles` ở `src/features/navigation/navigation.ts:38`, `requireAuth` ở `src/app/api/checkin/route.ts:27`, và sidebar default). Nhưng **manager** và **staff_operator** cũng làm ca và cần tự chấm công → đang thiếu.
- **Hướng tương lai:** các thao tác *operator* (check người khác vào/ra ca) và *sửa giờ ca* sẽ được **khóa về owner-only**, thay bằng self-checkin cho mọi người. Cần chuẩn bị kiến trúc.
- **Bug báo cáo:** "cấp tài khoản cho nhân viên chỉ owner thấy (manager không thấy)". Code hiện tại cho phép owner **và** manager (`canManage` ở `src/features/shifts/shifts-view.tsx:49`, nút gate bởi `canManage` ở `src/features/shifts/employee-grid.tsx:103-114`) → nhiều khả năng là **bản deploy cũ** (trước v4.5.0) hoặc nhân viên đã có **TK ảo** nên hiện badge "Đã có TK" thay vì nút. Cần xác minh + bảo đảm.

Quyết định đã chốt với user:
- **2 phase:** Phase 1 làm trước (self-checkin + fix bug cấp TK); Phase 2 thiết kế sẵn, enforce sau (khóa operator + sửa giờ về owner-only).
- **Owner KHÔNG tự chấm công** (owner là người vận hành/sửa giờ). Màn "Chấm công" chỉ cho cấp dưới owner.
- **Phase 2 khóa về CHỈ owner** (manager + staff_operator mất quyền operator check-in/out + sửa giờ; chỉ còn tự chấm công).

Intended outcome: manager + staff_operator tự chấm công được trên điện thoại (IP/anchor-gated như employee_self_service); manager chắc chắn cấp được tài khoản; và đường khóa operator→owner-only đã được thiết kế rõ để bật sau mà không phá dữ liệu.

## Roles (hiện trạng đã xác minh)
`owner` (Chủ quán), `manager` (Quản lý), `staff_operator` (Nhân viên vận hành), `employee_viewer` (Viewer), `employee_self_service` (Nhân viên). Helpers (`database/002_functions.sql:24-52`): `app_role()`, `app_is_owner_manager()` (owner|manager), `app_is_staff_or_above()` (owner|manager|staff_operator).

## Scope

**Trong phạm vi — Phase 1 (implement):**
1. Mở self-checkin cho `manager`, `staff_operator` (giữ `employee_self_service`; **loại owner**).
2. Data-fix sidebar để màn "Chấm công" hiện ra cho các account manager/staff_operator đã tồn tại.
3. Xác minh + bảo đảm manager cấp được tài khoản (audit gate, redeploy nếu stale, regression test).

**Trong phạm vi — Phase 2 (chỉ thiết kế, enforce sau):**
4. Khóa `check_in_employee` / `check_out_employee` + RLS `shift_assignments` write/update → **owner-only**.
5. Khóa `edit_shift_payroll_record` + RLS `shift_payroll_records` update → **owner-only**.
6. UI trang ca: ẩn "Vào ca/Ra ca" + nút sửa payroll cho non-owner; tách `canManage` (admin: owner+manager) khỏi `canOperateAttendance` (owner-only).
7. Audit trigger cho `shift_assignments` (đang thiếu).
8. **Quyết định mở (Phase 2):** checkout trong thế giới owner-only (xem Open Decision).

**Ngoài phạm vi:**
- Dọn các TK đã kẹt vào NV-ảo / re-point (đã có task riêng + guardrail v4.5.2). Chỉ *tham chiếu*.
- Đổi cơ chế IP/anchor gate (giữ nguyên `checkin_network` + `fresh_anchor_ips`).
- employee_viewer (không làm ca → không đụng).

---

## Phase 1 — Self-checkin cho mọi role dưới owner + bug cấp TK

### Bước 1.1 — Mở role cho route + nav (code)
- `src/app/api/checkin/route.ts` (~dòng 27): `requireAuth(authz, ["employee_self_service"])` → `["employee_self_service", "staff_operator", "manager"]`. (KHÔNG thêm owner.)
- `src/features/navigation/navigation.ts`:
  - `NAV_ITEMS` mục `checkin` (dòng 38): `roles: ["employee_self_service"]` → `["employee_self_service", "manager", "staff_operator"]`.
  - `DEFAULT_SIDEBAR_BY_ROLE` (dòng 41-47): **append** `"checkin"` vào `manager` và `staff_operator` (cuối danh sách — vị trí render theo `NAV_ITEMS`, append cuối là đủ).
  - `MOBILE_TAB_PREFERENCE` (dòng 136-142): append `"checkin"` vào `manager` + `staff_operator` (vị trí thấp; tab cap 4 nên vào drawer "Thêm" nếu không lên tab — vẫn truy cập được).
- Không cần đổi RPC: `check_in_self` / `get_my_checkin_status` (`database/002_functions.sql:4479-4519`) không kiểm role, chỉ yêu cầu account **active + gắn employee** → widening là việc của route + nav.

### Bước 1.2 — Data-fix migration cho sidebar đã lưu (DB, dual-write)
Lý do: `getVisibleNav` lấy nguồn `account.sidebar_config ?? settings.sidebar_defaults[role] ?? DEFAULT_SIDEBAR_BY_ROLE[role]` rồi `normalizeSidebarItems` lọc theo `hasBasePageAccess`. Account đã có `sidebar_config`/`sidebar_defaults` là **danh sách đóng** — nếu không chứa `"checkin"` thì dù đổi code vẫn không hiện.
- Tạo migration `database/migrations/<date>-checkin-view-for-staff.sql` (idempotent), append `"checkin"`:
  - `profiles.sidebar_config` của mọi account có role ∈ {manager, staff_operator} mà `sidebar_config` non-null và CHƯA chứa `"checkin"` (jsonb/array append, tránh trùng).
  - `app_settings.sidebar_defaults` cho key `manager` + `staff_operator` (nếu seed có lưu sidebar_defaults).
- **Dual-write:** phản chiếu thay đổi seed tương ứng vào file canonical (nếu `sidebar_defaults` được seed ở `database/004_seed.sql` hoặc nơi tương đương — implementer xác minh nguồn seed trước khi viết).

### Bước 1.3 — Điều kiện định danh (kiểm tra, không code mới)
- Self-checkin yêu cầu account **gắn employee** (`employee_id` non-null) — nếu không, RPC raise "Tài khoản chưa gắn nhân viên." Account manager/staff_operator theo mô hình hiện tại luôn gắn employee → OK. Nếu phát hiện account chưa gắn, đó là việc của guardrail v4.5.2 / task re-point.
- **Tiền đề vận hành:** owner phải đã bật + cấu hình anchor (`checkin_network.enabled = true` + có anchor IP tươi), nếu không `/api/checkin` trả 503 cho MỌI role (hành vi sẵn có). Ghi rõ trong docs.

### Bước 1.4 — Bug "cấp tài khoản chỉ owner thấy" (verify-first)
- **Xác minh:** đăng nhập account role=manager trên bản build hiện tại → nút "Cấp tài khoản" ở `employee-grid.tsx` có hiện cho NV chưa có TK không. Code hiện tại CHO PHÉP (gate `canManage` = owner||manager) → kỳ vọng hiện.
  - Nếu KHÔNG hiện do **bản deploy cũ** → redeploy image hiện tại (≥ v4.5.2). Không đổi code.
  - Nếu NV mục tiêu hiện badge "Đã có TK" (đã kẹt TK ảo) → vấn đề phantom, thuộc task re-point (ngoài phạm vi).
  - CHỈ sửa code nếu xác minh thấy gate owner-only thật trong bản đang chạy.
- **Regression coverage:** test khẳng định role gating account-granting cho manager (`requireAuth([..., "manager"])` cho `POST /api/users` `users/route.ts:50`, `PATCH /api/users/[id]` `[id]/route.ts:52`).

---

## Phase 2 — Khóa operator + sửa giờ về owner-only (THIẾT KẾ; enforce sau)

> Mục tiêu: chỉ **owner** được check người khác vào/ra ca và sửa giờ ca. manager + staff_operator chuyển hoàn toàn sang **tự chấm công**.

### 2.1 Helper role
- Thêm `app_is_owner()` (hoặc dùng `app_role() = 'owner'`) trong `database/002_functions.sql` cạnh các helper (24-52).

### 2.2 RPC gates → owner-only (dual-write 002 + migration)
- `check_in_employee` (`002_functions.sql:525`): `app_is_staff_or_above()` → owner-only.
- `check_out_employee` (`002_functions.sql:576`): `app_is_staff_or_above()` → owner-only.
- `edit_shift_payroll_record` (`002_functions.sql:617`): `app_is_owner_manager()` → owner-only.

### 2.3 RLS → owner-only (dual-write 003 + migration)
**Khóa MỌI đường ghi (INSERT/UPDATE/DELETE), không chỉ UPDATE.** (Codex high finding) Nếu chỉ khóa UPDATE thì manager/staff_operator vẫn INSERT trực tiếp qua PostgREST: RLS `payroll_staff_write` hiện cho INSERT với `app_is_staff_or_above()`, và `shift_payroll_records.shift_assignment_id` nullable → có thể chèn bản ghi lương GIẢ, làm hỏng cash-report dù UI/RPC đã owner-only.
- `shift_assignments` INSERT/UPDATE/DELETE (`003_rls.sql:151-156`): → **owner-only** (mọi write, không chỉ update).
- `shift_payroll_records` INSERT/UPDATE/DELETE (`003_rls.sql:158-163`): → **owner-only** (gồm cả `payroll_staff_write` INSERT). Self-checkin (Phase 1) vẫn ghi `shift_assignments` qua RPC service-role (bypass RLS) nên không bị chặn.
- Giữ SELECT cho staff_or_above (cấp dưới xem được ca/lương của họ + giám sát).
- pgTAP RLS phải chứng minh manager/staff_operator **KHÔNG INSERT được** vào `shift_payroll_records` lẫn `shift_assignments` (không chỉ test UPDATE).

### 2.4 UI trang ca
- `src/features/shifts/shifts-view.tsx`: tách `canManage` thành `canManageAdmin` (owner+manager — giữ "Cấp tài khoản"/"+ Thêm nhân viên"/"Sửa NV") và `canOperateAttendance` (owner-only).
- `src/features/shifts/employee-grid.tsx`: nút "Vào ca"/"Ra ca" (dòng 126-143) gate bởi `canOperateAttendance` (owner-only); non-owner chỉ thấy badge trạng thái + dấu "Tự chấm công".
- `payroll-edit-modal.tsx` + nút sửa ở `PayrollHistoryCard`: gate owner-only.

### 2.5 Audit
- Thêm audit trigger cho `shift_assignments` (đang thiếu — chỉ `shift_payroll_records` có, `002_functions.sql:1771-1774`). Dùng `_audit_row_change()` (1744-1769).

### 2.6 Open Decision (Phase 2) — Checkout trong thế giới owner-only
Hiện **không có self-checkout** (chỉ self check-IN; checkout là operator). Khi operator→owner-only thì **chỉ owner check-out được** → owner phải đóng mọi ca. Lựa chọn:
- **(A) Owner-only checkout:** owner đóng tất cả ca. Khớp "owner kiểm soát lương", nhưng nặng cho owner.
- **(B) Thêm self-checkout (đề xuất):** nhân viên tự check-out qua màn "Chấm công" (IP/anchor-gated như check-in), owner giữ quyền sửa/đóng hộ. Đối xứng, nhẹ vận hành; rủi ro "gian giờ" được chặn bởi IP gate + audit + owner sửa được.
- **(C) Hybrid:** như (B) + owner bắt buộc duyệt một số trường hợp.
→ Khuyến nghị **(B)**. Cần user chốt trước khi implement Phase 2.

---

## Files (đại diện)

**Phase 1 (code):** `src/app/api/checkin/route.ts`, `src/features/navigation/navigation.ts`, `src/features/navigation/__tests__/navigation.test.ts`.
**Phase 1 (DB):** `database/migrations/<date>-checkin-view-for-staff.sql` (+ dual-write nguồn seed sidebar_defaults nếu có).
**Phase 2 (code):** `src/features/shifts/shifts-view.tsx`, `src/features/shifts/employee-grid.tsx`, `src/features/shifts/payroll-edit-modal.tsx`, `src/features/shifts/payroll-history-card.tsx`.
**Phase 2 (DB):** `database/002_functions.sql`, `database/003_rls.sql`, migration tương ứng, `database/tests/*` (role-gate + audit).

## Coverage checklist (đối chiếu yêu cầu user)
- [ ] manager + staff_operator tự chấm công được (route + nav + sidebar data-fix). (P1)
- [ ] owner KHÔNG có màn "Chấm công" (loại khỏi roles + sidebar). (P1)
- [ ] manager chắc chắn thấy/dùng "Cấp tài khoản" (verify + redeploy nếu stale + regression). (P1)
- [ ] Thiết kế khóa operator check-in/out → owner-only. (P2 design)
- [ ] Thiết kế khóa sửa giờ ca → owner-only. (P2 design)
- [ ] Audit cho shift_assignments. (P2)
- [ ] Quyết định checkout (A/B/C) được chốt. (P2 open)

## Acceptance criteria + Test plan
**Phase 1:**
- Vitest `navigation.test.ts`: `getVisibleNav`/`hasBasePageAccess` cho `checkin` = true với manager & staff_operator, = false với owner & employee_viewer; `normalizeSidebarItems` giữ `checkin` khi có trong nguồn.
- **Route authz test (cốt lõi Phase 1 — Codex medium finding):** test handler `/api/checkin` (mock `requireAuth`/dep): manager + staff_operator + employee_self_service QUA cổng auth; owner + employee_viewer bị **403**. pgTAP trên `check_in_self` KHÔNG chứng minh được role-widening (RPC không kiểm role) — route requireAuth allowlist mới là bằng chứng cốt lõi.
- pgTAP (chạy trên DB throwaway `chill_pgtap`, KHÔNG dùng `supabase-db` dev): mở rộng `database/tests/310_self_checkin.sql` — `check_in_self` chạy được cho account role=manager và role=staff_operator (đã gắn employee); `get_my_checkin_status` trả đúng.
- Migration idempotent: chạy 2 lần không nhân đôi `"checkin"`; account không-staff không bị thêm.
- Manual: login manager → thấy "Chấm công" → (anchor đã cấu hình) self-checkin tạo `shift_assignments` status `checked_in` kèm `check_in_ip`.
- `npm run verify:phase` xanh; `npm run build` xanh (KHÔNG build khi `next dev` 3009 đang chạy).

**Phase 2 (khi implement):**
- pgTAP: `check_in_employee`/`check_out_employee`/`edit_shift_payroll_record` raise khi caller là manager/staff_operator; pass khi owner. RLS `shift_assignments`/`shift_payroll_records` chặn write/update cho non-owner. Audit ghi nhận self-checkin + chỉnh sửa.

## Verification (end-to-end)
1. `npm run test:run` + `npm run pgtap` (qua `tools/pgtap-local.mjs --reset --all` trên `chill_pgtap`).
2. Preview/dev (port 3009): đăng nhập lần lượt owner / manager / staff_operator / employee_self_service, đối chiếu: ai thấy "Chấm công", ai thấy "Cấp tài khoản", self-checkin tạo bản ghi.
3. Mở PR vào `origin/main`; CI `verify.yml` (typecheck/vitest/pgtap/build) xanh; tag `vX.Y.Z` để release Docker.
