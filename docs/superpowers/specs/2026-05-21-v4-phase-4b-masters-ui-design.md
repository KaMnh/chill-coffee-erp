# Phase 4.B — Masters UI (Ingredients + Menu Items) Design

**Parent:** `docs/superpowers/specs/2026-05-21-v4-phase-4-overall-design.md`
**Predecessor:** `docs/superpowers/specs/2026-05-21-v4-phase-4a-backend-design.md` (backend foundation, merged at `v4-phase-4a`)
**Scope:** UI for ingredients + menu_items CRUD inside an `InventoryView` container with placeholder tabs for 4.C/4.D/4.E. Mutation hooks. Nav additions. page.tsx wire.
**Branch:** `phase-4b-masters-ui` (off main @ tag `v4-phase-4a`)
**Tag at end:** `v4-phase-4b`

---

## 0. TL;DR

- One new sidebar entry: `"Kho"` (icon `package`, roles `owner+manager+staff_operator`).
- `InventoryView` container with **5-tab Radix Tabs** structure. 4.B populates 2 tabs (Ingredients, Menu Items); 3 tabs are placeholder `EmptyState` views for 4.C/4.D/4.E.
- 6 mutation hooks in `src/hooks/mutations/use-inventory-mutations.ts`.
- 8 new files + 3 modifications (icons, navigation, page.tsx).
- Role-based UI gating: `owner+manager` see full CRUD; `staff_operator` sees read-only Masters (write controls hidden).
- Delete UX: two-button paradigm (`Vô hiệu hóa` soft-delete + `Xóa` hard-delete with inline AlertBanner confirm).
- **`npm run verify:phase` remains 75 Vitest + 89 pgTAP = 164** (no backend changes in 4.B).

---

## 1. Goal

Owner and manager can create/edit/deactivate/delete ingredients and menu items entirely from the UI. The data feeds Phase 4.C (Recipe Builder), 4.D (Stock counting), and 4.E (Dashboard). Staff can navigate to the inventory module (needed for 4.D stock operations) but cannot modify masters.

---

## 2. Non-goals (specific to 4.B)

- No Recipes tab content (filled in 4.C)
- No Stock counting tab content (filled in 4.D)
- No Dashboard tab content (filled in 4.E)
- No mutation hooks for recipes or stock movements (added in 4.C / 4.D respectively)
- No bulk import / CSV (deferred per overall spec)
- No undo on delete (toasts are the only feedback; matches prior phases)
- No pgTAP additions in 4.B (no new RPCs)
- No new TypeScript types (all 7 types added in 4.A)

---

## 3. Architecture

### 3.1 Container structure

```
InventoryView (role gate: employee_viewer blocked)
└── Tabs.Root (defaultValue="ingredients")
    ├── Tabs.List
    │   ├── Tabs.Trigger value="ingredients"  → "Nguyên liệu"
    │   ├── Tabs.Trigger value="menu_items"   → "Sản phẩm"
    │   ├── Tabs.Trigger value="recipes"      → "Công thức"
    │   ├── Tabs.Trigger value="stock"        → "Tồn kho"
    │   └── Tabs.Trigger value="dashboard"    → "Tổng quan"
    ├── Tabs.Content value="ingredients" → <IngredientsTab role={role} />
    ├── Tabs.Content value="menu_items"  → <MenuItemsTab role={role} />
    ├── Tabs.Content value="recipes"     → <EmptyState ... subtitle="Phát hành trong giai đoạn 4.C" />
    ├── Tabs.Content value="stock"       → <EmptyState ... subtitle="Phát hành trong giai đoạn 4.D" />
    └── Tabs.Content value="dashboard"   → <EmptyState ... subtitle="Phát hành trong giai đoạn 4.E" />
```

### 3.2 Data flow

