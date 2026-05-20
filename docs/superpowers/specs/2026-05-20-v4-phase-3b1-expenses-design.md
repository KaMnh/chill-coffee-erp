# Phase 3B.1 — Expenses Write Module Design Spec

> **Status:** Approved 2026-05-20 (brainstorm)
> **Master plan:** `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md` §5 Phase 3B (split: 3B.1 expenses first, 3B.2 cash+shifts after)
> **Implements:** ExpensesView — form + history + template/edit modals + 4 mutation hooks

---

## 1. Mục tiêu

Thay placeholder `view === "expenses"` (locked EmptyState ở Phase 3A `page.tsx`) bằng **ExpensesView** đầy đủ chức năng:
- Form ghi chi phí mới (category + qty/unit/price/desc/note + quick-template chips)
- Lịch sử chi phí hôm nay với row click → modal edit (description + note + delete)
- Modal tạo template mới (mở từ form)

Sau Phase 3B.1, staff_operator/manager/owner login → click "Chi phí" → thực hiện đủ 4 thao tác cốt lõi (create, view, update, delete) trên `expenses` table; không lệch khỏi behavior v3. Backend Phase 1 đã có sẵn 4 RPC + 2 query hook + types — chỉ cần wire UI.

---

## 2. Quyết định đã chốt (brainstorming 2026-05-20)

| Vấn đề | Lựa chọn |
|---|---|
| **Scope split** | Master plan Phase 3B = cash + shifts + expenses. Em đề xuất + anh chốt **chia 3B.1 (expenses) trước, 3B.2 (cash+shifts) sau** — expenses CRUD đơn giản, validate được mutation pattern trước khi vào money modules phức tạp. |
| **Test framework** | **Defer Vitest/pgTAP đến 3B.2** — expenses ít logic thuần (chỉ `amount = qty × unit_price`), không justify setup cost. 3B.2 mới có cash math + shift duration cần test thật. Manual smoke + build verify đủ cho 3B.1. |
| **Form pattern** | Giữ v3: `useState` + inline validation. Form đơn giản — không cần react-hook-form. |
| **Modal pattern** | Dùng **Phase 2 `<Modal>` compound** (Radix Dialog based) — đồng nhất design system, không inline conditional kiểu v3. Modal portal nằm ngoài form DOM tree → ExpenseTemplateModal được dùng `<form>` đúng nghĩa (v3 phải dùng `<div>` vì nested form). |
| **Optimistic updates** | Không. Mutation success → `queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) })` + `queryKeys.templates()` → server-driven refetch. Đơn giản, đủ trong production (expenses không spam-clickable). Phase 6 có thể add optimism nếu cần. |
| **Confirm delete** | Phase 2 `<Modal>` confirm UI (không `window.confirm`) — a11y + UX nhất quán toàn app. |

---

## 3. Phạm vi (Scope)

### Trong phạm vi
- **ExpensesView** layout 2-col (form trái, history phải).
- **ExpenseForm**: category select + description + qty/unit/unit_price (auto amount) + manual amount override + note + quick-template chips (top 8) + "+ Mẫu" button mở ExpenseTemplateModal.
- **ExpenseTemplateModal**: tạo template mới (label, default_category, default_unit, last_unit_price). On success → apply template ngay vào form.
- **ExpenseHistoryCard**: list expenses của ngày (top N, từ `dashboard.expenses` array). Row click → ExpenseEditModal (chỉ owner/manager — staff_operator chỉ xem).
- **ExpenseEditModal**: edit description + note + delete (confirm modal nested). Amount/category/payment_method **immutable** (preserved v3 business rule — sửa amount sẽ phải sync cash_drawer_events + recompute reports → out of scope).
- **`useExpenseMutations` hook** chứa 4 mutation: `useCreateExpense`, `useCreateExpenseTemplate`, `useUpdateExpense`, `useDeleteExpense`.
- Mount `ExpensesView` vào `src/app/page.tsx` cho `view === "expenses"`.

