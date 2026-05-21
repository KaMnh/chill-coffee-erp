# Phase 4.C — Recipe Builder UI Design

**Parent:** `docs/superpowers/specs/2026-05-21-v4-phase-4-overall-design.md`
**Predecessors:**
- `docs/superpowers/specs/2026-05-21-v4-phase-4a-backend-design.md` (backend foundation, merged at `v4-phase-4a`)
- `docs/superpowers/specs/2026-05-21-v4-phase-4b-masters-ui-design.md` (Masters UI, merged at `v4-phase-4b`)

**Scope:** Recipe Builder UI inside the `Công thức` tab of InventoryView. Two-section tab layout (gap report + existing recipes) + single-step modal builder with dynamic ingredient rows. 2 mutation hooks. Updates `inventory-view.tsx` to swap the placeholder EmptyState for the real RecipesTab.
**Branch:** `phase-4c-recipes-ui` (off main @ tag `v4-phase-4b`)
**Tag at end:** `v4-phase-4c`

---

## 0. TL;DR

- 3 new files + 1 modified file.
- **No backend changes** — all RPCs, types, data layer, query hooks for recipes already shipped in 4.A.
- Single-step modal builder: menu_item Select + dynamic ingredient row list + notes + is_active (edit) + delete (edit).
- Gap report section surfaces menu_items with `recipe_count === 0 && is_active === true` for one-click recipe creation.
- Role gating: owner+manager full CRUD; staff_operator read-only.
- `verify:phase` remains 75 Vitest + 89 pgTAP = 164 (no backend changes).

---

## 1. Goal

Owner + manager can build, edit, and delete recipes that link menu_items to weighted ingredient lists. Missing recipes (menu_items with no recipe) are surfaced as a discoverable gap section so the auto-deduction trigger (4.A) doesn't silently no-op for un-recipe'd products. Staff_operator sees the same data read-only.

---

## 2. Non-goals (specific to 4.C)

- No bulk import (CSV) of recipes
- No recipe versioning / change history
- No ingredient substitution rules
- No "copy from another menu_item" feature
- No recipe categories or tagging
- No stock cost calculation (recipes have no cost column; deferred to Phase 5)
- No pgTAP additions (no new RPCs in 4.C)
- No new TypeScript types (all 4 recipe-related types already exported in 4.A)

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Builder layout | **Single-step modal with dynamic rows** (not stepper, not page-level) |
| Menu_item selection scope (create mode) | **Only menu_items WITHOUT recipes** (Select filtered upstream) |
| Edit mode menu_item | **Locked** — Select disabled, menu_item_id immutable |
| Gap report placement | **Separate section at top of RecipesTab** — most discoverable |
| Modal width | `w-[min(95vw, 36rem)]` — wider than 4.B's 32rem to fit row list |
| Delete confirm | **Inline AlertBanner.warning** inside modal replacing ModalActions (matches handover-tasks-editor-modal pattern from 3C.3) |

---

## 4. Architecture

### 4.1 RecipesTab structure

```
RecipesTab (role-aware)
├── Header row
│   ├── Section title (left)
│   └── (canWrite) "Thêm công thức" Button.primary (right)
│       — disabled if prerequisites empty (ingredients or menu_items list is empty)
│
├── (banner) Prerequisite warnings
│   ├── ingredients.length === 0 → AlertBanner.warning "Cần thêm nguyên liệu trước."
│   ├── menuItems.length === 0   → AlertBanner.warning "Cần thêm sản phẩm trước."
│   └── (both ⇒ merged single banner)
│
├── Section 1: "Sản phẩm chưa có công thức"
│   ├── Section heading + small count badge
│   ├── (empty) muted text "Tất cả sản phẩm đã có công thức ✓"
│   └── (canWrite) Card list — each row:
│       ├── Icon.package + menu_item.name + (external_product_name if set)
│       └── (canWrite) "Tạo công thức" Button.ghost → opens modal pre-selected
│
└── Section 2: "Công thức hiện có"
    ├── Section heading + (filter toggle) Checkbox "Hiện cả ngưng dùng"
    ├── (loading) Spinner
    ├── (error) AlertBanner.danger
    ├── (empty) EmptyState "Chưa có công thức nào"
    └── Card list — each row:
        ├── Icon.checkCircle + menu_item_name + badges (Đang dùng | Ngưng dùng, item_count)
        └── (canWrite) InventoryActionButtons (Sửa / Vô hiệu hóa-Kích hoạt / Xóa)
            — Sửa opens modal in edit mode
            — Vô hiệu hóa-Kích hoạt calls useUpsertRecipe with toggled is_active
            — Xóa opens inline AlertBanner.warning confirm
```

