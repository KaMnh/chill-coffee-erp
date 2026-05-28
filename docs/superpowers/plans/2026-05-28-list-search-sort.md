# List Search + Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unified search + sort + localStorage persistence pattern to 6 lists (Sổ quỹ, Tồn kho, Nguyên liệu, Sản phẩm, Công thức, Lịch sử Chốt két).

**Architecture:** Build 3 reusable primitives (`useListPreferences` hook, `<ListToolbar>` component, controlled-mode upgrade for `DataTable`). Apply pattern to 6 lists. For Sổ quỹ (uses `DataTable`), wire controlled sort props. For 5 card-based lists, use Sort dropdown integrated into ListToolbar.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest (component tests), localStorage (persistence).

---

## Important deviation from spec

Spec §3.1 proposed a `<SortableHeader>` primitive assuming `<th>` clicks. After file inspection:
- Only **1 of 6 lists** uses real `<table>` headers (Sổ quỹ via `DataTable`)
- **5 of 6 lists** are Card-per-row layout (no `<thead>` to attach headers to)

**Adapted UX**: Sort dropdown integrated into `<ListToolbar>` for card-based lists. For Sổ quỹ, upgrade `DataTable` to accept controlled sort props from `useListPreferences`. Functionality (live search + sort + persistence) is identical; UI mechanism differs per list type. User mockup approval was about pattern intent (clickable sort control), which both implementations satisfy.

---

## File structure

```
src/
  hooks/
    use-list-preferences.ts          ← NEW (Task 1)
    __tests__/
      use-list-preferences.test.ts   ← NEW (Task 1)
  components/
    ui/
      list-toolbar.tsx               ← NEW (Task 2)
      data-table.tsx                 ← MODIFY (Task 3 — add controlled sort)
      __tests__/
        list-toolbar.test.tsx        ← NEW (Task 2)
        data-table.test.tsx          ← NEW (Task 3, only if doesn't exist)
  features/
    safe/
      safe-history-section.tsx       ← MODIFY (Task 4)
    inventory/
      stock-balance-list.tsx         ← MODIFY (Task 5 — present needs toolbar+sort hoisted to parent)
      stock-tab.tsx                  ← MODIFY (Task 5 — owns prefs, passes filtered/sorted)
      ingredients-tab.tsx            ← MODIFY (Task 6)
      menu-items-tab.tsx             ← MODIFY (Task 7)
      recipes-tab.tsx                ← MODIFY (Task 8)
    cash/
      cash-history-section.tsx       ← MODIFY (Task 9)
```

**listKey registry** (centralized values):

| List | listKey | Search fields | Sort options |
|---|---|---|---|
| Sổ quỹ | `safe-history` | description, reason_category | (via DataTable: occurred_at, amount) |
| Tồn kho | `inventory.stock` | name | Tên A→Z, Tên Z→A, Tồn cao→thấp, Tồn thấp→cao |
| Nguyên liệu | `inventory.ingredients` | name, notes | Tên A→Z, Tên Z→A |
| Sản phẩm | `inventory.menu-items` | name, external_product_name | Tên A→Z, Tên Z→A |
| Công thức | `inventory.recipes` | product_name | Tên A→Z, Tên Z→A |
| Lịch sử Chốt két | `cash.history` | note | Mới nhất, Cũ nhất, Số tiền cao, Số tiền thấp |

---

## Task 1: `useListPreferences` hook

**Files:**
- Create: `src/hooks/use-list-preferences.ts`
- Test: `src/hooks/__tests__/use-list-preferences.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/__tests__/use-list-preferences.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useListPreferences } from "../use-list-preferences";

describe("useListPreferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("initializes with empty defaults when localStorage empty", () => {
    const { result } = renderHook(() => useListPreferences("test"));
    expect(result.current.prefs).toEqual({
      search: "",
      sortColumn: null,
      sortDirection: "asc",
    });
  });

  it("restores from localStorage on init", () => {
    localStorage.setItem(
      "list-prefs:test",
      JSON.stringify({ search: "milk", sortColumn: "name", sortDirection: "desc" }),
    );
    const { result } = renderHook(() => useListPreferences("test"));
    expect(result.current.prefs).toEqual({
      search: "milk",
      sortColumn: "name",
      sortDirection: "desc",
    });
  });

  it("setSearch updates state and writes to localStorage (after debounce)", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useListPreferences("test"));
    act(() => {
      result.current.setSearch("sữa");
    });
    expect(result.current.prefs.search).toBe("sữa");
    // Localstorage write is debounced
    expect(localStorage.getItem("list-prefs:test")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const stored = JSON.parse(localStorage.getItem("list-prefs:test") ?? "{}");
    expect(stored.search).toBe("sữa");
    vi.useRealTimers();
  });

  it("setSort toggles asc → desc → reset", () => {
    const { result } = renderHook(() => useListPreferences("test"));
    // First click on "name": asc
    act(() => result.current.setSort("name"));
    expect(result.current.prefs.sortColumn).toBe("name");
    expect(result.current.prefs.sortDirection).toBe("asc");
    // Second click on "name": desc
    act(() => result.current.setSort("name"));
    expect(result.current.prefs.sortDirection).toBe("desc");
    // Click different column: asc again
    act(() => result.current.setSort("amount"));
    expect(result.current.prefs.sortColumn).toBe("amount");
    expect(result.current.prefs.sortDirection).toBe("asc");
  });

  it("setSort with null clears sort", () => {
    const { result } = renderHook(() => useListPreferences("test"));
    act(() => result.current.setSort("name"));
    act(() => result.current.setSort(null));
    expect(result.current.prefs.sortColumn).toBeNull();
  });

  it("setSort persists to localStorage immediately (no debounce)", () => {
    const { result } = renderHook(() => useListPreferences("test"));
    act(() => result.current.setSort("name"));
    const stored = JSON.parse(localStorage.getItem("list-prefs:test") ?? "{}");
    expect(stored.sortColumn).toBe("name");
    expect(stored.sortDirection).toBe("asc");
  });

  it("falls back to defaults if localStorage value is corrupted", () => {
    localStorage.setItem("list-prefs:test", "{corrupted}");
    const { result } = renderHook(() => useListPreferences("test"));
    expect(result.current.prefs).toEqual({
      search: "",
      sortColumn: null,
      sortDirection: "asc",
    });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/hooks/__tests__/use-list-preferences.test.ts
```
Expected: FAIL with "Cannot find module ../use-list-preferences".

