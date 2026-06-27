# Spec — Self-checkout (tự ra ca) + 2 công tắc bật/tắt (Attendance RBAC Phase 2a)

> Stack: Next.js 15 App Router · Supabase local (Postgres) · pgTAP · Vitest. Base off `origin/main` (đang ở v4.7.0). Quy trình: spec → **Codex adversarial review** → TDD implement.

## Context (vì sao làm)
Phase 1 (v4.7.0) đã mở **self check-IN** cho manager + staff_operator + employee_self_service (owner không tự chấm công). Tiếp theo, nhân viên cần **tự ra ca** thay vì chờ operator — đối xứng với tự vào ca, cùng cổng IP/anchor. User đã chốt (AskUserQuestion):
- **2 công tắc độc lập:** self check-IN đã có `checkin_network.enabled`; thêm **`self_checkout_enabled`** cho self check-OUT. Owner bật/tắt từng cái.
- **Self-checkout TÍNH LƯƠNG luôn** (đóng ca): phút công × lương giờ → tạo `shift_payroll_records` + `cash_drawer_events` như operator checkout, **KHÔNG phụ cấp, KHÔNG sửa giờ tay**. Owner sửa/duyệt sau.

**Out of scope (Phase 2b, spec riêng):** khóa operator check-in/out + `edit_shift_payroll_record` về **owner-only** + RLS hardening (Codex finding: chặn INSERT trực tiếp) + audit trigger `shift_assignments`. Phase 2a này **thuần bổ sung** (additive, không gỡ quyền ai).

Intended outcome: với owner đã bật anchor + `self_checkout_enabled`, nhân viên (cấp dưới owner) tự ra ca trên màn "Chấm công"; ca đóng + lương chốt tự động; owner sửa được qua `edit_shift_payroll_record` có sẵn.

## Scope
**In:** RPC `check_out_self`; route `/api/checkout`; toggle `self_checkout_enabled` (config + RPC validate + owner Settings UI); màn "Chấm công" có nút "Ra ca"; data/types; pgTAP + Vitest.
**Out:** lockdown owner-only (Phase 2b); đổi cơ chế IP/anchor; allowance/sửa-giờ khi tự ra ca (chỉ owner sửa sau).

## RBAC
- Self-checkout dùng **đúng `CHECKIN_ALLOWED_ROLES`** (`src/lib/api-roles.ts` = employee_self_service + staff_operator + manager). Owner **không** tự ra ca (nhất quán Phase 1).
- Owner sửa/đóng hộ qua `edit_shift_payroll_record` (hiện owner/manager) + operator `check_out_employee` (hiện staff_or_above) — **không đổi** ở Phase 2a.

---

## 1. Database (dual-write 001/002/004 + migration `2026-06-26-self-checkout.sql`)

### 1.1 Cột audit ra ca (shift_assignments)
Thêm `check_out_ip inet` + `check_out_user_agent text` (mirror `check_in_ip`/`check_in_user_agent` đã có từ migration self-checkin). Dual-write vào `001_schema.sql`. Migration: `alter table ... add column if not exists`.

### 1.2 RPC `check_out_self(p_auth_user_id uuid, p_ip inet, p_user_agent text)` — service-role-only
Mirror `check_in_self` (định danh qua param vì gọi bằng service role; `auth.uid()` null). Logic:
1. `p_auth_user_id` null → raise 'Thiếu danh tính.'
2. Resolve `employee_id` + `name` + `hourly_rate` từ `employee_accounts ea join employees e` where `ea.auth_user_id = p_auth_user_id and ea.status='active'`. Null → raise 'Tài khoản chưa gắn nhân viên.'
3. Tìm ca MỞ hôm nay: `shift_assignments` where `employee_id = v_emp and business_date = current_date and status='checked_in'` order by check_in_at desc limit 1.
4. Nếu KHÔNG có ca mở:
   - Tìm ca đã đóng hôm nay (`status='checked_out'`, mới nhất). Có → **idempotent**: return `{..., already_checked_out: true}` (không tạo lương lần 2).
   - Không có → raise 'Chưa vào ca hôm nay.'
