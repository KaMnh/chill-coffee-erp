# Phase 4.C — Recipe Builder UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Recipe Builder UI inside the Công thức tab of InventoryView — two-section RecipesTab (gap report + existing recipes) + single-step modal builder with dynamic ingredient rows. 2 mutation hooks. No backend changes.

**Architecture:** Pure UI layer on top of 4.A backend (`upsert_recipe` + `delete_recipe` + `list_recipes` + `get_recipe_by_menu_item`). Reuses existing 4.A query hooks (`useRecipesQuery`, `useMenuItemsQuery`, `useIngredientsQuery`) and 4.B primitives (Modal, Select, TextField, Textarea, Checkbox, InventoryActionButtons). Each new file <300 lines. Toggle-active uses fetch-then-upsert pattern (documented trade-off — see spec §6.5).

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

**Branch state at start:** `phase-4c-recipes-ui` is already checked out (off main @ tag `v4-phase-4b`). The Phase 4.C design spec is committed at `269f806`.

**Verify gate baseline:** `npm run verify:phase` should remain 75 Vitest + 89 pgTAP = 164 throughout (no backend changes in 4.C).

**Primitive APIs (verified during 4.B):**
- `Modal`, `ModalContent`, `ModalTitle`, `ModalDescription`, `ModalActions` from `@/components/ui/modal`
- `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem` from `@/components/ui/select`
- `TextField` accepts `label`, `helper`, `error` + all standard input props
- `Textarea` accepts `value`, `onChange`, `disabled`, `rows`, `maxLength`, `placeholder`, `helper`, `error`
- `Checkbox` accepts `checked: boolean | "indeterminate"`, `onCheckedChange`, `disabled`, `label`
- `Button` accepts `variant`, `loading`, `disabled`, `size?: "sm"`, `leadingIcon?`
- `Card`, `CardBody` from `@/components/ui/card`
- `Badge` accepts `variant: "soft"`, `semantic: "success" | "neutral" | "warning" | "danger"`
- `AlertBanner` accepts `variant: "info" | "warning" | "success" | "danger"`
- `EmptyState` accepts `icon`, `title`, `subtitle`, `dashedBorder?`, `action?`
- `Spinner` accepts `size`
- `Icon` accepts `name`, `size`, `className?`

**Existing 4.A artifacts (do NOT re-add):**
- Types: `Recipe`, `RecipeDetail`, `RecipeItem`, `Ingredient`, `MenuItem`, `UserRole` (all from `@/lib/types`)
- Data layer: `upsertRecipe`, `deleteRecipe`, `getRecipeByMenuItem`, `loadRecipes` (re-exported from `@/lib/data`)
- Query hooks: `useRecipesQuery`, `useMenuItemsQuery`, `useIngredientsQuery` (from `@/hooks/queries`)
- Query keys: `queryKeys.recipes()`, `queryKeys.menuItems()`, `queryKeys.ingredients()`

**Existing 4.B artifacts (reuse):**
- `formatUnit(unit: string): string` from `@/features/inventory/units`
- `InventoryActionButtons` (with `hidden` prop for staff_operator) from `@/features/inventory/inventory-action-buttons`

---

## File Structure

| File | Action | Touched in task |
|------|--------|------------------|
| `src/hooks/mutations/use-recipe-mutations.ts` | Create — 2 mutation hooks | T1 |
| `src/features/inventory/recipe-builder-modal.tsx` | Create — modal with dynamic rows | T2 |
| `src/features/inventory/recipes-tab.tsx` | Create — gap section + recipes list + state | T3 |
| `src/features/inventory/inventory-view.tsx` | Modify — swap EmptyState placeholder for `<RecipesTab />` | T4 |

**Off-limits:** `database/**`, `src/lib/data/**`, `src/lib/types.ts`, `src/hooks/queries/**` (except importing existing keys), Phase 2 primitives in `src/components/ui/*`, all other Phase 4 / prior-phase feature files except `inventory-view.tsx` (T4), `src/app/page.tsx`.

---

### Task 1: Mutation hooks — `useUpsertRecipe` + `useDeleteRecipe`

**Files:**
- Create: `src/hooks/mutations/use-recipe-mutations.ts`