```
InventoryView (renders unconditionally for owner+manager+staff_operator)
  │
  ├── IngredientsTab
  │   ├── useIngredientsQuery (from 4.A) — list
  │   ├── (owner|manager) "Thêm" button → opens IngredientFormModal (create mode)
  │   ├── Filter toggle "Hiện cả ngưng dùng" (default false)
  │   └── per row:
  │       ├── (owner|manager) Sửa → opens IngredientFormModal (edit mode)
  │       ├── (owner|manager) Vô hiệu hóa / Kích hoạt → useUpdateIngredient (is_active toggle)
  │       └── (owner|manager) Xóa → inline AlertBanner confirm → useDeleteIngredient
  │
  └── MenuItemsTab (mirrors IngredientsTab; uses useMenuItemsQuery + Menu Item mutations)
```

### 3.3 Mutation invalidation map

| Hook | onSuccess invalidates |
|------|------------------------|
| `useCreateIngredient` | `queryKeys.ingredients()` |
| `useUpdateIngredient` | `queryKeys.ingredients()` + `queryKeys.stockBalances()` (conservative — unit or threshold may change) |
| `useDeleteIngredient` | `queryKeys.ingredients()` |
| `useCreateMenuItem`   | `queryKeys.menuItems()` |
| `useUpdateMenuItem`   | `queryKeys.menuItems()` + `queryKeys.recipes()` (menu_item_name is joined in list_recipes) |
| `useDeleteMenuItem`   | `queryKeys.menuItems()` |

### 3.4 Role gating

| Role | InventoryView | Masters tabs | Write controls |
|------|---------------|--------------|----------------|
| owner | Full | All 5 tabs visible | All visible |
| manager | Full | All 5 tabs visible | All visible |
| staff_operator | Full | All 5 tabs visible | **HIDDEN** in Ingredients + Menu Items |
| employee_viewer | `EmptyState.lock` | n/a | n/a |

Defense-in-depth: `if (role === "employee_viewer") return <EmptyState ...>` at top of `InventoryView`. NAV_ITEMS already filters at sidebar level.

---

## 4. File manifest

### 4.1 New files (8)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `src/features/inventory/inventory-view.tsx` | ~80 | Top-level container, role gate, 5-tab Radix structure with 3 placeholders |
| `src/features/inventory/ingredients-tab.tsx` | ~130 | List + filter toggle + create button + row actions; consumes useIngredientsQuery |
| `src/features/inventory/ingredient-form-modal.tsx` | ~180 | Create/edit modal (name, unit Select, low_stock_threshold, notes, is_active in edit mode) |
| `src/features/inventory/menu-items-tab.tsx` | ~110 | List + filter toggle + create button + row actions; consumes useMenuItemsQuery |
| `src/features/inventory/menu-item-form-modal.tsx` | ~150 | Create/edit modal (name, external_product_name with helper, notes, is_active in edit mode) |
| `src/features/inventory/inventory-action-buttons.tsx` | ~70 | Shared row-action component (Sửa / Vô hiệu hóa-Kích hoạt / Xóa with inline AlertBanner confirm) |
| `src/features/inventory/units.ts` | ~40 | `STOCK_UNITS` constant + `STOCK_UNIT_LABELS_VI` map (Kg / Gram / Lít / Mililit / Cái / Gói) |
| `src/hooks/mutations/use-inventory-mutations.ts` | ~150 | 6 mutation hooks |

### 4.2 Modified files (3)

| Path | Change |
|------|--------|
| `src/components/ui/icons.tsx` | Additive: import `Package` from lucide-react + `package: Package` entry in `Icons` const |
| `src/features/navigation/navigation.ts` | Additive: `"inventory"` to ViewKey union + NAV_ITEMS entry (between handover and reports) + DEFAULT_SIDEBAR_BY_ROLE for owner/manager/staff_operator |
| `src/app/page.tsx` | Wire `view === "inventory"` → `<InventoryView role={account.role} />` |

### 4.3 Off-limits

- `database/**` (no backend changes)
- `src/lib/data/**` (no data layer changes)
- `src/lib/types.ts` (all types in 4.A; no new types needed)
- `src/hooks/queries/**` (query hooks added in 4.A)
- `src/components/ui/**` except the additive icon addition
- All prior-phase feature modules

