# Spec — "Đổi nhân viên cho tài khoản" (re-point) + gỡ tài khoản kẹt vào NV-ảo

- **Ngày**: 2026-06-26
- **Tác giả**: Claude Code (brainstorm) — đưa Codex review trước khi viết plan/implement
- **Base**: `origin/main` (nhánh release thật; tag `v*` → release Docker). PR vào `main`.
- **Stack liên quan**: Next.js 15 App Router (route handlers) · Supabase Postgres local · RPC security-definer · pgTAP · Vitest.

> **Lưu ý cho reviewer (Codex)**: spec này tự chứa. Mọi đường dẫn file là tương đối repo root. Mục §10 là checklist đối chiếu yêu cầu của user — hãy verify (1) nội dung ĐÚNG và (2) COVER HẾT.

---

## 1. Bối cảnh & vấn đề (đã điều tra + xác minh)

Trang Settings "Thêm tài khoản" (`POST /api/users`) **luôn** gắn tài khoản vào một nhân viên: nếu không truyền `employee_id`, route tự `INSERT` một `employees` MỚI rồi gắn account vào đó (`src/app/api/users/route.ts:143-163`). Hệ quả lịch sử: nhiều account đã bị tạo kèm **nhân viên ảo/trùng** và "kẹt" vào NV đó.

- `PATCH /api/users/[id]` **chặn re-point**: nếu account đã có `employee_id` mà truyền `employee_id` mới → HTTP 409 "Tài khoản này đã gắn nhân viên — không thể đổi" (`src/app/api/users/[id]/route.ts:119-122`).
- `GET /api/users/unlinked` chỉ lấy account `employee_id IS NULL` → các account kẹt **không bao giờ** xuất hiện ở picker "Liên kết TK có sẵn" trên trang ca.
- Unique index `employee_accounts_one_account_per_employee` trên `(employee_id) WHERE employee_id IS NOT NULL` (`database/001_schema.sql:225-226`) → một NV tối đa 1 account.

**Đợt 1 (đã xong, v4.5.2)**: guardrail đã CHẶN tạo trùng về sau — modal "Thêm tài khoản" bắt buộc chọn rõ "gắn NV có sẵn" vs "➕ tạo NV mới" (`src/features/settings/create-account-modal.tsx`).

**Đợt 2 (spec này)**: cung cấp công cụ **GỠ các account đã lỡ kẹt** — cho owner gắn lại (re-point) một account đang gắn NV-ảo sang một NV đích chưa có tài khoản, và xử lý NV nguồn an toàn.

## 2. Quyết định sản phẩm (user đã chốt)

1. **NV nguồn**: KHÔNG bao giờ hard-delete. Re-point xong **deactivate** NV nguồn (`employees.is_active = false`), kể cả khi NV nguồn rỗng data và kể cả khi NV nguồn có ca/lương (data con giữ nguyên, gắn với NV nguồn nay inactive). → Bỏ hoàn toàn logic xoá + check FK rỗng.
2. **Quyền**: **chỉ owner** dùng được re-point. Manager vẫn tạo/sửa/vô hiệu hoá TK như cũ, chỉ KHÔNG re-point.
3. **Phạm vi**: **chỉ công cụ thủ công** (owner re-point từng TK qua UI, có xác nhận). KHÔNG làm bulk auto-cleanup trong đợt này.
4. **Chặn self re-point**: không cho đổi NV cho chính tài khoản đang đăng nhập (gần như luôn là nhầm; tránh owner tự deactivate NV của chính mình).
5. **UI**: bước xác nhận inline tách khỏi nút "Lưu" của luồng sửa field — re-point là thao tác riêng, phá huỷ nhẹ (deactivate NV nguồn), nên cần xác nhận rõ.

## 3. Phân tích FK tới `employees(id)` (vì sao "chỉ deactivate" là an toàn)