5. Có ca mở → tính: `v_out := now()`, `v_minutes := greatest(0, round(extract(epoch from (v_out - v_in))/60))`, `v_base := round(((v_minutes/60.0) * coalesce(rate,0))/1000)*1000`, `v_total := v_base` (allowance = 0).
6. `update shift_assignments set check_out_at=v_out, total_minutes=v_minutes, status='checked_out', updated_by=p_auth_user_id, check_out_ip=p_ip, check_out_user_agent=p_user_agent where id=v_shift`.
7. Upsert `shift_payroll_records` (mirror `check_out_employee` lines 585-588 nhưng `created_by/edited_by = p_auth_user_id`, `allowance_amount=0`, `note=null`): `on conflict (shift_assignment_id) do update ...` → `v_payroll_id`.
8. `cash_drawer_events`: delete payroll_cash_out cũ của `v_payroll_id`; nếu `v_total>0` insert (mirror lines 590-594, `created_by=p_auth_user_id`, note 'Lương theo lượt TỰ ra ca').
9. Return `jsonb_build_object('shift_assignment_id', v_shift, 'employee_name', v_name, 'check_out_at', v_out, 'total_pay', v_total, 'already_checked_out', false)`.

`revoke execute ... from public, anon, authenticated; grant ... to service_role;` (như check_in_self). Re-assert trong `003_rls.sql` sau dòng grant blanket.

### 1.3 `get_my_checkin_status()` — mở rộng return
Thêm vào jsonb: `shift_assignment_id` (ca mở hôm nay, null nếu không), `checked_out_today` (boolean), `check_out_at`, và `self_checkout_enabled` (đọc `app_settings.checkin_network->>'self_checkout_enabled'`, default false). Giữ các field cũ (`employee_name`, `checked_in_today`, `check_in_at`) để không vỡ client cũ.

### 1.4 `update_checkin_network_config(p_config jsonb)` — nhận thêm `self_checkout_enabled`
- Validate: nếu `p_config ? 'self_checkout_enabled'` thì `jsonb_typeof = 'boolean'`. (Các field cũ giữ nguyên required.)
- Guard giống `enabled`: nếu `self_checkout_enabled=true` mà **không** có anchor active có IP → raise 'Chưa có thiết bị quán nào có IP — không thể bật tự ra ca.' (self-checkout cũng qua cổng IP).
- Lưu cả field mới vào row `checkin_network`.

### 1.5 Seed (`004_seed.sql` hoặc nơi seed checkin_network)
Default `checkin_network` thêm `self_checkout_enabled: false`. (DB cũ thiếu field → đọc default false ở RPC + UI.)

---

## 2. API — `/api/checkout` (mirror `/api/checkin`)
File `src/app/api/checkout/route.ts`. Thứ tự gate Y HỆT `/api/checkin` (`route.ts`):
1. proxy-secret (fail-closed prod).
2. `requireAuth(authz, CHECKIN_ALLOWED_ROLES)` (import từ `@/lib/api-roles`).
3. Đọc `checkin_network` config — **gate `self_checkout_enabled !== true` → 503** "Tính năng tự ra ca đang tắt." (config thiếu → 503).
4. `fresh_anchor_ips(grace_hours)` → IP allowlist; rỗng → 503; `isIpAllowed` fail → 403 `reject_message`.
5. rate-limit per `userId` — **limiter RIÊNG** cho checkout (instance `createRateLimiter` riêng, env `CHECKOUT_RATE_MAX`/`CHECKOUT_RATE_WINDOW_MS`, default giống checkin) để self-checkout không "ăn" bucket của self-checkin.
6. `admin.rpc("check_out_self", { p_auth_user_id, p_ip, p_user_agent })`. Lỗi → 400 "Không ra ca được."; OK → `{status:'ok', ...}`.