### 4.2 RecipeBuilderModal structure

```
Modal (open / onOpenChange)
└── ModalContent w-[min(95vw, 36rem)]
    ├── ModalTitle
    │   • Create: "Thêm công thức"
    │   • Edit:   "Sửa công thức cho {menu_item.name}"
    ├── ModalDescription
    │   "Công thức gắn 1 sản phẩm với nhiều nguyên liệu. Khi có đơn bán,
    │    hệ thống tự trừ kho theo công thức."
    ├── (edit mode + isLoadingDetail) Spinner — brief while fetching detail
    ├── form
    │   ├── menu_item Select (disabled+locked in edit mode)
    │   │   Options: from availableMenuItems prop (parent-filtered)
    │   ├── notes Textarea (optional, 500 chars max)
    │   ├── Section label "Nguyên liệu" + count text "{N} nguyên liệu"
    │   ├── (validation banners)
    │   │   • !noDuplicates → AlertBanner.warning "Mỗi nguyên liệu chỉ xuất hiện 1 lần"
    │   │   • !allItemsValid → AlertBanner.warning "Số lượng phải lớn hơn 0"
    │   │   • filteredItems.length === 0 → muted helper "Thêm ít nhất 1 nguyên liệu"
    │   ├── Dynamic row list (items.map → IngredientRow)
    │   │   Each row: ingredient Select + qty TextField + unit label + remove icon
    │   ├── "+ Thêm nguyên liệu" Button.ghost
    │   ├── (edit mode) Checkbox "Đang dùng"
    │   └── ModalActions OR inline delete confirm
    │       ├── (default) "Xóa công thức" (edit-only, destructive) + "Hủy" + "Lưu/Thêm" (primary)
    │       └── (confirmingDelete) AlertBanner.warning "Xóa công thức của ...?"
    │           + "Hủy" + "Xác nhận xóa" (destructive)
```

### 4.3 Data flow

```
RecipesTab
  ├── useSupabase()
  ├── useRecipesQuery(supabase)          → recipes (Section 2)
  ├── useMenuItemsQuery(supabase)        → derive availableMenuItems for modal
  ├── useIngredientsQuery(supabase)      → pass to modal
  ├── useUpsertRecipe(supabase)          → toggle is_active inline (no modal needed)
  ├── useDeleteRecipe(supabase)          → not used directly (Xóa happens in modal)
  └── Modal state: { open, editingRecipe, initialMenuItemId }

RecipeBuilderModal
  ├── useSupabase()
  ├── useUpsertRecipe(supabase)
  ├── useDeleteRecipe(supabase)
  ├── (edit mode) getRecipeByMenuItem(supabase, editingRecipe.menu_item_id) — on open
  └── Form state (see §5)
```

### 4.4 Mutation invalidation map

| Hook | onSuccess invalidates |
|------|------------------------|
| `useUpsertRecipe` | `queryKeys.recipes()` + `queryKeys.menuItems()` (recipe_count changes) |
| `useDeleteRecipe` | `queryKeys.recipes()` + `queryKeys.menuItems()` (recipe_count drops) |

### 4.5 Role gating

| Role | Tab visible | Gap report buttons | Recipe row actions | Modal access |
|------|-------------|---------------------|--------------------|----|
| owner | ✓ | ✓ | ✓ | ✓ |
| manager | ✓ | ✓ | ✓ | ✓ |
| staff_operator | ✓ | hidden | hidden (InventoryActionButtons `hidden={!canWrite}`) | n/a |
| employee_viewer | n/a (InventoryView outer gate blocks) | — | — | — |

---

## 5. RecipeBuilderModal — detailed spec

### 5.1 Props

```tsx
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
```

### 5.2 State

