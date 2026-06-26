# Re-point Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho owner đổi nhân viên cho một tài khoản đã gắn (re-point) sang một nhân viên đích chưa có tài khoản, và deactivate nhân viên nguồn an toàn (không xoá).

**Architecture:** RPC Postgres security-definer `repoint_account(uuid,uuid,uuid)` làm toàn bộ thao tác nguyên tử (FOR UPDATE + atomic conditional UPDATE chống TOCTOU; deactivate NV nguồn; upsert profile). Route mỏng `POST /api/users/[id]/repoint` (owner-only) verify JWT rồi gọi RPC qua service role. Logic kiểm-chứng-được tách ra helper thuần để Vitest test; UI nằm trong Edit Account modal với bước xác nhận riêng.

**Tech Stack:** Next.js 15 route handler (nodejs runtime) · Supabase Postgres + plpgsql RPC · pgTAP · Vitest · TanStack Query · Radix Select.

**Spec:** docs/superpowers/specs/2026-06-26-repoint-account-design.md (Codex ACCEPT).

---

## File Structure

**DB (triple-write lock-down + test):**
- `database/002_functions.sql` — thêm hàm `repoint_account` (canonical, cho DB sạch).
- `database/003_rls.sql` — re-assert `revoke/grant` cho `repoint_account` NGAY SAU blanket grant (chống blanket grant cấp lại execute cho `authenticated`).
- `database/migrations/2026-06-26-repoint-account.sql` — tạo hàm + grant (nâng cấp DB đang chạy); định nghĩa hàm trùng khít 002.
- `database/tests/320_repoint_account.sql` — pgTAP cho RPC.

**Backend:**
- `src/lib/repoint-account.ts` — helper thuần: `mapRepointErrorStatus`, `validateRepointBody`, `isSelfRepoint`. KHÔNG import server-only.
- `src/lib/__tests__/repoint-account.test.ts` — Vitest cho 3 helper.
- `src/app/api/users/[id]/repoint/route.ts` — POST owner-only.

**Data / hook / UI:**
- `src/lib/data/accounts.ts` — thêm `repointAccount(...)` (tự export qua barrel `src/lib/data/index.ts` đã `export * from "./accounts"`).
- `src/hooks/mutations/use-settings-mutations.ts` — thêm `useRepointUser`.
- `src/features/settings/edit-account-modal.tsx` — mục "Đổi nhân viên cho tài khoản" (owner + account đã gắn + không phải self).

**Verify mechanism (đã xác minh):** pgTAP throwaway-DB replicate CI = `PGTAP_DB_URL=<url> node scripts/ci/apply-schema.mjs` (auth-mock → 001 → 002 → 003 → migrations) rồi `PGTAP_DB_URL=<url> node scripts/pgtap-run.mjs --file database/tests/320_repoint_account.sql`. KHÔNG verify trên dev DB `supabase-db` (seed data → false fails). Vitest: `npm run test:run`.

---

## Task 1: pgTAP test cho RPC `repoint_account` (TDD — test trước)

**Files:**
- Create: `database/tests/320_repoint_account.sql`

- [ ] **Step 1: Viết test pgTAP (sẽ fail vì hàm chưa tồn tại)**