### NGOÀI phạm vi (đẩy sang phase sau)
- **Cash module** + **Shifts/Payroll module** → Phase 3B.2.
- **Test framework** (Vitest / pgTAP / Playwright) → Phase 3B.2 (đầu phase setup).
- **Categories CRUD** (owner/manager only) → Phase 3C settings.
- **Templates admin** (deactivate, edit existing templates) → Phase 3C settings.
- **Edit amount / category** của expense đã tạo — KHÔNG support, preserved v3 constraint.
- **Optimistic updates** — chưa cần.
- **Bulk multi-expense create** — YAGNI.
- **Expense filter/search trong history** — YAGNI; history chỉ list hôm nay.

---

## 4. Kiến trúc

### 4.1 Tổng quan

```
src/app/page.tsx (Phase 3A, modify dispatcher only)
  └ {view === "expenses" && <ExpensesView businessDate={businessDate} role={account.role} />}

src/features/expenses/
  expenses-view.tsx
    ├ useDashboardQuery(supabase, businessDate)       ← reuse Phase 1 — list comes via RPC
    ├ useExpenseCategoriesQuery                       ← Phase 1
    ├ useExpenseTemplatesQuery                        ← Phase 1
    └ render:
       2-col bento:
       ├ left: <ExpenseForm /> (uses Phase 2 Card)
       └ right: <ExpenseHistoryCard expenses={data.expenses} role={role} />

  expense-form.tsx
    ├ useState — categoryId, templateId, description, quantity, unit, unitPrice, amount, note, fieldError
    ├ useCreateExpense (mutation)
    ├ on submit: validateExpense + mutateAsync + reset form on success
    └ "+ Mẫu" button → opens <ExpenseTemplateModal />
        on template created → applyTemplate(template) — sync form fields

  expense-template-modal.tsx
    ├ Phase 2 Modal (compound: Modal + ModalContent + ModalTitle + ModalActions)
    ├ useState — label, categoryId, unit, unitPrice
    ├ useCreateExpenseTemplate (mutation)
    ├ on submit → mutateAsync + onCreated(template) callback

  expense-history-card.tsx
    ├ Pure prop-driven (no own queries — reads from parent's dashboard.expenses)
    ├ Top N (default 20, after that "Xem thêm…" — actually start with showing all today's expenses)
    ├ Row click (only if role allows) → setEditing(expense)
    └ renders <ExpenseEditModal expense={editing} ... /> when editing set

  expense-edit-modal.tsx
    ├ Phase 2 Modal compound
    ├ useState — description, note, isConfirmingDelete
    ├ useUpdateExpense (mutation)
    ├ useDeleteExpense (mutation)
    ├ "Xóa" button → setConfirmingDelete(true) → nested confirm Modal
    └ Ctrl/Cmd+Enter on textarea → save

src/hooks/mutations/
  use-expense-mutations.ts
    ├ useCreateExpense()        → invalidates dashboard + templates
    ├ useCreateExpenseTemplate() → invalidates templates
    ├ useUpdateExpense()        → invalidates dashboard
    ├ useDeleteExpense()        → invalidates dashboard (and cash queries since RPC mutates cash_drawer_events)
```

### 4.2 File structure (created in 3B.1)

```
src/
  app/
    page.tsx                              [MODIFY — only the expenses view block]
  features/
    expenses/
      expenses-view.tsx                   [NEW — container 2-col]
      expense-form.tsx                    [NEW]
      expense-history-card.tsx            [NEW]
      expense-template-modal.tsx          [NEW]
      expense-edit-modal.tsx              [NEW]
  hooks/
    mutations/
      use-expense-mutations.ts            [NEW — 4 mutation hooks]
```

**Untouched:** Phase 1 backend (`src/lib/data/expenses.ts` already has 4 RPC wrappers ready). Phase 2 components. Phase 3A hooks (`useAuthSession`, `useBusinessDate`, `useRoleGate`). Phase 3A modules.