| Bảng con | Cột | ON DELETE | Ảnh hưởng khi re-point |
|---|---|---|---|
| `employee_accounts` | `employee_id` | `set null` | Ta UPDATE cột này (re-point), không xoá |
| `expense_history_permissions` | `employee_id` | `cascade` | KHÔNG đụng (không xoá NV) → giữ nguyên |
| `shift_assignments` | `employee_id` | (mặc định NO ACTION) | KHÔNG đụng → giữ nguyên, gắn NV nguồn inactive |
| `shift_payroll_records` | `employee_id` | (mặc định NO ACTION) | KHÔNG đụng → giữ nguyên |

Vì không xoá NV nguồn, **không có nguy cơ** cascade mất `expense_history_permissions` hay bị FK RESTRICT chặn. Toàn bộ lịch sử ca/lương/quyền của NV nguồn được bảo toàn.

## 4. Kiến trúc đã chọn (Phương án A)

**RPC security-definer (nguyên tử) + route mỏng + UI trong Edit modal.** Khớp 100% precedent `check_in_self` (`database/002_functions.sql:4478`, dual-write ở `database/migrations/2026-06-25-employee-self-checkin.sql`).

> Phương án B (nới guard PATCH, ghi tuần tự trong route) bị loại: không nguyên tử, trộn thao tác phá huỷ vào luồng sửa field, route không có Vitest precedent → khó kiểm chứng.

### 4.1 RPC `public.repoint_account(p_auth_user_id uuid, p_target_employee_id uuid, p_expected_source_employee_id uuid)`

- **Chữ ký & thuộc tính**: `returns jsonb language plpgsql security definer set search_path = public, auth`. Tham số thứ 3 `p_expected_source_employee_id` = NV nguồn mà UI thấy lúc mở modal (chống stale — xem [NB-1]).
- **Service-role-only** (route đã verify JWT owner → `p_auth_user_id` tin cậy):
  `revoke execute on function public.repoint_account(uuid, uuid, uuid) from public, anon, authenticated;`
  `grant execute on function public.repoint_account(uuid, uuid, uuid) to service_role;`
- **Thuật toán (1 transaction — toàn bộ thân hàm)**:
  1. `p_auth_user_id`/`p_target_employee_id`/`p_expected_source_employee_id` null → `raise … errcode 'P0001'`.
  2. **Lock row account**: `SELECT id, employee_id INTO v_acc … FROM employee_accounts WHERE auth_user_id = p_auth_user_id FOR UPDATE`. Không có → `raise … errcode 'P0002'` ("Không tìm thấy tài khoản."). (`FOR UPDATE` serialize mọi re-point đồng thời trên CÙNG account — chống TOCTOU, [B-NEW].)
  3. Account `employee_id IS NULL` → `raise … errcode 'P0001'` ("Tài khoản chưa gắn nhân viên — dùng chức năng liên kết."). (Re-point chỉ cho account ĐÃ gắn.)
  4. `source_employee_id = v_acc.employee_id`. Nếu `source_employee_id = p_target_employee_id` → `raise … errcode 'P0001'` ("Tài khoản đã gắn đúng nhân viên này rồi.").
  5. Load NV đích (`id, name, is_active`). Không tồn tại hoặc `is_active=false` → `raise … errcode 'P0002'` ("Nhân viên đích không tồn tại hoặc đã nghỉ.").
  6. NV đích đã có account (`SELECT 1 FROM employee_accounts WHERE employee_id = p_target`) → `raise … errcode '23505'` ("Nhân viên đích đã có tài khoản.").
  7. **[B-NEW] Atomic conditional UPDATE** (stale guard [NB-1] + serialize trong 1 câu lệnh, KHÔNG đọc-rồi-ghi):
     `UPDATE employee_accounts SET employee_id = p_target WHERE auth_user_id = p_auth_user_id AND employee_id = p_expected_source_employee_id;` → nếu `NOT FOUND` (`GET DIAGNOSTICS` / `ROW_COUNT = 0`) → `raise … errcode 'P0001'` ("Dữ liệu đã thay đổi — tải lại trang rồi thử lại."). (Unique partial index `employee_accounts_one_account_per_employee` là backstop cho đua 2 account→cùng target → 23505.)
  8. `UPDATE employees SET is_active = false WHERE id = source_employee_id`.
  9. **[B-3] Upsert profile** (KHỚP PATCH `[id]/route.ts:175` dùng upsert): `INSERT INTO profiles (id, display_name) VALUES (p_auth_user_id, <target.name>) ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name`. (Đảm bảo display_name = tên NV đích kể cả khi thiếu profile row → thoả acceptance §6.1.)
  10. `return jsonb_build_object('auth_user_id', p_auth_user_id, 'employee_id', p_target, 'source_employee_id', source_employee_id, 'source_deactivated', true)`.
