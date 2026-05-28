# List Search + Sort Pattern — Design Spec

**Date:** 2026-05-28
**Branch (to be created):** `feat/list-search-sort`
**Base:** `main` (post-v4.1.13)
**Tag at end:** `v4.1.14`

---

## 0. TL;DR

Bổ sung pattern **search + sort + persistence** thống nhất cho 6 danh sách có sẵn:
Sổ quỹ, Tồn kho, Nguyên liệu, Sản phẩm, Công thức, lịch sử Chốt két ("dòng tiền").
Live text search (client-side), sortable column headers (click), và localStorage
persistence per-user per-list (nhớ search term + sort column + direction qua refresh).

Không động vào logic data fetching, không thêm RPC mới — tất cả là frontend-only
pattern áp dụng đồng bộ.

---

## 1. Goal

Owner/manager thao tác trên 6 danh sách dài (đặc biệt là Nguyên liệu, Sản phẩm
với 30-100+ rows) cần:

1. Tìm nhanh 1 mục theo tên (không cần scroll).
2. Sort theo cột mong muốn (số tồn, mệnh giá, ngày, v.v.).
3. Refresh trang KHÔNG mất state — đỡ phải set lại mỗi lần.

**Acceptance criteria:**

- 6 danh sách đều có toolbar với search input (search icon prefix) ở góc trái,
  filter có sẵn (date/type/showInactive) ở cùng toolbar bên phải, số kết quả
  hiện cuối toolbar.
- Search filter live khi gõ (no submit button); empty search → list về full.
- Sort: click cột header → sort asc → click lại → desc → click cột khác → reset.
  Indicator mũi tên (↑↓) hiện cạnh tên cột active.
- Refresh trang → search/sort được khôi phục từ localStorage.
- `dashboard-stock-list` có per-user lock đã tồn tại → giữ nguyên cơ chế đó,
  không hồi quy.
- `npm run verify` pass (typecheck + vitest + pgTAP — không có SQL change).

---

## 2. Non-Goals (deferred)

| Item | Reason |
|---|---|
| Server-side search/sort | Lists đều < 1000 rows; client-side đủ và faster UX. |
| Multi-column sort | YAGNI — chưa ai yêu cầu. |
| Filter combinator (AND/OR builder) | Filter đơn giản đã đủ. |
| Saved queries / pinned filters | YAGNI. |
| Search across multiple text fields với weight ranking | Đơn giản `includes()` lowercased là đủ. |
| Highlight match trong row | Visual polish, defer. |

---

## 3. Architecture

### 3.1 Reusable primitives

```
src/hooks/use-list-preferences.ts        ← NEW
src/components/ui/list-toolbar.tsx       ← NEW
src/components/ui/sortable-header.tsx    ← NEW (hoặc reuse DataTable)
```

**`useListPreferences(listKey)`** — hook quản lý state + persistence:
```ts
interface ListPrefs {
  search: string;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
}
function useListPreferences(listKey: string): {
  prefs: ListPrefs;
  setSearch(value: string): void;
  setSort(column: string | null): void;  // toggle / reset logic
};
```
- Khởi tạo từ `localStorage.getItem("list-prefs:" + listKey)`, fallback `{search:"", sortColumn:null, sortDirection:"asc"}`.
- Mỗi setter ghi lại localStorage (debounce 250ms cho search để không thrash).
- listKey ví dụ: `"safe-history"`, `"inventory.stock"`, `"inventory.ingredients"`, `"inventory.menu-items"`, `"inventory.recipes"`, `"cash.history"`.

**`<ListToolbar>`** — toolbar row component:
```tsx
<ListToolbar
  search={prefs.search}
  onSearchChange={setSearch}
  searchPlaceholder="Tìm theo tên..."
  resultCount={filteredRows.length}
>
  {/* slot cho filter có sẵn: date pickers, type dropdown, checkboxes */}
</ListToolbar>
```

**`<SortableHeader>`** — `<th>` wrapper với click handler + arrow indicator. Nếu
list đang dùng `DataTable` (Sổ quỹ) thì DataTable đã hỗ trợ sort → chỉ wire vào
useListPreferences. Nếu list dùng `<table>` thường (5 list còn lại) → wrap header
bằng SortableHeader.

### 3.2 Filtering + sorting

Mỗi list:
1. Fetch raw rows từ query hook.
2. Apply `prefs.search` → filter `rows.filter(r => searchableFields(r).toLowerCase().includes(prefs.search.toLowerCase()))`.
3. Apply `prefs.sortColumn` → `rows.sort(comparator)`.
4. Render.

`searchableFields(row)` — mỗi list định nghĩa fields nào search được (xem §4).
`comparator` — switch theo sortColumn, handle string/number/date.

