# Phase 3B.2a — Shifts/Payroll Write Module Design Spec

> **Status:** Approved 2026-05-20 (brainstorm)
> **Master plan:** `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md` §5 Phase 3B (split: 3B.1 expenses ✓, 3B.2a shifts NOW, 3B.2b cash+tests after)
> **Implements:** ShiftsView — employee grid + check-in/out modals + payroll history + employee CRUD modal + payroll edit modal + 5 mutation hooks + Textarea primitive

---

## 1. Mục tiêu

Thay placeholder `view === "shifts"` (locked EmptyState ở Phase 3A `page.tsx`) bằng **ShiftsView** đầy đủ chức năng:
- Lưới nhân viên 2-col: "Đang làm việc" (đã check-in chưa check-out) + "Chưa vào ca"
- Modal vào ca (datetime-local + default-time logic + validate trong business_date)
- Modal ra ca (start/end + duration live calc + base_pay hero + allowance + note)
- Lịch sử lương theo lượt (payroll records) với row click → sửa
- Modal CRUD nhân viên (add/edit, owner/manager only)
- Modal sửa lượt lương (owner/manager only, recompute duration + total_pay)

Backend Phase 1 đã có sẵn 3 RPC + 2 direct-table fn + 4 query/loaders + 2 validation helper — chỉ cần wire UI.

Sau Phase 3B.2a, staff_operator/manager/owner login → click "Ca & lương" → đủ 6 thao tác cốt lõi (check-in, check-out, edit payroll, add employee, edit employee, deactivate employee).

---

## 2. Quyết định đã chốt (brainstorming 2026-05-20)

| Vấn đề | Lựa chọn |
|---|---|
| **Scope split** | Master plan Phase 3B = cash + shifts + expenses. Anh đã chốt: 3B.1 (expenses ✓), **3B.2a (shifts) NOW**, 3B.2b (cash + Vitest + pgTAP) sau. Shifts đi trước để validate datetime-local form pattern + employee CRUD pattern trước khi vào cash phức tạp. |
| **Module decomposition** | **Strict split (7 file)** — đồng pattern Phase 3A + 3B.1. v3 `shift-panel.tsx` 401 dòng → tách thành ShiftsView + EmployeeGrid + CheckInModal + CheckOutModal + PayrollHistoryCard. + 2 modal port v3 = 7 file. |
| **Form pattern** | Giữ v3: `useState` + inline validation. Shifts forms đơn giản hơn ExpenseForm (3B.1). React-hook-form decision dời sang 3B.2b cash. |
| **Modal pattern** | Phase 2 `<Modal>` compound (Radix Dialog) — proven trong 3B.1. Check-in + check-out + employee + payroll-edit đều dùng Modal. |
| **Optimistic updates** | Không. Mutation success → `queryClient.invalidateQueries(...)` → server-driven refetch. Đồng pattern 3B.1. |
| **Confirm delete/destructive** | Shifts KHÔNG có destructive action: check-out tạo payroll record (không xóa shift); deactivate employee là toggle `is_active=false` (revertible). Không cần nested confirm modal pattern ở phase này. |
| **Test framework** | Defer Vitest/pgTAP đến 3B.2b. Shifts có duration math (`base_pay = round(minutes × hourly_rate / 60 / 1000) × 1000`) — đáng test nhưng có thể test sau khi cash math + pgTAP infra đã setup. |
| **Textarea primitive** | **Extract NOW** vào `src/components/ui/textarea.tsx`. Shifts có 2 textarea (check-out note, payroll-edit note). Cash 3B.2b có thêm note. Handover 3C có thêm note. Worth extracting upfront thay vì 4× inline. |
| **Employee CRUD scope** | Giữ trong shifts module (giống v3). Owner/manager only. Không tách sang settings 3C. Operator UX: thao tác nhân viên cạnh employee list — context tốt hơn. |

---

## 3. Phạm vi (Scope)

