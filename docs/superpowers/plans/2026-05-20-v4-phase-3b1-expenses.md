# Phase 3B.1 — Expenses Write Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land `ExpensesView` (form + history + 2 modals + 4 mutation hooks) and wire it as the real implementation for `view === "expenses"` in the AppShell — replacing the Phase 3A lock placeholder.

**Architecture:** 4 mutation hooks co-located in `src/hooks/mutations/use-expense-mutations.ts` consume Phase 1 `lib/data/expenses.ts` RPC wrappers. 5 UI components under `src/features/expenses/` (view container + form + history + 2 modals) use Phase 2 design tokens (Card / TextField / Select / Button / Modal compound / AlertBanner / Toast / EmptyState). Server-driven refetch via `queryClient.invalidateQueries` — no optimistic updates.

**Tech Stack:** Next.js 15 + React 19 + TypeScript strict + Tailwind v4 + Radix Dialog/Select primitives + TanStack Query 5 + Supabase JS. NO new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-05-20-v4-phase-3b1-expenses-design.md`

---

## File Structure

### Created/modified in Phase 3B.1

```
src/
  app/
    page.tsx                                  [MODIFY — swap expenses EmptyState for ExpensesView]
  features/
    expenses/
      expenses-view.tsx                       [NEW — 2-col container]
      expense-form.tsx                        [NEW — form + quick-template rail]
      expense-history-card.tsx                [NEW — list + row click → edit modal]
      expense-template-modal.tsx              [NEW — create new template]
      expense-edit-modal.tsx                  [NEW — edit description+note + nested delete confirm]
  hooks/
    mutations/
      use-expense-mutations.ts                [NEW — 4 hooks co-located]
  components/ui/icons.tsx                     [MODIFY — add 2 icons: trash, save]
```

### Untouched (do NOT modify)
- `src/lib/**` (Phase 1 — `lib/data/expenses.ts` has the 4 RPC wrappers; `lib/validation.ts` has `validateExpense`)
- `src/hooks/queries/**`, `src/hooks/use-*.ts` (Phase 1 + 3A)
- `src/middleware.ts`, `src/app/api/**`, `database/**`
- Phase 2 component bodies (other than `icons.tsx` additive)
- `src/features/{navigation,auth,dashboard,reports,pivot}/**` (Phase 3A — frozen)
- `docker-compose.yml`, `supabase/**`, `.env*`

---

## Conventions for this plan

- **Vietnamese UI labels** preserved verbatim per spec §7 (Lưu khoản chi, Xóa, Mẫu nhanh, etc.).
- **Form validation:** `validateExpense({...})` from `@/lib/validation` (Phase 1, frozen). Result shape `{ ok: true } | { ok: false; field, message }`.
- **TZ guardrail:** `business_date` always flows in from `useBusinessDate` (Phase 3A) via prop. Never construct dates inside expense components.
- **Mutations:** TanStack `useMutation` with `mutationFn` calling Phase 1 `lib/data` fn. Throw `Error("Thiếu cấu hình Supabase.")` when supabase is null in mutationFn. `onSuccess: (data, vars) => queryClient.invalidateQueries(...)`. Caller uses `mutateAsync` + try/catch + toast.
- **Modal pattern:** Phase 2 compound — `<Modal open onOpenChange><ModalContent><ModalTitle>…</ModalTitle>{children}<ModalActions>…</ModalActions></ModalContent></Modal>`. Each modal is a controlled component with `open` + `onOpenChange` props.
- **No test framework yet** (deferred 3B.2). Each task ends with `npm run build` clean + manual file structure verification. Task 7 is the smoke verification gate.
- **Each commit ends** with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.

---

## Tasks overview

| # | Task | Files (new) | Files (modify) | Est. LOC |
|---|---|---|---|---|
| 1 | Icons (+2) + `useExpenseMutations` hook | 1 | 1 | ~110 |
| 2 | `ExpenseTemplateModal` | 1 | 0 | ~130 |
| 3 | `ExpenseEditModal` (with nested confirm) | 1 | 0 | ~190 |
| 4 | `ExpenseForm` (uses Task 2 modal) | 1 | 0 | ~240 |
| 5 | `ExpenseHistoryCard` (uses Task 3 modal) | 1 | 0 | ~110 |
| 6 | `ExpensesView` + page.tsx wire | 1 | 1 | ~90 |
| 7 | Smoke verify + mirror rerun + tag | 0 | 0 | ~0 |

Total: 6 new files + 2 modify points + verification gate. ~870 LOC.

---

## Task 1: Icons + `useExpenseMutations` hook

**Files:**
- Modify: `src/components/ui/icons.tsx` (additively add `trash` + `save`)
- Create: `src/hooks/mutations/use-expense-mutations.ts`

**Why this first:** Every downstream component (Form, EditModal, TemplateModal) needs at least one of the 4 mutations + at least one of the 2 icons. Landing them as foundation prevents downstream tasks from each adding "+1 icon" or "+1 hook" patches.

### Step 1.1 — Add `trash` + `save` icons additively

- [ ] **Edit `src/components/ui/icons.tsx` — add 2 new icons.**

Open the file and:
1. Add `Trash2, Save` to the import block from `"lucide-react"` (in the "Phase 3A action icons" comment section, after `Printer`).
2. Add `trash: Trash2` and `save: Save` entries to the `Icons` map (in the "Phase 3A actions" section, after `printer`).

After edit, the import block should look like:

```tsx
import {
  ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, ChevronLeft,
  ChevronRight, Filter, Info, Loader2, Search, X, Plus, Minus,
  AlertTriangle, AlertCircle, CheckCircle2, Sparkles,
  // Phase 3A — nav icons
  LayoutDashboard, Wallet, Users, Banknote, PiggyBank, FileText,
  BarChart3, Settings,
  // Phase 3A — action icons
  LogOut, Menu, RefreshCw, Download, Clock, Lock, Printer,
  // Phase 3B.1 — action icons
  Trash2, Save,
  type LucideIcon, type LucideProps,
} from "lucide-react";
```

And the `Icons` map appended with:

```tsx
  // Phase 3B.1 actions
  trash: Trash2,
  save: Save,
```

The rest of the file is unchanged (existing 33 icons stay; new total = 35).

### Step 1.2 — Create `src/hooks/mutations/use-expense-mutations.ts`

- [ ] **Create the file with all 4 mutations.**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createExpense,
  createExpenseTemplate,
  deleteExpense,
  updateExpense,
} from "@/lib/data";
import type { ExpenseTemplate } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the expenses module (Phase 3B.1).
 *
 * Co-located in one file because they share the same invalidation logic
 * (dashboard + templates) and the same supabase + businessDate dependency.
 *
 * No optimistic updates — every mutation invalidates the relevant queries
 * on success, which triggers a refetch. Simple, predictable, no rollback
 * complexity. Phase 6 can add optimism if measurements show a need.
 *
 * Caller pattern:
 *   const create = useCreateExpense(supabase, businessDate);
 *   try {
 *     await create.mutateAsync({ business_date, ... });
 *     toast({ semantic: "success", message: "Đã lưu khoản chi." });
 *   } catch (err) {
 *     toast({ semantic: "danger", message: err.message });
 *   }
 */