---

## 5. Component specs

### 5.1 `InventoryView`

```tsx
interface InventoryViewProps { role: UserRole }
```

- Defense-in-depth gate: `if (role === "employee_viewer") return <EmptyState icon="lock" title="Kho dành cho staff trở lên" subtitle="..." />`
- Radix Tabs Root with `defaultValue="ingredients"`
- 5 triggers + 5 content sections
- Placeholder sections use `<EmptyState>` with icons matching the future content (e.g., `checkCircle` for recipes, `package` for stock, `barChart` for dashboard)

### 5.2 `IngredientsTab`

```tsx
interface IngredientsTabProps { role: UserRole }
```

Internal state:
- `showInactive: boolean` (default false)
- `editingId: string | null` (null = create mode when modal opens)
- `isModalOpen: boolean`

Data:
- `useSupabase()` + `useIngredientsQuery(supabase, true)`

Layout:
```
┌─ Header row ────────────────────────────────────────┐
│ [✓] Hiện cả ngưng dùng       [+ Thêm nguyên liệu]  │  ← create btn hidden for staff
└─────────────────────────────────────────────────────┘

[ Loading: <Spinner /> ]
[ Error:   <AlertBanner.danger> Không tải được... ]
[ Empty:   <EmptyState> Chưa có nguyên liệu nào ]
[ Data:    stacked row list, filtered by showInactive ]
```

Each row uses the row layout from §6.

### 5.3 `IngredientFormModal`

```tsx
interface IngredientFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  editingIngredient: Ingredient | null;  // null = create mode
}
```

Fields:
- `name`: TextField (required, trimmed)
- `unit`: Select with options from `STOCK_UNITS` × `STOCK_UNIT_LABELS_VI`
- `low_stock_threshold`: TextField type="number" (optional, must be > 0 if set)
- `notes`: Textarea (optional)
- `is_active`: Checkbox (visible only in edit mode; create defaults to true server-side)

Validation (client-side, quick feedback):
- name length ≥ 1 after trim
- unit must be in STOCK_UNITS
- low_stock_threshold if provided must be a positive number