### 4.3 Hooks contracts (mutations)

File: `src/hooks/mutations/use-expense-mutations.ts`. All 4 mutations co-located for ease of import.

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createExpense,
  createExpenseTemplate,
  updateExpense,
  deleteExpense,
} from "@/lib/data";
import type { Expense, ExpenseTemplate } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

interface CreateExpenseInput {
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

interface UpdateExpenseInput {
  id: string;
  patch: { description?: string; note?: string | null };
}

interface CreateExpenseTemplateInput {
  label: string;
  default_category_id: string | null;
  default_unit: string;
  last_unit_price: number;
}

export function useCreateExpense(supabase: SupabaseClient | null, businessDate: string);
export function useCreateExpenseTemplate(supabase: SupabaseClient | null);
export function useUpdateExpense(supabase: SupabaseClient | null, businessDate: string);
export function useDeleteExpense(supabase: SupabaseClient | null, businessDate: string);
```

Mỗi mutation:
- `mutationFn` gọi data fn từ `@/lib/data` (đã có sẵn)
- `onSuccess` invalidate đúng query key
- KHÔNG catch error trong mutationFn — caller dùng `mutateAsync` + try/catch để xử lý UX (toast/banner)
- `supabase` nullable — nếu null, mutation `enabled` không có (caller responsibility); mutationFn throw "Thiếu cấu hình" nếu gọi

Invalidation map:
| Mutation | Keys invalidated |
|---|---|
| useCreateExpense | `dashboard(businessDate)`, `templates()` (usage_count tăng) |
| useCreateExpenseTemplate | `templates()` |
| useUpdateExpense | `dashboard(businessDate)` |
| useDeleteExpense | `dashboard(businessDate)`, `cashCounts(businessDate)` (vì RPC dọn cash_drawer_events) |

### 4.4 Data flow

```
User input description+amount+...
   ↓
ExpenseForm.submit
   ↓ validateExpense({...})  ← @/lib/validation (Phase 1, frozen)
   ↓ on validation error → setFieldError + toast danger + return
   ↓ on validation ok → mutateAsync({ business_date, ... })
                      ↓ createExpense RPC → expenses INSERT + cash_drawer_events INSERT
                      ↓ onSuccess → invalidate dashboard + templates
                      ↓ refetch dashboard → Phase 3A DashboardView's ExpenseLogCard refreshes too
   ↓ form reset (description, quantity=1, unitPrice, amount, note); keep category + unit defaults
   ↓ toast success "Đã lưu khoản chi"

User click "+ Mẫu"
   ↓ ExpenseForm setTemplateModalOpen(true)
   ↓ ExpenseTemplateModal renders (Phase 2 Modal, portal)
   ↓ User fills label + defaults + submits
   ↓ useCreateExpenseTemplate.mutateAsync
   ↓ on success → onCreated callback (ExpenseForm.applyTemplate(template))
                → form fields filled from template
                → setTemplateModalOpen(false)

User click row in ExpenseHistoryCard (owner/manager only)
   ↓ setEditing(expense)
   ↓ ExpenseEditModal renders with expense prop
   ↓ User edits description/note → mutateAsync update
     OR clicks "Xóa" → confirmDelete state → confirm Modal nested
                    → user confirms → mutateAsync delete

