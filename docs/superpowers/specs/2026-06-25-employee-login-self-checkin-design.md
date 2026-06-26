# Chấm công nhân viên qua đăng nhập (self-check-in) — cổng kép: danh tính + IP quán

**Ngày:** 2026-06-25
**Loại:** Feature (employee self-check-in qua web app điện thoại, có đăng nhập) — bảo mật-nhạy cảm
**Trạng thái:** Spec (brainstorm đã chốt) — chờ Codex review → chuyển sang planning

> **Supersedes:** `docs/superpowers/specs/2026-06-24-qr-ip-kiosk-checkin-design.md` (mô hình kiosk PIN/không-login) và plan `docs/superpowers/plans/2026-06-24-qr-ip-kiosk-checkin.md` — **cả hai đã được đánh dấu SUPERSEDED — KHÔNG IMPLEMENT** (Codex finding #5). Lý do đổi: thay vì định danh bằng mã PIN không-đăng-nhập (chấp nhận check-in hộ), **mỗi nhân viên có TÀI KHOẢN đăng nhập và tự bấm chấm công**. Cổng "có mặt" bằng IP công cộng của quán (anchor-heartbeat) **được giữ lại** nhưng đặt LÊN TRÊN lớp đăng nhập. Phần IP-allowlist/anchor/parseClientIp tái dùng gần như nguyên vẹn từ spec cũ; phần định danh + RPC ghi check-in được làm lại theo hướng authenticated.

> **Đã sửa theo Codex adversarial review vòng 1 (2026-06-25):** (1) RPC `check_in_self` chuyển **service-role-only** để client không gọi thẳng bỏ qua cổng IP (§5.3, §6); (2) provisioning **LINK** nhân viên có sẵn thay vì tạo trùng + invariant unique `employee_id` (§5.7); (3) anchor IP **hết hạn theo `grace_hours`** + fail-closed khi không còn anchor tươi (§5.5, §7); (4) migration unique index có **preflight dò + dọn trùng** trước khi tạo (§5.2). Mỗi mục đánh dấu "(Codex #n)".

> **Đã sửa theo verification + Codex vòng 2 (2026-06-25):** (R1) định nghĩa role `employee_self_service` xuyên suốt `UserRole`/`requireAuth`/navigation/CHECK (đặt TÊN constraint) — §5.1; (R2) cổng app **chặn truy cập trực tiếp port thô**: bind loopback + reverse-proxy + **secret header proxy** route bắt buộc (constant-time) → chống gửi thẳng `X-Forwarded-For` giả (§6, §7-C1); (R3) **role ceiling**: chỉ owner cấp/sửa role `owner`; manager chỉ thao tác role thấp hơn — sửa `approve` + `/api/users` POST + `/api/users/[id]` PATCH (§5.8, §7-C2); (R4) IP gate **fail-CLOSED & trạng thái setup**: lỗi đọc/thiếu config hoặc chưa có anchor → **503 "chưa cấu hình"**, KHÔNG bao giờ "bỏ qua IP rồi cho check-in"; `enabled=false` = tính năng TẮT (503), không phải mở (§6, §7-C3); (R5) **siết RLS**: loại `employee_self_service` khỏi đọc dữ liệu vận hành (ingredients/menu_items/recipes/recipe_items/stock_movements) + pgTAP chặn (§5.9, §7-C5); (R6) migration **RAISE EXCEPTION dừng deploy** nếu chưa lập được cả 2 unique index (không WARNING rồi bỏ qua) — vì `check_in_self` phụ thuộc index (§5.2); (R7) freshness cutoff tính **phía Postgres** (`now() - interval`), không dùng JS clock; chặn bật gate khi chưa anchor nào có IP (§5.5, §6). Sửa khác: contract `authHeader` trả object (§6), render cột audit IP/UA (§8), consent PDPL trên màn chấm công (§7), tiebreak dedup `NULLS FIRST, created_at, id` (§5.2).

---

## 1. Mục tiêu
Nhân viên mở web app trên **điện thoại cá nhân**, **đăng nhập** (Supabase email + mật khẩu), bấm **"Vào ca"** để chấm công. Một check-in chỉ hợp lệ khi đồng thời:
1. **Danh tính**: là một `employee_accounts` đang `active`, đã link tới một `employees` row. Danh tính lấy từ **phiên đăng nhập** (`auth.uid()`), KHÔNG từ mã nhập tay → nhân viên chỉ có thể chấm công **cho chính mình**.
2. **Hiện diện**: request đi ra internet qua **IP công cộng của quán** (nằm trong allowlist anchor). App deploy từ xa qua public domain nên server chỉ thấy IP egress của đường mạng quán.

## 2. Quyết định đã chốt với owner (brainstorm 2026-06-25)
| # | Quyết định | Chốt |
|---|---|---|
| 1 | **Cổng hiện diện** | Danh tính **+** IP quán (giữ cơ chế anchor-heartbeat, đặt trên login) |
| 2 | **Loại tài khoản** | Supabase **email + mật khẩu** (tái dùng `/login`, `/api/users`, `requireAuth`) |
| 3 | **Role check-in** | **Role mới `employee_self_service`** (ít quyền nhất — chỉ dữ liệu của chính mình) |
| 4 | **Self check-OUT** | **Không** — nhân viên chỉ tự VÀO ca; ra ca vẫn do operator/manager (giữ tính lương/cash dưới kiểm soát operator) |
| 5 | **Backstop duyệt** | **Tự duyệt** (`confirmed_by_manager` giữ hiệu lực confirmed) + **dấu IP/thiết bị mỗi lần check-in** làm audit |
| 6 | **Lịch sử truy cập** | Dấu `check_in_ip` + `check_in_user_agent` trên shift; KHÔNG bảng login-log riêng; `auth.audit_log_entries` (Supabase) làm forensic fallback |
| 7 | **Quy tắc mạng** | **Bắt buộc wifi quán** (4G/5G sẽ bị chặn vì egress qua carrier); báo lỗi rõ ràng |
| 8 | **Provisioning** | Self-signup → owner duyệt 1 lần (tái dùng `signup_requests`), gán `employee_self_service`, link `employees` |
| 9 | **Quên mật khẩu** | Thêm flow cơ bản `resetPasswordForEmail` (hiện chưa có) |

### Rủi ro đã chấp nhận (ghi rõ, không xử lý v1)
- **Wifi-only**: nhân viên ở quán nhưng dùng 4G → bị chặn (đúng thiết kế). Cần hướng dẫn "nối wifi quán".
- **Chia sẻ mật khẩu tại chỗ**: đồng nghiệp đang ở quán đăng nhập hộ bằng mật khẩu người khác → cùng IP quán nên qua được cổng. **Giảm thiểu** (không loại bỏ) bằng dấu IP/thiết bị mỗi check-in (owner soát bất thường: 2 thiết bị/1 người, user-agent lạ).
- **CGNAT / VPN-vào-quán**: như spec cũ — không kiểm v1.

## 3. Hiện trạng đã khảo sát (tái dùng) — trích từ codebase
- **Auth dùng được nguyên xi cho điện thoại**: `signInWithPassword` (`src/hooks/use-auth-session.ts:84-89`); browser client `persistSession=true`, `autoRefreshToken=true` (`src/lib/supabase/client.ts:18-36`) → phiên sống qua reload/đóng-mở app. Token cho API: helper `authHeader(supabase)` (`src/lib/data/accounts.ts:5-9`); server `requireAuth(authHeader, roles[])` (`src/lib/supabase/server.ts:50-83`); `getUserClient(authHeader)` để RLS chạy theo người gọi.
- **Role + gate**: 4 role (`database/001_schema.sql:56`, CHECK constraint). `app_role()` (`002_functions.sql:21-33`), `app_is_owner_manager()`, `app_is_staff_or_above()` (loại trừ `employee_viewer`, `002_functions.sql:43-49`).
  - ⚠️ `employee_viewer` **đọc được `employees` toàn bộ kể cả `hourly_rate`** (`003_rls.sql:89`) → KHÔNG dùng cho nhân viên thường (rò rỉ lương). `staff_operator` thì over-privileged (mở cash/expense/sales). → cần role mới (§5.1).
- **Check-in hiện tại**: `check_in_employee(p_payload jsonb)` (`002_functions.sql:510-552`) gate `app_is_staff_or_above()`, idempotent bằng SELECT-then-INSERT (**không atomic**), `created_by=auth.uid()`. `shift_assignments` (`001_schema.sql`) có `confirmed_by_manager` **default true** (`001_schema.sql:152`); chỉ trigger `set_updated_at`.
- **Provisioning**: owner-create `POST /api/users` (`src/app/api/users/route.ts`); self-signup `signupViewer` (`use-auth-session.ts:99-120`) + duyệt `POST /api/signup-requests/[id]/approve` (default role `employee_viewer`, `approve-signup-modal.tsx:43`).
- **Logging free**: `auth.audit_log_entries` (GoTrue) ghi mọi login kèm **IP + user-agent + timestamp**. `audit_log.request_meta jsonb` (`001_schema.sql:419`) là placeholder rỗng (không trigger nào set). `shift_assignments` đã là lịch sử chấm công nhưng **không có IP/UA/device**.
- **IP/anchor (từ plan cũ, giữ lại)**: `parseClientIp` (right-most hop), `isIpAllowed`, bảng `checkin_anchor`, `record_shop_anchor_heartbeat`, route `/api/shop-presence/heartbeat`, hook `use-anchor-heartbeat`, rate-limit fixed-window, pattern revoke/grant lock-down.
- **Self-write precedent (RLS)**: `pos_sync_attempts_self_insert with check (auth.uid() = user_id)` (`003_rls.sql:199`); `profiles_self_*` (`003_rls.sql:76-80`).

## 4. Kiến trúc tổng quan
```
[ĐT nhân viên, wifi quán] --login--> Supabase Auth (JWT)
        |
        | POST /api/checkin  (Authorization: Bearer <jwt>, body rỗng)
        v
[Route /api/checkin (nodejs, force-dynamic)]
   0. proxy-secret header (CHECKIN_PROXY_SECRET) — bắt buộc (prod) → chặn đánh thẳng port thô
   1. requireAuth(jwt, ['employee_self_service'])  -> userId   (operator/manager dùng luồng check_in_employee riêng)
   2. parseClientIp(headers, {trustedProxyCount})   -> ip (null => fail-closed)
   3. đọc checkin_network + anchor IPs TƯƠI (service role; last_heartbeat_at > now()-grace);
      nếu enabled & (không anchor tươi || !isIpAllowed(ip)) -> 403  (fail-closed)
   4. rate-limit theo userId
   5. getServiceRoleClient().rpc('check_in_self', {p_auth_user_id: userId, p_ip: ip, p_user_agent})
        -> RPC (service-role-only) resolve employee_id từ p_auth_user_id; check_in_at=now();
           insert ... on conflict do nothing; created_by=p_auth_user_id
   6. 200 { employee_name, check_in_at, already_checked_in }
```
Cổng IP (anchor-heartbeat) độc lập, do owner cấu hình (như plan cũ).

## 5. Thay đổi dữ liệu & RPC

### 5.1 Role mới `employee_self_service`
- **Migration** drop/re-add CHECK constraint `employee_accounts.role` thêm `'employee_self_service'` (mẫu idempotent như `owner_draw` ở `database/migrations/2026-06-12-period-close-settlement.sql:14-28`). Dual-write vào `001_schema.sql`.
- Cập nhật `ROLE_LABELS`, `src/features/navigation/navigation.ts` (`NAV_ITEMS` thêm view `checkin`, `DEFAULT_SIDEBAR_BY_ROLE[employee_self_service]=['checkin']`, `MOBILE_TAB_PREFERENCE`), và **migration append `sidebar_defaults`** idempotent (theo convention "new viewkey" — append cuối, render theo NAV_ITEMS).
- **Ít quyền nhất qua RPC-funnel**: role này **không đọc bảng trực tiếp**. Màn hình lấy dữ liệu từ RPC `get_my_checkin_status()` → KHÔNG cần RLS đọc `employees`/`hourly_rate`. (Nếu cần lịch sử ca của bản thân: thêm policy self-read hẹp `shift_assignments` `using (employee_id = (select employee_id from employee_accounts where auth_user_id = auth.uid()))` cho role này — chỉ khi UI cần.)
- Approve modal: thêm option role `employee_self_service` (và đặt làm default khi duyệt nhân viên thường — tuỳ owner).

### 5.2 `shift_assignments`: idempotency atomic + dấu IP/thiết bị
- **THÊM partial unique index** (fix Codex concurrency finding) — nhưng **PHẢI preflight dò + dọn trùng trước** (Codex #4), vì RPC cũ `check_in_employee` (SELECT-then-INSERT, không constraint) có thể đã tạo ≥2 row `checked_in` cùng `(employee_id, business_date)` trên DB đang chạy → `create unique index` sẽ FAIL migration.
  - **Bước preflight (idempotent, trong migration trước khi tạo index):** với mỗi nhóm `(employee_id, business_date)` có >1 row `status='checked_in'`: GIỮ row sớm nhất theo **`order by check_in_at asc NULLS FIRST, created_at asc, id asc`** (deterministic — R-fix); row dư **không** có `shift_payroll_records` → `delete`.
  - **FAIL-FAST (R6/C4)**: sau khi dọn, nếu **vẫn còn** nhóm trùng (tức có row dư dính payroll) → **`raise exception`** dừng migration (KHÔNG WARNING-rồi-bỏ-qua). Vì `check_in_self` dùng `ON CONFLICT` dựa trên index này → deploy mà thiếu index = mọi check-in lỗi. Người vận hành phải dọn tay rồi chạy lại.
  - Chỉ khi sạch trùng: `create unique index if not exists shift_assignments_one_open_per_day on public.shift_assignments (employee_id, business_date) where status = 'checked_in';`
  - **Verify sau migration**: assert index tồn tại trước khi coi như deploy thành công.
  - Test pgTAP/integration phủ **DB đã có sẵn trùng** (payroll-free → còn 1 + index tạo được; payroll-linked → migration raise).
- **THÊM cột** `check_in_ip inet`, `check_in_user_agent text` (nullable). Dual-write `001_schema.sql` + migration.

### 5.3 RPC `check_in_self` — **SERVICE-ROLE-ONLY** (sửa Codex #1: chống bypass route)
```
check_in_self(p_auth_user_id uuid, p_ip inet, p_user_agent text) returns jsonb
  security definer, set search_path = public, auth
```
- **Service-role-only**: trong migration + `002`, sau định nghĩa hàm: `revoke execute on function public.check_in_self(uuid, inet, text) from anon, authenticated; grant execute ... to service_role;`. **Dual-write REVOKE** vào `003_rls.sql` NGAY SAU dòng grant tổng (~line 57). → client (anon/authenticated) **không** gọi thẳng được ⇒ không thể bỏ qua cổng IP của route, không thể giả mạo `p_ip`/`p_user_agent`/giờ. Chỉ `/api/checkin` (service role) gọi.
- **Danh tính do route truyền vào, đã xác thực JWT**: `p_auth_user_id = requireAuth(jwt, [...]).userId`. RPC **không** đọc `auth.uid()` (service role → NULL). Resolve `v_employee := (select employee_id from public.employee_accounts where auth_user_id = p_auth_user_id and status='active')`; NULL → raise 'Tài khoản chưa gắn nhân viên.'. Không có tham số `employee_id`/`code` → không impersonate.
- **Giờ server-side**: `v_check_in := now()` BÊN TRONG RPC (không nhận từ client → chống giả mạo giờ). `p_ip`/`p_user_agent` do route đọc từ request header (server-side) rồi truyền vào để lưu audit.
- **Idempotent atomic** (xem 5.2): `insert into shift_assignments (employee_id, business_date, check_in_at, status, created_by, updated_by, check_in_ip, check_in_user_agent) values (v_employee, current_date, v_check_in, 'checked_in', p_auth_user_id, p_auth_user_id, p_ip, p_user_agent) on conflict (employee_id, business_date) where status='checked_in' do nothing returning id`. Conflict (không returning id) → SELECT id hiện có + `already_checked_in=true`.
- `confirmed_by_manager` giữ default (true) — tự duyệt (#5). Trả `{ shift_assignment_id, employee_name, check_in_at, already_checked_in }`. KHÔNG tái dùng `check_in_employee`.
- **Role gate ở ROUTE** (B1 — employees-only): `/api/checkin` dùng `requireAuth(jwt, ['employee_self_service'])`. **Operator/manager/owner KHÔNG dùng route này** — họ vào ca qua luồng operator `check_in_employee` (đã có). RPC chỉ kiểm "account active + linked" (defense-in-depth).

### 5.4 RPC `get_my_checkin_status()` — authenticated (đọc của CHÍNH mình)
```
get_my_checkin_status() returns jsonb  security definer, set search_path = public, auth
```
- Resolve employee từ `auth.uid()` (gọi bằng phiên nhân viên, không qua route); trả `{ employee_name, checked_in_today boolean, check_in_at }` cho ngày hiện tại. Gate: bất kỳ active linked account. Chỉ ĐỌC dữ liệu của chính caller (không bypass risk → giữ authenticated, KHÔNG service-role). Dùng để render màn hình mà không cần RLS bảng. Dual-write `002`.

### 5.5 Anchor/IP (tái dùng từ plan cũ) — **IP HẾT HẠN theo grace_hours** (sửa Codex #3)
`checkin_anchor` table + RLS owner-only; RPC owner-only `add_shop_anchor`, `remove_shop_anchor`, `record_shop_anchor_heartbeat(p_anchor_id, p_public_ip inet)`, `update_checkin_network_config(p_config jsonb)`; `app_settings` key `checkin_network = {enabled, reject_message, grace_hours}` (is_public=false). **Bỏ** key `checkin_kiosk`/`checkin_base_url` (không còn QR public). IP luôn do route parse từ source IP, không từ body/SQL.
- **THAY ĐỔI quan trọng vs plan cũ:** allowlist tại thời điểm check-in = `current_public_ip` của anchor `is_active` **VÀ `current_public_ip is not null` VÀ `last_heartbeat_at > now() - (grace_hours || ' hours')::interval`** (anchor "tươi", cutoff tính **phía Postgres** không dùng JS clock — R7). Anchor im lặng quá `grace_hours` → IP rớt khỏi allowlist (không tin IP cũ vô thời hạn — sau khi ISP cấp lại IP đó, kẻ có account không lọt).
- **Fail-closed khi không còn anchor tươi:** tập anchor tươi **rỗng** → route trả **503** (xem §6 bước 5) + panel owner cảnh báo đỏ "Anchor quá hạn — check-in đang khoá, mở app trên máy POS". `grace_hours` là **ngưỡng hiệu lực thật**.
- **Chặn bật gate khi chưa sẵn sàng:** form owner **không cho lưu `enabled=true`** khi chưa có anchor nào `is_active` có `current_public_ip` non-null (tránh "armed nhưng chặn tất cả" — R7/C3). RPC `update_checkin_network_config` cũng enforce điều này server-side.
- **Route đọc anchor tươi qua RPC service-role-only `fresh_anchor_ips(p_grace_hours numeric)`** (`security definer`, returns `setof text` = `host(current_public_ip)` của anchor `is_active AND current_public_ip is not null AND last_heartbeat_at > now() - make_interval(hours => p_grace_hours)`) → cutoff tính phía Postgres (R7), anchor IP không lộ cho client.

### 5.6 Quên mật khẩu
Thêm `supabase.auth.resetPasswordForEmail(email, {redirectTo})` ở màn login + route/page nhận redirect đặt mật khẩu mới. (Phạm vi nhỏ; chi tiết để planning.)

### 5.7 Provisioning: **LINK nhân viên có sẵn, không tạo trùng** (sửa Codex #2)
Hiện trạng (bug): `POST /api/signup-requests/[id]/approve` (`src/app/api/signup-requests/[id]/approve/route.ts:84-98`) **luôn INSERT một `employees` mới** (code=employee_code, hourly_rate=0), kể cả khi đã có nhân viên trùng `code` → tài khoản link vào bản trùng rate 0; check-in/payroll bám sai bản. `employee_accounts` có `unique(auth_user_id)` nhưng **không** unique `employee_id` (`001_schema.sql:54,60`).
- **DB invariant:** thêm **partial unique index** `employee_accounts_one_account_per_employee on public.employee_accounts (employee_id) where employee_id is not null` (dual-write `001`+migration). **Preflight** (Codex #4 cùng kiểu): dò account trùng `employee_id` trước khi tạo; nếu có → RAISE NOTICE để owner xử lý tay, không tự gộp.
- **Route approve sửa:** thêm tham số body `employee_id?: uuid` (owner chọn nhân viên có sẵn để link). Logic:
  1. Nếu `employee_id` được truyền → verify nhân viên tồn tại & **chưa** bị link (không có `employee_accounts` nào trỏ tới) → dùng `employee_id` đó (KHÔNG insert mới).
  2. Else nếu `employee_code` của đơn khớp **đúng 1** `employees` chưa-link → link vào đó.
  3. Else (không match) → insert `employees` mới như cũ.
  - Bọc bằng kiểm tra: nếu nhân viên đích đã bị link → 409 "Nhân viên này đã có tài khoản.".
- **Modal `approve-signup-modal.tsx` sửa:** thêm dropdown "Link nhân viên có sẵn" (danh sách `employees` chưa-link, query owner/manager) — optional; bỏ trống = theo code-match/tạo mới. Thêm option role `employee_self_service` vào `ROLES` + `VALID_ROLES` (route) + `ROLE_LABELS`.
- **Owner-create `/api/users`** cũng nên nhận `employee_id` để link thay vì luôn tạo mới (cùng invariant). (Chi tiết để planning.)

### 5.8 Role ceiling — chặn manager tự lên owner (sửa Codex vòng-2 C2)
Hiện trạng (hole): `approve` cho approver `[owner, manager]` và `VALID_ROLES` chứa `owner`; route ghi bằng **service role** → **manager duyệt một signup thành `owner`** rồi có toàn quyền owner (anchor, backup/restore, sổ quỹ). Tương tự `/api/users` POST và `/api/users/[id]` PATCH (sửa role).
- **Quy tắc**: chỉ `app_role()='owner'` được **cấp hoặc đổi role thành `owner`** (và hạ owner). `manager` chỉ thao tác role ≤ mình (`manager`/`staff_operator`/`employee_viewer`/`employee_self_service`), **không** được tạo/sửa `owner` (và không nên tạo `manager` — tuỳ chọn: giới hạn manager chỉ cấp `staff_operator`/`employee_viewer`/`employee_self_service`).
- **Áp dụng server-side** ở cả 3 route (approve, users POST, users PATCH): nếu `requestedRole === 'owner'` và `approver.role !== 'owner'` → **403**. Test: manager→owner bị 403; owner→owner OK.

### 5.9 Siết RLS cho role mới — không đọc dữ liệu vận hành (sửa Codex vòng-2 C5)
Hiện trạng (leak): `ingredients_select_all`/`menu_items_select_all`/`recipes_select_all`/`recipe_items_select_all`/`stock_movements_select_all` (`003_rls.sql:294-309`) đang `using (true)` → **mọi** JWT authenticated đọc được, gồm giá nguyên liệu + lịch sử kho. Ẩn navigation KHÔNG phải authorization boundary → `employee_self_service` vẫn đọc trực tiếp qua PostgREST.
- **Sửa**: đổi 5 policy đó từ `using (true)` → `using (public.app_role() in ('owner','manager','staff_operator','employee_viewer'))` (loại `employee_self_service`). Dual-write `003_rls.sql`. Cân nhắc soát thêm các policy `to authenticated` khác mà role mới không nên thấy (đã chọn: gộp hết — xem plan).
- **pgTAP**: act_as `employee_self_service` → `set local role authenticated` → `select` các bảng trên trả **0 dòng** (RLS chặn); role staff vẫn đọc được.

## 6. API routes
- **`POST /api/checkin`** (`force-dynamic`, `nodejs`) — **authenticated**. Thứ tự (fail-closed toàn bộ):
  1. **Proxy-secret (R2/C1)**: nếu có env `CHECKIN_PROXY_SECRET` → bắt buộc header `x-checkin-proxy-secret` khớp constant-time, sai/thiếu → **403** (chặn request đánh thẳng port thô không qua proxy). (Proxy ghi header này; app bind loopback.)
  2. `const { userId } = await requireAuth(jwt, ['employee_self_service'])` (R3-aligned: chỉ nhân viên self-service; operator dùng luồng `check_in_employee` riêng) — 401/403.
  3. **Đọc config có kiểm lỗi (R4/C3)**: query `checkin_network`; **nếu lỗi query hoặc không có row hoặc thiếu key** → **503 "Tính năng chấm công chưa được cấu hình."** (KHÔNG fail-open). `enabled=false` ⇒ tính năng TẮT → **503** (không phải "bỏ qua IP rồi cho check-in").
  4. `parseClientIp` (null → fail-closed ở bước 6).
  5. **Anchor tươi**: query anchors `is_active AND last_heartbeat_at > now() - (grace_hours||' hours')::interval` (cutoff tính **phía Postgres**, R7) **và `current_public_ip is not null`**. Tập rỗng → **503 "Chưa có thiết bị quán hoạt động."**.
  6. Gate: `isIpAllowed(ip, freshAnchorIps)` false (gồm ip null) → **403** `reject_message`.
  7. rate-limit theo `userId` → `getServiceRoleClient().rpc('check_in_self', { p_auth_user_id: userId, p_ip: ip, p_user_agent: ua })` → 200 payload. Lỗi RPC → "Không chấm công được." IP/UA server-side; **giờ = `now()` trong RPC**.
- **`POST /api/shop-presence/heartbeat`** — owner + device token (constant-time), stamp source IP. (Như plan cũ, giữ.)
- **`GET /api/shop-presence/whoami`** — owner-only, trả IP server thấy (giúp owner xác nhận IP quán/proxy). (Giữ.)
- **`src/lib/data/checkin.ts`**: `submitCheckin(authHeader)` (POST, không gửi code), `getMyCheckinStatus(supabase)`, `sendAnchorHeartbeat`, `fetchWhoami`, anchor/config updaters. Export ở `index.ts`.

## 7. RLS & bảo mật (BẮT BUỘC)
- **Đọc IP thật / chống spoof XFF + CHẶN port thô (C1, BẮT BUỘC)**: đọc hop tin cậy bên phải; app sau đúng 1 reverse-proxy. Tài liệu hoá KHÔNG đủ — phải **thực thi**: (a) deploy bind app vào **loopback/internal** (sửa `deploy/dockge/compose.yaml`: `127.0.0.1:${APP_PORT}:3000` + đặt reverse-proxy là listener public duy nhất); (b) **secret header proxy**: proxy ghi `x-checkin-proxy-secret`, route `/api/checkin` bắt buộc khớp constant-time (env `CHECKIN_PROXY_SECRET`), thiếu/sai → 403 → dù ai đánh thẳng port thô với XFF giả cũng bị chặn; (c) E2E chứng minh port thô không tin XFF.
- **Fail-CLOSED + trạng thái setup (C3)**: lỗi đọc/thiếu/hỏng `checkin_network`, hoặc không anchor tươi → **503**, KHÔNG bao giờ cho check-in mà bỏ qua IP. `enabled=false`=tính năng tắt (503).
- **Role ceiling (C2)**: chỉ owner cấp/sửa role owner; áp ở approve + users POST + users PATCH (§5.8).
- **RLS chặn role mới đọc dữ liệu vận hành (C5)**: §5.9 + pgTAP.
- **Chống bypass route (Codex #1)**: `check_in_self` **service-role-only** (REVOKE anon/authenticated) → client không gọi thẳng RPC để bỏ qua cổng IP hay giả mạo IP/UA/giờ. Danh tính = `p_auth_user_id` do route truyền sau khi `requireAuth` verify JWT → không impersonate; giờ = `now()` server-side.
- **Fail-closed**: `enabled=true` mà IP null/không khớp **hoặc không còn anchor tươi (≤grace_hours)** → 403 (Codex #3).
- **Idempotency atomic**: partial unique index là nguồn idempotency thật (chống double-tap mobile + concurrency); migration tạo index có **preflight dọn trùng** (Codex #4).
- **Provisioning toàn vẹn (Codex #2)**: approve LINK nhân viên có sẵn + unique `employee_id` → không tạo bản trùng rate-0, payroll không bám sai.
- **Role least-privilege**: `employee_self_service` không đọc bảng trực tiếp (RPC-funnel); không thấy lương người khác.
- **Anchor owner-only**: RPC config/anchor gate `app_role()='owner'`; heartbeat route owner + device token.
- **Rate-limit** `/api/checkin` theo `userId`. **Privacy/PDPL**: IP+user-agent là dữ liệu cá nhân → cần dòng thông báo/đồng ý cho nhân viên + chính sách retention (ghi trong ops doc). Dữ liệu lưu **local** (`shift_assignments`) giúp chủ kiểm soát; IP/UA mà GoTrue lưu nằm trên hạ tầng Supabase (lưu ý data-residency).

## 8. UI
- **Màn "Chấm công" của nhân viên** (`employee_self_service`, mobile-first, sau login): hiện tên + trạng thái hôm nay (qua `get_my_checkin_status`); nút lớn **Vào ca** → `submitCheckin` → màn thành công (✓ + giờ VN; hoặc "Bạn đã vào ca hôm nay rồi"); lỗi IP/503 → thông báo rõ ("Hãy nối wifi quán rồi thử lại." / "Chấm công chưa được cấu hình.") qua `AlertBanner`. Là view mặc định của role này. **Consent PDPL (S4)**: dòng thông báo "Khi chấm công, hệ thống ghi lại thời điểm, IP và thiết bị của bạn." hiển thị cạnh nút (một lần xác nhận hoặc luôn hiển thị).
- **Owner settings (owner-only)**: panel quản lý anchor + bật/tắt gate + `reject_message` + hiện IP đang whitelist + cảnh báo anchor quá cũ + **readout IP/thiết bị các lần check-in gần đây** (soát bất thường). KHÔNG còn trang kiosk public, KHÔNG QR.
- **Manager/operator**: shift view hiện thêm cột/àudit IP–thiết bị cho mỗi check-in (đọc `check_in_ip`/`check_in_user_agent`), cờ "khác thiết bị/khác IP".

## 9. Tái dùng vs Bỏ (so với plan cũ kiosk-PIN)
**Tái dùng nguyên/gần nguyên**: `src/lib/ip-allowlist.ts` (+test), `src/lib/rate-limit.ts` (+test), `checkin_anchor` table + RLS, anchor/heartbeat RPC + routes + hook, owner anchor panel, revoke/grant pattern, pgTAP cho anchor owner-only.
**Bỏ**: trang `/checkin` public (route group kiosk), định danh `employees.code`/PIN, RPC `check_in_employee_kiosk` service-role-only, sinh QR (`qrcode.react`), key `checkin_kiosk`/`checkin_base_url`, middleware PUBLIC_PATHS cho `/checkin`.
**Làm mới**: route `/api/checkin` authenticated, RPC `check_in_self` + `get_my_checkin_status`, role `employee_self_service`, cột `check_in_ip`/`check_in_user_agent` + partial unique index, màn "Chấm công" sau login, password reset.

## 10. Acceptance criteria & Test plan
**Vitest** (`src/lib/__tests__/`):
- `ip-allowlist.test.ts`: `parseClientIp` đọc đúng hop phải-nhất, bỏ left-most XFF (spoof), IPv4/IPv6, missing→null; `isIpAllowed` null→false (fail-closed), khớp exact, /64 option.
- `rate-limit.test.ts`: fixed-window allow→block→reset, key độc lập, sweep.

**pgTAP** (`database/tests/310_self_checkin.sql` — số 300 đã dùng):
- `check_in_self(p_auth_user_id, p_ip, p_user_agent)`: với uid của nhân viên → tạo đúng 1 row `checked_in` hôm nay cho **chính** employee link với uid đó; `created_by = p_auth_user_id`; `check_in_ip`/`check_in_user_agent` lưu đúng; `check_in_at` ≈ `now()` (server-side, không nhận từ tham số).
- **Privilege lock-down (Codex #1):** `NOT has_function_privilege('anon'|'authenticated', 'public.check_in_self(uuid, inet, text)', 'execute')`; `service_role` = true.
- **Concurrency/idempotency**: gọi `check_in_self` 2 lần → vẫn đúng 1 row; lần 2 `already_checked_in=true`. (Mô phỏng đua bằng cách insert sẵn 1 row rồi gọi → on conflict do nothing.)
- **Preflight dọn trùng (Codex #4):** seed 2 row `checked_in` cùng `(employee_id, business_date)` (1 không payroll) → chạy hàm/đoạn preflight → còn đúng 1 row checked_in (bản sớm nhất) → tạo unique index thành công.
- `p_auth_user_id` chưa link employee (account active nhưng `employee_id` null) → `throws_ok`.
- `get_my_checkin_status` (act_as) trả đúng trạng thái/tên cho caller; chỉ thấy của chính mình.
- **Anchor tươi/hết hạn (Codex #3):** helper tính allowlist chỉ trả anchor có `last_heartbeat_at > now()-grace`; anchor stale → KHÔNG trong allowlist; không anchor tươi → tập rỗng (route sẽ fail-closed). Anchor/config RPC owner-only (manager → raise); `record_shop_anchor_heartbeat` stamp IP + cập nhật `last_heartbeat_at`.
- **Provisioning link (Codex #2):** unique index `employee_accounts(employee_id) where not null` chặn link 2 account vào 1 nhân viên (`throws_ok` insert thứ 2). (Logic route link test ở Vitest/integration nếu có; tối thiểu pgTAP phủ invariant DB.)
- (Tuỳ) `employee_self_service` KHÔNG đọc được `employees.hourly_rate` của người khác (nếu thêm self-read policy).

**Chạy**: `npm run test:run` + pgTAP file mới trên DB throwaway (đầy đủ, tránh false-fail seed như memory note). `npm run verify:phase`. Lưu ý: `verify:mirror` là dashboard-checker (cần `--date`/`--service-key`), KHÔNG phải dual-write checker — dual-write là convention thủ công byte-identical.

**E2E tay**: owner đánh dấu thiết bị POS làm anchor → panel hiện IP quán; bật gate; nhân viên (đã được duyệt role `employee_self_service`) nối wifi quán → mở app → đăng nhập → "Vào ca" → thành công; bấm lại → "đã vào ca"; thử trên 4G → 403 "nối wifi quán"; `curl /api/checkin` với JWT hợp lệ nhưng IP ngoài quán → 403; double-tap nhanh → chỉ 1 ca; operator thấy ca ở "Đang làm việc", ra ca + tính lương; owner soát IP/thiết bị các check-in.

## 11. Coverage checklist (Codex đối chiếu)
- [ ] Đổi PIN → tài khoản nhân viên + tự bấm chấm công trên web app điện thoại — §1, §5.3, §8.
- [ ] Đăng nhập = Supabase email+mật khẩu, tái dùng auth có sẵn — §3, §6.
- [ ] Cổng kép danh tính + IP quán; danh tính từ phiên (không impersonate) — §1, §4, §5.3, §7.
- [ ] Role mới `employee_self_service` ít quyền (không lộ lương) — §5.1.
- [ ] Self check-IN, KHÔNG self check-OUT — §5.3, §2(#4).
- [ ] Tự duyệt + dấu IP/thiết bị mỗi check-in — §2(#5), §5.2, §6.
- [ ] Lịch sử login: dấu IP/UA trên shift + `auth.audit_log_entries`, không bảng riêng — §3, §5.2.
- [ ] Bắt buộc wifi quán; 4G bị chặn + thông báo — §2(#7), §8.
- [ ] Provisioning self-signup + duyệt; password reset — §2(#8,#9), §5.1, §5.6.
- [ ] Idempotency atomic (partial unique index) — fix Codex concurrency — §5.2, §5.3.
- [ ] IP gate fail-closed; anchor owner-only; rate-limit; revoke/grant — §7.
- [ ] Anchor/parseClientIp/heartbeat tái dùng từ plan cũ — §5.5, §9.
- [ ] **(Codex #1)** `check_in_self` service-role-only; route truyền uid đã verify + giờ server-side — §5.3, §6, §7.
- [ ] **(Codex #2)** approve LINK nhân viên có sẵn + unique `employee_id` — §5.7.
- [ ] **(Codex #3)** anchor hết hạn theo `grace_hours` + fail-closed khi không anchor tươi — §5.5, §7.
- [ ] **(Codex #4)** migration unique index có preflight dò+dọn trùng, test populated DB — §5.2.
- [ ] **(Codex #5)** plan/spec kiosk-PIN cũ đánh dấu SUPERSEDED — header + 2 file cũ.
- [ ] **(R1)** role `employee_self_service` wiring xuyên suốt types/requireAuth/navigation/CHECK (đặt tên) — §5.1.
- [ ] **(R2/C1)** chặn port thô: loopback bind + reverse-proxy + secret header proxy + E2E — §6, §7.
- [ ] **(R3/C2)** role ceiling owner-only ở approve + users POST + users PATCH + test 403 — §5.8, §7.
- [ ] **(R4/C3)** fail-closed + 503 setup-state; `enabled=false`=tắt — §6, §7.
- [ ] **(R5/C5)** RLS chặn `employee_self_service` đọc dữ liệu vận hành + pgTAP — §5.9, §7.
- [ ] **(R6/C4)** migration RAISE dừng deploy nếu thiếu unique index; verify index sau migration — §5.2.
- [ ] **(R7)** freshness cutoff phía Postgres + NULL-IP guard + chặn bật gate khi chưa anchor — §5.5, §6.
- [ ] render cột audit IP/UA ở shift view (S3) — §8; consent PDPL (S4) — §8; tiebreak dedup deterministic (S5) — §5.2.
- [ ] Test Vitest + pgTAP như §10.

## 12. Prerequisite / rủi ro owner cần biết
1. **(Chặn — bảo mật) Proxy + firewall**: app sau đúng 1 reverse-proxy đặt IP thật + chặn cổng app thô. Whitelist chỉ đáng tin khi có điều này.
2. **Wifi quán bắt buộc**: nhân viên phải nối wifi quán; 4G bị chặn (cần biển hướng dẫn + SSID).
3. **Anchor luôn-bật**: ≥1 thiết bị ở quán mở app để giữ IP tươi; grace giữ IP cũ; cảnh báo khi anchor quá cũ.
4. **Privacy/PDPL**: thông báo + đồng ý lưu IP/user-agent; chính sách retention.
5. **Đổi role cần logout/login lại** để `app_role()` cập nhật.
6. **CGNAT/IPv6**: như spec cũ — CGNAT không kiểm; IPv6 cân nhắc /64 (follow-up).

## 13. Ngoài phạm vi (YAGNI v1)
- Self check-OUT; flow duyệt ca thủ công (pending) của manager; bảng `checkin_login_log` riêng + UI lịch sử login đầy đủ; GPS geofence / QR đổi luân phiên (đã chọn IP); bulk-import nhân viên; phone/passwordless login; whitelist IPv6 đầy đủ.