- **[B-1] Triple-write** (lock-down phải sống sót cả DB sạch lẫn restore-replay):
  - `database/002_functions.sql`: `create or replace function` + `revoke/grant` (canonical).
  - `database/003_rls.sql`: **re-assert** `revoke … from public, anon, authenticated; grant … to service_role;` cho `repoint_account(uuid,uuid,uuid)` **ngay sau** blanket grant ở `003_rls.sql:57` (cạnh khối check_in_self/fresh_anchor_ips/record_shop_anchor_heartbeat ở dòng 63-71). **Bắt buộc** — nếu thiếu, blanket grant ở 003 sẽ cấp lại execute cho `authenticated` trên DB sạch (lỗ hổng: client gọi thẳng RPC service-definer).
  - `database/migrations/2026-06-26-repoint-account.sql`: `create or replace function` + `revoke/grant` (nâng cấp DB đang chạy). Trùng khít định nghĩa hàm với 002 (dual-write byte-identical; precedent self-checkin).
- **Idempotent**: `create or replace function` + `revoke/grant` (chạy lại an toàn).

### 4.2 Route `POST /api/users/[id]/repoint`

- File: `src/app/api/users/[id]/repoint/route.ts`. `export const dynamic = "force-dynamic"; export const runtime = "nodejs";`
- Auth: `requireAuth(authHeader, ["owner"])` (chỉ owner). Map lỗi auth: thiếu/lỗi token → 401; sai role → 403 (giống các route khác). **Owner-only được enforce bằng `requireAuth(["owner"])`** — đúng pattern mọi route `/api/users*` đang dùng.
- `id` = auth_user_id của account cần re-point. Body: `{ target_employee_id: string, source_employee_id: string }` ([NB-1]). Thiếu/không phải uuid hợp lệ → 400.
- **Chặn self**: nếu `id === caller.userId` → 400 "Không thể đổi nhân viên cho chính tài khoản của bạn."
- Gọi `getServiceRoleClient().rpc("repoint_account", { p_auth_user_id: id, p_target_employee_id, p_expected_source_employee_id: source_employee_id })`.
- **[B-2] Tách logic thuần để Vitest test được** (route handler không có precedent test trong repo → đưa phần kiểm chứng được ra helper thuần):
  - `mapRepointErrorStatus(code: string | undefined): number` — `'23505'`→409; `'P0002'`→404; còn lại (`'P0001'`/undefined)→400. (Mẫu PATCH map `'23505'` ở `[id]/route.ts:146`.)
  - `validateRepointBody(body): { target_employee_id, source_employee_id } | { error }` — kiểm 2 field có mặt + đúng dạng uuid.
  - `isSelfRepoint(callerUserId, targetAuthUserId): boolean`.
  - Đặt ở `src/lib/repoint-account.ts` (logic thuần, không import server-only). Route import + dùng. Trả `{ status:'ok', ... }` khi thành công.

### 4.3 Data layer + hook + UI