---

## 4. Per-list specifics

| List | File | Search fields | Sortable columns | listKey |
|---|---|---|---|---|
| Sổ quỹ | `src/features/safe/safe-history-section.tsx` | description, category_name | occurred_at, amount, balance_after (đã có via DataTable) | `safe-history` |
| Tồn kho | `src/features/inventory/stock-tab.tsx` | ingredient_name | ingredient_name, balance, low_stock_threshold | `inventory.stock` |
| Nguyên liệu | `src/features/inventory/ingredients-tab.tsx` | name, notes | name, unit, low_stock_threshold | `inventory.ingredients` |
| Sản phẩm | `src/features/inventory/menu-items-tab.tsx` | name, external_product_name | name, external_product_name | `inventory.menu-items` |
| Công thức | `src/features/inventory/recipes-tab.tsx` | product_name | product_name | `inventory.recipes` |
| Lịch sử chốt két | `src/features/cash/cash-history-section.tsx` | note, count_type | counted_at, total_physical | `cash.history` |

**Note**: Sổ quỹ đã có date range + type dropdown trong toolbar — không động vào,
chỉ thêm search input vào cùng row.

**Note**: Tab "Nguyên liệu"/"Sản phẩm"/"Công thức" có sẵn checkbox `showInactive`
→ chuyển vào ListToolbar slot bên phải search.

**Note**: `dashboard-stock-list` (Bảng vận hành) đã có per-user lock cho sort cột
ưu tiên → KHÔNG migrate, giữ nguyên (khác use case — đó là sort lock, không phải
persistence cùng state).

---

## 5. Persistence schema

```
localStorage["list-prefs:safe-history"]       = {"search":"điện","sortColumn":"amount","sortDirection":"desc"}
localStorage["list-prefs:inventory.stock"]    = {"search":"sữa","sortColumn":"balance","sortDirection":"asc"}
...
```

- Schema version chưa cần — JSON shape ổn định.
- Nếu parse fail (corrupted) → fallback default + clear key.
- Cross-tab: không sync (mỗi tab độc lập). YAGNI.

---

## 6. Validation rules

| Rule | Where |
|---|---|
| Search input max length 100 ký tự | client input attr |
| Sort column phải nằm trong allowed list của mỗi list | guard trong hook setSort |
| localStorage parse fail → silent fallback | hook init |

---

## 7. Verification

### CI
- `npx tsc --noEmit` clean.
- Vitest: thêm test cho `useListPreferences` (init, set, persist, restore).
- Vitest: 1 test cho ListToolbar render + onChange callback.
- pgTAP: không thay đổi (no SQL).

### Manual smoke (mỗi 6 list)
1. Gõ search → list filter live.
2. Click cột header → sort asc → click lại → desc → click cột khác → reset.
3. Refresh trang → search term + sort được khôi phục.
4. Clear search → list về full.
5. Cross-tab independence: mở 2 tab cùng list → state KHÔNG sync (yêu cầu).

### Regression
- `dashboard-stock-list` per-user lock vẫn hoạt động (không bị overrided bởi
  pattern mới).
- Sổ quỹ date range + type dropdown vẫn hoạt động.
- Tab inventory `showInactive` toggle vẫn hoạt động.

---

## 8. Execution order

1. Branch `feat/list-search-sort` off `origin/main`.
2. Build primitives: `useListPreferences`, `ListToolbar`, `SortableHeader`.
3. Vitest cho primitives.
4. Apply pattern lần lượt 6 lists (mỗi list 1 commit nếu PR-by-PR review tốt hơn).
5. Manual smoke từng list trên preview.
6. Commit + push + PR.
7. CI green → merge → tag `v4.1.14` → release.

---

## 9. Open assumptions / risks

- **"Dòng tiền" trong yêu cầu user = lịch sử chốt két** (`cash-history-section`).
  Nếu user ý khác (ví dụ: `by_day` data trong cashflow page) → re-scope.
- **`dashboard-stock-list` không gộp pattern** — vì nó có cơ chế lock riêng. Nếu
  sau này muốn unify, có thể migrate sang useListPreferences với mode "locked".
- **Recipes tab structure**: tab này có 2 section (gap report + existing recipes).
  Search/sort chỉ áp cho section "existing recipes". Section gap report nhỏ, không
  cần.
- **Cross-tab sync**: không hỗ trợ — nếu user dùng 2 tab cùng lúc, mỗi tab có state
  riêng. localStorage chỉ persist qua refresh, không sync realtime.
- **Karpathy surgical**: chỉ thêm primitives + toolbar/header vào mỗi list. KHÔNG
  refactor table structures, KHÔNG đổi data source.
- **i18n**: Tiếng Việt cho placeholder + label, consistent với codebase.