export interface CreateExpenseInput {
  business_date: string;
  category_id: string | null;
  template_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
  note: string;
  payment_method: "cash";
}

export function useCreateExpense(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateExpenseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createExpense(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.templates() });
    },
  });
}

export interface CreateExpenseTemplateInput {
  label: string;
  default_category_id: string | null;
  default_unit: string;
  last_unit_price: number;
}

export function useCreateExpenseTemplate(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation<ExpenseTemplate, Error, CreateExpenseTemplateInput>({
    mutationFn: async (input) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createExpenseTemplate(supabase, input as unknown as Record<string, unknown>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.templates() });
    },
  });
}

export interface UpdateExpenseInput {
  id: string;
  patch: { description?: string; note?: string | null };
}

export function useUpdateExpense(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateExpenseInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateExpense(supabase, id, patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
    },
  });
}

export function useDeleteExpense(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteExpense(supabase, id);
    },
    onSuccess: () => {
      // Both dashboard expenses list AND cash_drawer_events change → invalidate
      // both. (RPC delete_expense reverses cash_drawer_events as a side effect
      // per Phase 1 lib/data/expenses.ts comment.)
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.cashCounts(businessDate) });
    },
  });
}
```

### Step 1.3 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean compile, no new TypeScript errors. Tree-shaking keeps the new exports out of bundles until components import them in Task 2-6.

### Step 1.4 — Commit

- [ ] **Commit Task 1.**

```bash
git add src/components/ui/icons.tsx src/hooks/mutations/use-expense-mutations.ts
git commit -m @'
feat(phase-3b1): icons (+trash, +save) + useExpenseMutations hook

- Add 2 named icons (trash, save) to icons.tsx — additive, no existing
  icons removed. Total Phase 3 icon count now 35.
- Create src/hooks/mutations/use-expense-mutations.ts with 4 TanStack
  mutation hooks: useCreateExpense, useCreateExpenseTemplate,
  useUpdateExpense, useDeleteExpense.
- Each mutation invalidates the relevant query keys on success
  (dashboard + templates + cashCounts for delete). No optimistic updates.
- Throws "Thiếu cấu hình Supabase." if supabase is null in mutationFn —
  caller responsibility to gate UI when not configured.

No runtime UI change yet; foundation for Tasks 2-6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: `ExpenseTemplateModal`

**Files:**
- Create: `src/features/expenses/expense-template-modal.tsx`

**Why second:** Simplest component (single Modal, simple form, no nested logic). Validates the Phase 2 Modal compound + Phase 2 form-control pattern before bigger components depend on it.