```sql
-- 320 — repoint_account RPC: re-point một tài khoản đã gắn sang NV đích chưa có TK,
-- deactivate NV nguồn (KHÔNG xoá → dữ liệu con giữ nguyên), upsert profile display_name,
-- stale-source guard, target-already-account / inactive / missing, unlinked, target==source,
-- và privilege lock-down (service-role-only).
--
-- Chạy trên throwaway DB (auth-mock + 001 + 002 + 003 + migrations) — xem
-- scripts/ci/apply-schema.mjs. [NB-NEW] Test #16-18 (grant) verify trạng thái HIỆU LỰC
-- cuối cùng sau khi áp cả 003 lẫn migrations; phần re-assert ở 003_rls.sql (cho DB sạch
-- tương lai không có migration) được đảm bảo thêm bằng code review.
-- Spec: docs/superpowers/specs/2026-06-26-repoint-account-design.md §7.1

begin;
select plan(18);

-- -------------------------------------------------------------------------
-- Fixtures
-- -------------------------------------------------------------------------
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000010', 'hp@test.local',    '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000012', 'hp2@test.local',   '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000020', 'wd@test.local',    '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000030', 'tha@test.local',   '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000031', 'thasrc@test.local','', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000041', 'misc@test.local',  '', now(), '00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000050', 'unlinked@test.local','', now(), '00000000-0000-0000-0000-000000000000');

insert into public.employees (id, name, hourly_rate, is_active) values
  ('e0000000-0000-0000-0000-000000000010', 'HP Source',   30000, true),
  ('e0000000-0000-0000-0000-000000000011', 'HP Target',   30000, true),
  ('e0000000-0000-0000-0000-000000000012', 'HP2 Source',  30000, true),
  ('e0000000-0000-0000-0000-000000000013', 'HP2 Target',  30000, true),
  ('e0000000-0000-0000-0000-000000000020', 'WD Source',   30000, true),
  ('e0000000-0000-0000-0000-000000000021', 'WD Target',   30000, true),
  ('e0000000-0000-0000-0000-000000000030', 'THA Target',  30000, true),
  ('e0000000-0000-0000-0000-000000000031', 'THA Source',  30000, true),
  ('e0000000-0000-0000-0000-000000000040', 'Inactive Tgt',30000, false),
  ('e0000000-0000-0000-0000-000000000041', 'Misc Source', 30000, true);

insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000010', 'e0000000-0000-0000-0000-000000000010', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000012', 'e0000000-0000-0000-0000-000000000012', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000020', 'e0000000-0000-0000-0000-000000000020', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000030', 'e0000000-0000-0000-0000-000000000030', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000031', 'e0000000-0000-0000-0000-000000000031', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000041', 'e0000000-0000-0000-0000-000000000041', 'employee_viewer', 'active'),
  ('a0000000-0000-0000-0000-000000000050', null,                                   'employee_viewer', 'active');

-- Pre-existing profile for HP2 (test upsert OVERWRITE); HP has NO profile (test upsert CREATE).
insert into public.profiles (id, display_name) values
  ('a0000000-0000-0000-0000-000000000012', 'Tên cũ HP2');

-- WD source child data (must survive re-point, attached to source).
insert into public.shift_assignments (id, employee_id, business_date, status) values
  ('5a000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000020', current_date, 'checked_out');
insert into public.shift_payroll_records (id, employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay) values
  ('5b000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000020', current_date, 480, 30000, 240000, 240000);
insert into public.expense_history_permissions (id, employee_id, date_from, date_to) values
  ('5c000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000020', current_date, current_date);

-- =========================================================================
-- Group A — error paths (throws; KHÔNG mutate vì pgTAP bắt lỗi trong subtxn)
-- =========================================================================

-- 1: target đã có tài khoản → 23505
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000031'::uuid,   -- account on THA Source
       'e0000000-0000-0000-0000-000000000030'::uuid,   -- target THA (already accounted)
       'e0000000-0000-0000-0000-000000000031'::uuid) $$,
  '23505', NULL, 'target đã có tài khoản → 23505');

-- 2: target inactive → P0002
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-000000000040'::uuid,   -- inactive target
       'e0000000-0000-0000-0000-000000000041'::uuid) $$,
  'P0002', NULL, 'target inactive → P0002');

-- 3: target không tồn tại → P0002
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-0000000000ff'::uuid,   -- missing target
       'e0000000-0000-0000-0000-000000000041'::uuid) $$,
  'P0002', NULL, 'target không tồn tại → P0002');

-- 4: account chưa gắn NV (employee_id null) → P0001
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000050'::uuid,   -- unlinked account
       'e0000000-0000-0000-0000-000000000011'::uuid,
       'e0000000-0000-0000-0000-000000000011'::uuid) $$,
  'P0001', NULL, 'account chưa gắn NV → P0001');

-- 5: target == source → P0001
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-000000000041'::uuid,   -- == current source
       'e0000000-0000-0000-0000-000000000041'::uuid) $$,
  'P0001', NULL, 'target == source → P0001');

-- 6: stale source (expected ≠ source hiện tại) → P0001
select throws_ok(
  $$ select public.repoint_account(
       'a0000000-0000-0000-0000-000000000041'::uuid,
       'e0000000-0000-0000-0000-000000000011'::uuid,
       'e0000000-0000-0000-0000-0000000000aa'::uuid) $$, -- wrong expected source
  'P0001', NULL, 'stale source guard → P0001');

-- =========================================================================
-- Group B — happy path (no pre-existing profile) — call once, assert state
-- =========================================================================
create temp table _hp as
  select public.repoint_account(
    'a0000000-0000-0000-0000-000000000010'::uuid,
    'e0000000-0000-0000-0000-000000000011'::uuid,
    'e0000000-0000-0000-0000-000000000010'::uuid) as r;

-- 7: account giờ trỏ target
select is(
  (select employee_id from public.employee_accounts where auth_user_id = 'a0000000-0000-0000-0000-000000000010'),
  'e0000000-0000-0000-0000-000000000011'::uuid, 'happy: account.employee_id = target');

-- 8: NV nguồn bị deactivate (không xoá)
select is(
  (select is_active from public.employees where id = 'e0000000-0000-0000-0000-000000000010'),
  false, 'happy: source employee is_active=false');

-- 9: NV nguồn vẫn tồn tại (không xoá)
select is(
  (select count(*)::int from public.employees where id = 'e0000000-0000-0000-0000-000000000010'),
  1, 'happy: source employee row NOT deleted');

-- 10: profile được TẠO MỚI với display_name = tên target (upsert insert)
select is(
  (select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000010'),
  'HP Target', 'happy: profile created with target name');

-- =========================================================================
-- Group C — happy path with PRE-EXISTING profile (upsert overwrite)
-- =========================================================================
select public.repoint_account(
  'a0000000-0000-0000-0000-000000000012'::uuid,
  'e0000000-0000-0000-0000-000000000013'::uuid,
  'e0000000-0000-0000-0000-000000000012'::uuid);

-- 11: profile cũ bị ghi đè tên target
select is(
  (select display_name from public.profiles where id = 'a0000000-0000-0000-0000-000000000012'),
  'HP2 Target', 'pre-existing profile overwritten with target name');

-- =========================================================================
-- Group D — re-point khi NV nguồn CÓ dữ liệu con: vẫn ok, data giữ nguyên trỏ source
-- =========================================================================
select public.repoint_account(
  'a0000000-0000-0000-0000-000000000020'::uuid,
  'e0000000-0000-0000-0000-000000000021'::uuid,
  'e0000000-0000-0000-0000-000000000020'::uuid);

-- 12: account trỏ target
select is(
  (select employee_id from public.employee_accounts where auth_user_id = 'a0000000-0000-0000-0000-000000000020'),
  'e0000000-0000-0000-0000-000000000021'::uuid, 'with-data: account re-pointed to target');

-- 13: source inactive
select is(
  (select is_active from public.employees where id = 'e0000000-0000-0000-0000-000000000020'),
  false, 'with-data: source deactivated');

-- 14: shift_assignments vẫn trỏ source
select is(
  (select employee_id from public.shift_assignments where id = '5a000000-0000-0000-0000-000000000001'),
  'e0000000-0000-0000-0000-000000000020'::uuid, 'with-data: shift_assignments still on source');

-- 15: shift_payroll_records + expense_history_permissions vẫn trỏ source
select ok(
  (select employee_id from public.shift_payroll_records where id = '5b000000-0000-0000-0000-000000000001')
    = 'e0000000-0000-0000-0000-000000000020'::uuid
  and (select employee_id from public.expense_history_permissions where id = '5c000000-0000-0000-0000-000000000001')
    = 'e0000000-0000-0000-0000-000000000020'::uuid,
  'with-data: payroll + expense_history still on source');

-- =========================================================================
-- Group E — privilege lock-down (service-role-only)
-- =========================================================================
select ok(
  has_function_privilege('service_role', 'public.repoint_account(uuid, uuid, uuid)', 'execute'),
  'service_role CAN execute repoint_account');         -- 16
select ok(
  not has_function_privilege('authenticated', 'public.repoint_account(uuid, uuid, uuid)', 'execute'),
  'authenticated CANNOT execute repoint_account');     -- 17
select ok(
  not has_function_privilege('anon', 'public.repoint_account(uuid, uuid, uuid)', 'execute'),
  'anon CANNOT execute repoint_account');              -- 18

select * from finish();
rollback;
```

