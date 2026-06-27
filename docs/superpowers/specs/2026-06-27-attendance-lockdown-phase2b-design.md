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
3. RLS hardening: **BỎ HẲN** policy WRITE (insert/update) trên `shift_assignments` + `shift_payroll_records` → KHÔNG role `authenticated` nào ghi trực tiếp (mọi write qua security-definer RPC, bypass RLS); **GIỮ** read = `app_is_staff_or_above()`. *(Codex #1: owner direct-write cũng lách guard cash-close-final → chặn TẤT CẢ direct write, không chỉ non-owner.)*
4. Audit attendance: trigger riêng `_audit_attendance_change()` cho `shift_assignments` (mới) + `shift_payroll_records` (thay `audit_payroll`) — coalesce actor để audit-by-actor dùng được cho cả write tự phục vụ. *(Codex #2.)*
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
| RLS `shift_assignments` insert/update (003:160,162) | `app_is_staff_or_above()` | **BỎ policy (no direct write)** |
| RLS `shift_payroll_records` insert (003:167) | `app_is_staff_or_above()` | **BỎ policy (no direct write)** |
| RLS `shift_payroll_records` update (003:169) | `app_is_owner_manager()` | **BỎ policy (no direct write)** |
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
Dùng cho guard của 3 RPC manual (1.2). **RLS KHÔNG dùng helper này** — Phase 2b bỏ hẳn write policy (1.3), không tạo policy owner-only. Codebase hiện dùng inline `app_role() <> 'owner'` ~17 chỗ; helper gom lại cho 3 RPC. (Không refactor chỗ cũ — out of scope.)

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

### 1.3 RLS hardening (003_rls.sql, dual-write canonical) — chặn MỌI direct write
**Codex #1:** policy owner-only vẫn cho owner `supabase.from('shift_payroll_records').update(...)` thẳng → lách guard cash-close-final trong `edit_shift_payroll_record` (sửa lương ngày đã chốt két mà KHÔNG regenerate `cash_drawer_events`/`cash_close_reports`). Vì **mọi** write hợp lệ đã đi qua security-definer RPC (bypass RLS — xem §7.1), nên **bỏ hẳn** policy WRITE cho `authenticated`; không tạo policy thay thế:
```sql
-- BỎ direct write cho mọi role authenticated. Write chỉ qua security-definer RPC.
drop policy if exists shifts_staff_write on public.shift_assignments;
drop policy if exists shifts_staff_update on public.shift_assignments;
drop policy if exists payroll_staff_write on public.shift_payroll_records;
drop policy if exists payroll_staff_update on public.shift_payroll_records;
-- GIỮ NGUYÊN read: shifts_staff_read (003:158) + payroll_staff_read (003:165) = app_is_staff_or_above().
```
Sau khi bỏ: bảng vẫn `enable row level security` (003:21-22) nhưng KHÔNG còn policy insert/update cho `authenticated` → RLS deny mọi direct insert/update/delete từ client (owner lẫn non-owner). RPC `security definer` chạy dưới owner-of-function (bypass RLS) nên KHÔNG bị ảnh hưởng — đây là đường ghi duy nhất, giữ nguyên các invariant (final-close guard, atomic transition, payroll↔cash đồng bộ).

> **Verify khi implement:** xác nhận data layer (`src/lib/data/shifts.ts`) chỉ ghi qua RPC (`check_in_employee`/`check_out_employee`/`edit_shift_payroll_record`) + read qua `.from().select()`; KHÔNG có `.from('shift_assignments'|'shift_payroll_records').insert/update/delete()` trực tiếp ở client. (grep đã xác nhận tại thời điểm viết.) Các pgTAP fixture insert thẳng chạy như superuser (bypass RLS) → không vỡ.

### 1.4 Audit attendance: `_audit_attendance_change()` cho cả 2 bảng (002, cạnh `_audit_row_change` 002:1744)
**Codex #2:** `_audit_row_change()` (002:1744) dùng `auth.uid()` + `app_role()`. Với write tự phục vụ (gọi qua service role: `check_in_self`/`check_out_self`/`check_out_self`) `auth.uid()` NULL → `actor_user_id` NULL (hỏng index `audit_log_actor_idx`) và `actor_role`='anonymous'. Dùng trigger riêng coalesce actor từ row + snapshot role tại thời điểm ghi:
```sql
create or replace function public._audit_attendance_change()
returns trigger language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_actor uuid;
  v_role text;
begin
  -- auth.uid() (owner manual qua session) → else actor lưu trên row (self-service set updated_by/created_by/edited_by = p_auth_user_id).
  v_actor := coalesce(
    auth.uid(),
    (v_new->>'updated_by')::uuid, (v_new->>'edited_by')::uuid, (v_new->>'created_by')::uuid,
    (v_old->>'updated_by')::uuid, (v_old->>'created_by')::uuid
  );
  -- Snapshot role tại thời điểm ghi (employee_accounts không bị RLS vì definer).
  v_role := coalesce(
    (select role from public.employee_accounts where auth_user_id = v_actor and status = 'active' limit 1),
    public.app_role()
  );
  insert into public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, diff_json)
  values (
    v_actor, v_role,
    tg_table_name || '.' || lower(tg_op), tg_table_name,
    coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid),
    case tg_op
      when 'UPDATE' then jsonb_build_object('before', v_old, 'after', v_new)
      when 'INSERT' then jsonb_build_object('after', v_new)
      else jsonb_build_object('before', v_old) end
  );
  return coalesce(new, old);
end; $$;

-- shift_assignments: MỚI (chưa có audit trigger).
drop trigger if exists audit_shift_assignments on public.shift_assignments;
create trigger audit_shift_assignments after insert or update or delete on public.shift_assignments
  for each row execute function public._audit_attendance_change();

-- shift_payroll_records: THAY audit_payroll (002:1772) để bắt actor cho lương tự-ra-ca.
drop trigger if exists audit_payroll on public.shift_payroll_records;
create trigger audit_payroll after insert or update or delete on public.shift_payroll_records
  for each row execute function public._audit_attendance_change();
```
Kết quả: self check-in/out → `actor_user_id = p_auth_user_id`, `actor_role` = role NV (không null/anonymous); owner manual → `auth.uid()` = owner. Audit-by-actor (`audit_log_actor_idx`) dùng được cho mọi đường ghi. `_audit_row_change()` cũ giữ nguyên cho 7 bảng còn lại (chỉ chuyển 2 bảng attendance sang hàm mới).

### 1.5 Migration `database/migrations/2026-06-27-attendance-lockdown.sql`
Byte-identical với phần đổi ở 002/003:
1. `create or replace function public.app_is_owner()...` (1.1).
2. `create or replace function public.check_in_employee/check_out_employee/edit_shift_payroll_record...` — **dán full thân hàm hiện tại với 1 dòng guard đã đổi** (migration phải tự đứng được; copy nguyên từ 002 sau khi sửa).
3. 4 `drop policy if exists ...` (1.3) — **KHÔNG** tạo lại policy write.
4. `create or replace function public._audit_attendance_change()...` + `drop/create trigger audit_shift_assignments` (shift_assignments) + `drop/create trigger audit_payroll` trỏ sang hàm mới (shift_payroll_records) (1.4).
Idempotent: `create or replace`, `drop policy if exists`, `drop trigger if exists`. Không data-fix (không đổi dữ liệu cũ).

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
- **RLS no-direct-write (direct, `set local role authenticated` + claims):** dùng pattern 310 (`pg_temp.act_as` + `set local role authenticated`, `reset role` sau).
  - **owner** (cũng vậy): `insert`/`update` thẳng `shift_assignments` và `shift_payroll_records` → **0 rows** (RLS deny — không còn write policy). Dùng `is((with x as (insert ... returning 1) select count(*) from x), 0)` hoặc `throws_ok` nếu policy raise. *(Khẳng định Codex #1: owner KHÔNG bypass được qua direct PostgREST.)*
  - **manager/operator**: tương tự → 0 rows.
  - **read**: manager/operator vẫn `select count(*) > 0` từ 2 bảng (read không bị siết).
- **self check-in/out KHÔNG vỡ:** gọi `check_in_self`/`check_out_self` (với `self_checkout_enabled`) như service role → tạo/đóng `shift_assignments` + lương OK **dù** đã bỏ write policy (chứng minh security-definer bypass RLS). Đây là điều kiện sống còn — nếu test này đỏ, lockdown sai.
- **Audit actor (Codex #2):**
  - owner manual `update` `shift_assignments` (qua session, `act_as` owner) → `audit_log` `action='shift_assignments.update'`, `actor_user_id` = owner uid, `actor_role`='owner', `diff_json ? 'before'`.
  - **self check-in** → `audit_log` `action='shift_assignments.insert'` có `actor_user_id = p_auth_user_id` (KHÔNG null) + `actor_role` = role NV (KHÔNG 'anonymous').
  - **self check-out** → `audit_log` cho `shift_assignments.update` **và** `shift_payroll_records.insert` đều có `actor_user_id = p_auth_user_id`. *(Khẳng định trigger mới + audit_payroll trỏ sang hàm mới.)*
- created_at tie-break khi đụng số dư: đóng dấu tăng dần (xem [[pgtap-created-at-frozen-tiebreak]]).

**Vitest:**
- `src/lib/data/shifts.ts`: không đổi logic → không cần test mới; nếu thêm helper role-gate dùng chung, test thuần. (Authz thật ở DB → pgTAP là chính.)
- UI gate: nếu có sẵn pattern test render theo `role` (kiểm tra `shifts-view` không render nút khi `role!=='owner'`) thì thêm; nếu trang ca chưa có harness render → bỏ (gate là defense-in-depth, DB đã chặn). Ghi rõ quyết định trong PR (no silent skip).

**Verify:** `npm run verify:phase` (Vitest + pgTAP) xanh; `npm run build` xanh (KHÔNG build khi `next dev` 3009 chạy). Manual: đăng nhập manager → trang ca không thấy nút Vào/Ra/Sửa, vẫn xem được danh sách; đăng nhập owner → đủ nút; manager vẫn tự vào/ra ca ở màn Chấm công.

## 6. Coverage checklist (đối chiếu yêu cầu user)
- [ ] `check_in_employee` + `check_out_employee` → owner-only (manual chấm công khóa về owner).
- [ ] `edit_shift_payroll_record` (điều chỉnh thời gian/ lương ra vào ca) → owner-only.
- [ ] RLS: BỎ direct WRITE cho **mọi** authenticated (write chỉ qua RPC); READ giữ cho operator/manager. (Codex #1)
- [ ] Bịt lỗ direct PostgREST INSERT/UPDATE payroll — gồm cả owner (Codex Phase 2a [high] + Phase 2b #1).
- [ ] Audit attendance actor-indexable: self check-in/out → `actor_user_id = p_auth_user_id` (Codex #2); trigger cho `shift_assignments` + `shift_payroll_records`.
- [ ] self check-in/out (Phase 1/2a) KHÔNG vỡ — chứng minh bằng pgTAP.
- [ ] UI: ẩn nút ghi cho non-owner, giữ read + nhắc dùng màn Chấm công.
- [ ] Helper `app_is_owner()` + dual-write 002/003 + migration + pgTAP/Vitest theo Test plan.

## 7. Risks / safety notes (cho Codex thẩm định)
1. **Bỏ write policy có vỡ self check-in/out không?** KHÔNG. `check_in_self` (002:4479) + `check_out_self` (002:4614) là `security definer` → chạy dưới owner-of-function (bypass RLS), lại gọi bằng **service role**; không policy write nào áp vào. `check_in_employee`/`check_out_employee`/`edit_shift_payroll_record` cũng `security definer` → owner manual write vẫn qua RPC, không cần policy. pgTAP §5 (self check-in/out vẫn xanh + direct write deny) chứng minh.
2. **Coupling vận hành — quan trọng:** sau 2b, luồng đóng ca BÌNH THƯỜNG phụ thuộc **self-checkout (Phase 2a) đã bật** (`self_checkout_enabled=true`). Nếu owner để TẮT, **mọi** ca phải do owner đóng tay → nghẽn. **Khuyến nghị:** bật self_checkout trước/đồng thời rollout 2b; hoặc nêu rõ cho user rằng tắt self_checkout sau 2b nghĩa là owner gánh toàn bộ đóng ca. (Không chặn kỹ thuật, là quyết định vận hành.)
3. **Nhân viên không có app account** không tự chấm công → owner chấm hộ (chỉ owner). Chấp nhận; nêu để user biết.
4. **Migration ordering:** 003 có `grant execute on all functions ... to authenticated` (003:57) rồi re-revoke các self-RPC (003:63-66). `app_is_owner()` mới sẽ nhận grant blanket đó (OK, helper không nhạy cảm). 3 RPC manual vẫn `authenticated`-callable (đúng — guard nội bộ tự chặn non-owner). Không cần revoke 3 RPC manual.
5. **Backward-compat dữ liệu:** không drop cột, không sửa dữ liệu cũ; chỉ siết quyền + thêm trigger. Ca/lương lịch sử nguyên vẹn.
6. **Audit volume:** `_audit_attendance_change` after-trigger ghi 1 row/insert-update-delete trên `shift_assignments` + `shift_payroll_records` (`set_updated_at` before-trigger 001:162 không tạo row audit). Tần suất hợp lý (mỗi vào/ra ca vài row). Có sẵn `audit_log_entity_idx` (001:478) + `audit_log_actor_idx` (001:479) — finding #2 làm actor index thực sự hữu dụng.

## 8. Files (đại diện)
**DB:** `database/migrations/2026-06-27-attendance-lockdown.sql`, `database/002_functions.sql`, `database/003_rls.sql`, `database/tests/340_attendance_lockdown.sql`.
**UI:** `src/features/shifts/shifts-view.tsx`, `check-in-modal.tsx`, `check-out-modal.tsx`, `payroll-edit-modal.tsx`, `employee-grid.tsx`, `payroll-history-card.tsx` (gate nút ghi về `isOwner`).
**Không đụng:** `check_in_self`/`check_out_self`, `/api/checkin`, `/api/checkout`, IP/anchor, toggles.

---

## 9. Đánh số bước implement (TDD)
1. **(test trước)** Viết `340_attendance_lockdown.sql` — RPC guard reject manager/operator; RLS direct write reject; self check-in/out vẫn OK; audit row xuất hiện. Chạy `--reset --all` → **đỏ** (chưa siết).
2. `app_is_owner()` vào 002 + migration.
3. Siết 3 guard RPC (002 + migration full-body copy).
4. BỎ 4 write policy (003 + migration) — KHÔNG tạo lại.
5. `_audit_attendance_change()` + trigger `audit_shift_assignments` (mới) + trỏ `audit_payroll` sang hàm mới (002 + migration).
6. Chạy pgTAP → **xanh** (340 + không regress 310/330 + full suite).
7. UI gate `isOwner` (shifts-view + modals).
8. `tsc` + `npm run test:run` + `npm run build` (khi 3009 tắt). 
9. Manual verify (owner vs manager). Commit → PR → CI → (Codex adversarial review impl nếu muốn) → merge → tag **v4.10.0**.