### Step 2.1 — Create `src/features/expenses/expense-template-modal.tsx`

- [ ] **Write the component.**

```tsx
"use client";

import { useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCreateExpenseTemplate } from "@/hooks/mutations/use-expense-mutations";
import { moneyFromInput } from "@/lib/format";
import type { ExpenseCategory, ExpenseTemplate } from "@/lib/types";

interface ExpenseTemplateModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  categories: ReadonlyArray<ExpenseCategory>;
  /** Called on successful create. Receives the new template so the form can
   *  optionally apply it immediately. */
  onCreated(template: ExpenseTemplate): void;
}

/**
 * Modal to create a new expense template. Lives in a Radix Portal (Phase 2
 * Modal compound), so it's OUTSIDE the DOM tree of ExpenseForm — meaning we
 * can use a real <form> element here (unlike v3, which had to use <div> +
 * keyDown trick to avoid nested-form HTML errors).
 */
export function ExpenseTemplateModal({
  open,
  onOpenChange,
  categories,
  onCreated,
}: ExpenseTemplateModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createTemplate = useCreateExpenseTemplate(supabase);

  const [label, setLabel] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [unit, setUnit] = useState("cái");
  const [unitPrice, setUnitPrice] = useState("");

  function resetForm() {
    setLabel("");
    setCategoryId("");
    setUnit("cái");
    setUnitPrice("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim() || createTemplate.isPending) return;
    try {
      const template = await createTemplate.mutateAsync({
        label: label.trim(),
        default_category_id: categoryId || null,
        default_unit: unit,
        last_unit_price: moneyFromInput(unitPrice),
      });
      toast({ semantic: "success", message: "Đã tạo mẫu chi mới." });
      onCreated(template);
      resetForm();
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không tạo được mẫu chi.",
      });
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent>
        <ModalTitle>Thêm mẫu nhập nhanh</ModalTitle>
        <ModalDescription>
          Mẫu giúp lập form chi phí nhanh hơn lần sau.
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên mẫu"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ví dụ: Bánh mì"
            required
            autoFocus
            disabled={createTemplate.isPending}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="template-category"
              className="text-xs font-medium text-ink-2"
            >
              Danh mục
            </label>
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              disabled={createTemplate.isPending}
            >
              <SelectTrigger id="template-category">
                <SelectValue placeholder="Chọn danh mục..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Đơn vị mặc định"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ổ, bao, kg..."
              disabled={createTemplate.isPending}
            />
            <TextField
              label="Đơn giá gần nhất"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              inputMode="numeric"
              placeholder="50.000"
              disabled={createTemplate.isPending}
            />
          </div>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={createTemplate.isPending}
            >
              Đóng
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={createTemplate.isPending}
              disabled={!label.trim()}
            >
              Lưu mẫu và áp dụng
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

Expected: clean. No bundle impact yet (no consumer).

### Step 2.3 — Commit

- [ ] **Commit Task 2.**

```bash
git add src/features/expenses/expense-template-modal.tsx
git commit -m @'
feat(phase-3b1): ExpenseTemplateModal

Phase 2 Modal compound (Radix Portal) + TextField + Select + Button +
useToast + useCreateExpenseTemplate. Lives outside ExpenseForm DOM tree
because Radix Portal renders to document.body — so we can use a real
<form> element (v3 had to use <div> + keyDown trick because nested-form
HTML is invalid).

Resets form fields on close + on successful create. Disables submit while
mutating. Toasts success or danger on result.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: `ExpenseEditModal` (with nested confirm)

**Files:**
- Create: `src/features/expenses/expense-edit-modal.tsx`

**Why third:** Most complex modal (controlled fields + nested confirm Modal + 2 mutations). Landing it here proves the nested-Modal pattern works before ExpenseHistoryCard (Task 5) consumes it.

### Step 3.1 — Create `src/features/expenses/expense-edit-modal.tsx`

- [ ] **Write the component.**