- [ ] **Step 2: Chạy test, xác nhận FAIL (hàm chưa tồn tại)**

Tạo throwaway DB (ví dụ DB tên `chill_pgtap` trong container `supabase-db`, hoặc Postgres 15 docker riêng) rồi (PowerShell — shell chính của workspace):

```powershell
$env:PGTAP_DB_URL = 'postgres://postgres:postgres@localhost:5432/chill_pgtap'
psql $env:PGTAP_DB_URL -c "CREATE EXTENSION IF NOT EXISTS pgtap;"
node scripts/ci/apply-schema.mjs
node scripts/pgtap-run.mjs --file database/tests/320_repoint_account.sql
```

(Bash tool tương đương: `export PGTAP_DB_URL='...'`. Nếu `psql` không có trên PATH host → chạy qua `docker exec -i supabase-db psql -U postgres -d chill_pgtap`; xem memory "pgTAP run on clean DB".)

Expected: FAIL — `function public.repoint_account(uuid, uuid, uuid) does not exist` (vì Task 2 chưa làm). Đây là RED của TDD.

- [ ] **Step 3: Commit test**

```bash
git add database/tests/320_repoint_account.sql
git commit -m "test(pgtap): repoint_account RPC contract (red)"
```

---

## Task 2: Implement RPC `repoint_account` (002 + 003 + migration)

**Files:**
- Modify: `database/002_functions.sql` (thêm hàm cuối khối self-checkin, trước phần tiếp theo)
- Modify: `database/003_rls.sql:71` (thêm re-assert ngay sau khối `record_shop_anchor_heartbeat`)
- Create: `database/migrations/2026-06-26-repoint-account.sql`

- [ ] **Step 1: Thêm hàm vào `database/002_functions.sql`**

Chèn block sau (đặt ngay sau khối SELF-CHECKIN, ví dụ trước marker kế tiếp):