   On any mutation success/error → toast feedback + close modal/parent decides
```

### 4.5 Component → Phase 2 mapping

| Element | Component |
|---|---|
| ExpensesView outer 2-col | Tailwind `grid lg:grid-cols-[1.4fr_1fr] gap-6` |
| Form container | Phase 2 `<Card>` + `<CardHeader>` + `<CardBody>` |
| History container | Phase 2 `<Card>` + `<CardHeader>` + `<CardBody>` |
| TextField (description, qty, unit, unitPrice, amount, note) | Phase 2 `<TextField label="..." />` |
| Category select | Phase 2 `<Select>` (Radix Select wrapper) |
| Note textarea | Phase 2 — there's no Textarea in Phase 2 currently. Inline `<textarea>` styled with same Tailwind class as TextField. Note in spec to add a Textarea component to Phase 2 later if it's used more. |
| Quick-template chip | Phase 2 `<Badge>`? No — bigger, clickable. Custom `<button>` styled with `bg-surface rounded-full border border-border px-3 py-1.5 text-sm hover:border-border-strong`. |
| Submit button | Phase 2 `<Button variant="primary" size="lg" type="submit">` |
| "+ Mẫu" button | Phase 2 `<Button variant="secondary" size="sm">` |
| Form-level error | Phase 2 `<AlertBanner variant="danger">` |
| Toast feedback | Phase 2 `useToast()` |
| Modal shell | Phase 2 `<Modal open={open} onOpenChange={...}><ModalContent><ModalTitle>...</ModalTitle>...<ModalActions>...</ModalActions></ModalContent></Modal>` |
| Confirm-delete inside ExpenseEditModal | Nested Phase 2 Modal (separate state) |
| Row click hover state | Tailwind `cursor-pointer hover:bg-surface-muted` |
| Empty state in history | Phase 2 `<EmptyState icon="wallet" ...>` |
| Icon: trash, save, plus | Phase 2 Icon name from icons.tsx — `trash`/`save` NOT in current registry. **Need to add 2 icons in this phase.** Existing: `plus` ✓ |

### 4.6 Icons to add (additive, before form components)

Tasks need to add 2 icons additively to `src/components/ui/icons.tsx`:
- `trash` → lucide `Trash2`
- `save` → lucide `Save`

Phase 3A added 15 icons; this adds 2 more. Existing icons untouched.

---

## 5. Component specs

### 5.1 ExpensesView

**Props:** `{ businessDate: string; role: UserRole }`

**Responsibilities:**
- Mount queries (dashboard, categories, templates)
- Layout 2-col bento; on mobile (<lg) stack form on top of history
- Pass `expenses` array + `role` down to history; pass `categories`/`templates` to form
- Loading / error states for dashboard query (Phase 3A pattern: Spinner / AlertBanner)

### 5.2 ExpenseForm

**Props:**
```ts
interface ExpenseFormProps {
  businessDate: string;
  categories: ReadonlyArray<ExpenseCategory>;
  templates: ReadonlyArray<ExpenseTemplate>;
}
```

**Internal state:** `categoryId, templateId, description, quantity, unit, unitPrice, amount, note, fieldError, isTemplateModalOpen`.

**Submit behavior:**
1. Compute `finalAmount = moneyFromInput(amount) || (Number(quantity) || 0) * moneyFromInput(unitPrice)`.
2. Call `validateExpense({ description, quantity, unit_price, amount, note })`. If fails: set fieldError + toast danger + return.
3. `useCreateExpense.mutateAsync({...})`.
4. On success: reset form (description, quantity → "1", unitPrice, amount, note), keep category + unit defaults; toast success.
5. On error: toast danger.

**Quick-template rail:**
- Top 8 templates (by usage_count from `loadExpenseTemplates`).
- Click → `applyTemplate(template)` sets fields from template metadata.
- Empty state: muted text "Chưa có mẫu chi."
- "+ Mẫu" button → opens ExpenseTemplateModal.

**Form layout:**
```
┌─ Card ──────────────────────────────────────────┐
│  Eyebrow: "Nhập chi"     CardTitle  ₫ FinalAmt │
│  ─────────────────────────────────              │
│  Quick templates rail:                          │
│  [+ Mẫu]  [Bánh mì 30k] [Trứng 20k] ...         │
│  ─────────────────────────────────              │
│  TextField: Loại chi phí (Select)               │
│  TextField: Nội dung                            │
│  ┌───────┬──────┬─────────────┐                 │
│  │ Số lượng │ Đơn vị │ Đơn giá │                 │
│  └───────┴──────┴─────────────┘                 │
│  TextField: Thành tiền (auto-computed)          │
│  Textarea: Ghi chú                              │
│  AlertBanner (if fieldError)                    │
│  Button: Lưu khoản chi · ₫ FinalAmt             │
└─────────────────────────────────────────────────┘
```

### 5.3 ExpenseTemplateModal

**Props:**
```ts
interface ExpenseTemplateModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  categories: ReadonlyArray<ExpenseCategory>;
  onCreated(template: ExpenseTemplate): void;
}
```

**State:** `label, categoryId, unit, unitPrice, isSaving`.

**Submit:**
- Validate: label.trim() non-empty.
- `useCreateExpenseTemplate.mutateAsync({...})`.
- On success: `onCreated(template)`, then `onOpenChange(false)`. Toast success.
- On error: toast danger; keep modal open.

**Layout (inside Phase 2 ModalContent):**
```
ModalTitle: "Thêm mẫu nhập nhanh"
ModalDescription (optional): "Dùng để lập form chi phí nhanh hơn lần sau"
Form:
  TextField: Tên mẫu (required, autoFocus)
  TextField: Danh mục (Select)
  Grid 2 cols:
    TextField: Đơn vị mặc định  | TextField: Đơn giá gần nhất
