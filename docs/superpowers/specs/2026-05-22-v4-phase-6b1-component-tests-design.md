# Phase 6.B.1 — Component Tests (UI Primitives) Design

**Parent:** First sub-phase of Phase 6.B (Component Tests), itself the second sub-phase of Phase 6 (Hardening).
**Scope:** Stand up Vitest jsdom + React Testing Library + jest-dom matchers + user-event v14, and write tests covering all 32 primitives in `src/components/ui/*`. Enable an 80/75/80/80 coverage gate on `src/components/ui/**` alongside the existing `src/lib/**` gate. No source code changes — pure additive testing infrastructure + tests.
**Branch:** `phase-6b1-component-tests` (off `main` @ tag `v4-phase-6a`)
**Tag at end:** `v4-phase-6b1`

---

## 0. TL;DR

- 1 setup file + 32 component test files + 2 modified configs (`vitest.config.mts`, `package.json`).
- 59 new Vitest assertions split across 3 tiers: 14 smoke + 20 smoke-plus-one + 25 deep.
- Coverage gate extends from `src/lib/**` only to `src/lib/**` + `src/components/ui/**`, both at 80/75/80/80.
- Per-file `// @vitest-environment jsdom` annotation keeps existing 4 node-env test files unchanged; only new `.test.tsx` files pay the jsdom cost.
- `setup-jsdom.ts` polyfills `ResizeObserver` / `IntersectionObserver` / `scrollIntoView` / `hasPointerCapture` because Radix UI depends on them and jsdom doesn't ship them.
- After 6.B.1 merges: **134 Vitest + 131 pgTAP = 265 green** (was 75 + 131 = 206).
- No source code (`src/**/*.tsx`) or schema (`database/**`) changes. Strictly additive.

---

## 1. Goal

Lock down design system behavior under automated test so that future modifications to `src/components/ui/*.tsx` can't silently regress the props contract, render output, or interactive behavior of any of the 32 primitives. The existing `src/lib/**` gate proves the same pattern works for helpers — this extends it to the UI layer.

After 6.B.1:

- All 32 UI primitives have at least 1 test asserting basic render correctness.
- 10 primitives with interactive behavior (Button, Checkbox, Switch, etc.) have a second test asserting that behavior.
- 8 complex primitives (Modal, DataTable, Select, etc.) have 3 tests covering their state machines.
- Vitest CI job exercises jsdom-mode tests alongside the existing node-mode tests in a single `npm run test:coverage` invocation.
- `src/components/ui/**` coverage gate enforces 80% statements / 75% branches / 80% functions / 80% lines.

---

## 2. Non-goals (specific to 6.B.1)