### Trong phạm vi
- **ShiftsView** layout: header với business-date + "+ Thêm nhân viên" (admin only) → EmployeeGrid bento → PayrollHistoryCard bento.
- **EmployeeGrid**: 2-col responsive (`md:grid-cols-2`). Cột trái "Đang làm việc" + cột phải "Chưa vào ca". Mỗi row hiển thị: name, position, hourly_rate, status badge, action buttons ("Vào ca" / "Ra ca" / "Sửa" theo role).
- **CheckInModal**: datetime-local input + default-time logic + validate trong business_date + AlertBanner nếu invalid + submit.
- **CheckOutModal**: start/end datetime-local + 3-metric mini-grid (Tổng giờ + Lương giờ + Thực nhận) + payout hero + allowance + note textarea + submit.
- **PayrollHistoryCard**: list payroll records của ngày, header total, row click (admin only) → PayrollEditModal. Hiển thị: name, duration, allowance, edited badge nếu có.
- **EmployeeFormModal**: add/edit nhân viên (name, position, hourly_rate, is_active checkbox). Validation: name non-empty + max 200, hourly_rate trong limits.
- **PayrollEditModal**: edit check_in_at + check_out_at + allowance + note. Recompute duration + base_pay + total_pay live. Submit calls `edit_shift_payroll_record` RPC.
- **`useShiftMutations` hook** (5 mutations):
  - `useCheckIn(supabase, businessDate)` → invalidates `shifts(date)`
  - `useCheckOut(supabase, businessDate)` → invalidates `shifts(date)` + `payroll(date)` + `dashboard(date)` (cash side-effect)
  - `useUpdatePayrollRecord(supabase, businessDate)` → invalidates `payroll(date)` + `dashboard(date)`
  - `useUpsertEmployee(supabase)` → invalidates `employees()` (branch create vs update by id presence)
  - `useDeactivateEmployee(supabase)` → invalidates `employees()` (= updateEmployee with `is_active: false`)
- **`<Textarea>` primitive** new at `src/components/ui/textarea.tsx`: same API shape as TextField (label, helper, error, plus standard textarea HTML props).
- Mount `ShiftsView` vào `src/app/page.tsx` cho `view === "shifts"`.

### NGOÀI phạm vi (defer)
- **Cash module** → Phase 3B.2b.
- **Test framework** (Vitest / pgTAP / Playwright) → 3B.2b (đầu phase setup).
- **Handover wizard** ghi → Phase 3C.
- **Sổ quỹ** + **Settings** → Phase 3C.
- **Bulk check-in/check-out** — YAGNI.
- **Time-off / leave management** — YAGNI.
- **Employee photo / contact** — YAGNI.
- **Past-day shift edits** (chỉnh sửa shift_assignment đã đóng) — KHÔNG support. v3 không cho phép sửa shift_assignment trực tiếp; chỉ sửa payroll_record (snapshot từ shift). Giữ constraint này.

---

## 4. Kiến trúc

### 4.1 Tổng quan

```
src/app/page.tsx (Phase 3A, modify dispatcher only)
  └ {view === "shifts" && <ShiftsView businessDate={...} role={...} />}

src/features/shifts/
  shifts-view.tsx
    ├ useEmployeesQuery(supabase)                ← Phase 1
    ├ useShiftsQuery(supabase, businessDate)     ← Phase 1
    ├ usePayrollQuery(supabase, businessDate)    ← Phase 1
    ├ useShiftMutations (5 mutations from T1)
    ├ Local state: checkInTarget, checkout, editingPayroll, editingEmployee, showCreateEmployee
    └ render:
       ├ header (business-date + "+ Thêm nhân viên" admin only)
       ├ <EmployeeGrid employees={...} shifts={...} role={role}
       │     onCheckIn={openCheckIn} onCheckOut={openCheckOut}
       │     onEditEmployee={canManage ? setEditingEmployee : undefined} />
       ├ <PayrollHistoryCard payroll={...} role={role} onEditRow={canManage ? setEditingPayroll : undefined} />
       └ Modals (controlled by parent state):
          <CheckInModal open employee businessDate onOpenChange />
          <CheckOutModal open shift employee businessDate onOpenChange />
          <EmployeeFormModal open employee onOpenChange />
          <PayrollEditModal open payroll onOpenChange />

src/hooks/mutations/
  use-shift-mutations.ts  (5 hooks co-located)

src/components/ui/
  textarea.tsx  (NEW primitive)
```

### 4.2 File structure (created/modified in 3B.2a)

```
src/
  app/
    page.tsx                                  [MODIFY — swap shifts EmptyState for ShiftsView]
  features/
    shifts/
      shifts-view.tsx                         [NEW — container]
      employee-grid.tsx                       [NEW — 2-col]
      check-in-modal.tsx                      [NEW]
      check-out-modal.tsx                     [NEW]
      payroll-history-card.tsx                [NEW]
      employee-form-modal.tsx                 [NEW — port v3]
      payroll-edit-modal.tsx                  [NEW — port v3]
  hooks/
    mutations/
      use-shift-mutations.ts                  [NEW — 5 hooks co-located]
  components/ui/
    textarea.tsx                              [NEW — primitive]
```