ModalActions:
  ButtonGhost: Đóng
  ButtonPrimary: "Lưu mẫu và áp dụng" (loading, disabled when !label.trim())
```

Vì Phase 2 Modal nằm trong Portal (ngoài DOM tree của ExpenseForm), **modal này dùng `<form>` đúng nghĩa** — Enter submit OK, không cần `<div>` + keyDown trick như v3.

### 5.4 ExpenseHistoryCard

**Props:**
```ts
interface ExpenseHistoryCardProps {
  expenses: ReadonlyArray<Expense>;
  total: number;
  role: UserRole;
  businessDate: string;
}
```

**Responsibilities:**
- Render Card với CardTitle "Lịch sử ngày" + total (right-aligned) trong header.
- Body: list rows (`<ul>` divide-y).
- Each row: description + category + time (left), amount (right).
- Row click (only if `role === "owner" || role === "manager"`) → mở ExpenseEditModal.
  - Row có class `cursor-pointer hover:bg-surface-muted` khi clickable.
  - Keyboard: `tabIndex={0}` + onKeyDown Enter/Space → mở modal.
- Empty state: `<EmptyState icon="wallet" title="Chưa có khoản chi" subtitle="Khi nhân viên nhập chi, dòng mới sẽ hiện tại đây." />`.

**State:** `editing: Expense | null`.

### 5.5 ExpenseEditModal

**Props:**
```ts
interface ExpenseEditModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  expense: Expense;
  businessDate: string;
}
```

**State:** `description, note, isConfirmingDelete`.

**Behavior:**
- Show read-only metadata: amount (hero), category, date, qty, unit, unit_price (NOT editable — preserves v3 constraint).
- Edit: description (required, max 500) + note (max 1000).
- "Lưu thay đổi" button: enabled when `dirty && !hasError && !isSaving && !isDeleting`. Calls `useUpdateExpense.mutateAsync`.
- "Xóa" button: opens nested confirm Modal (Phase 2 Modal with separate `open` state).
- Ctrl/Cmd+Enter on textarea → save (preserved v3).
- AutoFocus on description textarea.

**Validation:**
- `description.length > 500` → error "Mô tả vượt 500 ký tự."
- `description.trim() === ""` → error "Mô tả không được rỗng."
- `note.length > 1000` → error "Ghi chú vượt 1000 ký tự."

(These mirror v3 + Phase 1 `updateExpense` server-side guards.)

**Layout:**
```
ModalContent (default showClose)
  ModalTitle: ₫ {amount}  (formatted VND)
  Sub-eyebrow: "Sửa khoản chi"
  Meta dl: Số lượng | Đơn giá | Ngày
  TextField (textarea): Mô tả * (counter X/500)
  TextField (textarea): Ghi chú (counter X/1000)
  AlertBanner: validation errors (if any)
  ModalActions:
    Button danger ghost (Trash icon): "Xóa"
    Button primary (Save icon): "Lưu thay đổi"

