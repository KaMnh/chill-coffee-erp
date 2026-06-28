# Ca đang mở: lộ diện NV bị ẩn + đóng ca cưỡng bức + dọn ca khi xoá tài khoản — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho owner/manager thấy & đóng (huỷ-không-lương hoặc trả-lương) mọi ca `checked_in` còn treo — kể cả của NV đã ngừng (`is_active=false`) — và tự dọn ca mở khi xoá tài khoản, để con số "Đang trong ca" + chi phí lương real-time không còn kẹt.

**Architecture:** Một internal helper SQL `_force_cancel_shift` làm 1 việc: set ca `cancelled` + `check_out_at=now()` + ghi 1 dòng audit mang lý do (KHÔNG sinh payroll/cash). Hai hàm bọc ngoài gọi helper: `cancel_shift_assignment` (authenticated, gate owner/manager, dùng cho UI) và `cancel_open_shifts_for_employee` (service-role-only, dùng cho route DELETE tài khoản). Data layer thêm `loadOpenShifts()` (đọc thẳng `shift_assignments where status='checked_in'`, MỌI ngày, left-join employees) + `loadEmployees(includeInactive)`. UI: component tái dùng `OpenShiftsTable` + `CloseShiftModal` xuất hiện trên trang Ca&lương (mọi ngày) và inline trong Chốt két (ngày hiện tại).

**Tech Stack:** Postgres (security-definer RPC, pgTAP) · Next.js App Router route handler · React 19 + TanStack Query · Vitest.

---

## Quyết định thiết kế đã chốt (đọc trước khi code)

1. **Gate quyền `cancel_shift_assignment` = `app_is_owner_manager()`** (owner+manager). Khớp nút UI và `check_out_employee_now`. (Lệch spec — spec ghi `app_is_staff_or_above` — đã xác nhận đổi.)
2. **Lý do huỷ lưu AUDIT-ONLY** (KHÔNG thêm cột `cancel_reason`). Helper INSERT 1 dòng `audit_log` action=`shift_assignments.cancel` mang `reason`. (Trigger `_audit_attendance_change` vẫn tự ghi thêm 1 dòng `shift_assignments.update` cho transition trạng thái — chấp nhận 2 dòng/lần huỷ.)
3. **Đường xoá tài khoản dùng RPC admin riêng** `cancel_open_shifts_for_employee(p_employee_id, p_reason, p_actor)` chỉ grant `service_role` (route DELETE chạy service-role client → `auth.uid()` null → KHÔNG qua được gate của `cancel_shift_assignment`). Pattern giống `check_in_self`/`repoint_account`.
4. **KHÔNG chặn final-close khi huỷ ca.** Huỷ ca không đụng tiền (no payroll/cash) nên không thể làm lệch báo cáo đã chốt; cho phép dọn ca treo của ngày đã final. (Khác `check_out_employee_now` vốn chặn final vì có ghi lương.)
5. **"Trả lương theo giờ" trong `CloseShiftModal`:** owner → có ô "Giờ ra" (mặc định now) + "Bồi dưỡng" → `check_out_employee`; manager → đóng tại now, làm tròn 15' → `check_out_employee_now`. (CloseShiftModal tự chứa hourly_rate qua RPC, không cần object `Employee` → đóng được ca của NV đã ngừng vốn không có trong grid.)
6. **Cờ "quá hạn" = đã làm > 12 giờ** (hằng số `OVERDUE_HOURS = 12`, tính client từ `check_in_at`→now).

### Bản đồ file
| File | Trách nhiệm | Tạo/Sửa |
|---|---|---|
| `database/002_functions.sql` | Canonical: thêm `_force_cancel_shift`, `cancel_shift_assignment`, `cancel_open_shifts_for_employee` (append cuối file) | Sửa |
| `database/migrations/2026-06-28-open-shift-force-close.sql` | Migration dual-write (3 hàm BYTE-IDENTICAL + grants) | Tạo |
| `database/tests/370_cancel_shift_assignment.sql` | pgTAP: huỷ ca, không sinh payroll/cash, gate, audit, idempotent, bulk-by-employee, active count giảm | Tạo |
| `src/lib/types.ts` | Type `OpenShift` | Sửa |
| `src/lib/data/shifts.ts` | `loadOpenShifts()`, `cancelShiftAssignment()` | Sửa |
| `src/lib/data/employees.ts` | `loadEmployees(includeInactive)` | Sửa |
| `src/lib/data/__tests__/shifts.test.ts` | Vitest data layer | Tạo |
| `src/lib/data/__tests__/employees.test.ts` | Vitest includeInactive | Tạo |
| `src/hooks/queries/keys.ts` | `employees(includeInactive)`, `openShifts()` | Sửa |
| `src/hooks/queries/use-shift-queries.ts` | `useOpenShiftsQuery`, `useEmployeesQuery(...,includeInactive)` | Sửa |
| `src/features/shifts/open-shifts-table.tsx` | Bảng "Ca đang mở" tái dùng | Tạo |
| `src/features/shifts/close-shift-modal.tsx` | Modal đóng ca (huỷ vs trả lương) | Tạo |
| `src/features/shifts/bulk-cancel-shifts-modal.tsx` | "Đóng hết (huỷ, không lương)" | Tạo |
| `src/features/shifts/open-shifts-close-banner.tsx` | Nội dung banner Chốt két (Xem & đóng + Đóng hết) — tách để test | Tạo |
| `src/features/shifts/__tests__/shifts-view.test.tsx` | Vitest toggle NV đã ngừng + bảng ca mở | Tạo |
| `src/features/shifts/__tests__/open-shifts-table.test.tsx` | Vitest component | Tạo |
| `src/features/shifts/__tests__/close-shift-modal.test.tsx` | Vitest component | Tạo |
| `src/features/shifts/shifts-view.tsx` | Toggle "Hiện cả NV đã ngừng" + mount bảng + modal | Sửa |
| `src/features/shifts/employee-grid.tsx` | Badge "Đã ngừng" khi `!is_active` | Sửa |
| `src/features/cash/cash-view.tsx` | "Xem & đóng" (inline bảng) + "Đóng hết" | Sửa |
| `src/features/cash/__tests__/cash-view-open-shifts.test.tsx` | Vitest banner buttons | Tạo (hoặc nối file test cash-view sẵn có) |
| `src/app/api/users/[id]/route.ts` | DELETE: gọi `cancel_open_shifts_for_employee` TRƯỚC khi `is_active=false` | Sửa |
| `src/app/api/users/[id]/__tests__/route-delete.test.ts` | Vitest route thứ tự gọi | Tạo |

---

## Task 1: SQL — helper + 2 RPC huỷ ca (pgTAP TDD)

**Files:**
- Modify: `database/002_functions.sql` (append cuối file)
- Create: `database/migrations/2026-06-28-open-shift-force-close.sql`
- Test: `database/tests/370_cancel_shift_assignment.sql`

Bối cảnh runner: pgTAP chạy trên DB throwaway (`auth-mock` + `001` + `002` + `003` + tất cả migrations; KHÔNG có `004` seed) qua `npm run pgtap` → `scripts/pgtap-run.mjs`. Vì `002` đã chứa định nghĩa canonical và migration `create or replace`, áp cả hai là idempotent.

- [ ] **Step 1: Viết pgTAP test (fail trước)**

Tạo `database/tests/370_cancel_shift_assignment.sql`:

```sql
-- 370 — cancel_shift_assignment (huỷ ca không lương) + cancel_open_shifts_for_employee
-- (dọn ca khi xoá TK). Throwaway DB (auth-mock + 001 + 002 + 003 + migrations).
begin;
select plan(18);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('a0000000-0000-0000-0000-000000000001','owner@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000002','mgr@t.local','',now(),'00000000-0000-0000-0000-000000000000'),
  ('a0000000-0000-0000-0000-000000000003','op@t.local','',now(),'00000000-0000-0000-0000-000000000000');
insert into public.employees (id, name, hourly_rate, is_active) values
  ('e0000000-0000-0000-0000-000000000001','NV Treo',30000,true),
  ('e0000000-0000-0000-0000-000000000002','NV Đã ngừng',30000,false),
  ('e0000000-0000-0000-0000-000000000003','NV Gate',30000,true);
insert into public.employee_accounts (auth_user_id, employee_id, role, status) values
  ('a0000000-0000-0000-0000-000000000001', null, 'owner','active'),
  ('a0000000-0000-0000-0000-000000000002', null, 'manager','active'),
  ('a0000000-0000-0000-0000-000000000003', null, 'staff_operator','active');

-- Ca đang mở: 1 hôm nay (NV Treo), 2 của NV Đã ngừng (test bulk), 1 cho gate test
insert into public.shift_assignments (id, employee_id, business_date, check_in_at, status, created_by, updated_by) values
  ('5a000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001', current_date, now() - interval '90 minutes','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000021','e0000000-0000-0000-0000-000000000002', current_date - 2, (current_date - 2) + time '08:00','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000022','e0000000-0000-0000-0000-000000000002', current_date - 1, (current_date - 1) + time '08:00','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001'),
  ('5a000000-0000-0000-0000-000000000031','e0000000-0000-0000-0000-000000000003', current_date, now() - interval '30 minutes','checked_in','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001');

-- ===== Group A — cancel_shift_assignment: huỷ ca, KHÔNG lương/cash, audit =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002'); -- manager
select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000001'::uuid, 'NV bỏ về không ra ca');
select is((select status from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  'cancelled', 'A1 ca → cancelled');
select isnt((select check_out_at from public.shift_assignments where id='5a000000-0000-0000-0000-000000000001'),
  null, 'A2 check_out_at được set');
select is((select count(*)::int from public.shift_payroll_records where shift_assignment_id='5a000000-0000-0000-0000-000000000001'),
  0, 'A3 KHÔNG sinh payroll');
select is((select count(*)::int from public.cash_drawer_events ce
  join public.shift_assignments sa on sa.id='5a000000-0000-0000-0000-000000000001'
  where ce.business_date = sa.business_date and ce.event_type='payroll_cash_out' and ce.amount > 0
    and ce.note ilike '%lương%' and ce.occurred_at >= now() - interval '1 minute'),
  0, 'A4 KHÔNG sinh cash_drawer payroll');
select is((select count(*)::int from public.audit_log where entity_id='5a000000-0000-0000-0000-000000000001'
  and action='shift_assignments.cancel' and diff_json->>'reason'='NV bỏ về không ra ca'),
  1, 'A5 audit reason ghi đúng 1 dòng');

-- idempotent: huỷ lại ca đã đóng → raise
select throws_like(
  $$ select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000001'::uuid, 'x') $$,
  '%không tồn tại hoặc đã đóng%', 'A6 huỷ lại ca đã đóng → raise');

-- lý do rỗng → raise
select throws_like(
  $$ select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000031'::uuid, '   ') $$,
  '%lý do%', 'A7 lý do rỗng → raise');

-- ===== Group B — gate quyền =====
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003'); -- staff_operator
select throws_like(
  $$ select public.cancel_shift_assignment('5a000000-0000-0000-0000-000000000031'::uuid, 'x') $$,
  '%chủ quán hoặc quản lý%', 'B1 staff_operator KHÔNG huỷ được ca');
select is((select status from public.shift_assignments where id='5a000000-0000-0000-0000-000000000031'),
  'checked_in', 'B2 ca vẫn checked_in sau khi staff bị chặn');

-- ===== Group C — cancel_open_shifts_for_employee (service-role, bulk by employee) =====
-- session role pgTAP = superuser (BYPASSRLS) → gọi trực tiếp được hàm service-role-only.
reset role;
select set_config('request.jwt.claims', null, true);
create temp table _bulk as select public.cancel_open_shifts_for_employee(
  'e0000000-0000-0000-0000-000000000002'::uuid, 'Huỷ do xoá tài khoản',
  'a0000000-0000-0000-0000-000000000001'::uuid) as r;
select is(((select r from _bulk)->>'cancelled_count')::int, 2, 'C1 huỷ 2 ca treo của NV đã ngừng');
select is((select count(*)::int from public.shift_assignments
  where employee_id='e0000000-0000-0000-0000-000000000002' and status='cancelled'),
  2, 'C2 cả 2 ca → cancelled');
select is((select count(*)::int from public.shift_assignments
  where employee_id='e0000000-0000-0000-0000-000000000002' and status='checked_in'),
  0, 'C3 không còn ca checked_in');
select is((select count(*)::int from public.shift_payroll_records
  where employee_id='e0000000-0000-0000-0000-000000000002'),
  0, 'C4 bulk KHÔNG sinh payroll');
select is((select count(*)::int from public.audit_log
  where entity_type='shift_assignments' and action='shift_assignments.cancel'
    and actor_user_id='a0000000-0000-0000-0000-000000000001'
    and diff_json->>'reason'='Huỷ do xoá tài khoản'),
  2, 'C5 audit actor + reason cho cả 2 ca');

-- ===== Group D — dashboard_daily_ops active count + active_shifts giảm sau khi huỷ =====
-- NV Treo (đã huỷ ở A) thuộc current_date; trước huỷ active=2 (NV Treo + NV Gate), sau huỷ còn 1.
select is((select (public.dashboard_daily_ops(current_date)->>'active_staff')::int),
  1, 'D1 active_staff hôm nay = 1 (chỉ còn NV Gate)');
-- active_shifts là input của chi phí lương real-time (002:356) → ca đã huỷ phải biến mất.
select is((select jsonb_array_length(public.dashboard_daily_ops(current_date)->'active_shifts')),
  1, 'D1b active_shifts còn 1 (ca huỷ rời khỏi chi phí lương tạm tính)');

-- bulk-by-employee: NV không có ca mở → count 0 (idempotent)
create temp table _bulk2 as select public.cancel_open_shifts_for_employee(
  'e0000000-0000-0000-0000-000000000002'::uuid, 'x', 'a0000000-0000-0000-0000-000000000001'::uuid) as r;
select is(((select r from _bulk2)->>'cancelled_count')::int, 0, 'D2 bulk lần 2 → 0 (no-op)');

select * from finish();
rollback;
```

- [ ] **Step 2: Chạy test → phải FAIL (hàm chưa tồn tại)**

Run: `npm run pgtap`
Expected: file `370_cancel_shift_assignment.sql` FAIL với lỗi đại loại `function public.cancel_shift_assignment(uuid, text) does not exist` (các file khác vẫn pass).

- [ ] **Step 3: Thêm 3 hàm vào canonical `database/002_functions.sql`**

Append vào CUỐI file `database/002_functions.sql` (sau block REPOINT-ACCOUNT):

```sql
-- ============================================================== CANCEL-SHIFT-BEGIN
-- Đóng ca cưỡng bức (2026-06-28): huỷ ca treo KHÔNG tính lương. Spec:
-- 2026-06-24-open-shift-visibility-force-close-design.md
-- _force_cancel_shift: helper nội bộ (1 trách nhiệm) — set cancelled +
--   check_out_at=now() + ghi 1 dòng audit mang lý do. KHÔNG payroll/cash.
-- cancel_shift_assignment: bọc authenticated, gate owner/manager (UI).
-- cancel_open_shifts_for_employee: bọc service-role-only (route xoá TK).
create or replace function public._force_cancel_shift(
  p_shift_id uuid, p_reason text, p_actor uuid
) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare
  v_employee uuid; v_name text; v_role text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Phải nhập lý do huỷ ca.';
  end if;
  if length(p_reason) > 500 then
    raise exception 'Lý do huỷ ca vượt 500 ký tự.';
  end if;

  update public.shift_assignments
     set status = 'cancelled', check_out_at = now(), updated_by = p_actor
   where id = p_shift_id and status = 'checked_in'
   returning employee_id into v_employee;
  if not found then
    raise exception 'Ca không tồn tại hoặc đã đóng.';
  end if;

  select name into v_name from public.employees where id = v_employee;

  v_role := coalesce(
    (select role from public.employee_accounts where auth_user_id = p_actor and status = 'active' limit 1),
    public.app_role());
  insert into public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, diff_json)
  values (p_actor, v_role, 'shift_assignments.cancel', 'shift_assignments', p_shift_id,
          jsonb_build_object('reason', p_reason, 'status', 'cancelled'));

  return jsonb_build_object('shift_assignment_id', p_shift_id, 'employee_name', v_name, 'status', 'cancelled');
end; $$;
revoke execute on function public._force_cancel_shift(uuid, text, uuid) from public, anon, authenticated;

create or replace function public.cancel_shift_assignment(p_shift_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.app_is_owner_manager() then
    raise exception 'Chỉ chủ quán hoặc quản lý được huỷ ca.';
  end if;
  return public._force_cancel_shift(p_shift_id, p_reason, auth.uid());
end; $$;
-- Thu hồi PUBLIC mặc định rồi cấp lại authenticated → bề mặt gọi đúng (Codex):
revoke execute on function public.cancel_shift_assignment(uuid, text) from public, anon;
grant execute on function public.cancel_shift_assignment(uuid, text) to authenticated;

create or replace function public.cancel_open_shifts_for_employee(
  p_employee_id uuid, p_reason text, p_actor uuid
) returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  v_id uuid; v_count integer := 0; v_ids jsonb := '[]'::jsonb;
begin
  for v_id in
    select id from public.shift_assignments
     where employee_id = p_employee_id and status = 'checked_in'
     order by check_in_at
  loop
    perform public._force_cancel_shift(v_id, p_reason, p_actor);
    v_count := v_count + 1;
    v_ids := v_ids || to_jsonb(v_id);
  end loop;
  return jsonb_build_object('cancelled_count', v_count, 'shift_ids', v_ids);
end; $$;
revoke execute on function public.cancel_open_shifts_for_employee(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.cancel_open_shifts_for_employee(uuid, text, uuid) to service_role;
-- ============================================================== CANCEL-SHIFT-END
```