```sql
-- ============================================================== REPOINT-ACCOUNT-BEGIN
-- Re-point account (2026-06-26): đổi nhân viên cho một tài khoản ĐÃ gắn sang NV đích
-- chưa có TK; deactivate NV nguồn (KHÔNG xoá → giữ FK con). SERVICE-ROLE-ONLY
-- (route verify owner JWT → p_auth_user_id tin cậy). Nguyên tử: FOR UPDATE +
-- atomic conditional UPDATE (chống TOCTOU). Spec: 2026-06-26-repoint-account-design.md
create or replace function public.repoint_account(
  p_auth_user_id uuid,
  p_target_employee_id uuid,
  p_expected_source_employee_id uuid
)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_source uuid;
  v_target_name text;
  v_target_active boolean;
  v_updated int;
begin
  if p_auth_user_id is null or p_target_employee_id is null or p_expected_source_employee_id is null then
    raise exception 'Thiếu tham số.' using errcode = 'P0001';
  end if;

  select employee_id into v_source
    from public.employee_accounts
    where auth_user_id = p_auth_user_id
    for update;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'P0002';
  end if;
  if v_source is null then
    raise exception 'Tài khoản chưa gắn nhân viên — dùng chức năng liên kết.' using errcode = 'P0001';
  end if;
  if v_source = p_target_employee_id then
    raise exception 'Tài khoản đã gắn đúng nhân viên này rồi.' using errcode = 'P0001';
  end if;

  select name, is_active into v_target_name, v_target_active
    from public.employees where id = p_target_employee_id;
  if not found or v_target_active is not true then
    raise exception 'Nhân viên đích không tồn tại hoặc đã nghỉ.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.employee_accounts where employee_id = p_target_employee_id) then
    raise exception 'Nhân viên đích đã có tài khoản.' using errcode = '23505';
  end if;

  update public.employee_accounts
     set employee_id = p_target_employee_id
   where auth_user_id = p_auth_user_id
     and employee_id = p_expected_source_employee_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Dữ liệu đã thay đổi — tải lại trang rồi thử lại.' using errcode = 'P0001';
  end if;

  update public.employees set is_active = false where id = v_source;

  insert into public.profiles (id, display_name)
  values (p_auth_user_id, v_target_name)
  on conflict (id) do update set display_name = excluded.display_name;

  return jsonb_build_object(
    'auth_user_id', p_auth_user_id,
    'employee_id', p_target_employee_id,
    'source_employee_id', v_source,
    'source_deactivated', true
  );
end; $$;
revoke execute on function public.repoint_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.repoint_account(uuid, uuid, uuid) to service_role;
-- ============================================================== REPOINT-ACCOUNT-END
```

- [ ] **Step 2: Re-assert lock-down trong `database/003_rls.sql`**

Thêm NGAY SAU khối `record_shop_anchor_heartbeat` (sau dòng 71), TRƯỚC phần "Default privileges":

```sql
-- Re-point account (2026-06-26): service-role-only (route verify owner JWT → trusted
-- p_auth_user_id). Re-assert sau blanket grant để client không gọi thẳng RPC này.
revoke execute on function public.repoint_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.repoint_account(uuid, uuid, uuid) to service_role;
```

- [ ] **Step 3: Tạo migration `database/migrations/2026-06-26-repoint-account.sql`**

```sql
-- =============================================================================
-- 2026-06-26 — Re-point account (đổi nhân viên cho tài khoản)
-- Nâng cấp DB đang chạy. Dual-write: định nghĩa hàm TRÙNG KHÍT database/002_functions.sql;
-- re-assert lock-down TRÙNG database/003_rls.sql. Idempotent (create or replace + revoke/grant).
-- Spec: docs/superpowers/specs/2026-06-26-repoint-account-design.md
-- =============================================================================

create or replace function public.repoint_account(
  p_auth_user_id uuid,
  p_target_employee_id uuid,
  p_expected_source_employee_id uuid
)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_source uuid;
  v_target_name text;
  v_target_active boolean;
  v_updated int;
begin
  if p_auth_user_id is null or p_target_employee_id is null or p_expected_source_employee_id is null then
    raise exception 'Thiếu tham số.' using errcode = 'P0001';
  end if;

  select employee_id into v_source
    from public.employee_accounts
    where auth_user_id = p_auth_user_id
    for update;
  if not found then
    raise exception 'Không tìm thấy tài khoản.' using errcode = 'P0002';
  end if;
  if v_source is null then
    raise exception 'Tài khoản chưa gắn nhân viên — dùng chức năng liên kết.' using errcode = 'P0001';
  end if;
  if v_source = p_target_employee_id then
    raise exception 'Tài khoản đã gắn đúng nhân viên này rồi.' using errcode = 'P0001';
  end if;

  select name, is_active into v_target_name, v_target_active
    from public.employees where id = p_target_employee_id;
  if not found or v_target_active is not true then
    raise exception 'Nhân viên đích không tồn tại hoặc đã nghỉ.' using errcode = 'P0002';
  end if;

  if exists (select 1 from public.employee_accounts where employee_id = p_target_employee_id) then
    raise exception 'Nhân viên đích đã có tài khoản.' using errcode = '23505';
  end if;

  update public.employee_accounts
     set employee_id = p_target_employee_id
   where auth_user_id = p_auth_user_id
     and employee_id = p_expected_source_employee_id;
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Dữ liệu đã thay đổi — tải lại trang rồi thử lại.' using errcode = 'P0001';
  end if;

  update public.employees set is_active = false where id = v_source;

  insert into public.profiles (id, display_name)
  values (p_auth_user_id, v_target_name)
  on conflict (id) do update set display_name = excluded.display_name;

  return jsonb_build_object(
    'auth_user_id', p_auth_user_id,
    'employee_id', p_target_employee_id,
    'source_employee_id', v_source,
    'source_deactivated', true
  );
end; $$;
revoke execute on function public.repoint_account(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.repoint_account(uuid, uuid, uuid) to service_role;
```