```tsx
"use client";

import { useState, useEffect } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useUpdateExpense,
  useDeleteExpense,
} from "@/hooks/mutations/use-expense-mutations";
import { formatDateTime, formatVND } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { Expense } from "@/lib/types";

interface ExpenseEditModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  expense: Expense | null;
  businessDate: string;
}

/**
 * Edit modal for an existing expense row. Allows description + note edit
 * + delete (with nested confirm Modal).
 *
 * Preserves v3 constraint: amount / category / payment_method are IMMUTABLE
 * after create — editing those would require sync'ing cash_drawer_events
 * and recomputing reports. Out of scope for this phase.
 *
 * Mounted by ExpenseHistoryCard (Task 5). When expense is null (e.g., during
 * close animation), render nothing in the body but keep the Modal Root so
 * onOpenChange still fires.
 */
export function ExpenseEditModal({
  open,
  onOpenChange,
  expense,
  businessDate,
}: ExpenseEditModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateExpenseM = useUpdateExpense(supabase, businessDate);
  const deleteExpenseM = useDeleteExpense(supabase, businessDate);

  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset state when a new expense is opened.
  useEffect(() => {
    if (expense) {
      setDescription(expense.description ?? "");
      setNote(expense.note ?? "");
      setConfirmingDelete(false);
    }
  }, [expense?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (!expense) {
    // Modal closed or no expense selected — render the Root so consumers can
    // still toggle but no body.
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const original = {
    description: expense.description ?? "",
    note: expense.note ?? "",
  };
  const dirty = description !== original.description || note !== original.note;
  const descEmpty = !description.trim();
  const descTooLong = description.length > limits.description;
  const noteTooLong = note.length > limits.note;
  const hasError = descEmpty || descTooLong || noteTooLong;
  const isBusy = updateExpenseM.isPending || deleteExpenseM.isPending;

  async function handleSave() {
    if (!expense || hasError || !dirty || isBusy) return;
    try {
      await updateExpenseM.mutateAsync({
        id: expense.id,
        patch: {
          description: description.trim(),
          note: note.trim() ? note.trim() : null,
        },
      });
      toast({ semantic: "success", message: "Đã cập nhật khoản chi." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được khoản chi.",
      });
    }
  }

  async function handleDelete() {
    if (!expense || isBusy) return;
    try {
      await deleteExpenseM.mutateAsync(expense.id);
      toast({
        semantic: "success",
        message: `Đã xóa khoản chi ${formatVND(expense.amount)}.`,
      });
      setConfirmingDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không xóa được khoản chi.",
      });
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl/Cmd + Enter saves (matches v3). Plain Enter still creates newline
    // in textarea — don't intercept that.
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSave();
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange}>
        <ModalContent onKeyDown={handleKeyDown}>
          <ModalTitle>{formatVND(expense.amount)}</ModalTitle>
          <ModalDescription>
            Sửa khoản chi · {expense.category_name ?? "Không có danh mục"} ·{" "}
            {formatDateTime(expense.created_at)}
          </ModalDescription>

          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Số lượng</dt>
              <dd className="text-ink">
                {expense.quantity ?? 1} {expense.unit ?? ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Đơn giá</dt>
              <dd className="text-ink">{formatVND(expense.unit_price ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Ngày</dt>
              <dd className="text-ink">{expense.business_date}</dd>
            </div>
          </dl>

          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-description" className="text-xs font-medium text-ink-2">
                Mô tả *
              </label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={limits.description}
                disabled={isBusy}
                autoFocus
                rows={3}
                className="rounded-sm bg-surface border border-border px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong disabled:bg-surface-muted disabled:text-muted disabled:cursor-not-allowed"
              />
              <span className="text-xs text-muted">
                {description.length}/{limits.description} ký tự
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-note" className="text-xs font-medium text-ink-2">
                Ghi chú
              </label>
              <textarea
                id="edit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={limits.note}
                disabled={isBusy}
                rows={3}
                placeholder="Tùy chọn — chi tiết thêm về khoản chi này..."
                className="rounded-sm bg-surface border border-border px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong disabled:bg-surface-muted disabled:text-muted disabled:cursor-not-allowed"
              />
              <span className="text-xs text-muted">
                {note.length}/{limits.note} ký tự
              </span>
            </div>
          </div>

          {hasError && (
            <div className="mt-4">
              <AlertBanner variant="danger">
                {descEmpty && "Mô tả không được rỗng. "}
                {descTooLong && `Mô tả vượt ${limits.description} ký tự. `}
                {noteTooLong && `Ghi chú vượt ${limits.note} ký tự.`}
              </AlertBanner>
            </div>
          )}

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              disabled={isBusy}
              leadingIcon={<Icon name="trash" size={16} />}
              className="mr-auto text-danger hover:bg-danger-soft"
            >
              Xóa
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={!dirty || hasError || isBusy}
              loading={updateExpenseM.isPending}
              leadingIcon={<Icon name="save" size={16} />}
            >
              Lưu thay đổi
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>

      {/* Nested confirm-delete Modal. Separate state from main Modal so we
          can keep the main edit Modal open while showing the confirm. */}
      <Modal open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <ModalContent>
          <ModalTitle>Xóa khoản chi này?</ModalTitle>
          <ModalDescription>
            <strong>{formatVND(expense.amount)}</strong> — {expense.description}.
            Thao tác này KHÔNG thể hoàn tác.
          </ModalDescription>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              loading={deleteExpenseM.isPending}
              leadingIcon={<Icon name="trash" size={16} />}
            >
              Xóa
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>
    </>
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

```bash
git add src/features/expenses/expense-edit-modal.tsx
git commit -m @'
feat(phase-3b1): ExpenseEditModal with nested confirm

Phase 2 Modal compound for edit + a SECOND Modal (nested via Portal) for
confirm-delete. Both Modals have separate open state so the edit Modal
stays mounted while the confirm Modal renders on top.

