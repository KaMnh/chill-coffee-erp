# Searchable Dropdown + Combobox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dropdown scrollable (incl. inside modals/mobile) and add a diacritic-insensitive searchable Combobox for the long, dynamic-list dropdowns, migrating the 7 relevant call-sites on this branch.

**Architecture:** (1) One-line CSS fix to the shared `Select` Viewport gives every dropdown native scrolling. (2) A pure `normalize-search` util (Vietnamese đ→d + NFD diacritic stripping + substring) is unit-tested with Vitest. (3) A new `Combobox` built on Radix Popover + `cmdk` reuses that util for filtering and visually mirrors `SelectTrigger`. (4) Seven dynamic-list call-sites swap `Select` → `Combobox`; short/fixed dropdowns keep `Select` (and inherit the scroll fix for free).

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript · Radix UI (`@radix-ui/react-select` 2.2.6, `@radix-ui/react-popover` 1.1.15, `@radix-ui/react-dialog`) · **cmdk (NEW)** · Tailwind 4 · Vitest (node env).

---

## Source spec

`docs/superpowers/specs/2026-06-24-searchable-dropdown-combobox-design.md` (recovered from commit `8bb929c`; not present on this branch but read in full).

## Branch deviations from spec (approved)

This branch (`phase-6a-ci-foundation` lineage) diverges from the spec's branch:

1. **Spec §4.4 lists `purchase-inventory-modal.tsx` and `stock-entry-modal.tsx` — neither exists here.** They live on unmerged feature branches. **Decision (confirmed with owner): substitute the current-branch analogs** `stock-movement-modal.tsx` and `stock-count-modal.tsx` (each has the same long "Nguyên liệu" picker). Net: still 7 migrated call-sites, faithful to spec intent.
2. **Test path:** spec says `src/lib/normalize-search.test.ts`, but Vitest's `include` is `src/**/__tests__/**/*.test.ts` (see `vitest.config.mts`). The test MUST live at **`src/lib/__tests__/normalize-search.test.ts`** or it won't run.
3. **Coverage gate:** `src/lib/normalize-search.ts` falls under the `src/lib/**` threshold (statements 80 / branches 75 / functions 80 / lines 80). The Task 2 tests satisfy it.
4. **Spec test correction:** spec's "`da` khớp `Đường`" is invalid under substring matching (`Đường` → `duong`, no `da`). Corrected to "`d` khớp `Đường`" (prefix). All other spec cases stand.
5. `expense-edit-modal.tsx` exists here (spec said it didn't) but its category is immutable — **no migration**.

## Codex review resolutions (2026-06-24)

Codex reviewed this plan (3 blockers, 4 should-fix, 3 nits). All verified valid; resolutions baked into the tasks below:

- **B1 — Select scrollbar hidden.** Verified: Radix injects `[data-radix-select-viewport]{scrollbar-width:none}` + `::-webkit-scrollbar{display:none}` (`@radix-ui/react-select` dist line ~721) and already sets `overflow:hidden auto` inline (line ~743). So the real missing piece is **`max-height` only**; the `overflow-y-auto` class was redundant. Fix: Task 3 adds `max-height` to the Viewport AND a global override in `globals.css` to restore a visible thin scrollbar (`!important` beats Radix's non-important injected rule). → Task 3.
- **B2 — Combobox can exceed viewport height.** The 40px search header sat above a list capped at full available-height. Fix: cap `Popover.Content` itself at `min(360px, available-height)` as a `flex flex-col` box; the header is fixed and `Command.List` is `flex-1 min-h-0 overflow-y-auto`. → Task 4.
- **B3 — cmdk highlights first item on reopen.** Fix: control cmdk's active item via `<Command value=… onValueChange=…>`, seeded to the currently-selected option on open. → Task 4.
- **SF1 — empty a11y label.** Fix: pass `label` to `<Command>` and `aria-label` to `<Command.Input>`. → Task 4.
- **SF2 — "nested modal" wording.** ExpenseTemplateModal opens from a page Card (a single Dialog), not nested inside another Dialog. Corrected wording; combobox-in-modal is still exercised. → Tasks 8, 11.
- **SF3 — cmdk verify command.** `require('cmdk/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. Fix: verify with `npm ls cmdk`. → Task 1.
- **SF4 — legacy custom unit dropped.** `formatUnit` supports legacy units not in `STOCK_UNITS`. Fix: ingredient-form prepends the current `unit` as a fallback option when it isn't a known unit. → Task 9.
- **N1 — coverage command.** `test:run` has no coverage. Fix: assert the gate with `npm run test:coverage`. → Task 11.
- **N2 — unused import.** Drop the unused `type ComboboxOption` import in recipe-builder. → Task 5.
- **N3 — Esc attribution.** Esc closes via Radix Popover's dismissable layer, not cmdk. Comment/wording corrected. → Task 4.

## Requirement coverage checklist (tick against spec §6)

- [ ] Scroll fix applies to ALL dropdowns via `select.tsx`; works in modal + mobile (Task 3).
- [ ] `Combobox` with search input, diacritic-insensitive/case-insensitive/substring filter, keyboard nav, empty state (Task 4).
- [ ] 7 dynamic-list call-sites migrated to `Combobox`, selection logic preserved (Tasks 5–9).
- [ ] `cmdk` added to `package.json` (Task 1).
- [ ] Vitest for `normalizeForSearch`/`matchesSearch` green (Task 2).
- [ ] `Select` API unchanged; short dropdowns keep `Select` and still look correct (Tasks 3, verified Task 11).

## File structure

- **Create** `src/lib/normalize-search.ts` — pure search helpers (one responsibility: text normalization + match).
- **Create** `src/lib/__tests__/normalize-search.test.ts` — Vitest for the above.
- **Create** `src/components/ui/combobox.tsx` — Combobox component (Popover + cmdk).
- **Modify** `src/components/ui/select.tsx` — Viewport scroll fix only (no API change).
- **Modify** `package.json` / `package-lock.json` — add `cmdk`.
- **Modify** (call-sites, Select → Combobox):
  - `src/features/inventory/recipe-builder-modal.tsx` (Sản phẩm + ingredient rows)
  - `src/features/inventory/stock-movement-modal.tsx` (Nguyên liệu; keep Lý do as Select)
  - `src/features/inventory/stock-count-modal.tsx` (Nguyên liệu)
  - `src/features/inventory/stock-ledger-section.tsx` (filter Nguyên liệu; keep Lý do + date as Select)
  - `src/features/expenses/expense-form.tsx` (Loại chi phí)
  - `src/features/expenses/expense-template-modal.tsx` (Danh mục)
  - `src/features/inventory/ingredient-form-modal.tsx` (Đơn vị / STOCK_UNITS)

## Environment notes (project rules)

- Dev server runs on **port 3009**. Do NOT run `npm run build` while `next dev` is live (clobbers `.next` → 404 chunks). `npm install` and `tsc --noEmit` are safe.
- Verify the util with `npm run test:run`. Verify types with `npx tsc --noEmit`.

---

### Task 1: Add the `cmdk` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install cmdk**

Run (safe while dev server runs — does not touch `.next`):
```bash
npm install cmdk
```
Expected: `package.json` `dependencies` gains `"cmdk": "^1.x"`, lockfile updates, no peer-dependency errors against React 19.

- [ ] **Step 2: Verify it resolves**

Run (cmdk's `exports` field blocks `require('cmdk/package.json')`, so use npm):
```bash
npm ls cmdk
```
Expected: prints `cmdk@1.x.y` under the dependency tree, no `UNMET DEPENDENCY`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add cmdk dependency for searchable combobox"
```

---

### Task 2: `normalize-search` util (TDD)

**Files:**
- Create: `src/lib/normalize-search.ts`
- Test: `src/lib/__tests__/normalize-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/normalize-search.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeForSearch, matchesSearch } from "../normalize-search";

describe("normalizeForSearch", () => {
  it("lowercases", () => {
    expect(normalizeForSearch("CÀ Phê")).toBe("ca phe");
  });

  it("maps đ and Đ to d", () => {
    expect(normalizeForSearch("Đá")).toBe("da");
    expect(normalizeForSearch("đường")).toBe("duong");
  });

  it("strips combining diacritics via NFD", () => {
    expect(normalizeForSearch("Sữa")).toBe("sua");
    expect(normalizeForSearch("Cà phê sữa đá")).toBe("ca phe sua da");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeForSearch("  Sữa  ")).toBe("sua");
  });
});

describe("matchesSearch", () => {
  it("matches 'sua' against milk products", () => {
    expect(matchesSearch("Sữa tươi", "sua")).toBe(true);
    expect(matchesSearch("Sữa đặc", "sua")).toBe(true);
  });

  it("matches 'da' against Đá and 'Cà phê sữa đá'", () => {
    expect(matchesSearch("Đá", "da")).toBe(true);
    expect(matchesSearch("Cà phê sữa đá", "da")).toBe(true);
  });

  it("matches 'd' prefix against Đá and Đường (corrected from spec)", () => {
    expect(matchesSearch("Đá", "d")).toBe(true);
    expect(matchesSearch("Đường", "d")).toBe(true);
  });

  it("'ca' matches both 'Cà phê' and 'Cacao' (substring, diacritic-free)", () => {
    expect(matchesSearch("Cà phê", "ca")).toBe(true);
    expect(matchesSearch("Cacao", "ca")).toBe(true);
  });

  it("is case-insensitive in both directions", () => {
    expect(matchesSearch("Sữa tươi", "SUA")).toBe(true);
    expect(matchesSearch("CACAO", "ca")).toBe(true);
  });

  it("returns true for an empty/whitespace query (show everything)", () => {
    expect(matchesSearch("Bất kỳ", "")).toBe(true);
    expect(matchesSearch("Bất kỳ", "   ")).toBe(true);
  });

  it("returns false when the query is absent from the haystack", () => {
    expect(matchesSearch("Cà phê", "tra")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npm run test:run -- normalize-search
```
Expected: FAIL — `Failed to resolve import "../normalize-search"` (module not yet created).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/normalize-search.ts`:
```ts
/**
 * Diacritic-insensitive search helpers (searchable dropdown feature).
 *
 * Vietnamese-aware: `đ`/`Đ` are mapped by hand BEFORE NFD because Unicode
 * NFD does not decompose `đ` into `d` + a combining mark. After that, NFD
 * splits the remaining accented letters into base + combining marks, which
 * we strip. Matching is plain substring on the normalized strings.
 */

// U+0300–U+036F: combining diacritical marks that NFD separates out.
const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .trim();
}

export function matchesSearch(haystack: string, query: string): boolean {
  return normalizeForSearch(haystack).includes(normalizeForSearch(query));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npm run test:run -- normalize-search
```
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize-search.ts src/lib/__tests__/normalize-search.test.ts
git commit -m "feat: add diacritic-insensitive normalize-search util + tests"
```

---

### Task 3: Scroll fix for ALL dropdowns (`select.tsx` + `globals.css`)

**Files:**
- Modify: `src/components/ui/select.tsx:56`
- Modify: `src/app/globals.css` (restore the hidden scrollbar — Codex B1)

- [ ] **Step 1: Cap the Viewport height**

Radix already sets `overflow: hidden auto` inline on the viewport (dist ~743), so only `max-height` is missing. In `src/components/ui/select.tsx`, replace the Viewport line inside `SelectContent`:

FROM:
```tsx
        <RadixSelect.Viewport className="p-1">{children}</RadixSelect.Viewport>
```
TO:
```tsx
        {/* Radix sets `overflow:hidden auto` inline; we only add the height cap
            so long lists actually scroll. `position="popper"` (default) exposes
            --radix-select-content-available-height. Outer Content keeps
            `overflow-hidden` so rounded-md corners stay clean. */}
        <RadixSelect.Viewport className="p-1 max-h-[min(320px,var(--radix-select-content-available-height))]">
          {children}
        </RadixSelect.Viewport>
```
No API change to `Select`/`SelectItem`. Portaled (`RadixSelect.Portal`) + `avoidCollisions` ⇒ works inside the Dialog modal and on mobile.

- [ ] **Step 2: Restore a visible scrollbar (Codex B1)**

Radix injects `[data-radix-select-viewport]{scrollbar-width:none}` + `::-webkit-scrollbar{display:none}` (no `!important`). Append to `src/app/globals.css`:
```css
/* Restore a visible (thin) scrollbar on the Select dropdown viewport.
 * Radix hides it via an injected <style> with no !important, so our
 * !important override wins regardless of source order. The bar sits inside
 * the viewport's p-1 padding, so it doesn't break the Content's rounded-md. */
[data-radix-select-viewport] {
  scrollbar-width: thin !important;
  -ms-overflow-style: auto !important;
  scrollbar-color: var(--color-muted) transparent;
}
[data-radix-select-viewport]::-webkit-scrollbar {
  display: block !important;
  width: 8px;
}
[data-radix-select-viewport]::-webkit-scrollbar-thumb {
  background-color: var(--color-muted);
  border-radius: 9999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
```

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 4: Manual smoke (dev server on :3009)**

Open a Select with many items (e.g. Stock ledger "Lý do"/an ingredient-rich list at `/inventory`), confirm the list scrolls with wheel/trackpad AND shows a visible scrollbar, and does not overflow the viewport; repeat inside a modal. Bottom items reachable; rounded corners intact.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/select.tsx src/app/globals.css
git commit -m "fix: scrollable Select viewport (height cap) + restore visible scrollbar"
```

---

### Task 4: `Combobox` component (Popover + cmdk)

**Files:**
- Create: `src/components/ui/combobox.tsx`

- [ ] **Step 1: Implement the component**

Create `src/components/ui/combobox.tsx`:
```tsx
"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { matchesSearch } from "@/lib/normalize-search";
import { Icon } from "./icons";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Extra terms to match on (codes, alt names). */
  keywords?: string[];
  disabled?: boolean;
};

export interface ComboboxProps {
  value: string | null;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * 1:1 copy of SelectTrigger's classes (src/components/ui/select.tsx) so the
 * Combobox trigger is visually identical to every other dropdown pill. Kept
 * in sync manually — if SelectTrigger's styling changes, update here too.
 */
const TRIGGER_CLASS =
  "inline-flex items-center justify-between gap-2 h-10 px-4 rounded-full border border-border bg-surface text-sm text-ink " +
  "focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Chọn…",
  searchPlaceholder = "Tìm…",
  emptyText = "Không tìm thấy",
  disabled,
  className,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // cmdk's "active item" (highlighted row). Controlled so reopening highlights
  // the currently-selected option instead of always defaulting to the first
  // item (Codex B3). cmdk lowercases item values internally, so seed lowercase.
  const [active, setActive] = useState("");

  const selected = options.find((o) => o.value === value) ?? null;
  // cmdk's built-in filter is disabled (shouldFilter={false}); we control
  // visibility with our own diacritic-insensitive matcher over label+keywords.
  const visible = options.filter((o) =>
    matchesSearch([o.label, ...(o.keywords ?? [])].join(" "), query)
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setActive((value ?? "").toLowerCase()); // highlight current selection on open
    } else {
      setQuery("");
    }
  }

  function handleSelect(next: string) {
    onValueChange(next);
    handleOpenChange(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          className={cn(TRIGGER_CLASS, className)}
        >
          <span className={cn("truncate", selected ? "text-ink" : "text-muted")}>
            {selected ? selected.label : placeholder}
          </span>
          <Icon name="chevronDown" size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        {/* Cap the WHOLE popover (header + list) at the available height so it
            never overflows the viewport on mobile (Codex B2). The list flexes
            to fill the remaining space below the fixed search header and
            scrolls. Esc closes via Radix Popover's dismissable layer; cmdk
            owns ↑/↓/Enter + ARIA (Codex N3). */}
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn(
            "z-50 flex max-h-[min(360px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden rounded-md border border-border bg-surface shadow-popover",
            "data-[state=open]:animate-in data-[state=closed]:animate-out"
          )}
        >
          <Command
            shouldFilter={false}
            label={searchPlaceholder}
            value={active}
            onValueChange={setActive}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
              <Icon name="search" size={16} className="shrink-0 text-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-10 w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
              />
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
                {emptyText}
              </Command.Empty>
              {visible.map((o) => (
                <Command.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  onSelect={() => handleSelect(o.value)}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-3 py-2 text-sm text-ink outline-none",
                    "data-[selected=true]:bg-surface-muted",
                    "data-[disabled=true]:opacity-40 data-[disabled=true]:cursor-not-allowed"
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && (
                    <Icon name="check" size={16} className="ml-auto" />
                  )}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
```

Notes: `shouldFilter={false}` + rendering only `visible` items ⇒ `Command.Empty` shows when zero match. cmdk owns ↑/↓/Enter + ARIA; Esc closes via Radix Popover (Codex N3). Portal escapes the modal's `overflow-auto`; `avoidCollisions` + the Content height cap handle mobile/edge clipping (Codex B2). Controlled `value/onValueChange` seeds the highlight to the current selection on open (Codex B3); `label`/`aria-label` give the listbox + input accessible names (Codex SF1).

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors (cmdk ships its own types).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/combobox.tsx
git commit -m "feat: add searchable Combobox (Radix Popover + cmdk)"
```

---

### Task 5: Migrate `recipe-builder-modal.tsx` (Sản phẩm + ingredient rows)

**Files:**
- Modify: `src/features/inventory/recipe-builder-modal.tsx`

- [ ] **Step 1: Swap imports**

Remove the `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` import block (lines ~15–21) and replace with (no `ComboboxOption` — inline `.map` is used, Codex N2):
```tsx
import { Combobox } from "@/components/ui/combobox";
```

- [ ] **Step 2: Replace the "Sản phẩm" Select**

Replace the `<Select>…</Select>` block in the menu-item picker (the one wrapping `SelectValue placeholder="Chọn sản phẩm..."`) with:
```tsx
              <Combobox
                value={selectedMenuItemId}
                onValueChange={(v) => setSelectedMenuItemId(v)}
                disabled={isEdit || isBusy}
                placeholder="Chọn sản phẩm..."
                searchPlaceholder="Tìm sản phẩm..."
                emptyText={
                  isEdit ? "—" : "Không còn sản phẩm khả dụng"
                }
                options={
                  isEdit && editingRecipe
                    ? [{ value: editingRecipe.menu_item_id, label: editingRecipe.menu_item_name }]
                    : menuItemOptionsForCreate.map((m) => ({ value: m.id, label: m.name }))
                }
              />
```

- [ ] **Step 3: Replace the per-row ingredient Select**

Replace the `<Select>…</Select>` block inside the `items.map(...)` row (the one with `placeholder="Chọn nguyên liệu..."`) with:
```tsx
                      <Combobox
                        value={it.ingredient_id || null}
                        onValueChange={(v) => handleChangeIngredient(idx, v)}
                        disabled={isBusy}
                        className="w-full"
                        placeholder="Chọn nguyên liệu..."
                        searchPlaceholder="Tìm nguyên liệu..."
                        emptyText={
                          ingredients.length === 0 ? "Chưa có nguyên liệu" : "Không tìm thấy"
                        }
                        options={ingredients.map((i) => ({ value: i.id, label: i.name }))}
                      />
```


- [ ] **Step 4: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (`selectedMenuItemId` is already `string | null`; `setSelectedMenuItemId(v)` takes `string` — matches `onValueChange`.)

- [ ] **Step 5: Manual smoke**

At `/inventory` → Recipes → add/edit: product picker searches (try `sua`/`ca`), ingredient rows search + select, qty/unit/validation unchanged, edit mode locks product.

- [ ] **Step 6: Commit**

```bash
git add src/features/inventory/recipe-builder-modal.tsx
git commit -m "feat: searchable Combobox for recipe builder product + ingredients"
```

---

### Task 6: Migrate `stock-movement-modal.tsx` + `stock-count-modal.tsx` (Nguyên liệu)

**Files:**
- Modify: `src/features/inventory/stock-movement-modal.tsx`
- Modify: `src/features/inventory/stock-count-modal.tsx`

- [ ] **Step 1: stock-movement — swap imports**

In `stock-movement-modal.tsx`, change the `select` import to keep `Select` (still used by the "Lý do" dropdown) AND add Combobox:
```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
```

- [ ] **Step 2: stock-movement — replace the ingredient Select only**

Replace the ingredient `<Select>…</Select>` (placeholder `"Chọn nguyên liệu..."`, bound to `selectedIngredientId`) with:
```tsx
            <Combobox
              value={selectedIngredientId}
              onValueChange={(v) => setSelectedIngredientId(v)}
              disabled={isBusy || initialIngredientId != null}
              className="w-full"
              placeholder="Chọn nguyên liệu..."
              searchPlaceholder="Tìm nguyên liệu..."
              emptyText="Chưa có nguyên liệu"
              options={ingredients.map((i) => ({ value: i.id, label: i.name }))}
            />
```
Leave the "Lý do" `Select` unchanged (short list — keeps Select per spec).

- [ ] **Step 3: stock-count — swap imports**

In `stock-count-modal.tsx`, the only Select is the ingredient picker. Replace the whole `select` import block with:
```tsx
import { Combobox } from "@/components/ui/combobox";
```

- [ ] **Step 4: stock-count — replace the ingredient Select**

Replace the ingredient `<Select>…</Select>` with:
```tsx
            <Combobox
              value={selectedIngredientId}
              onValueChange={(v) => setSelectedIngredientId(v)}
              disabled={isBusy || initialIngredientId != null}
              className="w-full"
              placeholder="Chọn nguyên liệu..."
              searchPlaceholder="Tìm nguyên liệu..."
              emptyText="Chưa có nguyên liệu"
              options={ingredients.map((i) => ({ value: i.id, label: i.name }))}
            />
```

- [ ] **Step 5: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors. (`selectedIngredientId: string | null`, setter takes `string`.)

- [ ] **Step 6: Manual smoke**

At `/inventory` → Stock: "Ghi nhập xuất" and "Kiểm kê" modals — ingredient search works, current-balance/variance still react to selection, `initialIngredientId` still disables the picker, Lý do still a Select.

- [ ] **Step 7: Commit**

```bash
git add src/features/inventory/stock-movement-modal.tsx src/features/inventory/stock-count-modal.tsx
git commit -m "feat: searchable Combobox for stock movement + count ingredient picker"
```

---

### Task 7: Migrate `stock-ledger-section.tsx` (filter Nguyên liệu)

**Files:**
- Modify: `src/features/inventory/stock-ledger-section.tsx`

- [ ] **Step 1: Keep Select import, add Combobox**

Keep the existing `select` import block (Lý do + date presets stay `Select`) and add:
```tsx
import { Combobox } from "@/components/ui/combobox";
```

- [ ] **Step 2: Replace the ingredient filter Select**

Replace the first `<Select>…</Select>` (the `value={filter.ingredient_id ?? "__all"}` one) with a Combobox that preserves the `"__all"` sentinel:
```tsx
        <Combobox
          value={filter.ingredient_id ?? "__all"}
          onValueChange={(v) =>
            onFilterChange({
              ...filter,
              ingredient_id: v === "__all" ? null : v,
              limit: 50,
            })
          }
          className="w-56"
          placeholder="Tất cả nguyên liệu"
          searchPlaceholder="Tìm nguyên liệu..."
          emptyText="Không tìm thấy"
          options={[
            { value: "__all", label: "Tất cả nguyên liệu" },
            ...ingredients.map((i) => ({ value: i.id, label: i.name })),
          ]}
        />
```
Leave the Lý do and date-range `Select`s unchanged.

- [ ] **Step 3: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Manual smoke**

At `/inventory` → Stock ledger: ingredient filter searches and selecting an ingredient filters the list; "Tất cả nguyên liệu" resets; pagination (`limit`) resets to 50 on change (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add src/features/inventory/stock-ledger-section.tsx
git commit -m "feat: searchable Combobox for stock ledger ingredient filter"
```

---

### Task 8: Migrate expenses category pickers (`expense-form.tsx` + `expense-template-modal.tsx`)

**Files:**
- Modify: `src/features/expenses/expense-form.tsx`
- Modify: `src/features/expenses/expense-template-modal.tsx`

- [ ] **Step 1: expense-form — swap imports**

Replace the `select` import block with:
```tsx
import { Combobox } from "@/components/ui/combobox";
```

- [ ] **Step 2: expense-form — replace the category Select**

Replace the `<Select>…</Select>` (the `value={categoryId}` one, label "Loại chi phí") with:
```tsx
            <Combobox
              id="form-category"
              value={categoryId || null}
              onValueChange={setCategoryId}
              disabled={isBusy}
              className="w-full"
              placeholder="Chọn loại chi phí..."
              searchPlaceholder="Tìm loại chi phí..."
              emptyText="Không tìm thấy"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
```
(`categoryId` is `string`, default `""`; `value={categoryId || null}` maps the empty default to the placeholder. `setCategoryId` accepts `string` — matches `onValueChange`.)

- [ ] **Step 3: expense-template-modal — swap imports**

Replace the `select` import block with:
```tsx
import { Combobox } from "@/components/ui/combobox";
```

- [ ] **Step 4: expense-template-modal — replace the category Select**

Replace the `<Select>…</Select>` (label "Danh mục") with:
```tsx
            <Combobox
              id="template-category"
              value={categoryId || null}
              onValueChange={setCategoryId}
              disabled={createTemplate.isPending}
              className="w-full"
              placeholder="Chọn danh mục..."
              searchPlaceholder="Tìm danh mục..."
              emptyText="Không tìm thấy"
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
            />
```

- [ ] **Step 5: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Manual smoke**

At `/expenses`: category picker in the main form searches/selects; submit still sends `category_id`. "+ Thêm mẫu" modal category picker works; applying a template still sets the form category. Confirms Combobox works inside a Dialog modal (the template modal is a single Dialog opened from a page Card — not a nested Dialog).

- [ ] **Step 7: Commit**

```bash
git add src/features/expenses/expense-form.tsx src/features/expenses/expense-template-modal.tsx
git commit -m "feat: searchable Combobox for expense + template category pickers"
```

---

### Task 9: Migrate `ingredient-form-modal.tsx` (Đơn vị / STOCK_UNITS)

**Files:**
- Modify: `src/features/inventory/ingredient-form-modal.tsx`

- [ ] **Step 1: Swap imports**

Replace the `select` import block with:
```tsx
import { Combobox } from "@/components/ui/combobox";
```

- [ ] **Step 2: Add `formatUnit` to the units import + build options with a legacy fallback**

Update the units import (currently `import { STOCK_UNITS, STOCK_UNIT_LABELS_VI } from "./units";`) to also bring in `formatUnit`:
```tsx
import { STOCK_UNITS, STOCK_UNIT_LABELS_VI, formatUnit } from "./units";
```
Inside the component body (e.g. just before the `return`), build the options so an unknown legacy unit (one not in `STOCK_UNITS`) is preserved as a selectable option rather than silently dropped (Codex SF4):
```tsx
  const unitOptions = STOCK_UNITS.map((u) => ({
    value: u as string,
    label: STOCK_UNIT_LABELS_VI[u],
    keywords: [u],
  }));
  const unitOptionsWithCurrent = unitOptions.some((o) => o.value === unit)
    ? unitOptions
    : [...unitOptions, { value: unit, label: formatUnit(unit), keywords: [unit] }];
```

- [ ] **Step 3: Replace the unit Select**

Replace the `<Select value={unit} …>…</Select>` (label "Đơn vị") with:
```tsx
            <Combobox
              value={unit}
              onValueChange={setUnit}
              disabled={isBusy}
              className="w-full"
              placeholder="Chọn đơn vị..."
              searchPlaceholder="Tìm đơn vị..."
              emptyText="Không tìm thấy"
              options={unitOptionsWithCurrent}
            />
```
(`keywords: [u]` lets users type the raw code, e.g. `ml`, to find "Mililit". The legacy fallback keeps a custom unit selected/visible instead of showing a placeholder while submitting a stale hidden value.)

- [ ] **Step 4: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Manual smoke**

At `/inventory` → Ingredients → add/edit: unit picker searches (type `kg`, `ml`), selecting updates the threshold helper text; default unit preserved on open.

- [ ] **Step 6: Commit**

```bash
git add src/features/inventory/ingredient-form-modal.tsx
git commit -m "feat: searchable Combobox for ingredient unit picker"
```

---

### Task 10 (optional): Playground demo

**Files:**
- Modify: `src/app/playground/_sections/form-section.tsx`

- [ ] **Step 1: Add a Combobox example**

Add an import and a new `SubSection` after the existing "Select" one:
```tsx
import { Combobox } from "@/components/ui/combobox";
```
```tsx
      <SubSection title="Combobox (searchable)">
        <ComboboxDemo />
      </SubSection>
```
And a small stateful demo component at the bottom of the file:
```tsx
function ComboboxDemo() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox
      value={value}
      onValueChange={setValue}
      className="w-60"
      placeholder="Chọn trái cây..."
      searchPlaceholder="Tìm..."
      options={[
        { value: "apple", label: "Táo" },
        { value: "banana", label: "Chuối" },
        { value: "durian", label: "Sầu riêng" },
        { value: "ca-phe", label: "Cà phê", keywords: ["coffee"] },
      ]}
    />
  );
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/app/playground/_sections/form-section.tsx
git commit -m "docs: add Combobox demo to playground form section"
```

---

### Task 11: Final verification

- [ ] **Step 1: Unit tests green**

Run:
```bash
npm run test:run
```
Expected: full suite passes, incl. `normalize-search`.

- [ ] **Step 1b: Coverage gate met (Codex N1)**

Run (`test:run` does NOT collect coverage):
```bash
npm run test:coverage
```
Expected: passes with no threshold failure on `src/lib/**` (the new `normalize-search.ts` is exercised by its tests).

- [ ] **Step 2: Type-check clean**

Run:
```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Manual checklist (dev server :3009 — do NOT build)**

  - [ ] Scroll: a long `Select` (kept-as-Select, e.g. Lý do) scrolls; no overflow.
  - [ ] Scroll inside modal + mobile bottom-sheet width.
  - [ ] Combobox: search filters diacritic-insensitively (`sua`→Sữa, `ca`→Cà phê & Cacao), ↑/↓/Enter/Esc work, empty state shows, selection persists.
  - [ ] Combobox works inside a Dialog modal (recipe builder, ingredient form, expense template — all single Dialogs).
  - [ ] Combobox: visible scrollbar present on a long list; popover never exceeds the screen height (mobile).
  - [ ] All 7 migrated dropdowns save the same value the old Select did.

- [ ] **Step 4: No leftover dead imports**

Run:
```bash
git grep -n "from \"@/components/ui/select\"" -- src/features src/app
```
Expected: only files that STILL use `Select` (withdraw-safe, safe-history, stock-movement [Lý do], stock-ledger [Lý do/date], form-section demo). No file importing Select without using it.

---

## Self-review notes

- **Spec coverage:** §4.1 → Task 3; §4.2 → Task 4; §4.3 → Task 2; §4.4 (7 sites, analog-substituted) → Tasks 5–9; §6 checklist mapped above. ✅
- **Type consistency:** `ComboboxProps.value: string | null`, `onValueChange: (value: string) => void`, `ComboboxOption {value,label,keywords?,disabled?}` — used identically in every call-site. State setters at each site accept `string`.
- **No placeholders:** every code step shows full code; commands have expected output.