```tsx
const [selectedMenuItemId, setSelectedMenuItemId] = useState<string | null>(null);
const [notes, setNotes] = useState("");
const [isActive, setIsActive] = useState(true);
// Quantity stored as string to distinguish empty vs zero
const [items, setItems] = useState<Array<{ ingredient_id: string; quantity: string }>>([
  { ingredient_id: "", quantity: "" },
]);
const [confirmingDelete, setConfirmingDelete] = useState(false);
const [isLoadingDetail, setIsLoadingDetail] = useState(false);
```

### 5.3 Init flow (`useEffect([open, editingRecipe, initialMenuItemId])`)

- **`!open`**: do nothing (preserves state during close animation).
- **Create mode** (`editingRecipe === null`):
  - `selectedMenuItemId = initialMenuItemId ?? null`
  - `notes = ""`, `isActive = true`
  - `items = [{ ingredient_id: "", quantity: "" }]`
  - `confirmingDelete = false`, `isLoadingDetail = false`
- **Edit mode** (`editingRecipe !== null`):
  - Set `isLoadingDetail = true`
  - Call `getRecipeByMenuItem(supabase, editingRecipe.menu_item_id)`
  - On success: populate state from `detail`. `selectedMenuItemId = editingRecipe.menu_item_id`, `notes = detail.notes ?? ""`, `isActive = detail.is_active`, `items = detail.items.map(...)`. Set `isLoadingDetail = false`.
  - On error: toast.danger + `onOpenChange(false)`.

### 5.4 Validation

```tsx
const filteredItems = items.filter(
  (it) => it.ingredient_id !== "" && it.quantity.trim() !== ""
);
const allItemsValid = filteredItems.every(
  (it) => !Number.isNaN(Number(it.quantity)) && Number(it.quantity) > 0
);
const ingredientIds = filteredItems.map((it) => it.ingredient_id);
const noDuplicates = new Set(ingredientIds).size === ingredientIds.length;
const canSubmit =
  selectedMenuItemId !== null &&
  filteredItems.length >= 1 &&
  allItemsValid &&
  noDuplicates &&
  !isBusy;
```

### 5.5 Submit flow

```tsx
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
      message: editingRecipe ? "Đã lưu công thức." : "Đã tạo công thức.",
    });
    onOpenChange(false);
  } catch (err) {
    toast({
      semantic: "danger",
      message: err instanceof Error ? err.message : "Có lỗi khi lưu công thức.",
    });
  }
}
```

### 5.6 Delete flow (edit mode only)

- Click "Xóa công thức" → `setConfirmingDelete(true)` → ModalActions replaced by AlertBanner.warning + 2 buttons
- "Xác nhận xóa" → `deleteM.mutateAsync({ id: editingRecipe.id })` → toast + close modal
- "Hủy" → `setConfirmingDelete(false)` → form returns

### 5.7 Row operations

```tsx
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
```

Empty rows (where `ingredient_id === ""` OR `quantity.trim() === ""`) are filtered out on submit — they exist as draft slots in the UI but don't reach the backend.

### 5.8 Row layout

```tsx
<div className="flex items-start gap-2 p-2 rounded-md border border-border bg-surface">
  <div className="flex-1">
    <Select value={it.ingredient_id} onValueChange={...}>
      <SelectTrigger><SelectValue placeholder="Chọn nguyên liệu..." /></SelectTrigger>
      <SelectContent>
        {ingredients.map((ing) => (
          <SelectItem key={ing.id} value={ing.id}>
            {ing.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
  <div className="w-24">
    <TextField
      type="number"
      step="any"
      min="0"
      value={it.quantity}
      onChange={(e) => handleChangeQuantity(idx, e.target.value)}
      placeholder="0"
    />
  </div>
  <div className="w-12 pt-2 text-xs text-muted">
    {it.ingredient_id ? formatUnit(ingredients.find((i) => i.id === it.ingredient_id)?.unit ?? "") : ""}
  </div>
  <Button
    type="button"
    size="sm"
    variant="ghost"
    onClick={() => handleRemoveRow(idx)}
    aria-label="Xóa nguyên liệu khỏi công thức"
  >
    <Icon name="trash" size={16} />
  </Button>
</div>
```

---

## 6. RecipesTab — detailed spec