**Untouched:** Phase 1 backend (`src/lib/data/shifts.ts` + `employees.ts` đã có 3 RPC + 3 direct fn ready; `lib/validation.ts` có `validateEmployee` + `validatePayrollEdit`; `lib/datetime.ts` có `toDatetimeLocal` + `fromDatetimeLocal` + `todayInVN`). Phase 2 components. Phase 3A modules. Phase 3B.1 expenses.

### 4.3 Hooks contracts (mutations)

File: `src/hooks/mutations/use-shift-mutations.ts`.

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkInEmployee,
  checkOutEmployee,
  editPayrollRecord,
  createEmployee,
  updateEmployee,
} from "@/lib/data";
import type { Employee } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

export interface CheckInInput {
  employee_id: string;
  business_date: string;
  check_in_at: string;  // naive datetime-local string (VN time, NOT UTC)
}

export interface CheckOutInput {
  shift_assignment_id: string;
  employee_id: string;
  business_date: string;
  check_in_at: string;
  check_out_at: string;
  allowance_amount: number;
  note: string;
}

export interface UpdatePayrollInput {
  payroll_record_id: string;
  check_in_at: string;
  check_out_at: string;
  allowance_amount: number;
  note: string;
}

export interface UpsertEmployeeInput {
  /** Set to existing id for update; omit for create. */
  id?: string;
  name: string;
  position: string;
  hourly_rate: number;
  is_active: boolean;
}

export function useCheckIn(supabase: SupabaseClient | null, businessDate: string);
export function useCheckOut(supabase: SupabaseClient | null, businessDate: string);
export function useUpdatePayrollRecord(supabase: SupabaseClient | null, businessDate: string);
export function useUpsertEmployee(supabase: SupabaseClient | null);
export function useDeactivateEmployee(supabase: SupabaseClient | null);
```

Mỗi mutation:
- `mutationFn` gọi data fn từ `@/lib/data`
- `onSuccess` invalidate đúng query key
- KHÔNG catch error trong mutationFn — caller dùng `mutateAsync` + try/catch + toast
- `supabase` nullable → throw `Error("Thiếu cấu hình Supabase.")` if null

Invalidation map:
| Mutation | Keys invalidated |
|---|---|
| useCheckIn | `shifts(businessDate)` |
| useCheckOut | `shifts(businessDate)` + `payroll(businessDate)` + `dashboard(businessDate)` (`active_staff` + `payroll_paid` đều thay đổi) |
| useUpdatePayrollRecord | `payroll(businessDate)` + `dashboard(businessDate)` (`payroll_paid`) |
| useUpsertEmployee | `employees()` |
| useDeactivateEmployee | `employees()` (calls `updateEmployee` with `{is_active: false}` — soft delete) |

### 4.4 Data flow

```
User clicks "+ Thêm nhân viên"
   ↓ setShowCreateEmployee(true)
   ↓ EmployeeFormModal renders (create mode, employee=null)
   ↓ User fills + submit
   ↓ validateEmployee({ name, hourly_rate }) → ok
   ↓ useUpsertEmployee.mutateAsync({ name, position, hourly_rate, is_active: true })
   ↓ data fn branches: id presence → updateEmployee vs createEmployee
   ↓ invalidates employees() → useEmployeesQuery refetches
   ↓ EmployeeGrid re-renders with new employee in "Chưa vào ca" column

User clicks "Vào ca" trên 1 employee
   ↓ openCheckIn(employee) → setCheckInTarget(employee) + setCheckInTime(defaultCheckInTime(date))
   ↓ CheckInModal renders
   ↓ User adjust time if needed
   ↓ Validate: checkInTime within business_date (date prefix matches)
   ↓ useCheckIn.mutateAsync({ employee_id, business_date, check_in_at })
   ↓ RPC inserts shift_assignment status=checked_in
   ↓ invalidates shifts(date)
   ↓ EmployeeGrid re-renders: employee moves to "Đang làm việc" column, status badge updates

User clicks "Ra ca" trên 1 active shift
   ↓ openCheckOut(shift) → setCheckout(shift) + populate startTime (from shift.check_in_at) + endTime (now)
   ↓ CheckOutModal renders with employee context, allowance=0, note=""
   ↓ Live derived: minutes = max(0, round((endTimeMs - startTimeMs)/60_000))
                  basePay = round((minutes/60) × hourly_rate / 1000) × 1000
                  totalPay = basePay + moneyFromInput(allowance)
                  invalidTime = startTime && endTime && endTimeMs < startTimeMs
   ↓ Submit (disabled when invalidTime)
   ↓ useCheckOut.mutateAsync({ shift_assignment_id, employee_id, ..., allowance_amount, note })
   ↓ RPC marks shift checked_out + creates payroll_record
   ↓ invalidates shifts + payroll + dashboard
   ↓ Employee moves back to "Chưa vào ca" (or stays if has another open shift today — first-wins reduce); new payroll row appears in PayrollHistoryCard