- [ ] **Step 4: Chạy lại pgTAP, xác nhận PASS (18/18)**

```bash
node scripts/ci/apply-schema.mjs           # re-apply (idempotent) → tạo hàm + grants
node scripts/pgtap-run.mjs --file database/tests/320_repoint_account.sql
```

Expected: `18/18 passed`.

- [ ] **Step 5: Verify dual-write trùng khít (body 002 ≡ migration) — cross-shell (node)**

Chạy được cả PowerShell lẫn Bash tool (không dùng process substitution):

```bash
node -e "const fs=require('fs');const ex=s=>{const m=s.match(/create or replace function public\.repoint_account[\s\S]*?grant execute on function public\.repoint_account\(uuid, uuid, uuid\) to service_role;/);return m?m[0]:null;};const a=ex(fs.readFileSync('database/002_functions.sql','utf8'));const b=ex(fs.readFileSync('database/migrations/2026-06-26-repoint-account.sql','utf8'));if(a&&b&&a===b){console.log('IDENTICAL OK')}else{console.error('DIFFERS — sửa cho trùng');process.exit(1)}"
```

Expected: in `IDENTICAL OK`. Nếu `DIFFERS` → chỉnh 2 block cho byte-identical (thân hàm comment-free như precedent check_in_self).

- [ ] **Step 6: Commit**

```bash
git add database/002_functions.sql database/003_rls.sql database/migrations/2026-06-26-repoint-account.sql
git commit -m "feat(db): repoint_account RPC + service-role lock-down (002/003/migration)"
```

---

## Task 3: Vitest cho helper thuần (TDD — test trước)

**Files:**
- Create: `src/lib/__tests__/repoint-account.test.ts`

- [ ] **Step 1: Viết test (fail vì module chưa tồn tại)**

```ts
import { describe, it, expect } from "vitest";
import {
  mapRepointErrorStatus,
  validateRepointBody,
  isSelfRepoint
} from "@/lib/repoint-account";

describe("mapRepointErrorStatus", () => {
  it("23505 → 409", () => expect(mapRepointErrorStatus("23505")).toBe(409));
  it("P0002 → 404", () => expect(mapRepointErrorStatus("P0002")).toBe(404));
  it("P0001 → 400", () => expect(mapRepointErrorStatus("P0001")).toBe(400));
  it("undefined → 400", () => expect(mapRepointErrorStatus(undefined)).toBe(400));
});

describe("validateRepointBody", () => {
  const T = "11111111-1111-1111-1111-111111111111";
  const S = "22222222-2222-2222-2222-222222222222";
  it("nhận uuid hợp lệ", () => {
    expect(validateRepointBody({ target_employee_id: T, source_employee_id: S })).toEqual({
      ok: true,
      value: { target_employee_id: T, source_employee_id: S }
    });
  });
  it("thiếu target → lỗi", () =>
    expect(validateRepointBody({ source_employee_id: S }).ok).toBe(false));
  it("thiếu source → lỗi", () =>
    expect(validateRepointBody({ target_employee_id: T }).ok).toBe(false));
  it("không phải uuid → lỗi", () =>
    expect(validateRepointBody({ target_employee_id: "nope", source_employee_id: S }).ok).toBe(false));
  it("không phải object → lỗi", () => expect(validateRepointBody(null).ok).toBe(false));
});

describe("isSelfRepoint", () => {
  it("id bằng nhau → true", () => expect(isSelfRepoint("u1", "u1")).toBe(true));
  it("id khác → false", () => expect(isSelfRepoint("u1", "u2")).toBe(false));
});
```

- [ ] **Step 2: Chạy test, xác nhận FAIL**

Run: `npm run test:run -- src/lib/__tests__/repoint-account.test.ts`
Expected: FAIL — không resolve được `@/lib/repoint-account`.

- [ ] **Step 3: Commit test (red)**

```bash
git add src/lib/__tests__/repoint-account.test.ts
git commit -m "test(repoint): pure helper contract (red)"
```

---

## Task 4: Implement helper thuần `src/lib/repoint-account.ts`

**Files:**
- Create: `src/lib/repoint-account.ts`

- [ ] **Step 1: Viết helper (KHÔNG import server-only)**

```ts
/**
 * Pure helpers cho route /api/users/[id]/repoint — KHÔNG import server-only
 * (getServiceRoleClient, next/headers…) để Vitest chạy được.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map SQLSTATE từ RPC → HTTP status (khớp PATCH map '23505'). */
export function mapRepointErrorStatus(code: string | undefined): number {
  if (code === "23505") return 409;
  if (code === "P0002") return 404;
  return 400;
}

export type RepointBody = { target_employee_id: string; source_employee_id: string };

/** Validate body POST repoint: 2 field uuid bắt buộc. */
export function validateRepointBody(
  body: unknown
): { ok: true; value: RepointBody } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "Body không hợp lệ." };
  }
  const b = body as Record<string, unknown>;
  const target = typeof b.target_employee_id === "string" ? b.target_employee_id.trim() : "";
  const source = typeof b.source_employee_id === "string" ? b.source_employee_id.trim() : "";
  if (!UUID_RE.test(target)) return { ok: false, error: "Thiếu hoặc sai nhân viên đích." };
  if (!UUID_RE.test(source)) return { ok: false, error: "Thiếu hoặc sai nhân viên nguồn." };
  return { ok: true, value: { target_employee_id: target, source_employee_id: source } };
}

/** Chặn re-point chính tài khoản đang đăng nhập. */
export function isSelfRepoint(callerUserId: string, targetAuthUserId: string): boolean {
  return callerUserId === targetAuthUserId;
}
```