- [ ] **Step 3: Implement the hook**

Create `src/hooks/use-list-preferences.ts`:

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface ListPrefs {
  search: string;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
}

const DEFAULT_PREFS: ListPrefs = {
  search: "",
  sortColumn: null,
  sortDirection: "asc",
};

const SEARCH_DEBOUNCE_MS = 300;

function storageKey(listKey: string): string {
  return `list-prefs:${listKey}`;
}

function loadPrefs(listKey: string): ListPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(storageKey(listKey));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      search: typeof parsed.search === "string" ? parsed.search : "",
      sortColumn: typeof parsed.sortColumn === "string" ? parsed.sortColumn : null,
      sortDirection: parsed.sortDirection === "desc" ? "desc" : "asc",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function savePrefs(listKey: string, prefs: ListPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(listKey), JSON.stringify(prefs));
  } catch {
    /* quota exceeded — silent */
  }
}

export interface UseListPreferencesReturn {
  prefs: ListPrefs;
  setSearch(value: string): void;
  setSort(column: string | null): void;
}

/**
 * Hook to manage list search + sort state with localStorage persistence
 * keyed per list. Search writes are debounced ({@link SEARCH_DEBOUNCE_MS}ms);
 * sort writes are immediate.
 */
export function useListPreferences(listKey: string): UseListPreferencesReturn {
  const [prefs, setPrefs] = useState<ListPrefs>(() => loadPrefs(listKey));
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  const setSearch = useCallback(
    (value: string) => {
      setPrefs((current) => {
        const next = { ...current, search: value };
        if (debounceRef.current !== null) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          savePrefs(listKey, next);
          debounceRef.current = null;
        }, SEARCH_DEBOUNCE_MS);
        return next;
      });
    },
    [listKey],
  );

  const setSort = useCallback(
    (column: string | null) => {
      setPrefs((current) => {
        let next: ListPrefs;
        if (column === null) {
          next = { ...current, sortColumn: null, sortDirection: "asc" };
        } else if (current.sortColumn === column) {
          next = {
            ...current,
            sortDirection: current.sortDirection === "asc" ? "desc" : "asc",
          };
        } else {
          next = { ...current, sortColumn: column, sortDirection: "asc" };
        }
        savePrefs(listKey, next);
        return next;
      });
    },
    [listKey],
  );

  return { prefs, setSearch, setSort };
}
```

- [ ] **Step 4: Run tests, verify all pass**

```bash
npx vitest run src/hooks/__tests__/use-list-preferences.test.ts
```
Expected: PASS — 7/7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-list-preferences.ts src/hooks/__tests__/use-list-preferences.test.ts
git commit -m "$(cat <<'EOF'
feat(hooks): useListPreferences with localStorage persistence

Hook manages per-list search + sort state. Search writes debounced 300ms,
sort writes immediate. Corrupted localStorage falls back to defaults.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `<ListToolbar>` component

**Files:**
- Create: `src/components/ui/list-toolbar.tsx`
- Test: `src/components/ui/__tests__/list-toolbar.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `src/components/ui/__tests__/list-toolbar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ListToolbar } from "../list-toolbar";

describe("ListToolbar", () => {
  it("renders search input with placeholder", () => {
    render(<ListToolbar search="" onSearchChange={() => {}} searchPlaceholder="Tìm..." />);
    expect(screen.getByPlaceholderText("Tìm...")).toBeInTheDocument();
  });

  it("calls onSearchChange when user types", () => {
    const onChange = vi.fn();
    render(<ListToolbar search="" onSearchChange={onChange} searchPlaceholder="Tìm..." />);
    fireEvent.change(screen.getByPlaceholderText("Tìm..."), { target: { value: "sữa" } });
    expect(onChange).toHaveBeenCalledWith("sữa");
  });

  it("shows result count when provided", () => {
    render(
      <ListToolbar
        search=""
        onSearchChange={() => {}}
        searchPlaceholder="Tìm..."
        resultCount={12}
        resultLabel="nguyên liệu"
      />,
    );
    expect(screen.getByText("12 nguyên liệu")).toBeInTheDocument();
  });

  it("renders sort options when provided", () => {
    const onSortChange = vi.fn();
    render(
      <ListToolbar
        search=""
        onSearchChange={() => {}}
        searchPlaceholder="Tìm..."
        sortOptions={[
          { value: "name-asc", label: "Tên A→Z" },
          { value: "name-desc", label: "Tên Z→A" },
        ]}
        sortValue="name-asc"
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByText("Tên A→Z")).toBeInTheDocument();
  });

  it("renders extra slot children", () => {
    render(
      <ListToolbar search="" onSearchChange={() => {}} searchPlaceholder="Tìm...">
        <span>Extra filter</span>
      </ListToolbar>,
    );
    expect(screen.getByText("Extra filter")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/components/ui/__tests__/list-toolbar.test.tsx
```
Expected: FAIL with "Cannot find module ../list-toolbar".

- [ ] **Step 3: Implement the component**