- **No feature modal tests.** OpeningCashModal, IngredientFormModal, AdjustSafeModal, etc. are Phase **6.B.2**. They require Supabase mocking, which 6.B.1 deliberately avoids.
- **No list/table/section/view tests.** CashHistorySection, StockBalanceList, ReportLists, etc. are Phase **6.B.3**.
- **No hook tests.** `use-cash-mutations`, `use-safe-queries`, etc. are 6.B.2 (they couple to Supabase + React Query).
- **No source code (`src/components/ui/*.tsx`) changes.** If a primitive has a bug discovered during testing, surface it as out-of-scope; do not fix in 6.B.1.
- **No design system additions or modifications.** No new primitives, no new variants.
- **No Storybook or visual regression.** Visual testing is Phase 6.D or later.
- **No accessibility audit tooling** (axe-core, jest-axe). Defer to a dedicated accessibility phase if/when needed.
- **No snapshot tests.** Tests assert specific DOM facts via Testing Library queries; snapshots are brittle and don't reveal regression intent.
- **No `vitest workspace` migration.** Per-file env annotations are sufficient for 6.B.1's scale. Workspace projects are a possible 6.B.3 polish if the test file count grows past ~150.
- **No E2E.** Playwright is Phase **6.D**.
- **No CI workflow changes.** The existing `.github/workflows/verify.yml`'s `npm run test:coverage` step picks up new tests transparently.

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Phase 6.B umbrella scope | **3 sub-phases:** 6.B.1 (primitives) → 6.B.2 (feature modals + Supabase mocks) → 6.B.3 (lists/tables/sections/views + final coverage gate widen) |
| 6.B umbrella tag | `v4-phase-6b` on the 6.B.3 merge commit |
| 6.B.1 test count | **59 tests** across all 32 primitives (14 smoke + 20 medium + ~25 deep) |
| Test depth philosophy | **Broad shallow first** — every primitive gets ≥1 test; complexity tiers determine depth |
| Coverage gate threshold | **80/75/80/80** on `src/components/ui/**` (matches `src/lib/**`) |
| DOM environment | **jsdom** (Radix UI compatibility > happy-dom's perf gains for our scale) |
| Testing library stack | `@testing-library/react@^16.1` (React 19 compat) + `@testing-library/jest-dom@^6` + `@testing-library/user-event@^14` |
| Test file location | `src/components/ui/__tests__/<primitive>.test.tsx` (mirrors existing `src/lib/__tests__/`) |
| Env-switching strategy | **Per-file `// @vitest-environment jsdom` annotation** (simpler than workspace projects at this scale) |
| Setup file | Single `src/test/setup-jsdom.ts` extending Vitest's `expect` + polyfilling Radix-required browser APIs; window-conditional so safe in node-env tests |
| Mock strategy | **No mocks needed** — primitives are pure; no Supabase, no routing, no fetch |
| CI integration | **No CI changes** — `npm run test:coverage` step in existing workflow auto-discovers new tests |
| Task decomposition | **8 tasks** for subagent-driven execution |

---

## 4. Architecture

### 4.1 Phase 6.B umbrella decomposition

```
Phase 6.B — Component Tests
├── 6.B.1 (this spec)
│   ├── jsdom + RTL infrastructure
│   ├── 59 primitive tests
│   ├── Coverage gate on src/components/ui/**
│   └── Tag: v4-phase-6b1
│
├── 6.B.2 — Feature modals (separate brainstorm cycle)
│   ├── ~25-30 modal tests (OpeningCashModal, IngredientFormModal, AdjustSafeModal, etc.)
│   ├── Supabase mock fixtures via vi.mock
│   ├── React Query test wrapper
│   ├── Coverage gate extends to tested modal files
│   └── Tag: v4-phase-6b2
│
├── 6.B.3 — Lists, tables, sections, views (separate brainstorm cycle)
│   ├── ~20-25 tests covering CashHistorySection, StockBalanceList, ReportLists, dashboards
│   ├── Coverage gate widens to src/components/* (non-ui) + src/features/**
│   └── Tag: v4-phase-6b3
│
└── Umbrella tag: v4-phase-6b on the 6.B.3 merge commit
```

**Order rationale:** 6.B.1 is mockless → fastest to land + establishes RTL patterns. 6.B.2 inherits patterns + adds Supabase mocks (reusable in 6.B.3). 6.B.3 inherits both and is the smallest.

### 4.2 File manifest (6.B.1 only)

**New files (33):**
- `src/test/setup-jsdom.ts` — global Vitest setupFile (window-conditional polyfills + jest-dom matchers)
- `src/components/ui/__tests__/<primitive>.test.tsx` × 32

**Modified files (2):**
- `vitest.config.mts`:
  - `include` widened: `["src/**/__tests__/**/*.test.{ts,tsx}"]` (was `.test.ts` only)
  - `setupFiles: ["src/test/setup-jsdom.ts"]` added
  - Coverage `exclude` no longer contains `"src/components/**"`; narrowed to `"src/components/*"` (non-ui paths only — kept until 6.B.3) **only if** any non-ui paths exist under `src/components/`. Verified during T8.
  - New threshold block added: `"src/components/ui/**": { statements: 80, branches: 75, functions: 80, lines: 80 }`
- `package.json`:
  - `devDependencies` adds:
    - `jsdom@^25`
    - `@testing-library/react@^16.1`
    - `@testing-library/dom@^10`
    - `@testing-library/jest-dom@^6`
    - `@testing-library/user-event@^14`

**Unchanged:**
- `.github/workflows/verify.yml` (the `npm run test:coverage` step picks up the new tests via the widened `include` glob; the existing 4 jobs run identically)
- `src/components/ui/*.tsx` (frozen — pure additive testing)
- `src/lib/__tests__/*.test.ts` and `src/features/cash/__tests__/cash-math.test.ts` (no annotation → default to node env, behavior unchanged)
- `scripts/pgtap-run.mjs`, `database/**` (pgTAP backfill is 6.C, out of scope for 6.B.1)

### 4.3 Per-file env annotation strategy

The current `vitest.config.mts` declares `environment: "node"`. Adding `environment: "jsdom"` globally would force every existing pure-helper test to spin up a fake DOM (~100ms × 4 files = ~400ms wasted). Annotating per file keeps node-env tests fast and jsdom-env tests opt-in:

- `.test.ts` files in `src/lib/__tests__/` and `src/features/cash/__tests__/`: **no annotation → default node environment**
- New `.test.tsx` files in `src/components/ui/__tests__/`: **first line is `// @vitest-environment jsdom`**

Vitest reads the annotation as a comment directive and switches that file's environment without touching others.

If 6.B.2 or 6.B.3 grows the count of `.test.tsx` files past ~150, migrating to a `vitest.workspace.ts` with explicit `unit` and `dom` projects becomes the cleaner pattern. Out of scope for 6.B.1.

### 4.4 Setup file design

`src/test/setup-jsdom.ts` is loaded via `setupFiles` in `vitest.config.mts`. It runs before every test file's setup, regardless of environment. All DOM polyfills are guarded by `typeof window !== "undefined"` so node-env tests see a no-op.

```ts
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

if (typeof window !== "undefined") {
  // Radix UI primitives rely on these APIs which jsdom 25 does not ship.
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.IntersectionObserver) {
    window.IntersectionObserver = class {
      root = null;
      rootMargin = "";
      thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    } as unknown as typeof IntersectionObserver;
  }
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
}
```

**Rationale for each polyfill:**
- `ResizeObserver`: Radix `ScrollArea`, `Select`, and a few layout primitives subscribe to size changes.
- `IntersectionObserver`: Radix `Tabs` lazy-mounts trigger animations using this; without it, some triggers throw on mount.
- `Element.prototype.scrollIntoView`: Radix `Select` calls it when focusing options via keyboard.
- `Element.prototype.hasPointerCapture` / `releasePointerCapture`: Radix dropdown / popover internals call these even in keyboard interaction paths.

The `@testing-library/jest-dom/vitest` import extends Vitest's `expect` with the matcher set we use throughout the tests (`toBeInTheDocument`, `toBeDisabled`, `toHaveAttribute`, `toHaveValue`, `toHaveFocus`, `toBeVisible`, etc.).

### 4.5 Coverage gate evolution

| Sub-phase | `src/lib/**` | `src/components/ui/**` | `src/components/*` (non-ui) | `src/features/**` | `src/hooks/**` |
|-----------|------|------|------|------|------|
| 6.A (current) | 80/75/80/80 | excluded | excluded | excluded | excluded |
| **6.B.1 (this spec)** | 80/75/80/80 | **80/75/80/80** | excluded | excluded | excluded |
| 6.B.2 (future) | 80/75/80/80 | 80/75/80/80 | excluded | per-file include (only modals with tests) | excluded (no hook tests in 6.B.2 either; deferred to 6.B.3 if any hook coverage gate is needed) |
| 6.B.3 (future) | 80/75/80/80 | 80/75/80/80 | 80/75/80/80 or per-file | 80/75/80/80 or per-file | 80/75/80/80 or per-file |

The progressive widening ensures every sub-phase introduces real coverage on every directory it touches, without ever having an "excluded by config" gap.

---

## 5. Primitive categorization

The 32 primitives split into three tiers by test depth, sized to honestly hit 80% coverage on each:

### Tier A — Render smoke only (14 primitives × 1 test = 14 tests)

Pure display, minimal branching. A single render-and-assert call exercises ~90–100% of the file.

| Primitive | Single assertion |
|---|---|
| `avatar` | Renders initials or image src |
| `badge` | Renders text content + variant class |
| `bento-card` | Renders slot children |
| `breadcrumbs` | Renders trail items in order |
| `card` | Renders Header / Body / Title compositional slots |
| `empty-state` | Renders icon + title + subtitle |
| `icons` | Named icon (e.g., "save") renders as an SVG with expected aria-label or role |
| `insight-card` | Renders metric + variant class |
| `list-item` | Renders item children + optional adornment |
| `progress-bar` | Renders bar with `aria-valuenow` matching the prop |
| `promo-card` | Renders CTA + image |
| `skeleton` | Renders a shimmer block element |
| `spinner` | Renders SVG with the requested `size` |
| `stat-card` | Renders metric + delta + label |

### Tier B — Smoke + 1 interaction (10 primitives × 2 tests = 20 tests)

State or callback behavior. Two assertions: render correctness + the one canonical interaction.

| Primitive | Tests |
|---|---|
| `alert-banner` | Variant class renders correctly · Dismiss button fires callback |
| `button` | Click fires `onClick` · `disabled` prop blocks click |
| `icon-button` | Click fires `onClick` · Variant class renders |
| `checkbox` | Controlled toggle round-trips · `disabled` blocks user interaction |
| `radio` | Group selection fires `onChange` · Selected value renders as checked |
| `switch` | Toggle round-trips · `disabled` blocks |
| `slider` | Renders with `defaultValue` · Value change fires callback |
| `pagination` | Renders pages in range · Click on page button fires callback |
| `stepper` | Renders all steps · Current step has active state |
| `file-upload-field` | File pick fires `onSelect` · Clear button fires callback / resets state |

### Tier C — Smoke + 2-3 deep behaviors (8 primitives × ~3 tests = ~25 tests)

Rich state machines or Radix portals. Three assertions covering the canonical behaviors.

| Primitive | Tests |
|---|---|
| `modal` | Opens when controlled `open` is true · Closes on Escape · Closes on overlay click · Content renders into portal (document.body) |
| `data-table` | Renders rows from data array · Renders empty state when data is empty · Row `onClick` fires with row data |
| `select` | Trigger renders selected value · Opening the dropdown reveals options · Selecting an option fires `onValueChange` |
| `text-field` | Controlled input round-trips value · Error prop renders error message · Label is associated with input (`htmlFor` matches `id`) |
| `textarea` | Controlled value round-trips · `maxLength` enforced · Error prop renders |
| `tabs` | `defaultValue` renders the correct content · Click on trigger switches to that tab's content · Controlled `value` prop works |
| `toast` | `ToastProvider` wraps children · `toast(message)` shows the message · Auto-dismiss removes the toast after `duration` (timer faked) |
| `tooltip` | Trigger is rendered · Focus on trigger reveals tooltip content · Escape dismisses (Radix portal aware) |

**Distribution rationale:** Display-only primitives are exhaustively covered by their single render. Variant-bearing or callback primitives need both render and behavior. Stateful or portal-based primitives need 3 assertions to cover the on/off transitions and a third edge case.

### Expected coverage breakdown after T7

| Tier | Files | Tests | Expected per-file coverage | Weight in `src/components/ui/**` |
|---|---|---|---|---|
| A | 14 | 14 | 95–100% | ~44% by file count |
| B | 10 | 20 | 75–85% | ~31% |
| C | 8 | ~25 | 80–90% | ~25% |

Weighted average ≈ **84–90%** across `src/components/ui/**` — clearing the 80/75/80/80 threshold with a small but real margin. If a specific primitive lands below 80% during T8, the mitigation is to add a targeted branch test or promote the primitive a tier.

---

## 6. Test framework details

### 6.1 Worked example: Button (Tier B)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../button";

describe("Button", () => {
  it("renders children and fires onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Lưu</Button>);
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("blocks click when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Lưu</Button>);
    await user.click(screen.getByRole("button", { name: "Lưu" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

That's the canonical 2-assertion shape for Tier B. The first line annotation switches that file from node env to jsdom. The `userEvent.setup()` call returns a user instance scoped to this test (best practice in v14).

### 6.2 Worked example: Modal (Tier C — Radix-based)

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal } from "../modal";

describe("Modal", () => {
  it("renders content when open", () => {
    render(<Modal open onOpenChange={() => {}}>Hello</Modal>);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("calls onOpenChange(false) on Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Modal open onOpenChange={onOpenChange}>Hello</Modal>);
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not render content when closed", () => {
    render(<Modal open={false} onOpenChange={() => {}}>Hello</Modal>);
    expect(screen.queryByText("Hello")).not.toBeInTheDocument();
  });
});
```

The `open` / `onOpenChange` prop names are the Radix Dialog convention. Exact prop names will be verified during plan-writing when the actual `src/components/ui/modal.tsx` source is read.

### 6.3 Known compatibility gotchas

- **Radix Select + user-event v14:** Some Radix Select internals require pointer events that user-event v14 simulates but jsdom may handle imperfectly. Mitigation: fall back to `fireEvent.pointerDown()` or `fireEvent.click()` for the trigger in affected tests.
- **Radix animations + open/close timing:** Radix uses CSS transitions which jsdom doesn't run. Components transition instantly. Use synchronous assertions (no `waitFor`) for most cases.
- **Modal portal location:** Modal renders into `document.body` via React portal. RTL's `screen` queries the entire document, so portals work without manual `within` calls.
- **Focus traps:** Modal focus-trap (using `react-focus-lock` or similar) may dispatch synthetic focus events. Tests asserting focus behavior should use `await user.tab()` + check `document.activeElement`.

### 6.4 Dependency pinning rationale

| Package | Pinned to | Why |
|---------|-----------|-----|
| `@testing-library/react` | `^16.1` | First major with React 19 compatibility (peerDep allows React 19). |
| `@testing-library/dom` | `^10` | Peer dep of RTL 16. |
| `@testing-library/jest-dom` | `^6` | Stable matcher set with Vitest-native entrypoint (`/vitest`). |
| `@testing-library/user-event` | `^14` | Async API + setup() factory. Required for modern interaction testing. |
| `jsdom` | `^25` | Matches Vitest 2.1.x's expected jsdom version. |

---

## 7. Implementation strategy

8 tasks for subagent-driven execution, each ending in a commit with the message prefix `feat(phase-6b1): T<N> — <title>`:

| Task | Title | Files | New tests |
|------|-------|-------|-----------|
| **T1** | jsdom + RTL infrastructure + 2 smoke tests | `package.json`, `vitest.config.mts`, `src/test/setup-jsdom.ts` (new), `src/components/ui/__tests__/{spinner,skeleton}.test.tsx` | 2 |
| **T2** | Tier A batch 1 | `src/components/ui/__tests__/{avatar,badge,bento-card,breadcrumbs,card,empty-state}.test.tsx` | 6 |
| **T3** | Tier A batch 2 | `src/components/ui/__tests__/{icons,insight-card,list-item,progress-bar,promo-card,stat-card}.test.tsx` | 6 |
| **T4** | Tier B batch 1 | `src/components/ui/__tests__/{alert-banner,button,icon-button,checkbox,radio}.test.tsx` | 10 |
| **T5** | Tier B batch 2 | `src/components/ui/__tests__/{switch,slider,pagination,stepper,file-upload-field}.test.tsx` | 10 |
| **T6** | Tier C open/close | `src/components/ui/__tests__/{modal,tabs,toast,tooltip}.test.tsx` | 13 (modal=4, tabs/toast/tooltip=3 each) |
| **T7** | Tier C input/data | `src/components/ui/__tests__/{text-field,textarea,select,data-table}.test.tsx` | 12 (3 each) |
| **T8** | Coverage gate + final verify + tag | `vitest.config.mts` (gate config), local + CI verify, tag `v4-phase-6b1` | 0 |

**Cumulative test count:**

| After task | Vitest | pgTAP | Total |
|---|---|---|---|
| Baseline (v4-phase-6a) | 75 | 131 | 206 |
| T1 | 77 | 131 | 208 |
| T2 | 83 | 131 | 214 |
| T3 | 89 | 131 | 220 |
| T4 | 99 | 131 | 230 |
| T5 | 109 | 131 | 240 |
| T6 | 122 | 131 | 253 |
| T7 | 134 | 131 | **265** |
| T8 | 134 | 131 | **265** |

T8 adds no tests; it only flips the coverage gate config and runs the final verify + merge sequence.

### 7.1 Coverage gate config diff (T8)

```ts
// vitest.config.mts — T8 changes only

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: { TZ: "Asia/Ho_Chi_Minh" },
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],  // already widened in T1
    setupFiles: ["src/test/setup-jsdom.ts"],            // already added in T1
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
        "src/**/*.d.ts",
        "src/app/**",
        // "src/components/**"   ← REMOVED in T8
        "src/components/layout/**",  // ← if any non-ui dirs exist; verified during T8
        "src/features/**",
        "src/hooks/**",
        "src/lib/data/**",
        "src/lib/kiotviet/**",
        "src/lib/supabase/**",
        "src/middleware.ts",
        "src/lib/cn.ts",
        "src/lib/data.ts",
        "src/lib/types.ts",
      ],
      thresholds: {
        "src/lib/**": {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
        "src/components/ui/**": {     // ← NEW in T8
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
```

---

## 8. Verification

End-to-end test plan (executed at T8 + on PR):

1. **`npm run test:coverage` locally:**
   - 134 Vitest assertions pass (75 existing + 59 new)
   - 131 pgTAP assertions pass (unchanged)
   - Both threshold blocks clear: `src/lib/**` and `src/components/ui/**` at 80/75/80/80
   - Coverage HTML generated at `./coverage/index.html`

2. **`npm run verify:phase`:**
   - Same as above plus pgTAP suite via existing `npm run pgtap`
   - Total 265 green tests

3. **CI on PR (4 jobs):**
   - `typecheck`: clean (no TypeScript errors)
   - `vitest`: 134 assertions pass, coverage gate clears, artifact uploaded
   - `pgtap`: 131 assertions pass against Postgres 15 service container
   - `build`: Next.js production build succeeds
   - All 4 required checks green; branch protection allows merge

4. **Manual primitives smoke (post-merge, optional):**
   - Open localhost:3009, navigate through cash / safe / inventory / reports views
   - Verify primitives still render correctly (no visible behavior change since source unchanged)

5. **Off-limits check:**
   - `git diff main..HEAD --name-only` shows only files listed in Section 4.2
   - No source file modifications under `src/components/ui/*.tsx`
   - No database, schema, or RPC changes

---

## 9. Acceptance criteria

- [ ] 32 of 32 primitives have a corresponding `__tests__/<primitive>.test.tsx` file
- [ ] 59 new Vitest assertions pass (cumulative 134 with existing)
- [ ] 131 pgTAP assertions pass (unchanged)
- [ ] Coverage gate enforces ≥80% statements, ≥75% branches, ≥80% functions, ≥80% lines on `src/components/ui/**`
- [ ] Coverage gate also enforces the existing thresholds on `src/lib/**` (no regression)
- [ ] CI workflow passes all 4 jobs on the PR
- [ ] Branch protection enforces all 4 checks before merge (already configured in 6.A)
- [ ] Merge via PR (not direct push); merge commit lands on `main`
- [ ] Tag `v4-phase-6b1` pushed to the merge commit
- [ ] No changes to `src/components/ui/*.tsx`, `database/**`, `scripts/pgtap-run.mjs`, or any other source code

---

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Radix UI components fail to render in jsdom due to missing browser APIs | Setup file polyfills `ResizeObserver`, `IntersectionObserver`, `scrollIntoView`, `hasPointerCapture`, `releasePointerCapture`. Add more polyfills if Radix internals surface additional needs during T6/T7. |
| `user-event` v14 pointer events incompatible with specific Radix primitives | Fall back to `fireEvent.click()` / `fireEvent.pointerDown()` for affected tests. Document which primitives needed the fallback in the test file comment. |
| Specific primitive misses 80% coverage after its planned tests | Add 1-2 targeted branch tests in the same task (or T8 polish) before the coverage threshold check |
| Existing 4 node-env tests break from new `setupFiles` config | Setup file is `if (typeof window !== "undefined")` guarded; in node env, only the `import "@testing-library/jest-dom/vitest"` line runs (extends `expect` with matchers but no DOM dependency) |
| CI vitest job runtime regression beyond ~60s | Per-file `@vitest-environment jsdom` annotation keeps existing `.test.ts` files in node env; only the 32 new `.test.tsx` files pay the jsdom cost. Expected vitest job runtime: ~30–45s. |
| Test files become brittle across Radix UI version bumps | Use semantic queries (`getByRole`, `getByLabelText`) over `getByTestId` or class-name lookups. Asserting on the contract (the prop API) not the internal markup. |
| Coverage v8 reports differently from istanbul on JSX runtime helpers | If thresholds fail due to v8-specific JSX overhead, narrow the threshold scope or accept the JSX overhead is uncovered. Documented in plan if hit. |

---

## 11. Critical files for execution

When the engineer starts implementing 6.B.1, these are the must-read files (in this order):

1. `vitest.config.mts` — confirm current shape; T1 adds `setupFiles` + widens `include`; T8 mutates `exclude` + `thresholds`
2. `src/components/ui/spinner.tsx` — simplest primitive; T1 smoke test serves as RTL infra validation
3. `src/components/ui/modal.tsx` — confirms the Radix Dialog prop names (`open`, `onOpenChange`) used in worked example
4. `src/components/ui/button.tsx` — confirms `loading`, `disabled`, `variant`, `size` prop names used in Tier B tests
5. `src/components/ui/select.tsx` — confirms Radix Select prop names (`value`, `onValueChange`, `disabled`)
6. `src/components/ui/text-field.tsx` — confirms label association mechanism for Tier C test
7. `src/components/ui/data-table.tsx` — confirms the row/column/empty-state contract
8. `src/lib/__tests__/format.test.ts` — reference for Vitest patterns (describe/it, expect, vi.fn)
9. `package.json` — confirm `devDependencies` shape before adding RTL packages
10. `.github/workflows/verify.yml` — confirm `npm run test:coverage` is the step that runs in CI (unchanged in 6.B.1)

---

## 12. Process steps after this spec approves

1. User reviews spec; either requests changes or approves.
2. Invoke `superpowers:writing-plans` to draft 8-task implementation plan with per-task test code inline.
3. Plan committed to `docs/superpowers/plans/2026-05-22-v4-phase-6b1-component-tests.md`.
4. Invoke `superpowers:subagent-driven-development` to execute T1–T8 with per-task spec + code quality reviews.
5. Final overall code review (opus) after T8.
6. Invoke `superpowers:finishing-a-development-branch`: open PR, wait for CI green, merge, tag `v4-phase-6b1`, push tag.
7. Next turn: brainstorm Phase 6.B.2 (feature modal tests + Supabase mocks).

This spec covers only Phase 6.B.1. Phase 6.B.2 and 6.B.3 each get their own brainstorm + spec + plan + execute cycle after 6.B.1 merges. Phase 6.B's umbrella tag `v4-phase-6b` lands on the 6.B.3 merge commit.