- `src/lib/data/accounts.ts`: thêm `repointAccount(supabase, authUserId, targetEmployeeId, sourceEmployeeId)` — `POST` tới `/api/users/${authUserId}/repoint` với body `{ target_employee_id, source_employee_id }` ([NB-1]), ném `Error(json.error)` khi !ok (mẫu `updateUserAccount`).
- `src/hooks/mutations/use-settings-mutations.ts`: thêm `useRepointUser(supabase)` — invalidate đúng các query mà `updateUser`/`deactivateUser` đang invalidate (settings accounts, accounted employee ids, employees, account hiện tại). *(Plan sẽ liệt kê chính xác query keys sau khi đọc file này.)*
- `src/features/settings/edit-account-modal.tsx`: khi **owner (`approverRole==='owner'`) + account đã gắn NV (`!isUnlinked`) + không phải self (`!isSelf`)** → thêm mục "Đổi nhân viên cho tài khoản":
  - `Select` chọn NV đích từ `unlinkedEmployees` (đã được truyền sẵn vào modal — active & chưa có TK; `settings-view.tsx:84-87`).
  - Khi đã chọn → hiện dòng xác nhận: *"Nhân viên nguồn «{employee_name}» sẽ chuyển sang Nghỉ; tài khoản sẽ gắn vào «{tên NV đích}»."* + nút riêng **"Đổi nhân viên"** (tách khỏi "Lưu"); có trạng thái loading.
  - Gọi `useRepointUser` với `(account.auth_user_id, targetEmployeeId, account.employee_id)` — truyền `account.employee_id` làm `sourceEmployeeId` để backend chống stale ([NB-1]).
  - Thành công → toast success + đóng modal (queries tự refetch).
  - `unlinkedEmployees.length === 0` → hiện text "Không có nhân viên (chưa có TK) để chuyển sang."
- Không đổi `AccountsManagerCard` (đã truyền `unlinkedEmployees` + `approverRole`/`currentUserRole`).

## 5. Hành vi & edge cases

- Re-point thành công khi NV nguồn **có** shift/payroll: vẫn cho phép, NV nguồn → inactive, data con giữ nguyên (quyết định §2.1).
- Self re-point: chặn ở route (400) **và** ẩn mục re-point ở UI khi `isSelf`.
- Account `owner`: chỉ owner mới vào được route (owner-only) → `assertCanModifyTarget(owner, owner)` không cần thiết vì caller chắc chắn là owner; không thêm ràng buộc.
- Đua điều kiện (NV đích vừa được cấp TK giữa lúc check và write): backstop unique index → 23505 → 409.
- NV đích inactive: từ chối (P0002) — nhất quán với filter `unlinkedEmployees` (chỉ active).

## 6. Acceptance criteria

1. Owner re-point một account đang gắn NV-ảo X sang NV đích Y (active, chưa có TK): account.employee_id = Y; X.is_active = false; profiles.display_name = tên Y (**kể cả khi account thiếu profiles row trước đó** — upsert tạo mới, [B-3]); `{status:'ok'}`.
2. Re-point khi X có dữ liệu con: thành công; `shift_assignments`, `shift_payroll_records`, `expense_history_permissions` của X **vẫn còn** và vẫn trỏ X; X.is_active=false ([NB-2]).
3. Re-point sang NV đã có TK → 409. Sang NV inactive/không tồn tại → 404. Account chưa gắn NV → 400. target==source → 400. **source kỳ vọng không khớp (stale) → 400** ([NB-1]). Self → 400. Non-owner (manager) gọi route → 403.
4. RPC `repoint_account` bị `revoke` khỏi `authenticated` **trên DB sạch (sau khi áp 001→002→003)** — chỉ `service_role` execute được ([B-1]).
5. Unique `employee_accounts(employee_id)` vẫn giữ sau re-point (không tạo NV đích có 2 TK).
6. **Helper thuần** `mapRepointErrorStatus`/`validateRepointBody`/`isSelfRepoint` có Vitest xanh ([B-2]).
7. `npm run verify:phase` xanh (Vitest + pgTAP). `npm run lint`/typecheck xanh.