### 6.1 Props

```tsx
interface RecipesTabProps {
  role: UserRole;
}
```

### 6.2 State

```tsx
const [showInactive, setShowInactive] = useState(false);
const [isModalOpen, setIsModalOpen] = useState(false);
const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
const [initialMenuItemId, setInitialMenuItemId] = useState<string | null>(null);
const [deletingId, setDeletingId] = useState<string | null>(null);  // Section 2 inline delete confirm
const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);
```

### 6.3 Derived values

```tsx
const recipes = recipesQuery.data ?? [];
const menuItems = menuItemsQuery.data ?? [];
const ingredients = ingredientsQuery.data ?? [];

const availableMenuItems = menuItems.filter(
  (m) => m.is_active && (m.recipe_count ?? 0) === 0
);
const visibleRecipes = showInactive ? recipes : recipes.filter((r) => r.is_active);
const inactiveRecipeCount = recipes.filter((r) => !r.is_active).length;

const ingredientsAvailable = ingredients.filter((i) => i.is_active);
const prerequisitesMissing =
  ingredientsAvailable.length === 0 || menuItems.length === 0;
```

### 6.4 Handlers

```tsx
function handleOpenCreate(menuItemId?: string) {
  setEditingRecipe(null);
  setInitialMenuItemId(menuItemId ?? null);
  setIsModalOpen(true);
}
function handleOpenEdit(recipe: Recipe) {
  setEditingRecipe(recipe);
  setInitialMenuItemId(null);
  setIsModalOpen(true);
}
async function handleToggleActive(recipe: Recipe) { /* via useUpsertRecipe with toggled is_active */ }
function handleStartDelete(recipeId: string) { setDeletingId(recipeId); }
function handleCancelDelete() { setDeletingId(null); }
async function handleConfirmDelete(recipeId: string) { /* via useDeleteRecipe */ }
```

### 6.5 Toggle-active complication

`useUpsertRecipe` requires `items` array. Toggling `is_active` from the row (without opening the modal) means we need to know the current items to pass through. Options:

- **A. Fetch detail first** — on toggle click, call `getRecipeByMenuItem` to get items, then call upsert with toggled flag. Two requests per toggle.
- **B. Pass empty items array** — would clobber the existing items. ❌ Not acceptable.
- **C. Add a separate `update_recipe_active(recipe_id, is_active)` RPC** — would require 4.A amendment. ❌ Out of scope.
- **D. Open modal for toggle** — UX regression; toggle should be a single click.

**Choice: A**. The toggle action is rare relative to view, so the extra round-trip is acceptable. Implementation:

```tsx
async function handleToggleActive(recipe: Recipe) {
  if (busyRecipeId || !canWrite) return;
  setBusyRecipeId(recipe.recipe_id);
  try {
    const detail = await getRecipeByMenuItem(supabase, recipe.menu_item_id);
    if (!detail) throw new Error("Không tìm thấy chi tiết công thức.");
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
```

---

## 7. File manifest

### 7.1 New files (3)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `src/hooks/mutations/use-recipe-mutations.ts` | ~80 | 2 mutation hooks: useUpsertRecipe + useDeleteRecipe |
| `src/features/inventory/recipe-builder-modal.tsx` | ~280 | Composite form: menu_item Select + dynamic ingredient rows + save/delete |
| `src/features/inventory/recipes-tab.tsx` | ~200 | Gap section + recipes list + modal state mgmt + toggle/delete handlers |

### 7.2 Modified files (1)

| Path | Change |
|------|--------|
| `src/features/inventory/inventory-view.tsx` | Swap the Recipes tab's `EmptyState` placeholder for `<RecipesTab role={role} />`; import RecipesTab |

### 7.3 Off-limits

- `database/**` (no backend changes — recipes RPCs already shipped in 4.A)
- `src/lib/data/**` (data layer functions for recipes already exported in 4.A)
- `src/lib/types.ts` (Recipe, RecipeDetail, RecipeItem types already exported in 4.A)
- `src/hooks/queries/**` (useRecipesQuery + queryKeys already in 4.A)
- All other Phase 2 primitives in `src/components/ui/*`
- All prior-phase feature modules and other inventory files
- `src/app/page.tsx` (already wires InventoryView)

