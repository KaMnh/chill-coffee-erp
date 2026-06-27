# Spec — Khóa chấm công thủ công về owner-only + RLS hardening + audit (Attendance RBAC Phase 2b)

> Stack: Next.js 15 App Router · Supabase local (Postgres) · pgTAP · Vitest. Base off `origin/main` (đang ở **v4.9.0**, sau Phase 2a). Quy trình: spec → **Codex adversarial review** → fix findings → TDD implement.
>
> **Self-contained cho reviewer:** mọi tham chiếu hàm/policy kèm đường dẫn + số dòng ở thời điểm viết (v4.9.0). Reviewer đối chiếu trực tiếp, không cần ngữ cảnh chat.

## Context (vì sao làm)
Roadmap chấm công (user chốt qua brainstorming):
- **Phase 1 (v4.7.0):** self check-IN cho manager + staff_operator + employee_self_service. Owner KHÔNG tự chấm công.
- **Phase 2a (v4.9.0):** self check-OUT (`check_out_self`) + 2 toggle (`enabled`, `self_checkout_enabled`). Ra ca tự chốt lương.
- **Phase 2b (spec này):** **thu hồi** quyền chấm công/sửa lương THỦ CÔNG của manager + staff_operator → **chỉ owner**. Luồng vào/ra ca bình thường chuyển hẳn sang **self check-in/out**; thao tác thủ công ở trang ca trở thành **công cụ chỉnh sửa/đính chính của owner**. Đồng thời **bịt lỗ RLS** (non-owner INSERT thẳng `shift_payroll_records` qua PostgREST, bỏ qua RPC) và **thêm audit trigger** cho `shift_assignments`.

User đã chốt (AskUserQuestion, Phase 2 brainstorm): *"Chỉ owner"* được dùng manual check-in/out + sửa giờ; *"Owner KHÔNG chấm công"* (owner không tự clock-in, chỉ quản trị).

Intended outcome: sau Phase 2b, manager/staff_operator **không** còn nút Vào ca/Ra ca/Sửa lương hộ ở trang ca (chỉ XEM); họ tự chấm công qua màn "Chấm công". Owner giữ toàn quyền đính chính. Direct PostgREST write vào `shift_assignments`/`shift_payroll_records` bị RLS chặn cho non-owner. Mọi thay đổi `shift_assignments` được ghi `audit_log`.

## Scope
**In:**
1. Helper `app_is_owner()` (mirror `app_is_owner_manager`).
2. Siết guard RPC: `check_in_employee`, `check_out_employee`, `edit_shift_payroll_record` → **owner-only**.
3. RLS hardening: `shift_assignments` (insert/update) + `shift_payroll_records` (insert/update) → **owner-only**; **GIỮ** read = `app_is_staff_or_above()`.
4. Audit trigger `audit_shift_assignments` (reuse `_audit_row_change()`).
5. UI: gate nút Vào ca/Ra ca/Sửa lương ở trang ca về `role === "owner"`; non-owner thấy read-only + hướng dẫn dùng màn Chấm công.
6. pgTAP + Vitest.

**Out:**
- KHÔNG đụng `check_in_self`/`check_out_self` (Phase 1/2a) — chúng `security definer`, bypass RLS, không bị ảnh hưởng (xem §7).
- KHÔNG đổi cơ chế IP/anchor, toggle, hay logic tính lương.
- KHÔNG gỡ read-access của manager/operator ở trang ca (vẫn xem được ca + lương).
- KHÔNG thêm UI xem `audit_log` (chỉ ghi; xem là việc sau).