## 7. Test plan

### 7.1 pgTAP — `database/tests/320_repoint_account.sql` (chạy trên throwaway DB: auth-mock + 001 + 002 + 003 + migrations)
Mẫu theo `database/tests/310_self_checkin.sql` (fixtures auth.users/employees/employee_accounts; `pg_temp.act_as` nếu cần; gọi RPC trực tiếp). Gọi hàm dạng `repoint_account(p_auth_user_id, p_target, p_expected_source)`. Các assert:
1. Happy path (nguồn rỗng data, **không** seed profiles row trước): sau `repoint_account(acc, Y, X)` → account.employee_id = Y; X.is_active=false; **profiles row được tạo + display_name = tên Y** (kiểm upsert, [B-3]).
1b. Happy path khi ĐÃ có profiles row cũ: display_name bị ghi đè = tên Y.
2. Nguồn CÓ dữ liệu con — seed `shift_assignments` + `shift_payroll_records` + `expense_history_permissions` cho X → re-point → **cả 3** vẫn tồn tại & trỏ X; X.is_active=false ([NB-2]).
3. Target đã có TK → `throws_ok`/`throws_like` (errcode 23505 hoặc message).
4. Target inactive → throws (P0002).
5. Target không tồn tại → throws (P0002).
6. Account unlinked (employee_id NULL) → throws (P0001).
7. target == source → throws (P0001).
8. **Stale source**: `p_expected_source` ≠ employee_id hiện tại → throws (P0001) ([NB-1]).
9. Grant ([B-1]): `has_function_privilege('service_role', 'public.repoint_account(uuid,uuid,uuid)', 'execute')` = true; `... 'authenticated' ...` = false.
   - **[NB-NEW] Caveat thứ tự apply**: throwaway DB áp 001→002→003→**migrations**, mà migration cũng có `revoke/grant` → test này verify trạng thái *hiệu lực cuối cùng* (đúng cái app chạy), KHÔNG phân biệt được "lock-down đến từ 003" hay "từ migration". Phần re-assert ở `003_rls.sql` (canonical, cho DB sạch KHÔNG có migration trong tương lai) được đảm bảo bằng: (a) §8 liệt kê sửa `003_rls.sql`; (b) code review đối chiếu khối dòng 63-71. Ghi rõ caveat này trong comment đầu file test.
10. Unique index `employee_accounts_one_account_per_employee` vẫn còn hiệu lực — thử cấp TK thứ 2 cho Y → lỗi 23505.

> **Số plan**: cập nhật `select plan(N)` đúng số assert. Đăng ký file vào runner nếu cần (kiểm `scripts/pgtap-run.mjs` / `tools/pgtap-local.mjs` — file mới trong `database/tests/` thường tự được iterate; xác nhận khi implement).

### 7.2 Vitest — `src/lib/__tests__/repoint-account.test.ts` ([B-2])
- Toàn bộ test hiện tại giữ xanh (`npm run test:run`).
- `mapRepointErrorStatus`: `'23505'`→409, `'P0002'`→404, `'P0001'`→400, `undefined`→400.
- `validateRepointBody`: thiếu `target_employee_id` / thiếu `source_employee_id` / không phải uuid → error; hợp lệ → parsed object.
- `isSelfRepoint`: caller == target → true; khác → false.
- **Trung thực**: route handler không có Vitest precedent trong repo → owner-only/self/HTTP-wiring được enforce bằng `requireAuth(["owner"])` + guard + helper thuần (đã test); phần ráp HTTP cuối cùng verify thủ công (§7.3). Không bịa "toàn route được unit-test".

