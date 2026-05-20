# Phase 3B.2a — Shifts/Payroll Write Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `view === "shifts"` Phase 3A locked EmptyState with a fully functional ShiftsView — port v3 shift-panel into 7 focused Phase-2-aligned files (~700 LOC) + 5 mutation hooks + a new `<Textarea>` primitive.

**Architecture:** 7 components under `src/features/shifts/` (ShiftsView container → EmployeeGrid + PayrollHistoryCard + 4 modals). 5 mutation hooks co-located in `src/hooks/mutations/use-shift-mutations.ts`. New shared `<Textarea>` primitive (reused later in 3B.2b cash + 3C handover). Server-driven refetch via `queryClient.invalidateQueries` — no optimistic updates. v3 idioms preserved verbatim: first-wins shift-de-dup, default-time logic, `base_pay = round(min × rate / 60 / 1000) × 1000`.

**Tech Stack:** Next.js 15 + React 19 + TypeScript strict + Tailwind v4 + Radix Dialog primitives + TanStack Query 5 + Supabase JS. NO new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-20-v4-phase-3b2a-shifts-design.md`

---

## File Structure

### Created / modified in Phase 3B.2a

```
src/
  app/
    page.tsx                                  [MODIFY — swap shifts EmptyState for ShiftsView]
  features/
    shifts/
      shifts-view.tsx                         [NEW — container, ~150 lines]
      employee-grid.tsx                       [NEW — 2-col grid + row layout]
      payroll-history-card.tsx                [NEW — list + row-click → edit]
      check-in-modal.tsx                      [NEW — datetime + validation]
      check-out-modal.tsx                     [NEW — datetime ×2 + live calc + payout hero]
      employee-form-modal.tsx                 [NEW — port v3 + tokenized]
      payroll-edit-modal.tsx                  [NEW — port v3 + tokenized]
  hooks/
    mutations/
      use-shift-mutations.ts                  [NEW — 5 hooks co-located]
  components/ui/
    textarea.tsx                              [NEW — primitive, reuse downstream]
```

### Untouched (do NOT modify)
- `src/lib/**` (Phase 1 — `lib/data/shifts.ts` + `employees.ts` + `validation.ts` + `datetime.ts` + `format.ts` all frozen)
- `src/hooks/queries/**`, `src/hooks/use-*.ts` (Phase 1 + 3A)
- `src/hooks/mutations/use-expense-mutations.ts` (3B.1, frozen)
- `src/middleware.ts`, `src/app/api/**`, `database/**`
- Phase 2 component bodies (no modifications needed — new Textarea is additive)
- `src/features/{navigation,auth,dashboard,reports,pivot,expenses}/**` (Phase 3A + 3B.1 — frozen)
- `docker-compose.yml`, `supabase/**`, `.env*`

---

## Conventions for this plan

- **Vietnamese UI labels** preserved verbatim per spec §7. Examples: "Vào ca", "Ra ca", "Lương theo giờ", "Bồi dưỡng", "Thực nhận", "Đã sửa", "Sửa lượt lương", "Thêm nhân viên", "Đang trong ca", "Chưa vào".
- **Form validation:** `validateEmployee({name, hourly_rate})` + `validatePayrollEdit({check_in_at, check_out_at, allowance_amount, note})` from `@/lib/validation` (Phase 1, frozen). Result shape `{ ok: true } | { ok: false; field, message }`.
- **TZ guardrail:** ALL datetime fields go through `toDatetimeLocal` / `fromDatetimeLocal` / `todayInVN` from `@/lib/datetime`. Never construct dates inline with `new Date().toISOString()` for `business_date` comparisons.
- **Duration math** verbatim from v3:
  ```ts
  const minutes = Math.max(0, Math.round((endMs - startMs) / 60_000));
  const basePay = Math.round((minutes / 60) * hourly_rate / 1000) * 1000;  // round to 1k VND
  const totalPay = basePay + moneyFromInput(allowance);
  ```
- **Mutations:** TanStack `useMutation` calling Phase 1 `lib/data` fn. Throw `Error("Thiếu cấu hình Supabase.")` when supabase is null. `onSuccess: queryClient.invalidateQueries(...)`. Caller uses `mutateAsync` + try/catch + toast.
- **Modal pattern:** Phase 2 compound — `<Modal open onOpenChange><ModalContent><ModalTitle>…<ModalDescription>…<form/body><ModalActions>…</ModalActions></ModalContent></Modal>`.
- **Each commit ends** with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **PowerShell here-string** for commit messages can break on Vietnamese diacritics — when in doubt, write the message to `.git/COMMIT_MSG_TMP` and `git commit -F .git/COMMIT_MSG_TMP` then `Remove-Item .git/COMMIT_MSG_TMP -Force`.

---

## Tasks overview

| # | Task | Files (new) | Files (modify) | Est. LOC |
|---|---|---|---|---|
| 1 | `<Textarea>` primitive + `useShiftMutations` (5 hooks) | 2 | 0 | ~180 |
| 2 | `EmployeeFormModal` (simplest, no derived calcs) | 1 | 0 | ~150 |
| 3 | `CheckInModal` (datetime + default-time + validation) | 1 | 0 | ~140 |
| 4 | `CheckOutModal` (datetime×2 + live duration/payroll calc + payout hero) | 1 | 0 | ~210 |
| 5 | `PayrollEditModal` (mirrors CheckOutModal shape, edit) | 1 | 0 | ~190 |
| 6 | `EmployeeGrid` + `PayrollHistoryCard` (display components) | 2 | 0 | ~230 |
| 7 | `ShiftsView` + `page.tsx` wire | 1 | 1 | ~180 |
| 8 | Smoke verify + tag `v4-phase-3b2a` | 0 | 0 | ~0 |

Total: 9 new files + 1 modify (page.tsx) across 8 tasks. ~1,280 LOC.

---

## Task 1: `<Textarea>` primitive + `useShiftMutations` hook

**Files:**
- Create: `src/components/ui/textarea.tsx`
- Create: `src/hooks/mutations/use-shift-mutations.ts`

**Why this first:** Foundation. Three of the four modals (CheckOutModal, PayrollEditModal, EmployeeFormModal note field) consume `<Textarea>`. All five modals consume `useShiftMutations`. Landing them as foundation prevents downstream tasks from each adding a primitive/hook patch.

### Step 1.1 — Create `<Textarea>` primitive

- [ ] **Create `src/components/ui/textarea.tsx`.**

```tsx
"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
}

/**
 * Textarea primitive — mirrors TextField API (label, helper, error + standard
 * HTML textarea props). Used in shifts (check-out note, payroll-edit note),
 * 3B.2b cash (note), 3C handover (note). API mirror of TextField means
 * caller learning curve = 0.
 */
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