Create `src/components/ui/list-toolbar.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { Icon } from "./icons";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./select";
import { cn } from "@/lib/cn";

export interface SortOption {
  value: string;
  label: string;
}

export interface ListToolbarProps {
  /** Current search value (controlled). */
  search: string;
  onSearchChange(value: string): void;
  searchPlaceholder: string;
  /** Optional result count to display (e.g. "12 nguyên liệu"). */
  resultCount?: number;
  /** Label shown after the count (e.g. "nguyên liệu"). Default: "kết quả". */
  resultLabel?: string;
  /** Sort options + handlers. If omitted, no sort selector renders. */
  sortOptions?: SortOption[];
  sortValue?: string;
  onSortChange?(value: string): void;
  /** Extra slot for filter chips, checkboxes, etc. Rendered between search and count. */
  children?: ReactNode;
  className?: string;
}

/**
 * Unified toolbar above a list: search input (left), filter slot (center),
 * sort selector + result count (right). Designed for both DataTable and
 * card-based lists.
 */
export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  resultCount,
  resultLabel = "kết quả",
  sortOptions,
  sortValue,
  onSortChange,
  children,
  className,
}: ListToolbarProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        className,
      )}
    >
      <div className="flex-1 min-w-[12rem] relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <Icon name="search" size={16} />
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          maxLength={100}
          className="h-10 w-full pl-9 pr-3 rounded-sm bg-surface border border-border text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong transition-colors"
        />
      </div>

      {children}

      {sortOptions && sortOptions.length > 0 && sortValue && onSortChange && (
        <Select value={sortValue} onValueChange={onSortChange}>
          <SelectTrigger className="h-10 min-w-[10rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {resultCount !== undefined && (
        <span className="text-xs text-muted whitespace-nowrap">
          {resultCount} {resultLabel}
        </span>
      )}
    </div>
  );
}
```

**Pre-check the icon name**: Verify `search` icon exists in `src/components/ui/icons.tsx`:

```bash
grep -n "\"search\"\|search:" src/components/ui/icons.tsx
```

If `search` icon is not in the icon set, use `"magnifyingGlass"` or whichever close lucide alias exists. Adjust the Icon name above accordingly. (Lucide ships `search`; the project's Icon wrapper most likely exposes it under the same name.)

- [ ] **Step 4: Run tests, verify all pass**

```bash
npx vitest run src/components/ui/__tests__/list-toolbar.test.tsx
```
Expected: PASS — 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/list-toolbar.tsx src/components/ui/__tests__/list-toolbar.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): ListToolbar component for list views

Unified toolbar with search input (icon-prefixed), filter slot,
optional sort Select, optional result count. Search input is
controlled (debounce lives in useListPreferences caller).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `DataTable` controlled-sort upgrade

**Files:**
- Modify: `src/components/ui/data-table.tsx`
- Test: `src/components/ui/__tests__/data-table.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Check if test file exists:
```bash
ls src/components/ui/__tests__/data-table.test.tsx 2>/dev/null
```

If absent, create `src/components/ui/__tests__/data-table.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DataTable, type DataTableColumn } from "../data-table";

interface Row {
  id: string;
  name: string;
  amount: number;
}

const rows: Row[] = [
  { id: "1", name: "Alpha", amount: 100 },
  { id: "2", name: "Beta", amount: 200 },
];

const columns: DataTableColumn<Row>[] = [
  { key: "name", header: "Name", sortable: true },
  { key: "amount", header: "Amount", sortable: true },
];

