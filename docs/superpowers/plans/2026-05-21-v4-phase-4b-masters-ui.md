# Phase 4.B — Masters UI (Ingredients + Menu Items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entire Masters UI for inventory — one "Kho" sidebar entry, InventoryView container with 5-tab Radix structure (2 active + 3 placeholders), full CRUD for ingredients and menu_items via modal forms with two-button delete UX, plus 6 mutation hooks. Role-based UI gating hides write controls from staff_operator.

**Architecture:** Pure UI layer on top of the 4.A backend foundation. No new RPCs, no new types, no new query hooks (all added in 4.A). Reuses existing primitives: Tabs (Radix), Modal, Select, TextField, Textarea, Checkbox, Badge, AlertBanner, EmptyState, Spinner, Card. Mutation hooks follow the established `use-handover-mutations.ts` template with conservative invalidation. Each tab + modal is in its own file (~110–180 lines).

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict · TanStack Query 5 · Radix UI · Tailwind v4 · Supabase JS · Vietnamese UI labels

---

## Conventions (read before any task)

**Commit messages.** PowerShell here-strings break on Vietnamese diacritics. Use this pattern every time:

```powershell
$msg = @'
<commit subject>

<body...>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add <files>
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

**Branch state at start:** `phase-4b-masters-ui` is already checked out (off main @ tag `v4-phase-4a`). The Phase 4.B design spec is committed at `f85ffb1`.

**Verify gate baseline:** `npm run verify:phase` should remain 75 Vitest + 89 pgTAP = 164 throughout (no backend changes in 4.B).

**Primitive APIs verified:**
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs` (Radix Tabs wrappers)
- `Modal`, `ModalContent`, `ModalTitle`, `ModalDescription`, `ModalActions`, `ModalClose` from `@/components/ui/modal`
- `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` from `@/components/ui/select`
- `TextField` accepts `label`, `helper`, `error`, all standard input props
- `Textarea` accepts `value`, `onChange`, `onBlur`, `disabled`, `rows`, `maxLength`, `placeholder`, `helper`, `error`
- `Checkbox` accepts `checked: boolean | "indeterminate"`, `onCheckedChange`, `disabled`, `label`, `aria-label`
- `Button` accepts `variant: "primary" | "ghost" | "secondary" | "destructive"`, `loading`, `disabled`, `size?: "sm"`, `leadingIcon?`
- `EmptyState` accepts `icon: IconName`, `title`, `subtitle`, `action?`, `dashedBorder?`
- `AlertBanner` accepts `variant: "info" | "warning" | "success" | "danger"`
- `Icon` accepts `name: IconName`, `size?: number`, `className?: string`
- `Badge` accepts `variant: "soft" | etc`, `semantic: "success" | "neutral" | "warning" | "danger"`

**Existing query keys (added in 4.A T10):**
```ts
queryKeys.ingredients()                                  // ["inventory", "ingredients"]
queryKeys.menuItems()                                    // ["inventory", "menu_items"]
queryKeys.recipes()                                      // ["inventory", "recipes"]
queryKeys.stockBalances()                                // ["inventory", "stock_balances"]
queryKeys.stockMovements(filter?)
queryKeys.recipeByMenuItem(menuItemId)
```

**Existing data layer functions (4.A T9):**
```ts
createIngredient(supabase, input) → Promise<string>
updateIngredient(supabase, input) → Promise<void>
deleteIngredient(supabase, id) → Promise<void>
createMenuItem(supabase, input) → Promise<string>
updateMenuItem(supabase, input) → Promise<void>
deleteMenuItem(supabase, id) → Promise<void>
// (plus 11 more for recipes/stock used in 4.C/4.D/4.E)
```

**Existing types (4.A T9):**
```ts
Ingredient { id, name, unit, low_stock_threshold, is_active, notes, created_at }
MenuItem   { id, name, external_product_name, is_active, notes, created_at, recipe_count? }
```

---

## File Structure

| File | Action | Touched in task |
|------|--------|------------------|
| `src/components/ui/icons.tsx` | Modify (additive: `package` icon) | T1 |
| `src/features/navigation/navigation.ts` | Modify (additive: `"inventory"` ViewKey + NAV_ITEMS + DEFAULT_SIDEBAR_BY_ROLE) | T1 |
| `src/features/inventory/units.ts` | Create — `STOCK_UNITS` + `STOCK_UNIT_LABELS_VI` | T1 |
| `src/hooks/mutations/use-inventory-mutations.ts` | Create — 6 mutation hooks | T1 |
| `src/features/inventory/inventory-action-buttons.tsx` | Create — shared row-actions component | T2 |
| `src/features/inventory/ingredient-form-modal.tsx` | Create — Ingredient create/edit modal | T3 |
| `src/features/inventory/ingredients-tab.tsx` | Create — Ingredients list + filter + actions | T4 |
| `src/features/inventory/menu-item-form-modal.tsx` | Create — MenuItem create/edit modal | T5 |
| `src/features/inventory/menu-items-tab.tsx` | Create — Menu items list + filter + actions | T5 |
| `src/features/inventory/inventory-view.tsx` | Create — top-level container with 5-tab Tabs | T6 |
| `src/app/page.tsx` | Modify (additive: wire `view === "inventory"`) | T7 |

**Off-limits:** `database/**`, `src/lib/data/**`, `src/lib/types.ts`, `src/hooks/queries/**`, Phase 2 primitives in `src/components/ui/*` except the icon addition, all prior-phase feature modules.

---

### Task 1: Foundation — icon + nav + units + 6 mutation hooks

**Files:**
- Modify: `src/components/ui/icons.tsx` (additive)
- Modify: `src/features/navigation/navigation.ts` (additive)
- Create: `src/features/inventory/units.ts`
- Create: `src/hooks/mutations/use-inventory-mutations.ts`

- [ ] **Step 1: Add `package` icon to `src/components/ui/icons.tsx`**

Read `src/components/ui/icons.tsx`. Find the lucide-react import block. Add `Package` to imports (alongside other Phase 4 icons or at the end of the existing block). Then add the entry in the `Icons` const.

Add to the import block:
```ts
  // Phase 4.B — inventory
  Package,
```

And in the `Icons` const:
```ts
  // Phase 4.B — inventory
  package: Package,
```

- [ ] **Step 2: Modify `src/features/navigation/navigation.ts` — 3 additive changes**

Open the file. Apply three changes:

**(a)** ViewKey union — add `"inventory"`. Find:
```ts
export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe"
  | "handover"
  | "reports" | "pivot" | "settings";
```

Replace with:
```ts
export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe"
  | "handover" | "inventory"
  | "reports" | "pivot" | "settings";
```

**(b)** NAV_ITEMS array — insert inventory entry between `handover` and `reports`. Find:
```ts
  { key: "handover",  label: "Bàn giao",      icon: "clipboardList",   roles: ["owner", "manager", "staff_operator"] },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"] },
```

Insert between them:
```ts
  { key: "handover",  label: "Bàn giao",      icon: "clipboardList",   roles: ["owner", "manager", "staff_operator"] },
  { key: "inventory", label: "Kho",           icon: "package",         roles: ["owner", "manager", "staff_operator"] },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"] },
```

**(c)** DEFAULT_SIDEBAR_BY_ROLE — insert `"inventory"` between `"handover"` and `"reports"` for 3 roles. Find:
```ts
export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "handover", "reports", "pivot", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "handover", "reports", "pivot", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "handover", "reports"],
  employee_viewer: ["dashboard"],
};
```

Replace with:
```ts
export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "handover", "inventory", "reports", "pivot", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports", "pivot", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports"],
  employee_viewer: ["dashboard"],
};
```

- [ ] **Step 3: Create `src/features/inventory/units.ts`**

```ts
/**
 * Phase 4.B — Stock units used by ingredients.
 *
 * Stored value in DB matches the constant string. The Vietnamese label is
 * used only for UI display (Select dropdown, row badge).
 */

export const STOCK_UNITS = ["kg", "g", "L", "ml", "each", "pack"] as const;

export type StockUnit = (typeof STOCK_UNITS)[number];

export const STOCK_UNIT_LABELS_VI: Record<StockUnit, string> = {
  kg: "Kg",
  g: "Gram",
  L: "Lít",
  ml: "Mililit",
  each: "Cái",
  pack: "Gói",
};

/**
 * Look up the Vietnamese label for a stored unit. Falls back to the raw
 * value when the unit is unknown (e.g., legacy data with a custom unit).
 */
export function formatUnit(unit: string): string {
  return (STOCK_UNIT_LABELS_VI as Record<string, string>)[unit] ?? unit;
}
```

- [ ] **Step 4: Create `src/hooks/mutations/use-inventory-mutations.ts`**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createIngredient,
  updateIngredient,
  deleteIngredient,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for Phase 4.B Masters UI (ingredients + menu_items).
 *
 * Pattern: null-supabase guard with Vietnamese error, then call the
 * data-layer wrapper. On success, invalidate relevant query keys.
 *
 * Conservative invalidation:
 *   - useUpdateIngredient invalidates stockBalances too (unit or
 *     low_stock_threshold may change → dashboard refresh needed).
 *   - useUpdateMenuItem invalidates recipes too (menu_item_name is
 *     joined in list_recipes output).
 *
 * Recipe / stock mutation hooks are deferred to Phase 4.C / 4.D.
 */

// ----------------------- Ingredients -----------------------------------

export interface CreateIngredientInput {
  name: string;
  unit: string;
  low_stock_threshold?: number | null;
  notes?: string | null;
}

export function useCreateIngredient(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateIngredientInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createIngredient(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredients() });
    },
  });
}

export interface UpdateIngredientInput {
  id: string;
  name: string;
  unit: string;
  low_stock_threshold: number | null;
  notes: string | null;
  is_active: boolean;
}

export function useUpdateIngredient(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateIngredientInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateIngredient(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredients() });
      // Conservative: unit or threshold may have changed → dashboard refresh
      queryClient.invalidateQueries({ queryKey: queryKeys.stockBalances() });
    },
  });
}

export interface DeleteIngredientInput {
  id: string;
}

export function useDeleteIngredient(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteIngredientInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteIngredient(supabase, input.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredients() });
    },
  });
}

// ----------------------- Menu items ------------------------------------

export interface CreateMenuItemInput {
  name: string;
  external_product_name?: string | null;
  notes?: string | null;
}

export function useCreateMenuItem(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMenuItemInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createMenuItem(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}

export interface UpdateMenuItemInput {
  id: string;
  name: string;
  external_product_name: string | null;
  notes: string | null;
  is_active: boolean;
}

export function useUpdateMenuItem(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateMenuItemInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateMenuItem(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
      // Conservative: menu_item_name is joined in list_recipes output
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes() });
    },
  });
}

export interface DeleteMenuItemInput {
  id: string;
}