- [ ] **Step 4: Apply `002` vào DB throwaway? KHÔNG — tạo migration để runner áp**

Tạo `database/migrations/2026-06-28-open-shift-force-close.sql` với 3 hàm BYTE-IDENTICAL (copy nguyên block giữa `CANCEL-SHIFT-BEGIN`/`END` ở Step 3) + header:

```sql
-- 2026-06-28 — Đóng ca cưỡng bức (huỷ ca treo không lương) + dọn ca khi xoá TK
-- =============================================================================
-- Áp cho DB đã chạy bản trước (idempotent: create or replace + revoke/grant).
-- Mỗi function body Ở ĐÂY phải BYTE-IDENTICAL với canonical trong
-- database/002_functions.sql (block CANCEL-SHIFT-BEGIN..END). Migration tự đứng độc lập.
--
-- Nội dung:
--   1) _force_cancel_shift            — helper: set cancelled + check_out_at + audit reason.
--   2) cancel_shift_assignment        — authenticated, gate owner/manager (UI).
--   3) cancel_open_shifts_for_employee — service-role-only (route DELETE tài khoản).

<DÁN NGUYÊN 3 hàm + revoke/grant từ Step 3, KHÔNG kèm dòng comment ===CANCEL-SHIFT-BEGIN/END===>
```

- [ ] **Step 5: Chạy lại pgTAP → PASS**

Run: `npm run pgtap`
Expected: `370_cancel_shift_assignment.sql` ... ok (16/16); toàn suite không thêm fail mới.

- [ ] **Step 6: Commit**

```bash
git add database/002_functions.sql database/migrations/2026-06-28-open-shift-force-close.sql database/tests/370_cancel_shift_assignment.sql
git commit -m "feat(shifts): RPC huỷ ca cưỡng bức + dọn ca theo NV (pgTAP)"
```

---

## Task 2: Data layer — `loadOpenShifts`, `cancelShiftAssignment`, `loadEmployees(includeInactive)`

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/data/shifts.ts`
- Modify: `src/lib/data/employees.ts`
- Test: `src/lib/data/__tests__/shifts.test.ts` (create), `src/lib/data/__tests__/employees.test.ts` (create)

- [ ] **Step 1: Thêm type `OpenShift` vào `src/lib/types.ts`** (ngay sau `ShiftAssignment`, kết thúc dòng 111)

```ts
export type OpenShift = {
  id: string;
  employee_id: string;
  business_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  total_minutes: number | null;
  status: string;
  /** Tên NV; null nếu join hụt. Dùng nhãn "NV đã ngừng" khi employee_is_active=false. */
  employee_name: string | null;
  position: string | null;
  /** false = NV đã ngừng (is_active=false) → vẫn hiện trong bảng ca đang mở. */
  employee_is_active: boolean | null;
};
```

- [ ] **Step 2: Viết Vitest `src/lib/data/__tests__/shifts.test.ts` (fail trước)**

```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOpenShifts, cancelShiftAssignment } from "../shifts";

function mockFrom(rows: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return { from: vi.fn(() => builder), _builder: builder } as unknown as SupabaseClient & {
    _builder: typeof builder;
  };
}

describe("loadOpenShifts", () => {
  it("lọc status=checked_in, KHÔNG lọc business_date, map employee_name", async () => {
    const sb = mockFrom([
      { id: "s1", employee_id: "e1", business_date: "2026-06-10", check_in_at: "x",
        check_out_at: null, total_minutes: null, status: "checked_in",
        employees: { name: "An", position: "Pha chế", is_active: false } },
    ]);
    const out = await loadOpenShifts(sb);
    expect(sb.from).toHaveBeenCalledWith("shift_assignments");
    expect((sb as never as { _builder: { eq: ReturnType<typeof vi.fn> } })._builder.eq)
      .toHaveBeenCalledWith("status", "checked_in");
    expect(out[0].employee_name).toBe("An");
    expect(out[0].employee_is_active).toBe(false);
  });

  it("join hụt → employee_name null", async () => {
    const sb = mockFrom([
      { id: "s2", employee_id: "e2", business_date: "2026-06-10", check_in_at: "x",
        check_out_at: null, total_minutes: null, status: "checked_in", employees: null },
    ]);
    const out = await loadOpenShifts(sb);
    expect(out[0].employee_name).toBeNull();
  });
});