## RBAC — bảng chuyển trạng thái
| Hành động | Trước 2b | Sau 2b |
|---|---|---|
| `check_in_employee` (RPC) | `app_is_staff_or_above()` (002:525) | **owner-only** |
| `check_out_employee` (RPC) | `app_is_staff_or_above()` (002:576) | **owner-only** |
| `edit_shift_payroll_record` (RPC) | `app_is_owner_manager()` (002:617) | **owner-only** |
| RLS `shift_assignments` insert/update (003:160,162) | `app_is_staff_or_above()` | **owner-only** |
| RLS `shift_payroll_records` insert (003:167) | `app_is_staff_or_above()` | **owner-only** |
| RLS `shift_payroll_records` update (003:169) | `app_is_owner_manager()` | **owner-only** |
| RLS reads `shifts_staff_read` (003:158) / `payroll_staff_read` (003:165) | `app_is_staff_or_above()` | **GIỮ NGUYÊN** |
| self check-in/out (`check_in_self`/`check_out_self`) | service-role-only | **GIỮ NGUYÊN** (không liên quan RLS) |

---

## 1. Database (dual-write `002`/`003` + migration `2026-06-27-attendance-lockdown.sql`)

### 1.1 Helper `app_is_owner()` (002, ngay sau `app_is_staff_or_above` 002:46-52)
```sql
create or replace function public.app_is_owner()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select public.app_role() = 'owner'; $$;
```
Dùng cho RPC guard + RLS policy (đồng nhất, dễ test qua `has_function_privilege` không cần — test qua hành vi). Codebase hiện dùng inline `app_role() <> 'owner'` ở ~17 chỗ; helper này gom lại cho 3 RPC + 4 policy của Phase 2b. (Không refactor các chỗ cũ — out of scope.)

### 1.2 Siết guard 3 RPC (002_functions.sql, dual-write canonical)
- `check_in_employee` (002:525): đổi
  `if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền vào ca.';`
  → `if not public.app_is_owner() then raise exception 'Chỉ chủ quán được vào ca hộ. Nhân viên tự vào ca ở màn Chấm công.';`
- `check_out_employee` (002:576): đổi
  `if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền ra ca.';`
  → `if not public.app_is_owner() then raise exception 'Chỉ chủ quán được ra ca hộ. Nhân viên tự ra ca ở màn Chấm công.';`
- `edit_shift_payroll_record` (002:617): đổi
  `if not public.app_is_owner_manager() then raise exception 'Chỉ chủ quán hoặc quản lý được sửa lượt lương đã chốt.';`
  → `if not public.app_is_owner() then raise exception 'Chỉ chủ quán được sửa lượt lương đã chốt.';`

Các phần còn lại của 3 hàm (validate giờ, idempotency, cash-close-final guard ở `edit_shift_payroll_record` 002:634-639, payroll/cash write) **GIỮ NGUYÊN**.

### 1.3 RLS hardening (003_rls.sql, dual-write canonical) — bịt lỗ direct INSERT
Đổi 3 policy WRITE sang owner-only; **giữ** 2 policy READ:
```sql
-- shift_assignments: chỉ owner ghi/sửa; staff_or_above vẫn đọc.
drop policy if exists shifts_staff_write on public.shift_assignments;
create policy shifts_staff_write on public.shift_assignments
  for insert to authenticated with check (public.app_is_owner());
drop policy if exists shifts_staff_update on public.shift_assignments;
create policy shifts_staff_update on public.shift_assignments
  for update to authenticated using (public.app_is_owner()) with check (public.app_is_owner());

-- shift_payroll_records: chỉ owner ghi/sửa; staff_or_above vẫn đọc.
drop policy if exists payroll_staff_write on public.shift_payroll_records;
create policy payroll_staff_write on public.shift_payroll_records
  for insert to authenticated with check (public.app_is_owner());
drop policy if exists payroll_staff_update on public.shift_payroll_records;
create policy payroll_staff_update on public.shift_payroll_records
  for update to authenticated using (public.app_is_owner()) with check (public.app_is_owner());
```
(`shifts_staff_read` 003:158 và `payroll_staff_read` 003:165 **không đổi** → manager/operator vẫn xem trang ca.)

> **Codex finding (Phase 2a §10) đã địa chỉ ở đây:** trước 2b, một staff_operator có thể `supabase.from('shift_payroll_records').insert(...)` thẳng (policy `payroll_staff_write` = staff_or_above), bịa lương bỏ qua `check_out_employee`/`edit_shift_payroll_record`. Sau 2b: chỉ owner. Note delete: không có policy DELETE riêng → DELETE mặc định bị RLS chặn (không thay đổi).