### Step 1.2 — Create `useShiftMutations` (5 hooks)

- [ ] **Create `src/hooks/mutations/use-shift-mutations.ts`.**

```ts
"use client";

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

/**
 * Mutation hooks for the shifts module (Phase 3B.2a).
 *
 * Co-located in one file because they share the same invalidation idioms
 * (shifts/payroll/dashboard for date-scoped; employees() for ref data).
 *
 * No optimistic updates — every mutation invalidates the relevant queries
 * on success, triggering a refetch. Simple, predictable, no rollback
 * complexity. Phase 6 may add optimism if measurements show a need.
 *
 * Caller pattern:
 *   const checkIn = useCheckIn(supabase, businessDate);
 *   try {
 *     await checkIn.mutateAsync({ employee_id, business_date, check_in_at });
 *     toast({ semantic: "success", message: "Đã vào ca." });
 *   } catch (err) {
 *     toast({ semantic: "danger", message: err.message });
 *   }
 */

export interface CheckInInput {
  employee_id: string;
  business_date: string;
  /** Naive datetime-local string (VN wall-clock, NOT UTC). */
  check_in_at: string;
}

export function useCheckIn(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CheckInInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return checkInEmployee(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
    },
  });
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

export function useCheckOut(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CheckOutInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return checkOutEmployee(supabase, input as unknown as Record<string, unknown>);
    },
    // Check-out closes a shift AND creates payroll_record AND affects
    // dashboard (active_staff drops, payroll_paid increases).
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface UpdatePayrollInput {
  payroll_record_id: string;
  check_in_at: string;
  check_out_at: string;
  allowance_amount: number;
  note: string;
}

export function useUpdatePayrollRecord(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdatePayrollInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return editPayrollRecord(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export interface UpsertEmployeeInput {
  /** Set to existing id for update; omit for create. */
  id?: string;
  name: string;
  position: string;
  hourly_rate: number;
  is_active: boolean;
}

export function useUpsertEmployee(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertEmployeeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      // Branch by id presence — Phase 1 employees.ts has separate
      // createEmployee + updateEmployee functions.
      const payload = {
        name: input.name,
        position: input.position,
        hourly_rate: input.hourly_rate,
        is_active: input.is_active,
      };
      if (input.id) {
        return updateEmployee(supabase, input.id, payload);
      }
      return createEmployee(supabase, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.employees() });
    },
  });
}

export function useDeactivateEmployee(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (employeeId: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateEmployee(supabase, employeeId, { is_active: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.employees() });
    },
  });
}
```

### Step 1.3 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean compile, no new TypeScript errors. Tree-shaking keeps the new exports out of bundles until components import them.

### Step 1.4 — Commit

- [ ] **Commit Task 1.**

Write commit message to `.git/COMMIT_MSG_TMP`:

```
feat(phase-3b2a): Textarea primitive + useShiftMutations hook

- Create src/components/ui/textarea.tsx — primitive mirroring TextField
  API (label, helper, error + textarea HTML props). Used downstream in
  shifts notes (3B.2a) + cash notes (3B.2b) + handover (3C).
- Create src/hooks/mutations/use-shift-mutations.ts with 5 TanStack
  mutation hooks: useCheckIn, useCheckOut, useUpdatePayrollRecord,
  useUpsertEmployee, useDeactivateEmployee.
- Each mutation invalidates relevant query keys on success
  (shifts + payroll + dashboard for write paths; employees() for ref data).
  No optimistic updates.
- useUpsertEmployee branches by id presence (create vs update) — Phase 1
  lib/data/employees.ts has separate fns; this hook unifies them.
- useDeactivateEmployee = updateEmployee with is_active=false (soft delete).
- Throws "Thiếu cấu hình Supabase." if supabase is null in mutationFn.

No runtime UI change yet; foundation for Tasks 2-7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then:

```powershell
git add src/components/ui/textarea.tsx src/hooks/mutations/use-shift-mutations.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 2: `EmployeeFormModal`

**Files:**
- Create: `src/features/shifts/employee-form-modal.tsx`

**Why second:** Simplest modal — single form, no derived calcs, no nested modals. Validates the Phase 2 Modal compound + form pattern + `useUpsertEmployee` mutation before bigger modals depend on the same patterns.

### Step 2.1 — Create the component

- [ ] **Create `src/features/shifts/employee-form-modal.tsx`.**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpsertEmployee } from "@/hooks/mutations/use-shift-mutations";
import { formatNumber, moneyFromInput } from "@/lib/format";
import { validateEmployee } from "@/lib/validation";
import type { Employee } from "@/lib/types";

interface EmployeeFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** null = create mode; non-null = edit mode. */
  employee: Employee | null;
}

/**
 * Create/edit employee modal. Owner/manager only (gated by parent).
 *
 * Create mode (employee === null): default name="", position="",
 * hourly_rate="", is_active=true. Submit creates new employees row.
 *
 * Edit mode (employee !== null): pre-fill from employee fields. is_active
 * checkbox shown. Submit calls updateEmployee.
 *
 * useUpsertEmployee from use-shift-mutations branches by id presence.
 */