---

## 8. Mutation hooks (`use-recipe-mutations.ts`)

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { upsertRecipe, deleteRecipe } from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

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

---

## 9. Vietnamese strings (locked for Phase 4.C)

| Concept | Vietnamese |
|---------|------------|
| Tab label | Công thức |
| Add recipe button | Thêm công thức |
| Modal title (create) | Thêm công thức |
| Modal title (edit) | Sửa công thức cho {menu_item_name} |
| Modal description | Công thức gắn 1 sản phẩm với nhiều nguyên liệu. Khi có đơn bán, hệ thống tự trừ kho theo công thức. |
| Menu_item Select label | Sản phẩm |
| Menu_item Select placeholder | Chọn sản phẩm... |
| Notes label | Ghi chú |
| Ingredient section label | Nguyên liệu |
| Row counter | {N} nguyên liệu |
| Ingredient Select placeholder | Chọn nguyên liệu... |
| Quantity placeholder | 0 |
| Add row button | Thêm nguyên liệu |
| Remove row aria-label | Xóa nguyên liệu khỏi công thức |
| Section 1 heading | Sản phẩm chưa có công thức |
| Section 1 empty fallback | Tất cả sản phẩm đã có công thức ✓ |
| Section 1 button | Tạo công thức |
| Section 2 heading | Công thức hiện có |
| Section 2 empty | Chưa có công thức nào |
| Recipe row badge — items | {N} nguyên liệu |
| Active badge | Đang dùng |
| Inactive badge | Ngưng dùng |
| Filter toggle | Hiện cả ngưng dùng |
| Edit row action | Sửa |
| Deactivate / Activate | Vô hiệu hóa / Kích hoạt |
| Delete (icon) | Xóa |
| Delete in modal (edit) | Xóa công thức |
| Delete confirm banner | Xóa công thức của "{menu_item_name}"? Hành động này không hoàn tác. |
| Confirm delete button | Xác nhận xóa |
| Cancel | Hủy |
| Save (create) | Thêm |
| Save (edit) | Lưu |
| Toast: created | Đã tạo công thức. |
| Toast: saved | Đã lưu công thức. |
| Toast: deleted | Đã xóa công thức. |
| Toast: activated/deactivated | Đã kích hoạt. / Đã vô hiệu hóa. |
| Validation: < 1 ingredient | Thêm ít nhất 1 nguyên liệu |
| Validation: duplicates | Mỗi nguyên liệu chỉ xuất hiện 1 lần trong công thức |
| Validation: bad quantity | Số lượng phải lớn hơn 0 |
| Prereq: both empty | Cần thêm nguyên liệu + sản phẩm trước khi tạo công thức. |
| Prereq: ingredients only | Cần thêm nguyên liệu trước. |
| Prereq: menu_items only | Cần thêm sản phẩm trước. |
| Detail load error | Không tải được chi tiết công thức. |
| Inactive recipe note | (Công thức ngưng dùng không tự trừ kho khi bán) |

---

## 10. Error handling