### 1.4 Audit trigger `shift_assignments` (002, cạnh `audit_payroll` 002:1771)
`shift_payroll_records` đã có `audit_payroll` (002:1772). Thêm cho `shift_assignments` (chưa có):
```sql
drop trigger if exists audit_shift_assignments on public.shift_assignments;
create trigger audit_shift_assignments
  after insert or update or delete on public.shift_assignments
  for each row execute function public._audit_row_change();
```
Reuse `_audit_row_change()` (002:1744) — ghi `audit_log(action='shift_assignments.{op}', entity_id, diff_json={before,after}, actor_user_id=auth.uid(), actor_role=app_role())`.

> **Giới hạn đã biết (ghi trong spec để Codex không coi là bug):** self check-in/out gọi qua **service role** → `auth.uid()` NULL → `audit_log.actor_user_id` NULL cho các write tự phục vụ. **Actor thật vẫn truy được** từ `diff_json->'after'->>'updated_by'` (self-checkin set `created_by/updated_by = p_auth_user_id`; self-checkout set `updated_by = p_auth_user_id`). Owner manual edit (qua session) → `auth.uid()` = owner, đầy đủ. Chấp nhận trade-off này (không đổi chữ ký RPC để nhồi actor vào trigger).

### 1.5 Migration `database/migrations/2026-06-27-attendance-lockdown.sql`
Byte-identical với phần đổi ở 002/003:
1. `create or replace function public.app_is_owner()...` (1.1).
2. `create or replace function public.check_in_employee/check_out_employee/edit_shift_payroll_record...` — **dán full thân hàm hiện tại với 1 dòng guard đã đổi** (vì migration phải tự đứng được; copy nguyên từ 002 sau khi sửa).
3. 4 `drop policy ... / create policy ...` (1.3).
4. `drop trigger ... / create trigger audit_shift_assignments ...` (1.4).
Idempotent: `create or replace`, `drop ... if exists` + `create policy`. Không data-fix (không đổi dữ liệu cũ).

---

## 2. API / Data layer
**Không thêm route.** Các RPC hiện có (`check_in_employee`/`check_out_employee`/`edit_shift_payroll_record`) sau khi siết sẽ trả lỗi cho non-owner; data layer `src/lib/data/shifts.ts` (`checkInEmployee`/`checkOutEmployee`/`editPayrollRecord`, 23-66) đã `toAppError` → message owner-only nổi lên toast. Không đổi data layer.

**Kiểm tra caller khác (Codex verify):** xác nhận `/api/checkin` route vẫn gọi `check_in_self` (KHÔNG phải `check_in_employee`) và `src/lib/labor-cost.ts` chỉ tham chiếu bảng/tên, không gọi RPC manual — để siết owner-only không vỡ luồng self check-in (Phase 1). Caller thật của 3 RPC manual = chỉ trang ca (`shifts.ts`).

---

## 3. UI (trang ca — `src/features/shifts/*`)
`ShiftsView` (shifts-view.tsx) nhận `role` + hiện có `canManage = role === "owner" || role === "manager"` (49). Thêm:
- `const isOwner = role === "owner";`
- **Gate owner-only** (ẩn hẳn cho non-owner): nút mở `CheckInModal`/`CheckOutModal` (check-in-modal.tsx, check-out-modal.tsx) và nút mở `PayrollEditModal` (payroll-edit-modal.tsx) → render khi `isOwner`. Dùng `isOwner` thay `canManage` ở các action ghi này.
- **Read-only cho non-owner:** manager/operator vẫn thấy `employee-grid.tsx` + `payroll-history-card.tsx` (đọc), nhưng thay nút thao tác bằng dòng nhắc: *"Tự vào/ra ca ở màn Chấm công. Đính chính do chủ quán thực hiện."*
- Giữ `canManage` cho những hiển thị không phải ghi (nếu có) — chỉ chuyển các trigger GHI sang `isOwner`.

**Defense-in-depth:** UI chỉ ẩn nút; enforcement thật ở RPC guard (1.2) + RLS (1.3). Không dựa vào UI để bảo mật.