Admin clicks Sửa payroll row
   ↓ setEditingPayroll(row)
   ↓ PayrollEditModal renders with pre-filled times + allowance + note
   ↓ Same live duration/base_pay/totalPay derivation
   ↓ validatePayrollEdit({ check_in_at, check_out_at, allowance_amount, note }) → ok
   ↓ useUpdatePayrollRecord.mutateAsync({...})
   ↓ invalidates payroll + dashboard
   ↓ Row updates in place with new totals; "Đã sửa <datetime>" badge appears
```

### 4.5 Component → Phase 2 mapping

| Element | Component |
|---|---|
| ShiftsView outer container | Tailwind `space-y-6` (vertical bento stack) |
| Section card | Phase 2 `<Card>` + `<CardHeader>` + `<CardBody>` |
| Employee grid container | Tailwind `grid gap-6 md:grid-cols-2` |
| Employee row | Custom `<article>` styled với Tailwind tokens (avatar pastel placeholder + name + status badge + buttons) |
| Status badge | Phase 2 `<Badge variant="soft" semantic={...}>` (success / neutral / warning) |
| Button "Vào ca" / "Ra ca" / "Sửa" | Phase 2 `<Button variant="ghost" size="sm">` |
| Button "+ Thêm nhân viên" (icon-only desktop) | Phase 2 `<IconButton icon="plus" size={32} variant="primary" aria-label="Thêm nhân viên">` |
| TextField (name, position, hourlyRate, datetime fields, allowance) | Phase 2 `<TextField>` |
| datetime-local input | Phase 2 `<TextField type="datetime-local">` (works because TextField extends InputHTMLAttributes) |
| Checkbox (is_active) | Phase 2 `<Checkbox label="Đang hoạt động">` |
| 3-metric mini-grid (Tổng giờ / Lương giờ / Thực nhận) | Inline Tailwind grid + Phase 2 typography (label muted xs + value display) |
| Payout hero | Custom `<div>` with bold value + label |
| Note textarea | **NEW** Phase 2 `<Textarea>` primitive |
| Form-level error | Phase 2 `<AlertBanner variant="danger">` |
| Empty state | Phase 2 `<EmptyState icon="users" title=… subtitle=… />` |
| Modal shell | Phase 2 `<Modal>` compound (Root + Content + Title + Description + Actions) |
| Toast | Phase 2 `useToast()` |

### 4.6 New `<Textarea>` primitive

File: `src/components/ui/textarea.tsx`. Mirrors `text-field.tsx` API + uses same Tailwind token classes.

```tsx
"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, helper, error, id, className, disabled, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helperId = `${inputId}-helper`;
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-ink-2">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={(helper || error) ? helperId : undefined}
        className={cn(
          "rounded-sm bg-surface border px-3 py-2 text-sm text-ink placeholder:text-muted transition-colors",
          "focus-visible:outline-none focus-visible:border-2",
          error
            ? "border-danger focus-visible:border-danger"
            : "border-border focus-visible:border-border-strong",
          disabled && "bg-surface-muted text-muted cursor-not-allowed",
          className
        )}
        {...rest}
      />
      {(helper || error) && (
        <span id={helperId} className={cn("text-xs", error ? "text-danger" : "text-muted")}>
          {error ?? helper}
        </span>
      )}
    </div>
  );
});
```

API mirror đúng TextField — caller learning curve = 0.

### 4.7 Status badge mapping

```ts
function statusBadge(status: ShiftAssignment["status"] | undefined) {
  if (status === "checked_in") return <Badge variant="soft" semantic="success">Đang trong ca</Badge>;
  if (status === "checked_out") return <Badge variant="soft" semantic="neutral">Đã ra ca</Badge>;
  return <Badge variant="soft" semantic="warning">Chưa vào</Badge>;
}
```

### 4.8 Default-time + validation helpers

Co-locate as pure helpers at module top of `shifts-view.tsx`:

```ts
import { toDatetimeLocal, todayInVN } from "@/lib/datetime";

/** Default time cho check-in modal. If business_date = today VN → now; else → 08:00. */
function defaultCheckInTime(businessDate: string): string {
  if (todayInVN() === businessDate) return toDatetimeLocal(new Date().toISOString());
  return `${businessDate}T08:00`;
}