- [ ] **Step 1: Create the file**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertRecipe, deleteRecipe } from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for Phase 4.C Recipe Builder UI.
 *
 * Conservative invalidation: both hooks invalidate `menuItems()` because
 * `menu_items.recipe_count` (returned by list_menu_items RPC via subquery)
 * changes when a recipe is created or deleted. Otherwise the gap report
 * in RecipesTab would show stale data.
 *
 * Recipe items are replaced atomically inside upsert_recipe (DELETE +
 * INSERT in a single transaction — see 4.A backend spec §6.3).
 */

export interface UpsertRecipeInput {
  menu_item_id: string;
  is_active: boolean;
  notes: string | null;
  items: Array<{ ingredient_id: string; quantity: number }>;
}

export function useUpsertRecipe(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpsertRecipeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return upsertRecipe(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes() });
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}

export interface DeleteRecipeInput {
  id: string;
}

export function useDeleteRecipe(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteRecipeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteRecipe(supabase, input.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.recipes() });
      queryClient.invalidateQueries({ queryKey: queryKeys.menuItems() });
    },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Smoke verify:phase**

Run: `npm run verify:phase`
Expected: 75 Vitest + 89 pgTAP = 164 green. No regressions.

- [ ] **Step 4: Commit**

```powershell
$msg = @'
feat(phase-4c): recipe mutation hooks

src/hooks/mutations/use-recipe-mutations.ts: 2 hooks following the
established template:
- useUpsertRecipe (atomic upsert; backend replaces recipe_items in
  a single transaction)
- useDeleteRecipe (cascade via FK ON DELETE CASCADE on recipe_items)

Both invalidate queryKeys.recipes() + queryKeys.menuItems() —
menu_items.recipe_count changes when a recipe is created/deleted
(joined in list_menu_items subquery). Without this invalidation the
gap report would show stale data.

Null-supabase guard with Vietnamese error (matches 3C.3 / 4.B convention).

verify:phase still 75 Vitest + 89 pgTAP = 164 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/hooks/mutations/use-recipe-mutations.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 2: RecipeBuilderModal

**Files:**
- Create: `src/features/inventory/recipe-builder-modal.tsx`

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
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useUpsertRecipe,
  useDeleteRecipe,
} from "@/hooks/mutations/use-recipe-mutations";
import { getRecipeByMenuItem } from "@/lib/data";
import { formatUnit } from "./units";
import type { Recipe, MenuItem, Ingredient } from "@/lib/types";

interface RecipeBuilderModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Null = create mode. Non-null = edit mode (modal fetches detail on open). */
  editingRecipe: Recipe | null;
  /** Optional pre-selected menu_item (gap report "Tạo công thức" click). */
  initialMenuItemId?: string | null;
  /** Menu_items available for the Select (parent filters: only WITHOUT recipes for create). */
  availableMenuItems: MenuItem[];
  /** All active ingredients for the row Selects. */
  ingredients: Ingredient[];
}

interface RowState {
  ingredient_id: string;
  /** String to distinguish empty vs zero. */
  quantity: string;
}

/**
 * Phase 4.C — Recipe Builder Modal (single-step composite form).
 *
 * Layout: menu_item Select (locked in edit) + notes + dynamic ingredient rows
 * (each = ingredient Select + qty TextField + unit display + remove button) +
 * is_active Checkbox (edit only) + delete button (edit only, inline confirm).
 *
 * Init pattern: useEffect([open, editingRecipe, initialMenuItemId]) seeds form
 * state. Edit mode fetches getRecipeByMenuItem to populate rows.
 *
 * Submit: client validates (>=1 item, no duplicates, qty>0) → upsert.
 * Delete: inline AlertBanner.warning replaces ModalActions row (matches
 * handover-tasks-editor-modal pattern from 3C.3).
 */
export function RecipeBuilderModal({
  open,
  onOpenChange,
  editingRecipe,
  initialMenuItemId,
  availableMenuItems,
  ingredients,
}: RecipeBuilderModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const upsertM = useUpsertRecipe(supabase);
  const deleteM = useDeleteRecipe(supabase);

  const isEdit = editingRecipe !== null;

  const [selectedMenuItemId, setSelectedMenuItemId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [items, setItems] = useState<RowState[]>([
    { ingredient_id: "", quantity: "" },
  ]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Init on open / target change
  useEffect(() => {
    if (!open) return;
    setConfirmingDelete(false);

    if (editingRecipe && supabase) {
      // Edit mode — fetch detail
      setIsLoadingDetail(true);
      setSelectedMenuItemId(editingRecipe.menu_item_id);
      getRecipeByMenuItem(supabase, editingRecipe.menu_item_id)
        .then((detail) => {
          if (!detail) {
            toast({
              semantic: "danger",
              message: "Không tải được chi tiết công thức.",
            });
            onOpenChange(false);
            return;
          }
          setNotes(detail.notes ?? "");
          setIsActive(detail.is_active);
          setItems(
            detail.items.length > 0
              ? detail.items.map((it) => ({
                  ingredient_id: it.ingredient_id,
                  quantity: String(it.quantity),
                }))
              : [{ ingredient_id: "", quantity: "" }]
          );
        })
        .catch((err) => {
          toast({
            semantic: "danger",
            message:
              err instanceof Error
                ? err.message
                : "Không tải được chi tiết công thức.",
          });
          onOpenChange(false);
        })
        .finally(() => setIsLoadingDetail(false));
    } else {
      // Create mode
      setSelectedMenuItemId(initialMenuItemId ?? null);
      setNotes("");
      setIsActive(true);
      setItems([{ ingredient_id: "", quantity: "" }]);
      setIsLoadingDetail(false);
    }
  }, [open, editingRecipe, initialMenuItemId, supabase, toast, onOpenChange]);

  const filteredItems = items.filter(
    (it) => it.ingredient_id !== "" && it.quantity.trim() !== ""
  );
  const allItemsValid = filteredItems.every(
    (it) => !Number.isNaN(Number(it.quantity)) && Number(it.quantity) > 0
  );
  const ingredientIds = filteredItems.map((it) => it.ingredient_id);
  const noDuplicates = new Set(ingredientIds).size === ingredientIds.length;

  const isBusy = upsertM.isPending || deleteM.isPending || isLoadingDetail;
  const canSubmit =
    selectedMenuItemId !== null &&
    filteredItems.length >= 1 &&
    allItemsValid &&
    noDuplicates &&
    !isBusy;

  function handleAddRow() {
    setItems([...items, { ingredient_id: "", quantity: "" }]);
  }
  function handleRemoveRow(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }
  function handleChangeIngredient(idx: number, ingredient_id: string) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ingredient_id } : it)));
  }
  function handleChangeQuantity(idx: number, quantity: string) {
    setItems(items.map((it, i) => (i === idx ? { ...it, quantity } : it)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedMenuItemId) return;

    try {
      await upsertM.mutateAsync({
        menu_item_id: selectedMenuItemId,
        is_active: isActive,
        notes: notes.trim() === "" ? null : notes.trim(),
        items: filteredItems.map((it) => ({
          ingredient_id: it.ingredient_id,
          quantity: Number(it.quantity),
        })),
      });
      toast({
        semantic: "success",
        message: isEdit ? "Đã lưu công thức." : "Đã tạo công thức.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi lưu công thức.",
      });
    }
  }

  async function handleConfirmDelete() {
    if (!editingRecipe || isBusy) return;
    try {
      await deleteM.mutateAsync({ id: editingRecipe.recipe_id });
      toast({ semantic: "success", message: "Đã xóa công thức." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi xóa.",
      });
      setConfirmingDelete(false);
    }
  }

  // Resolve menu_item display name for title / delete confirm
  const menuItemName = isEdit
    ? editingRecipe.menu_item_name
    : selectedMenuItemId
      ? availableMenuItems.find((m) => m.id === selectedMenuItemId)?.name ?? ""
      : "";

  const menuItemOptionsForCreate = availableMenuItems;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,36rem)]">
        <ModalTitle>
          {isEdit ? `Sửa công thức cho ${menuItemName}` : "Thêm công thức"}
        </ModalTitle>
        <ModalDescription>
          Công thức gắn 1 sản phẩm với nhiều nguyên liệu. Khi có đơn bán, hệ thống tự trừ kho theo công thức.
        </ModalDescription>

        {isLoadingDetail ? (
          <div className="flex justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Menu item picker */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-2">Sản phẩm</label>
              <Select
                value={selectedMenuItemId ?? undefined}
                onValueChange={(v) => setSelectedMenuItemId(v)}
                disabled={isEdit || isBusy}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn sản phẩm..." />
                </SelectTrigger>
                <SelectContent>
                  {isEdit && editingRecipe ? (
                    <SelectItem value={editingRecipe.menu_item_id}>
                      {editingRecipe.menu_item_name}
                    </SelectItem>
                  ) : menuItemOptionsForCreate.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      Không còn sản phẩm khả dụng
                    </SelectItem>
                  ) : (
                    menuItemOptionsForCreate.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isBusy}
              rows={2}
              maxLength={500}
              placeholder="Ghi chú thêm về công thức (tùy chọn)"
              helper="Tùy chọn"
            />

            {/* Ingredient rows */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <label className="text-xs font-medium text-ink-2">
                  Nguyên liệu
                </label>
                <span className="text-xs text-muted">
                  {filteredItems.length} nguyên liệu
                </span>
              </div>

              {filteredItems.length === 0 && (
                <p className="text-xs text-muted">Thêm ít nhất 1 nguyên liệu</p>
              )}
              {!noDuplicates && (
                <AlertBanner variant="warning">
                  Mỗi nguyên liệu chỉ xuất hiện 1 lần trong công thức.
                </AlertBanner>
              )}
              {filteredItems.length > 0 && !allItemsValid && (
                <AlertBanner variant="warning">
                  Số lượng phải lớn hơn 0.
                </AlertBanner>
              )}

              {items.map((it, idx) => {
                const ing = ingredients.find((i) => i.id === it.ingredient_id);
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-2 p-2 rounded-md border border-border bg-surface"
                  >
                    <div className="flex-1 min-w-0">
                      <Select
                        value={it.ingredient_id || undefined}
                        onValueChange={(v) => handleChangeIngredient(idx, v)}
                        disabled={isBusy}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn nguyên liệu..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredients.length === 0 ? (
                            <SelectItem value="__empty" disabled>
                              Chưa có nguyên liệu
                            </SelectItem>
                          ) : (
                            ingredients.map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24">
                      <TextField
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={it.quantity}
                        onChange={(e) =>
                          handleChangeQuantity(idx, e.target.value)
                        }
                        disabled={isBusy}
                        placeholder="0"
                        aria-label="Số lượng"
                      />
                    </div>
                    <div className="w-12 pt-2 text-xs text-muted">
                      {ing ? formatUnit(ing.unit) : ""}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveRow(idx)}
                      disabled={isBusy}
                      aria-label="Xóa nguyên liệu khỏi công thức"
                    >
                      <Icon name="trash" size={16} />
                    </Button>
                  </div>
                );
              })}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleAddRow}
                disabled={isBusy}
                leadingIcon={<Icon name="plus" size={16} />}
              >
                Thêm nguyên liệu
              </Button>
            </div>

            {/* is_active (edit mode only) */}
            {isEdit && (
              <Checkbox
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
                disabled={isBusy}
                label="Đang dùng"
              />
            )}

            {/* Actions */}
            {confirmingDelete ? (
              <div className="space-y-3 border-t border-border pt-4">
                <AlertBanner variant="warning">
                  Xóa công thức của &quot;{menuItemName}&quot;? Hành động này không hoàn tác.
                </AlertBanner>
                <div className="flex justify-end gap-2">
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
                    loading={deleteM.isPending}
                    onClick={handleConfirmDelete}
                  >
                    Xác nhận xóa
                  </Button>
                </div>
              </div>
            ) : (
              <ModalActions>
                {isEdit && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={isBusy}
                  >
                    Xóa công thức
                  </Button>
                )}
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
                  loading={upsertM.isPending}
                  disabled={!canSubmit}
                >
                  {isEdit ? "Lưu" : "Thêm"}
                </Button>
              </ModalActions>
            )}
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

If a primitive prop fails (e.g., Textarea doesn't accept `helper`), check the actual API in `src/components/ui/` and adapt. DO NOT modify primitives.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4c): RecipeBuilderModal — single-step composite form

Modal layout:
- menu_item Select (locked in edit mode)
- notes Textarea (optional, 500 chars max)
- Dynamic ingredient rows: Select + qty TextField + unit label + remove
- + Thêm nguyên liệu button (ghost)
- is_active Checkbox (edit mode only)
- Delete with inline AlertBanner.warning confirm (replaces ModalActions)

Init pattern: useEffect([open, editingRecipe, initialMenuItemId]) seeds
form state once per open. Edit mode fetches getRecipeByMenuItem; on
error (detail null) → toast.danger + close modal.

Validation: client-side for quick feedback.
- selectedMenuItemId !== null
- filteredItems.length >= 1
- allItemsValid (qty > 0)
- noDuplicates (Set check on ingredient_ids)
- Empty rows (where ingredient_id="" OR quantity="") filtered on submit

Toast messages:
- create success: "Đã tạo công thức."
- edit success: "Đã lưu công thức."
- delete success: "Đã xóa công thức."
- error: surfaces err.message verbatim

Width: w-[min(95vw,36rem)] (wider than 4.B's 32rem to fit row list).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/recipe-builder-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 3: RecipesTab

**Files:**
- Create: `src/features/inventory/recipes-tab.tsx`

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
import {
  useRecipesQuery,
  useMenuItemsQuery,
  useIngredientsQuery,
} from "@/hooks/queries";
import { useUpsertRecipe } from "@/hooks/mutations/use-recipe-mutations";
import { getRecipeByMenuItem } from "@/lib/data";
import { InventoryActionButtons } from "./inventory-action-buttons";
import { RecipeBuilderModal } from "./recipe-builder-modal";
import type { Recipe, UserRole } from "@/lib/types";

interface RecipesTabProps {
  role: UserRole;
}

/**
 * Phase 4.C — Recipes tab content.
 *
 * Two-section layout:
 *   Section 1: "Sản phẩm chưa có công thức" — gap report (menu_items
 *     with recipe_count=0 AND is_active=true). Each row has a
 *     "Tạo công thức" button (canWrite only).
 *   Section 2: "Công thức hiện có" — existing recipes list with
 *     filter toggle (show inactive), row actions (Sửa/Vô hiệu hóa/Xóa).
 *
 * Prerequisite warnings: if ingredients or menu_items list is empty,
 * show AlertBanner.warning at top and disable "Thêm công thức" button.
 *
 * Toggle-active: fetch-then-upsert pattern (see spec §6.5).
 *
 * Write controls hidden for staff_operator via InventoryActionButtons
 * hidden prop + conditional button rendering.
 */
export function RecipesTab({ role }: RecipesTabProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const recipesQuery = useRecipesQuery(supabase);
  const menuItemsQuery = useMenuItemsQuery(supabase);
  const ingredientsQuery = useIngredientsQuery(supabase);
  const upsertM = useUpsertRecipe(supabase);

  const canWrite = role === "owner" || role === "manager";

  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [initialMenuItemId, setInitialMenuItemId] = useState<string | null>(null);
  const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);

  const recipes = recipesQuery.data ?? [];
  const menuItems = menuItemsQuery.data ?? [];
  const ingredients = ingredientsQuery.data ?? [];

  const availableMenuItems = useMemo(
    () => menuItems.filter((m) => m.is_active && (m.recipe_count ?? 0) === 0),
    [menuItems]
  );
  const activeIngredients = useMemo(
    () => ingredients.filter((i) => i.is_active),
    [ingredients]
  );

  const inactiveRecipeCount = useMemo(
    () => recipes.filter((r) => !r.is_active).length,
    [recipes]
  );
  const visibleRecipes = useMemo(
    () => (showInactive ? recipes : recipes.filter((r) => r.is_active)),
    [recipes, showInactive]
  );

  const noIngredients = activeIngredients.length === 0;
  const noMenuItems = menuItems.length === 0;
  const prereqMissing = noIngredients || noMenuItems;
  const canAddNew = canWrite && !prereqMissing && availableMenuItems.length > 0;

  function handleOpenCreate(menuItemId?: string) {
    if (!canWrite) return;
    setEditingRecipe(null);
    setInitialMenuItemId(menuItemId ?? null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(recipe: Recipe) {
    if (!canWrite) return;
    setEditingRecipe(recipe);
    setInitialMenuItemId(null);
    setIsModalOpen(true);
  }

  async function handleToggleActive(recipe: Recipe) {
    if (busyRecipeId || !canWrite || !supabase) return;
    setBusyRecipeId(recipe.recipe_id);
    try {
      // Fetch detail to get items array (required by upsert_recipe)
      const detail = await getRecipeByMenuItem(supabase, recipe.menu_item_id);
      if (!detail) {
        throw new Error("Không tìm thấy chi tiết công thức.");
      }
      await upsertM.mutateAsync({
        menu_item_id: recipe.menu_item_id,
        is_active: !recipe.is_active,
        notes: detail.notes,
        items: detail.items.map((it) => ({
          ingredient_id: it.ingredient_id,
          quantity: it.quantity,
        })),
      });
      toast({
        semantic: "success",
        message: recipe.is_active ? "Đã vô hiệu hóa." : "Đã kích hoạt.",
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi cập nhật.",
      });
    } finally {
      setBusyRecipeId(null);
    }
  }

  // Delete is handled inside the modal (Xóa công thức button → inline confirm).
  // Tab-level handler not needed.

  const prereqBanner = prereqMissing && (
    <AlertBanner variant="warning">
      {noIngredients && noMenuItems
        ? "Cần thêm nguyên liệu + sản phẩm trước khi tạo công thức."
        : noIngredients
          ? "Cần thêm nguyên liệu trước."
          : "Cần thêm sản phẩm trước."}
    </AlertBanner>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-ink">Công thức</h2>
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            onClick={() => handleOpenCreate()}
            disabled={!canAddNew}
            leadingIcon={<Icon name="plus" size={16} />}
          >
            Thêm công thức
          </Button>
        )}
      </div>

      {prereqBanner}

      {/* Section 1: Gap report */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-medium text-ink">
            Sản phẩm chưa có công thức
          </h3>
          {availableMenuItems.length > 0 && (
            <Badge variant="soft" semantic="warning">
              {availableMenuItems.length}
            </Badge>
          )}
        </div>

        {availableMenuItems.length === 0 ? (
          <p className="text-sm text-muted">
            Tất cả sản phẩm đã có công thức ✓
          </p>
        ) : (
          <div className="space-y-2">
            {availableMenuItems.map((m) => (
              <Card key={m.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon
                        name="package"
                        size={20}
                        className="text-muted mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink truncate">
                          {m.name}
                        </p>
                        {m.external_product_name && (
                          <p className="text-xs text-muted mt-0.5 truncate">
                            KiotViet: {m.external_product_name}
                          </p>
                        )}
                      </div>
                    </div>
                    {canWrite && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenCreate(m.id)}
                        disabled={prereqMissing}
                        leadingIcon={<Icon name="plus" size={14} />}
                      >
                        Tạo công thức
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* Section 2: Existing recipes */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-ink">Công thức hiện có</h3>
          <Checkbox
            checked={showInactive}
            onCheckedChange={(checked) => setShowInactive(checked === true)}
            label="Hiện cả ngưng dùng"
          />
        </div>

        {!showInactive && inactiveRecipeCount > 0 && (
          <AlertBanner variant="info">
            Đang ẩn {inactiveRecipeCount} công thức đã ngưng dùng. Bật &quot;Hiện cả ngưng dùng&quot; để xem.
          </AlertBanner>
        )}

        {recipesQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : recipesQuery.isError ? (
          <AlertBanner variant="danger">
            Không tải được danh sách công thức. Vui lòng tải lại trang.
          </AlertBanner>
        ) : visibleRecipes.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title="Chưa có công thức nào"
            subtitle={
              canWrite
                ? "Bấm 'Thêm công thức' để bắt đầu."
                : "Owner/manager có thể thêm công thức mới."
            }
            dashedBorder
          />
        ) : (
          <div className="space-y-2">
            {visibleRecipes.map((r) => {
              const isRowBusy = busyRecipeId === r.recipe_id;
              return (
                <Card
                  key={r.recipe_id}
                  className={!r.is_active ? "opacity-70" : ""}
                >
                  <CardBody>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <Icon
                          name="checkCircle"
                          size={20}
                          className="text-muted mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-ink truncate">
                              {r.menu_item_name}
                            </p>
                            <Badge
                              variant="soft"
                              semantic={r.is_active ? "success" : "neutral"}
                            >
                              {r.is_active ? "Đang dùng" : "Ngưng dùng"}
                            </Badge>
                            <Badge variant="soft" semantic="neutral">
                              {r.item_count} nguyên liệu
                            </Badge>
                          </div>
                          {r.notes && (
                            <p className="text-xs text-muted mt-0.5 truncate">
                              {r.notes}
                            </p>
                          )}
                        </div>
                      </div>
                      <InventoryActionButtons
                        isActive={r.is_active}
                        onEdit={() => handleOpenEdit(r)}
                        onToggleActive={() => handleToggleActive(r)}
                        onDelete={() => handleOpenEdit(r)}
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
      </section>

      <RecipeBuilderModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        editingRecipe={editingRecipe}
        initialMenuItemId={initialMenuItemId}
        availableMenuItems={availableMenuItems}
        ingredients={activeIngredients}
      />
    </div>
  );
}
```