---

## 4. Edge cases
- Manager/operator bấm (nếu lách UI) → RPC raise owner-only → toast lỗi; direct PostgREST insert/update → RLS chặn (0 rows / 42501).
- Nhân viên KHÔNG có app account (employee_viewer/không tài khoản) không tự chấm công được → **chỉ owner** chấm hộ. (Hệ quả vận hành, không phải bug — xem §7 Risk.)
- Quên ra ca: nhân viên tự ra ca trễ (Phase 2a) **hoặc** owner đính chính. Manager không còn chốt hộ.
- Owner sửa lương sau chốt két final → vẫn chặn bởi guard cash-close-final có sẵn (002:634-639), không đổi.
- self check-in/out vẫn chạy (service-role definer) — không bị RLS owner-only chặn (test ở §5).

## 5. Acceptance criteria + Test plan
**pgTAP** `database/tests/340_attendance_lockdown.sql` (chạy trên throwaway `chill_pgtap`, KHÔNG `supabase-db` dev — xem [[pgtap-run-on-clean-db]]; `tools/pgtap-local.mjs --reset --all`):
- **RPC guard:** giả lập caller `manager` và `staff_operator` (set `request.jwt.claims`) → `check_in_employee`/`check_out_employee`/`edit_shift_payroll_record` đều `throws_like '%Chỉ chủ quán%'`. Caller `owner` → `lives_ok`.
- **RLS owner-only (direct, `set local role authenticated` + claims):**
  - manager/operator: `insert`/`update` thẳng `shift_assignments` và `shift_payroll_records` → **0 rows hoặc lỗi RLS** (dùng `throws_ok`/`is (count) 0` theo pattern 310 `set local role`).
  - owner: insert/update qua RLS → thành công.
  - read: manager/operator vẫn `select` được (đối chứng read không bị siết).
- **self check-in/out KHÔNG vỡ:** với `self_checkout_enabled`, gọi `check_out_self`(employee) như service role → đóng ca + lương OK **dù** RLS shift_assignments/payroll giờ là owner-only (chứng minh security-definer bypass). Tương tự `check_in_self` tạo được `shift_assignments`.
- **Audit trigger:** sau 1 `update` `shift_assignments` (qua owner) → có row `audit_log` `action='shift_assignments.update'`, `entity_id` đúng, `diff_json ? 'before'`. Sau self-checkout → `audit_log` có `shift_assignments.update` với `diff_json->'after'->>'updated_by'` = p_auth_user_id (actor truy được dù actor_user_id null).
- created_at tie-break khi đụng số dư: đóng dấu tăng dần (xem [[pgtap-created-at-frozen-tiebreak]]).

**Vitest:**
- `src/lib/data/shifts.ts`: không đổi logic → không cần test mới; nếu thêm helper role-gate dùng chung, test thuần. (Authz thật ở DB → pgTAP là chính.)
- UI gate: nếu có sẵn pattern test render theo `role` (kiểm tra `shifts-view` không render nút khi `role!=='owner'`) thì thêm; nếu trang ca chưa có harness render → bỏ (gate là defense-in-depth, DB đã chặn). Ghi rõ quyết định trong PR (no silent skip).

**Verify:** `npm run verify:phase` (Vitest + pgTAP) xanh; `npm run build` xanh (KHÔNG build khi `next dev` 3009 chạy). Manual: đăng nhập manager → trang ca không thấy nút Vào/Ra/Sửa, vẫn xem được danh sách; đăng nhập owner → đủ nút; manager vẫn tự vào/ra ca ở màn Chấm công.

## 6. Coverage checklist (đối chiếu yêu cầu user)
- [ ] `check_in_employee` + `check_out_employee` → owner-only (manual chấm công khóa về owner).
- [ ] `edit_shift_payroll_record` (điều chỉnh thời gian/ lương ra vào ca) → owner-only.
- [ ] RLS `shift_assignments` + `shift_payroll_records` WRITE → owner-only; READ giữ cho operator/manager.
- [ ] Bịt lỗ direct PostgREST INSERT payroll (Codex Phase 2a finding [high]).
- [ ] Audit trigger `shift_assignments`.
- [ ] self check-in/out (Phase 1/2a) KHÔNG vỡ — chứng minh bằng pgTAP.
- [ ] UI: ẩn nút ghi cho non-owner, giữ read + nhắc dùng màn Chấm công.
- [ ] Helper `app_is_owner()` + dual-write 002/003 + migration + pgTAP/Vitest theo Test plan.