Lưu ý: `grace_hours`/`reject_message` dùng chung config `checkin_network` (1 row).

---

## 3. Data layer + types
- `src/lib/types.ts`:
  - `CheckinNetworkConfig` thêm `self_checkout_enabled?: boolean`.
  - `MyCheckinStatus` thêm `shift_assignment_id?: string | null`, `checked_out_today?: boolean`, `check_out_at?: string | null`, `self_checkout_enabled?: boolean`.
  - `CheckoutResult = { employee_name; check_out_at; total_pay; already_checked_out }`.
- `src/lib/data/checkin.ts`: `submitCheckout(authHeaders) → POST /api/checkout` (mirror `submitCheckin`).

## 4. UI
### 4.1 Màn "Chấm công" (`src/features/checkin/checkin-screen.tsx`)
- Trạng thái từ `get_my_checkin_status`: chưa vào → "Vào ca"; đang trong ca (`checked_in_today`) **và** `self_checkout_enabled` → thêm nút **"Ra ca"**; đã ra ca (`checked_out_today`) → hiện "Đã ra ca hôm nay" + giờ ra + tổng lương lượt.
- `onCheckout` → `submitCheckout` → invalidate `myCheckinStatus`. Result panel cho ra ca (giờ ra + total_pay).
- Nếu `self_checkout_enabled=false`: không hiện nút "Ra ca" (đang trong ca thì hiện "Đang trong ca — quản lý sẽ chốt ra ca").

### 4.2 Owner Settings (`src/features/settings/checkin-config-form.tsx`)
- Thêm `Switch` thứ 2: **"Cho phép nhân viên tự ra ca"** (`self_checkout_enabled`), disabled khi `!canEnable && !self_checkout_enabled` (cùng guard anchor-IP như `enabled`).
- Thêm vào state + `dirty` + payload `handleSaveConfig` + `configQuery` mapping + `DEFAULT_CONFIG`.

---

## 5. Edge cases
- Tự ra ca khi chưa vào ca → 'Chưa vào ca hôm nay.' (400).
- Tự ra ca 2 lần → lần 2 idempotent (`already_checked_out`), KHÔNG tạo lương lần 2.
- Toggle off → /api/checkout 503; nút "Ra ca" ẩn.
- Không nối wifi quán (sai IP) → 403 `reject_message`.
- Account chưa gắn NV → 'Tài khoản chưa gắn nhân viên.'
- Owner sửa giờ/tổng sau khi tự ra ca: qua `edit_shift_payroll_record` (đã có; chặn nếu cash-close 'final' — giữ nguyên).

## 6. Acceptance criteria + Test plan
**pgTAP** (`database/tests/330_self_checkout.sql`, chạy trên `chill_pgtap` — KHÔNG dùng `supabase-db` dev):
- `check_out_self`: account đã vào ca → đóng ca (`status='checked_out'`, `check_out_at` set), tạo `shift_payroll_records` đúng `total_minutes`/`base_pay` (= operator checkout cùng input), tạo `cash_drawer_events` payroll_cash_out = total_pay.
- Idempotent: gọi lần 2 → không nhân đôi payroll/cash event, trả `already_checked_out`.
- Chưa vào ca → raise 'Chưa vào ca hôm nay.'
- Account không gắn NV → raise đúng message.
- Quyền: `check_out_self` revoke khỏi authenticated/anon/public (chỉ service_role) — assert qua `has_function_privilege`.
- `update_checkin_network_config`: lưu + đọc lại `self_checkout_enabled`; bật khi không có anchor IP → raise.
- `get_my_checkin_status`: trả `self_checkout_enabled` + `checked_out_today` đúng.
- created_at tie-break: đóng dấu created_at tăng dần giữa các call đổi số dư (xem [[pgtap-created-at-frozen-tiebreak]]).