**Note on `onDelete`:** Delete is handled inside the RecipeBuilderModal (via the "Xóa công thức" button + inline AlertBanner confirm). The tab's row "delete" icon click reuses `handleOpenEdit` — clicking trash opens the modal in edit mode, where the user clicks "Xóa công thức" to confirm. This avoids a second delete-confirm flow at tab level and keeps delete inside the modal where the recipe detail is visible. If you prefer a different flow, adjust during implementation.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
feat(phase-4c): RecipesTab — gap section + existing recipes list

Two-section structure:
- Section 1: "Sản phẩm chưa có công thức" — gap report (menu_items
  with recipe_count=0 && is_active=true). Each row has a "Tạo công
  thức" button that opens the modal pre-selected (canWrite only).
- Section 2: "Công thức hiện có" — existing recipes with filter
  toggle (show inactive), row actions (Sửa/Vô hiệu hóa/Xóa).

Prerequisite warnings: if ingredients OR menu_items list is empty,
shows AlertBanner.warning at top and disables "Thêm công thức".

Toggle-active flow:
- Click Vô hiệu hóa/Kích hoạt → fetch getRecipeByMenuItem to get items
- Call useUpsertRecipe with toggled is_active + preserved items/notes
- Toast feedback; busyRecipeId guards concurrent toggles