/** Validate check-in time falls within business_date. */
function isCheckInTimeValid(checkIn: string, businessDate: string): boolean {
  if (!checkIn) return false;
  return checkIn.slice(0, 10) === businessDate;
}
```

(v3 has these inline at the top of `shift-panel.tsx` — preserve verbatim.)

### 4.9 Shift de-duplication (preserves v3 idiom)

```ts
// v3 quirk: shifts come pre-sorted DESC by check_in_at. Part-time workers
// can have multiple shifts/day (morning + evening). first-wins reduce keeps
// the MOST RECENT shift per employee. `new Map(shifts.map(...))` would
// last-wins → keep oldest (wrong: would show "Đã ra ca" status while active
// in afternoon shift).
const shiftByEmployee = shifts.reduce((map, shift) => {
  if (!map.has(shift.employee_id)) map.set(shift.employee_id, shift);
  return map;
}, new Map<string, ShiftAssignment>());
```

---

## 5. Component specs

### 5.1 ShiftsView

**Props:** `{ businessDate: string; role: UserRole }`

**Responsibilities:**
- Mount 3 queries (employees, shifts, payroll); use 5 mutations
- Layout: vertical stack of EmployeeGrid + PayrollHistoryCard
- Own modal state (5 separate states for the 4 modals — checkInTarget, checkout, editingPayroll, editingEmployee, showCreateEmployee)
- Compute `canManageEmployees = role === "owner" || role === "manager"` and thread down to children
- Compute `shiftByEmployee` map (first-wins reduce)
- Compute `activeEmployees` + `inactiveEmployees` partitioning

**State:**
```ts
const [checkInTarget, setCheckInTarget] = useState<Employee | null>(null);
const [checkout, setCheckout] = useState<ShiftAssignment | null>(null);
const [editingPayroll, setEditingPayroll] = useState<PayrollRecord | null>(null);
const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
const [showCreateEmployee, setShowCreateEmployee] = useState(false);
```

**Loading/error state:** Spinner if any of 3 queries loading; AlertBanner danger if shifts/payroll queries error (employees is reference data — fallback empty array, log only).

### 5.2 EmployeeGrid

**Props:**
```ts
interface EmployeeGridProps {
  employees: ReadonlyArray<Employee>;
  shiftByEmployee: ReadonlyMap<string, ShiftAssignment>;
  canManage: boolean;
  businessDate: string;
  onCheckIn(employee: Employee): void;
  onCheckOut(shift: ShiftAssignment): void;
  onEditEmployee(employee: Employee): void;
}
```

**Responsibilities:**
- Partition employees: active = `shiftByEmployee.get(id)?.status === "checked_in"`, inactive = else.
- 2-col grid (`grid md:grid-cols-2 gap-6`).
- Each row: `<article>` with name + position + hourly_rate (right-aligned), status Badge, action buttons.
- Action buttons (role-gated):
  - "Sửa" (admin only) → `onEditEmployee`
  - "Vào ca" (disabled when status === "checked_in") → `onCheckIn`
  - "Ra ca" (disabled when no shift or status !== "checked_in") → `onCheckOut(shift)`
- Empty states:
  - active column: `<EmptyState icon="users" title="Chưa có ai đang làm" subtitle="..." />`
  - inactive column: `<EmptyState icon="checkCircle" title="Tất cả đã vào ca" subtitle="..." />`

### 5.3 CheckInModal

**Props:**
```ts
interface CheckInModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  employee: Employee | null;
  businessDate: string;
}
```

**State:** `checkInTime: string`.

**Behavior:**
- Reset on open (useEffect keyed on `employee?.id`): `setCheckInTime(defaultCheckInTime(businessDate))`.
- Validate `isCheckInTimeValid(checkInTime, businessDate)` → AlertBanner if invalid.
- Submit: `useCheckIn.mutateAsync({ employee_id, business_date, check_in_at: fromDatetimeLocal(checkInTime) })`.
- On success: toast "đã vào ca." + `onOpenChange(false)`.
- AutoFocus the datetime input.

**Layout:**
```
ModalTitle: <employee.name>
ModalDescription: "Vào ca · <position> · <hourly_rate>/giờ"
TextField (datetime-local): "Giờ vào ca" (autoFocus)
  helper: "Mặc định là giờ hiện tại. Phải nằm trong ngày {businessDate}."
AlertBanner danger (if invalid): "Giờ vào ca phải nằm trong ngày {businessDate}."
ModalActions:
  Button ghost: "Hủy"
  Button primary: "Xác nhận vào ca" (loading + disabled when invalid)