[Nested confirm Modal — opens via setConfirmingDelete(true)]:
  ModalTitle: "Xóa khoản chi này?"
  ModalDescription: "₫ {amount} — {description}. Thao tác KHÔNG thể hoàn tác."
  ModalActions:
    Button ghost: "Hủy"
    Button destructive: "Xóa"
```

---

## 6. Error handling

| Scenario | Behavior |
|---|---|
| Validation fail (client) | `AlertBanner danger` inline + toast danger |
| Mutation network/RPC error | toast danger với message từ Error.message; modal stays open if applicable |
| Mutation success | toast success + form reset / modal close |
| `useDashboardQuery.isError` | AlertBanner inline (same Phase 3A pattern) |
| Supabase config thiếu | Phase 3A's top-level redirect/spinner handles; ExpensesView wouldn't mount |
| User without role for edit (e.g. staff_operator click row) | Row not clickable (no hover state, no tabIndex) — UI silently disabled |
| RPC `delete_expense` fail | toast danger; expense stays in list (refetch will re-add it) |

---

## 7. Vietnamese terminology (preserved)

| Tiếng Việt | Context |
|---|---|
| Loại chi phí | Category select |
| Nội dung | Description |
| Số lượng | Quantity |
| Đơn vị | Unit (cái, ổ, bao) |
| Đơn giá | Unit price |
| Thành tiền | Amount (final) |
| Ghi chú | Note |
| Mẫu nhanh | Quick template rail |
| Tên mẫu | Template label |
| Đơn vị mặc định | Default unit |
| Đơn giá gần nhất | Last unit price (template field) |
| Lưu khoản chi | Save expense button |
| Lưu mẫu và áp dụng | Save template + apply button |
| Sửa khoản chi | Edit modal title eyebrow |
| Xóa | Delete button |
| Thao tác KHÔNG thể hoàn tác | Confirm-delete warning |
| Chưa có khoản chi | Empty state title |
| Đã lưu khoản chi | Toast on create success |
| Đã cập nhật khoản chi | Toast on update success |
| Đã xóa khoản chi | Toast on delete success |
| Đã tạo mẫu chi mới | Toast on template create success |
| Đã áp dụng mẫu chi | Toast on template apply |

---

## 8. Verification strategy

### 8.1 Build verify
`npm run build` must remain clean. `/` route First Load JS may grow ~10-20 kB (4 new components + mutations hook).

### 8.2 Manual smoke (operator-driven)
After implementation:
1. `docker compose up -d`
2. Login as owner.
3. Click "Chi phí" tab → ExpensesView renders with empty history + form.
4. Tạo template: "+ Mẫu" → fill "Bánh mì" + category + đơn vị "ổ" + đơn giá 30000 → Lưu mẫu và áp dụng → form fills.
5. Tạo expense: adjust qty/note → Lưu khoản chi → list updates (via dashboard refetch).
6. Click row → edit modal opens → change description → Lưu thay đổi → list shows new description.
7. Click row → Xóa → confirm Modal → Xóa → row gone.
8. Staff_operator login: see expenses tab, can create but rows aren't clickable (no edit).
9. Switch business-date in TopBar to yesterday → history shows yesterday's expenses (if any).

### 8.3 Mirror verify (existing tool)
- After 3B.1 lands, `tools/verify-mirror.mjs` still applies — verify expense counts/totals after a write simulation against a mirror dump.
- Procedure unchanged from Phase 3A.

### 8.4 Test framework
**Deferred to Phase 3B.2.** No Vitest/pgTAP/Playwright in 3B.1.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Mutation success but invalidation misses a query → stale UI | All 4 mutations invalidate `dashboard(businessDate)` (the source of truth for the list); plus `templates()` for create/usage_count and `cashCounts(businessDate)` for delete. Test smoke #4-7 above catches stale data immediately. |
| User double-clicks "Save" → duplicate expenses | `useMutation.isPending` → submit button `disabled`; same pattern as existing Phase 3A POS sync button. |
| Nested confirm Modal causes Radix focus trap issues | Phase 2 Modal already handles portal + focus trap. Nesting confirmed-supported by Radix Dialog — focus moves to inner modal, returns to outer on close. Test in smoke. |
| `validateExpense` from `@/lib/validation` (Phase 1) signature might not match exactly what I'm calling | Plan task will verify import signature first, adapt if needed (Phase 1 helper is frozen — adapt component code, not the helper). |
| ExpenseForm `<form>` reset doesn't reset Select component if it's controlled | Use controlled values for Select; reset state explicitly. |
| `Textarea` không có trong Phase 2 component registry | Inline `<textarea>` với Tailwind classes giống TextField. Note trong implementation: nếu cần dùng nhiều, add Textarea vào Phase 2 ở phase sau. Trong 3B.1 chỉ có 2 usage (ExpenseForm note + ExpenseEditModal description/note) — inline OK. |

---

## 10. Definition of Done (Phase 3B.1)

- [ ] `ExpensesView` mounted; clicking "Chi phí" nav renders form + history.
- [ ] Tạo expense thành công → row hiện trong history + dashboard ExpenseLogCard.
- [ ] Tạo template thành công → chip xuất hiện trong rail; click chip → form fills.
- [ ] Edit expense (description+note) thành công → row text updated.
- [ ] Delete expense → confirm modal → confirmed → row gone; ExpenseLogCard ở dashboard cũng update.
- [ ] Owner + manager có thể edit; staff_operator chỉ có thể create + xem.
- [ ] Validation: description empty / >500, note >1000 → AlertBanner + Toast.
- [ ] All mutations show loading state on submit button.
- [ ] Mirror verify (`tools/verify-mirror.mjs --date <date>`) vẫn pass (no regression).
- [ ] `npm run build` clean.
- [ ] Code review: spec compliance + code quality both pass.
- [ ] Branch `phase-3b1-expenses` merged về `main`; tag `v4-phase-3b1`.

---

## 11. References

- **v3 source** (port-from):
  - `F:\Chill manager\v3\src\features\expenses\expense-form.tsx` — 199 dòng
  - `F:\Chill manager\v3\src\features\expenses\expense-template-modal.tsx` — 107 dòng
  - `F:\Chill manager\v3\src\features\expenses\expense-edit-modal.tsx` — 194 dòng
- **Phase 1 (ported, frozen)**:
  - `src/lib/data/expenses.ts` — 4 RPC wrappers (`createExpense`, `createExpenseTemplate`, `updateExpense`, `deleteExpense`) + template/category loaders
  - `src/lib/validation.ts` — `validateExpense({ description, quantity, unit_price, amount, note })`
  - `src/hooks/queries/use-expense-queries.ts` — `useExpenseCategoriesQuery`, `useExpenseTemplatesQuery`
  - `src/hooks/queries/use-dashboard-query.ts` — list of today's expenses comes from here (no separate query)
  - `src/hooks/queries/keys.ts` — `queryKeys.dashboard(...)`, `templates()`, `categories()`, `cashCounts(...)`
- **Phase 2 design system**:
  - `src/components/ui/{card,text-field,select,button,modal,alert-banner,toast,empty-state,badge}.tsx`
  - `src/components/ui/icons.tsx` (need to add `trash` + `save`)
- **Phase 3A**:
  - `src/app/page.tsx` — dispatcher (modify the `view === "expenses"` block)
  - `src/hooks/use-business-date.ts` — businessDate source of truth
  - `src/hooks/use-role-gate.ts` — role used to gate row click in history
- **Master plan**: `C:\Users\RAZER 15\.claude\plans\c-c-c-file-handoff-shimmering-kahan.md`