- [ ] **Step 2: Chạy test, xác nhận PASS**

Run: `npm run test:run -- src/lib/__tests__/repoint-account.test.ts`
Expected: PASS (tất cả).

- [ ] **Step 3: Commit**

```bash
git add src/lib/repoint-account.ts
git commit -m "feat(repoint): pure validation + SQLSTATE→HTTP helpers"
```

---

## Task 5: Route `POST /api/users/[id]/repoint`

**Files:**
- Create: `src/app/api/users/[id]/repoint/route.ts`

- [ ] **Step 1: Viết route handler**

```ts
/**
 * POST /api/users/<auth_user_id>/repoint — đổi nhân viên cho một tài khoản ĐÃ gắn
 * (re-point) sang NV đích chưa có TK; deactivate NV nguồn. Owner-only.
 * Nguyên tử qua RPC public.repoint_account(uuid,uuid,uuid).
 * Spec: docs/superpowers/specs/2026-06-26-repoint-account-design.md
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServiceRoleClient, requireAuth } from "@/lib/supabase/server";
import {
  mapRepointErrorStatus,
  validateRepointBody,
  isSelfRepoint
} from "@/lib/repoint-account";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function err(message: string, status = 400) {
  return NextResponse.json({ status: "error", error: message }, { status });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  let caller: { userId: string; role: string };
  try {
    caller = await requireAuth(req.headers.get("authorization"), ["owner"]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth failed.";
    const code = message.includes("Authorization") || message.includes("Token") ? 401 : 403;
    return err(message, code);
  }

  const { id: authUserId } = await ctx.params;
  if (!authUserId) return err("Thiếu auth_user_id");
  if (isSelfRepoint(caller.userId, authUserId)) {
    return err("Không thể đổi nhân viên cho chính tài khoản của bạn.");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return err("Body không phải JSON.");
  }
  const parsed = validateRepointBody(raw);
  if (!parsed.ok) return err(parsed.error);

  const supabase = getServiceRoleClient();
  const { data, error } = await supabase.rpc("repoint_account", {
    p_auth_user_id: authUserId,
    p_target_employee_id: parsed.value.target_employee_id,
    p_expected_source_employee_id: parsed.value.source_employee_id
  });
  if (error) {
    return err(error.message, mapRepointErrorStatus((error as { code?: string }).code));
  }
  return NextResponse.json({ status: "ok", result: data });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` và `npm run lint`
Expected: không lỗi mới ở file này.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/users/[id]/repoint/route.ts"
git commit -m "feat(api): POST /api/users/[id]/repoint (owner-only re-point)"
```

---

## Task 6: Data layer `repointAccount` + hook `useRepointUser`

**Files:**
- Modify: `src/lib/data/accounts.ts` (thêm function cuối file)
- Modify: `src/hooks/mutations/use-settings-mutations.ts` (import + hook)

- [ ] **Step 1: Thêm `repointAccount` vào `src/lib/data/accounts.ts`**

Chèn cuối file (sau `fetchUnlinkedAccounts`):

```ts
/** Re-point một tài khoản ĐÃ gắn sang NV đích khác (owner-only). */
export async function repointAccount(
  supabase: SupabaseClient,
  authUserId: string,
  targetEmployeeId: string,
  sourceEmployeeId: string
) {
  const headers = { ...(await authHeader(supabase)), "Content-Type": "application/json" };
  const res = await fetch(`/api/users/${authUserId}/repoint`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      target_employee_id: targetEmployeeId,
      source_employee_id: sourceEmployeeId
    })
  });
  const json = (await res.json()) as { status: string; error?: string };
  if (!res.ok || json.status !== "ok") {
    throw new Error(json.error ?? `Đổi nhân viên thất bại (HTTP ${res.status}).`);
  }
}
```

(Tự export qua barrel `src/lib/data/index.ts` — đã `export * from "./accounts"`.)

- [ ] **Step 2: Thêm hook vào `src/hooks/mutations/use-settings-mutations.ts`**

Sửa import `@/lib/data` (thêm `repointAccount`):

```ts
import {
  updateSidebarDefaults,
  updateUserSidebarConfig,
  updateHandoverDefaultTasks,
  updateShiftBonusConfig,
  createUserAccount,
  updateUserAccount,
  deactivateUserAccount,
  repointAccount,
  approveSignupRequest,
  rejectSignupRequest,
  type CreateUserPayload
} from "@/lib/data";
```

Thêm hook (sau `useDeactivateUser`):

```ts
export interface RepointUserInput {
  authUserId: string;
  targetEmployeeId: string;
  sourceEmployeeId: string;
}