### 7.3 Thủ công (sanity, không gate)
- Bật DB, đếm `SELECT count(*) FROM employee_accounts WHERE employee_id IS NULL;` và `SELECT name, count(*) FROM employees GROUP BY name HAVING count(*)>1;` để biết quy mô TK kẹt (chỉ để báo cáo, không đổi thiết kế).
- Chạy app (port 3009), owner re-point thử 1 TK, xác nhận UI + DB.

## 8. File sẽ tạo/sửa

**Tạo**
- `database/migrations/2026-06-26-repoint-account.sql` (RPC + grants).
- `src/app/api/users/[id]/repoint/route.ts` (POST, owner-only).
- `src/lib/repoint-account.ts` (helper thuần: `mapRepointErrorStatus`, `validateRepointBody`, `isSelfRepoint` — [B-2]).
- `src/lib/__tests__/repoint-account.test.ts` (Vitest cho helper — [B-2]).
- `database/tests/320_repoint_account.sql` (pgTAP).

**Sửa**
- `database/002_functions.sql` (thêm `repoint_account` canonical, trùng khít migration).
- `database/003_rls.sql` (**re-assert revoke/grant** `repoint_account(uuid,uuid,uuid)` sau blanket grant — [B-1], bắt buộc).
- `src/lib/data/accounts.ts` (`repointAccount`).
- `src/hooks/mutations/use-settings-mutations.ts` (`useRepointUser`).
- `src/features/settings/edit-account-modal.tsx` (mục re-point owner-only).

**Không đổi (xác nhận)**: `src/app/api/users/[id]/route.ts` (guard 409 của PATCH GIỮ NGUYÊN — PATCH không được re-point; route mới là đường duy nhất). `create-account-modal.tsx`, `unlinked/route.ts`.

## 9. Giả định

- `p_auth_user_id` truyền vào RPC là tin cậy vì route đã `requireAuth(["owner"])` (mẫu service-role-only `check_in_self`).
- PostgREST trả `error.code` = SQLSTATE của exception trong RPC (đã dùng ở PATCH với `'23505'`).
- `unlinkedEmployees` trong Edit modal = active & chưa có TK (đúng nguồn cho NV đích).
- Migration mới được runner áp sau 001/002/003 trên throwaway DB (precedent self-checkin).

## 10. Checklist coverage (đối chiếu yêu cầu user — để Codex tick)