```

### 5.4 CheckOutModal

**Props:**
```ts
interface CheckOutModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shift: ShiftAssignment | null;
  employee: Employee | null;
  businessDate: string;
}
```

**State:** `startTime, endTime, allowance, note`.

**Derived (useMemo):**
- `minutes = startTime && endTime ? Math.max(0, round((endTimeMs - startTimeMs)/60_000)) : 0`
- `basePay = employee ? round((minutes/60) × hourly_rate / 1000) × 1000 : 0`
- `totalPay = basePay + moneyFromInput(allowance)`
- `invalidTime = startTime && endTime && new Date(endTime) < new Date(startTime)`

**Behavior:**
- Reset on open (useEffect keyed on `shift?.id`):
  - `setStartTime(toDatetimeLocal(shift.check_in_at ?? now))`
  - `setEndTime(toDatetimeLocal(now))`
  - `setAllowance("0")`
  - `setNote("")`
- Submit (disabled when invalidTime || mutation pending):
  - `useCheckOut.mutateAsync({ shift_assignment_id, employee_id, business_date, check_in_at, check_out_at, allowance_amount, note })`
- On success: toast "Đã ra ca và lưu lương theo lượt." + `onOpenChange(false)`.

**Layout:**
```
ModalTitle: <employee.name>
ModalDescription: "Xác nhận ra ca"
Grid 2 cols:
  TextField "Giờ vào" type=datetime-local
  TextField "Giờ ra" type=datetime-local
AlertBanner danger (if invalidTime): "Giờ ra không được nhỏ hơn giờ vào."
3-metric grid: Tổng giờ | Lương giờ | Thực nhận
Payout hero card: bg-mint, value=formatVND(totalPay), label="Tổng thực nhận ca này"
TextField "Bồi dưỡng" inputMode=numeric
Textarea "Ghi chú" placeholder="Lý do chỉnh giờ hoặc bồi dưỡng..."
ModalActions:
  Button ghost: "Hủy"
  Button primary: "Xác nhận ra ca" (loading + disabled invalidTime)
```

### 5.5 EmployeeFormModal

**Props:**
```ts
interface EmployeeFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** null = create mode; non-null = edit mode. */
  employee: Employee | null;
}
```

**State:** `name, position, hourlyRate, isActive, fieldError`.

**Behavior:**
- Reset on open (useEffect keyed on `employee?.id`):
  - create mode: defaults (`""`, `""`, `""`, `true`)
  - edit mode: from `employee.*` with hourly_rate as `formatNumber(hourly_rate)` for VND-friendly display
- Submit: `validateEmployee({ name, hourly_rate: moneyFromInput(hourlyRate) })` then `useUpsertEmployee.mutateAsync({ id: employee?.id, name, position, hourly_rate, is_active })`.
- On success: toast (create vs edit message) + `onOpenChange(false)`.

**Layout:**
```
ModalTitle: employee ? "Sửa thông tin nhân viên" : "Thêm nhân viên mới"
Form:
  TextField "Tên nhân viên" required autoFocus
  TextField "Vị trí" placeholder="Ví dụ: Thu ngân"
  TextField "Lương theo giờ" inputMode=numeric placeholder="26000"
  Checkbox "Đang hoạt động" (only show in edit mode)
AlertBanner if fieldError
ModalActions:
  Button ghost: "Hủy"
  Button primary: employee ? "Lưu thay đổi" : "Thêm nhân viên" (type=submit, loading)