export function useRepointUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RepointUserInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return repointAccount(
        supabase,
        input.authUserId,
        input.targetEmployeeId,
        input.sourceEmployeeId
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
      queryClient.invalidateQueries({ queryKey: queryKeys.accountedEmployeeIds() });
      queryClient.invalidateQueries({ queryKey: queryKeys.unlinkedAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.employees() });
    }
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: không lỗi.

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/accounts.ts src/hooks/mutations/use-settings-mutations.ts
git commit -m "feat(repoint): data fn + useRepointUser mutation"
```

---

## Task 7: UI — mục "Đổi nhân viên" trong Edit Account modal

**Files:**
- Modify: `src/features/settings/edit-account-modal.tsx`

- [ ] **Step 1: Import hook + thêm state**

Thêm vào import mutations:

```ts
import { useUpdateUser, useRepointUser } from "@/hooks/mutations/use-settings-mutations";
```

Trong component, sau `const updateM = useUpdateUser(supabase);`:

```ts
  const repointM = useRepointUser(supabase);
  const [repointTargetId, setRepointTargetId] = useState("");
  const [repointConfirm, setRepointConfirm] = useState(false);
  const [repointError, setRepointError] = useState<string | null>(null);
```

Trong `useEffect` init (đoạn reset khi mở modal), thêm:

```ts
    setRepointTargetId("");
    setRepointConfirm(false);
    setRepointError(null);
```

[NB-2] Gộp trạng thái busy để khi repoint chạy thì nút "Lưu" (luồng sửa field) cũng disable, tránh PATCH + repoint chạy song song. Sửa dòng `const isBusy = updateM.isPending;` thành:

```ts
  const isBusy = updateM.isPending || repointM.isPending;
```

(`repointM` khai báo ngay sau `updateM`, trước dòng `isBusy` — hợp lệ.)

- [ ] **Step 2: Thêm điều kiện hiển thị + handler (sau khai báo `isUnlinked`)**

```ts
  // Re-point: chỉ owner, account ĐÃ gắn NV, và không phải chính mình.
  const canRepoint = !isUnlinked && !isSelf && approverRole === "owner";
  const repointTargetName =
    unlinkedEmployees.find((e) => e.id === repointTargetId)?.name ?? "";

  async function handleRepoint() {
    if (!account || !account.employee_id || !repointTargetId) return;
    setRepointError(null);
    try {
      await repointM.mutateAsync({
        authUserId: account.auth_user_id,
        targetEmployeeId: repointTargetId,
        sourceEmployeeId: account.employee_id
      });
      toast({ semantic: "success", message: "Đã đổi nhân viên cho tài khoản." });
      onOpenChange(false);
    } catch (err) {
      setRepointError(err instanceof Error ? err.message : "Đổi nhân viên thất bại.");
    }
  }