## 7. Risks / safety notes (cho Codex thẩm định)
1. **RLS owner-only có vỡ self check-in/out không?** KHÔNG. `check_in_self` (002:4479) và `check_out_self` (002:4614) là `security definer` → chạy dưới quyền owner-of-function (bypass RLS), lại được gọi bằng **service role**. RLS `authenticated` owner-only không áp vào chúng. pgTAP §5 chứng minh.
2. **Coupling vận hành — quan trọng:** sau 2b, luồng đóng ca BÌNH THƯỜNG phụ thuộc **self-checkout (Phase 2a) đã bật** (`self_checkout_enabled=true`). Nếu owner để TẮT, **mọi** ca phải do owner đóng tay → nghẽn. **Khuyến nghị:** bật self_checkout trước/đồng thời rollout 2b; hoặc nêu rõ cho user rằng tắt self_checkout sau 2b nghĩa là owner gánh toàn bộ đóng ca. (Không chặn kỹ thuật, là quyết định vận hành.)
3. **Nhân viên không có app account** không tự chấm công → owner chấm hộ (chỉ owner). Chấp nhận; nêu để user biết.
4. **Migration ordering:** 003 có `grant execute on all functions ... to authenticated` (003:57) rồi re-revoke các self-RPC (003:63-66). `app_is_owner()` mới sẽ nhận grant blanket đó (OK, helper không nhạy cảm). 3 RPC manual vẫn `authenticated`-callable (đúng — guard nội bộ tự chặn non-owner). Không cần revoke 3 RPC manual.
5. **Backward-compat dữ liệu:** không drop cột, không sửa dữ liệu cũ; chỉ siết quyền + thêm trigger. Ca/lương lịch sử nguyên vẹn.
6. **Audit volume:** trigger ghi mọi insert/update/delete `shift_assignments` (gồm `set_updated_at` trigger 001:162 chạy before-update không tạo thêm row audit; `_audit_row_change` after-update ghi 1 row/lần). Tần suất hợp lý (mỗi vào/ra ca vài row). Không cần thêm index ngoài `audit_log_entity_idx` (001:478).

## 8. Files (đại diện)
**DB:** `database/migrations/2026-06-27-attendance-lockdown.sql`, `database/002_functions.sql`, `database/003_rls.sql`, `database/tests/340_attendance_lockdown.sql`.
**UI:** `src/features/shifts/shifts-view.tsx`, `check-in-modal.tsx`, `check-out-modal.tsx`, `payroll-edit-modal.tsx`, `employee-grid.tsx`, `payroll-history-card.tsx` (gate nút ghi về `isOwner`).
**Không đụng:** `check_in_self`/`check_out_self`, `/api/checkin`, `/api/checkout`, IP/anchor, toggles.

---

## 9. Đánh số bước implement (TDD)
1. **(test trước)** Viết `340_attendance_lockdown.sql` — RPC guard reject manager/operator; RLS direct write reject; self check-in/out vẫn OK; audit row xuất hiện. Chạy `--reset --all` → **đỏ** (chưa siết).
2. `app_is_owner()` vào 002 + migration.
3. Siết 3 guard RPC (002 + migration full-body copy).
4. 4 policy owner-only (003 + migration).
5. `audit_shift_assignments` trigger (002 + migration).
6. Chạy pgTAP → **xanh** (340 + không regress 310/330 + full suite).
7. UI gate `isOwner` (shifts-view + modals).
8. `tsc` + `npm run test:run` + `npm run build` (khi 3009 tắt). 
9. Manual verify (owner vs manager). Commit → PR → CI → (Codex adversarial review impl nếu muốn) → merge → tag **v4.10.0**.