- [ ] Thêm tính năng "Đổi nhân viên cho tài khoản" (re-point) cho account đã gắn → NV đích chưa có TK. (§4.1, §4.3)
- [ ] Chỉ owner. (§2.2, §4.2)
- [ ] NV nguồn KHÔNG xoá — chỉ `is_active=false`. (§2.1, §4.1 b8)
- [ ] Không tự merge FK ca/lương; data con NV nguồn giữ nguyên. (§3, §5)
- [ ] NV đích phải active & chưa có TK (ràng buộc unique). (§4.1 b5-b6, §5)
- [ ] Toàn bộ trong 1 transaction (nguyên tử). (§4.1)
- [ ] Rà mọi FK tham chiếu employees. (§3)
- [ ] Role ceiling: owner-only đủ; không nới quyền ngoài ý định. (§4.2, §5)
- [ ] Chặn self re-point. (§2.4, §4.2, §4.3)
- [ ] UI trong Edit Account modal, bước xác nhận tách khỏi "Lưu". (§2.5, §4.3)
- [ ] TDD: pgTAP + Vitest xanh; có test cho mọi nhánh. (§6, §7)
- [ ] **Triple-write RPC lock-down (002 + 003 + migration)** — re-assert revoke/grant sau blanket grant 003 ([B-1]). (§4.1, §8)
- [ ] **Upsert profile** (khớp PATCH), không UPDATE-only ([B-3]). (§4.1 b10)
- [ ] **Stale-source guard** `p_expected_source_employee_id` ([NB-1]). (§4.1 b7, §4.2, §4.3)
- [ ] **Concurrency-safe**: `FOR UPDATE` + atomic conditional UPDATE (không TOCTOU) ([B-NEW]). (§4.1 b2, b7)
- [ ] **Helper thuần + Vitest** cho mapper/validate/self ([B-2]). (§4.2, §7.2)
- [ ] **pgTAP assert cả 3 bảng con** giữ nguyên ([NB-2]). (§7.1 #2)
- [ ] Base off origin/main, PR vào main, tag vX.Y.Z khi xong. (header)
- [ ] Đếm số TK kẹt trước khi code (sanity). (§7.3)

## 11. Ngoài phạm vi (out of scope)

- Bulk auto-cleanup NV-ảo (đã chốt: chỉ thủ công).
- Hard-delete NV nguồn.
- Đổi luồng `POST /api/users` hay guard 409 của PATCH.
- Gộp/transfer lịch sử ca/lương giữa 2 NV.
- Xoá hẳn auth user.

## 12. Codex review (2026-06-26) — findings & xử lý

Spec v1 bị Codex **REJECT**. Đã xác minh từng finding (đúng cả 5) và sửa:

- **[B-1] (blocking, security)** Thiếu re-assert lock-down ở `003_rls.sql` (blanket grant dòng 57 cấp lại execute cho `authenticated` sau 002). → **Đã sửa**: triple-write 002+003+migration (§4.1, §8); acceptance §6.4 + pgTAP §7.1 #9 kiểm trên DB sạch sau 001→002→003.
- **[B-2] (blocking)** Yêu cầu route-only (self=400, owner=403, SQLSTATE→HTTP) không có test. → **Đã sửa**: tách helper thuần `src/lib/repoint-account.ts` + Vitest (§4.2, §7.2, §8); owner-only qua `requireAuth(["owner"])`.
- **[B-3] (blocking)** Spec dùng `UPDATE profiles` nhưng PATCH dùng upsert → thiếu profile row sẽ fail acceptance. → **Đã sửa**: upsert `ON CONFLICT (id)` (§4.1 b10); pgTAP §7.1 #1/#1b.
- **[NB-1]** Confirm không bind NV nguồn (stale UI). → **Đã thêm** `p_expected_source_employee_id` + guard (§4.1 b4, §4.2, §4.3); pgTAP §7.1 #8.
- **[NB-2]** pgTAP chỉ kiểm 1 bảng con. → **Đã mở rộng** kiểm cả `shift_assignments`+`shift_payroll_records`+`expense_history_permissions` (§7.1 #2).

### Codex re-review v2 (resumed thread) — REJECT với 1 finding blocking MỚI, đã sửa:

- **[B-NEW] (blocking)** Stale guard read-then-write (TOCTOU) → 2 concurrent re-point cùng account đều pass rồi UPDATE nối tiếp. → **Đã sửa**: (a) `SELECT … FOR UPDATE` lock row account (§4.1 b2); (b) atomic conditional `UPDATE … WHERE auth_user_id=… AND employee_id = p_expected_source_employee_id`, `NOT FOUND` → P0001 (§4.1 b7). Bỏ hẳn bước đọc-rồi-so-sánh riêng.
- **[NB-NEW]** Test grant #9 có thể bị migration che (không phân biệt nguồn lock-down). → **Đã ghi caveat** + dựa code review cho 003 reassert (§7.1 #9).

**Codex đã verified đúng:** chữ ký 3-tham-số nhất quán; profile upsert trong security-definer OK (RLS `profiles` không forced, có precedent `002_functions.sql:1841-1855`, không cần grant thêm); thứ tự migration `anchor` < `repoint` OK; toàn bộ B-1..NB-2 v1 đã address đúng.

**Lưu ý khi implement (Codex nhắc):** `src/lib/repoint-account.ts` phải KHÔNG import server-only (giữ pure để Vitest chạy) — enforce lúc viết code.