```

- [ ] **Step 3: Thêm JSX block (đặt sau khối `{isUnlinked ? (...) : (...)}`, vẫn trong `<form>` nhưng trước `<ModalActions>`)**

```tsx
          {canRepoint && (
            <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-border p-3">
              <p className="text-sm font-medium text-ink">Đổi nhân viên cho tài khoản</p>
              {repointError && (
                <AlertBanner variant="danger" title="Không đổi được">
                  {repointError}
                </AlertBanner>
              )}
              {unlinkedEmployees.length === 0 ? (
                <p className="text-sm text-muted">
                  Không có nhân viên (chưa có tài khoản) để chuyển sang.
                </p>
              ) : (
                <>
                  <Select
                    value={repointTargetId || "__none__"}
                    onValueChange={(v) => {
                      setRepointTargetId(v === "__none__" ? "" : v);
                      setRepointConfirm(false);
                    }}
                    disabled={repointM.isPending}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Chọn nhân viên đích —</SelectItem>
                      {unlinkedEmployees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {repointTargetId && !repointConfirm && (
                    <>
                      <p className="text-xs text-warning">
                        Nhân viên nguồn «{account.employee_name}» sẽ chuyển sang Nghỉ;
                        tài khoản sẽ gắn vào «{repointTargetName}».
                      </p>
                      <div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setRepointConfirm(true)}
                          disabled={repointM.isPending}
                        >
                          Đổi nhân viên
                        </Button>
                      </div>
                    </>
                  )}
                  {repointTargetId && repointConfirm && (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRepointConfirm(false)}
                        disabled={repointM.isPending}
                      >
                        Hủy
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleRepoint}
                        loading={repointM.isPending}
                      >
                        Xác nhận đổi sang «{repointTargetName}»
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
```

(Tất cả nút trong block là `type="button"` → KHÔNG submit form sửa field.)

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit` và `npm run lint`
Expected: không lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/edit-account-modal.tsx
git commit -m "feat(settings): 'Đổi nhân viên cho tài khoản' trong Edit modal (owner-only)"
```

---

## Task 8: Verify toàn bộ + chạy app thật

- [ ] **Step 1: Vitest + lint + typecheck**

```bash
npm run test:run
npm run lint
npx tsc --noEmit
```

Expected: tất cả xanh. (KHÔNG chạy `npm run build` khi `next dev` 3009 đang chạy.)

- [ ] **Step 2: pgTAP toàn suite trên throwaway DB (xác nhận không vỡ test khác)**

```powershell
$env:PGTAP_DB_URL = 'postgres://postgres:postgres@localhost:5432/chill_pgtap'
node scripts/ci/apply-schema.mjs
node scripts/pgtap-run.mjs            # toàn bộ database/tests/*.sql
```

(Bash tool tương đương: `export PGTAP_DB_URL='...'`.)

Expected: `✓ All assertions passed.` (gồm cả 320 mới = 18/18).

- [ ] **Step 3: Sanity đếm TK kẹt trên dev DB (chỉ báo cáo)**

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select count(*) as unlinked_accounts from public.employee_accounts where employee_id is null;"
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select name, count(*) from public.employees group by name having count(*)>1 order by 2 desc;"
```

Ghi lại số lượng để biết quy mô TK kẹt cần owner dọn thủ công.

- [ ] **Step 4: Verify thủ công trên app (port 3009)**

1. Đăng nhập owner (`owner@chill.local`). Settings → Quản lý tài khoản → "Sửa" một tài khoản đã gắn NV-ảo.
2. Mục "Đổi nhân viên cho tài khoản" → chọn NV đích (active, chưa có TK) → "Đổi nhân viên" → "Xác nhận đổi sang …".
3. Kỳ vọng: toast success; bảng cập nhật (TK giờ hiển thị tên NV đích); NV nguồn biến mất khỏi danh sách active.
4. Xác nhận DB:

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select ea.auth_user_id, ea.employee_id, e.name, e.is_active from public.employee_accounts ea join public.employees e on e.id=ea.employee_id where ea.auth_user_id='<auth_user_id>';"
```

5. Đăng nhập manager → xác nhận KHÔNG thấy mục "Đổi nhân viên" (owner-only).

---

## Task 9: Codex review diff + hoàn tất nhánh

- [ ] **Step 1: Codex review toàn diff** (bắt buộc theo CLAUDE.md — fix mọi finding rồi mới PR).
- [ ] **Step 2:** REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch` → mở PR vào `main`. Tag `vX.Y.Z` (v4.5.2 → đề xuất **v4.6.0**: feature mới) sau khi merge.

---

## Self-Review (đối chiếu spec)

**Spec coverage:** §4.1 RPC → Task 2 (+ pgTAP Task 1). §4.2 route → Task 5 (+ helper Task 4). §4.3 data/hook/UI → Task 6, 7. §6 acceptance → Task 1 (pgTAP #7-15), Task 3 (helper), Task 8 (manual). §7.1 pgTAP → Task 1. §7.2 Vitest → Task 3. §8 files → tất cả file có task. [B-1] triple-write → Task 2 (3 file). [B-2] helper+Vitest → Task 3/4. [B-3] upsert → Task 2 Step 1 (profiles upsert) + Task 1 #10/#11. [NB-1] expected source → Task 2 + Task 1 #6. [NB-2] 3 bảng con → Task 1 #14/#15. [B-NEW] FOR UPDATE + conditional UPDATE → Task 2. [NB-NEW] grant test caveat → Task 1 comment header.

**Placeholder scan:** không có TBD/TODO; mọi step có code/lệnh cụ thể + expected output.

**Type consistency:** `repointAccount(supabase, authUserId, targetEmployeeId, sourceEmployeeId)` đồng nhất giữa Task 6 (định nghĩa) và Task 7 (gọi qua hook input `{authUserId, targetEmployeeId, sourceEmployeeId}`). RPC param `p_auth_user_id/p_target_employee_id/p_expected_source_employee_id` đồng nhất giữa Task 2 (định nghĩa), Task 5 (route gọi), Task 1 (pgTAP gọi). Helper tên `mapRepointErrorStatus/validateRepointBody/isSelfRepoint` đồng nhất Task 3/4/5.

## Codex plan review — findings đã xử lý

- **[B-1] (blocking)** Block hàm 002 có inline comment nhưng migration không → Step 5 diff fail. → **Đã sửa**: gỡ inline comment khỏi thân hàm 002 → 002 ≡ migration (comment-free, theo precedent `check_in_self`).
- **[NB-1]** Lệnh verify dùng Bash syntax không chạy PowerShell. → **Đã sửa**: env-var `$env:PGTAP_DB_URL` (Task 1 Step 2, Task 8 Step 2) + diff byte-identical đổi sang node one-liner cross-shell (Task 2 Step 5).
- **[NB-2]** Repoint pending nhưng nút Lưu vẫn bật → PATCH + repoint song song. → **Đã sửa**: `const isBusy = updateM.isPending || repointM.isPending;` (Task 7 Step 1).

Codex đã verify OK: SQL logic, vị trí chèn 003 (002 tạo hàm trước 003 → không pitfall ordering), pgTAP fixtures khớp schema + `plan(18)` đúng, imports/queryKeys/UI props tồn tại.