describe("cancelShiftAssignment", () => {
  it("gọi RPC cancel_shift_assignment với p_shift_id + p_reason", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "cancelled" }, error: null });
    const sb = { rpc } as unknown as SupabaseClient;
    await cancelShiftAssignment(sb, "s1", "lý do");
    expect(rpc).toHaveBeenCalledWith("cancel_shift_assignment", { p_shift_id: "s1", p_reason: "lý do" });
  });

  it("RPC lỗi → throw", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } });
    const sb = { rpc } as unknown as SupabaseClient;
    await expect(cancelShiftAssignment(sb, "s1", "x")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Chạy → FAIL**

Run: `npx vitest run src/lib/data/__tests__/shifts.test.ts`
Expected: FAIL (`loadOpenShifts`/`cancelShiftAssignment` is not a function).

- [ ] **Step 4: Implement trong `src/lib/data/shifts.ts`** (thêm sau `loadShiftAssignments`, dùng `OpenShift` import)

Sửa dòng import type 2:
```ts
import type { ManagerCheckoutResult, OpenShift, PayrollRecord, ShiftAssignment } from "@/lib/types";
```

Thêm hàm:
```ts
export async function loadOpenShifts(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("shift_assignments")
    .select(
      "id, employee_id, business_date, check_in_at, check_out_at, total_minutes, status, employees(name, position, is_active)"
    )
    .eq("status", "checked_in")
    .order("check_in_at", { ascending: true, nullsFirst: false });
  if (error) throw toAppError(error, "Không tải được ca đang mở.");

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const employee = row.employees as
      | { name?: string; position?: string | null; is_active?: boolean }
      | null
      | undefined;
    return {
      ...row,
      employee_name: employee?.name ?? null,
      position: employee?.position ?? null,
      employee_is_active: employee?.is_active ?? null,
    } as OpenShift;
  });
}

export async function cancelShiftAssignment(
  supabase: SupabaseClient,
  shiftId: string,
  reason: string
) {
  const { data, error } = await supabase.rpc("cancel_shift_assignment", {
    p_shift_id: shiftId,
    p_reason: reason,
  });
  if (error) throw toAppError(error, "Không huỷ được ca.");
  return data as { shift_assignment_id: string; employee_name: string | null; status: string };
}
```

- [ ] **Step 5: Viết Vitest `src/lib/data/__tests__/employees.test.ts`**

```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEmployees } from "../employees";

function makeSb() {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return { sb: { from: vi.fn(() => builder) } as unknown as SupabaseClient, builder };
}

describe("loadEmployees", () => {
  it("mặc định lọc is_active=true", async () => {
    const { sb, builder } = makeSb();
    await loadEmployees(sb);
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });
  it("includeInactive=true → KHÔNG gọi .eq(is_active)", async () => {
    const { sb, builder } = makeSb();
    await loadEmployees(sb, true);
    expect(builder.eq).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Chạy → FAIL** (`loadEmployees` chưa nhận tham số 2)

Run: `npx vitest run src/lib/data/__tests__/employees.test.ts`
Expected: FAIL (test "includeInactive" — `.eq` vẫn được gọi).

- [ ] **Step 7: Sửa `src/lib/data/employees.ts` `loadEmployees`**

```ts
export async function loadEmployees(supabase: SupabaseClient, includeInactive = false) {
  let query = supabase
    .from("employees")
    .select("id, code, name, position, hourly_rate, is_active");
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.order("name", { ascending: true });
  if (error) throw toAppError(error, "Không tải được danh sách nhân viên.");
  return (data ?? []) as Employee[];
}
```

- [ ] **Step 8: Chạy 2 file test → PASS**

Run: `npx vitest run src/lib/data/__tests__/shifts.test.ts src/lib/data/__tests__/employees.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/types.ts src/lib/data/shifts.ts src/lib/data/employees.ts src/lib/data/__tests__/shifts.test.ts src/lib/data/__tests__/employees.test.ts
git commit -m "feat(data): loadOpenShifts + cancelShiftAssignment + loadEmployees(includeInactive)"
```

---

## Task 3: Query hooks + keys

**Files:**
- Modify: `src/hooks/queries/keys.ts`
- Modify: `src/hooks/queries/use-shift-queries.ts`
- Modify: `src/hooks/queries/index.ts` (export `useOpenShiftsQuery`)

- [ ] **Step 1: `keys.ts` — đổi `employees` + thêm `openShifts`**

Đổi dòng `employees: () => ["employees"] as const,` thành:
```ts
  employees: (includeInactive = false) => ["employees", includeInactive] as const,
  openShifts: () => ["open-shifts"] as const,
```

- [ ] **Step 2: Audit invalidation `employees` (tránh sót variant)**

Run: `git grep -n "queryKeys.employees(" src/`
Với MỖI nơi `invalidateQueries({ queryKey: queryKeys.employees() })`, đổi thành prefix để khớp cả 2 variant:
```ts
queryClient.invalidateQueries({ queryKey: ["employees"] });
```
(Giữ nguyên các nơi chỉ dùng `queryKeys.employees()` làm `queryKey` cho `useQuery`.)

- [ ] **Step 3: `use-shift-queries.ts` — thêm `includeInactive` + `useOpenShiftsQuery`**

Sửa import dòng 5:
```ts
import { loadEmployees, loadOpenShifts, loadPayrollRecords, loadShiftAssignments } from "@/lib/data";
```
Đổi `useEmployeesQuery`:
```ts
export function useEmployeesQuery(
  supabase: SupabaseClient | null,
  enabled = true,
  includeInactive = false
) {
  return useQuery({
    queryKey: queryKeys.employees(includeInactive),
    queryFn: () => loadEmployees(supabase!, includeInactive),
    enabled: enabled && !!supabase,
    staleTime: 2 * 60_000,
  });
}
```
Thêm cuối file:
```ts
export function useOpenShiftsQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.openShifts(),
    queryFn: () => loadOpenShifts(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 4: `index.ts` — export**

Đổi dòng export `use-shift-queries`:
```ts
export { useEmployeesQuery, useShiftsQuery, usePayrollQuery, useOpenShiftsQuery } from "./use-shift-queries";
```

- [ ] **Step 5: Typecheck + build-less verify**

Run: `npx tsc --noEmit`
Expected: không lỗi mới. (Nếu báo lỗi ở callsite `useEmployeesQuery(supabase, true)` → vẫn hợp lệ vì `includeInactive` mặc định.)

- [ ] **Step 6: Commit**

```bash
git add src/hooks/queries/keys.ts src/hooks/queries/use-shift-queries.ts src/hooks/queries/index.ts
git commit -m "feat(hooks): useOpenShiftsQuery + employees includeInactive key"
```

---

## Task 4: Component `OpenShiftsTable`

**Files:**
- Create: `src/features/shifts/open-shifts-table.tsx`
- Test: `src/features/shifts/__tests__/open-shifts-table.test.tsx`

Bảng nhận shape tối thiểu (cả `OpenShift` lẫn `ShiftAssignment` của cash-view đều thoả). `employee_is_active` optional → khi `=== false` hiện thêm chip "Đã ngừng".

- [ ] **Step 1: Viết test (fail trước)**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpenShiftsTable, type OpenShiftRow } from "../open-shifts-table";

const base: OpenShiftRow = {
  id: "s1", business_date: "2026-06-10", check_in_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  employee_name: "An", employee_is_active: true,
};

describe("OpenShiftsTable", () => {
  it("hiện tên NV + nút Đóng ca, gọi onClose", () => {
    const onClose = vi.fn();
    render(<OpenShiftsTable shifts={[base]} onClose={onClose} />);
    expect(screen.getByText("An")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Đóng ca/i }));
    expect(onClose).toHaveBeenCalledWith(base);
  });

  it("employee_name null → nhãn 'NV đã ngừng'", () => {
    render(<OpenShiftsTable shifts={[{ ...base, employee_name: null }]} onClose={vi.fn()} />);
    expect(screen.getByText(/NV đã ngừng/i)).toBeInTheDocument();
  });

  it("employee_is_active=false → chip 'Đã ngừng'", () => {
    render(<OpenShiftsTable shifts={[{ ...base, employee_is_active: false }]} onClose={vi.fn()} />);
    expect(screen.getByText(/Đã ngừng/i)).toBeInTheDocument();
  });

  it("đã làm > 12 giờ → cờ 'Quá hạn'", () => {
    const old = { ...base, check_in_at: new Date(Date.now() - 13 * 60 * 60_000).toISOString() };
    render(<OpenShiftsTable shifts={[old]} onClose={vi.fn()} />);
    expect(screen.getByText(/Quá hạn/i)).toBeInTheDocument();
  });

  it("rỗng → empty state", () => {
    render(<OpenShiftsTable shifts={[]} onClose={vi.fn()} />);
    expect(screen.getByText(/Không có ca đang mở/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Chạy → FAIL**

Run: `npx vitest run src/features/shifts/__tests__/open-shifts-table.test.tsx`
Expected: FAIL (module chưa tồn tại).

- [ ] **Step 3: Implement `src/features/shifts/open-shifts-table.tsx`**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { durationLabel } from "@/lib/format";

/** Ngưỡng cảnh báo ca treo quá lâu (giờ). */
export const OVERDUE_HOURS = 12;

/** Shape tối thiểu để render — OpenShift (mọi ngày) lẫn ShiftAssignment (cash-view) đều thoả. */
export interface OpenShiftRow {
  id: string;
  business_date: string;
  check_in_at: string | null;
  employee_name: string | null;
  employee_is_active?: boolean | null;
}

function elapsedMinutes(checkIn: string | null): number | null {
  if (!checkIn) return null;
  const ms = Date.now() - new Date(checkIn).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

interface OpenShiftsTableProps {
  shifts: ReadonlyArray<OpenShiftRow>;
  onClose(shift: OpenShiftRow): void;
}

export function OpenShiftsTable({ shifts, onClose }: OpenShiftsTableProps) {
  if (shifts.length === 0) {
    return (
      <EmptyState
        icon="checkCircle"
        title="Không có ca đang mở"
        subtitle="Mọi ca đã ra/đóng."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {shifts.map((s) => {
        const mins = elapsedMinutes(s.check_in_at);
        const overdue = mins !== null && mins > OVERDUE_HOURS * 60;
        return (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
          >
            <div className="min-w-0">
              <strong className="block truncate text-sm font-semibold text-ink">
                {s.employee_name ?? "NV đã ngừng"}
              </strong>
              <span className="text-xs text-muted">
                Ngày {s.business_date}
                {s.check_in_at ? ` · Vào ${new Date(s.check_in_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                {mins !== null ? ` · Đã làm ${durationLabel(mins)}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {s.employee_is_active === false && (
                <Badge variant="soft" semantic="neutral">Đã ngừng</Badge>
              )}
              {overdue && <Badge variant="soft" semantic="warning">Quá hạn</Badge>}
              <Button type="button" variant="ghost" size="sm" onClick={() => onClose(s)}>
                Đóng ca
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 4: Chạy → PASS**

Run: `npx vitest run src/features/shifts/__tests__/open-shifts-table.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/open-shifts-table.tsx src/features/shifts/__tests__/open-shifts-table.test.tsx
git commit -m "feat(shifts): OpenShiftsTable component"
```

---

## Task 5: Component `CloseShiftModal` (huỷ vs trả lương)

**Files:**
- Create: `src/features/shifts/close-shift-modal.tsx`
- Test: `src/features/shifts/__tests__/close-shift-modal.test.tsx`

Props: `{ open, onOpenChange, shift, role, onClosed? }`. `shift` là `OpenShiftRow & { employee_id?, business_date, check_in_at }` (đủ field gọi RPC). Hai mode: `cancel` (textarea lý do bắt buộc → `cancelShiftAssignment`) và `pay`. Mode `pay`: owner → ô datetime "Giờ ra" mặc định now + ô "Bồi dưỡng" → `checkOutEmployee`; manager → `checkOutEmployeeNow` (làm tròn 15'). Invalidate theo `shift.business_date` + `openShifts`.

- [ ] **Step 1: Viết test (fail trước)**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CloseShiftModal } from "../close-shift-modal";

const cancelMock = vi.fn();
const checkoutNowMock = vi.fn();
const checkoutMock = vi.fn();
vi.mock("@/lib/data/shifts", () => ({
  cancelShiftAssignment: (...a: unknown[]) => cancelMock(...a),
  checkOutEmployeeNow: (...a: unknown[]) => checkoutNowMock(...a),
  checkOutEmployee: (...a: unknown[]) => checkoutMock(...a),
}));
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const shift = {
  id: "s1", employee_id: "e1", business_date: "2026-06-28",
  check_in_at: "2026-06-28T01:00:00Z", employee_name: "An", employee_is_active: true,
};

beforeEach(() => { cancelMock.mockReset().mockResolvedValue({ status: "cancelled" });
  checkoutNowMock.mockReset().mockResolvedValue({ employee_name: "An", total_minutes: 60, total_pay: 30000 });
  checkoutMock.mockReset().mockResolvedValue({ total_pay: 30000 }); });

describe("CloseShiftModal", () => {
  it("mode huỷ: bắt buộc lý do mới gọi cancel", async () => {
    wrap(<CloseShiftModal open shift={shift} role="manager" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Huỷ ca/i));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    expect(cancelMock).not.toHaveBeenCalled(); // lý do trống
    fireEvent.change(screen.getByLabelText(/Lý do/i), { target: { value: "NV bỏ về" } });
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith(expect.anything(), "s1", "NV bỏ về"));
  });

  it("mode trả lương + manager → checkOutEmployeeNow", async () => {
    wrap(<CloseShiftModal open shift={shift} role="manager" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Trả lương/i));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    await waitFor(() => expect(checkoutNowMock).toHaveBeenCalledWith(expect.anything(), "s1"));
  });

  it("mode trả lương + owner → checkOutEmployee (có giờ ra)", async () => {
    wrap(<CloseShiftModal open shift={shift} role="owner" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/Trả lương/i));
    fireEvent.click(screen.getByRole("button", { name: /Xác nhận/i }));
    await waitFor(() => expect(checkoutMock).toHaveBeenCalled());
    expect(checkoutMock.mock.calls[0][1]).toMatchObject({ shift_assignment_id: "s1", employee_id: "e1" });
  });
});
```

- [ ] **Step 2: Chạy → FAIL**

Run: `npx vitest run src/features/shifts/__tests__/close-shift-modal.test.tsx`
Expected: FAIL (module chưa có).

- [ ] **Step 3: Implement `src/features/shifts/close-shift-modal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import {
  cancelShiftAssignment, checkOutEmployee, checkOutEmployeeNow,
} from "@/lib/data/shifts";
import { moneyFromInput, durationLabel, formatVND } from "@/lib/format";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import type { UserRole } from "@/lib/types";

export interface CloseShiftTarget {
  id: string;
  employee_id?: string;
  business_date: string;
  check_in_at: string | null;
  employee_name: string | null;
  employee_is_active?: boolean | null;
}

interface CloseShiftModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shift: CloseShiftTarget | null;
  role: UserRole;
  onClosed?(): void;
}

export function CloseShiftModal({ open, onOpenChange, shift, role, onClosed }: CloseShiftModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isOwner = role === "owner";
  const [mode, setMode] = useState<"cancel" | "pay">("cancel");
  const [reason, setReason] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowance, setAllowance] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Reset khi mở modal cho ca mới.
  useEffect(() => {
    if (open) {
      setMode("cancel");
      setReason("");
      setAllowance("");
      setEndTime(toDatetimeLocal(new Date().toISOString()));
    }
  }, [open, shift?.id]);

  if (!shift) return <Modal open={open} onOpenChange={onOpenChange} />;

  function invalidate() {
    if (!shift) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.openShifts() });
    queryClient.invalidateQueries({ queryKey: queryKeys.shifts(shift.business_date) });
    queryClient.invalidateQueries({ queryKey: queryKeys.payroll(shift.business_date) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(shift.business_date) });
  }

  async function handleConfirm() {
    if (!shift || !supabase || isBusy) return;
    if (mode === "cancel" && reason.trim() === "") {
      toast({ semantic: "danger", message: "Phải nhập lý do huỷ ca." });
      return;
    }
    setIsBusy(true);
    try {
      if (mode === "cancel") {
        await cancelShiftAssignment(supabase, shift.id, reason.trim());
        toast({ semantic: "success", message: `Đã huỷ ca ${shift.employee_name ?? "NV đã ngừng"} (không tính lương).` });
      } else if (isOwner) {
        await checkOutEmployee(supabase, {
          shift_assignment_id: shift.id,
          employee_id: shift.employee_id,
          business_date: shift.business_date,
          check_in_at: shift.check_in_at,
          // VN-local convention: KHÔNG tự convert UTC (giống check-out-modal.tsx:116).
          check_out_at: fromDatetimeLocal(endTime) ?? new Date().toISOString(),
          allowance_amount: moneyFromInput(allowance),
          note: "Đóng ca từ bảng Ca đang mở",
        });
        toast({ semantic: "success", message: `Đã trả lương & đóng ca ${shift.employee_name ?? ""}.` });
      } else {
        const r = await checkOutEmployeeNow(supabase, shift.id);
        toast({ semantic: "success", message: `Đã đóng ca ${r.employee_name}: ${durationLabel(r.total_minutes)} · ${formatVND(r.total_pay)}.` });
      }
      invalidate();
      onClosed?.();
      onOpenChange(false);
    } catch (err) {
      toast({ semantic: "danger", message: err instanceof Error ? err.message : "Không đóng ca được." });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Đóng ca · {shift.employee_name ?? "NV đã ngừng"}</ModalTitle>
        <ModalDescription>Chọn cách đóng ca treo này.</ModalDescription>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="close-mode" checked={mode === "cancel"}
              onChange={() => setMode("cancel")} aria-label="Huỷ ca (không tính lương)" />
            <span><strong>Huỷ ca (không tính lương)</strong> — ca đóng, KHÔNG ghi lương.</span>
          </label>
          {mode === "cancel" && (
            <Textarea label="Lý do huỷ" value={reason}
              onChange={(e) => setReason(e.target.value)} rows={2} disabled={isBusy} />
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="close-mode" checked={mode === "pay"}
              onChange={() => setMode("pay")} aria-label="Trả lương theo giờ" />
            <span><strong>Trả lương theo giờ</strong> — {isOwner ? "chọn giờ ra (mặc định bây giờ)." : "đóng ở giờ hiện tại, làm tròn 15'."}</span>
          </label>
          {mode === "pay" && isOwner && (
            <div className="space-y-2">
              <TextField type="datetime-local" label="Giờ ra" value={endTime}
                onChange={(e) => setEndTime(e.target.value)} disabled={isBusy} />
              <TextField label="Bồi dưỡng (tuỳ chọn)" value={allowance} inputMode="numeric"
                onChange={(e) => setAllowance(e.target.value)} disabled={isBusy} />
            </div>
          )}
        </div>
        <ModalActions>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>Đóng</Button>
          <Button type="button" variant="primary" loading={isBusy} onClick={handleConfirm}>Xác nhận</Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
```

> Lưu ý impl: `moneyFromInput` ở `src/lib/format.ts:71`; `durationLabel`/`formatVND` cùng module. `fromDatetimeLocal`/`toDatetimeLocal` ở `src/lib/datetime.ts` (KHÔNG tự convert UTC — convention VN-local). `TextField`/`Textarea`/`Modal` API: đối chiếu `manager-checkout-modal.tsx` + `check-out-modal.tsx` đã dùng.

- [ ] **Step 4: Chạy → PASS**

Run: `npx vitest run src/features/shifts/__tests__/close-shift-modal.test.tsx`
Expected: PASS (3/3). Nếu props UI khác (label/aria), chỉnh cho khớp component thật rồi chạy lại.

- [ ] **Step 5: Commit**

```bash
git add src/features/shifts/close-shift-modal.tsx src/features/shifts/__tests__/close-shift-modal.test.tsx
git commit -m "feat(shifts): CloseShiftModal (huỷ vs trả lương)"
```

---

## Task 6: ShiftsView — toggle NV đã ngừng + bảng Ca đang mở + badge

**Files:**
- Modify: `src/features/shifts/shifts-view.tsx`
- Modify: `src/features/shifts/employee-grid.tsx`

- [ ] **Step 1: `employee-grid.tsx` — chip "Đã ngừng" khi `!is_active`**

Trong `renderRow`, ngay sau `<strong>{employee.name}</strong>` (dòng ~80), thêm:
```tsx
{employee.is_active === false && (
  <Badge variant="soft" semantic="neutral">Đã ngừng</Badge>
)}
```
(`Badge` đã import sẵn ở đầu file.)

- [ ] **Step 2: `shifts-view.tsx` — state toggle + queries + bảng + modal**

a) Thêm import (dùng `<input type="checkbox">` thuần — KHÔNG có `@/components/ui/toggle`; UI folder chỉ có `checkbox.tsx`/`switch.tsx`):
```tsx
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useEmployeesQuery, useShiftsQuery, usePayrollQuery, useOpenShiftsQuery } from "@/hooks/queries";
import { OpenShiftsTable } from "./open-shifts-table";
import { CloseShiftModal, type CloseShiftTarget } from "./close-shift-modal";
```

b) Trong body component, sau dòng `const isOwner = role === "owner";`:
```tsx
const [showInactive, setShowInactive] = useState(false);
const [closeTarget, setCloseTarget] = useState<CloseShiftTarget | null>(null);
const openShiftsQuery = useOpenShiftsQuery(supabase, true);
```
c) Đổi `useEmployeesQuery(supabase, true)` → `useEmployeesQuery(supabase, true, showInactive)`.
d) Thêm `openShiftsQuery.isLoading` vào điều kiện loading (dòng 62-66).
e) `const openShifts = openShiftsQuery.data ?? [];`
f) Trong JSX, NGAY TRÊN `<EmployeeGrid ...>` thêm khối bảng + toggle (chỉ owner/manager):
```tsx
{canManage && (
  <Card>
    <CardHeader className="flex items-center justify-between gap-3">
      <CardTitle>Ca đang mở ({openShifts.length})</CardTitle>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)} />
        Hiện cả NV đã ngừng
      </label>
    </CardHeader>
    <CardBody>
      <OpenShiftsTable
        shifts={openShifts}
        onClose={(s) => setCloseTarget({
          id: s.id, employee_id: (s as { employee_id?: string }).employee_id,
          business_date: s.business_date, check_in_at: s.check_in_at,
          employee_name: s.employee_name, employee_is_active: s.employee_is_active,
        })}
      />
    </CardBody>
  </Card>
)}
```
g) Cuối JSX (cạnh các modal khác) thêm:
```tsx
<CloseShiftModal
  open={closeTarget !== null}
  onOpenChange={(next) => { if (!next) setCloseTarget(null); }}
  shift={closeTarget}
  role={role}
  onClosed={() => openShiftsQuery.refetch()}
/>
```

- [ ] **Step 3: Vitest `src/features/shifts/__tests__/shifts-view.test.tsx` (coverage toggle + bảng — Codex)**

Mock 4 query hook để cô lập ShiftsView. Khẳng định: card "Ca đang mở" render từ `useOpenShiftsQuery`; tick "Hiện cả NV đã ngừng" gọi `useEmployeesQuery` với `includeInactive=true` (theo dõi đối số hook).

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftsView } from "../shifts-view";

const employeesArgs: unknown[][] = [];
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/hooks/queries", () => ({
  useEmployeesQuery: (...a: unknown[]) => { employeesArgs.push(a); return { data: [], isLoading: false, isError: false }; },
  useShiftsQuery: () => ({ data: [], isLoading: false, isError: false }),
  usePayrollQuery: () => ({ data: [], isLoading: false, isError: false }),
  useOpenShiftsQuery: () => ({
    data: [{ id: "s1", employee_id: "e1", business_date: "2026-06-10",
      check_in_at: new Date().toISOString(), check_out_at: null, total_minutes: null,
      status: "checked_in", employee_name: "An", position: null, employee_is_active: false }],
    isLoading: false, refetch: vi.fn(),
  }),
}));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
beforeEach(() => { employeesArgs.length = 0; });

describe("ShiftsView — ca đang mở + toggle NV đã ngừng", () => {
  it("render bảng Ca đang mở từ openShiftsQuery", () => {
    wrap(<ShiftsView businessDate="2026-06-28" role="owner" />);
    expect(screen.getByText(/Ca đang mở/i)).toBeInTheDocument();
    expect(screen.getByText("An")).toBeInTheDocument();
  });
  it("tick 'Hiện cả NV đã ngừng' → useEmployeesQuery(includeInactive=true)", () => {
    wrap(<ShiftsView businessDate="2026-06-28" role="owner" />);
    // lần render đầu: includeInactive=false (đối số thứ 3)
    expect(employeesArgs.at(-1)?.[2]).toBe(false);
    fireEvent.click(screen.getByLabelText(/Hiện cả NV đã ngừng/i));
    expect(employeesArgs.at(-1)?.[2]).toBe(true);
  });
});
```

- [ ] **Step 4: Chạy → PASS rồi typecheck + chạy test shifts**

Run: `npx vitest run src/features/shifts/__tests__/shifts-view.test.tsx && npx tsc --noEmit && npx vitest run src/features/shifts`
Expected: PASS; không lỗi type; test components Task 4/5 vẫn PASS. (Nếu label/markup lệch, chỉnh test cho khớp component thật.)

- [ ] **Step 5: Smoke chạy app (KHÔNG build khi dev đang chạy)**

Mở trang Ca & lương ở dev (port 3009): thấy card "Ca đang mở", toggle "Hiện cả NV đã ngừng", nút "Đóng ca" mở modal. (Nếu chưa có ca mở → empty state.)

- [ ] **Step 6: Commit**

```bash
git add src/features/shifts/shifts-view.tsx src/features/shifts/employee-grid.tsx src/features/shifts/__tests__/shifts-view.test.tsx
git commit -m "feat(shifts): trang Ca&lương — bảng Ca đang mở + toggle NV đã ngừng + đóng ca"
```

---

## Task 7: Cash-view — "Xem & đóng" + "Đóng hết (huỷ, không lương)"

**Files:**
- Modify: `src/features/cash/cash-view.tsx`
- Create: `src/features/shifts/bulk-cancel-shifts-modal.tsx`
- Create: `src/features/shifts/open-shifts-close-banner.tsx`
- Test: `src/features/shifts/__tests__/open-shifts-close-banner.test.tsx`, `src/features/shifts/__tests__/bulk-cancel-shifts-modal.test.tsx`

`openShifts` ở cash-view (ngày hiện tại) đã có sẵn (dòng 64). Banner đã có. Tách nội dung banner ra component `OpenShiftsCloseBanner` (test trực tiếp) với 2 nút: "Xem & đóng" (toggle inline `OpenShiftsTable`) và "Đóng hết (huỷ, không lương)" (mở `BulkCancelShiftsModal`). Modal đóng-ca-đơn `CloseShiftModal` + `BulkCancelShiftsModal` do cash-view mount.

- [ ] **Step 1: `bulk-cancel-shifts-modal.tsx` — huỷ hàng loạt**

```tsx
"use client";

import { useState } from "react";
import { Modal, ModalContent, ModalTitle, ModalDescription, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import { cancelShiftAssignment } from "@/lib/data/shifts";

interface BulkCancelShiftsModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shiftIds: ReadonlyArray<string>;
  businessDate: string;
  onDone?(): void;
}

export function BulkCancelShiftsModal({ open, onOpenChange, shiftIds, businessDate, onDone }: BulkCancelShiftsModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  async function handleConfirm() {
    if (!supabase || isBusy) return;
    if (reason.trim() === "") { toast({ semantic: "danger", message: "Phải nhập lý do." }); return; }
    setIsBusy(true);
    try {
      for (const id of shiftIds) {
        await cancelShiftAssignment(supabase, id, reason.trim());
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.openShifts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      toast({ semantic: "success", message: `Đã huỷ ${shiftIds.length} ca (không tính lương).` });
      onDone?.();
      onOpenChange(false);
    } catch (err) {
      toast({ semantic: "danger", message: err instanceof Error ? err.message : "Không huỷ hết được." });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Đóng hết ca chưa ra ({shiftIds.length})</ModalTitle>
        <ModalDescription>Huỷ tất cả ca còn mở của ngày này — KHÔNG tính lương. Cần lý do.</ModalDescription>
        <Textarea label="Lý do" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} disabled={isBusy} />
        <ModalActions>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>Đóng</Button>
          <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirm}>Huỷ hết</Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
```
> Button variants hợp lệ là `primary | secondary | destructive | ghost` (`src/components/ui/button.tsx:7`) — dùng `destructive`.

- [ ] **Step 2: Tách banner thành component trình bày `src/features/shifts/open-shifts-close-banner.tsx` (để test trực tiếp — Codex coverage)**

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { OpenShiftsTable, type OpenShiftRow } from "./open-shifts-table";

interface OpenShiftsCloseBannerProps {
  /** Ca checked_in của ngày đang chốt. */
  shifts: ReadonlyArray<OpenShiftRow>;
  /** owner/manager mới thấy nút đóng. */
  canManage: boolean;
  onClose(shift: OpenShiftRow): void;
  onBulk(): void;
}

/** Nội dung banner "còn ca chưa ra ca" trong Chốt két: text + Xem&đóng + Đóng hết. */
export function OpenShiftsCloseBanner({ shifts, canManage, onClose, onBulk }: OpenShiftsCloseBannerProps) {
  const [show, setShow] = useState(false);
  const names = shifts.map((s) => s.employee_name).filter(Boolean).join(", ");
  return (
    <div className="space-y-2">
      <p>
        Còn {shifts.length} ca chưa ra ca{names ? `: ${names}` : ""}.
      </p>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setShow((v) => !v)}>
            {show ? "Ẩn" : "Xem & đóng"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onBulk}>
            Đóng hết (huỷ, không lương)
          </Button>
        </div>
      )}
      {show && <OpenShiftsTable shifts={shifts} onClose={onClose} />}
    </div>
  );
}
```

- [ ] **Step 3: `cash-view.tsx` — wiring**

a) Import:
```tsx
import { OpenShiftsCloseBanner } from "@/features/shifts/open-shifts-close-banner";
import { CloseShiftModal, type CloseShiftTarget } from "@/features/shifts/close-shift-modal";
import { BulkCancelShiftsModal } from "@/features/shifts/bulk-cancel-shifts-modal";
```
b) State (gần các useState khác):
```tsx
const [closeTarget, setCloseTarget] = useState<CloseShiftTarget | null>(null);
const [bulkOpen, setBulkOpen] = useState(false);
```
c) THAY nguyên khối banner `openShifts.length > 0` (dòng 354-362) bằng:
```tsx
{openShifts.length > 0 && (
  <AlertBanner variant="warning">
    <OpenShiftsCloseBanner
      shifts={openShifts}
      canManage={canManage}
      onClose={(s) => setCloseTarget({
        id: s.id, employee_id: (s as { employee_id?: string }).employee_id,
        business_date: businessDate, check_in_at: s.check_in_at,
        employee_name: s.employee_name,
        employee_is_active: (s as { employee_is_active?: boolean | null }).employee_is_active,
      })}
      onBulk={() => setBulkOpen(true)}
    />
  </AlertBanner>
)}
```
> `openShifts` ở cash-view là `ShiftAssignment[]` → có `id, employee_id, business_date, check_in_at, employee_name`; thoả `OpenShiftRow`. `employee_is_active` không có → chip "Đã ngừng" không hiện ở cash-view (chấp nhận; bảng đầy đủ ở trang Ca&lương). Nút "Chốt két" vẫn `disabled` khi `openShifts.length > 0` (dòng 378 — GIỮ NGUYÊN).
d) Cuối JSX (cạnh các modal cash khác) thêm:
```tsx
<CloseShiftModal
  open={closeTarget !== null}
  onOpenChange={(next) => { if (!next) setCloseTarget(null); }}
  shift={closeTarget}
  role={role}
  onClosed={() => shiftsQuery.refetch()}
/>
<BulkCancelShiftsModal
  open={bulkOpen}
  onOpenChange={setBulkOpen}
  shiftIds={openShifts.map((s) => s.id)}
  businessDate={businessDate}
  onDone={() => shiftsQuery.refetch()}
/>
```

- [ ] **Step 4: Vitest banner — `src/features/shifts/__tests__/open-shifts-close-banner.test.tsx`**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OpenShiftsCloseBanner } from "../open-shifts-close-banner";

const shifts = [{ id: "s1", business_date: "2026-06-28",
  check_in_at: new Date().toISOString(), employee_name: "An", employee_is_active: true }];

describe("OpenShiftsCloseBanner", () => {
  it("hiện số ca + tên; 'Xem & đóng' lộ bảng; 'Đóng hết' gọi onBulk", () => {
    const onBulk = vi.fn();
    const onClose = vi.fn();
    render(<OpenShiftsCloseBanner shifts={shifts} canManage onClose={onClose} onBulk={onBulk} />);
    expect(screen.getByText(/Còn 1 ca chưa ra ca/i)).toBeInTheDocument();
    // bảng ẩn ban đầu (nút "Đóng ca" của row chưa render)
    expect(screen.queryByRole("button", { name: /^Đóng ca$/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Xem & đóng/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Đóng ca$/i }));
    expect(onClose).toHaveBeenCalledWith(shifts[0]);
    fireEvent.click(screen.getByRole("button", { name: /Đóng hết/i }));
    expect(onBulk).toHaveBeenCalled();
  });

  it("không phải owner/manager → ẩn nút đóng", () => {
    render(<OpenShiftsCloseBanner shifts={shifts} canManage={false} onClose={vi.fn()} onBulk={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Xem & đóng/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Vitest bulk — `src/features/shifts/__tests__/bulk-cancel-shifts-modal.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BulkCancelShiftsModal } from "../bulk-cancel-shifts-modal";

const cancelMock = vi.fn();
vi.mock("@/lib/data/shifts", () => ({ cancelShiftAssignment: (...a: unknown[]) => cancelMock(...a) }));
vi.mock("@/hooks/use-supabase", () => ({ useSupabase: () => ({}) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
beforeEach(() => cancelMock.mockReset().mockResolvedValue({ status: "cancelled" }));

describe("BulkCancelShiftsModal", () => {
  it("huỷ hết: gọi cancelShiftAssignment cho từng ca, có lý do", async () => {
    wrap(<BulkCancelShiftsModal open shiftIds={["a", "b"]} businessDate="2026-06-28" onOpenChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hết/i }));
    expect(cancelMock).not.toHaveBeenCalled(); // chưa có lý do
    fireEvent.change(screen.getByLabelText(/Lý do/i), { target: { value: "Hết ngày" } });
    fireEvent.click(screen.getByRole("button", { name: /Huỷ hết/i }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(2));
    expect(cancelMock).toHaveBeenCalledWith(expect.anything(), "a", "Hết ngày");
  });
});
```

- [ ] **Step 6: Chạy test + typecheck**

Run: `npx vitest run src/features/shifts/__tests__/open-shifts-close-banner.test.tsx src/features/shifts/__tests__/bulk-cancel-shifts-modal.test.tsx && npx tsc --noEmit`
Expected: PASS, không lỗi type.

- [ ] **Step 7: Commit**

```bash
git add src/features/cash/cash-view.tsx src/features/shifts/bulk-cancel-shifts-modal.tsx src/features/shifts/open-shifts-close-banner.tsx src/features/shifts/__tests__/open-shifts-close-banner.test.tsx src/features/shifts/__tests__/bulk-cancel-shifts-modal.test.tsx
git commit -m "feat(cash): chốt két — Xem & đóng ca mở + Đóng hết (huỷ, không lương)"
```

---

## Task 8: DELETE /api/users/[id] — tự dọn ca mở trước khi vô hiệu

**Files:**
- Modify: `src/app/api/users/[id]/route.ts` (DELETE handler, dòng 186-226)
- Test: `src/app/api/users/[id]/__tests__/route-delete.test.ts` (create)

**Trình tự BẮT BUỘC (atomicity — Codex blocker):** dọn ca PHẢI chạy **TRƯỚC mọi mutation** để nếu RPC lỗi thì chưa đụng gì (tài khoản chưa bị disable, NV chưa bị vô hiệu). Thứ tự mới: (1) **cancel_open_shifts_for_employee** (lỗi → return, chưa mutate) → (2) disable `employee_accounts` (lỗi → return) → (3) set `employees.is_active=false` (lỗi → return). Lý do "Huỷ do xoá tài khoản", actor = `caller.userId`. MỌI update đều check error.

- [ ] **Step 1: Viết Vitest route (fail trước)**

Mock `getServiceRoleClient` trả client giả ghi lại thứ tự `.rpc(...)`, `.from('employee_accounts').update(...)`, `.from('employees').update(...)`. Khẳng định: RPC gọi TRƯỚC cả hai update; tham số đúng; employees.update payload `{is_active:false}`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const empUpdatePayloads: unknown[] = [];
const rpc = vi.fn(async () => { calls.push("rpc"); return { data: { cancelled_count: 1 }, error: null }; });
function tableMock(name: string) {
  return {
    update: vi.fn((payload: unknown) => {
      calls.push(`${name}.update`);
      if (name === "employees") empUpdatePayloads.push(payload);
      return { eq: vi.fn(async () => ({ error: null })) };
    }),
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: { role: "staff_operator", employee_id: "emp-1" } }) })) })),
  };
}
vi.mock("@/lib/supabase/server", () => ({
  requireAuth: vi.fn(async () => ({ userId: "owner-auth", role: "owner" })),
  assertCanModifyTarget: vi.fn(),
  assertCanAssignRole: vi.fn(),
  getServiceRoleClient: () => ({ rpc, from: (n: string) => tableMock(n) }),
}));

beforeEach(() => { calls.length = 0; empUpdatePayloads.length = 0; rpc.mockClear(); });

describe("DELETE /api/users/[id]", () => {
  it("huỷ ca mở (rpc) TRƯỚC mọi mutation (account disable + is_active=false)", async () => {
    const { DELETE } = await import("../route");
    const req = { headers: { get: () => "Bearer x" } } as never;
    const res = await DELETE(req, { params: Promise.resolve({ id: "owner-auth" }) });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("cancel_open_shifts_for_employee", {
      p_employee_id: "emp-1", p_reason: "Huỷ do xoá tài khoản", p_actor: "owner-auth",
    });
    // RPC đứng đầu — trước cả account disable lẫn employees.update.
    expect(calls.indexOf("rpc")).toBe(0);
    expect(calls.indexOf("rpc")).toBeLessThan(calls.indexOf("employee_accounts.update"));
    expect(calls.indexOf("rpc")).toBeLessThan(calls.indexOf("employees.update"));
    expect(empUpdatePayloads).toContainEqual({ is_active: false });
  });
});
```
> Nếu mock signature lệch với code thật, chỉnh mock cho khớp; bất biến cần test: tên RPC + tham số + RPC đứng TRƯỚC mọi mutation + payload `is_active:false`.

- [ ] **Step 2: Chạy → FAIL**

Run: `npx vitest run "src/app/api/users/[id]/__tests__/route-delete.test.ts"`
Expected: FAIL (chưa gọi RPC / RPC không đứng đầu).

- [ ] **Step 3: Sửa DELETE handler** — thay TOÀN BỘ đoạn từ "Soft delete" (dòng ~211-225) bằng thứ tự atomic-safe:

```ts
  // 1) Dọn ca mở TRƯỚC mọi mutation: nếu RPC lỗi → return ngay, CHƯA disable/vô hiệu gì
  //    (giữ nhất quán). RPC service-role-only, set ca cancelled (không lương). KHÔNG hỏi.
  if (account.employee_id) {
    const { error: cancelErr } = await supabase.rpc("cancel_open_shifts_for_employee", {
      p_employee_id: account.employee_id,
      p_reason: "Huỷ do xoá tài khoản",
      p_actor: caller.userId,
    });
    if (cancelErr) return badRequest(`Không dọn được ca mở: ${cancelErr.message}`, 500);
  }

  // 2) Disable account
  const { error: accError } = await supabase
    .from("employee_accounts")
    .update({ status: "disabled" })
    .eq("auth_user_id", authUserId);
  if (accError) return badRequest(`Không disable account: ${accError.message}`, 500);

  // 3) Vô hiệu NV
  if (account.employee_id) {
    const { error: empError } = await supabase
      .from("employees")
      .update({ is_active: false })
      .eq("id", account.employee_id);
    if (empError) return badRequest(`Không vô hiệu nhân viên: ${empError.message}`, 500);
  }

  return NextResponse.json({ status: "ok", message: "Đã vô hiệu hóa tài khoản." });
```
(Đoạn cũ disable account + `if (account.employee_id) { ...update is_active... }` ở dòng 211-225 bị thay hẳn bằng khối trên — chú ý KHÔNG để sót `return NextResponse.json` cũ.)

- [ ] **Step 4: Chạy → PASS**

Run: `npx vitest run "src/app/api/users/[id]/__tests__/route-delete.test.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/users/[id]/route.ts" "src/app/api/users/[id]/__tests__/route-delete.test.ts"
git commit -m "feat(users): xoá tài khoản tự huỷ ca mở (cancel_open_shifts_for_employee) trước khi vô hiệu"
```

---

## Task 9: Verify toàn bộ + ghi chú sửa 2 ca kẹt thực tế

**Files:** none (verification)

- [ ] **Step 1: Full verify**

Run: `npm run verify:phase`
Expected: Vitest (`test:run`) PASS toàn bộ + pgTAP PASS toàn bộ (gồm `370`). Không fail mới.

- [ ] **Step 2: Typecheck cuối**

Run: `npx tsc --noEmit`
Expected: 0 lỗi.

- [ ] **Step 3: (Tuỳ chọn) `verify:mirror`** — chỉ chạy nếu có sẵn v3 mirror dump + app đang chạy:

Run: `node tools/verify-mirror.mjs --date <ngày> --url http://localhost:3009 --service-key <key>`
Expected: active_staff / payroll khớp (đổi này không đụng công thức dashboard nên không lệch). Bỏ qua nếu không có mirror.

- [ ] **Step 4: Runbook — sửa 2 ca đang kẹt thật (mục E của spec)**

Spec §E: 2 ca kẹt cần được dọn. Có 2 đường:

**(A) Trước khi tính năng lên — owner thao tác tay (không SQL):** bật lại `is_active` cho 2 NV trong Settings → vào trang Ca & lương → "Ra ca/Huỷ" trong UI hiện hành → ẩn lại (`is_active=false`).

**(B) SQL trực tiếp trên DB prod (nếu cần dọn ngay, KHÔNG sửa tay được):**
```sql
-- Lấy id 2 ca kẹt:
select id, employee_id, business_date, check_in_at
  from public.shift_assignments where status = 'checked_in';
-- Huỷ (không lương). KHÔNG dùng status='checked_out' tay (thiếu bản ghi lương → lệch):
update public.shift_assignments
   set status = 'cancelled', check_out_at = now(), updated_at = now()
 where id in ('<id1>','<id2>');
```

**(C) Sau khi feature lên:** owner mở trang Ca & lương → "Hiện cả NV đã ngừng" → bảng "Ca đang mở" liệt kê mọi ca kẹt → "Đóng ca" → "Huỷ ca (không tính lương)". Đây là cách khuyến nghị cho các lần sau.

- [ ] **Step 5: Tổng kết PR**

```bash
git log --oneline origin/main..HEAD
```
Mở PR vào `main` với mô tả bám tiêu chí hoàn thành mục 6 của spec.

---

## Self-review: đối chiếu spec ↔ plan

| Yêu cầu spec | Task |
|---|---|
| RPC `cancel_shift_assignment` security definer, set cancelled + check_out_at, KHÔNG payroll/cash, bắt buộc lý do (audit), dual-write + grant | Task 1 (gate đổi sang owner_manager theo quyết định #1; reason audit-only #2) |
| `loadOpenShifts()` đọc thẳng shift_assignments checked_in mọi ngày, left-join employees | Task 2 |
| `loadEmployees(includeInactive)` / query riêng gồm is_active=false | Task 2 + Task 3 |
| Toggle "Hiện cả NV đã ngừng" (owner/manager) | Task 6 |
| Bảng "Ca đang mở": tên/"NV đã ngừng", giờ vào, đã làm bao lâu, cờ quá hạn > N giờ | Task 4 (OVERDUE_HOURS=12) |
| Nút "Đóng ca" → modal: Huỷ (lý do) HOẶC Trả lương theo giờ (now mặc định) | Task 5 (#5: owner=check_out_employee có giờ ra; manager=check_out_employee_now) |
| Xoá tài khoản: tự huỷ ca mở trước khi vô hiệu, lý do cố định, không hỏi | Task 8 (RPC admin #3) |
| Chốt ngày còn checked_in → banner + "Xem & đóng" + "Đóng hết (huỷ)" | Task 7 (banner đã có sẵn; thêm 2 nút) |
| pgTAP: cancelled, không payroll/cash, gate, audit, idempotent | Task 1 |
| pgTAP/integration xoá TK: ca cancelled + active count giảm | Task 1 (Group C+D) + Task 8 (route order Vitest) |
| Vitest: bảng + toggle + modal + banner | Task 4,5,6,7 |
| verify:mirror + verify:phase | Task 9 |
| Sửa 2 ca kẹt (mục E) | Task 9 Step 4 (qua UI mới, không SQL) |

**Ngoài phạm vi (giữ nguyên YAGNI theo spec):** không cron tự đóng nửa đêm; không đổi mô hình soft-delete; ca qua đêm chỉ gắn cờ "quá hạn".

**Đã qua Codex review (vòng 1) — các finding đã xử lý:**
- BLOCKER atomicity DELETE → Task 8: RPC dọn ca chạy TRƯỚC mọi mutation, mọi update check error.
- BLOCKER datetime → Task 5: dùng `fromDatetimeLocal`/`toDatetimeLocal` (VN-local), bỏ `new Date().toISOString()`.
- Coverage delete-account → Task 8 test thêm assert payload `is_active:false` + RPC đứng đầu; pgTAP 370 Group C/D phủ hiệu ứng SQL.
- Coverage component → thêm `shifts-view.test.tsx` (toggle) + `open-shifts-close-banner.test.tsx` (banner).
- Coverage 2 ca kẹt → Task 9 Step 4 khôi phục runbook (A tay / B SQL / C qua UI mới).
- Coverage realtime labor → pgTAP 370 D1b assert `active_shifts` rỗ bớt.
- Risky grant → revoke `public, anon` rồi grant `authenticated`.
- Risky Toggle → bỏ, dùng `<input type="checkbox">` thuần.
- Risky Button variant → `destructive` (không `danger`).
- Nits → manager toast dùng `durationLabel`/`formatVND`; bỏ note fallback `moneyFromInput`.

**Quyết định giữ nguyên (Codex đã đồng thuận là không chặn correctness):** gate `app_is_owner_manager` (lệch spec, chủ ý); KHÔNG chặn final-close khi huỷ (không đụng tiền → không lệch báo cáo); reason audit-only tạo 2 dòng audit/lần (1 trigger transition + 1 explicit reason). Byte-identity 002↔migration là kỷ luật thủ công (verify khi review diff).
