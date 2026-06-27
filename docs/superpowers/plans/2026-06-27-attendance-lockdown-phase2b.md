# Attendance Lockdown Phase 2b — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khóa chấm công/sửa lương THỦ CÔNG về owner-only, chặn MỌI direct PostgREST write vào `shift_assignments`/`shift_payroll_records` (write chỉ qua security-definer RPC), và làm audit attendance truy được theo actor cho cả write tự phục vụ.

**Architecture:** DB-first, dual-write (canonical `database/002_functions.sql` + `003_rls.sql` ↔ migration byte-identical). Enforcement 3 lớp: (1) guard `app_is_owner()` trong 3 RPC manual; (2) RLS bỏ hẳn write policy → direct write deny cho mọi `authenticated` (RPC `security definer` bypass RLS nên không ảnh hưởng); (3) trigger audit riêng coalesce actor từ row. UI chỉ ẩn nút (defense-in-depth). TDD qua pgTAP `340`.

**Tech Stack:** Postgres (Supabase local), pgTAP qua `tools/pgtap-local.mjs` (throwaway DB `chill_pgtap`), Next.js 15 / React 19 / TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-27-attendance-lockdown-phase2b-design.md` (đã qua Codex adversarial review, 2 finding đã fold vào).

---

## Pre-flight (làm trước Task 1)

- [ ] **Base off `origin/main`** (đang ở v4.9.0). Branch mới:
```bash
git fetch origin main
git checkout -b feat/attendance-lockdown-phase2b origin/main
```
- [ ] **Quy ước dual-write:** mỗi thay đổi SQL phải vào **CẢ HAI**: `database/002_functions.sql` (hoặc `003_rls.sql`) **và** `database/migrations/2026-06-27-attendance-lockdown.sql`, byte-identical. Migration phải tự đứng được (chứa full thân hàm).
- [ ] **Chạy pgTAP:** `node tools/pgtap-local.mjs --reset --all` (reset throwaway `chill_pgtap`, apply 001/002/003 + tất cả migration, chạy mọi `database/tests/*.sql`). KHÔNG chạy trên `supabase-db` dev.
- [ ] Tạo file migration rỗng có header:
```bash
# database/migrations/2026-06-27-attendance-lockdown.sql
```
```sql
-- Attendance lockdown Phase 2b: manual chấm công + sửa lương owner-only;
-- bỏ direct-write RLS (Codex #1); audit attendance actor-indexable (Codex #2).
-- Dual-write: byte-identical với 002_functions.sql + 003_rls.sql.
```

---

## File Structure

| File | Trách nhiệm | Loại |
|---|---|---|
| `database/tests/340_attendance_lockdown.sql` | pgTAP: guard owner-only, RLS no-direct-write, self check-in/out không vỡ, audit actor | Create |
| `database/002_functions.sql` | `app_is_owner()`; guard 3 RPC; `_audit_attendance_change()` + 2 trigger | Modify |
| `database/003_rls.sql` | Bỏ 4 write policy | Modify |
| `database/migrations/2026-06-27-attendance-lockdown.sql` | Bản sao byte-identical mọi thay đổi DB | Create |
| `src/features/shifts/shifts-view.tsx` | Gate nút Vào/Ra/Sửa về `isOwner` | Modify |
| `src/features/shifts/employee-grid.tsx` | Ẩn trigger check-in/out cho non-owner | Modify |
| `src/features/shifts/payroll-history-card.tsx` | Ẩn nút Sửa lương cho non-owner | Modify |

---

## Task 1: pgTAP test `340_attendance_lockdown.sql` (đỏ trước)

**Files:**
- Create: `database/tests/340_attendance_lockdown.sql`

- [ ] **Step 1: Viết test đầy đủ**

```sql
-- 340 — Attendance lockdown Phase 2b: manual chấm công + sửa lương owner-only;
-- bỏ direct-write RLS (Codex #1); audit attendance actor-indexable (Codex #2).
-- Throwaway DB only (auth-mock + 001 + 002 + 003 + migrations).
begin;
select plan(17);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

-- Giả lập service role (không 'sub') → auth.uid() null, như self check-in/out chạy thật.
create or replace function pg_temp.act_as_service()
returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
end; $$ language plpgsql;

-- ===== Fixtures =====
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000003','op@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000004','self@t.local','',now(),'00000000-0000-0000-0000-000000000000');

insert into public.employees (id, name, hourly_rate) values
  ('e0000000-0000-0000-0000-000000000001','NV Target',30000),
  ('e0000000-0000-0000-0000-000000000004','NV Self',30000);

insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active'),
  ('a0000000-0000-0000-0000-000000000003', null, 'staff_operator','active'),
  ('a0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000004','employee_self_service','active');

-- Fixture ca + lương đã đóng (actor cols = owner → audit fixture không có null actor).
insert into public.shift_assignments
  (id, employee_id, business_date, check_in_at, check_out_at, total_minutes, status, created_by, updated_by)
values ('5a000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-000000000001', current_date,
        now()-interval '2 hours', now()-interval '1 hour', 60, 'checked_out',
        'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
insert into public.shift_payroll_records
  (id, shift_assignment_id, employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay, created_by, edited_by, edited_at)
values ('9a000000-0000-0000-0000-0000000000aa','5a000000-0000-0000-0000-0000000000aa','e0000000-0000-0000-0000-000000000001',
        current_date, 60, 30000, 30000, 30000,
        'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001', now());

-- ===== Group A — manual RPC owner-only =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select throws_like(
  $$ select public.check_in_employee('{"employee_id":"e0000000-0000-0000-0000-000000000001"}'::jsonb) $$,
  '%chủ quán%', 'manager KHÔNG check_in_employee được (owner-only)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003'); -- staff_operator
select throws_like(
  $$ select public.check_out_employee('{"shift_assignment_id":"5a000000-0000-0000-0000-0000000000aa","employee_id":"e0000000-0000-0000-0000-000000000001"}'::jsonb) $$,
  '%chủ quán%', 'staff_operator KHÔNG check_out_employee được (owner-only)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select throws_like(
  $$ select public.edit_shift_payroll_record('{"payroll_record_id":"9a000000-0000-0000-0000-0000000000aa"}'::jsonb) $$,
  '%chủ quán%', 'manager KHÔNG edit_shift_payroll_record được (owner-only)');
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
select lives_ok(
  $$ select public.check_in_employee(json_build_object('employee_id','e0000000-0000-0000-0000-000000000001','business_date',current_date::text)::jsonb) $$,
  'owner check_in_employee vẫn được');

-- ===== Group B — RLS no-direct-write (Codex #1: owner cũng bị chặn) =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
set local role authenticated;
select throws_ok(
  $$ insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
     values ('e0000000-0000-0000-0000-000000000001', current_date, 1, 1, 1, 1) $$,
  '42501', null, 'owner KHÔNG INSERT thẳng shift_payroll_records (RLS deny)');
select throws_ok(
  $$ insert into public.shift_assignments (employee_id, business_date, check_in_at, status)
     values ('e0000000-0000-0000-0000-000000000004', current_date, now(), 'checked_out') $$,
  '42501', null, 'owner KHÔNG INSERT thẳng shift_assignments (RLS deny)');
select is(
  (with u as (update public.shift_payroll_records set total_pay = 999 where id='9a000000-0000-0000-0000-0000000000aa' returning 1)
   select count(*)::int from u),
  0, 'owner UPDATE thẳng shift_payroll_records → 0 rows (RLS deny)');
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
set local role authenticated;
select throws_ok(
  $$ insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
     values ('e0000000-0000-0000-0000-000000000001', current_date, 1, 1, 1, 1) $$,
  '42501', null, 'manager KHÔNG INSERT thẳng shift_payroll_records');
reset role;
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003'); -- operator
set local role authenticated;
select ok((select count(*)::int from public.shift_payroll_records) > 0,
  'staff_operator vẫn ĐỌC được shift_payroll_records (read không bị siết)');
reset role;

-- ===== Group C — self check-in/out KHÔNG vỡ (service role, definer bypass RLS) =====
select pg_temp.act_as_service(); -- auth.uid() null
select lives_ok(
  $$ select public.check_in_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  'check_in_self chạy dù đã bỏ write policy (definer bypass)');
select is(
  (select status from public.shift_assignments
   where employee_id='e0000000-0000-0000-0000-000000000004' and business_date=current_date
   order by check_in_at desc limit 1),
  'checked_in', 'self check-in tạo ca checked_in');
select lives_ok(
  $$ select public.check_out_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  'check_out_self chạy (definer bypass)');
select is(
  (select count(*)::int from public.shift_payroll_records where employee_id='e0000000-0000-0000-0000-000000000004'),
  1, 'self check-out tạo 1 payroll row');

-- ===== Group D — audit actor (Codex #2) =====
select ok(exists(
  select 1 from public.audit_log
  where action='shift_assignments.insert'
    and actor_user_id='a0000000-0000-0000-0000-000000000004'
    and actor_role='employee_self_service'),
  'audit self check-in: actor=emp4 + role NV (không null/anonymous)');
select ok(exists(
  select 1 from public.audit_log
  where action='shift_payroll_records.insert'
    and actor_user_id='a0000000-0000-0000-0000-000000000004'),
  'audit self check-out payroll: actor=emp4');
select ok(exists(
  select 1 from public.audit_log
  where action='shift_assignments.insert'
    and actor_user_id='a0000000-0000-0000-0000-000000000001'
    and actor_role='owner'),
  'audit owner manual: actor=owner');
select is(
  (select count(*)::int from public.audit_log where action like 'shift_%' and actor_user_id is null),
  0, 'KHÔNG audit attendance nào có actor_user_id null (Codex #2)');

select * from finish();
rollback;
```

- [ ] **Step 2: Chạy để xác nhận ĐỎ**

Run: `node tools/pgtap-local.mjs --reset --all`
Expected: `340_attendance_lockdown.sql` FAIL — Group A guards chưa siết (manager/operator vẫn vào được → throws_like fail), Group B direct write chưa bị chặn (insert thành công → throws_ok fail), Group D audit actor null (chưa có trigger mới). Các file khác (310/330…) vẫn xanh.

- [ ] **Step 3: Commit test đỏ**

```bash
git add database/tests/340_attendance_lockdown.sql
git commit -m "test(checkin): pgTAP 340 cho attendance lockdown Phase 2b (đỏ trước)"
```

---

## Task 2: Helper `app_is_owner()`

**Files:**
- Modify: `database/002_functions.sql` (ngay sau `app_is_staff_or_above` 002:46-52)
- Modify: `database/migrations/2026-06-27-attendance-lockdown.sql`

- [ ] **Step 1: Thêm helper vào 002 + migration (byte-identical)**

```sql
create or replace function public.app_is_owner()
returns boolean language sql stable security definer
set search_path = public, auth
as $$ select public.app_role() = 'owner'; $$;
```

- [ ] **Step 2: Chạy pgTAP (vẫn đỏ, ít fail hơn không bắt buộc)**

Run: `node tools/pgtap-local.mjs --reset --all`
Expected: 340 vẫn FAIL (chưa dùng helper). Không file nào regress.

- [ ] **Step 3: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-27-attendance-lockdown.sql
git commit -m "feat(db): app_is_owner() helper (Phase 2b)"
```

---

## Task 3: Siết guard 3 RPC manual về owner-only

**Files:**
- Modify: `database/002_functions.sql` (3 dòng guard: 002:525, 002:576, 002:617)
- Modify: `database/migrations/2026-06-27-attendance-lockdown.sql` (copy full thân 3 hàm)

- [ ] **Step 1: Đổi 3 dòng guard trong 002_functions.sql**

`check_in_employee` (002:525) — đổi:
```sql
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền vào ca.'; end if;
```
thành:
```sql
  if not public.app_is_owner() then raise exception 'Chỉ chủ quán được vào ca hộ. Nhân viên tự vào ca ở màn Chấm công.'; end if;
```

`check_out_employee` (002:576) — đổi:
```sql
  if not public.app_is_staff_or_above() then raise exception 'Bạn không có quyền ra ca.'; end if;
```
thành:
```sql
  if not public.app_is_owner() then raise exception 'Chỉ chủ quán được ra ca hộ. Nhân viên tự ra ca ở màn Chấm công.'; end if;
```

`edit_shift_payroll_record` (002:617) — đổi:
```sql
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được sửa lượt lương đã chốt.';
  end if;
```
thành:
```sql
  if not public.app_is_owner() then
    raise exception 'Chỉ chủ quán được sửa lượt lương đã chốt.';
  end if;
```

- [ ] **Step 2: Dual-write vào migration — copy FULL thân 3 hàm**

Copy nguyên 3 khối `create or replace function ...` từ 002_functions.sql **sau khi đã sửa guard** (check_in_employee 002:513-555, check_out_employee 002:557-598, edit_shift_payroll_record 002:600-~700) vào migration. Migration phải chứa full body (tự đứng được), KHÔNG chỉ dòng guard. Giữ nguyên mọi phần còn lại (validate giờ, idempotency, cash-close-final guard, payroll/cash write).

- [ ] **Step 3: Chạy pgTAP — Group A chuyển xanh**

Run: `node tools/pgtap-local.mjs --reset --all`
Expected: 340 Group A (4 assert đầu) PASS; Group B/C/D có thể còn fail. Không file nào regress (310/330 không gọi 3 RPC này nên không ảnh hưởng).

- [ ] **Step 4: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-27-attendance-lockdown.sql
git commit -m "feat(checkin): khóa check_in/out_employee + edit_shift_payroll_record về owner-only (Phase 2b)"
```

---

## Task 4: Bỏ 4 write policy RLS

**Files:**
- Modify: `database/003_rls.sql` (003:159-169 — các `shifts_staff_write/update`, `payroll_staff_write/update`)
- Modify: `database/migrations/2026-06-27-attendance-lockdown.sql`

- [ ] **Step 1: Trong 003_rls.sql, thay 4 khối create-policy write bằng drop-only**

Xóa các `create policy` cho `shifts_staff_write` (003:159-160), `shifts_staff_update` (003:161-162), `payroll_staff_write` (003:166-167), `payroll_staff_update` (003:168-169); thay bằng:
```sql
-- Phase 2b: KHÔNG cho authenticated ghi trực tiếp. Mọi write qua security-definer RPC.
drop policy if exists shifts_staff_write on public.shift_assignments;
drop policy if exists shifts_staff_update on public.shift_assignments;
drop policy if exists payroll_staff_write on public.shift_payroll_records;
drop policy if exists payroll_staff_update on public.shift_payroll_records;
```
**GIỮ NGUYÊN** `shifts_staff_read` (003:157-158) và `payroll_staff_read` (003:164-165).

- [ ] **Step 2: Dual-write vào migration (4 dòng `drop policy if exists` y hệt)**

- [ ] **Step 3: Chạy pgTAP — Group B chuyển xanh**

Run: `node tools/pgtap-local.mjs --reset --all`
Expected: 340 Group B (5 assert) PASS (direct write deny, read còn). Group A vẫn PASS. Group D còn fail (chưa có trigger). Không file regress.

- [ ] **Step 4: Commit**

```bash
git add database/003_rls.sql database/migrations/2026-06-27-attendance-lockdown.sql
git commit -m "feat(checkin): bỏ direct-write RLS trên shift_assignments/payroll — chỉ qua RPC (Codex #1)"
```

---

## Task 5: `_audit_attendance_change()` + 2 trigger

**Files:**
- Modify: `database/002_functions.sql` (cạnh `_audit_row_change` 002:1744; trigger `audit_payroll` 002:1771-1774)
- Modify: `database/migrations/2026-06-27-attendance-lockdown.sql`

- [ ] **Step 1: Thêm hàm + đổi 2 trigger trong 002 + migration**

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
  -- auth.uid() (owner manual qua session) → else actor lưu trên row (self-service set updated_by/edited_by/created_by = p_auth_user_id).
  v_actor := coalesce(
    auth.uid(),
    (v_new->>'updated_by')::uuid, (v_new->>'edited_by')::uuid, (v_new->>'created_by')::uuid,
    (v_old->>'updated_by')::uuid, (v_old->>'created_by')::uuid
  );
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

-- shift_assignments: trigger audit MỚI (trước Phase 2b chưa có).
drop trigger if exists audit_shift_assignments on public.shift_assignments;
create trigger audit_shift_assignments after insert or update or delete on public.shift_assignments
  for each row execute function public._audit_attendance_change();

-- shift_payroll_records: THAY audit_payroll (002:1772) sang hàm mới để bắt actor cho lương tự-ra-ca.
drop trigger if exists audit_payroll on public.shift_payroll_records;
create trigger audit_payroll after insert or update or delete on public.shift_payroll_records
  for each row execute function public._audit_attendance_change();
```

> Lưu ý: trong 002_functions.sql, `audit_payroll` đang dùng `_audit_row_change` (002:1771-1774) — đổi nó trỏ sang `_audit_attendance_change`. `_audit_row_change` giữ nguyên cho 7 bảng còn lại.

- [ ] **Step 2: Chạy pgTAP — Group D chuyển xanh, TOÀN BỘ 340 PASS**

Run: `node tools/pgtap-local.mjs --reset --all`
Expected: `340_attendance_lockdown.sql: 17/17 passed ✓`. Toàn suite `0 failing`.

- [ ] **Step 3: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-27-attendance-lockdown.sql
git commit -m "feat(audit): _audit_attendance_change() coalesce actor cho shift_assignments+payroll (Codex #2)"
```

---

## Task 6: Verify DB toàn cục (regression gate)

**Files:** none (chỉ chạy lệnh)

- [ ] **Step 1: Full pgTAP suite**

Run: `node tools/pgtap-local.mjs --reset --all`
Expected: dòng cuối `──── N file(s), 0 failing assertion(s) ────`. 340 = 17/17, 310 = 28/28, 330 = 19/19 (không regress).

- [ ] **Step 2: Nếu có file regress** → systematic-debugging (đọc lỗi cụ thể, sửa, chạy lại). KHÔNG sang Task 7 khi DB còn đỏ.

---

## Task 7: UI gate trang ca về owner-only

**Files:**
- Modify: `src/features/shifts/shifts-view.tsx` (đã có `role: UserRole` + `canManage` ~line 49)
- Modify: `src/features/shifts/employee-grid.tsx` (nút check-in/check-out)
- Modify: `src/features/shifts/payroll-history-card.tsx` (nút Sửa lương)

- [ ] **Step 1: Đọc 3 file để xác định prop-flow hiện tại**

Run: đọc `shifts-view.tsx` (xem `canManage` truyền xuống đâu), `employee-grid.tsx`, `payroll-history-card.tsx`. Xác định prop nào bật nút check-in/out + sửa lương.

- [ ] **Step 2: Trong `shifts-view.tsx`, thêm cờ owner-only cạnh `canManage`**

```tsx
  const canManage = role === "owner" || role === "manager";
  const isOwner = role === "owner";
```
Truyền `isOwner` xuống các component con thay cho `canManage` **chỉ ở những nút GHI**: mở `CheckInModal`/`CheckOutModal` (employee-grid) + mở `PayrollEditModal` (payroll-history-card). Giữ `canManage` cho hiển thị read (nếu có).

- [ ] **Step 3: Trong `employee-grid.tsx` — ẩn nút Vào/Ra ca khi không phải owner**

Đổi điều kiện render nút check-in/check-out từ `canManage` (hoặc prop tương đương) sang `isOwner`. Khi `!isOwner`, render nhắc:
```tsx
{!isOwner && (
  <p className="text-xs text-muted">Tự vào/ra ca ở màn Chấm công. Đính chính do chủ quán thực hiện.</p>
)}
```

- [ ] **Step 4: Trong `payroll-history-card.tsx` — ẩn nút Sửa khi không phải owner**

Đổi điều kiện render nút "Sửa" (mở `PayrollEditModal`) sang `isOwner`. `!isOwner` → không render nút.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: `No errors found`.

- [ ] **Step 6: Commit**

```bash
git add src/features/shifts/shifts-view.tsx src/features/shifts/employee-grid.tsx src/features/shifts/payroll-history-card.tsx
git commit -m "feat(shifts): ẩn nút Vào/Ra ca + Sửa lương cho non-owner (Phase 2b UI)"
```

---

## Task 8: Verify cuối + PR + CI + merge + tag

**Files:** none

- [ ] **Step 1: Vitest + typecheck**

Run: `npx tsc --noEmit && npm run test:run`
Expected: tsc clean; Vitest all pass (không test nào dựa vào manual check-in/out của manager — nếu có test cũ giả định manager check-in được thì cập nhật theo hành vi mới + ghi rõ trong commit).

- [ ] **Step 2: Build (chỉ khi `next dev` 3009 KHÔNG chạy)**

Run: `npm run build`
Expected: build thành công. (Nếu 3009 đang chạy → tắt trước; xem CLAUDE.md.)

- [ ] **Step 3: Push + PR vào main**

```bash
git push -u origin feat/attendance-lockdown-phase2b
gh pr create --base main --head feat/attendance-lockdown-phase2b \
  --title 'feat(checkin): khóa chấm công thủ công về owner-only + RLS hardening + audit (Phase 2b)' \
  --body '<tóm tắt: 3 RPC owner-only; bỏ direct-write RLS (Codex #1); audit actor-indexable (Codex #2); pgTAP 340 17/17; spec link>'
```

- [ ] **Step 4: Đợi CI**

Run: `gh pr checks <PR#> --watch`
Expected: build / pgtap / typecheck / vitest đều SUCCESS.

- [ ] **Step 5: (Khuyến nghị) Codex adversarial review impl diff** trước merge (payroll/RLS nhạy cảm): `/codex:adversarial-review --base origin/main`. Fold finding nếu có.

- [ ] **Step 6: Squash merge + tag**

```bash
gh pr merge <PR#> --squash --delete-branch
git fetch origin main
git tag -a v4.10.0 origin/main -m "v4.10.0 — attendance lockdown owner-only + RLS hardening + audit (Phase 2b)"
git push origin v4.10.0
```
(Lỗi `gh pr merge` kiểu `'main' is already used by worktree` → bỏ qua, merge/tag trên remote vẫn chạy.)

---

## Self-Review (đã chạy khi viết plan)

**Spec coverage:**
- Spec §1.1 `app_is_owner()` → Task 2. ✓
- §1.2 guard 3 RPC owner-only → Task 3. ✓
- §1.3 bỏ write policy (Codex #1) → Task 4 + test Group B. ✓
- §1.4 `_audit_attendance_change` 2 trigger (Codex #2) → Task 5 + test Group D. ✓
- §1.5 migration dual-write → mọi DB task ghi cả migration. ✓
- §2 không route mới; verify caller → Task 7 Step 1 đọc data layer. ✓
- §3 UI gate → Task 7. ✓
- §5 test plan (guard, RLS, self không vỡ, audit) → Task 1 (17 assert). ✓
- §7.1 self check-in/out không vỡ → test Group C (load-bearing). ✓

**Placeholder scan:** Task 3 KHÔNG reproduce full 3 RPC body (chỉ dòng guard + chỉ dẫn copy range) — chủ ý cho dual-write hàm lớn để tránh drift khỏi canonical; mọi object MỚI/ngắn (helper, trigger, policy, test) có full code. Không TBD/TODO.

**Type/identifier consistency:** `app_is_owner()`, `_audit_attendance_change()`, `audit_shift_assignments`, `isOwner` dùng nhất quán giữa các task. Fixture UUID + action string ('shift_assignments.insert', 'shift_payroll_records.insert') khớp giữa test và trigger (`tg_table_name || '.' || lower(tg_op)`).

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-attendance-lockdown-phase2b.md`.**