Submit:
- Create mode: `useCreateIngredient` → toast "Đã thêm nguyên liệu." → close modal
- Edit mode: `useUpdateIngredient` → toast "Đã lưu nguyên liệu." → close modal
- On error: toast.danger surfaces backend Vietnamese message (e.g., duplicate name → backend's 23505 surfaces as `"new row violates unique constraint"`; we wrap as `"Tên nguyên liệu đã tồn tại."`)

### 5.4 `MenuItemsTab` and `MenuItemFormModal`

Same shape as IngredientsTab / IngredientFormModal but for menu_items.

Differences:
- Form fields: `name`, `external_product_name` (with helper text), `notes`, `is_active`
- No unit / no threshold
- Helper text on `external_product_name`:  
  `"Tên sản phẩm KiotViet phải khớp (không phân biệt hoa thường, đã trim). Để trống = chưa khớp với KiotViet."`

### 5.5 `InventoryActionButtons`

```tsx
interface InventoryActionButtonsProps {
  isActive: boolean;
  onEdit(): void;
  onToggleActive(): void;
  onDelete(): void;
  isBusy?: boolean;
  /** When true, renders nothing. Used to hide controls for staff_operator. */
  hidden?: boolean;
}
```

Returns:
```
[ Sửa ]  [ Vô hiệu hóa | Kích hoạt ]  [ 🗑 ]
  ghost      ghost                       icon-button destructive
```

Toggle label switches based on `isActive`. All buttons disabled when `isBusy=true`. When `hidden=true`, returns `null`.

### 5.6 Row layout (shared structure)

Each ingredient / menu_item row is a card-like flex row:

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌─ Icon ─┐  Sữa tươi                       [Sửa][Vô hiệu hóa][🗑]│
│ │  📦   │  5 L · Cảnh báo dưới 5 L                                │
│ │       │  Carton 1L                                              │
│ └───────┘  [Đang dùng] or [Ngưng dùng] badge                      │
└─────────────────────────────────────────────────────────────────┘
```

Inactive rows have `opacity-70` muted styling. Delete confirm replaces the row content with an inline AlertBanner + 2 buttons (matches `handover-tasks-editor-modal` pattern from 3C.3).

### 5.7 `use-inventory-mutations.ts`

6 hooks. Each follows the standard template:

```ts
export function useCreateIngredient(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; unit: string; low_stock_threshold?: number | null; notes?: string | null }) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createIngredient(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredients() });
    },
  });
}
```

Variants follow the invalidation map in §3.3.

---

## 6. Vietnamese strings (locked for Phase 4.B)

| Concept | Vietnamese |
|---------|------------|
| Nav label "Kho" | Kho |
| Ingredients tab | Nguyên liệu |
| Menu items tab | Sản phẩm |
| Recipes tab (placeholder) | Công thức |
| Stock tab (placeholder) | Tồn kho |
| Dashboard tab (placeholder) | Tổng quan |
| Add ingredient | Thêm nguyên liệu |
| Add menu item | Thêm sản phẩm |
| Edit row | Sửa |
| Deactivate | Vô hiệu hóa |
| Activate | Kích hoạt |
| Delete | Xóa |
| Cancel | Hủy |
| Save | Lưu |
| Confirm delete | Xác nhận xóa |
| Active badge | Đang dùng |
| Inactive badge | Ngưng dùng |
| Show inactive toggle | Hiện cả ngưng dùng |
| Unit field label | Đơn vị |
| Low stock threshold label | Ngưỡng cảnh báo |
| External product name label | Tên sản phẩm KiotViet |
| Notes field label | Ghi chú |
| Empty: ingredients | Chưa có nguyên liệu nào |
| Empty: menu items | Chưa có sản phẩm nào |
| Toast: saved | Đã lưu. |
| Toast: deactivated | Đã vô hiệu hóa. |
| Toast: activated | Đã kích hoạt. |
| Toast: deleted | Đã xóa. |
| Placeholder tab | Phát hành trong giai đoạn 4.C / 4.D / 4.E |
| External product name helper | Tên sản phẩm KiotViet phải khớp (không phân biệt hoa thường, đã trim). Để trống = chưa khớp với KiotViet. |
| Defense gate | Kho dành cho staff trở lên |

---

## 7. Error handling

| Source | Behavior |
|--------|----------|
| useIngredientsQuery / useMenuItemsQuery error | Tab content shows `<AlertBanner.danger>Không tải được danh sách. Vui lòng tải lại trang.</AlertBanner>` |
| Mutation create/update error (unique constraint, etc.) | toast.danger surfaces backend error or wrapped Vietnamese message |
| Mutation delete error (references exist — backend returns Vietnamese hint) | toast.danger shows backend message verbatim; row collapses back from confirm state |
| Network down | `useMutation.isError` triggers toast.danger; modal stays open for retry |

---

## 8. Implementation strategy (task projection)

7 tasks projected for `superpowers:writing-plans`:

1. **T1**: Foundation — `package` icon + nav additions + `units.ts` + 6 mutation hooks
2. **T2**: `InventoryActionButtons` shared component
3. **T3**: `IngredientFormModal` (create + edit modes)
4. **T4**: `IngredientsTab` (list + filter + create button wire + row actions wire)
5. **T5**: `MenuItemFormModal` + `MenuItemsTab` (combined since simpler than ingredients)
6. **T6**: `InventoryView` container + 5-tab Radix structure + 3 placeholders
7. **T7**: `page.tsx` wire + verify:phase + tag `v4-phase-4b` (with re-tag-to-HEAD safety)

---

## 9. Risk register (4.B-specific)

| Risk | Mitigation |
|------|------------|
| `src/components/ui/tabs.tsx` styling unsuitable | Use as-is. If styling break: escalate before T6 ships. |
| Form race: refetch lands while user edits | Initialize form state once on modal open via `useEffect([open, editingIngredient])`. User's edits not clobbered. |
| `useUpdateIngredient` over-invalidating stockBalances | Conservative — fine at this scale. 4.E dashboard not built yet so no perf cost. |
| Inactive filter UX confusing | Show "Đang ẩn N mục đã ngưng dùng" hint when filter is OFF and inactive_count > 0. |
| Backend RPC error format mismatch with friendly UI | toast.danger displays raw `err.message`. Backend RPCs already return Vietnamese for known errors. For unmapped errors (e.g., 23505 unique violation), prepend `"Có lỗi: "` to make it readable. |
| New nav entry order in NAV_ITEMS | Insert `"inventory"` between `"handover"` and `"reports"` (matches v3 mental model + spec order). Same insertion in DEFAULT_SIDEBAR_BY_ROLE for the 3 non-viewer roles. |

---

## 10. Success criteria

1. ✅ `npm run verify:phase` still 75 Vitest + 89 pgTAP = 164 (no regression)
2. ✅ TypeScript build clean (`npx tsc --noEmit`)
3. ✅ `npm run build` succeeds
4. ✅ Owner login → sidebar shows "Kho" → click → InventoryView renders with 5 tabs
5. ✅ Ingredients tab end-to-end: create new ingredient → appears in list → edit → deactivate → reactivate → delete (with confirm) → all toast messages display correctly
6. ✅ Menu items tab end-to-end: same flow
7. ✅ Manager login: same access as owner
8. ✅ Staff_operator login: tabs visible but no create/edit/delete buttons in Masters tabs
9. ✅ employee_viewer cannot access /inventory (sidebar filters; defense-in-depth EmptyState if URL-navigated)
10. ✅ File manifest matches §4 (no off-limits files touched)
11. ✅ Tag `v4-phase-4b` placed on final merge commit

---

## 11. Open decisions (defer to writing-plans / execution)

These are explicitly deferred — plan author or implementer makes the call:

- **Tab order** when `staff_operator` is the viewer: keep all 5 tabs visible (matches owner/manager view) or reorder so future-useful tabs (Stock, Dashboard) appear first. Recommend: keep all 5 in same order — consistency over reordering.
- **Filter toggle implementation**: Checkbox vs Switch primitive. Both exist. Recommend: Checkbox (matches existing settings patterns).
- **Empty state icons** for placeholder tabs: `checkCircle` for recipes, `package` for stock, `barChart` for dashboard — or any equivalent. Implementer's choice.
- **Form modal width**: `w-[min(95vw,32rem)]` is the established convention. Stick with it.

---

## 12. Self-review

**Placeholder scan:** No "TBD" or "TODO" in normative sections (§§3–10). §11 explicitly labels Open decisions — appropriate.

**Internal consistency:**
- 5 tabs across §3.1 and §3.4 ✓
- 8 new files + 3 modified across §4.1 + §4.2 ✓
- 6 mutation hooks (§3.3 invalidation map + §4.1 file list + §5.7 examples) ✓
- 7 tasks projected (§8) ✓
- Vietnamese strings glossary (§6) covers all UI labels in §5 component specs ✓

**Ambiguity check:**
- "Read-only mode" for staff_operator defined as "write controls hidden" — unambiguous (not disabled, hidden)
- "Defense-in-depth" defined at top of InventoryView via `EmptyState.lock` — unambiguous
- Delete behavior on reference error: "toast.danger shows backend message verbatim; row collapses back from confirm state" — unambiguous
- `useUpdateIngredient` conservative invalidation explicitly noted — unambiguous

**Scope check:** Single focused phase. UI-only. No backend touches. Matches the 3C sub-phase scale (~5-7 tasks). Ready for writing-plans without decomposition.

No issues found.

---

## 13. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 7-task implementation plan.