| Source | Behavior |
|--------|----------|
| useRecipesQuery error | Section 2 shows `AlertBanner.danger` "Không tải được danh sách công thức. Vui lòng tải lại trang." |
| Modal detail fetch error | toast.danger + close modal (user retries from list) |
| Upsert error (duplicate ingredient_id from race condition) | toast.danger with backend message verbatim |
| Delete error (FK constraint, shouldn't happen since cascade) | toast.danger + collapse confirm state |
| Network down on toggle | toast.danger + revert busy state (UI stays at previous is_active value because cache wasn't invalidated) |

---

## 11. Risk register

| Risk | Mitigation |
|------|------------|
| Modal too narrow for 10+ ingredient rows | Modal width `36rem` + Radix Dialog scrolls overflow automatically. Tested mentally for ~15 rows. |
| Toggle requires fetch-then-upsert (extra round-trip) | Acceptable trade-off. Documented in §6.5. Alternative would require backend amendment (out of scope). |
| Duplicate ingredient client validation racing backend constraint | Client validation is for UX; backend PK enforces correctness. Both paths produce the same outcome. |
| Empty quantity strings ("") submitted as 0 | `Number("")` === 0 → caught by `> 0` validation. Filter ensures empty rows are excluded before submit. |
| `getRecipeByMenuItem` returns null in edit mode | Should never happen if edit was triggered from a valid Recipe list entry. Guarded: if null, error toast + close. |
| availableMenuItems stale during modal open | Modal captures props once. After upsert, parent refetches → next modal open sees fresh data. Acceptable. |
| Recipe deactivation breaks running auto-deduction | Backend trigger (4.A) already checks `is_active = true` on recipes. Deactivated recipe → no movements emitted. Documented in UI via "Ngưng dùng" badge. |
| Many menu_items in Select (50+ items) | Radix Select with native overflow scroll. If usability becomes an issue, add search filter later. |

---

## 12. Implementation strategy (task projection)

5 tasks projected for `superpowers:writing-plans`:

1. **T1** — `use-recipe-mutations.ts` (2 hooks)
2. **T2** — `RecipeBuilderModal` (single-step composite form, dynamic rows, validation, delete confirm)
3. **T3** — `RecipesTab` (gap section + recipes list + prereq banners + modal state mgmt)
4. **T4** — Wire `RecipesTab` into `InventoryView` (swap EmptyState placeholder)
5. **T5** — Final `verify:phase` + tag `v4-phase-4c` with re-tag-to-HEAD

---

## 13. Success criteria

1. ✅ `npm run verify:phase` still 75 Vitest + 89 pgTAP = 164 green (no backend changes)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ Owner login → Kho → Công thức tab → gap section + recipes list both render
5. ✅ Click "Tạo công thức" in gap row → modal opens with menu_item pre-selected, locked
6. ✅ "Thêm công thức" button → modal in create mode with Select showing only available menu_items
7. ✅ Add/remove rows, set quantities, save → recipe appears in Section 2, gap item removed from Section 1
8. ✅ Edit existing recipe → modal loads detail (Spinner briefly), all rows pre-populated, menu_item Select locked
9. ✅ Deactivate recipe (Vô hiệu hóa) → badge flips, fetch-then-upsert round-trip succeeds
10. ✅ Delete recipe (inline confirm inside modal) → row removed, menu_item re-appears in gap section
11. ✅ Manager: same as owner
12. ✅ Staff_operator: tabs visible, all write controls (Thêm, Tạo công thức, Sửa, Vô hiệu hóa, Xóa) hidden
13. ✅ Prereq banners show when ingredients OR menu_items list is empty
14. ✅ Tag `v4-phase-4c` placed on final commit

---

## 14. Open decisions (defer to writing-plans / execution)

- **Icon for recipe rows**: `checkCircle` vs `clipboardList` vs custom. Implementer's choice; default `checkCircle` since it suggests "complete recipe".
- **Section 1 heading style**: section title size, divider. Match Section 2 / IngredientsTab patterns.
- **Modal body max-height**: if 15+ rows are added, modal should scroll. Radix Dialog handles this automatically — verify in T2 typecheck and adjust max-height if needed.
- **Row pre-allocation**: should the modal start with 1 empty row or 3 empty rows in create mode? Default: 1 (minimal; user adds as needed).

---

## 15. Self-review

**Placeholder scan:** No "TBD" or "TODO" in normative sections (§§3–13). §14 explicitly labels open decisions deferred to implementation.

**Internal consistency:**
- File counts: 3 new + 1 modified (§7.1 + §7.2) ✓
- 5 tasks (§12) ✓
- 2 mutation hooks (§3, §4.4, §7.1, §8) ✓
- RecipeBuilderModal props match across §4.2, §5.1, §5.3 ✓
- Vietnamese strings consistent between §4.1 and §9 ✓

**Ambiguity check:**
- "Edit mode menu_item locked" defined as `disabled` on Select — unambiguous
- "Empty rows filtered on submit" defined as filter where both ingredient_id and quantity must be non-empty — unambiguous
- Toggle-active complication explicitly documented in §6.5 with chosen approach
- Gap section showing only `recipe_count === 0 && is_active === true` — explicit in §6.3

**Scope check:** UI-only. No backend touches. Single focused phase. ~5 tasks total, smaller than 4.B.

No issues found.

---

## 16. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 5-task implementation plan.