export function useDeleteMenuItem(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteMenuItemInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteMenuItem(supabase, input.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 6: Smoke test verify:phase**

```bash
npm run verify:phase
```

Expected: 75 Vitest + 89 pgTAP = 164 green. No regressions from foundation additions.

- [ ] **Step 7: Commit**

```powershell
$msg = @'
feat(phase-4b): foundation — icon + nav + units + 6 mutation hooks

- src/components/ui/icons.tsx: add `package` (additive)
- src/features/navigation/navigation.ts: add "inventory" to ViewKey +
  NAV_ITEMS entry (label "Kho", icon package, roles staff+) +
  DEFAULT_SIDEBAR_BY_ROLE for 3 non-viewer roles (additive)
- src/features/inventory/units.ts: STOCK_UNITS constant +
  STOCK_UNIT_LABELS_VI map + formatUnit helper
- src/hooks/mutations/use-inventory-mutations.ts: 6 hooks following
  the use-handover-mutations.ts template
  - useCreateIngredient / useUpdateIngredient / useDeleteIngredient
  - useCreateMenuItem / useUpdateMenuItem / useDeleteMenuItem

Conservative invalidation:
- useUpdateIngredient invalidates stockBalances too (unit/threshold may
  change → dashboard refresh)
- useUpdateMenuItem invalidates recipes too (menu_item_name joined in
  list_recipes output)

Settings role-matrix will auto-render a new "Kho" row after this ships
(dynamic NAV_ITEMS iteration in 3C.2).

verify:phase still 75 Vitest + 89 pgTAP = 164 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/components/ui/icons.tsx src/features/navigation/navigation.ts src/features/inventory/units.ts src/hooks/mutations/use-inventory-mutations.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 2: InventoryActionButtons shared component

**Files:**
- Create: `src/features/inventory/inventory-action-buttons.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

interface InventoryActionButtonsProps {
  /** Whether the row's target entity is currently is_active=true. */
  isActive: boolean;
  /** Click handler for the "Sửa" button (opens edit modal). */
  onEdit(): void;
  /** Click handler for the toggle button. */
  onToggleActive(): void;
  /** Click handler for the delete button (triggers inline confirm in parent). */
  onDelete(): void;
  /** When any mutation is in-flight on this row, disable all buttons. */
  isBusy?: boolean;
  /** When true, returns null — used to hide controls for staff_operator. */
  hidden?: boolean;
}

/**
 * Phase 4.B — Shared row-actions cluster for ingredients + menu_items.
 *
 * Renders three buttons:
 *   [ Sửa ]  [ Vô hiệu hóa | Kích hoạt ]  [ 🗑 ]
 *
 * The toggle label switches based on `isActive`.
 * Delete is an icon-only button (parent component shows the inline
 * AlertBanner confirmation when clicked).
 *
 * Returns null when `hidden === true` (read-only mode for staff_operator).
 */
export function InventoryActionButtons({
  isActive,
  onEdit,
  onToggleActive,
  onDelete,
  isBusy = false,
  hidden = false,
}: InventoryActionButtonsProps) {
  if (hidden) return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onEdit}
        disabled={isBusy}
      >
        Sửa
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onToggleActive}
        disabled={isBusy}
      >
        {isActive ? "Vô hiệu hóa" : "Kích hoạt"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        disabled={isBusy}
        aria-label="Xóa"
      >
        <Icon name="trash" size={16} />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4b): InventoryActionButtons shared row-actions

3-button cluster (Sửa / Vô hiệu hóa-Kích hoạt / 🗑) reused by both
IngredientsTab and MenuItemsTab.

Props:
- isActive: drives the toggle label
- onEdit / onToggleActive / onDelete: parent-supplied handlers
- isBusy: disables all buttons during mutation in-flight
- hidden: returns null (used to hide controls for staff_operator)

Delete is icon-only (parent renders inline AlertBanner confirm).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/inventory-action-buttons.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 3: IngredientFormModal

**Files:**
- Create: `src/features/inventory/ingredient-form-modal.tsx`

- [ ] **Step 1: Create the file**

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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useCreateIngredient,
  useUpdateIngredient,
} from "@/hooks/mutations/use-inventory-mutations";
import { STOCK_UNITS, STOCK_UNIT_LABELS_VI } from "./units";
import type { Ingredient } from "@/lib/types";

interface IngredientFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Null = create mode. Non-null = edit mode (form prefills from this). */
  editingIngredient: Ingredient | null;
}

const MIN_NAME_LEN = 1;
const MAX_NAME_LEN = 100;

/**
 * Phase 4.B — Ingredient create/edit modal.
 *
 * Form fields:
 *   - name (required, trimmed)
 *   - unit (required, Select from STOCK_UNITS)
 *   - low_stock_threshold (optional, must be > 0 if set)
 *   - notes (optional)
 *   - is_active (Checkbox, only shown in edit mode)
 *
 * Initialization: form state is initialized once on modal open via
 * useEffect([open, editingIngredient]). Refetch-driven prop changes do
 * NOT clobber user edits (matches HandoverNoteEditor pattern from 3C.3).
 *
 * Submit: client-side validation for quick feedback, then mutation.
 * Backend remains authoritative; on error, toast surfaces the error
 * message verbatim. Modal stays open during in-flight and on error;
 * closes on success.
 */
