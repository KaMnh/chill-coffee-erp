# Manager Checkout + Shift-Start Gate — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho quản lý (owner+manager) đóng ca hộ nhân viên ở giờ hiện tại với phút làm tròn lên bội số 15; chặn nhân viên tự check-in trước giờ bắt đầu ca (cấu hình, mặc định 05:30); + bịt 2 finding Codex (final-close guard cho owner-checkout; merge config giữ key).

**Architecture:** DB-first, dual-write (`database/002_functions.sql` + `004_seed.sql` ↔ migration byte-identical). RPC mới `check_out_employee_now` (security-definer, owner+manager, làm tròn 15′, guard final-close, atomic). Guard 05:30 trong `check_in_self`. UI: tách nút Vào ca (owner) / Ra ca (owner+manager → manager dùng modal xác nhận, owner dùng modal đầy đủ cũ). TDD qua pgTAP `350`.

**Tech Stack:** Postgres (Supabase local), pgTAP qua `tools/pgtap-local.mjs` (throwaway `chill_pgtap`), Next.js 15 / React 19 / TS, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-28-manager-checkout-shift-start-design.md` (đã qua Codex adversarial review; #1+#3 fold, #2 hoãn — xem spec §7.6).

---

## Pre-flight

- [ ] Branch off `origin/main` (đang ở v4.11.0). **Đã có branch `feat/manager-checkout-shift-start`** (chứa spec). Tiếp tục trên branch này.
- [ ] **Dual-write:** mỗi thay đổi SQL vào CẢ `database/002_functions.sql` (hoặc `004_seed.sql`) VÀ `database/migrations/2026-06-28-manager-checkout-shift-start.sql` (tạo mới), byte-identical. Migration tự đứng được (full thân hàm).
- [ ] **pgTAP:** `node tools/pgtap-local.mjs --reset --all`. KHÔNG `npm run build` khi `next dev` 3009 chạy.
- [ ] Tạo migration với header:
```sql
-- Manager checkout (làm tròn 15') + shift_start_time gate + Codex #1/#3.
-- Dual-write: byte-identical với 002_functions.sql + 004_seed.sql.
```

## File Structure

| File | Trách nhiệm | Loại |
|---|---|---|
| `database/tests/350_manager_checkout.sql` | pgTAP: làm tròn, quyền, final-close (×2), 5:30 gate, config validate+merge | Create |
| `database/002_functions.sql` | `check_out_employee_now` mới; guard final-close `check_out_employee`; gate 05:30 `check_in_self`; validate+merge `update_checkin_network_config` | Modify |
| `database/004_seed.sql` | seed `shift_start_time` | Modify |
| `database/migrations/2026-06-28-manager-checkout-shift-start.sql` | Dual-write toàn bộ + data-fix | Create |
| `src/lib/types.ts` | `CheckinNetworkConfig.shift_start_time`; `ManagerCheckoutResult` | Modify |
| `src/lib/data/shifts.ts` | `checkOutEmployeeNow` | Modify |
| `src/features/shifts/manager-checkout-modal.tsx` | Modal xác nhận quản lý-đóng | Create |
| `src/features/shifts/employee-grid.tsx` | Tách nút Vào ca (owner) / Ra ca (canManage) | Modify |
| `src/features/shifts/shifts-view.tsx` | Wiring `ManagerCheckoutModal` | Modify |
| `src/features/settings/checkin-config-form.tsx` | Ô "Giờ bắt đầu ca" | Modify |

---

## Task 1: pgTAP test `350_manager_checkout.sql` (đỏ trước)

**Files:** Create `database/tests/350_manager_checkout.sql`

- [ ] **Step 1: Viết test đầy đủ**

```sql
-- 350 — Manager checkout (làm tròn 15') + check_out_employee final-close guard
-- (Codex #1) + check_in_self gate 05:30 + update_checkin_network_config validate/merge
-- (Codex #3). Throwaway DB (auth-mock + 001 + 002 + 003 + migrations).
begin;
select plan(13);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

-- ===== Fixtures =====
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000003','op@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000004','self@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employees (id, name, hourly_rate) values
  ('e0000000-0000-0000-0000-000000000001','NV 65',30000),
  ('e0000000-0000-0000-0000-000000000002','NV 60',30000),
  ('e0000000-0000-0000-0000-000000000003','NV Final',30000),
  ('e0000000-0000-0000-0000-000000000004','NV Self',30000);
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active'),
  ('a0000000-0000-0000-0000-000000000003', null, 'staff_operator','active'),
  ('a0000000-0000-0000-0000-000000000004','e0000000-0000-0000-0000-000000000004','employee_self_service','active');

-- Ca mở hôm nay (check_in lệch để test làm tròn). created_by/updated_by = owner.
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-000000000065','e0000000-0000-0000-0000-000000000001', current_date, now() - interval '65 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000060','e0000000-0000-0000-0000-000000000002', current_date, now() - interval '60 minutes', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');

-- Ca trên NGÀY HÔM QUA đã chốt két final (cho test final-close; không đụng ca hôm nay).
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-0000000000f1','e0000000-0000-0000-0000-000000000003', current_date - 1, (current_date - 1) + time '08:00', 'checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');
insert into public.cash_counts (id, business_date) values ('cc000000-0000-0000-0000-0000000000f1', current_date - 1);
insert into public.cash_close_reports (business_date, cash_count_id, report_status) values (current_date - 1, 'cc000000-0000-0000-0000-0000000000f1', 'final');

-- ===== Group A — check_out_employee_now (làm tròn + quyền + final-close) =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
-- 1: đóng ca 65' → checked_out
create temp table _c1 as select public.check_out_employee_now('5a000000-0000-0000-0000-000000000065'::uuid) as r;
select is((select status from public.shift_assignments where id='5a000000-0000-0000-0000-000000000065'),
  'checked_out', 'manager đóng ca → checked_out');
-- 2: 65' làm tròn LÊN 75'
select is((select total_minutes from public.shift_assignments where id='5a000000-0000-0000-0000-000000000065'),
  75, '65 phút làm tròn lên 75 (bội số 15)');
-- 3: lương = round(75/60×30000/1000)*1000 = 38000
select is((select total_pay from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000065'),
  38000::numeric(14,2), 'total_pay = 38000 (75 phút)');
-- 4: cash event = total_pay
select is((select amount from public.cash_drawer_events
  where shift_payroll_record_id=(select id from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000065')
    and event_type='payroll_cash_out'),
  38000::numeric(14,2), 'cash_drawer_events = total_pay');
-- 5: 60' giữ nguyên 60 (đã là bội số 15)
select public.check_out_employee_now('5a000000-0000-0000-0000-000000000060'::uuid);
select is((select total_minutes from public.shift_assignments where id='5a000000-0000-0000-0000-000000000060'),
  60, '60 phút giữ nguyên 60');
-- 6: đóng lại ca đã đóng → raise
select throws_like(
  $$ select public.check_out_employee_now('5a000000-0000-0000-0000-000000000065'::uuid) $$,
  '%không tồn tại hoặc đã đóng%', 'đóng lại ca đã đóng → raise');
-- 7: staff_operator KHÔNG đóng được
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
select throws_like(
  $$ select public.check_out_employee_now('5a000000-0000-0000-0000-0000000000f1'::uuid) $$,
  '%chủ quán hoặc quản lý%', 'staff_operator KHÔNG đóng ca hộ');
-- 8: manager đóng ca ngày đã chốt két final → raise
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select public.check_out_employee_now('5a000000-0000-0000-0000-0000000000f1'::uuid) $$,
  '%chốt két%', 'manager đóng ca ngày final → raise');

-- ===== Group B — check_out_employee (owner full) final-close guard (Codex #1) =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
select throws_like(
  $$ select public.check_out_employee(json_build_object(
       'shift_assignment_id','5a000000-0000-0000-0000-0000000000f1',
       'employee_id','e0000000-0000-0000-0000-000000000003',
       'business_date', (current_date - 1)::text)::jsonb) $$,
  '%chốt két%', 'owner check_out_employee ngày final → raise (Codex #1)');

-- ===== Group C — check_in_self gate 05:30 =====
-- LƯU Ý: throwaway DB KHÔNG apply 004_seed → KHÔNG có row checkin_network. Phải
-- INSERT (không UPDATE). '00:00' → không chặn (lives).
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"shift_start_time":"00:00"}'::jsonb, false)
  on conflict (key) do update set value = public.app_settings.value || excluded.value;
select lives_ok(
  $$ select public.check_in_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  'shift_start_time=00:00 → check_in_self KHÔNG bị chặn');
-- '23:59' → chặn (raise). (Rủi ro wall-clock 23:59–00:00; chấp nhận.)
update public.app_settings set value = value || '{"shift_start_time":"23:59"}'::jsonb where key='checkin_network';
select throws_like(
  $$ select public.check_in_self('a0000000-0000-0000-0000-000000000004'::uuid, '203.0.113.5'::inet, 'UA') $$,
  '%Chưa tới giờ vào ca%', 'shift_start_time=23:59 → check_in_self bị chặn');

-- ===== Group D — update_checkin_network_config validate + merge =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001'); -- owner
-- 12: shift_start_time sai định dạng → raise
select throws_like(
  $$ select public.update_checkin_network_config(
       '{"enabled":false,"reject_message":"x","grace_hours":12,"shift_start_time":"25:00"}'::jsonb) $$,
  '%HH:MM%', 'shift_start_time 25:00 → raise');
-- 13: merge — set 06:00 rồi lưu shape cũ (thiếu key) → vẫn giữ 06:00
select public.update_checkin_network_config('{"enabled":false,"reject_message":"x","grace_hours":12,"shift_start_time":"06:00"}'::jsonb);
select public.update_checkin_network_config('{"enabled":false,"reject_message":"x","grace_hours":12}'::jsonb);
select is(
  (select value->>'shift_start_time' from public.app_settings where key='checkin_network'),
  '06:00', 'config shape cũ KHÔNG xoá shift_start_time (merge, Codex #3)');

select * from finish();
rollback;
```

- [ ] **Step 2: Chạy → ĐỎ**

Run: `node tools/pgtap-local.mjs --reset --all`
Expected: `350_manager_checkout.sql` FAIL (chưa có `check_out_employee_now`; chưa guard/gate/merge). Các file khác xanh.

- [ ] **Step 3: Commit**
```bash
git add database/tests/350_manager_checkout.sql
git commit -m "test(checkin): pgTAP 350 cho manager-checkout + 5:30 gate (đỏ trước)"
```

---

## Task 2: RPC `check_out_employee_now` (002 + migration)

**Files:** Modify `database/002_functions.sql`, `database/migrations/2026-06-28-manager-checkout-shift-start.sql`

- [ ] **Step 1: Thêm hàm vào 002 (sau `check_out_self`, ~002:4722) + migration (y hệt)**

```sql
-- check_out_employee_now — QUẢN LÝ đóng ca hộ (owner+manager). Đóng ở giờ hiện tại
-- + LÀM TRÒN phút lên bội số 15 (tối đa +14). Chốt lương (phụ cấp 0). Guard
-- final-close. Authenticated-callable (guard nội bộ); actor = auth.uid().
create or replace function public.check_out_employee_now(p_shift_assignment_id uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_rate numeric(14,2); v_date date;
  v_in timestamptz; v_out timestamptz := now();
  v_raw integer; v_minutes integer; v_base numeric(14,2); v_total numeric(14,2);
  v_payroll_id uuid;
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được đóng ca hộ.';
  end if;

  select sa.employee_id, sa.business_date, sa.check_in_at, e.name, e.hourly_rate
    into v_employee, v_date, v_in, v_name, v_rate
    from public.shift_assignments sa join public.employees e on e.id = sa.employee_id
   where sa.id = p_shift_assignment_id and sa.status = 'checked_in';
  if not found then raise exception 'Ca không tồn tại hoặc đã đóng.'; end if;

  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;

  v_raw := greatest(0, round(extract(epoch from (v_out - v_in)) / 60)::integer);
  v_minutes := ((v_raw + 14) / 15) * 15;  -- làm tròn LÊN bội số 15 (tối đa +14)

  update public.shift_assignments
     set check_out_at = v_out, total_minutes = v_minutes, status = 'checked_out', updated_by = auth.uid()
   where id = p_shift_assignment_id and status = 'checked_in';
  if not found then raise exception 'Ca đã được đóng.'; end if;

  v_base := round(((v_minutes::numeric / 60) * coalesce(v_rate, 0)) / 1000) * 1000;
  v_total := v_base;

  insert into public.shift_payroll_records (shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, total_minutes, hourly_rate, base_pay, allowance_amount, total_pay, note, edited_by, edited_at, created_by)
  values (p_shift_assignment_id, v_employee, v_date, v_in, v_out, v_minutes, coalesce(v_rate,0), v_base, 0, v_total, null, auth.uid(), now(), auth.uid())
  on conflict (shift_assignment_id) do update set check_in_at = excluded.check_in_at, check_out_at = excluded.check_out_at, total_minutes = excluded.total_minutes, hourly_rate = excluded.hourly_rate, base_pay = excluded.base_pay, allowance_amount = excluded.allowance_amount, total_pay = excluded.total_pay, edited_by = auth.uid(), edited_at = now()
  returning id into v_payroll_id;

  delete from public.cash_drawer_events where shift_payroll_record_id = v_payroll_id and event_type = 'payroll_cash_out';
  if v_total > 0 then
    insert into public.cash_drawer_events (business_date, occurred_at, event_type, direction, amount, shift_payroll_record_id, created_by, source, note)
    values (v_date, v_out, 'payroll_cash_out', 'out', v_total, v_payroll_id, auth.uid(), 'app_action', 'Lương theo lượt (quản lý đóng ca)');
  end if;

  return jsonb_build_object('shift_assignment_id', p_shift_assignment_id, 'employee_name', v_name,
    'check_out_at', v_out, 'total_minutes', v_minutes, 'total_pay', v_total);
end; $$;
```
(KHÔNG cần revoke/grant riêng: blanket grant 003:57 + guard nội bộ, như `check_out_employee`.)

- [ ] **Step 2: Chạy pgTAP** — Group A asserts 1–8 phần lớn chuyển xanh (trừ những cái phụ thuộc task khác). `--reset --all`. Không file nào regress.

- [ ] **Step 3: Commit**
```bash
git add database/002_functions.sql database/migrations/2026-06-28-manager-checkout-shift-start.sql
git commit -m "feat(checkin): check_out_employee_now — quản lý đóng ca hộ + làm tròn phút 15'"
```

---

## Task 3: `check_out_employee` final-close guard (Codex #1)

**Files:** Modify `database/002_functions.sql` (002:557-598), migration

- [ ] **Step 1: Thêm guard sau dòng guard quyền (002:576)**

Trong `check_out_employee`, ngay sau `if not public.app_is_owner() then raise exception 'Chỉ chủ quán được ra ca hộ. Nhân viên tự ra ca ở màn Chấm công.'; end if;`, thêm:
```sql
  if exists (select 1 from public.cash_close_reports
             where business_date = v_date and report_status = 'final') then
    raise exception 'Ngày % đã chốt két (final) — không thể đóng ca. Hủy báo cáo trước.', v_date;
  end if;
```
(`v_date` đã khai báo trong hàm — 002:566.) **Dual-write:** paste FULL thân `check_out_employee` (002:557-598, đã thêm guard) vào migration.

- [ ] **Step 2: Chạy pgTAP** — Group B (assert 9) xanh. `--reset --all`. Không regress (250_edit_payroll_after_finalize chỉ test owner → không vỡ; các test check_out_employee khác KHÔNG dùng ngày final → không vỡ).

- [ ] **Step 3: Commit**
```bash
git add database/002_functions.sql database/migrations/2026-06-28-manager-checkout-shift-start.sql
git commit -m "fix(checkin): final-close guard cho check_out_employee (Codex #1)"
```

---

## Task 4: `check_in_self` gate 05:30 (002 + migration)

**Files:** Modify `database/002_functions.sql` (002:4479-4501), migration

- [ ] **Step 1: Thêm biến + guard**

Trong `check_in_self`: thêm `v_start time;` vào khối `declare` đầu hàm. Sau `if v_employee is null then raise exception 'Tài khoản chưa gắn nhân viên.'; end if;` (002:4487), thêm:
```sql
  -- Chặn vào ca trước giờ mở ca (mặc định 05:30). Session timezone = Asia/Ho_Chi_Minh
  -- → now()::time là giờ địa phương. Owner vào ca hộ (check_in_employee) không qua
  -- hàm này nên không bị chặn (override).
  v_start := coalesce(
    (select (value->>'shift_start_time')::time from public.app_settings where key = 'checkin_network'),
    '05:30'::time);
  if now()::time < v_start then
    raise exception 'Chưa tới giờ vào ca (mở lúc %).', to_char(v_start, 'HH24:MI');
  end if;
```
**Dual-write:** paste FULL thân `check_in_self` (002:4479-4501, đã sửa) vào migration.

- [ ] **Step 2: Chạy pgTAP** — Group C (assert 10–11) xanh. `--reset --all`. **Regress check (BẮT BUỘC):** 310_self_checkin + 330_self_checkout gọi check_in_self; vì throwaway DB KHÔNG có row checkin_network (không apply 004), gate dùng default `'05:30'` → nếu CI chạy **trước 05:30 VN** thì check_in_self trong 310/330 bị chặn → ĐỎ. **Fix:** thêm dòng sau vào 310 VÀ 330, đặt ngay sau khối fixtures (TRƯỚC mọi call check_in_self — ở 330 là trước Group H; merge của Group F sẽ giữ key này):
```sql
insert into public.app_settings (key, value, is_public) values
  ('checkin_network', '{"shift_start_time":"00:00"}'::jsonb, false)
  on conflict (key) do update set value = public.app_settings.value || excluded.value;
```
Chạy lại `--reset --all` xác nhận 310/330 vẫn xanh bất kể giờ chạy.

- [ ] **Step 3: Commit**
```bash
git add database/002_functions.sql database/migrations/2026-06-28-manager-checkout-shift-start.sql database/tests/310_self_checkin.sql database/tests/330_self_checkout.sql
git commit -m "feat(checkin): chặn check_in_self trước giờ bắt đầu ca (mặc định 05:30)"
```

---

## Task 5: `update_checkin_network_config` validate + merge (002 + migration)

**Files:** Modify `database/002_functions.sql` (002:4614-4639), migration

- [ ] **Step 1: Validate** — sau khối validate `self_checkout_enabled` (002:4624), thêm:
```sql
  if (p_config ? 'shift_start_time') and
     (jsonb_typeof(p_config->'shift_start_time') <> 'string'
      or (p_config->>'shift_start_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'shift_start_time phải là HH:MM (24 giờ).';
  end if;
```

- [ ] **Step 2: Merge** — đổi nhánh `on conflict do update` (002:4637) từ `set value = excluded.value, …` thành:
```sql
  on conflict (key) do update
    set value = public.app_settings.value || excluded.value,
        is_public = false, updated_by = auth.uid(), updated_at = now();
```
**Dual-write:** paste FULL thân `update_checkin_network_config` (002:4614-4639, đã sửa) vào migration.

- [ ] **Step 3: Chạy pgTAP** — Group D (assert 12–13) xanh. `--reset --all`.

- [ ] **Step 4: Commit**
```bash
git add database/002_functions.sql database/migrations/2026-06-28-manager-checkout-shift-start.sql
git commit -m "feat(checkin): validate shift_start_time + merge config giữ key cũ (Codex #3)"
```

---

## Task 6: Seed `shift_start_time` + migration data-fix

**Files:** Modify `database/004_seed.sql` (004:116), migration

- [ ] **Step 1: Seed** — thêm `"shift_start_time": "05:30"` vào JSON `checkin_network` (004:116):
```sql
  ('checkin_network', '{"enabled": false, "reject_message": "Chỉ chấm công được khi ở tại quán (nối wifi quán).", "grace_hours": 12, "self_checkout_enabled": false, "shift_start_time": "05:30"}'::jsonb, false)
```

- [ ] **Step 2: Data-fix trong migration** (config cũ chưa có key):
```sql
update public.app_settings
   set value = value || '{"shift_start_time": "05:30"}'::jsonb
 where key = 'checkin_network' and not (value ? 'shift_start_time');
```

- [ ] **Step 3: Commit**
```bash
git add database/004_seed.sql database/migrations/2026-06-28-manager-checkout-shift-start.sql
git commit -m "feat(checkin): seed + data-fix shift_start_time mặc định 05:30"
```

---

## Task 7: Verify DB toàn cục

**Files:** none

- [ ] **Step 1:** `node tools/pgtap-local.mjs --reset --all`
Expected: `350_manager_checkout.sql: 13/13 passed`; dòng cuối `0 failing assertion(s)`; 310/330/340 không regress.
- [ ] **Step 2:** Nếu regress → systematic-debugging (đặc biệt 310/330 gate giờ — xem Task 4 Step 2). KHÔNG sang UI khi DB còn đỏ.

---

## Task 8: Types + data layer

**Files:** Modify `src/lib/types.ts`, `src/lib/data/shifts.ts`

- [ ] **Step 1: `src/lib/types.ts`** — thêm vào `CheckinNetworkConfig`:
```ts
  /** Giờ bắt đầu ca "HH:MM" — chặn check_in_self trước giờ này (mặc định 05:30). */
  shift_start_time?: string;
```
và type mới:
```ts
export type ManagerCheckoutResult = { employee_name: string; check_out_at: string; total_minutes: number; total_pay: number };
```

- [ ] **Step 2: `src/lib/data/shifts.ts`** — thêm sau `checkOutEmployee`:
```ts
export async function checkOutEmployeeNow(supabase: SupabaseClient, shiftAssignmentId: string) {
  const { data, error } = await supabase.rpc("check_out_employee_now", { p_shift_assignment_id: shiftAssignmentId });
  if (error) throw toAppError(error, "Không đóng ca được.");
  return data as import("@/lib/types").ManagerCheckoutResult;
}
```

- [ ] **Step 3:** `npx tsc --noEmit` → No errors.
- [ ] **Step 4: Commit**
```bash
git add src/lib/types.ts src/lib/data/shifts.ts
git commit -m "feat(shifts): CheckinNetworkConfig.shift_start_time + checkOutEmployeeNow"
```

---

## Task 9: ManagerCheckoutModal + tách nút + wiring

**Files:** Create `src/features/shifts/manager-checkout-modal.tsx`; Modify `employee-grid.tsx`, `shifts-view.tsx`

- [ ] **Step 1: Tạo `manager-checkout-modal.tsx`**

Theo mẫu các modal hiện có (xem `check-out-modal.tsx` cho cấu trúc Dialog + mutation + toast). Modal nhỏ xác nhận:
```tsx
"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/toast";
import { checkOutEmployeeNow } from "@/lib/data/shifts";
import { queryKeys } from "@/hooks/queries/keys";
import { formatVND, durationLabel } from "@/lib/format";
import type { ShiftAssignment } from "@/lib/types";

export function ManagerCheckoutModal({
  open, onOpenChange, shift, businessDate,
}: {
  open: boolean;
  onOpenChange(next: boolean): void;
  shift: ShiftAssignment | null;
  businessDate: string;
}) {
  const supabase = useSupabase();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    if (!supabase || !shift || busy) return;
    setBusy(true);
    try {
      const r = await checkOutEmployeeNow(supabase, shift.id);
      qc.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
      qc.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      toast({
        semantic: "success",
        message: `Đã đóng ca ${r.employee_name}: ${durationLabel(r.total_minutes)} · ${formatVND(r.total_pay)}.`,
      });
      onOpenChange(false);
    } catch (e) {
      toast({ semantic: "danger", message: e instanceof Error ? e.message : "Không đóng ca được." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Đóng ca cho nhân viên">
      <div className="space-y-4">
        <p className="text-sm text-ink">
          Đóng ca <strong>{shift?.employee_name ?? "nhân viên"}</strong> ở <strong>giờ hiện tại</strong>.
          Phút công làm tròn lên bội số 15 (tối đa +14′). Chủ quán có thể sửa giờ/lương sau.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Huỷ</Button>
          <Button variant="primary" loading={busy} onClick={confirm}>Đóng ca</Button>
        </div>
      </div>
    </Dialog>
  );
}
```
*(Kiểm tra `queryKeys.shifts`/`queryKeys.payroll` + props `Dialog` đúng signature trong repo — chỉnh theo `check-out-modal.tsx` nếu khác. `ShiftAssignment` có `id`, `employee_name`.)*

- [ ] **Step 2: `employee-grid.tsx`** — tách nút (102-132). Thêm prop `onManagerCheckout(shift: ShiftAssignment): void;` vào interface + destructure. Thay khối `{isOwner && (<>Vào ca + Ra ca</>)}` (employee-grid.tsx:111-132) bằng:
```tsx
          {isOwner && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onCheckIn(employee)}
              disabled={isIn}
            >
              Vào ca
            </Button>
          )}
          {canManage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                if (!shift) return;
                isOwner ? onCheckOut(shift) : onManagerCheckout(shift);
              }}
              disabled={!shift || !isIn}
            >
              Ra ca
            </Button>
          )}
```
(Owner → `onCheckOut` mở modal đầy đủ cũ; manager → `onManagerCheckout` mở modal xác nhận.)

- [ ] **Step 3: `shifts-view.tsx`** — thêm state + modal + truyền prop:
  - import: `import { ManagerCheckoutModal } from "./manager-checkout-modal";`
  - state: `const [managerCheckoutTarget, setManagerCheckoutTarget] = useState<ShiftAssignment | null>(null);`
  - `<EmployeeGrid … onManagerCheckout={setManagerCheckoutTarget} />` (thêm prop).
  - cạnh `<CheckOutModal …/>` thêm:
```tsx
      <ManagerCheckoutModal
        open={managerCheckoutTarget !== null}
        onOpenChange={(next) => { if (!next) setManagerCheckoutTarget(null); }}
        shift={managerCheckoutTarget}
        businessDate={businessDate}
      />
```

- [ ] **Step 4:** `npx tsc --noEmit` → No errors.
- [ ] **Step 5: Commit**
```bash
git add src/features/shifts/manager-checkout-modal.tsx src/features/shifts/employee-grid.tsx src/features/shifts/shifts-view.tsx
git commit -m "feat(shifts): manager đóng ca hộ — nút Ra ca (owner+manager) + ManagerCheckoutModal"
```

---

## Task 10: `checkin-config-form.tsx` — ô "Giờ bắt đầu ca"

**Files:** Modify `src/features/settings/checkin-config-form.tsx`

- [ ] **Step 1: DEFAULT_CONFIG** (line 26-31) — thêm `shift_start_time: "05:30",`.
- [ ] **Step 2: configQuery mapping** (75-81) — thêm `shift_start_time: value?.shift_start_time ?? "05:30",`.
- [ ] **Step 3: state** (87-90) — thêm `const [shiftStart, setShiftStart] = useState("05:30");`.
- [ ] **Step 4: useEffect sync** (92-98) — thêm `setShiftStart(configQuery.data.shift_start_time ?? "05:30");`.
- [ ] **Step 5: dirty** (138-142) — thêm `|| shiftStart !== (loadedConfig.shift_start_time ?? "05:30")`.
- [ ] **Step 6: validate** — cạnh `validGrace` (130-131) thêm:
```ts
  const validStart = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(shiftStart);
```
- [ ] **Step 7: handleSaveConfig payload** (211-216) — thêm `shift_start_time: shiftStart,`. Và guard đầu hàm (208): đổi thành `if (!validGrace || !validStart || !dirty || updateConfig.isPending) return;`.
- [ ] **Step 8: UI** — thêm `TextField` sau ô grace_hours (sau 395), trong khối `<>…</>`:
```tsx
              <TextField
                label="Giờ bắt đầu ca (HH:MM)"
                value={shiftStart}
                onChange={(e) => setShiftStart(e.target.value)}
                error={validStart ? undefined : "Định dạng HH:MM (24 giờ), vd 05:30."}
                helper="Nhân viên không tự vào ca được trước giờ này."
              />
```
Và nút Lưu (397-402) `disabled` thêm `|| !validStart`.

- [ ] **Step 9:** `npx tsc --noEmit` → No errors.
- [ ] **Step 10: Commit**
```bash
git add src/features/settings/checkin-config-form.tsx
git commit -m "feat(settings): ô Giờ bắt đầu ca (shift_start_time) trong cấu hình chấm công"
```

---

## Task 11: Verify cuối + PR + CI + merge + tag

**Files:** none

- [ ] **Step 1:** `npx tsc --noEmit && npm run test:run` → tsc clean; Vitest pass.
- [ ] **Step 2:** `npm run build` (chỉ khi 3009 KHÔNG chạy) → thành công.
- [ ] **Step 3:** `node tools/pgtap-local.mjs --reset --all` → 0 failing (350 = 13/13).
- [ ] **Step 4: Push + PR**
```bash
git push -u origin feat/manager-checkout-shift-start
gh pr create --base main --head feat/manager-checkout-shift-start \
  --title 'feat(checkin): quản lý đóng ca hộ (làm tròn phút) + giờ bắt đầu ca' \
  --body '<tóm tắt: check_out_employee_now owner+manager làm tròn 15; check_in_self gate 05:30 cấu hình; Codex #1 final-close guard + #3 merge config; pgTAP 350 13/13; spec link>'
```
- [ ] **Step 5:** `gh pr checks <PR#> --watch` → build/pgtap/typecheck/vitest SUCCESS. (Nếu `gh pr checks` báo "no checks", query `gh api repos/KaMnh/chill-coffee-erp/actions/runs?head_sha=<sha>` — run kiểu pull_request không hiện ở `gh pr checks`.)
- [ ] **Step 6: (Khuyến nghị) Codex adversarial review impl** `--base origin/main` trước merge (payroll nhạy cảm).
- [ ] **Step 7: Merge + tag**
```bash
gh pr merge <PR#> --squash --delete-branch
git fetch origin main
git tag -a v4.12.0 origin/main -m "v4.12.0 — quản lý đóng ca hộ (làm tròn 15') + giờ bắt đầu ca"
git push origin v4.12.0
```

---

## Self-Review

**Spec coverage:**
- §1.1 `check_out_employee_now` (owner+manager, làm tròn, final-close, atomic) → Task 2 + test Group A. ✓
- §1.1b `check_out_employee` final-close guard (Codex #1) → Task 3 + test Group B. ✓
- §1.2 `check_in_self` gate 05:30 → Task 4 + test Group C. ✓
- §1.3 validate + merge (Codex #3) → Task 5 + test Group D. ✓
- §1.4 seed + §1.5 migration data-fix → Task 6. ✓
- §2 types + data → Task 8. §3 UI (tách nút, modal, ô giờ) → Task 9 + 10. ✓
- §5 test plan → Task 1 (13 assert). ✓
- §7.6 (#2 hoãn) → KHÔNG implement (đúng chủ ý). ✓

**Placeholder scan:** Task 9 Step 1 ghi rõ "kiểm tra signature Dialog/queryKeys theo repo" — KHÔNG phải placeholder mà là chỉ dẫn xác minh pattern (ManagerCheckoutModal là file mới, phải khớp UI kit hiện có). Task 3/4/5 không reproduce full body trong plan (chỉ dòng thêm + chỉ dẫn paste full vào migration) — chủ ý cho dual-write hàm lớn, tránh drift. Mọi object MỚI (RPC, modal, test) có full code.

**Type/identifier consistency:** `check_out_employee_now` / `checkOutEmployeeNow` / `ManagerCheckoutResult` / `shift_start_time` / `onManagerCheckout` / `managerCheckoutTarget` nhất quán giữa các task. Fixture UUID + message strings ('chốt két', 'chủ quán hoặc quản lý', 'không tồn tại hoặc đã đóng', 'Chưa tới giờ vào ca', 'HH:MM') khớp giữa test (Task 1) và implementation (Task 2-5).

**Risk bổ sung phát hiện khi viết plan:** Task 4 — `check_in_self` gate có thể làm **310/330 đỏ nếu CI chạy trước 05:30 VN** (chúng gọi check_in_self ở wall-clock thực). Plan đã thêm bước set `shift_start_time='00:00'` trong 310/330 (Task 4 Step 2) — bắt buộc làm để không phụ thuộc giờ chạy CI.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-28-manager-checkout-shift-start.md`.**