Preserved v3 business rule: amount / category / payment_method immutable.
Editable: description (max 500) + note (max 1000). Validation lives in
the component (matches Phase 1 lib/validation limits) — AlertBanner
shown on validation failure, save disabled.

Ctrl/Cmd+Enter saves (preserved v3 keyboard shortcut). Plain Enter still
inserts newline in textareas.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: `ExpenseForm`

**Files:**
- Create: `src/features/expenses/expense-form.tsx`

**Why fourth:** Biggest UI component. Uses TemplateModal (Task 2) and useCreateExpense (Task 1). Has its own form state machine + validation + quick-template rail.

### Step 4.1 — Create `src/features/expenses/expense-form.tsx`

- [ ] **Write the component.**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCreateExpense } from "@/hooks/mutations/use-expense-mutations";
import { formatNumber, formatVND, moneyFromInput } from "@/lib/format";
import { validateExpense } from "@/lib/validation";
import type { ExpenseCategory, ExpenseTemplate } from "@/lib/types";
import { ExpenseTemplateModal } from "./expense-template-modal";

interface ExpenseFormProps {
  businessDate: string;
  categories: ReadonlyArray<ExpenseCategory>;
  templates: ReadonlyArray<ExpenseTemplate>;
}

/**
 * Form to create a new expense. Owns:
 * - Field state (useState — simple form, no react-hook-form)
 * - Quick-template rail with click-to-apply behavior
 * - "+ Mẫu" button opens ExpenseTemplateModal (Task 2); on template create,
 *   apply it to the form immediately
 *
 * On submit:
 *   1. validateExpense (Phase 1 helper, mirrors SQL CHECK constraints)
 *   2. mutateAsync via useCreateExpense
 *   3. Toast success + reset form (keep category + unit defaults; clear desc/qty/price/amount/note)
 *
 * Errors surface via AlertBanner inline + toast danger.
 */