**Vitest:**
- `/api/checkout` authz: dùng lại pattern `checkin-authz.test.ts` (route `requireAuth(CHECKIN_ALLOWED_ROLES)`) — manager/staff_operator/employee_self_service qua, owner/employee_viewer chặn. (Allowlist đã có test ở Phase 1; thêm test khẳng định route checkout dùng cùng allowlist nếu tách hằng riêng.)
- Toggle/route 503 khi `self_checkout_enabled=false` (mock config).

**Verify:** `npm run verify:phase` (Vitest + pgTAP) xanh; `npm run build` xanh (KHÔNG build khi `next dev` 3009 đang chạy). Manual: owner bật self_checkout → nhân viên đang trong ca thấy "Ra ca" → bấm → ca đóng + lương hiện ở trang ca; tắt toggle → nút ẩn + route 503.

## 7. Coverage checklist (đối chiếu yêu cầu user)
- [ ] Self-checkout (tự ra ca) cho cấp dưới owner, IP/anchor-gated. 
- [ ] Tính lương luôn khi tự ra ca (đóng ca), owner sửa được.
- [ ] 2 công tắc độc lập: self check-IN (`enabled` cũ) + self check-OUT (`self_checkout_enabled` mới), owner Settings.
- [ ] Owner KHÔNG tự ra ca; allowlist = CHECKIN_ALLOWED_ROLES.
- [ ] Idempotent + edge cases + 503 khi tắt.
- [ ] pgTAP + Vitest theo Test plan.

## 8. Files (đại diện)
**DB:** `database/migrations/2026-06-26-self-checkout.sql`, `database/002_functions.sql`, `database/001_schema.sql`, `database/003_rls.sql`, `database/004_seed.sql`, `database/tests/330_self_checkout.sql`.
**API/data:** `src/app/api/checkout/route.ts`, `src/lib/data/checkin.ts`, `src/lib/types.ts`.
**UI:** `src/features/checkin/checkin-screen.tsx`, `src/features/settings/checkin-config-form.tsx`, (+ mutation/query hooks cho config nếu cần mở rộng).

---

## 9. Codex adversarial review findings (PHẢI xử lý khi implement Phase 2a)
Review 2026-06-26 — verdict needs-attention. Fold các điểm sau vào trước khi code:

- **[high] Self-checkout sau khi cash close 'final' → hỏng số liệu.** RPC `check_out_self` đổi `shift_assignments` + upsert `shift_payroll_records` + cash event, nhưng KHÔNG guard `cash_close_reports.report_status='final'` cho `business_date` đó. `edit_shift_payroll_record` đã chặn sửa lương sau final close → self-checkout phải chặn tương tự. **Fix:** trước khi ghi, kiểm tra có report final cho business_date → raise message yêu cầu owner void/reclose. Thêm pgTAP self-checkout vs ngày đã finalize.
- **[high] Race/retry ghi đè ca đã đóng.** Thiết kế SELECT ca mở rồi UPDATE by id → 2 click/timeout-retry cùng chọn 1 row `checked_in`; UPDATE thứ 2 vẫn ghi đè (WHERE không check status) → đè `check_out_at`/IP/UA/lương/cash, trả `already_checked_out=false` sai. **Fix:** atomic transition `UPDATE ... WHERE id=v_shift AND status='checked_in' RETURNING ...`; không có row → reread ca checked_out mới nhất → trả `already_checked_out=true`. Chỉ ghi payroll/cash SAU khi thắng transition.
- **[medium] `tools/pgtap-local.mjs` `--reset` có thể drop nhầm DB.** `PG_DB` lấy thẳng từ env, `drop/create database` as postgres không allowlist/quote. **Fix:** chỉ cho `--reset` khi DB khớp `/^chill_pgtap(_[a-z0-9]+)?$/`, quote identifier, chặn postgres/template/supabase app DB. (Hoặc giữ helper ngoài shippable change.)