export function IngredientFormModal({
  open,
  onOpenChange,
  editingIngredient,
}: IngredientFormModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateIngredient(supabase);
  const updateM = useUpdateIngredient(supabase);

  const isEdit = editingIngredient !== null;

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>(STOCK_UNITS[0]);
  const [thresholdInput, setThresholdInput] = useState(""); // string for empty-vs-zero distinction
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Initialize on open / edit target change.
  useEffect(() => {
    if (!open) return;
    if (editingIngredient) {
      setName(editingIngredient.name);
      setUnit(editingIngredient.unit);
      setThresholdInput(
        editingIngredient.low_stock_threshold != null
          ? String(editingIngredient.low_stock_threshold)
          : ""
      );
      setNotes(editingIngredient.notes ?? "");
      setIsActive(editingIngredient.is_active);
    } else {
      setName("");
      setUnit(STOCK_UNITS[0]);
      setThresholdInput("");
      setNotes("");
      setIsActive(true);
    }
  }, [open, editingIngredient]);

  const trimmedName = name.trim();
  const nameValid =
    trimmedName.length >= MIN_NAME_LEN && trimmedName.length <= MAX_NAME_LEN;

  const thresholdValue: number | null =
    thresholdInput.trim() === "" ? null : Number(thresholdInput);
  const thresholdValid =
    thresholdValue === null ||
    (!Number.isNaN(thresholdValue) && thresholdValue > 0);

  const isBusy = createM.isPending || updateM.isPending;
  const canSubmit = nameValid && thresholdValid && !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      if (isEdit && editingIngredient) {
        await updateM.mutateAsync({
          id: editingIngredient.id,
          name: trimmedName,
          unit,
          low_stock_threshold: thresholdValue,
          notes: notes.trim() === "" ? null : notes.trim(),
          is_active: isActive,
        });
        toast({ semantic: "success", message: "Đã lưu nguyên liệu." });
      } else {
        await createM.mutateAsync({
          name: trimmedName,
          unit,
          low_stock_threshold: thresholdValue,
          notes: notes.trim() === "" ? null : notes.trim(),
        });
        toast({ semantic: "success", message: "Đã thêm nguyên liệu." });
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Có lỗi khi lưu.";
      toast({
        semantic: "danger",
        message: msg.includes("duplicate")
          ? "Tên nguyên liệu đã tồn tại."
          : msg,
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>
          {isEdit ? "Sửa nguyên liệu" : "Thêm nguyên liệu"}
        </ModalTitle>
        <ModalDescription>
          {isEdit
            ? "Cập nhật thông tin nguyên liệu. Có thể tạm thời ngưng dùng nếu chưa muốn xóa."
            : "Thêm nguyên liệu mới vào kho. Số lượng tồn sẽ tính tự động từ các giao dịch."}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên nguyên liệu"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBusy}
            maxLength={MAX_NAME_LEN + 20}
            placeholder="VD: Sữa tươi"
            error={
              trimmedName.length > 0 && !nameValid
                ? `Tên phải từ ${MIN_NAME_LEN} đến ${MAX_NAME_LEN} ký tự.`
                : undefined
            }
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">Đơn vị</label>
            <Select value={unit} onValueChange={setUnit} disabled={isBusy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {STOCK_UNIT_LABELS_VI[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TextField
            label="Ngưỡng cảnh báo (tùy chọn)"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            disabled={isBusy}
            placeholder="Để trống = không cảnh báo"
            helper={`Cảnh báo khi tồn dưới mức này (đơn vị: ${STOCK_UNIT_LABELS_VI[unit as keyof typeof STOCK_UNIT_LABELS_VI] ?? unit})`}
            error={
              thresholdInput.trim() !== "" && !thresholdValid
                ? "Ngưỡng phải là số dương."
                : undefined
            }
          />

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={3}
            maxLength={500}
            placeholder="Ghi chú thêm (vd: hãng, quy cách đóng gói...)"
            helper="Tùy chọn — hiển thị dưới tên trong danh sách"
          />

          {isEdit && (
            <Checkbox
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
              disabled={isBusy}
              label="Đang dùng"
            />
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
              disabled={!canSubmit}
            >
              {isEdit ? "Lưu" : "Thêm"}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4b): IngredientFormModal (create + edit modes)

Modal form with 5 fields:
- name (required, trimmed, length 1-100)
- unit (Select from STOCK_UNITS, displays Vietnamese labels)
- low_stock_threshold (optional, number, must be > 0 if set)
- notes (optional, max 500 chars)
- is_active (Checkbox, only shown in edit mode)

Initialization: useEffect([open, editingIngredient]) seeds form state
once per open. Refetch doesn't clobber edits (matches HandoverNoteEditor
pattern from 3C.3).

Submit: client validation for quick feedback, mutation via 4.B hooks.
On duplicate error, toast wraps backend message as "Tên nguyên liệu đã
tồn tại." For other errors, surfaces raw err.message verbatim.

Modal stays open during in-flight and on error; closes on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/ingredient-form-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 4: IngredientsTab

**Files:**
- Create: `src/features/inventory/ingredients-tab.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useIngredientsQuery } from "@/hooks/queries";
import {
  useUpdateIngredient,
  useDeleteIngredient,
} from "@/hooks/mutations/use-inventory-mutations";
import { formatUnit } from "./units";
import { InventoryActionButtons } from "./inventory-action-buttons";
import { IngredientFormModal } from "./ingredient-form-modal";
import type { Ingredient, UserRole } from "@/lib/types";

interface IngredientsTabProps {
  role: UserRole;
}

/**
 * Phase 4.B — Ingredients tab content.
 *
 * Layout:
 *   Header row: [✓] Hiện cả ngưng dùng    [+ Thêm nguyên liệu] (owner/manager only)
 *   Loading / Error / Empty / Data states
 *   Each row: icon + name + unit + threshold + notes + action buttons
 *
 * Filter: showInactive (default false) hides is_active=false rows.
 * When filter OFF and inactive_count > 0, an info banner shows the count.
 *
 * Delete: per-row click → row shows inline AlertBanner.warning + 2 buttons
 * (Hủy / Xác nhận xóa). On error (references exist), toast.danger surfaces
 * the backend Vietnamese message and the row collapses back.
 *
 * Write controls (Thêm, Sửa, Vô hiệu hóa, Xóa) hidden for staff_operator.
 */
export function IngredientsTab({ role }: IngredientsTabProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const ingredientsQuery = useIngredientsQuery(supabase);
  const updateM = useUpdateIngredient(supabase);
  const deleteM = useDeleteIngredient(supabase);

  const canWrite = role === "owner" || role === "manager";

  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const ingredients = ingredientsQuery.data ?? [];

  const inactiveCount = useMemo(
    () => ingredients.filter((i) => !i.is_active).length,
    [ingredients]
  );

  const visible = useMemo(
    () => (showInactive ? ingredients : ingredients.filter((i) => i.is_active)),
    [ingredients, showInactive]
  );

  function handleOpenCreate() {
    setEditingIngredient(null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(ing: Ingredient) {
    setEditingIngredient(ing);
    setIsModalOpen(true);
  }

  async function handleToggleActive(ing: Ingredient) {
    if (busyRowId || !canWrite) return;
    setBusyRowId(ing.id);
    try {
      await updateM.mutateAsync({
        id: ing.id,
        name: ing.name,
        unit: ing.unit,
        low_stock_threshold: ing.low_stock_threshold,
        notes: ing.notes,
        is_active: !ing.is_active,
      });
      toast({
        semantic: "success",
        message: ing.is_active ? "Đã vô hiệu hóa." : "Đã kích hoạt.",
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi cập nhật.",
      });
    } finally {
      setBusyRowId(null);
    }
  }

  function handleStartDelete(ing: Ingredient) {
    setDeletingId(ing.id);
  }

  function handleCancelDelete() {
    setDeletingId(null);
  }

  async function handleConfirmDelete(ing: Ingredient) {
    if (busyRowId) return;
    setBusyRowId(ing.id);
    try {
      await deleteM.mutateAsync({ id: ing.id });
      toast({ semantic: "success", message: "Đã xóa." });
      setDeletingId(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi xóa.",
      });
      setDeletingId(null);
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          checked={showInactive}
          onCheckedChange={(checked) => setShowInactive(checked === true)}
          label="Hiện cả ngưng dùng"
        />
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            onClick={handleOpenCreate}
            leadingIcon={<Icon name="plus" size={16} />}
          >
            Thêm nguyên liệu
          </Button>
        )}
      </div>

      {/* Filter info banner */}
      {!showInactive && inactiveCount > 0 && (
        <AlertBanner variant="info">
          Đang ẩn {inactiveCount} nguyên liệu đã ngưng dùng. Bật &quot;Hiện cả
          ngưng dùng&quot; để xem.
        </AlertBanner>
      )}

      {/* Loading / Error / Empty / Data branches */}
      {ingredientsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : ingredientsQuery.isError ? (
        <AlertBanner variant="danger">
          Không tải được danh sách nguyên liệu. Vui lòng tải lại trang.
        </AlertBanner>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="package"
          title="Chưa có nguyên liệu nào"
          subtitle={
            canWrite
              ? "Bấm 'Thêm nguyên liệu' để bắt đầu."
              : "Owner/manager có thể thêm nguyên liệu mới."
          }
          dashedBorder
        />
      ) : (
        <div className="space-y-2">
          {visible.map((ing) => {
            const isDeletingThis = deletingId === ing.id;
            const isRowBusy = busyRowId === ing.id;

            if (isDeletingThis) {
              return (
                <Card key={ing.id}>
                  <CardBody className="space-y-3">
                    <AlertBanner variant="warning">
                      Xóa &quot;{ing.name}&quot; vĩnh viễn? Nếu nguyên liệu đã
                      có giao dịch tồn kho, hệ thống sẽ chặn xóa và gợi ý vô
                      hiệu hóa thay.
                    </AlertBanner>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleCancelDelete}
                        disabled={isRowBusy}
                      >
                        Hủy
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        loading={isRowBusy}
                        onClick={() => handleConfirmDelete(ing)}
                      >
                        Xác nhận xóa
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              );
            }

            return (
              <Card key={ing.id} className={!ing.is_active ? "opacity-70" : ""}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon name="package" size={20} className="text-muted mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-ink truncate">
                            {ing.name}
                          </p>
                          <Badge
                            variant="soft"
                            semantic={ing.is_active ? "success" : "neutral"}
                          >
                            {ing.is_active ? "Đang dùng" : "Ngưng dùng"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted mt-1">
                          Đơn vị: {formatUnit(ing.unit)}
                          {ing.low_stock_threshold != null && (
                            <>
                              {" · "}Cảnh báo dưới {ing.low_stock_threshold}{" "}
                              {formatUnit(ing.unit)}
                            </>
                          )}
                        </p>
                        {ing.notes && (
                          <p className="text-xs text-muted mt-0.5 truncate">
                            {ing.notes}
                          </p>
                        )}
                      </div>
                    </div>
                    <InventoryActionButtons
                      isActive={ing.is_active}
                      onEdit={() => handleOpenEdit(ing)}
                      onToggleActive={() => handleToggleActive(ing)}
                      onDelete={() => handleStartDelete(ing)}
                      isBusy={isRowBusy}
                      hidden={!canWrite}
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <IngredientFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        editingIngredient={editingIngredient}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4b): IngredientsTab list + filter + row actions

- Header: showInactive Checkbox + "Thêm nguyên liệu" Button (canWrite only)
- AlertBanner.info shows hidden inactive count when filter is OFF
- 4-branch render: Loading (Spinner) / Error (AlertBanner.danger) / Empty
  (EmptyState dashed) / Data (Card list)
- Each row: package icon + name + Đang dùng/Ngưng dùng badge + unit +
  threshold + notes + InventoryActionButtons
- Inactive rows muted (opacity-70)
- Toggle active: useUpdateIngredient with is_active flipped, toast feedback
- Delete: inline AlertBanner.warning + Hủy/Xác nhận xóa buttons; on
  references-exist error, toast.danger surfaces backend Vietnamese
  message and row collapses back

Write controls hidden via InventoryActionButtons hidden={!canWrite} for
staff_operator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/ingredients-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 5: MenuItemFormModal + MenuItemsTab

**Files:**
- Create: `src/features/inventory/menu-item-form-modal.tsx`
- Create: `src/features/inventory/menu-items-tab.tsx`

- [ ] **Step 1: Create `src/features/inventory/menu-item-form-modal.tsx`**

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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useCreateMenuItem,
  useUpdateMenuItem,
} from "@/hooks/mutations/use-inventory-mutations";
import type { MenuItem } from "@/lib/types";

interface MenuItemFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Null = create mode. Non-null = edit mode. */
  editingMenuItem: MenuItem | null;
}

const MIN_NAME_LEN = 1;
const MAX_NAME_LEN = 100;
const MAX_EXT_NAME_LEN = 200;

/**
 * Phase 4.B — Menu item create/edit modal.
 *
 * Fields:
 *   - name (required, trimmed)
 *   - external_product_name (optional, max 200 chars; helper explains
 *     the KiotViet matching rule)
 *   - notes (optional)
 *   - is_active (Checkbox, only shown in edit mode)
 *
 * Same lifecycle as IngredientFormModal: init on open, modal stays open
 * during in-flight, closes on success.
 */
export function MenuItemFormModal({
  open,
  onOpenChange,
  editingMenuItem,
}: MenuItemFormModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateMenuItem(supabase);
  const updateM = useUpdateMenuItem(supabase);

  const isEdit = editingMenuItem !== null;

  const [name, setName] = useState("");
  const [externalName, setExternalName] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editingMenuItem) {
      setName(editingMenuItem.name);
      setExternalName(editingMenuItem.external_product_name ?? "");
      setNotes(editingMenuItem.notes ?? "");
      setIsActive(editingMenuItem.is_active);
    } else {
      setName("");
      setExternalName("");
      setNotes("");
      setIsActive(true);
    }
  }, [open, editingMenuItem]);

  const trimmedName = name.trim();
  const trimmedExt = externalName.trim();
  const nameValid =
    trimmedName.length >= MIN_NAME_LEN && trimmedName.length <= MAX_NAME_LEN;
  const extValid = trimmedExt.length <= MAX_EXT_NAME_LEN;

  const isBusy = createM.isPending || updateM.isPending;
  const canSubmit = nameValid && extValid && !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const extValue = trimmedExt === "" ? null : trimmedExt;
    const notesValue = notes.trim() === "" ? null : notes.trim();

    try {
      if (isEdit && editingMenuItem) {
        await updateM.mutateAsync({
          id: editingMenuItem.id,
          name: trimmedName,
          external_product_name: extValue,
          notes: notesValue,
          is_active: isActive,
        });
        toast({ semantic: "success", message: "Đã lưu sản phẩm." });
      } else {
        await createM.mutateAsync({
          name: trimmedName,
          external_product_name: extValue,
          notes: notesValue,
        });
        toast({ semantic: "success", message: "Đã thêm sản phẩm." });
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Có lỗi khi lưu.";
      toast({
        semantic: "danger",
        message: msg.includes("duplicate") ? "Tên sản phẩm đã tồn tại." : msg,
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>{isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm"}</ModalTitle>
        <ModalDescription>
          {isEdit
            ? "Cập nhật thông tin sản phẩm trong v4."
            : "Thêm sản phẩm để liên kết với công thức và tự động trừ kho khi bán."}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên sản phẩm (trong v4)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBusy}
            maxLength={MAX_NAME_LEN + 20}
            placeholder="VD: Cà phê đen đá M"
            error={
              trimmedName.length > 0 && !nameValid
                ? `Tên phải từ ${MIN_NAME_LEN} đến ${MAX_NAME_LEN} ký tự.`
                : undefined
            }
          />

          <TextField
            label="Tên sản phẩm KiotViet (tùy chọn)"
            value={externalName}
            onChange={(e) => setExternalName(e.target.value)}
            disabled={isBusy}
            maxLength={MAX_EXT_NAME_LEN + 20}
            placeholder="VD: Cafe den da M"
            helper="Tên sản phẩm KiotViet phải khớp (không phân biệt hoa thường, đã trim). Để trống = chưa khớp với KiotViet."
            error={
              trimmedExt.length > 0 && !extValid
                ? `Tên KiotViet tối đa ${MAX_EXT_NAME_LEN} ký tự.`
                : undefined
            }
          />

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={3}
            maxLength={500}
            placeholder="Ghi chú thêm (vd: size, biến thể...)"
            helper="Tùy chọn — hiển thị dưới tên trong danh sách"
          />

          {isEdit && (
            <Checkbox
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
              disabled={isBusy}
              label="Đang dùng"
            />
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
              disabled={!canSubmit}
            >
              {isEdit ? "Lưu" : "Thêm"}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Create `src/features/inventory/menu-items-tab.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useMenuItemsQuery } from "@/hooks/queries";
import {
  useUpdateMenuItem,
  useDeleteMenuItem,
} from "@/hooks/mutations/use-inventory-mutations";
import { InventoryActionButtons } from "./inventory-action-buttons";
import { MenuItemFormModal } from "./menu-item-form-modal";
import type { MenuItem, UserRole } from "@/lib/types";

interface MenuItemsTabProps {
  role: UserRole;
}

/**
 * Phase 4.B — Menu items tab content.
 *
 * Mirrors IngredientsTab structure: filter toggle + create button + list
 * with row actions + inline delete confirm.
 *
 * Differences vs IngredientsTab:
 *   - Different icon (still `package` since lucide doesn't have a great
 *     menu-item icon; could swap later)
 *   - Shows `external_product_name` as secondary line when present
 *   - Shows `recipe_count` badge if > 0
 *   - Delete error message references "công thức" instead of "tồn kho"
 */
export function MenuItemsTab({ role }: MenuItemsTabProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const menuItemsQuery = useMenuItemsQuery(supabase);
  const updateM = useUpdateMenuItem(supabase);
  const deleteM = useDeleteMenuItem(supabase);

  const canWrite = role === "owner" || role === "manager";

  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const menuItems = menuItemsQuery.data ?? [];

  const inactiveCount = useMemo(
    () => menuItems.filter((m) => !m.is_active).length,
    [menuItems]
  );

  const visible = useMemo(
    () => (showInactive ? menuItems : menuItems.filter((m) => m.is_active)),
    [menuItems, showInactive]
  );

  function handleOpenCreate() {
    setEditingMenuItem(null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(m: MenuItem) {
    setEditingMenuItem(m);
    setIsModalOpen(true);
  }

  async function handleToggleActive(m: MenuItem) {
    if (busyRowId || !canWrite) return;
    setBusyRowId(m.id);
    try {
      await updateM.mutateAsync({
        id: m.id,
        name: m.name,
        external_product_name: m.external_product_name,
        notes: m.notes,
        is_active: !m.is_active,
      });
      toast({
        semantic: "success",
        message: m.is_active ? "Đã vô hiệu hóa." : "Đã kích hoạt.",
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi cập nhật.",
      });
    } finally {
      setBusyRowId(null);
    }
  }

  function handleStartDelete(m: MenuItem) {
    setDeletingId(m.id);
  }

  function handleCancelDelete() {
    setDeletingId(null);
  }

  async function handleConfirmDelete(m: MenuItem) {
    if (busyRowId) return;
    setBusyRowId(m.id);
    try {
      await deleteM.mutateAsync({ id: m.id });
      toast({ semantic: "success", message: "Đã xóa." });
      setDeletingId(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi xóa.",
      });
      setDeletingId(null);
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          checked={showInactive}
          onCheckedChange={(checked) => setShowInactive(checked === true)}
          label="Hiện cả ngưng dùng"
        />
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            onClick={handleOpenCreate}
            leadingIcon={<Icon name="plus" size={16} />}
          >
            Thêm sản phẩm
          </Button>
        )}
      </div>

      {!showInactive && inactiveCount > 0 && (
        <AlertBanner variant="info">
          Đang ẩn {inactiveCount} sản phẩm đã ngưng dùng. Bật &quot;Hiện cả
          ngưng dùng&quot; để xem.
        </AlertBanner>
      )}

      {menuItemsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : menuItemsQuery.isError ? (
        <AlertBanner variant="danger">
          Không tải được danh sách sản phẩm. Vui lòng tải lại trang.
        </AlertBanner>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="package"
          title="Chưa có sản phẩm nào"
          subtitle={
            canWrite
              ? "Bấm 'Thêm sản phẩm' để bắt đầu."
              : "Owner/manager có thể thêm sản phẩm mới."
          }
          dashedBorder
        />
      ) : (
        <div className="space-y-2">
          {visible.map((m) => {
            const isDeletingThis = deletingId === m.id;
            const isRowBusy = busyRowId === m.id;

            if (isDeletingThis) {
              return (
                <Card key={m.id}>
                  <CardBody className="space-y-3">
                    <AlertBanner variant="warning">
                      Xóa &quot;{m.name}&quot; vĩnh viễn? Nếu sản phẩm đang có
                      công thức, hệ thống sẽ chặn xóa và gợi ý xóa công thức
                      trước.
                    </AlertBanner>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleCancelDelete}
                        disabled={isRowBusy}
                      >
                        Hủy
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        loading={isRowBusy}
                        onClick={() => handleConfirmDelete(m)}
                      >
                        Xác nhận xóa
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              );
            }

            return (
              <Card key={m.id} className={!m.is_active ? "opacity-70" : ""}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon
                        name="package"
                        size={20}
                        className="text-muted mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-ink truncate">
                            {m.name}
                          </p>
                          <Badge
                            variant="soft"
                            semantic={m.is_active ? "success" : "neutral"}
                          >
                            {m.is_active ? "Đang dùng" : "Ngưng dùng"}
                          </Badge>
                          {typeof m.recipe_count === "number" && m.recipe_count > 0 && (
                            <Badge variant="soft" semantic="success">
                              Có công thức
                            </Badge>
                          )}
                        </div>
                        {m.external_product_name && (
                          <p className="text-xs text-muted mt-1">
                            Tên KiotViet:{" "}
                            <span className="font-mono">
                              {m.external_product_name}
                            </span>
                          </p>
                        )}
                        {!m.external_product_name && (
                          <p className="text-xs text-warning mt-1">
                            Chưa khớp với KiotViet
                          </p>
                        )}
                        {m.notes && (
                          <p className="text-xs text-muted mt-0.5 truncate">
                            {m.notes}
                          </p>
                        )}
                      </div>
                    </div>
                    <InventoryActionButtons
                      isActive={m.is_active}
                      onEdit={() => handleOpenEdit(m)}
                      onToggleActive={() => handleToggleActive(m)}
                      onDelete={() => handleStartDelete(m)}
                      isBusy={isRowBusy}
                      hidden={!canWrite}
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <MenuItemFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        editingMenuItem={editingMenuItem}
      />
    </div>
  );
}
```

**Note for the implementer:** `text-warning` may not exist as a token. If TypeScript / Tailwind error on `text-warning`, replace with `text-muted` and prepend an inline icon or italic style — or check `src/components/ui/alert-banner.tsx` to see the actual warning color class used elsewhere and reuse it.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors. If `text-warning` fails, adjust per the note above and re-run.

- [ ] **Step 4: Commit**

```powershell
$msg = @'
feat(phase-4b): MenuItemFormModal + MenuItemsTab

MenuItemFormModal:
- name (required, 1-100 chars)
- external_product_name (optional, max 200; helper explains KiotViet
  matching rule: case-insensitive trimmed; empty = unmatched)
- notes (optional)
- is_active (Checkbox in edit mode)

MenuItemsTab:
- Mirrors IngredientsTab structure
- Shows external_product_name in secondary line OR
  "Chưa khớp với KiotViet" warning when null
- Shows "Có công thức" badge when recipe_count > 0
- Delete confirm references "công thức" (matches backend hard-fail
  error message wording)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/menu-item-form-modal.tsx src/features/inventory/menu-items-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 6: InventoryView container

**Files:**
- Create: `src/features/inventory/inventory-view.tsx`

- [ ] **Step 1: Create the file**

```tsx
"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
import type { UserRole } from "@/lib/types";

interface InventoryViewProps {
  role: UserRole;
}

/**
 * Phase 4.B — Top-level inventory container.
 *
 * Defense-in-depth role gate: NAV_ITEMS already filters at the sidebar
 * level (employee_viewer doesn't see "Kho"). If URL-navigated directly,
 * we render a lock EmptyState.
 *
 * Structure: 5-tab Radix Tabs. 4.B fills tabs 1 + 2; tabs 3, 4, 5 are
 * EmptyState placeholders awaiting Phase 4.C / 4.D / 4.E content.
 *
 * Role-based UI within each tab:
 *   - owner / manager: full CRUD
 *   - staff_operator: read-only Masters (write controls hidden)
 */
export function InventoryView({ role }: InventoryViewProps) {
  if (role === "employee_viewer") {
    return (
      <EmptyState
        icon="lock"
        title="Kho dành cho staff trở lên"
        subtitle="Module này dành cho nhân viên vận hành, manager và owner."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="ingredients">
        <TabsList>
          <TabsTrigger value="ingredients">Nguyên liệu</TabsTrigger>
          <TabsTrigger value="menu_items">Sản phẩm</TabsTrigger>
          <TabsTrigger value="recipes">Công thức</TabsTrigger>
          <TabsTrigger value="stock">Tồn kho</TabsTrigger>
          <TabsTrigger value="dashboard">Tổng quan</TabsTrigger>
        </TabsList>

        <TabsContent value="ingredients">
          <IngredientsTab role={role} />
        </TabsContent>

        <TabsContent value="menu_items">
          <MenuItemsTab role={role} />
        </TabsContent>

        <TabsContent value="recipes">
          <EmptyState
            icon="checkCircle"
            title="Công thức"
            subtitle="Phát hành trong giai đoạn 4.C — xây dựng công thức gắn sản phẩm với nguyên liệu."
            dashedBorder
          />
        </TabsContent>

        <TabsContent value="stock">
          <EmptyState
            icon="package"
            title="Tồn kho"
            subtitle="Phát hành trong giai đoạn 4.D — kiểm kê + sổ nhập xuất + điều chỉnh thủ công."
            dashedBorder
          />
        </TabsContent>

        <TabsContent value="dashboard">
          <EmptyState
            icon="barChart3"
            title="Tổng quan kho"
            subtitle="Phát hành trong giai đoạn 4.E — cảnh báo sắp hết, chênh lệch lý thuyết-thực tế, tiêu thụ theo thời gian."
            dashedBorder
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors. If `lock` or `barChart3` icons don't exist in the registry, swap to `info` or another existing icon and continue.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4b): InventoryView container with 5-tab Radix Tabs

- Defense-in-depth gate: employee_viewer sees EmptyState.lock
- 5 tabs: Nguyên liệu | Sản phẩm | Công thức | Tồn kho | Tổng quan
- 4.B fills tabs 1+2 (IngredientsTab + MenuItemsTab)
- Tabs 3, 4, 5 are EmptyState placeholders with dashed border, each
  explaining which future phase will populate them (4.C / 4.D / 4.E)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/inventory-view.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 7: page.tsx wire + final verify + tag

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Modify `src/app/page.tsx`**

Find the existing import block. Add:
```ts
import { InventoryView } from "@/features/inventory/inventory-view";
```

Place this near the other feature view imports — match the existing import ordering (likely after `HandoverView`, before `SettingsView` to mirror the NAV_ITEMS order).

Then find the dispatcher block where the views are routed. Find:
```tsx
        {view === "handover" && (
          <HandoverView businessDate={businessDate} role={account.role} />
        )}
        {view === "settings" && <SettingsView role={account.role} />}
```

Insert between them:
```tsx
        {view === "handover" && (
          <HandoverView businessDate={businessDate} role={account.role} />
        )}
        {view === "inventory" && <InventoryView role={account.role} />}
        {view === "settings" && <SettingsView role={account.role} />}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | Select-Object -Last 30
```

Expected: build succeeds. No errors.

- [ ] **Step 4: Run final verify:phase**

```bash
npm run verify:phase
```

Expected: `Vitest 75/75 + pgTAP 89/89 = 164 total`, exit 0. No regression from UI additions (no backend changes in 4.B).

- [ ] **Step 5: Verify file manifest**

```bash
git diff main..HEAD --name-only
```

Expected exactly these 12 files (relative to main = v4-phase-4a):
- `docs/superpowers/specs/2026-05-21-v4-phase-4b-masters-ui-design.md`
- `docs/superpowers/plans/2026-05-21-v4-phase-4b-masters-ui.md`
- `src/components/ui/icons.tsx` (modified)
- `src/features/navigation/navigation.ts` (modified)
- `src/features/inventory/units.ts`
- `src/features/inventory/inventory-action-buttons.tsx`
- `src/features/inventory/ingredient-form-modal.tsx`
- `src/features/inventory/ingredients-tab.tsx`
- `src/features/inventory/menu-item-form-modal.tsx`
- `src/features/inventory/menu-items-tab.tsx`
- `src/features/inventory/inventory-view.tsx`
- `src/hooks/mutations/use-inventory-mutations.ts`
- `src/app/page.tsx` (modified)

If any **off-limits** file appears (`database/**`, `src/lib/data/**`, `src/lib/types.ts`, `src/hooks/queries/**`, any other feature module), STOP and revert.

- [ ] **Step 6: Place tag**

```bash
git tag v4-phase-4b
git tag --list v4-phase-4b
```

- [ ] **Step 7: Re-tag to HEAD (3C.1 retrospective lesson)**

```bash
git tag -f v4-phase-4b HEAD
git show v4-phase-4b --stat --no-patch | Select-Object -First 5
```

Confirm the tag points to the page.tsx wire commit (T7), not T6's InventoryView commit.

- [ ] **Step 8: Commit page.tsx wire**

```powershell
$msg = @'
feat(phase-4b): page.tsx wire for InventoryView + tag v4-phase-4b

- Import InventoryView between HandoverView and SettingsView
- Wire view === "inventory" → <InventoryView role={account.role} />

Final: 75 Vitest + 89 pgTAP = 164 assertions green.

Tag: v4-phase-4b (closes Phase 4.B Masters UI).
After merging this branch, Phase 4 progress:
  - 4.A Backend (5 tables, 12 RPCs, trigger, RLS, types, data, hooks) ✓
  - 4.B Masters UI (Ingredients + Menu Items CRUD) ✓ — THIS PHASE
  - 4.C Recipes UI — next
  - 4.D Stock counting + ledger UI — pending
  - 4.E Inventory dashboard — pending

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/app/page.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

**Note on step ordering:** Step 6 places the tag BEFORE the final commit (which is Step 8). This is incorrect for re-tag-to-HEAD safety. Reorder execution as: Steps 1-5 (modify + verify) → Step 8 (commit) → Step 6 (tag) → Step 7 (re-tag). The list above is in plan-reading order; the implementer should execute Steps 6 and 7 AFTER Step 8.

Phase 4.B is now ready for `superpowers:finishing-a-development-branch` to merge to main.

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Covered by | Status |
|--------------|-----------|--------|
| §0 TL;DR (5-tab + 6 hooks + 8 new files + 3 mods) | All tasks | ✓ |
| §1 Goal (owner+manager full CRUD, staff read-only) | T1 nav + T2 hide flag + T4 + T5 canWrite checks | ✓ |
| §2 Non-goals (no recipes/stock tabs, no bulk import) | T6 placeholders + nothing else added | ✓ |
| §3.1 Container structure (5-tab Tabs Root) | T6 | ✓ |
| §3.2 Data flow (per-tab query + mutations + modal) | T4 + T5 | ✓ |
| §3.3 Mutation invalidation map | T1 step 4 (all 6 hooks with correct invalidations) | ✓ |
| §3.4 Role gating matrix | T6 EmptyState.lock + canWrite in T4/T5 | ✓ |
| §4.1 New files (8) | T1 (2 files) + T2 + T3 + T4 + T5 (2 files) + T6 = 8 | ✓ |
| §4.2 Modified files (3) | T1 (icons + nav) + T7 (page.tsx) = 3 | ✓ |
| §4.3 Off-limits | T7 step 5 file manifest check | ✓ |
| §5.1 InventoryView | T6 | ✓ |
| §5.2 IngredientsTab | T4 | ✓ |
| §5.3 IngredientFormModal | T3 | ✓ |
| §5.4 MenuItemsTab + MenuItemFormModal | T5 | ✓ |
| §5.5 InventoryActionButtons | T2 | ✓ |
| §5.6 Row layout | T4 (CardBody rendering) + T5 (CardBody rendering) | ✓ |
| §5.7 6 mutation hooks | T1 step 4 | ✓ |
| §6 Vietnamese strings glossary | Every UI string in T1-T6 matches | ✓ |
| §7 Error handling matrix | T3 (modal error), T4/T5 (toast on mutation error) | ✓ |
| §9 Risks | Addressed inline (modal init pattern, conservative invalidation, etc.) | ✓ |
| §10 Success criteria | T7 verification steps | ✓ |

**2. Placeholder scan:**
- No "TBD" / "TODO" / "implement later" in normative sections ✓
- Every code step has full TSX/TS code ✓
- Every command has exact text and expected output ✓
- Commit messages fully written ✓
- The T5 note about `text-warning` is robust handling, not a placeholder ✓

**3. Type consistency:**
- `Ingredient`, `MenuItem`, `UserRole` from `@/lib/types` consistently across T3, T4, T5 ✓
- All 6 mutation hook input interfaces explicitly typed in T1 ✓
- `editingIngredient: Ingredient | null` / `editingMenuItem: MenuItem | null` props consistent T3/T4 and T5 ✓
- `STOCK_UNITS` + `STOCK_UNIT_LABELS_VI` + `formatUnit` from `./units` used consistently in T3 + T4 ✓
- `InventoryActionButtonsProps` interface defined in T2 and used identically in T4 + T5 ✓
- All toast semantic values match the established `"success" | "danger" | "info" | "warning"` enum ✓
- Tabs primitive used with `defaultValue="ingredients"` and 5 children `value` strings consistent T6 ✓

No issues found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-v4-phase-4b-masters-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh implementer subagent per task, two-stage review (spec compliance + code quality), final opus review. Matches the proven pattern that successfully shipped every prior phase including 4.A.

**2. Inline Execution** — execute tasks directly in this session using `superpowers:executing-plans` with batch checkpoints.

Which approach?