describe("DataTable controlled sort", () => {
  it("calls onSortChange when controlled sortKey is set externally", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        sortKey="name"
        sortDirection="asc"
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    // Same column → toggle direction
    expect(onSortChange).toHaveBeenCalledWith({ key: "name", direction: "desc" });
  });

  it("calls onSortChange with new column when different column clicked", () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        sortKey="name"
        sortDirection="asc"
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /amount/i }));
    expect(onSortChange).toHaveBeenCalledWith({ key: "amount", direction: "asc" });
  });

  it("falls back to internal state when not controlled", () => {
    render(<DataTable columns={columns} data={rows} rowKey={(r) => r.id} />);
    // internal state — clicking should still sort visually without errors
    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    // No assertion on emitted event since uncontrolled
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

```bash
npx vitest run src/components/ui/__tests__/data-table.test.tsx
```
Expected: FAIL — onSortChange prop doesn't exist yet.

- [ ] **Step 3: Replace `data-table.tsx`**

Replace the entire content of `src/components/ui/data-table.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface DataTableColumn<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableSortState {
  key: string;
  direction: "asc" | "desc";
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  className?: string;
  /**
   * Optional controlled sort state. If `sortKey` is provided, the table
   * does NOT sort internally — the parent owns sorted data + handles
   * sort changes via {@link onSortChange}. If omitted, internal state used.
   */
  sortKey?: string | null;
  sortDirection?: "asc" | "desc";
  onSortChange?(next: DataTableSortState): void;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = "Không có dữ liệu",
  className,
  sortKey: controlledSortKey,
  sortDirection: controlledSortDirection,
  onSortChange,
}: DataTableProps<T>) {
  const [internalSortKey, setInternalSortKey] = useState<string | null>(null);
  const [internalSortDir, setInternalSortDir] = useState<"asc" | "desc">("asc");

  const isControlled = controlledSortKey !== undefined;
  const sortKey = isControlled ? controlledSortKey : internalSortKey;
  const sortDir = isControlled
    ? (controlledSortDirection ?? "asc")
    : internalSortDir;

  // Internal sort only applies when uncontrolled (parent assumes
  // pre-sorted data when controlled).
  const sorted =
    !isControlled && sortKey
      ? [...data].sort((a, b) => {
          const av = (a as Record<string, unknown>)[sortKey];
          const bv = (b as Record<string, unknown>)[sortKey];
          if (av === bv) return 0;
          const cmp = (av as string | number) < (bv as string | number) ? -1 : 1;
          return sortDir === "asc" ? cmp : -cmp;
        })
      : data;

  function toggleSort(key: string) {
    if (isControlled) {
      const nextDir: "asc" | "desc" =
        sortKey === key && sortDir === "asc" ? "desc" : "asc";
      onSortChange?.({ key, direction: nextDir });
      return;
    }
    if (internalSortKey === key) {
      setInternalSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setInternalSortKey(key);
      setInternalSortDir("asc");
    }
  }

  return (
    <div className={cn("bg-surface rounded-lg overflow-hidden", className)}>
      <table className="w-full text-sm">
        <thead className="bg-surface-muted">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted",
                  col.className,
                )}
              >
                {col.sortable ? (
                  <button
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                  >
                    {col.header}
                    {sortKey === col.key && (
                      <Icon
                        name="chevronDown"
                        size={16}
                        className={cn(sortDir === "asc" && "rotate-180")}
                      />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center py-8 text-muted text-sm"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-t border-border tabular-nums"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn("px-4 py-3 text-ink", col.className)}
                  >
                    {col.render
                      ? col.render(row)
                      : String(
                          (row as Record<string, unknown>)[col.key] ?? "",
                        )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
npx vitest run src/components/ui/__tests__/data-table.test.tsx
```
Expected: PASS — 3/3 tests.

Also run the full vitest suite to ensure no regression:
```bash
npx vitest run
```
Expected: All previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/data-table.tsx src/components/ui/__tests__/data-table.test.tsx
git commit -m "$(cat <<'EOF'
feat(ui): DataTable supports controlled sort state

Adds optional sortKey/sortDirection/onSortChange props. When controlled,
parent owns the sorted data + sort state. When uncontrolled, falls back
to existing internal state (backward compatible — no existing callers
need to change).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Apply to Sổ quỹ (Safe history) — DataTable

**Files:**
- Modify: `src/features/safe/safe-history-section.tsx`

- [ ] **Step 1: Add useListPreferences + search filtering**

Modify `src/features/safe/safe-history-section.tsx`:

1. Add imports at top (after existing imports):
   ```tsx
   import { useMemo } from "react";
   import { useListPreferences } from "@/hooks/use-list-preferences";
   import { ListToolbar } from "@/components/ui/list-toolbar";
   ```

2. Inside `SafeHistorySection` function, AFTER the `columns` declaration and BEFORE `return`, add:
   ```tsx
   const { prefs, setSearch, setSort } = useListPreferences("safe-history");

   const filteredSorted = useMemo(() => {
     const term = prefs.search.trim().toLowerCase();
     const filtered = !term
       ? transactions
       : transactions.filter((t) => {
           const desc = (t.description ?? "").toLowerCase();
           const cat = (t.reason_category ?? "").toLowerCase();
           return desc.includes(term) || cat.includes(term);
         });
     if (!prefs.sortColumn) return filtered;
     const key = prefs.sortColumn;
     const dir = prefs.sortDirection;
     return [...filtered].sort((a, b) => {
       const av = (a as Record<string, unknown>)[key];
       const bv = (b as Record<string, unknown>)[key];
       if (av === bv) return 0;
       const cmp = (av as string | number) < (bv as string | number) ? -1 : 1;
       return dir === "asc" ? cmp : -cmp;
     });
   }, [transactions, prefs.search, prefs.sortColumn, prefs.sortDirection]);
   ```

3. Replace the existing filter row (`<div className="flex flex-wrap items-end gap-3">...</div>` block, lines ~134-168) with:
   ```tsx
   <ListToolbar
     search={prefs.search}
     onSearchChange={setSearch}
     searchPlaceholder="Tìm theo mô tả, hạng mục..."
     resultCount={filteredSorted.length}
     resultLabel="giao dịch"
   >
     <TextField
       label="Từ ngày"
       type="date"
       value={fromDate}
       onChange={(e) => onFromDateChange(e.target.value)}
       className="min-w-[10rem]"
     />
     <TextField
       label="Đến ngày"
       type="date"
       value={toDate}
       onChange={(e) => onToDateChange(e.target.value)}
       className="min-w-[10rem]"
     />
     <Select
       value={typeFilter}
       onValueChange={(v) => onTypeFilterChange(v as SafeTransactionType | "all")}
     >
       <SelectTrigger className="min-w-[10rem] h-10">
         <SelectValue />
       </SelectTrigger>
       <SelectContent>
         <SelectItem value="all">Tất cả</SelectItem>
         {TYPES.map((t) => (
           <SelectItem key={t} value={t}>
             {TYPE_LABELS[t]}
           </SelectItem>
         ))}
       </SelectContent>
     </Select>
     <Button variant="ghost" onClick={onResetFilter}>
       Xóa lọc
     </Button>
   </ListToolbar>
   ```

4. Replace the `<DataTable ... data={transactions} ... />` (~line 180) with controlled version:
   ```tsx
   <DataTable
     columns={columns}
     data={filteredSorted}
     rowKey={(row) => row.id}
     sortKey={prefs.sortColumn}
     sortDirection={prefs.sortDirection}
     onSortChange={({ key }) => setSort(key)}
   />
   ```

5. Update `EmptyState` check — `transactions.length` becomes `filteredSorted.length`:
   ```tsx
   ) : filteredSorted.length === 0 ? (
     <EmptyState
       icon="fileText"
       title={prefs.search ? "Không tìm thấy giao dịch" : "Không có giao dịch nào"}
       subtitle={
         prefs.search
           ? "Thử từ khóa khác hoặc xóa filter."
           : "Thử mở rộng khoảng ngày hoặc xóa lọc."
       }
     />
   ) : (
   ```

- [ ] **Step 2: Verify typecheck**

```bash
npx tsc --noEmit
```
Expected: No errors related to the modified file.

- [ ] **Step 3: Manual smoke**

Local dev server should be running on port 3009. Login as owner. Navigate to `/safe`.

1. Type "điện" in search → list filters live.
2. Click "Thời điểm" column header → sort asc → click again → desc.
3. Refresh page → search term + sort restored.
4. Clear search → full list returns (within date range).
5. Date range + type filter still work.

- [ ] **Step 4: Commit**

```bash
git add src/features/safe/safe-history-section.tsx
git commit -m "$(cat <<'EOF'
feat(safe): search + sort persistence for safe history

Sổ quỹ now has live text search (description + reason_category),
clickable sortable column headers wired to localStorage, and
preserves state across refresh via useListPreferences hook.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Apply to Tồn kho (Stock balance) — Card-based

**Files:**
- Modify: `src/features/inventory/stock-tab.tsx` (owns prefs, filters/sorts data)
- Modify: `src/features/inventory/stock-balance-list.tsx` (no changes needed if parent passes filtered data — confirm via re-read)

Strategy: lift filter+sort logic into parent (`stock-tab.tsx`), keep `StockBalanceList` pure presentation.

- [ ] **Step 1: Modify `stock-tab.tsx`**

In `src/features/inventory/stock-tab.tsx`:

1. Add imports:
   ```tsx
   import { useListPreferences } from "@/hooks/use-list-preferences";
   import { ListToolbar } from "@/components/ui/list-toolbar";
   ```

2. Inside `StockTab`, after `const balances = balancesQuery.data ?? [];`, add:
   ```tsx
   const { prefs, setSearch, setSort } = useListPreferences("inventory.stock");

   const filteredSortedBalances = useMemo(() => {
     const term = prefs.search.trim().toLowerCase();
     const filtered = !term
       ? balances
       : balances.filter((b) => b.name.toLowerCase().includes(term));
     if (!prefs.sortColumn) return filtered;
     return [...filtered].sort((a, b) => {
       let av: string | number;
       let bv: string | number;
       switch (prefs.sortColumn) {
         case "name":
           av = a.name.toLowerCase();
           bv = b.name.toLowerCase();
           break;
         case "balance":
           av = a.theoretical_balance;
           bv = b.theoretical_balance;
           break;
         default:
           return 0;
       }
       if (av === bv) return 0;
       const cmp = av < bv ? -1 : 1;
       return prefs.sortDirection === "asc" ? cmp : -cmp;
     });
   }, [balances, prefs.search, prefs.sortColumn, prefs.sortDirection]);

   const sortOptions = [
     { value: "name:asc", label: "Tên (A→Z)" },
     { value: "name:desc", label: "Tên (Z→A)" },
     { value: "balance:desc", label: "Tồn (cao → thấp)" },
     { value: "balance:asc", label: "Tồn (thấp → cao)" },
   ];

   const currentSortValue = prefs.sortColumn
     ? `${prefs.sortColumn}:${prefs.sortDirection}`
     : "name:asc";

   function handleSortChange(value: string) {
     const [col, dir] = value.split(":");
     // Use setSort, then if direction needs to flip, set again
     // Simpler: manage column+dir together by inlining
     if (col !== prefs.sortColumn) {
       setSort(col);
       if (dir === "desc") setSort(col); // flip
     } else if (prefs.sortDirection !== dir) {
       setSort(col); // toggle
     }
   }
   ```

   **Note**: `useListPreferences.setSort` toggles direction. To set BOTH column and direction from a single dropdown selection, we need a more direct setter. **Update `useListPreferences` to add a `setSortExplicit` method.** Apply this in Task 5a below.

- [ ] **Step 1a: Add `setSortExplicit` to useListPreferences**

In `src/hooks/use-list-preferences.ts`, add to the interface and implementation:

```ts
export interface UseListPreferencesReturn {
  prefs: ListPrefs;
  setSearch(value: string): void;
  setSort(column: string | null): void;
  /** Explicitly set both column and direction (used by Sort dropdown). */
  setSortExplicit(column: string, direction: "asc" | "desc"): void;
}
```

Add inside the hook body, after `setSort`:

```ts
const setSortExplicit = useCallback(
  (column: string, direction: "asc" | "desc") => {
    setPrefs((current) => {
      const next: ListPrefs = { ...current, sortColumn: column, sortDirection: direction };
      savePrefs(listKey, next);
      return next;
    });
  },
  [listKey],
);

return { prefs, setSearch, setSort, setSortExplicit };
```

Add a test:

```ts
it("setSortExplicit sets both column and direction", () => {
  const { result } = renderHook(() => useListPreferences("test"));
  act(() => result.current.setSortExplicit("amount", "desc"));
  expect(result.current.prefs.sortColumn).toBe("amount");
  expect(result.current.prefs.sortDirection).toBe("desc");
});
```

Run:
```bash
npx vitest run src/hooks/__tests__/use-list-preferences.test.ts
```
Expected: PASS — 8/8 tests.

- [ ] **Step 1b: Use `setSortExplicit` in stock-tab.tsx**

Replace `handleSortChange` in `stock-tab.tsx`:

```tsx
const { prefs, setSearch, setSortExplicit } = useListPreferences("inventory.stock");

function handleSortChange(value: string) {
  const [col, dir] = value.split(":") as [string, "asc" | "desc"];
  setSortExplicit(col, dir);
}
```

- [ ] **Step 2: Add ListToolbar before the balance section**

In `stock-tab.tsx` JSX, change the existing section block:

```tsx
<section className="space-y-3">
  <h3 className="text-sm font-medium text-ink">Tồn hiện tại</h3>
  <ListToolbar
    search={prefs.search}
    onSearchChange={setSearch}
    searchPlaceholder="Tìm theo tên nguyên liệu..."
    resultCount={filteredSortedBalances.length}
    resultLabel="nguyên liệu"
    sortOptions={sortOptions}
    sortValue={currentSortValue}
    onSortChange={handleSortChange}
  />
  <StockBalanceList
    balances={filteredSortedBalances}
    isLoading={balancesQuery.isLoading}
    isError={balancesQuery.isError}
    onSelectIngredient={canWrite ? openEntryFromRow : undefined}
  />
</section>
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Manual smoke**

Navigate to `/inventory` → "Tồn kho" tab.
1. Search "sữa" → list filters.
2. Sort dropdown → pick "Tồn (cao → thấp)" → list re-sorts.
3. Refresh → both preserved.
4. Empty state when no match: ensure `StockBalanceList` shows EmptyState already (it does — line 57 of file).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-list-preferences.ts src/hooks/__tests__/use-list-preferences.test.ts src/features/inventory/stock-tab.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): search + sort persistence for Tồn kho

Stock balance list now has live text search and sort dropdown
(Tên / Tồn × asc/desc) with localStorage persistence. Lifted
filter+sort logic into stock-tab parent; StockBalanceList stays
pure. Added setSortExplicit to useListPreferences for direct
column+direction setting from a single dropdown selection.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Apply to Nguyên liệu (Ingredients) — Card-based

**Files:**
- Modify: `src/features/inventory/ingredients-tab.tsx`

- [ ] **Step 1: Add imports**

In `src/features/inventory/ingredients-tab.tsx`, add after existing imports:

```tsx
import { useListPreferences } from "@/hooks/use-list-preferences";
import { ListToolbar } from "@/components/ui/list-toolbar";
```

- [ ] **Step 2: Add prefs + filtered/sorted data computation**

Inside `IngredientsTab`, AFTER `const visible = useMemo(...)` block (around line 72), add:

```tsx
const { prefs, setSearch, setSortExplicit } = useListPreferences("inventory.ingredients");

const filteredSorted = useMemo(() => {
  const term = prefs.search.trim().toLowerCase();
  const filtered = !term
    ? visible
    : visible.filter(
        (i) =>
          i.name.toLowerCase().includes(term) ||
          (i.notes ?? "").toLowerCase().includes(term),
      );
  if (!prefs.sortColumn) return filtered;
  return [...filtered].sort((a, b) => {
    if (prefs.sortColumn !== "name") return 0;
    const cmp = a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    return prefs.sortDirection === "asc" ? cmp : -cmp;
  });
}, [visible, prefs.search, prefs.sortColumn, prefs.sortDirection]);

const sortOptions = [
  { value: "name:asc", label: "Tên (A→Z)" },
  { value: "name:desc", label: "Tên (Z→A)" },
];

const currentSortValue = prefs.sortColumn
  ? `${prefs.sortColumn}:${prefs.sortDirection}`
  : "name:asc";

function handleSortChange(value: string) {
  const [col, dir] = value.split(":") as [string, "asc" | "desc"];
  setSortExplicit(col, dir);
}
```

- [ ] **Step 3: Insert ListToolbar above the list, replace `visible` with `filteredSorted`**

In the JSX, find the "Filter info banner" line and INSERT before it:

```tsx
<ListToolbar
  search={prefs.search}
  onSearchChange={setSearch}
  searchPlaceholder="Tìm theo tên, ghi chú..."
  resultCount={filteredSorted.length}
  resultLabel="nguyên liệu"
  sortOptions={sortOptions}
  sortValue={currentSortValue}
  onSortChange={handleSortChange}
/>
```

Then in the list render section (`visible.length === 0` → `filteredSorted.length === 0`, `visible.map(...)` → `filteredSorted.map(...)`).

Update the EmptyState `subtitle` to consider search:

```tsx
) : filteredSorted.length === 0 ? (
  <EmptyState
    icon="package"
    title={
      prefs.search
        ? "Không tìm thấy nguyên liệu"
        : "Chưa có nguyên liệu nào"
    }
    subtitle={
      prefs.search
        ? "Thử từ khóa khác."
        : canWrite
          ? "Bấm 'Thêm nguyên liệu' để bắt đầu."
          : "Owner/manager có thể thêm nguyên liệu mới."
    }
    dashedBorder
  />
) : (
  <div className="space-y-2">
    {filteredSorted.map((ing) => {
      // ... existing render logic unchanged ...
```

- [ ] **Step 4: Verify typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Manual smoke**

Navigate to `/inventory` → "Nguyên liệu" tab.
1. Search "sữa" → list filters.
2. Sort "Tên (Z→A)" → list re-sorts.
3. Refresh → state preserved.
4. `showInactive` checkbox still works.

- [ ] **Step 6: Commit**

```bash
git add src/features/inventory/ingredients-tab.tsx
git commit -m "$(cat <<'EOF'
feat(inventory): search + sort persistence for Nguyên liệu

Ingredients tab now has live text search (name + notes) and sort
dropdown (Tên × asc/desc) with localStorage persistence. showInactive
toggle preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Apply to Sản phẩm (Menu items) — Card-based

**Files:**
- Modify: `src/features/inventory/menu-items-tab.tsx`

Pattern identical to Task 6. Adapt with these specifics:

- listKey: `inventory.menu-items`
- Search fields: `name`, `external_product_name`
- Sort options: same (Tên A→Z, Tên Z→A)
- Placeholder: "Tìm theo tên sản phẩm..."
- resultLabel: "sản phẩm"

- [ ] **Step 1: Add imports**

```tsx
import { useListPreferences } from "@/hooks/use-list-preferences";
import { ListToolbar } from "@/components/ui/list-toolbar";
```

- [ ] **Step 2: Add prefs + filtered/sorted (locate after existing `visible` useMemo)**

```tsx
const { prefs, setSearch, setSortExplicit } = useListPreferences("inventory.menu-items");

const filteredSorted = useMemo(() => {
  const term = prefs.search.trim().toLowerCase();
  const filtered = !term
    ? visible
    : visible.filter(
        (m) =>
          m.name.toLowerCase().includes(term) ||
          (m.external_product_name ?? "").toLowerCase().includes(term),
      );
  if (!prefs.sortColumn) return filtered;
  return [...filtered].sort((a, b) => {
    if (prefs.sortColumn !== "name") return 0;
    const cmp = a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
    return prefs.sortDirection === "asc" ? cmp : -cmp;
  });
}, [visible, prefs.search, prefs.sortColumn, prefs.sortDirection]);

const sortOptions = [
  { value: "name:asc", label: "Tên (A→Z)" },
  { value: "name:desc", label: "Tên (Z→A)" },
];

const currentSortValue = prefs.sortColumn
  ? `${prefs.sortColumn}:${prefs.sortDirection}`
  : "name:asc";

function handleSortChange(value: string) {
  const [col, dir] = value.split(":") as [string, "asc" | "desc"];
  setSortExplicit(col, dir);
}
```

- [ ] **Step 3: Insert toolbar + replace `visible` → `filteredSorted`**

Insert before the filter info banner:

```tsx
<ListToolbar
  search={prefs.search}
  onSearchChange={setSearch}
  searchPlaceholder="Tìm theo tên sản phẩm..."
  resultCount={filteredSorted.length}
  resultLabel="sản phẩm"
  sortOptions={sortOptions}
  sortValue={currentSortValue}
  onSortChange={handleSortChange}
/>
```

Then update render: `visible.length` → `filteredSorted.length`, `visible.map` → `filteredSorted.map`. Update EmptyState messages to reference search (same pattern as Task 6).

- [ ] **Step 4-6: typecheck, manual smoke, commit**

```bash
npx tsc --noEmit
```

Smoke: /inventory → "Sản phẩm" tab. Search + sort + refresh.

```bash
git add src/features/inventory/menu-items-tab.tsx
git commit -m "feat(inventory): search + sort persistence for Sản phẩm

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Apply to Công thức (Recipes) — Card-based

**Files:**
- Modify: `src/features/inventory/recipes-tab.tsx`

Specifics:
- listKey: `inventory.recipes`
- Search field: `m.name` (the menu item name shown — recipes are keyed by menu item)
- Sort options: Tên A→Z, Tên Z→A
- Placeholder: "Tìm theo tên sản phẩm..."
- resultLabel: "công thức"

Pattern identical to Task 7. Apply same code structure. Recipes tab has 2 sections (gap report + existing recipes) — apply search/sort ONLY to the "existing recipes" section, not the gap report.

- [ ] **Step 1: Read the file first**

```bash
cat src/features/inventory/recipes-tab.tsx | head -80
```

Identify which `useMemo`/array represents "existing recipes" (separate from gap report). The search/sort applies to that array only.

- [ ] **Step 2: Apply pattern (imports + prefs + filteredSorted)**

Add imports + prefs same as Task 7. Search field uses `m.name` (or whatever the recipe row exposes — confirm via read). Apply filteredSorted to ONLY the existing-recipes section.

- [ ] **Step 3: Mount ListToolbar above existing-recipes section, NOT above gap report**

```tsx
<ListToolbar ... />
{/* existing recipes render with filteredSorted */}
```

- [ ] **Step 4-6: typecheck, manual smoke, commit**

```bash
npx tsc --noEmit
git add src/features/inventory/recipes-tab.tsx
git commit -m "feat(inventory): search + sort persistence for Công thức

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Apply to Lịch sử Chốt két — Article/Card-based

**Files:**
- Modify: `src/features/cash/cash-history-section.tsx`

Specifics:
- listKey: `cash.history`
- Search field: `count.note`
- Sort options: Mới nhất / Cũ nhất (by `counted_at`), Số tiền cao / Số tiền thấp (by `total_physical`)
- Placeholder: "Tìm theo ghi chú..."
- resultLabel: "lượt kiểm"

- [ ] **Step 1: Add imports**

In `src/features/cash/cash-history-section.tsx`:
```tsx
import { useMemo } from "react";
import { useListPreferences } from "@/hooks/use-list-preferences";
import { ListToolbar } from "@/components/ui/list-toolbar";
```

(The file already imports `useState` from `"react"` — combine into one import line if convenient.)

- [ ] **Step 2: Add prefs + filteredSorted inside CashHistorySection**

After `const [expandedId, setExpandedId] = useState<string | null>(null);`:

```tsx
const { prefs, setSearch, setSortExplicit } = useListPreferences("cash.history");

const filteredSorted = useMemo(() => {
  const term = prefs.search.trim().toLowerCase();
  const filtered = !term
    ? counts
    : counts.filter((c) => (c.note ?? "").toLowerCase().includes(term));
  if (!prefs.sortColumn) return filtered;
  return [...filtered].slice().sort((a, b) => {
    let av: string | number;
    let bv: string | number;
    switch (prefs.sortColumn) {
      case "counted_at":
        av = a.counted_at;
        bv = b.counted_at;
        break;
      case "total_physical":
        av = a.total_physical;
        bv = b.total_physical;
        break;
      default:
        return 0;
    }
    if (av === bv) return 0;
    const cmp = av < bv ? -1 : 1;
    return prefs.sortDirection === "asc" ? cmp : -cmp;
  });
}, [counts, prefs.search, prefs.sortColumn, prefs.sortDirection]);

const sortOptions = [
  { value: "counted_at:desc", label: "Mới nhất" },
  { value: "counted_at:asc", label: "Cũ nhất" },
  { value: "total_physical:desc", label: "Số tiền (cao → thấp)" },
  { value: "total_physical:asc", label: "Số tiền (thấp → cao)" },
];

const currentSortValue = prefs.sortColumn
  ? `${prefs.sortColumn}:${prefs.sortDirection}`
  : "counted_at:desc";

function handleSortChange(value: string) {
  const [col, dir] = value.split(":") as [string, "asc" | "desc"];
  setSortExplicit(col, dir);
}
```

- [ ] **Step 3: Insert ListToolbar inside CardBody, before the conditional render**

In the JSX, change `<CardBody>` block to:

```tsx
<CardBody className="space-y-3">
  <ListToolbar
    search={prefs.search}
    onSearchChange={setSearch}
    searchPlaceholder="Tìm theo ghi chú..."
    resultCount={filteredSorted.length}
    resultLabel="lượt kiểm"
    sortOptions={sortOptions}
    sortValue={currentSortValue}
    onSortChange={handleSortChange}
  />
  {isLoading && counts.length === 0 ? (
    <EmptyState icon="loader" title="Đang tải..." subtitle="Đang lấy lịch sử kiểm két." />
  ) : filteredSorted.length === 0 ? (
    <EmptyState
      icon="banknote"
      title={
        prefs.search
          ? "Không tìm thấy lượt kiểm nào"
          : "Chưa có lượt kiểm két nào hôm nay"
      }
      subtitle={
        prefs.search
          ? "Thử từ khóa khác."
          : 'Bấm "Kiểm két nhanh" để lưu spot audit, hoặc "Chốt két & tạo báo cáo" để chốt cuối ca.'
      }
    />
  ) : (
    <div className="space-y-2">
      {filteredSorted.map((count) => {
        // ... existing article render unchanged ...
      })}
    </div>
  )}
</CardBody>
```

Note: the original CardBody had no className `space-y-3` — keep its original spacing if different; the toolbar gap is fine via `<div className="space-y-2">` below.

- [ ] **Step 4: Verify typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Manual smoke**

Navigate to `/cash`. Need at least 2+ counts in history.
1. Search by ghi chú → filter.
2. Sort by "Số tiền (cao → thấp)" → re-order.
3. Refresh → state preserved.
4. Expand/collapse row still works.

- [ ] **Step 6: Commit**

```bash
git add src/features/cash/cash-history-section.tsx
git commit -m "$(cat <<'EOF'
feat(cash): search + sort persistence for lịch sử chốt két

Cash history (Chốt két screen) now has live text search by note +
sort dropdown (Mới nhất/Cũ nhất/Số tiền cao/Số tiền thấp) with
localStorage persistence per user.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: End-to-end verify + PR

- [ ] **Step 1: Full typecheck**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 2: Full vitest**

```bash
npx vitest run
```
Expected: all green (existing 122 + new ~13 tests).

- [ ] **Step 3: pgTAP regression (no SQL changed but run to be safe)**

```bash
npm run verify:phase
```
Expected: green.

- [ ] **Step 4: Cross-list smoke**

Local preview port 3009. Login owner. For each of the 6 lists, verify:
- Type search → live filter
- Pick sort → re-order
- Refresh → preserved
- Empty state copy mentions "không tìm thấy" when search yields no rows

Lists:
- `/safe` → Sổ quỹ history
- `/inventory` → "Tồn kho" tab
- `/inventory` → "Nguyên liệu" tab
- `/inventory` → "Sản phẩm" tab
- `/inventory` → "Công thức" tab
- `/cash` → Lịch sử kiểm két (bottom section)

Also verify Bảng vận hành dashboard-stock-list per-user lock STILL works (regression check) — that uses a different mechanism and must not be touched.

- [ ] **Step 5: Push branch + open PR**

```bash
git push -u origin feat/list-search-sort
gh pr create --title "feat: list search + sort + persistence (v4.1.14)" --body "$(cat <<'EOF'
## Summary

Unified search + sort + localStorage persistence pattern across 6 list views:

- Sổ quỹ (Safe history) — DataTable controlled sort
- Tồn kho (Stock balance)
- Nguyên liệu (Ingredients)
- Sản phẩm (Menu items)
- Công thức (Recipes)
- Lịch sử Chốt két (Cash history)

Live text search (client-side), sort selector (dropdown for card-based, headers for DataTable), and per-user per-list state persistence via localStorage.

## Implementation

Primitives:
- `useListPreferences(listKey)` — manages search + sort state, persists to localStorage (search debounced 300ms, sort immediate)
- `<ListToolbar>` — unified toolbar (search + filter slot + sort Select + count)
- `DataTable` extended with controlled sort props (backward compatible)

Spec deviated from clickable column headers (only 1 list has tables) to dropdown sort for card lists — see plan §"Important deviation from spec".

## Test plan

- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` all pass (existing + new hook/toolbar/data-table tests)
- [x] Manual smoke per 6 lists: search → filter, sort → reorder, refresh → preserved
- [x] dashboard-stock-list per-user lock NOT regressed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Watch CI**

```bash
gh pr checks --watch
```
Expected: all green within ~3-5 minutes.

- [ ] **Step 7: Merge + tag v4.1.14**

After CI passes and user approves merge:
```bash
gh pr merge --squash --auto
# Then create tag via gh api (avoid local main checkout in worktree)
gh api repos/:owner/:repo/git/refs -f ref="refs/tags/v4.1.14" -f sha="$(gh api repos/:owner/:repo/commits/main --jq .sha)"
```

---

## Self-review summary

1. **Spec coverage** — All 6 lists have a task. Primitives match spec §3.1 with documented deviation.
2. **Placeholder scan** — No "TBD"/"TODO"/"add appropriate" found. Every step has commands/code.
3. **Type consistency** — `ListPrefs`, `UseListPreferencesReturn`, `DataTableSortState`, `SortOption`, `ListToolbarProps` interfaces all defined; cross-task references match (e.g. `setSortExplicit` defined in Task 5a and used in Tasks 5b/6/7/8/9).
4. **Persistence schema** — listKey naming consistent: `safe-history`, `inventory.stock`, `inventory.ingredients`, `inventory.menu-items`, `inventory.recipes`, `cash.history`.