export function EmployeeFormModal({
  open,
  onOpenChange,
  employee,
}: EmployeeFormModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const upsertEmployeeM = useUpsertEmployee(supabase);

  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  // Reset state when modal opens (or employee changes).
  useEffect(() => {
    if (!open) return;
    setName(employee?.name ?? "");
    setPosition(employee?.position ?? "");
    setHourlyRate(employee?.hourly_rate ? formatNumber(employee.hourly_rate) : "");
    setIsActive(employee?.is_active ?? true);
    setFieldError(null);
  }, [employee, open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateEmployee({
      name,
      hourly_rate: moneyFromInput(hourlyRate),
    });
    if (!validation.ok) {
      setFieldError({ field: validation.field, message: validation.message });
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    setFieldError(null);
    try {
      await upsertEmployeeM.mutateAsync({
        id: employee?.id,
        name: name.trim(),
        position: position.trim(),
        hourly_rate: moneyFromInput(hourlyRate),
        is_active: isActive,
      });
      toast({
        semantic: "success",
        message: employee ? "Đã cập nhật nhân viên." : "Đã thêm nhân viên mới.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được nhân viên.",
      });
    }
  }

  const isBusy = upsertEmployeeM.isPending;
  const isEditMode = employee !== null;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>
          {isEditMode ? "Sửa thông tin nhân viên" : "Thêm nhân viên mới"}
        </ModalTitle>
        <ModalDescription>
          {isEditMode
            ? "Cập nhật tên, vị trí, lương theo giờ, trạng thái hoạt động."
            : "Nhập thông tin để thêm nhân viên vào danh sách hoạt động."}
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên nhân viên"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Lan"
            required
            autoFocus
            disabled={isBusy}
          />
          <TextField
            label="Vị trí"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="Ví dụ: Thu ngân"
            disabled={isBusy}
          />
          <TextField
            label="Lương theo giờ"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            inputMode="numeric"
            placeholder="26000"
            disabled={isBusy}
          />
          {isEditMode && (
            <Checkbox
              label="Đang hoạt động"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
              disabled={isBusy}
            />
          )}
          {fieldError && (
            <AlertBanner variant="danger">{fieldError.message}</AlertBanner>
          )}
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={!name.trim()}
            >
              {isEditMode ? "Lưu thay đổi" : "Thêm nhân viên"}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

### Step 2.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean. No bundle impact (no consumer yet).

### Step 2.3 — Commit

- [ ] **Commit Task 2.**

Commit message file content:

```
feat(phase-3b2a): EmployeeFormModal

Phase 2 Modal compound + TextField + Checkbox + Button. Single form, no
derived calculations, no nested modals. Validates via Phase 1
validateEmployee before useUpsertEmployee.mutateAsync.

Create mode: defaults (empty fields, is_active=true; checkbox not shown).
Edit mode: pre-fill from employee prop, is_active checkbox visible.

Reset state on open via useEffect keyed on [employee, open].

useUpsertEmployee branches by id presence (create vs update). Mutation
invalidates queryKeys.employees() — useEmployeesQuery refetches.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/shifts/employee-form-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 3: `CheckInModal`

**Files:**
- Create: `src/features/shifts/check-in-modal.tsx`

**Why third:** Validates default-time logic + datetime-local input + business-date validation pattern. Shorter than CheckOut/PayrollEdit (no derived calcs).

### Step 3.1 — Create the component

- [ ] **Create `src/features/shifts/check-in-modal.tsx`.**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCheckIn } from "@/hooks/mutations/use-shift-mutations";
import { fromDatetimeLocal, toDatetimeLocal, todayInVN } from "@/lib/datetime";
import { formatVND } from "@/lib/format";
import type { Employee } from "@/lib/types";

interface CheckInModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  employee: Employee | null;
  businessDate: string;
}

/**
 * Default time cho check-in modal.
 * - business_date = hôm nay (giờ VN) → now
 * - business_date khác → 08:00 ngày đó (đầu ca mặc định)
 *
 * Uses todayInVN() — not new Date().toISOString().slice(0,10) — to avoid
 * UTC-rollover bug (UTC date != VN date after 17:00 UTC).
 */
function defaultCheckInTime(businessDate: string): string {
  if (todayInVN() === businessDate) {
    return toDatetimeLocal(new Date().toISOString());
  }
  return `${businessDate}T08:00`;
}

/** Validate: giờ check-in phải trong cùng business_date. */
function isCheckInTimeValid(checkIn: string, businessDate: string): boolean {
  if (!checkIn) return false;
  return checkIn.slice(0, 10) === businessDate;
}

/**
 * Check-in modal. Sets shift_assignment status=checked_in via
 * check_in_employee RPC. Allows operator to override the time before
 * confirming (e.g., employee forgot to check in at start of shift).
 */
export function CheckInModal({
  open,
  onOpenChange,
  employee,
  businessDate,
}: CheckInModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const checkInM = useCheckIn(supabase, businessDate);
  const [checkInTime, setCheckInTime] = useState("");

  // Reset to default time when modal opens (or employee changes).
  useEffect(() => {
    if (open && employee) {
      setCheckInTime(defaultCheckInTime(businessDate));
    }
  }, [open, employee?.id, businessDate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!employee) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const timeValid = isCheckInTimeValid(checkInTime, businessDate);
  const isBusy = checkInM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee || !timeValid || isBusy) return;
    try {
      await checkInM.mutateAsync({
        employee_id: employee.id,
        business_date: businessDate,
        check_in_at: fromDatetimeLocal(checkInTime) ?? "",
      });
      toast({ semantic: "success", message: `${employee.name} đã vào ca.` });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không vào ca được.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{employee.name}</ModalTitle>
        <ModalDescription>
          Vào ca · {employee.position ?? "Nhân viên"} ·{" "}
          {formatVND(employee.hourly_rate)}/giờ
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Giờ vào ca"
            type="datetime-local"
            value={checkInTime}
            onChange={(e) => setCheckInTime(e.target.value)}
            disabled={isBusy}
            autoFocus
            helper={`Mặc định là giờ hiện tại. Phải nằm trong ngày ${businessDate}.`}
          />
          {checkInTime && !timeValid && (
            <AlertBanner variant="danger">
              Giờ vào ca phải nằm trong ngày {businessDate}.
            </AlertBanner>
          )}
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={!timeValid}
            >
              Xác nhận vào ca
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

### Step 3.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 3.3 — Commit

- [ ] **Commit Task 3.**

Commit message:

```
feat(phase-3b2a): CheckInModal

Phase 2 Modal compound + TextField (datetime-local) + AlertBanner + Button.
Owns datetime state; resets to default-time on open.

Default-time helpers:
- defaultCheckInTime(businessDate): today VN -> now, else -> 08:00 of date.
- isCheckInTimeValid(checkIn, businessDate): date prefix matches.

Uses todayInVN() from lib/datetime (Phase 1) to avoid UTC-rollover bug.
Validates check-in time falls within business_date; AlertBanner shown
when invalid; submit disabled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/shifts/check-in-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 4: `CheckOutModal`

**Files:**
- Create: `src/features/shifts/check-out-modal.tsx`

**Why fourth:** First modal with derived calculations (minutes, basePay, totalPay). Validates the live-calc + payout-hero pattern. PayrollEditModal (Task 5) shares this exact pattern.

### Step 4.1 — Create the component

- [ ] **Create `src/features/shifts/check-out-modal.tsx`.**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCheckOut } from "@/hooks/mutations/use-shift-mutations";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { durationLabel, formatVND, moneyFromInput } from "@/lib/format";
import type { Employee, ShiftAssignment } from "@/lib/types";

interface CheckOutModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shift: ShiftAssignment | null;
  employee: Employee | null;
  businessDate: string;
}

/**
 * Check-out modal. Closes a shift_assignment (status=checked_out) AND
 * creates a payroll_record snapshot via check_out_employee RPC.
 *
 * Live derived (useMemo):
 *   minutes   = max(0, round((endMs - startMs) / 60_000))
 *   basePay   = round((minutes / 60) * hourly_rate / 1000) * 1000  // 1k VND
 *   totalPay  = basePay + moneyFromInput(allowance)
 *
 * invalidTime = startTime && endTime && endTimeMs < startTimeMs
 *   - render AlertBanner danger when true
 *   - submit disabled when true
 */
export function CheckOutModal({
  open,
  onOpenChange,
  shift,
  employee,
  businessDate,
}: CheckOutModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const checkOutM = useCheckOut(supabase, businessDate);

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowance, setAllowance] = useState("0");
  const [note, setNote] = useState("");

  // Reset state when modal opens with a new shift.
  useEffect(() => {
    if (open && shift) {
      setStartTime(toDatetimeLocal(shift.check_in_at ?? new Date().toISOString()));
      setEndTime(toDatetimeLocal(new Date().toISOString()));
      setAllowance("0");
      setNote("");
    }
  }, [open, shift?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    return Math.max(0, Math.round((endMs - startMs) / 60_000));
  }, [startTime, endTime]);

  const basePay = useMemo(() => {
    if (!employee) return 0;
    return Math.round(((minutes / 60) * employee.hourly_rate) / 1000) * 1000;
  }, [minutes, employee]);

  const allowanceAmount = moneyFromInput(allowance);
  const totalPay = basePay + allowanceAmount;
  const invalidTime = Boolean(
    startTime && endTime && new Date(endTime).getTime() < new Date(startTime).getTime()
  );

  if (!shift || !employee) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const isBusy = checkOutM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shift || !employee || invalidTime || isBusy) return;
    try {
      await checkOutM.mutateAsync({
        shift_assignment_id: shift.id,
        employee_id: shift.employee_id,
        business_date: businessDate,
        check_in_at: fromDatetimeLocal(startTime) ?? "",
        check_out_at: fromDatetimeLocal(endTime) ?? "",
        allowance_amount: allowanceAmount,
        note: note.trim(),
      });
      toast({ semantic: "success", message: "Đã ra ca và lưu lương theo lượt." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không ra ca được.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{employee.name}</ModalTitle>
        <ModalDescription>
          Xác nhận ra ca · {formatVND(employee.hourly_rate)}/giờ
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Giờ vào"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={isBusy}
            />
            <TextField
              label="Giờ ra"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={isBusy}
            />
          </div>
          {invalidTime && (
            <AlertBanner variant="danger">
              Giờ ra không được nhỏ hơn giờ vào.
            </AlertBanner>
          )}
          {/* 3-metric mini-grid */}
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-muted p-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Tổng giờ</p>
              <strong className="block font-display text-base text-ink">
                {durationLabel(minutes)}
              </strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Lương giờ</p>
              <strong className="block font-display text-base text-ink">
                {formatVND(basePay)}
              </strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Thực nhận</p>
              <strong className="block font-display text-base text-ink">
                {formatVND(totalPay)}
              </strong>
            </div>
          </div>
          {/* Payout hero — visually prominent */}
          <div className="rounded-lg bg-mint p-4 text-mint-ink">
            <p className="text-xs uppercase tracking-wide opacity-80">
              Tổng thực nhận ca này
            </p>
            <strong className="block font-display text-2xl">
              {formatVND(totalPay)}
            </strong>
          </div>
          <TextField
            label="Bồi dưỡng"
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            inputMode="numeric"
            disabled={isBusy}
          />
          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Lý do chỉnh giờ hoặc bồi dưỡng..."
            rows={2}
            disabled={isBusy}
          />
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={invalidTime}
            >
              Xác nhận ra ca
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

### Step 4.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 4.3 — Commit

- [ ] **Commit Task 4.**

```
feat(phase-3b2a): CheckOutModal

Phase 2 Modal + 2× TextField (datetime-local) + Textarea + Button +
AlertBanner. Live-derived (useMemo): minutes, basePay, totalPay.
Round-to-1k VND base_pay formula preserved verbatim from v3.

invalidTime when end < start: AlertBanner danger + submit disabled.

Layout: grid 2-col time inputs, 3-metric mini-grid showing tổng giờ /
lương giờ / thực nhận, payout hero (mint bg) showing total prominently,
bồi dưỡng + ghi chú below.

useCheckOut invalidates shifts + payroll + dashboard (active_staff +
payroll_paid both change).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/shifts/check-out-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 5: `PayrollEditModal`

**Files:**
- Create: `src/features/shifts/payroll-edit-modal.tsx`

**Why fifth:** Mirrors CheckOutModal shape (same derived calcs + same layout) but edits an existing payroll_record via `edit_shift_payroll_record` RPC. Reusing the proven pattern from Task 4.

### Step 5.1 — Create the component

- [ ] **Create `src/features/shifts/payroll-edit-modal.tsx`.**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdatePayrollRecord } from "@/hooks/mutations/use-shift-mutations";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { durationLabel, formatNumber, formatVND, moneyFromInput } from "@/lib/format";
import { validatePayrollEdit } from "@/lib/validation";
import type { PayrollRecord } from "@/lib/types";

interface PayrollEditModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  payroll: PayrollRecord | null;
}

/**
 * Edit a payroll_record (owner/manager only, gated by parent).
 *
 * Same live-derived shape as CheckOutModal — minutes / basePay / totalPay
 * recompute as user adjusts start/end/allowance. validatePayrollEdit
 * enforces server-side parity (check_out >= check_in, allowance in range).
 *
 * useUpdatePayrollRecord invalidates payroll(date) + dashboard(date)
 * (payroll_paid total changes when total_pay changes).
 */
export function PayrollEditModal({
  open,
  onOpenChange,
  payroll,
}: PayrollEditModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  // payroll?.business_date threaded through useUpdatePayrollRecord — Phase 1
  // payroll record has business_date field; same as the day being edited.
  const updateM = useUpdatePayrollRecord(supabase, payroll?.business_date ?? "");

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowance, setAllowance] = useState("0");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Reset state when modal opens with a new payroll record.
  useEffect(() => {
    if (open && payroll) {
      setStartTime(toDatetimeLocal(payroll.check_in_at));
      setEndTime(toDatetimeLocal(payroll.check_out_at));
      setAllowance(formatNumber(payroll.allowance_amount));
      setNote(payroll.note ?? "");
      setFieldError(null);
    }
  }, [open, payroll?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    return Math.max(0, Math.round((endMs - startMs) / 60_000));
  }, [startTime, endTime]);

  const basePay = useMemo(() => {
    if (!payroll) return 0;
    return Math.round(((minutes / 60) * payroll.hourly_rate) / 1000) * 1000;
  }, [minutes, payroll]);

  const allowanceAmount = moneyFromInput(allowance);
  const totalPay = basePay + allowanceAmount;
  const invalidTime = Boolean(
    startTime && endTime && new Date(endTime).getTime() < new Date(startTime).getTime()
  );

  if (!payroll) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const isBusy = updateM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payroll || invalidTime || isBusy) return;
    const validation = validatePayrollEdit({
      check_in_at: fromDatetimeLocal(startTime),
      check_out_at: fromDatetimeLocal(endTime),
      allowance_amount: allowanceAmount,
      note,
    });
    if (!validation.ok) {
      setFieldError(validation.message);
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    setFieldError(null);
    try {
      await updateM.mutateAsync({
        payroll_record_id: payroll.id,
        check_in_at: fromDatetimeLocal(startTime) ?? "",
        check_out_at: fromDatetimeLocal(endTime) ?? "",
        allowance_amount: allowanceAmount,
        note: note.trim(),
      });
      toast({ semantic: "success", message: "Đã cập nhật lượt lương đã chốt." });
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Không sửa được lượt lương.";
      setFieldError(message);
      toast({ semantic: "danger", message });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{payroll.employee_name ?? "Nhân viên"}</ModalTitle>
        <ModalDescription>Sửa lượt lương</ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Giờ vào"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={isBusy}
            />
            <TextField
              label="Giờ ra"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={isBusy}
            />
          </div>
          {invalidTime && (
            <AlertBanner variant="danger">
              Giờ ra không được nhỏ hơn giờ vào.
            </AlertBanner>
          )}
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-muted p-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Tổng giờ</p>
              <strong className="block font-display text-base text-ink">
                {durationLabel(minutes)}
              </strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Lương giờ</p>
              <strong className="block font-display text-base text-ink">
                {formatVND(basePay)}
              </strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Thực nhận</p>
              <strong className="block font-display text-base text-ink">
                {formatVND(totalPay)}
              </strong>
            </div>
          </div>
          <div className="rounded-lg bg-mint p-4 text-mint-ink">
            <p className="text-xs uppercase tracking-wide opacity-80">
              Tổng thực nhận sau chỉnh sửa
            </p>
            <strong className="block font-display text-2xl">
              {formatVND(totalPay)}
            </strong>
          </div>
          <TextField
            label="Bồi dưỡng"
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            inputMode="numeric"
            disabled={isBusy}
          />
          <Textarea
            label="Ghi chú chỉnh sửa"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Lý do chỉnh giờ, bồi dưỡng hoặc ghi chú ca..."
            rows={2}
            disabled={isBusy}
          />
          {fieldError && (
            <AlertBanner variant="danger">{fieldError}</AlertBanner>
          )}
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={invalidTime}
            >
              Lưu chỉnh sửa
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

### Step 5.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 5.3 — Commit

- [ ] **Commit Task 5.**

```
feat(phase-3b2a): PayrollEditModal

Mirror of CheckOutModal shape (same live-derived minutes/basePay/totalPay)
but for editing an existing payroll_record. Pre-fills from payroll prop;
validates via validatePayrollEdit from lib/validation.

Threads payroll.business_date into useUpdatePayrollRecord(date) so
invalidation hits the right date scope.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/shifts/payroll-edit-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 6: `EmployeeGrid` + `PayrollHistoryCard`

**Files:**
- Create: `src/features/shifts/employee-grid.tsx`
- Create: `src/features/shifts/payroll-history-card.tsx`

**Why together:** Both are pure prop-driven display components with similar concerns (list rendering + role-gated row actions). Sharing the row-click pattern proven in 3B.1 ExpenseHistoryCard.

### Step 6.1 — Create `EmployeeGrid`

- [ ] **Create `src/features/shifts/employee-grid.tsx`.**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Employee, ShiftAssignment } from "@/lib/types";

interface EmployeeGridProps {
  employees: ReadonlyArray<Employee>;
  /** Map of employee_id -> most-recent shift today (first-wins). */
  shiftByEmployee: ReadonlyMap<string, ShiftAssignment>;
  canManage: boolean;
  onCheckIn(employee: Employee): void;
  onCheckOut(shift: ShiftAssignment): void;
  onEditEmployee(employee: Employee): void;
}

function statusBadge(status: ShiftAssignment["status"] | undefined) {
  if (status === "checked_in") {
    return <Badge variant="soft" semantic="success">Đang trong ca</Badge>;
  }
  if (status === "checked_out") {
    return <Badge variant="soft" semantic="neutral">Đã ra ca</Badge>;
  }
  return <Badge variant="soft" semantic="warning">Chưa vào</Badge>;
}

/**
 * 2-col grid of employees: "Đang làm việc" (checked-in) on left,
 * "Chưa vào ca" (everyone else, including checked_out) on right.
 *
 * Each row: name + position + hourly_rate left, status badge + role-gated
 * action buttons right.
 *
 * Pure prop-driven; parent owns all modal state. Buttons emit callbacks.
 */
export function EmployeeGrid({
  employees,
  shiftByEmployee,
  canManage,
  onCheckIn,
  onCheckOut,
  onEditEmployee,
}: EmployeeGridProps) {
  const active = employees.filter(
    (emp) => shiftByEmployee.get(emp.id)?.status === "checked_in"
  );
  const inactive = employees.filter(
    (emp) => shiftByEmployee.get(emp.id)?.status !== "checked_in"
  );

  function renderRow(employee: Employee) {
    const shift = shiftByEmployee.get(employee.id);
    const isIn = shift?.status === "checked_in";
    return (
      <article
        key={employee.id}
        className={cn(
          "flex items-center justify-between gap-3 rounded-md border border-border bg-surface p-3 transition-colors",
          "hover:border-border-strong"
        )}
      >
        <div className="min-w-0">
          <strong className="block truncate text-sm font-semibold text-ink">
            {employee.name}
          </strong>
          <span className="text-xs text-muted">
            {employee.position ?? "Nhân viên"} ·{" "}
            {formatVND(employee.hourly_rate)}/giờ
          </span>
        </div>
        <div className="flex items-center gap-2">
          {statusBadge(shift?.status)}
          {canManage && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onEditEmployee(employee)}
            >
              Sửa
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onCheckIn(employee)}
            disabled={isIn}
          >
            Vào ca
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => shift && onCheckOut(shift)}
            disabled={!shift || !isIn}
          >
            Ra ca
          </Button>
        </div>
      </article>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Đang làm việc</CardTitle>
        </CardHeader>
        <CardBody>
          {active.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có ai đang làm"
              subtitle="Nhấn 'Vào ca' ở cột bên cạnh khi nhân viên bắt đầu làm."
            />
          ) : (
            <div className="space-y-2">{active.map(renderRow)}</div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Chưa vào ca</CardTitle>
        </CardHeader>
        <CardBody>
          {inactive.length === 0 ? (
            <EmptyState
              icon="checkCircle"
              title="Tất cả đã vào ca"
              subtitle="Không còn nhân viên chờ xác nhận."
            />
          ) : (
            <div className="space-y-2">{inactive.map(renderRow)}</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

### Step 6.2 — Create `PayrollHistoryCard`

- [ ] **Create `src/features/shifts/payroll-history-card.tsx`.**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatVND, durationLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PayrollRecord } from "@/lib/types";

interface PayrollHistoryCardProps {
  payroll: ReadonlyArray<PayrollRecord>;
  canManage: boolean;
  onEditRow(payroll: PayrollRecord): void;
}

/**
 * List of today's payroll records. Pure prop-driven (no own queries).
 *
 * Rows clickable for owner/manager only — staff_operator sees static
 * rows. Pattern matches ExpenseHistoryCard (3B.1).
 *
 * Row shows: employee name (truncate), duration + allowance + edited
 * badge if edited_at, total_pay right-aligned.
 *
 * Stale-row guard via useEffect (matches 3B.1 ExpenseHistoryCard fix):
 * if editingId was set and the row disappears from the array (e.g. delete
 * from another tab), reset editingId so the modal closes cleanly.
 */
export function PayrollHistoryCard({
  payroll,
  canManage,
  onEditRow,
}: PayrollHistoryCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId
    ? payroll.find((p) => p.id === editingId) ?? null
    : null;

  // Stale-row guard: if a refresh removes the row being edited, clear.
  useEffect(() => {
    if (editingId && !editing) setEditingId(null);
  }, [editingId, editing]);

  function open(p: PayrollRecord) {
    if (!canManage) return;
    setEditingId(p.id);
    onEditRow(p);
  }

  const total = payroll.reduce((sum, row) => sum + row.total_pay, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Lương theo lượt</CardTitle>
          <strong className="font-display text-base text-ink">
            {formatVND(total)}
          </strong>
        </div>
      </CardHeader>
      <CardBody>
        {payroll.length === 0 ? (
          <EmptyState
            icon="users"
            title="Chưa có dòng lương"
            subtitle="Khi xác nhận ra ca, dòng lương mới sẽ nằm trên cùng."
          />
        ) : (
          <ul className="divide-y divide-border">
            {payroll.map((row) => (
              <li
                key={row.id}
                onClick={canManage ? () => open(row) : undefined}
                onKeyDown={
                  canManage
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          open(row);
                        }
                      }
                    : undefined
                }
                tabIndex={canManage ? 0 : undefined}
                role={canManage ? "button" : undefined}
                aria-label={canManage ? `Sửa lượt lương ${row.employee_name ?? ""}` : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 py-3 px-2 -mx-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
                  canManage && "cursor-pointer hover:bg-surface-muted"
                )}
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-ink">
                    {row.employee_name ?? "Nhân viên"}
                  </strong>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{durationLabel(row.total_minutes)}</span>
                    <span>·</span>
                    <span>Bồi dưỡng {formatVND(row.allowance_amount)}</span>
                    {row.edited_at && (
                      <Badge variant="soft" semantic="warning">
                        Đã sửa {formatDateTime(row.edited_at)}
                      </Badge>
                    )}
                  </div>
                </div>
                <strong className="shrink-0 font-display text-sm text-ink">
                  {formatVND(row.total_pay)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
```

### Step 6.3 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean.

### Step 6.4 — Commit

- [ ] **Commit Task 6.**

```
feat(phase-3b2a): EmployeeGrid + PayrollHistoryCard

EmployeeGrid: 2-col grid (Đang làm việc | Chưa vào ca) of pure prop-driven
employee rows. Status badge per shift state. Role-gated action buttons
(Sửa for admin; Vào ca / Ra ca for all, disabled per state).

PayrollHistoryCard: list of payroll_records of the day. Row click for
owner/manager only (matches 3B.1 ExpenseHistoryCard pattern). "Đã sửa
<datetime>" warning badge when edited_at is set. Stale-row guard via
useEffect clears editingId if the row disappears from the array.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/shifts/employee-grid.tsx src/features/shifts/payroll-history-card.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 7: `ShiftsView` + wire into `page.tsx`

**Files:**
- Create: `src/features/shifts/shifts-view.tsx`
- Modify: `src/app/page.tsx` (swap the 3B.2 locked EmptyState for `<ShiftsView />`)

**Why seventh:** Container assembles all 6 children (Tasks 2-6). Wiring into page.tsx completes the user-visible path.

### Step 7.1 — Create `ShiftsView`

- [ ] **Create `src/features/shifts/shifts-view.tsx`.**

```tsx
"use client";

import { useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useEmployeesQuery,
  useShiftsQuery,
  usePayrollQuery,
} from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { IconButton } from "@/components/ui/icon-button";
import type {
  Employee,
  PayrollRecord,
  ShiftAssignment,
  UserRole,
} from "@/lib/types";
import { EmployeeGrid } from "./employee-grid";
import { PayrollHistoryCard } from "./payroll-history-card";
import { CheckInModal } from "./check-in-modal";
import { CheckOutModal } from "./check-out-modal";
import { EmployeeFormModal } from "./employee-form-modal";
import { PayrollEditModal } from "./payroll-edit-modal";

interface ShiftsViewProps {
  businessDate: string;
  role: UserRole;
}

/**
 * Top-level container for view === "shifts". Mounts 3 queries
 * (employees + shifts + payroll) and composes EmployeeGrid +
 * PayrollHistoryCard + 4 modals.
 *
 * Owns all modal state — children emit callbacks. Computes
 * shiftByEmployee map (first-wins reduce to preserve v3 part-time
 * idiom where one employee can have multiple shifts/day).
 */
export function ShiftsView({ businessDate, role }: ShiftsViewProps) {
  const supabase = useSupabase();
  const employeesQuery = useEmployeesQuery(supabase, true);
  const shiftsQuery = useShiftsQuery(supabase, businessDate, true);
  const payrollQuery = usePayrollQuery(supabase, businessDate, true);

  const canManage = role === "owner" || role === "manager";

  // Modal state (5 separate slots — only one is non-null at a time,
  // but separate state lets each modal's own useEffect drive resets).
  const [checkInTarget, setCheckInTarget] = useState<Employee | null>(null);
  const [checkOutTarget, setCheckOutTarget] = useState<ShiftAssignment | null>(null);
  const [editingPayroll, setEditingPayroll] = useState<PayrollRecord | null>(null);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [showCreateEmployee, setShowCreateEmployee] = useState(false);

  if (
    employeesQuery.isLoading ||
    shiftsQuery.isLoading ||
    payrollQuery.isLoading
  ) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (shiftsQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được danh sách ca">
        {shiftsQuery.error instanceof Error
          ? shiftsQuery.error.message
          : String(shiftsQuery.error)}
      </AlertBanner>
    );
  }

  if (payrollQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được lương theo ca">
        {payrollQuery.error instanceof Error
          ? payrollQuery.error.message
          : String(payrollQuery.error)}
      </AlertBanner>
    );
  }

  const employees = employeesQuery.data ?? [];
  const shifts = shiftsQuery.data ?? [];
  const payroll = payrollQuery.data ?? [];

  // First-wins reduce: shifts come pre-sorted DESC by check_in_at from
  // loadShiftAssignments. Part-time employees may have multiple shifts
  // per day — first-wins preserves the MOST RECENT shift per employee
  // (the one currently active or just closed). Map(...) would last-wins
  // and keep the OLDEST shift, breaking the status badge.
  const shiftByEmployee = shifts.reduce((map, shift) => {
    if (!map.has(shift.employee_id)) map.set(shift.employee_id, shift);
    return map;
  }, new Map<string, ShiftAssignment>());

  // Find the Employee object for the current check-out target — needed by
  // CheckOutModal for hourly_rate (basePay calc).
  const checkOutEmployee = checkOutTarget
    ? employees.find((e) => e.id === checkOutTarget.employee_id) ?? null
    : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Tác nghiệp ca
          </p>
          <h2 className="font-display text-2xl text-ink">Nhân viên hôm nay</h2>
        </div>
        {canManage && (
          <IconButton
            icon="plus"
            size={40}
            variant="primary"
            aria-label="Thêm nhân viên"
            onClick={() => setShowCreateEmployee(true)}
          />
        )}
      </div>
      <EmployeeGrid
        employees={employees}
        shiftByEmployee={shiftByEmployee}
        canManage={canManage}
        onCheckIn={setCheckInTarget}
        onCheckOut={setCheckOutTarget}
        onEditEmployee={setEditingEmployee}
      />
      <PayrollHistoryCard
        payroll={payroll}
        canManage={canManage}
        onEditRow={setEditingPayroll}
      />
      {/* Modals */}
      <CheckInModal
        open={checkInTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCheckInTarget(null);
        }}
        employee={checkInTarget}
        businessDate={businessDate}
      />
      <CheckOutModal
        open={checkOutTarget !== null}
        onOpenChange={(next) => {
          if (!next) setCheckOutTarget(null);
        }}
        shift={checkOutTarget}
        employee={checkOutEmployee}
        businessDate={businessDate}
      />
      <EmployeeFormModal
        open={showCreateEmployee || editingEmployee !== null}
        onOpenChange={(next) => {
          if (!next) {
            setShowCreateEmployee(false);
            setEditingEmployee(null);
          }
        }}
        employee={editingEmployee}
      />
      <PayrollEditModal
        open={editingPayroll !== null}
        onOpenChange={(next) => {
          if (!next) setEditingPayroll(null);
        }}
        payroll={editingPayroll}
      />
    </div>
  );
}
```

### Step 7.2 — Wire into `src/app/page.tsx`

- [ ] **Modify `src/app/page.tsx`.**

Two changes:

1. **Add the import** near other feature imports (alphabetical — between `ReportsView` and `PivotView` if present; or wherever the feature imports cluster lives):

```tsx
import { ShiftsView } from "@/features/shifts/shifts-view";
```

2. **Replace the locked EmptyState block** for the `shifts` view.

Find:

```tsx
        {(view === "shifts" || view === "cash") && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3B.2"
            subtitle="Ca & lương / Chốt két sẽ port ở phase tới."
          />
        )}
```

Replace with:

```tsx
        {view === "shifts" && (
          <ShiftsView businessDate={businessDate} role={account.role} />
        )}
        {view === "cash" && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3B.2b"
            subtitle="Chốt két sẽ port ở phase tới."
          />
        )}
```

> Note: we split the compound conditional so `shifts` gets its real implementation while `cash` stays locked until Phase 3B.2b.

### Step 7.3 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean. `/` route First Load JS grows by ~25-35 kB (5 modals + 2 display components + mutations hook + Textarea primitive). Target ~275-285 kB total.

### Step 7.4 — Commit

- [ ] **Commit Task 7.**

```
feat(phase-3b2a): ShiftsView + wire into page.tsx

ShiftsView mounts 3 queries (employees + shifts + payroll), computes
shiftByEmployee first-wins reduce, composes EmployeeGrid + PayrollHistoryCard
+ 4 modals. Owns all modal state — children emit callbacks.

page.tsx now mounts <ShiftsView /> when view==="shifts" with the account
role passed for the canManage gate. Cash view keeps locked EmptyState
pointing to Phase 3B.2b.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

```powershell
git add src/features/shifts/shifts-view.tsx src/app/page.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

## Task 8: Smoke verify + tag `v4-phase-3b2a`

**Files:** (none modified — verification only)

**Why last:** Validates full end-to-end flow + reruns Phase 3A drift guards.

### Step 8.1 — Verify build clean at HEAD

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean. `/` route First Load JS ~275-285 kB.

### Step 8.2 — Re-run Phase 3A drift scripts

- [ ] **Confirm Phase 3A guards still pass.**

```bash
node tools/verify-role-gate.mjs
node tools/verify-business-date.mjs
```

Expected: both print `✓` success messages.

### Step 8.3 — Scope check (no off-limits files touched)

- [ ] **Verify no Phase 1 / Phase 2 body / Phase 3A / Phase 3B.1 files changed.**

```bash
git diff --name-only main..HEAD
```

Expected files (max 10):

```
docs/superpowers/specs/2026-05-20-v4-phase-3b2a-shifts-design.md
docs/superpowers/plans/2026-05-20-v4-phase-3b2a-shifts.md
src/app/page.tsx                                    # dispatcher only
src/components/ui/textarea.tsx                      # NEW primitive
src/features/shifts/check-in-modal.tsx
src/features/shifts/check-out-modal.tsx
src/features/shifts/employee-form-modal.tsx
src/features/shifts/employee-grid.tsx
src/features/shifts/payroll-edit-modal.tsx
src/features/shifts/payroll-history-card.tsx
src/features/shifts/shifts-view.tsx
src/hooks/mutations/use-shift-mutations.ts
```

Confirm NONE of these are present:
- `src/lib/**`
- `src/hooks/queries/**`
- `src/hooks/use-supabase.ts`, `src/hooks/use-pos-sync.ts`, `src/hooks/use-realtime-invalidate.ts`, `src/hooks/use-auth-cookie-sync.ts`, `src/hooks/use-auth-session.ts`, `src/hooks/use-business-date.ts`, `src/hooks/use-role-gate.ts`
- `src/hooks/mutations/use-expense-mutations.ts`
- `src/middleware.ts`, `src/app/api/**`, `database/**`
- `src/features/{navigation,auth,dashboard,reports,pivot,expenses}/**`
- `docker-compose.yml`, `supabase/**`, `.env*`
- Any other `src/components/ui/*.tsx` other than the new `textarea.tsx`

### Step 8.4 — Bring up the stack

- [ ] **`docker compose up -d` and wait for chill-app healthy.**

```bash
docker compose up -d
docker compose ps
```

Expected: all services healthy.

### Step 8.5 — Manual smoke (browser)

- [ ] **Smoke test the shifts module end-to-end.**

Visit `http://localhost:3009`. Owner login (Phase 1 seed): `owner@chill.local` / `chill-owner-2026`.

Click "Ca & lương" in the sidebar. Verify in order:

| # | Action | Expected |
|---|---|---|
| 1 | View loads on empty seed | Header "Nhân viên hôm nay" + IconButton "+ Thêm nhân viên" visible (owner sees it). Both grid columns show EmptyState; PayrollHistoryCard EmptyState. |
| 2 | Click "+" → EmployeeFormModal opens (create mode) | Modal title "Thêm nhân viên mới", no is_active checkbox visible. |
| 3 | Fill name="Linh", position="Thu ngân", hourly_rate=26000 → Submit | Toast "Đã thêm nhân viên mới"; modal closes; "Linh" appears in "Chưa vào ca" column with "Chưa vào" badge. |
| 4 | Click "Vào ca" on Linh | CheckInModal opens; default time = now (within today VN); submit enabled. |
| 5 | Submit check-in | Toast "Linh đã vào ca"; row moves to "Đang làm việc" column with "Đang trong ca" badge. |
| 6 | Click "Ra ca" on Linh | CheckOutModal opens; startTime = check-in time, endTime = now; 3-metric shows Tổng giờ (a few minutes) + Lương giờ (something near 0) + Thực nhận same. Payout hero (mint card) shows total. |
| 7 | Set allowance=20000, submit | Toast "Đã ra ca và lưu lương theo lượt"; modal closes; Linh moves back to "Chưa vào ca"; new payroll row appears in PayrollHistoryCard with totalPay = basePay + 20000. |
| 8 | Click row in PayrollHistoryCard | PayrollEditModal opens; fields pre-filled. |
| 9 | Change allowance to 30000, submit | Toast "Đã cập nhật lượt lương đã chốt"; row updates; "Đã sửa <datetime>" warning badge appears. |
| 10 | Click "Sửa" on Linh in grid | EmployeeFormModal opens (edit mode); is_active checkbox visible + checked. |
| 11 | Uncheck is_active, submit | Toast "Đã cập nhật nhân viên"; modal closes; Linh disappears from grid (because useEmployeesQuery filters is_active=true). |
| 12 | Set endTime < startTime in CheckOutModal (test invalidTime path) | AlertBanner "Giờ ra không được nhỏ hơn giờ vào." appears; submit disabled. |
| 13 | Open CheckInModal then change time to a different day | AlertBanner "Giờ vào ca phải nằm trong ngày {businessDate}." appears; submit disabled. |
| 14 | Sign out, sign in as staff_operator account (if seeded; otherwise skip) | "+ Thêm nhân viên" button NOT visible. "Sửa" button on employee rows NOT visible. Rows in PayrollHistoryCard NOT clickable (no hover, no Tab focus). "Vào ca" / "Ra ca" still work. |
| 15 | Switch businessDate to tomorrow → grid + history empty | New shifts day; old payroll records gone from history. Form still works for new check-ins. |

Document any failures:

```
[ ] All 15 smoke checks pass.
[ ] Failures (if any): _____________
```

If a check fails: fix before tagging.

### Step 8.6 — Tag the phase

- [ ] **Tag `v4-phase-3b2a`.**

```bash
git tag v4-phase-3b2a
git log --oneline main..HEAD
```

Expected: 9 commits (1 spec + 1 plan + 7 implementation tasks).

---

## End-of-phase checklist

Before declaring Phase 3B.2a complete:

- [ ] `npm run build` is clean (no TS errors, no new warnings beyond Phase 3B.1 baseline).
- [ ] Both `verify-role-gate.mjs` and `verify-business-date.mjs` still pass.
- [ ] All 15 smoke checks pass on dev Supabase.
- [ ] No commits to Phase 1 backend files (verify: `git diff main..HEAD src/lib/ src/hooks/queries/ src/middleware.ts src/app/api/ database/`).
- [ ] No commits to Phase 2 component bodies — only `src/components/ui/textarea.tsx` added (additive only).
- [ ] No commits to Phase 3A modules (`src/features/{navigation,auth,dashboard,reports,pivot}/`).
- [ ] No commits to Phase 3B.1 (`src/features/expenses/`, `src/hooks/mutations/use-expense-mutations.ts`).
- [ ] `.env` and `supabase/.env` not staged or committed.
- [ ] Tag `v4-phase-3b2a` is on the final commit.
- [ ] Branch `phase-3b2a-shifts` ready for merge to main.