Delete flow:
- Trash icon in row opens modal in edit mode (delete handled there)
- Modal has "Xóa công thức" button → inline AlertBanner confirm
- Avoids duplicate delete confirms across tab + modal

Write controls hidden for staff_operator via InventoryActionButtons
hidden prop and conditional button rendering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/recipes-tab.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 4: Wire RecipesTab into InventoryView

**Files:**
- Modify: `src/features/inventory/inventory-view.tsx`

- [ ] **Step 1: Modify InventoryView**

Open `src/features/inventory/inventory-view.tsx`. Find the existing imports at the top:

```tsx
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
```

Add the new import:

```tsx
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
import { RecipesTab } from "./recipes-tab";
```

Then find the existing Recipes tab placeholder (the `TabsContent value="recipes"` block):

```tsx
        <TabsContent value="recipes">
          <EmptyState
            icon="checkCircle"
            title="Công thức"
            subtitle="Phát hành trong giai đoạn 4.C — xây dựng công thức gắn sản phẩm với nguyên liệu."
            dashedBorder
          />
        </TabsContent>
```

Replace with:

```tsx
        <TabsContent value="recipes">
          <RecipesTab role={role} />
        </TabsContent>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Build**

Run: `npm run build 2>&1 | Select-Object -Last 30`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
$msg = @'
feat(phase-4c): wire RecipesTab into InventoryView

Swap the Công thức tab's EmptyState placeholder for <RecipesTab role={role} />.
Import RecipesTab from ./recipes-tab.

After this, the Công thức tab is fully functional:
- Gap section showing menu_items without recipes
- Existing recipes list with row actions
- Modal builder for create/edit/delete
- Prerequisite warnings when ingredients/menu_items lists are empty

Remaining placeholder tabs (Tồn kho, Tổng quan) still show EmptyState
until 4.D and 4.E land.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/features/inventory/inventory-view.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 5: Final verify + tag v4-phase-4c

**Files:** none (verification + tagging only)

- [ ] **Step 1: Run final verify:phase**

Run: `npm run verify:phase`
Expected: `Vitest 75/75 + pgTAP 89/89 = 164 total`, exit 0. No regression (no backend changes in 4.C).

- [ ] **Step 2: Verify file manifest**

Run: `git diff main..HEAD --name-only`
Expected exactly these 6 files (relative to main = v4-phase-4b):
- `docs/superpowers/specs/2026-05-22-v4-phase-4c-recipes-ui-design.md`
- `docs/superpowers/plans/2026-05-22-v4-phase-4c-recipes-ui.md`
- `src/features/inventory/inventory-view.tsx` (modified)
- `src/features/inventory/recipe-builder-modal.tsx`
- `src/features/inventory/recipes-tab.tsx`
- `src/hooks/mutations/use-recipe-mutations.ts`

If any **off-limits** file appears (`database/**`, `src/lib/**`, `src/hooks/queries/**`, `src/app/page.tsx`, any other feature module), STOP and revert.

- [ ] **Step 3: Place tag**

```bash
git tag v4-phase-4c
```

- [ ] **Step 4: Re-tag to HEAD (3C.1 retrospective lesson)**

```bash
git tag -f v4-phase-4c HEAD
git show v4-phase-4c --stat --no-patch | Select-Object -First 5
```

Confirm the tag points to the T4 commit (the InventoryView wire commit — the most recent on the branch).

- [ ] **Step 5: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expected ~6 commits visible (spec + plan + T1 + T2 + T3 + T4).

Phase 4.C is now ready for `superpowers:finishing-a-development-branch` to merge to main.

---

## Self-Review

**1. Spec coverage check:**

| Spec section | Covered by | Status |
|--------------|-----------|--------|
| §0 TL;DR (3 new + 1 modified, no backend) | All tasks | ✓ |
| §1 Goal (owner+manager CRUD, staff read-only) | T2 modal canWrite checks + T3 hidden buttons | ✓ |
| §2 Non-goals (no bulk import, no versioning) | Not implemented; correctly absent | ✓ |
| §3 Scope decisions | T2 modal layout, T3 gap section, T4 wire | ✓ |
| §4.1 RecipesTab structure | T3 | ✓ |
| §4.2 RecipeBuilderModal structure | T2 | ✓ |
| §4.3 Data flow | T3 imports queries; T2 receives props | ✓ |
| §4.4 Invalidation map | T1 hooks invalidate recipes() + menuItems() | ✓ |
| §4.5 Role gating | T2 + T3 canWrite checks + InventoryActionButtons hidden | ✓ |
| §5 RecipeBuilderModal props/state/init/validation/submit/delete/rows/layout | T2 (full code) | ✓ |
| §6 RecipesTab props/state/derived/handlers/toggle-active | T3 (full code) | ✓ |
| §7 File manifest | T1/T2/T3/T4 (4 files total) | ✓ |
| §8 Mutation hooks code | T1 (full code) | ✓ |
| §9 Vietnamese strings glossary | All strings used in T2/T3 match | ✓ |
| §10 Error handling | T2 catch blocks + T3 detail-load error + AlertBanner.danger query errors | ✓ |
| §11 Risk register | Mitigated inline (init pattern, validation, conservative invalidation) | ✓ |
| §12 5-task projection | T1-T5 exactly | ✓ |
| §13 Success criteria | T5 verification steps | ✓ |

**2. Placeholder scan:**
- No "TBD" / "TODO" / "implement later" in normative content ✓
- Every code step has full TSX/TS code ✓
- Commit messages fully written ✓
- T3's note about `onDelete` is a design rationale, not a placeholder — explicit choice documented ✓

**3. Type consistency:**
- `Recipe`, `MenuItem`, `Ingredient`, `RecipeDetail`, `UserRole` from `@/lib/types` used consistently across T2 and T3 ✓
- `UpsertRecipeInput`, `DeleteRecipeInput` defined in T1 and matched in T2 mutation calls ✓
- `RowState` interface in T2 used only within T2 (local) ✓
- `availableMenuItems`, `activeIngredients` derived in T3 and passed to T2's modal — prop names match ✓
- `recipe.recipe_id` used in T3 toggle handler — matches `Recipe.recipe_id` field from `@/lib/types` (4.A) ✓
- `recipe.menu_item_id`, `recipe.menu_item_name`, `recipe.item_count`, `recipe.is_active`, `recipe.notes` — all match the `Recipe` type defined in 4.A ✓
- Modal title uses `editingRecipe.menu_item_name` for edit mode — field exists in Recipe ✓

No issues found.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-v4-phase-4c-recipes-ui.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh implementer subagent per task, two-stage review (spec compliance + code quality), final opus review. Matches the proven pattern that successfully shipped 4.A and 4.B.

**2. Inline Execution** — execute tasks directly in this session using `superpowers:executing-plans` with batch checkpoints.

Which approach?