```

### 5.6 PayrollEditModal

**Props:**
```ts
interface PayrollEditModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  payroll: PayrollRecord | null;
}
```

**State:** `startTime, endTime, allowance, note, errorMessage`.

**Derived (useMemo, same shape as CheckOutModal):**
- `minutes`, `basePay`, `totalPay`, `invalidTime`

**Behavior:**
- Reset on open (useEffect keyed on `payroll?.id`):
  - `setStartTime(toDatetimeLocal(payroll.check_in_at))`
  - `setEndTime(toDatetimeLocal(payroll.check_out_at))`
  - `setAllowance(formatNumber(payroll.allowance_amount))`
  - `setNote(payroll.note ?? "")`
- Submit: `validatePayrollEdit({...})` then `useUpdatePayrollRecord.mutateAsync({ payroll_record_id, check_in_at, check_out_at, allowance_amount, note })`.
- On success: toast "Đã cập nhật lượt lương đã chốt." + `onOpenChange(false)`.

**Layout:** same shape as CheckOutModal (Grid 2 cols + 3-metric + payout hero + bồi dưỡng + ghi chú), title is "Sửa lượt lương" / subtitle "<employee_name>".

### 5.7 PayrollHistoryCard

**Props:**
```ts
interface PayrollHistoryCardProps {
  payroll: ReadonlyArray<PayrollRecord>;
  total: number;
  canManage: boolean;
  onEditRow(payroll: PayrollRecord): void;
}
```

**Responsibilities:**
- Card with CardHeader showing CardTitle "Lương theo lượt" + total VND.
- Body: empty state if no records; else `<ul>` of rows.
- Each row: employee_name (truncate) + meta (duration + allowance + edited badge if edited_at) + total_pay (formatted right).
- Row click (canManage only) → `onEditRow(row)`.

Same row-click pattern as ExpenseHistoryCard (3B.1): tabIndex/role/aria-label/onKeyDown conditional on canManage.

---

## 6. Error handling

| Scenario | Behavior |
|---|---|
| Validation fail (employee/payroll) | AlertBanner danger inline + toast danger |
| Mutation RPC error | Toast danger; modal stays open |
| Mutation success | Toast success + close modal |
| `useShiftsQuery.isError` / `usePayrollQuery.isError` | AlertBanner inline (Phase 3A pattern) |
| `useEmployeesQuery.isError` | Log + fallback to empty array (reference data, non-fatal) |
| Time invalid (end < start) | AlertBanner danger inline; submit disabled |
| Check-in time outside business_date | AlertBanner danger inline; submit disabled |
| User without role tries to open admin modal | UI button not rendered (gated) — no need for server-side double-check (Phase 1 RPC has RLS) |

---

## 7. Vietnamese terminology (preserved)

| Tiếng Việt | Context |
|---|---|
| Đang làm việc | Active employees column heading |
| Chưa vào ca | Inactive employees column heading |
| Vào ca | Check-in button + modal title |
| Ra ca | Check-out button + modal title |
| Lương theo giờ | hourly_rate field label |
| Bồi dưỡng | allowance_amount field label |
| Tổng giờ | minutes display label |
| Lương giờ | base_pay display label |
| Thực nhận | total_pay display label |
| Sửa lượt lương | PayrollEditModal title |
| Thêm nhân viên | Add-employee button |
| Sửa thông tin nhân viên | Edit-employee modal title |
| Lương theo lượt | PayrollHistoryCard title |
| Đã sửa | Edited badge text |
| Đang trong ca / Đã ra ca / Chưa vào | Status badges |
| Vị trí | position field |
| Đang hoạt động | is_active checkbox |
| Tạm dừng nhân viên | (Future: deactivate label — currently is_active toggle) |

---

## 8. Verification strategy

### 8.1 Build verify
`npm run build` must remain clean. `/` route First Load JS expected to grow ~25-35 kB (5 components + 1 mutations hook + 1 primitive + page wire). Total target ~275-285 kB.

### 8.2 Drift assertion scripts (Phase 3A)
Both `tools/verify-role-gate.mjs` and `tools/verify-business-date.mjs` must continue passing. No changes to navigation or datetime expected.

### 8.3 Manual smoke (operator-driven)
After implementation:
1. `docker compose up -d`; login owner (`owner@chill.local` / `chill-owner-2026`).
2. Click "Ca & lương" tab → ShiftsView renders.
3. Empty state (no seeded employees): both columns show empty state; PayrollHistoryCard empty.
4. Click "+ Thêm nhân viên" → EmployeeFormModal opens (create mode) → fill name="Linh", position="Thu ngân", hourly_rate=26000 → submit → toast success → row appears in "Chưa vào ca".
5. Click "Vào ca" on Linh → CheckInModal opens with default time = now → submit → toast → row moves to "Đang làm việc" with "Đang trong ca" badge.
6. Click "Ra ca" on Linh → CheckOutModal opens with startTime=check_in, endTime=now → 3-metric live updates as time changes → set allowance=20000 → submit → toast → row moves back to "Chưa vào ca"; PayrollHistoryCard shows new row with totalPay=basePay+20000.
7. Admin click row in PayrollHistoryCard → PayrollEditModal opens → change allowance to 30000 → save → toast → row shows updated totalPay + "Đã sửa <datetime>" badge.
8. Admin click "Sửa" on employee → EmployeeFormModal opens (edit mode) → toggle is_active off → save → row disappears from grid (since useEmployeesQuery filters is_active=true).
9. Change business-date to yesterday → grid empty (no shifts yesterday); past payroll records if any show in history.
10. TZ edge: change business_date to a date where today's wall-clock VN hour is late (e.g. test at 23:00 VN); check-in default time renders correctly.

```
[ ] All 10 smoke checks pass.
[ ] Failures (if any): _____________
```

### 8.4 Test framework
**Deferred to Phase 3B.2b.** No Vitest/pgTAP in 3B.2a.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `useUpsertEmployee` branching by id presence could call wrong fn (create vs update) | Explicit `if (id)` branch in mutationFn. Test in smoke check #4 (create) + #8 (update). |
| Duration math drift from v3 | Helper inline matches v3 verbatim (Math.max/round same formula). Will get pgTAP coverage in 3B.2b. |
| Default-time logic mishandles UTC rollover | Uses `todayInVN()` from Phase 1 datetime.ts (already TZ-edge tested via verify-business-date.mjs). |
| Stale shift after refetch (e.g., another tab checked-out) | Modal's `useEffect [shift?.id]` reset doesn't help if shift array reference changes but id is same. Same risk as 3B.1 ExpenseEditModal `editingId` stale. Apply same fix: useEffect to clear modal state when expense disappears from array. |
| Validation library mismatch | `validateEmployee` + `validatePayrollEdit` are Phase 1 frozen. Plan task will import from `@/lib/validation` (do NOT redefine). |
| Textarea primitive API drift from TextField | Mirror TextField signature exactly. Code-review check: caller migration from inline `<textarea>` to `<Textarea>` should be trivial swap. |

---

## 10. Definition of Done (Phase 3B.2a)

- [ ] `ShiftsView` mounted; clicking "Ca & lương" nav renders grid + history.
- [ ] Add employee → row appears in "Chưa vào ca".
- [ ] Check-in → row moves to "Đang làm việc"; status badge "Đang trong ca".
- [ ] Check-out → row back to "Chưa vào ca"; payroll row appears with correct totals.
- [ ] Edit payroll (admin only) → totals recompute; "Đã sửa" badge.
- [ ] Edit employee (admin only) → fields update; deactivate hides from grid.
- [ ] Owner + manager can edit employees/payroll; staff_operator cannot see edit/admin buttons.
- [ ] Validation: empty name / out-of-range hourly_rate / end < start time → AlertBanner + Toast.
- [ ] All mutations show loading state on submit button.
- [ ] Phase 3A drift scripts (`verify-role-gate.mjs` + `verify-business-date.mjs`) pass.
- [ ] `npm run build` clean.
- [ ] Code review: spec compliance + code quality both pass.
- [ ] Branch `phase-3b2a-shifts` merged về `main`; tag `v4-phase-3b2a`.

---

## 11. References

- **v3 source** (port-from):
  - `F:\Chill manager\v3\src\features\shifts\shift-panel.tsx` — 401 dòng
  - `F:\Chill manager\v3\src\features\shifts\employee-form-modal.tsx` — 101 dòng
  - `F:\Chill manager\v3\src\features\shifts\payroll-edit-modal.tsx` — 125 dòng
- **Phase 1 (ported, frozen)**:
  - `src/lib/data/shifts.ts` — `loadShiftAssignments`, `checkInEmployee` (RPC), `checkOutEmployee` (RPC), `loadPayrollRecords`, `editPayrollRecord` (RPC)
  - `src/lib/data/employees.ts` — `loadEmployees`, `createEmployee` (direct), `updateEmployee` (direct)
  - `src/lib/validation.ts` — `validateEmployee({name, hourly_rate})`, `validatePayrollEdit({check_in_at, check_out_at, allowance_amount, note})`
  - `src/lib/datetime.ts` — `toDatetimeLocal`, `fromDatetimeLocal`, `todayInVN`
  - `src/lib/format.ts` — `formatNumber`, `formatVND`, `moneyFromInput`, `durationLabel`, `formatDateTime`
  - `src/hooks/queries/use-shift-queries.ts` — `useShiftsQuery`, `usePayrollQuery`, `useEmployeesQuery`
  - `src/hooks/queries/keys.ts` — `queryKeys.shifts(date)`, `payroll(date)`, `employees()`, `dashboard(date)`
- **Phase 2 design system**:
  - `src/components/ui/{card,text-field,checkbox,button,icon-button,modal,alert-banner,toast,empty-state,badge,spinner}.tsx`
  - `src/components/ui/icons.tsx` — `users`, `checkCircle`, `plus`, `save`, `trash` already present from Phase 3A + 3B.1
- **Phase 3A**: `src/app/page.tsx` dispatcher; `src/hooks/{use-business-date,use-role-gate}.ts`
- **Phase 3B.1 patterns**: mutation hooks file structure + Modal compound + form useState + history-card row-click
- **Master plan**: `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md`