export function ExpenseForm({
  businessDate,
  categories,
  templates,
}: ExpenseFormProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createExpenseM = useCreateExpense(supabase, businessDate);

  const [categoryId, setCategoryId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("cái");
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [isTemplateModalOpen, setTemplateModalOpen] = useState(false);

  const computed = (Number(quantity) || 0) * moneyFromInput(unitPrice);
  const finalAmount = moneyFromInput(amount) || computed;
  const topTemplates = templates.slice(0, 8);

  function applyTemplate(template: ExpenseTemplate) {
    setTemplateId(template.id);
    setDescription(template.label);
    setCategoryId(template.default_category_id ?? "");
    setUnit(template.default_unit ?? "cái");
    setUnitPrice(template.last_unit_price ? formatNumber(template.last_unit_price) : "");
    setAmount("");
    toast({ semantic: "info", message: "Đã áp dụng mẫu chi: " + template.label });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateExpense({
      description,
      quantity: Number(quantity) || 0,
      unit_price: moneyFromInput(unitPrice),
      amount: finalAmount,
      note,
    });
    if (!validation.ok) {
      setFieldError({ field: validation.field, message: validation.message });
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    setFieldError(null);
    try {
      await createExpenseM.mutateAsync({
        business_date: businessDate,
        category_id: categoryId || null,
        template_id: templateId || null,
        description: description.trim(),
        quantity: Number(quantity) || 1,
        unit,
        unit_price: moneyFromInput(unitPrice),
        amount: finalAmount,
        note: note.trim(),
        payment_method: "cash",
      });
      // Reset variable fields; keep category + unit as last-used defaults.
      setTemplateId("");
      setDescription("");
      setQuantity("1");
      setUnitPrice("");
      setAmount("");
      setNote("");
      toast({ semantic: "success", message: "Đã lưu khoản chi." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được khoản chi.",
      });
    }
  }

  const isBusy = createExpenseM.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Nhập chi</p>
            <CardTitle>Thêm khoản chi mới</CardTitle>
          </div>
          <strong className="font-display text-base text-ink">
            {formatVND(finalAmount)}
          </strong>
        </div>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick-template rail */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">Mẫu nhanh</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTemplateModalOpen(true)}
                disabled={isBusy}
              >
                + Thêm mẫu
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {topTemplates.length === 0 && (
                <span className="text-xs text-muted">Chưa có mẫu chi.</span>
              )}
              {topTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  disabled={isBusy}
                  className="inline-flex flex-col items-start gap-0.5 rounded-full border border-border bg-surface px-3 py-1.5 text-left transition hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <strong className="text-sm text-ink">{t.label}</strong>
                  <small className="text-xs text-muted">{formatVND(t.last_unit_price)}</small>
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="form-category" className="text-xs font-medium text-ink-2">
              Loại chi phí *
            </label>
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              disabled={isBusy}
            >
              <SelectTrigger id="form-category">
                <SelectValue placeholder="Chọn loại chi phí..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Description */}
          <TextField
            label="Nội dung *"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setTemplateId(""); // user edited — no longer the original template
            }}
            placeholder="VD: Bánh mì, trứng, đá viên..."
            required
            disabled={isBusy}
          />

          {/* Qty / unit / unitPrice grid */}
          <div className="grid grid-cols-3 gap-3">
            <TextField
              label="Số lượng"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              disabled={isBusy}
            />
            <TextField
              label="Đơn vị"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              disabled={isBusy}
            />
            <TextField
              label="Đơn giá"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              inputMode="numeric"
              placeholder="50.000"
              disabled={isBusy}
            />
          </div>

          {/* Final amount with auto-compute placeholder */}
          <TextField
            label="Thành tiền"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder={computed ? formatNumber(computed) : "Tự tính từ SL × đơn giá"}
            disabled={isBusy}
          />

          {/* Note */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="form-note" className="text-xs font-medium text-ink-2">
              Ghi chú
            </label>
            <textarea
              id="form-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: mua tại chợ, người giao..."
              rows={2}
              disabled={isBusy}
              className="rounded-sm bg-surface border border-border px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong disabled:bg-surface-muted disabled:text-muted disabled:cursor-not-allowed"
            />
          </div>

          {fieldError && (
            <AlertBanner variant="danger">{fieldError.message}</AlertBanner>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={isBusy}
            className="w-full"
          >
            Lưu khoản chi · {formatVND(finalAmount)}
          </Button>
        </form>
      </CardBody>

      <ExpenseTemplateModal
        open={isTemplateModalOpen}
        onOpenChange={setTemplateModalOpen}
        categories={categories}
        onCreated={(template) => {
          applyTemplate(template);
        }}
      />
    </Card>
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

```bash
git add src/features/expenses/expense-form.tsx
git commit -m @'
feat(phase-3b1): ExpenseForm

Phase 2 Card + TextField + Select + Button + AlertBanner + Toast composed
into the main expense-create form. Owns its own state via useState
(no react-hook-form — simple form). Validates via lib/validation
validateExpense before mutating.

Quick-template rail (top 8 by usage_count) — click chip to apply template
fields to the form. "+ Mẫu" opens ExpenseTemplateModal (Task 2); on
template creation, applies immediately.

Resets variable fields after successful submit (description, quantity,
unitPrice, amount, note); keeps category + unit as last-used defaults for
operator convenience.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: `ExpenseHistoryCard`

**Files:**
- Create: `src/features/expenses/expense-history-card.tsx`

**Why fifth:** Pure prop-driven list (no own queries), uses EditModal (Task 3). Light task that fits after the modals are validated.

### Step 5.1 — Create `src/features/expenses/expense-history-card.tsx`

- [ ] **Write the component.**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTime, formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Expense, UserRole } from "@/lib/types";
import { ExpenseEditModal } from "./expense-edit-modal";

interface ExpenseHistoryCardProps {
  expenses: ReadonlyArray<Expense>;
  total: number;
  role: UserRole;
  businessDate: string;
}

/**
 * List of today's expenses with row click → edit modal (owner/manager only).
 * Pure prop-driven — reads from parent's dashboard.expenses array.
 *
 * Rows show description + category + time on the left, formatted VND amount
 * on the right (right-aligned amount is the primary value, so we don't use
 * Phase 2 ListItem which would put it in the side `action` slot).
 */
export function ExpenseHistoryCard({
  expenses,
  total,
  role,
  businessDate,
}: ExpenseHistoryCardProps) {
  const canEdit = role === "owner" || role === "manager";
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId
    ? expenses.find((e) => e.id === editingId) ?? null
    : null;

  function open(id: string) {
    if (canEdit) setEditingId(id);
  }

  function handleOpenChange(next: boolean) {
    if (!next) setEditingId(null);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Lịch sử ngày</CardTitle>
          <strong className="font-display text-base text-ink">{formatVND(total)}</strong>
        </div>
      </CardHeader>
      <CardBody>
        {expenses.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="Chưa có khoản chi"
            subtitle="Khi nhân viên nhập chi, dòng mới sẽ hiện tại đây."
          />
        ) : (
          <ul className="divide-y divide-border">
            {expenses.map((e) => (
              <li
                key={e.id}
                onClick={canEdit ? () => open(e.id) : undefined}
                onKeyDown={
                  canEdit
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          open(e.id);
                        }
                      }
                    : undefined
                }
                tabIndex={canEdit ? 0 : undefined}
                role={canEdit ? "button" : undefined}
                aria-label={canEdit ? `Sửa khoản chi ${e.description}` : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 py-3 px-2 -mx-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
                  canEdit && "cursor-pointer hover:bg-surface-muted"
                )}
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-ink">
                    {e.description}
                  </strong>
                  <span className="text-xs text-muted">
                    {e.category_name ?? "Chi phí"} · {formatTime(e.created_at)}
                  </span>
                </div>
                <strong className="shrink-0 font-display text-sm text-ink">
                  {formatVND(e.amount)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <ExpenseEditModal
        open={editingId !== null}
        onOpenChange={handleOpenChange}
        expense={editing}
        businessDate={businessDate}
      />
    </Card>
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

```bash
git add src/features/expenses/expense-history-card.tsx
git commit -m @'
feat(phase-3b1): ExpenseHistoryCard

Pure prop-driven list (no own query). Rows clickable for owner/manager
only — staff_operator sees static rows. Keyboard accessible (Tab to row,
Enter/Space opens edit modal).

Inline <li> rows (not Phase 2 ListItem) because the amount on the right
is the primary value of the row, not a side action.

Hosts the ExpenseEditModal — owns the editingId state, looks up the
expense from the parent-provided array on render. When edit modal closes
or save/delete succeeds, editingId resets to null.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: `ExpensesView` + wire into `page.tsx`

**Files:**
- Create: `src/features/expenses/expenses-view.tsx`
- Modify: `src/app/page.tsx` (swap the 3B locked EmptyState for `<ExpensesView />`)

**Why sixth:** The view container assembles ExpenseForm + ExpenseHistoryCard with the right queries + layout. Wiring into page.tsx completes the user-visible path.

### Step 6.1 — Create `src/features/expenses/expenses-view.tsx`

- [ ] **Write the container.**

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import {
  useDashboardQuery,
  useExpenseCategoriesQuery,
  useExpenseTemplatesQuery,
} from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import type { UserRole } from "@/lib/types";
import { ExpenseForm } from "./expense-form";
import { ExpenseHistoryCard } from "./expense-history-card";

interface ExpensesViewProps {
  businessDate: string;
  role: UserRole;
}

/**
 * Top-level container for view === "expenses". Mounts the 3 queries it
 * needs (dashboard for the expenses list, categories + templates for the
 * form), handles loading / error states, and lays out form-left /
 * history-right in a 2-col bento.
 *
 * The list of today's expenses comes from `dashboardQuery.data.expenses`
 * (no separate query) — this means a new mutation that invalidates
 * dashboard also refreshes this list in the same render cycle.
 */
export function ExpensesView({ businessDate, role }: ExpensesViewProps) {
  const supabase = useSupabase();
  const dashboardQuery = useDashboardQuery(supabase, businessDate, true);
  const categoriesQuery = useExpenseCategoriesQuery(supabase, true);
  const templatesQuery = useExpenseTemplatesQuery(supabase, true);

  if (dashboardQuery.isLoading || categoriesQuery.isLoading || templatesQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dữ liệu chi phí">
        {dashboardQuery.error instanceof Error
          ? dashboardQuery.error.message
          : String(dashboardQuery.error)}
      </AlertBanner>
    );
  }

  const expenses = dashboardQuery.data?.expenses ?? [];
  const totalExpenses = dashboardQuery.data?.total_expenses ?? 0;
  const categories = categoriesQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <ExpenseForm
        businessDate={businessDate}
        categories={categories}
        templates={templates}
      />
      <ExpenseHistoryCard
        expenses={expenses}
        total={totalExpenses}
        role={role}
        businessDate={businessDate}
      />
    </div>
  );
}
```

### Step 6.2 — Wire into `src/app/page.tsx`

- [ ] **Modify `src/app/page.tsx`.**

Two changes:

1. **Add the import** near the existing module imports (alphabetical):

```tsx
import { ExpensesView } from "@/features/expenses/expenses-view";
```

2. **Replace the 3B locked EmptyState block** for the `expenses` view.

Find:

```tsx
        {(view === "expenses" || view === "shifts" || view === "cash") && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3B"
            subtitle="Chi phí / Ca & lương / Chốt két sẽ port + redesign ở phase tới."
          />
        )}
```

Replace with:

```tsx
        {view === "expenses" && (
          <ExpensesView businessDate={businessDate} role={account.role} />
        )}
        {(view === "shifts" || view === "cash") && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3B.2"
            subtitle="Ca & lương / Chốt két sẽ port ở phase tới."
          />
        )}
```

> Note: we split the compound conditional so `expenses` gets its real implementation while `shifts` and `cash` stay locked until Phase 3B.2.

### Step 6.3 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean. `/` route First Load JS grows by ~15-25 kB (form, history, 2 modals, mutations).

### Step 6.4 — Commit

- [ ] **Commit Task 6.**

```bash
git add src/features/expenses/expenses-view.tsx src/app/page.tsx
git commit -m @'
feat(phase-3b1): ExpensesView + wire into page.tsx

ExpensesView mounts 3 queries (dashboard for expenses list, categories
+ templates for the form) and composes ExpenseForm (left, 1.4fr) +
ExpenseHistoryCard (right, 1fr) in a responsive 2-col grid.

page.tsx now mounts <ExpensesView /> when view==="expenses" with the
account role passed for the row-click gate. Shifts + cash views keep
their locked EmptyState pointing to Phase 3B.2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: Smoke verify + mirror rerun + tag

**Files:** (none modified — verification only)

**Why last:** Validates the full flow end-to-end on dev Supabase + reruns the existing Phase 3A mirror-verify script to confirm no regression.

### Step 7.1 — Verify build clean at HEAD

- [ ] **Run build.**

```bash
npm run build
```

Expected: clean, all routes generate, no new warnings beyond the pre-existing Next workspace-root inference.

### Step 7.2 — Re-run Phase 3A verification scripts

- [ ] **Confirm Phase 3A drift guards still pass.**

```bash
node tools/verify-role-gate.mjs
node tools/verify-business-date.mjs
```

Expected: both print `✓` success messages. (3B.1 doesn't touch navigation.ts or datetime.ts, so these should remain green.)

### Step 7.3 — Bring up the stack

- [ ] **`docker compose up -d` and wait for chill-app healthy.**

```bash
docker compose up -d
docker compose ps
```

Expected: all services healthy (chill-app, db, kong, auth, rest, realtime, storage, etc.).

### Step 7.4 — Manual smoke (browser)

- [ ] **Smoke test the expenses module end-to-end.**

Visit `http://localhost:3009`. Owner login (from Phase 1 seed): `owner@chill.local` / `chill-owner-2026`.

Click "Chi phí" in the sidebar. Verify:

| # | Action | Expected |
|---|---|---|
| 1 | View loads | ExpensesView shows form left + history right (empty if no expenses today) |
| 2 | Click "+ Thêm mẫu" | ExpenseTemplateModal opens |
| 3 | Fill label "Bánh mì test", category "Hàng hoá", unit "ổ", đơn giá 30000 | Submit button enabled |
| 4 | Click "Lưu mẫu và áp dụng" | Toast "Đã tạo mẫu chi mới"; modal closes; form fields filled with template values |
| 5 | Click "Lưu khoản chi" | Toast "Đã lưu khoản chi"; row appears in history right card; KpiBar on dashboard (after switching tabs) shows updated total |
| 6 | Click the new row in history | ExpenseEditModal opens with description "Bánh mì test" pre-filled |
| 7 | Change description to "Bánh mì sáng", click "Lưu thay đổi" | Toast "Đã cập nhật khoản chi"; modal closes; row text updates |
| 8 | Click row again, click "Xóa" | Nested confirm Modal appears |
| 9 | Click "Xóa" in confirm | Toast "Đã xóa khoản chi <amount>"; both modals close; row disappears |
| 10 | Switch business-date to tomorrow | History empty; form still works |
| 11 | Submit with empty description | AlertBanner inline "Nội dung không được để trống" + toast danger; no row created |
| 12 | Sign out, sign in as a staff_operator account (if seeded; else create via SQL) | History rows are NOT clickable (no hover state, no Tab focus); form still works |

Document any failures here:

```
[ ] All 12 smoke checks pass.
[ ] Failures (if any): _____________
```

If a check fails: fix before continuing. Do NOT proceed to Step 7.5.

### Step 7.5 — Run mirror-verify (if a mirror dump is available)

- [ ] **Mirror verify — optional if you have a v3 dump restored.**

This step is optional in 3B.1 because:
- No reads changed in 3B.1 (only writes).
- verify-mirror.mjs compares RPC reads vs raw aggregates — unaffected by 3B.1 mutations.
- If the operator has a mirror dump from Phase 3A, rerunning verifies no regression.

```bash
# Only if you have mirrors/v3-*.sql restored to v4 dev:
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d= -f2)
node tools/verify-mirror.mjs --date 2026-05-19 --service-key "$SERVICE_KEY"
```

Expected: all 7 checks ✓.

If no mirror is available, skip this step — Phase 3B.1 doesn't change anything that would break it.

### Step 7.6 — Tag and finalize

- [ ] **Tag Phase 3B.1.**

```bash
git tag v4-phase-3b1
git log --oneline main..HEAD
```

Expected: 7 commits from Task 1-6 plus this tag. (Plan + spec commits land before Task 1 — they're already on the branch.)

---

## End-of-phase checklist

Before declaring Phase 3B.1 complete:

- [ ] `npm run build` is clean.
- [ ] Both `verify-role-gate.mjs` and `verify-business-date.mjs` still pass.
- [ ] All 12 smoke checks pass on dev Supabase.
- [ ] No commits to Phase 1 backend files (verify: `git diff main..HEAD src/lib/ src/hooks/queries/ src/middleware.ts src/app/api/ database/`).
- [ ] No commits to Phase 2 component bodies except `src/components/ui/icons.tsx` (additive only — only `trash` + `save` added).
- [ ] No commits to Phase 3A modules (`features/{navigation,auth,dashboard,reports,pivot}/`).
- [ ] `.env` and `supabase/.env` not staged or committed.
- [ ] Tag `v4-phase-3b1` is on the final commit.
- [ ] Branch `phase-3b1-expenses` ready for merge to main (per the master plan per-phase-branch convention).
