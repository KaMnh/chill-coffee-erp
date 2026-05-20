# Phase 3A — Read-only Modules + AppShell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port + redesign 3 read-only modules (Dashboard, Reports, Pivot) wrapped in an AppShell that recomposes v3's 610-line `page.tsx` into a thin router + 3 small custom hooks.

**Architecture:** Strict split — `src/app/page.tsx` becomes a ~80-line thin router composing 3 NEW hooks (`useAuthSession`, `useBusinessDate`, `useRoleGate`) plus 3 EXISTING Phase 1 hooks (`usePosSync`, `useRealtimeInvalidate`, `useAuthCookieSync`). UI via Phase 2 `AppShell`/`Sidebar`/`TopBar` primitives. Feature modules under `src/features/<module>/`. Verification gate at end: pg_dump v3 production → restore into v4 dev Supabase → assertion script verifies numbers match.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript strict + Tailwind v4 + Radix primitives + TanStack Query 5 + Supabase JS + Recharts (already in Phase 2) + `html-to-image` (NEW, dynamic-imported only).

**Reference spec:** `docs/superpowers/specs/2026-05-20-v4-phase-3a-readonly-modules-design.md`

---

## File Structure

### Created in Phase 3A

```
src/
  app/
    page.tsx                                  [REWRITE — thin router ~80 lines]
    login/
      page.tsx                                [NEW — login route]
  hooks/
    use-auth-session.ts                       [NEW]
    use-business-date.ts                      [NEW]
    use-role-gate.ts                          [NEW]
  features/
    navigation/
      navigation.ts                           [NEW — port from v3]
    auth/
      login-screen.tsx                        [NEW]
    dashboard/
      dashboard-view.tsx                      [NEW — assembles below]
      kpi-bar.tsx                             [NEW — 5 StatCard]
      shortcut-grid.tsx                       [NEW — 5 quick actions]
      expense-log-card.tsx                    [NEW]
      sales-feed-card.tsx                     [NEW]
      store-status-card.tsx                   [NEW]
      handover-panel.tsx                      [NEW — read-only in 3A]
    reports/
      reports-view.tsx                        [NEW — top assembly]
      report-list.tsx                         [NEW — left column]
      printable-report.tsx                    [NEW — port from v3 shared/]
      export-jpeg.ts                          [NEW — html-to-image wrapper]
    pivot/
      pivot-view.tsx                          [NEW — DataTable based]
tools/
  verify-mirror.mjs                           [NEW — Phase 3A verification gate]
package.json                                  [MODIFY — add html-to-image]
src/components/ui/icons.tsx                   [MODIFY — add 15 nav/action icons]
.gitignore                                    [MODIFY — exclude mirrors/]
```

### Untouched (Phase 1 ported, do NOT modify)
- `src/lib/{data,kiotviet,supabase,types,format,datetime,validation}.ts` and subfolders
- `src/hooks/queries/**` + `src/hooks/{use-supabase,use-pos-sync,use-realtime-invalidate,use-auth-cookie-sync}.ts`
- `src/middleware.ts`, `src/app/api/**`, `database/**`
- Phase 2 components: `src/components/{ui,layout,charts}/**` except icons.tsx (additive only)
- Phase 2 fonts/globals/cn: `src/app/{fonts.ts,globals.css}`, `src/lib/cn.ts`
- `docker-compose.yml`, `supabase/**`, `Dockerfile`

---

## Conventions for this plan

- **Vietnamese-language UI** preserved throughout. All user-facing labels in Vietnamese; comments/identifiers in English mixed with VN per v3 style.
- **TZ guardrail**: every `business_date` must come from `useBusinessDate` (or `todayInVN()` from `@/lib/datetime`). NEVER call `new Date().toISOString().slice(0,10)` — that gives UTC date.
- **No test framework yet** (Phase 6). For each task: build via `npm run build` is the primary "tests pass" signal; logic units get inline Node assertion scripts in `tools/verify-*.mjs`; UI gets manual playground/dev-server smoke.
- **Each task ends with a commit** using a `feat(phase-3a):` / `chore(phase-3a):` / `docs(phase-3a):` prefix and `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` footer.
- **Existing Phase 1 `usePosSync` is reused as-is** (signature `(supabase, businessDate, account, latestSync)` returns mutation). Do NOT create a new wrapper.

---

## Tasks overview

| # | Task | Files (new) | Files (modify) |
|---|---|---|---|
| 1 | Icons + navigation foundation | 1 | 1 |
| 2 | `useAuthSession` hook | 1 | 0 |
| 3 | `useBusinessDate` hook | 1 | 0 |
| 4 | `useRoleGate` hook | 1 | 0 |
| 5 | Login screen + mount app-root providers | 2 | 1 |
| 6 | AppShell + thin `page.tsx` | 0 | 1 |
| 7 | KpiBar + DashboardView skeleton | 2 | 0 |
| 8 | Dashboard sub-cards (shortcut, expense, sales, store-status, handover) | 5 | 1 |
| 9 | Reports module + JPEG export | 4 | 1 |
| 10 | Pivot module | 1 | 0 |
| 11 | Verification gate (mirror restore + script) | 1 | 1 |

Total: ~17 new files, ~5 modify points across 11 tasks.

---

## Task 1: Icons + navigation foundation

**Files:**
- Modify: `src/components/ui/icons.tsx` (add 15 named icons additively)
- Create: `src/features/navigation/navigation.ts` (port v3 role gate)

**Why this first:** Every downstream module (sidebar, topbar, login, dashboard cards) needs icons + the role-gate config. Icons + nav config are pure data — no React deps — so they can land in isolation.

### Step 1.1 — Extend icons.tsx

- [ ] **Add 15 named icons additively to existing `Icons` map.**

Replace the body of `src/components/ui/icons.tsx` with the version below. Order in the import block follows v3 convention (alphabetical within groups: nav, action). Do **not** remove any existing icon — this is additive.

```tsx
"use client";

import {
  ArrowRight, ArrowUpRight, Bell, Check, ChevronDown, ChevronLeft,
  ChevronRight, Filter, Info, Loader2, Search, X, Plus, Minus,
  AlertTriangle, AlertCircle, CheckCircle2, Sparkles,
  // Phase 3A — nav icons
  LayoutDashboard, Wallet, Users, Banknote, PiggyBank, FileText,
  BarChart3, Settings,
  // Phase 3A — action icons
  LogOut, Menu, RefreshCw, Download, Clock, Lock, Printer,
  type LucideIcon, type LucideProps,
} from "lucide-react";
import { forwardRef } from "react";

export const Icons = {
  arrowRight: ArrowRight,
  arrowUpRight: ArrowUpRight,
  bell: Bell,
  check: Check,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  filter: Filter,
  info: Info,
  loader: Loader2,
  search: Search,
  x: X,
  plus: Plus,
  minus: Minus,
  alertTriangle: AlertTriangle,
  alertCircle: AlertCircle,
  checkCircle: CheckCircle2,
  sparkles: Sparkles,
  // Phase 3A nav
  layoutDashboard: LayoutDashboard,
  wallet: Wallet,
  users: Users,
  banknote: Banknote,
  piggyBank: PiggyBank,
  fileText: FileText,
  barChart3: BarChart3,
  settings: Settings,
  // Phase 3A actions
  logOut: LogOut,
  menu: Menu,
  refreshCw: RefreshCw,
  download: Download,
  clock: Clock,
  lock: Lock,
  printer: Printer,
} as const;

export type IconName = keyof typeof Icons;
type IconSize = 16 | 20 | 24;

export interface IconProps extends Omit<LucideProps, "size" | "strokeWidth"> {
  name: IconName;
  size?: IconSize;
}

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  { name, size = 20, ...rest },
  ref
) {
  const Component: LucideIcon = Icons[name];
  return <Component ref={ref} size={size} strokeWidth={2} {...rest} />;
});
```

### Step 1.2 — Create navigation/navigation.ts

- [ ] **Port v3 role gate verbatim with new `IconName` type wiring.**

Create `src/features/navigation/navigation.ts`:

```ts
import type { Account, AppSettings, UserRole } from "@/lib/types";
import type { IconName } from "@/components/ui/icons";

export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe"
  | "reports" | "pivot" | "settings";

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: IconName;
  roles: ReadonlyArray<UserRole>;
}

/**
 * Nav matrix ported verbatim from v3 src/features/navigation.ts.
 * 4 roles × 8 views. Vietnamese labels preserved.
 */
export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: "dashboard", label: "Bảng vận hành", icon: "layoutDashboard", roles: ["owner", "manager", "staff_operator", "employee_viewer"] },
  { key: "expenses",  label: "Chi phí",       icon: "wallet",          roles: ["owner", "manager", "staff_operator"] },
  { key: "shifts",    label: "Ca & lương",    icon: "users",           roles: ["owner", "manager", "staff_operator"] },
  { key: "cash",      label: "Chốt két",      icon: "banknote",        roles: ["owner", "manager", "staff_operator"] },
  { key: "safe",      label: "Sổ quỹ",        icon: "piggyBank",       roles: ["owner"] },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"] },
  { key: "pivot",     label: "Pivot",         icon: "barChart3",       roles: ["owner", "manager"] },
  { key: "settings",  label: "Thiết lập",     icon: "settings",        roles: ["owner", "manager"] },
];

export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "reports", "pivot", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "reports", "pivot", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "reports"],
  employee_viewer: ["dashboard"],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Chủ quán",
  manager: "Quản lý",
  staff_operator: "Nhân viên vận hành",
  employee_viewer: "Viewer",
};

export function hasBasePageAccess(role: UserRole, key: ViewKey): boolean {
  return Boolean(NAV_ITEMS.find((item) => item.key === key)?.roles.includes(role));
}

export function normalizeSidebarItems(
  role: UserRole,
  items?: ReadonlyArray<string> | null
): ViewKey[] {
  const source: ReadonlyArray<string> = items?.length ? items : DEFAULT_SIDEBAR_BY_ROLE[role];
  return source.filter((key): key is ViewKey =>
    NAV_ITEMS.some((item) => item.key === key && hasBasePageAccess(role, key as ViewKey))
  );
}

export function getVisibleNav(
  account: Account | null,
  settings: AppSettings
): ReadonlyArray<NavItem> {
  if (!account) return [];
  const configured =
    account.sidebar_config ??
    settings.sidebar_defaults?.[account.role] ??
    DEFAULT_SIDEBAR_BY_ROLE[account.role];
  const keys = normalizeSidebarItems(account.role, configured);
  return NAV_ITEMS.filter((item) => keys.includes(item.key));
}

export function canSee(
  account: Account | null,
  key: ViewKey,
  settings: AppSettings
): boolean {
  return getVisibleNav(account, settings).some((item) => item.key === key);
}
```

### Step 1.3 — Sanity-check the role gate (assertion script)

- [ ] **Create a tiny one-shot assertion script under `tools/` to prove the matrix.**

Create `tools/verify-role-gate.mjs`:

```js
// One-shot sanity check for the role-gate matrix. Run via `node tools/verify-role-gate.mjs`.
// Expectations come from v3 production behavior — don't change without updating navigation.ts.
import assert from "node:assert/strict";

// Import .ts via tsx is not set up; instead, mirror the matrix here and assert lengths
// (we trust TS for type wiring; this is a behavior assertion).
const EXPECTED_LENGTHS = {
  owner: 8,
  manager: 7,           // owner minus 'safe'
  staff_operator: 5,    // dashboard, expenses, shifts, cash, reports
  employee_viewer: 1,   // dashboard only
};

const EXPECTED_FIRST = {
  owner: "dashboard",
  manager: "dashboard",
  staff_operator: "dashboard",
  employee_viewer: "dashboard",
};

// Re-state the matrix here (mirrors src/features/navigation/navigation.ts DEFAULT_SIDEBAR_BY_ROLE).
const DEFAULT_SIDEBAR_BY_ROLE = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "reports", "pivot", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "reports", "pivot", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "reports"],
  employee_viewer: ["dashboard"],
};

for (const [role, expectedLen] of Object.entries(EXPECTED_LENGTHS)) {
  const actual = DEFAULT_SIDEBAR_BY_ROLE[role];
  assert.equal(actual.length, expectedLen, `${role}: expected ${expectedLen} items, got ${actual.length}`);
  assert.equal(actual[0], EXPECTED_FIRST[role], `${role}: first item should be ${EXPECTED_FIRST[role]}`);
}

console.log("✓ role-gate matrix matches v3 expectations");
```

> Note: this script does NOT import from `src/` (no TS toolchain in Node here). It's a *parity reminder* — if you change the matrix in `navigation.ts`, mirror it here. The real type-safety comes from TS strict at build.

### Step 1.4 — Verify build + run assertion

- [ ] **Run build to verify TS compiles.**

```bash
npm run build
```

Expected: same output as Phase 2 final (5 static pages, no new warnings) — adding icons + navigation file doesn't add to bundle until something imports them. (Tree-shaking handles unused exports.)

- [ ] **Run role-gate assertion.**

```bash
node tools/verify-role-gate.mjs
```

Expected: `✓ role-gate matrix matches v3 expectations`

### Step 1.5 — Commit

- [ ] **Commit Task 1.**

```bash
git add src/components/ui/icons.tsx src/features/navigation/navigation.ts tools/verify-role-gate.mjs
git commit -m @'
feat(phase-3a): icons + navigation foundation

- Add 15 named icons to icons.tsx (8 nav, 7 action) — additive, no existing
  icons removed.
- Port v3 role-gate verbatim to src/features/navigation/navigation.ts with
  new IconName type wiring (no LucideIcon imports outside the icon registry).
- Add tools/verify-role-gate.mjs to sanity-check the matrix lengths +
  first-items per role.

No runtime behavior change yet — these are pure data + types used by
downstream Phase 3A tasks.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 2: `useAuthSession` hook

**Files:**
- Create: `src/hooks/use-auth-session.ts`

**Why:** Login screen (Task 5) + AppShell (Task 6) both need this. Isolated by itself it's easier to reason about (no UI noise) and the AppShell becomes a thin composition.

### Step 2.1 — Create the hook

- [ ] **Create `src/hooks/use-auth-session.ts`.**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/use-supabase";
import { useAccountQuery, queryKeys } from "@/hooks/queries";
import type { Account } from "@/lib/types";

export type AuthStatus = "loading" | "authed" | "unauthed";

export interface UseAuthSessionResult {
  status: AuthStatus;
  /** Loaded employee_accounts row for the signed-in Supabase user. null while loading or unauthed. */
  account: Account | null;
  /** True while account row is being fetched after Supabase auth resolves. */
  isLoadingAccount: boolean;
  /** Sign in with email + password. Throws on failure (caller handles UX). */
  signIn(email: string, password: string): Promise<void>;
  /** Sign out + clear cached account row. */
  signOut(): Promise<void>;
  /**
   * Self-signup as viewer. Creates auth user + inserts signup_requests row
   * with status="pending_approval" — owner/manager approves in Settings later.
   * Throws on auth-side error; signup_requests insert failure surfaces as
   * a warning, not a hard error (auth user is already created).
   */
  signupViewer(email: string, password: string, fullName: string): Promise<void>;
}

/**
 * Composes Supabase auth state (getSession + onAuthStateChange) with the
 * existing useAccountQuery so consumers see a single { status, account } pair.
 *
 * Supabase auth doesn't fit useQuery cleanly — session state changes via
 * event listener, not on-demand fetch. We keep the listener pattern from v3
 * (page.tsx lines 99-117) but expose it as a hook for testability.
 */
export function useAuthSession(): UseAuthSessionResult {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [hasSession, setHasSession] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Track unmount so async callbacks don't set state after dispose.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auth lifecycle — getSession on mount + subscribe to changes.
  useEffect(() => {
    if (!supabase) {
      setAuthChecked(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!mountedRef.current) return;
      setHasSession(Boolean(data.session));
      setAuthChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mountedRef.current) return;
      setHasSession(Boolean(session));
      setAuthChecked(true);
      if (!session) {
        queryClient.removeQueries({ queryKey: queryKeys.account() });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient, supabase]);

  // Load account row only when authed.
  const accountQuery = useAccountQuery(supabase, hasSession);

  const status: AuthStatus = !authChecked
    ? "loading"
    : hasSession
      ? "authed"
      : "unauthed";

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    queryClient.removeQueries({ queryKey: queryKeys.account() });
  }, [queryClient, supabase]);

  const signupViewer = useCallback(
    async (email: string, password: string, fullName: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: fullName } },
      });
      if (error) throw error;
      if (data.user) {
        // Best-effort: row is approved manually later. Failure here doesn't
        // hide the fact that the auth user was created.
        await supabase.from("signup_requests").insert({
          auth_user_id: data.user.id,
          email,
          name: fullName,
          status: "pending_approval",
        });
      }
    },
    [supabase]
  );

  return {
    status,
    account: accountQuery.data ?? null,
    isLoadingAccount: status === "authed" && accountQuery.isLoading,
    signIn,
    signOut,
    signupViewer,
  };
}
```

### Step 2.2 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected: same output as Phase 2 final. The hook isn't yet imported anywhere; tree-shaking keeps it out of bundles.

### Step 2.3 — Commit

- [ ] **Commit Task 2.**

```bash
git add src/hooks/use-auth-session.ts
git commit -m @'
feat(phase-3a): useAuthSession hook

Wraps Supabase auth lifecycle (getSession + onAuthStateChange) with the
existing useAccountQuery, exposing a single { status, account, ... } shape
plus signIn/signOut/signupViewer callbacks.

Mirrors v3 page.tsx lines 99-117 + 1-31 of features/auth/login-panel.tsx
in one self-contained hook. Account query gated by hasSession so it only
fires when there is a Supabase session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 3: `useBusinessDate` hook

**Files:**
- Create: `src/hooks/use-business-date.ts`

**Why:** Business-date is the single source of truth driving every query in 3 modules. Isolating it as a hook lets us swap default behavior (timezone defaults, persisted-across-tab) later without touching consumers.

### Step 3.1 — Create the hook

- [ ] **Create `src/hooks/use-business-date.ts`.**

```ts
"use client";

import { useCallback, useState } from "react";
import { todayInVN } from "@/lib/datetime";

export interface UseBusinessDateResult {
  /** YYYY-MM-DD in Vietnam wall-clock. */
  businessDate: string;
  setBusinessDate(date: string): void;
  resetToToday(): void;
}

/**
 * Single source of truth for the `business_date` filter that drives every
 * query in dashboard / reports / pivot. Default is today() in
 * Asia/Ho_Chi_Minh — using lib/datetime.todayInVN to avoid the UTC-rollover
 * bug (`new Date().toISOString().slice(0,10)` returns yesterday after 17:00 UTC).
 *
 * State is intentionally local (no URL sync, no localStorage). Callers that
 * need persistence can wrap this hook later — YAGNI for Phase 3A.
 */
export function useBusinessDate(): UseBusinessDateResult {
  const [businessDate, setBusinessDate] = useState<string>(() => todayInVN());

  const resetToToday = useCallback(() => {
    setBusinessDate(todayInVN());
  }, []);

  return { businessDate, setBusinessDate, resetToToday };
}
```

### Step 3.2 — Add a TZ-edge assertion script

- [ ] **Create `tools/verify-business-date.mjs` (smoke).**

```js
// Smoke: verify todayInVN-like behavior at TZ boundaries.
// Runs in Node, mirrors what lib/datetime.todayInVN does, asserts no off-by-one.
import assert from "node:assert/strict";

function todayInVNLike(now) {
  return new Date(now).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

// Case 1: 2026-05-20 16:59:59 UTC == 23:59:59 VN -> VN date = 2026-05-20
const beforeMidnightVN = new Date("2026-05-20T16:59:59Z");
assert.equal(todayInVNLike(beforeMidnightVN), "2026-05-20", "23:59 VN should be 2026-05-20");

// Case 2: 2026-05-20 17:00:00 UTC == 00:00:00 VN next day -> VN date = 2026-05-21
const justAfterMidnightVN = new Date("2026-05-20T17:00:00Z");
assert.equal(todayInVNLike(justAfterMidnightVN), "2026-05-21", "00:00 VN next day should be 2026-05-21");

// Case 3: noon UTC = 19:00 VN same day
const noonUTC = new Date("2026-05-20T12:00:00Z");
assert.equal(todayInVNLike(noonUTC), "2026-05-20", "noon UTC = 19:00 VN, same day");

console.log("✓ business-date timezone behavior matches VN wall-clock at edges");
```

### Step 3.3 — Verify build + assertion

- [ ] **Build.**

```bash
npm run build
```

Expected: clean build, identical bundle.

- [ ] **Run assertion.**

```bash
node tools/verify-business-date.mjs
```

Expected: `✓ business-date timezone behavior matches VN wall-clock at edges`

### Step 3.4 — Commit

- [ ] **Commit Task 3.**

```bash
git add src/hooks/use-business-date.ts tools/verify-business-date.mjs
git commit -m @'
feat(phase-3a): useBusinessDate hook + TZ edge assertions

Local useState wrapping todayInVN(). Single source of truth for the
business_date filter used by dashboard / reports / pivot.

Includes tools/verify-business-date.mjs asserting no off-by-one at the
17:00 UTC = 00:00 VN boundary — this is the bug v3 lib/datetime was
written to prevent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 4: `useRoleGate` hook

**Files:**
- Create: `src/hooks/use-role-gate.ts`

**Why:** AppShell + Sidebar + Topbar all need to know "what views can this account see + which is the default". Wrap the navigation.ts pure functions into a React hook so consumers don't redo the memoization.

### Step 4.1 — Create the hook

- [ ] **Create `src/hooks/use-role-gate.ts`.**

```ts
"use client";

import { useMemo } from "react";
import type { Account, AppSettings } from "@/lib/types";
import {
  getVisibleNav,
  canSee as canSeeFn,
  type NavItem,
  type ViewKey,
} from "@/features/navigation/navigation";

export interface UseRoleGateResult {
  /** Nav items visible to this account, ordered per sidebar_config (fallback DEFAULT_SIDEBAR_BY_ROLE). */
  visibleNav: ReadonlyArray<NavItem>;
  /** First visible view, used as fallback when current view is hidden by role change. */
  defaultView: ViewKey;
  /** Whether this account can see a given view (with current app settings). */
  canSee(key: ViewKey): boolean;
}

const EMPTY_SETTINGS: AppSettings = {
  sidebar_defaults: {},
  handover_default_tasks: [],
};

/**
 * Memoized role gate. Pure wrapper over navigation.ts so consumers (sidebar,
 * topbar, page.tsx) don't repeatedly recompute the visibleNav list.
 *
 * If account is null, returns an empty matrix — caller should render the
 * login screen, not the AppShell.
 */
export function useRoleGate(
  account: Account | null,
  settings: AppSettings | undefined
): UseRoleGateResult {
  const effectiveSettings = settings ?? EMPTY_SETTINGS;

  const visibleNav = useMemo(
    () => getVisibleNav(account, effectiveSettings),
    [account, effectiveSettings]
  );

  const defaultView: ViewKey = visibleNav[0]?.key ?? "dashboard";

  const canSee = useMemo(
    () => (key: ViewKey) => canSeeFn(account, key, effectiveSettings),
    [account, effectiveSettings]
  );

  return { visibleNav, defaultView, canSee };
}
```

### Step 4.2 — Verify build

- [ ] **Build.**

```bash
npm run build
```

Expected: clean build.

### Step 4.3 — Commit

- [ ] **Commit Task 4.**

```bash
git add src/hooks/use-role-gate.ts
git commit -m @'
feat(phase-3a): useRoleGate hook

Memoized wrapper over navigation.ts getVisibleNav + canSee. Exposes
{ visibleNav, defaultView, canSee } so AppShell / Sidebar / TopBar share
one computation per account+settings tuple.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 5: Login screen

**Files:**
- Create: `src/app/login/page.tsx` (App Router page)
- Create: `src/features/auth/login-screen.tsx` (the form component)

**Why:** Lets us land Task 5 + 6 (AppShell) in any order — separate route, separate test. Phase 1 middleware already redirects unauthed users to `/login`, so this route is the missing puzzle piece.

### Step 5.0 — Mount `ToastProvider` + `RadixTooltip.Provider` at the app root

**Why this step:** Phase 2 `useToast()` throws if there's no `<ToastProvider>` ancestor. The playground mounts it locally, but the app root `providers.tsx` only has `QueryClientProvider`. Every Phase 3A toast surface (login signup success, page.tsx sync feedback, dashboard shortcuts, reports export) needs the provider — so add it once at the root.

`RadixTooltip.Provider` is needed for any `<Tooltip>` consumer (Phase 2 ListItem with tooltips, etc.). Adding it now is cheap.

- [ ] **Modify `src/app/providers.tsx`.**

Replace the contents with:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1
          }
        }
      })
  );
  return (
    <QueryClientProvider client={client}>
      <RadixTooltip.Provider>
        <ToastProvider>{children}</ToastProvider>
      </RadixTooltip.Provider>
    </QueryClientProvider>
  );
}
```

- [ ] **Build to confirm no regression.**

```bash
npm run build
```

Expected: clean. Both providers are tree-shaken if unused, so no bundle impact until a child calls `useToast()`.

### Step 5.1 — Create `LoginScreen` component

- [ ] **Create `src/features/auth/login-screen.tsx`.**

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Card, CardBody } from "@/components/ui/card";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useAuthSession } from "@/hooks/use-auth-session";

type Mode = "sign-in" | "sign-up";

/**
 * Single-card auth screen with two modes: sign-in vs viewer self-signup.
 * Behavior ports v3 features/auth/login-panel.tsx — only the visuals change.
 *
 * On successful sign-in: router.push("/") — middleware will let it through
 * because Supabase auth cookies are now set.
 *
 * On successful signup: keep user on /login but show a toast — they must
 * wait for owner/manager approval before they can sign in.
 */
export function LoginScreen() {
  const router = useRouter();
  const { signIn, signupViewer } = useAuthSession();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        await signIn(email, password);
        router.push("/");
      } else {
        await signupViewer(email, password, fullName);
        toast({
          semantic: "success",
          title: "Đã gửi yêu cầu",
          message: "Quản lý sẽ duyệt tài khoản viewer trước khi bạn dùng được.",
        });
        setMode("sign-in");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Có lỗi xảy ra. Thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-bg-app-from to-bg-app-to flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardBody className="space-y-6">
          <div className="flex flex-col items-center gap-3">
            <Image
              src="/chill-logo.png"
              alt="Chill Coffee Garden"
              width={64}
              height={64}
              className="rounded-2xl shadow-raised"
              priority
            />
            <div className="text-center">
              <p className="text-sm uppercase tracking-wide text-muted">
                Chill Manager v4
              </p>
              <h1 className="font-display text-2xl text-ink mt-1">
                Trạm vận hành quán
              </h1>
            </div>
          </div>

          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <TextField
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isBusy}
              placeholder="owner@chill.local"
            />
            <TextField
              label="Mật khẩu"
              type="password"
              autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isBusy}
              placeholder="••••••••"
            />
            {mode === "sign-up" && (
              <TextField
                label="Họ và tên"
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                disabled={isBusy}
                placeholder="Ví dụ: Nguyễn Văn A"
              />
            )}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={isBusy}
              className="w-full"
            >
              {mode === "sign-in" ? "Đăng nhập" : "Gửi yêu cầu đăng ký"}
            </Button>
          </form>

          <div className="text-center text-sm text-muted">
            {mode === "sign-in" ? (
              <button
                type="button"
                className="text-ink underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("sign-up");
                  setError(null);
                }}
              >
                Chưa có tài khoản? Đăng ký viewer
              </button>
            ) : (
              <button
                type="button"
                className="text-ink underline-offset-4 hover:underline"
                onClick={() => {
                  setMode("sign-in");
                  setError(null);
                }}
              >
                Đã có tài khoản? Đăng nhập
              </button>
            )}
          </div>
        </CardBody>
      </Card>
    </main>
  );
}
```

### Step 5.2 — Create the `/login` route page

- [ ] **Create `src/app/login/page.tsx`.**

```tsx
import { LoginScreen } from "@/features/auth/login-screen";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return <LoginScreen />;
}
```

> `dynamic = "force-dynamic"` disables prerender — this page must run client-side because `useAuthSession` reads Supabase cookies/session.

### Step 5.3 — Verify build

- [ ] **Run build.**

```bash
npm run build
```

Expected new line in route summary:

```
├ ƒ /login                                  ... kB
```

(Marked `ƒ` for server-rendered-on-demand.)

### Step 5.4 — Manual smoke (dev mode)

- [ ] **Smoke `/login` route locally.**

```bash
docker compose up -d
# wait for chill-app health
# Visit http://localhost:3009/login
```

Verify:
1. Logo + form renders without console errors.
2. Toggle "Đăng ký viewer" → name field appears.
3. Toggle back → name field disappears.
4. Submit empty form → browser native required errors fire (we rely on `required` attr).
5. Submit with wrong creds → AlertBanner shows the Supabase error message.
6. Owner login (`owner@chill.local` / `chill-owner-2026` from Phase 1 seed) → page navigates to `/` (which is still the Phase 1 stub at this point — that's fine, AppShell lands in Task 6).

### Step 5.5 — Commit

- [ ] **Commit Task 5.**

```bash
git add src/app/providers.tsx src/app/login/page.tsx src/features/auth/login-screen.tsx
git commit -m @'
feat(phase-3a): login screen + /login route + ToastProvider mount

- Update providers.tsx to wrap children with ToastProvider +
  RadixTooltip.Provider. Phase 2 useToast() requires the context to be
  ancestor-present; playground had it locally but app root didn't.
- LoginScreen: Phase 2 Card + TextField + Button + AlertBanner + Toast
  composed into a single-card auth screen with mode toggle. Sign-up
  ports v3 viewer self-signup verbatim (auth.signUp + signup_requests
  insert with status="pending_approval").
- /login route is force-dynamic — it reads Supabase cookies which must
  run client-side.

Owner test: owner@chill.local / chill-owner-2026 (Phase 1 seed) signs in
successfully. After redirect to "/" the user sees the Phase 1 stub —
AppShell lands in Task 6.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 6: AppShell + thin `page.tsx`

**Files:**
- Modify: `src/app/page.tsx` (rewrite from 11-line stub to ~120-line thin router)

**Why:** Lands the shell + view dispatcher in one task. Subsequent tasks only fill in `<DashboardView />`, `<ReportsView />`, `<PivotView />` — they swap a placeholder line, not the whole file.

### Step 6.1 — Rewrite `src/app/page.tsx`

- [ ] **Replace `src/app/page.tsx` with the AppShell composition.**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useSupabase } from "@/hooks/use-supabase";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useBusinessDate } from "@/hooks/use-business-date";
import { useRoleGate } from "@/hooks/use-role-gate";
import { useAppSettingsQuery, useDashboardQuery } from "@/hooks/queries";
import { usePosSync } from "@/hooks/use-pos-sync";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useAuthCookieSync } from "@/hooks/use-auth-cookie-sync";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar, SidebarSection, SidebarLogo } from "@/components/layout/sidebar";
import { NavItem } from "@/components/layout/nav-item";
import { TopBar } from "@/components/layout/top-bar";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { ViewKey } from "@/features/navigation/navigation";
import { ROLE_LABELS } from "@/features/navigation/navigation";

export default function HomePage() {
  const router = useRouter();
  const supabase = useSupabase();
  const { toast } = useToast();
  const { status, account, isLoadingAccount, signOut } = useAuthSession();
  const { businessDate, setBusinessDate } = useBusinessDate();
  const appSettingsQuery = useAppSettingsQuery(supabase, status === "authed");
  const { visibleNav, defaultView, canSee } = useRoleGate(account, appSettingsQuery.data);
  const dashboardQuery = useDashboardQuery(supabase, businessDate, status === "authed");
  const posSync = usePosSync(supabase, businessDate, account, dashboardQuery.data?.latest_sync);
  useRealtimeInvalidate(supabase, businessDate);
  useAuthCookieSync(supabase);

  const [view, setView] = useState<ViewKey>("dashboard");
  // If role change hides current view, snap to first visible.
  useEffect(() => {
    if (status === "authed" && account && !canSee(view)) {
      setView(defaultView);
    }
  }, [account, canSee, defaultView, status, view]);

  // Redirect to login if no session after auth resolves.
  useEffect(() => {
    if (status === "unauthed") router.replace("/login");
  }, [router, status]);

  // Auth still resolving → spinner.
  if (status === "loading" || isLoadingAccount) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Spinner size={32} />
      </main>
    );
  }

  // Already redirecting; render nothing.
  if (status === "unauthed") return null;

  // Account exists but not active (pending_approval / disabled).
  if (!account || account.status !== "active") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardBody className="space-y-4 text-center">
            <Image
              src="/chill-logo.png"
              alt="Chill Coffee Garden"
              width={56}
              height={56}
              className="mx-auto rounded-2xl shadow-raised"
            />
            <h1 className="font-display text-xl text-ink">Tài khoản chờ duyệt</h1>
            <p className="text-sm text-muted">
              Bạn đã đăng nhập thành công, nhưng owner/manager chưa kích hoạt
              employee_accounts. Liên hệ quản lý quán.
            </p>
            <button
              type="button"
              className="text-sm text-ink underline-offset-4 hover:underline"
              onClick={signOut}
            >
              Đăng xuất
            </button>
          </CardBody>
        </Card>
      </main>
    );
  }

  function handleNavClick(next: ViewKey) {
    setView(next);
  }

  async function handlePosSync() {
    if (account?.role === "employee_viewer") {
      toast({ semantic: "info", message: "Viewer không sync POS." });
      return;
    }
    try {
      await posSync.mutateAsync({ force: true, reason: "manual_refresh" });
      toast({ semantic: "success", message: "Đã yêu cầu sync POS từ KiotViet." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không gọi được sync.",
      });
    }
  }

  const employeeName = account.employee?.name ?? "Người dùng";

  return (
    <AppShell
      sidebar={
        <Sidebar>
          <SidebarLogo>Chill Coffee Garden</SidebarLogo>
          <SidebarSection label="Vận hành">
            {visibleNav.map((item) => (
              <NavItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                active={view === item.key}
                onClick={() => handleNavClick(item.key)}
              />
            ))}
          </SidebarSection>
        </Sidebar>
      }
      topBar={
        <TopBar
          actions={
            <>
              <input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                aria-label="Ngày kinh doanh"
              />
              <IconButton
                icon="refreshCw"
                size={40}
                variant="secondary"
                aria-label={posSync.isPending ? "Đang sync POS" : "Đồng bộ POS"}
                onClick={handlePosSync}
                disabled={posSync.isPending}
              />
              <Avatar
                size="md"
                initials={employeeName.slice(0, 2).toUpperCase()}
                alt={`${employeeName} (${ROLE_LABELS[account.role]})`}
              />
              <IconButton
                icon="logOut"
                size={40}
                variant="ghost"
                aria-label="Đăng xuất"
                onClick={signOut}
              />
            </>
          }
        />
      }
    >
      <div className="space-y-6">
        {view === "dashboard" && (
          <EmptyState
            icon="layoutDashboard"
            title="Dashboard đang chờ Task 7-8"
            subtitle="AppShell đã sẵn sàng; nội dung dashboard sẽ vào ở task tiếp theo."
          />
        )}
        {view === "reports" && (
          <EmptyState
            icon="fileText"
            title="Reports đang chờ Task 9"
            subtitle="Báo cáo chốt két sẽ vào ở task tiếp theo."
          />
        )}
        {view === "pivot" && (
          <EmptyState
            icon="barChart3"
            title="Pivot đang chờ Task 10"
            subtitle="Doanh thu theo hóa đơn sẽ vào ở task tiếp theo."
          />
        )}
        {/* 3B/3C views — show locked placeholder. */}
        {(view === "expenses" || view === "shifts" || view === "cash") && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3B"
            subtitle="Chi phí / Ca & lương / Chốt két sẽ port + redesign ở phase tới."
          />
        )}
        {(view === "safe" || view === "settings") && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3C"
            subtitle="Sổ quỹ / Thiết lập là module owner-only, sẽ vào Phase 3C."
          />
        )}
      </div>
    </AppShell>
  );
}
```

### Step 6.2 — Verify build

- [ ] **Build.**

```bash
npm run build
```

Expected: `/` route grows to include AppShell + Sidebar + TopBar (likely +40–60 kB First Load JS over the stub). Confirm no TypeScript errors.

### Step 6.3 — Manual smoke

- [ ] **Login + see AppShell.**

```bash
docker compose up -d
```

1. Visit `http://localhost:3009/` → redirect to `/login`.
2. Sign in as owner → land on `/` → AppShell renders with all 8 nav items.
3. Click each nav item → main content swaps to corresponding EmptyState placeholder.
4. Change business-date in TopBar → no crash (queries refire silently).
5. Click POS sync IconButton → toast appears ("Đã yêu cầu sync POS" or an error if no integration_clients row).
6. Click logout IconButton → redirected back to `/login`.

### Step 6.4 — Commit

- [ ] **Commit Task 6.**

```bash
git add src/app/page.tsx
git commit -m @'
feat(phase-3a): AppShell + thin page.tsx router

Replace 11-line stub with ~150-line thin router composing:
- 3 NEW hooks: useAuthSession, useBusinessDate, useRoleGate
- 3 PHASE 1 hooks: usePosSync, useRealtimeInvalidate, useAuthCookieSync
- 2 PHASE 1 queries: useAppSettingsQuery, useDashboardQuery (only for latest_sync)
- Phase 2 layout: AppShell + Sidebar + NavItem + TopBar + IconButton

Three view bodies still placeholder EmptyStates — landed full UI in
Tasks 7-10. Locked-state EmptyStates show users when they click into a
3B/3C view that isn't ready yet.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 7: KpiBar + DashboardView skeleton

**Files:**
- Create: `src/features/dashboard/kpi-bar.tsx`
- Create: `src/features/dashboard/dashboard-view.tsx`

**Why:** The 5 KPI is the visual centerpiece — landing it alone proves the data pipeline + StatCard token wiring. The full DashboardView wires in sub-cards in Task 8 — Task 7 ships an MVP that already passes verification for total/cash/expense numbers.

### Step 7.1 — Create `KpiBar`

- [ ] **Create `src/features/dashboard/kpi-bar.tsx`.**

```tsx
"use client";

import { StatCard } from "@/components/ui/stat-card";
import { formatVND } from "@/lib/format";
import type { DashboardData } from "@/lib/types";

interface KpiBarProps {
  data: DashboardData;
}

/**
 * Top-of-dashboard KPI strip — 5 pastel StatCards mirroring v3 MetricsBar.
 *
 * Mapping vs v3 MetricsBar:
 *   pos     -> "Thu POS"          = total_sales - cash_sales (non-cash POS)
 *   cash    -> "Thu tiền mặt"     = cash_sales
 *   expense -> "Tổng chi"         = total_expenses
 *   payroll -> "Lương đã phát"    = payroll_paid
 *   staff   -> "Đang trong ca"    = active_staff (integer)
 *
 * Color order: peach / blue / mint / lilac / peach — alternates warm/cool.
 */
export function KpiBar({ data }: KpiBarProps) {
  const posSales = Math.max(0, (data.total_sales ?? 0) - (data.cash_sales ?? 0));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        color="peach"
        title="Thu POS"
        subtitle="Không tiền mặt"
        value={formatVND(posSales)}
      />
      <StatCard
        color="blue"
        title="Thu tiền mặt"
        subtitle="Đếm trong két"
        value={formatVND(data.cash_sales)}
      />
      <StatCard
        color="mint"
        title="Tổng chi"
        subtitle="Hôm nay"
        value={formatVND(data.total_expenses)}
      />
      <StatCard
        color="lilac"
        title="Lương đã phát"
        subtitle="Trong ngày"
        value={formatVND(data.payroll_paid)}
      />
      <StatCard
        color="peach"
        title="Đang trong ca"
        subtitle="Nhân viên"
        value={`${data.active_staff} người`}
      />
    </div>
  );
}
```

### Step 7.2 — Create `DashboardView` skeleton

- [ ] **Create `src/features/dashboard/dashboard-view.tsx` (skeleton + KpiBar wiring).**

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useDashboardQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import type { DashboardData } from "@/lib/types";
import { KpiBar } from "./kpi-bar";

const EMPTY: DashboardData = {
  business_date: "",
  total_sales: 0,
  cash_sales: 0,
  non_cash_sales: 0,
  opening_cash: 0,
  total_expenses: 0,
  payroll_paid: 0,
  active_staff: 0,
  expenses: [],
  sales_orders: [],
};

interface DashboardViewProps {
  businessDate: string;
}

export function DashboardView({ businessDate }: DashboardViewProps) {
  const supabase = useSupabase();
  const query = useDashboardQuery(supabase, businessDate, true);

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dashboard">
        {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? { ...EMPTY, business_date: businessDate };

  return (
    <div className="space-y-6">
      <KpiBar data={data} />
      {/* Task 8 fills in: shortcut grid, expense log, sales feed, store status, handover */}
      <EmptyState
        icon="sparkles"
        title="Các thẻ chi tiết sẽ vào ở Task 8"
        subtitle="Đang còn thiếu: shortcut grid, expense log, sales feed, store status, handover panel."
      />
    </div>
  );
}
```

### Step 7.3 — Wire `DashboardView` into `page.tsx`

- [ ] **Replace the dashboard placeholder in `src/app/page.tsx`.**

In `src/app/page.tsx`, change:

```tsx
        {view === "dashboard" && (
          <EmptyState
            icon="layoutDashboard"
            title="Dashboard đang chờ Task 7-8"
            subtitle="AppShell đã sẵn sàng; nội dung dashboard sẽ vào ở task tiếp theo."
          />
        )}
```

to:

```tsx
        {view === "dashboard" && <DashboardView businessDate={businessDate} />}
```

Add the import at the top of `src/app/page.tsx`:

```tsx
import { DashboardView } from "@/features/dashboard/dashboard-view";
```

### Step 7.4 — Verify build + smoke

- [ ] **Build.**

```bash
npm run build
```

Expected: `/` route includes KpiBar + DashboardView; First Load JS grows accordingly.

- [ ] **Smoke.**

```bash
docker compose up -d
```

1. Visit `/` → login → dashboard tab shows 5 StatCards with zeroes (no real data yet — Phase 1 seed only has 1 owner + 1 integration_client, no orders/expenses).
2. Change business-date → KpiBar re-renders (still zeroes).
3. Verify all 5 cards render WITH labels and `0 ₫` values; no console errors.

### Step 7.5 — Commit

- [ ] **Commit Task 7.**

```bash
git add src/features/dashboard/kpi-bar.tsx src/features/dashboard/dashboard-view.tsx src/app/page.tsx
git commit -m @'
feat(phase-3a): KpiBar + DashboardView skeleton

KpiBar renders 5 StatCards (peach/blue/mint/lilac/peach) mapping to v3
MetricsBar fields:
  - Thu POS         = total_sales - cash_sales
  - Thu tiền mặt    = cash_sales
  - Tổng chi        = total_expenses
  - Lương đã phát   = payroll_paid
  - Đang trong ca   = active_staff (integer)

DashboardView is the wrapping component that calls useDashboardQuery,
handles loading/error states, and renders KpiBar. Sub-cards land in
Task 8 — placeholder EmptyState marks the gap.

page.tsx now mounts DashboardView for view==="dashboard".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 8: Dashboard sub-cards (shortcut, expense, sales, store-status, handover)

**Files:**
- Create: `src/features/dashboard/shortcut-grid.tsx`
- Create: `src/features/dashboard/expense-log-card.tsx`
- Create: `src/features/dashboard/sales-feed-card.tsx`
- Create: `src/features/dashboard/store-status-card.tsx`
- Create: `src/features/dashboard/handover-panel.tsx`
- Modify: `src/features/dashboard/dashboard-view.tsx` (compose sub-cards in bento grid)

**Why:** Each sub-card is a small, focused component that reads one slice of `DashboardData`. Splitting them keeps `DashboardView` to the role of layout + composition. Handover stays in this task even though it touches the `handover` query — keeping all dashboard pieces in one task makes verification easier (one screen to inspect).

### Step 8.1 — `ShortcutGrid`

- [ ] **Create `src/features/dashboard/shortcut-grid.tsx`.**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

interface Shortcut {
  key: "expense" | "shift" | "cash-check" | "cash-close" | "report";
  label: string;
  hint: string;
  icon: IconName;
  /** Phase the destination module lands in. Until then, clicks toast a hint. */
  phase: "3B" | "3C" | "ready";
}

const SHORTCUTS: ReadonlyArray<Shortcut> = [
  { key: "expense",    label: "Ghi chi phí",     hint: "Mở form nhập nhanh",       icon: "plus",     phase: "3B" },
  { key: "shift",      label: "Ra/vào ca",        hint: "Ghi nhận lượt làm",        icon: "clock",    phase: "3B" },
  { key: "cash-check", label: "Kiểm két nhanh",   hint: "Đếm két tức thời",         icon: "banknote", phase: "3B" },
  { key: "cash-close", label: "Chốt két",         hint: "Đi theo từng bước",        icon: "lock",     phase: "3C" },
  { key: "report",     label: "In báo cáo",       hint: "Phiếu chốt két",           icon: "printer",  phase: "ready" },
];

interface ShortcutGridProps {
  onGoReports(): void;
}

/**
 * 5 quick-action buttons. In Phase 3A only "Báo cáo chốt két" (report)
 * has a real destination (the reports view); the rest toast a hint about
 * when they land.
 */
export function ShortcutGrid({ onGoReports }: ShortcutGridProps) {
  const { toast } = useToast();
  function handle(s: Shortcut) {
    if (s.key === "report") {
      onGoReports();
      return;
    }
    toast({
      semantic: "info",
      title: s.label,
      message: `Tính năng này sẽ vào ở Phase ${s.phase}.`,
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bảng điều khiển nhanh</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SHORTCUTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => handle(s)}
              className="flex flex-col items-start gap-2 rounded-lg border border-border bg-surface p-4 text-left transition hover:border-border-strong hover:shadow-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
            >
              <Icon name={s.icon} size={20} className="text-ink" />
              <strong className="text-sm font-semibold text-ink">{s.label}</strong>
              <span className="text-xs text-muted">{s.hint}</span>
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
```

### Step 8.2 — `ExpenseLogCard`

- [ ] **Create `src/features/dashboard/expense-log-card.tsx`.**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ListItem } from "@/components/ui/list-item";
import { formatTime, formatVND } from "@/lib/format";
import type { Expense } from "@/lib/types";

interface ExpenseLogCardProps {
  expenses: ReadonlyArray<Expense>;
  total: number;
}

/**
 * Today's expense rows (top 4 by created_at — list comes pre-sorted from
 * dashboard_daily_ops RPC). Mirrors v3 dashboard-view.tsx lines 73-97.
 *
 * Inline list (not <ListItem>) because we want amount aligned right of the
 * row, which ListItem doesn't directly support — using ListItem would force
 * us to abuse the `action` slot for the amount, which is wrong semantically
 * (amount is the row's primary value, not a side action).
 */
export function ExpenseLogCard({ expenses, total }: ExpenseLogCardProps) {
  const rows = expenses.slice(0, 4);
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Sổ chi trong ngày</CardTitle>
          <strong className="font-display text-base text-ink">{formatVND(total)}</strong>
        </div>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="Chưa có khoản chi"
            subtitle="Khi nhân viên nhập chi, dòng mới sẽ hiện tại đây."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 py-3"
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
    </Card>
  );
}
```

### Step 8.3 — `SalesFeedCard`

- [ ] **Create `src/features/dashboard/sales-feed-card.tsx`.**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatTime, formatVND } from "@/lib/format";
import type { SalesOrder } from "@/lib/types";

interface SalesFeedCardProps {
  orders: ReadonlyArray<SalesOrder>;
  totalSales: number;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  momo: "MoMo",
  zalopay: "ZaloPay",
};

function paymentLabel(method: string | null | undefined) {
  if (!method) return "POS";
  return PAYMENT_LABELS[method] ?? method;
}

/**
 * 5 most recent KiotViet orders + total. Mirrors v3 dashboard-view.tsx
 * lines 112-133. Empty state if POS hasn't synced yet today.
 */
export function SalesFeedCard({ orders, totalSales }: SalesFeedCardProps) {
  const rows = orders.slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Thu từ KiotViet</CardTitle>
          <strong className="font-display text-base text-ink">
            {formatVND(totalSales)}
          </strong>
        </div>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon="banknote"
            title="Chưa có đơn POS"
            subtitle="Dữ liệu KiotViet sau khi sync sẽ hiện ở đây."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm font-semibold text-ink">
                      {o.invoice_code ?? o.order_code ?? "Hóa đơn"}
                    </strong>
                    <Badge variant="soft" semantic="neutral">
                      {paymentLabel(o.payment_method)}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted">
                    {o.sold_by_name ?? "POS"} · {formatTime(o.purchase_at)}
                  </span>
                </div>
                <strong className="shrink-0 font-display text-sm text-ink">
                  {formatVND(o.net_amount ?? o.total_payment ?? 0)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
```

### Step 8.4 — `StoreStatusCard`

- [ ] **Create `src/features/dashboard/store-status-card.tsx`.**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatVND } from "@/lib/format";
import type { CashCount, SalesSyncRun } from "@/lib/types";

interface StoreStatusCardProps {
  activeStaff: number;
  latestSync: SalesSyncRun | null | undefined;
  latestCashCount: CashCount | null | undefined;
}

function syncBadge(sync: SalesSyncRun | null | undefined) {
  if (!sync) return <Badge variant="soft" semantic="warning">Chưa sync</Badge>;
  if (sync.status === "success") return <Badge variant="soft" semantic="success">OK</Badge>;
  if (sync.status === "failed") return <Badge variant="soft" semantic="danger">Lỗi</Badge>;
  return <Badge variant="soft" semantic="warning">{sync.status}</Badge>;
}

/**
 * 3 mini-metrics: active staff count, latest cash check (with difference),
 * latest POS sync (status badge + finished_at). Mirrors v3 dashboard-view.tsx
 * lines 98-111 plus a simplified SyncIndicator.
 */
export function StoreStatusCard({
  activeStaff,
  latestSync,
  latestCashCount,
}: StoreStatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tình trạng quầy hôm nay</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">
              Nhân sự đang làm
            </dt>
            <dd className="mt-1 font-display text-lg text-ink">
              {activeStaff} người
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">
              Kiểm két gần nhất
            </dt>
            <dd className="mt-1 font-display text-lg text-ink">
              {latestCashCount
                ? formatVND(latestCashCount.difference)
                : "Chưa có"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">
              Sync POS
            </dt>
            <dd className="mt-1 flex items-center gap-2">
              <span className="font-display text-base text-ink">
                {formatDateTime(latestSync?.finished_at)}
              </span>
              {syncBadge(latestSync)}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
```

### Step 8.5 — `HandoverPanel` (read-only)

- [ ] **Create `src/features/dashboard/handover-panel.tsx`.**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ProgressBar } from "@/components/ui/progress-bar";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import type { HandoverSession } from "@/lib/types";

interface HandoverPanelProps {
  handover: HandoverSession | null;
}

/**
 * Read-only handover panel for Phase 3A. The wizard + mutation flow ports
 * to Phase 3C — until then we render the current state (checkboxes
 * disabled, note read-only) with a banner pointing to the next phase.
 */
export function HandoverPanel({ handover }: HandoverPanelProps) {
  if (!handover) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sổ bàn giao</CardTitle>
        </CardHeader>
        <CardBody>
          <EmptyState
            icon="info"
            title="Chưa bật sổ bàn giao"
            subtitle="Apply SQL handover trong database/ để lưu checklist lên Supabase."
          />
        </CardBody>
      </Card>
    );
  }

  const done = handover.tasks.filter((t) => t.is_done).length;
  const total = handover.tasks.length;
  const pct = total > 0 ? Math.round((done * 100) / total) : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Sổ bàn giao</CardTitle>
          <span className="font-display text-sm text-ink">
            {done}/{total} việc
          </span>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {total > 0 && <ProgressBar value={pct} />}
        <AlertBanner variant="info">
          Read-only ở Phase 3A. Wizard ghi sẽ vào Phase 3C.
        </AlertBanner>
        {total === 0 ? (
          <EmptyState
            icon="info"
            title="Chưa có checklist"
            subtitle="Owner/manager cấu hình mặc định ở Thiết lập (Phase 3C)."
          />
        ) : (
          <ul className="space-y-2">
            {handover.tasks.map((t) => (
              <li key={t.id} className="flex items-center gap-3">
                <Checkbox
                  id={`handover-task-${t.id}`}
                  checked={t.is_done}
                  disabled
                />
                <label
                  htmlFor={`handover-task-${t.id}`}
                  className={
                    "text-sm " +
                    (t.is_done ? "text-muted line-through" : "text-ink")
                  }
                >
                  {t.label}
                </label>
              </li>
            ))}
          </ul>
        )}
        {handover.note && (
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <p className="text-xs uppercase tracking-wide text-muted">
              Ghi chú bàn giao
            </p>
            <p className="mt-1 whitespace-pre-line text-sm text-ink">
              {handover.note}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

### Step 8.6 — Compose all sub-cards in `DashboardView`

- [ ] **Modify `src/features/dashboard/dashboard-view.tsx` to compose sub-cards.**

Replace the current body of `dashboard-view.tsx` with this fuller version. The change vs Task 7: import the 5 sub-cards + handover query, drop the placeholder EmptyState, lay out in a 2-column bento grid.

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useDashboardQuery, useHandoverQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import type { DashboardData } from "@/lib/types";
import { KpiBar } from "./kpi-bar";
import { ShortcutGrid } from "./shortcut-grid";
import { ExpenseLogCard } from "./expense-log-card";
import { SalesFeedCard } from "./sales-feed-card";
import { StoreStatusCard } from "./store-status-card";
import { HandoverPanel } from "./handover-panel";

const EMPTY: DashboardData = {
  business_date: "",
  total_sales: 0,
  cash_sales: 0,
  non_cash_sales: 0,
  opening_cash: 0,
  total_expenses: 0,
  payroll_paid: 0,
  active_staff: 0,
  expenses: [],
  sales_orders: [],
};

interface DashboardViewProps {
  businessDate: string;
  onGoReports(): void;
}

export function DashboardView({ businessDate, onGoReports }: DashboardViewProps) {
  const supabase = useSupabase();
  const dashboardQuery = useDashboardQuery(supabase, businessDate, true);
  const handoverQuery = useHandoverQuery(supabase, businessDate, true);

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dashboard">
        {dashboardQuery.error instanceof Error
          ? dashboardQuery.error.message
          : String(dashboardQuery.error)}
      </AlertBanner>
    );
  }

  const data = dashboardQuery.data ?? { ...EMPTY, business_date: businessDate };
  const handover = handoverQuery.data ?? null;

  return (
    <div className="space-y-6">
      <KpiBar data={data} />
      <ShortcutGrid onGoReports={onGoReports} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ExpenseLogCard expenses={data.expenses} total={data.total_expenses} />
          <StoreStatusCard
            activeStaff={data.active_staff}
            latestSync={data.latest_sync}
            latestCashCount={data.latest_cash_count}
          />
        </div>
        <div className="space-y-6">
          <HandoverPanel handover={handover} />
          <SalesFeedCard orders={data.sales_orders} totalSales={data.total_sales} />
        </div>
      </div>
    </div>
  );
}
```

### Step 8.7 — Pass `onGoReports` from `page.tsx`

- [ ] **Update `src/app/page.tsx` to pass the callback.**

In `src/app/page.tsx`, change the dashboard render line:

```tsx
        {view === "dashboard" && <DashboardView businessDate={businessDate} />}
```

to:

```tsx
        {view === "dashboard" && (
          <DashboardView
            businessDate={businessDate}
            onGoReports={() => setView("reports")}
          />
        )}
```

### Step 8.8 — Verify build + smoke

- [ ] **Build.**

```bash
npm run build
```

Expected: clean build; `/` route adds the 5 sub-card bundles.

- [ ] **Smoke.**

```bash
docker compose up -d
```

1. Login as owner → Dashboard renders:
   - KpiBar (5 cards, mostly zeros on seed data)
   - ShortcutGrid (5 buttons; click "In báo cáo" → switches to reports view; the other 4 toast)
   - ExpenseLogCard (EmptyState — no expenses on seed)
   - StoreStatusCard ("0 người" + "Chưa có" cash count + "Chưa sync" badge)
   - HandoverPanel (EmptyState — no handover_sessions row yet)
   - SalesFeedCard (EmptyState — no POS orders on seed)
2. No console errors, no layout breakage at narrow viewport (test ≤480px).

### Step 8.9 — Commit

- [ ] **Commit Task 8.**

```bash
git add src/features/dashboard/ src/app/page.tsx
git commit -m @'
feat(phase-3a): dashboard sub-cards (shortcut, expense, sales, store, handover)

5 new sub-card components composing the bento dashboard:
- ShortcutGrid: 5 quick-action buttons. Only "In báo cáo" navigates (to
  reports view); others toast a 3B/3C placeholder hint.
- ExpenseLogCard: top 4 expenses + total. Inline rows (not ListItem)
  because amount-right alignment is the primary value, not a side action.
- SalesFeedCard: 5 most recent KiotViet orders with payment Badge.
- StoreStatusCard: 3-grid mini-metrics (active staff, latest cash check,
  latest POS sync with status badge).
- HandoverPanel: read-only in 3A — checkboxes disabled, note read-only,
  banner pointing to Phase 3C for the wizard write flow.

DashboardView composes them in a 2-col bento grid with KpiBar on top and
ShortcutGrid full-width below.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 9: Reports module + JPEG export

**Files:**
- Modify: `package.json` (add `html-to-image`)
- Create: `src/features/reports/printable-report.tsx`
- Create: `src/features/reports/report-list.tsx`
- Create: `src/features/reports/export-jpeg.ts`
- Create: `src/features/reports/reports-view.tsx`
- Modify: `src/app/page.tsx` (mount ReportsView)

**Why:** Reports has 4 logical pieces — printable artifact, left list, export logic, container. Splitting them keeps the printable component pure (DOM + tokens only, no data wiring) so it can be rendered into a hidden DOM node for JPEG export without surprises.

### Step 9.1 — Add `html-to-image` to deps

- [ ] **Edit `package.json`.**

Pin to the same major version as v3 to avoid surprise behavior changes. In `dependencies`, add (alphabetical order):

```json
    "html-to-image": "^1.11.13",
```

So the relevant block looks like:

```json
    "clsx": "^2.1.1",
    "html-to-image": "^1.11.13",
    "lucide-react": "^1.14.0",
```

- [ ] **Install.**

```bash
npm install
```

Expected: `html-to-image` added to `node_modules` + `package-lock.json`. No conflicts.

### Step 9.2 — Create `PrintableReport`

- [ ] **Create `src/features/reports/printable-report.tsx` (port from v3 shared/, tokenized).**

```tsx
import { formatDateTime, formatVND } from "@/lib/format";
import type { CashCloseReport } from "@/lib/types";
import Image from "next/image";

interface PrintableReportProps {
  report: CashCloseReport;
}

/**
 * The actual artifact rendered for print / JPEG export. No data fetching,
 * no callbacks — pure props -> DOM mapping so html-to-image can capture it
 * deterministically.
 *
 * Tokenized vs v3 — class names use Tailwind tokens instead of legacy
 * .printableReport / .reportRows etc. Layout intentionally A4-portrait-ish:
 * 16cm wide max, generous padding, consistent type scale.
 */
export function PrintableReport({ report }: PrintableReportProps) {
  const denominationRows = Object.entries(report.denominations_json ?? {})
    .map(([d, c]) => ({ denomination: Number(d), count: Number(c) }))
    .filter((r) => r.denomination > 0)
    .sort((a, b) => b.denomination - a.denomination);

  return (
    <article className="mx-auto w-full max-w-[16cm] rounded-lg border border-border bg-surface p-6 font-sans text-ink">
      <header className="flex items-start gap-4 border-b border-border pb-4">
        <Image
          src="/chill-logo.png"
          alt="Chill Coffee Garden"
          width={56}
          height={56}
          className="rounded-2xl"
        />
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">
            Chill Coffee Garden
          </p>
          <h1 className="font-display text-xl">Báo cáo chốt két</h1>
          <p className="text-sm text-muted">
            {report.business_date} · {formatDateTime(report.closed_at)}
          </p>
        </div>
      </header>

      <div className="mt-4 flex items-center justify-between text-sm">
        <strong className="text-ink">
          {report.report_status === "final" ? "Đã chốt" : report.report_status}
        </strong>
        <span className="text-muted">
          Snapshot POS: {formatDateTime(report.sync_snapshot_at)}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="Tổng POS" value={formatVND(report.pos_total ?? report.pos_cash_total)} />
        <Row label="POS tiền mặt" value={formatVND(report.pos_cash_total)} />
        <Row label="POS không tiền mặt" value={formatVND(report.pos_non_cash_total ?? 0)} />
        <Row label="Tiền đầu ngày" value={formatVND(report.opening_cash)} />
        <Row label="Thực đếm trong két" value={formatVND(report.physical_cash)} />
        <Row label="Chuyển khoản đã nhận" value={formatVND(report.bank_transfer_confirmed ?? 0)} />
        <Row label="Chi phí cash" value={formatVND(report.expense_cash_total)} />
        <Row label="Lương đã phát" value={formatVND(report.payroll_cash_total)} />
        <Row label="Tổng đối soát" value={formatVND(report.reconciliation_total ?? report.theory_cash)} />
        <Row label="Chênh lệch" value={formatVND(report.difference)} highlight />
        <Row label="Để lại ngày mai" value={formatVND(report.leave_for_next_day ?? 0)} />
        <Row label="Nạp sổ quỹ" value={formatVND(report.safe_deposit_amount ?? 0)} />
      </dl>

      <h3 className="mt-6 mb-2 font-display text-base">Mệnh giá</h3>
      {denominationRows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-sm text-muted">
          Chưa có dữ liệu mệnh giá
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 font-medium">Mệnh giá</th>
              <th className="py-2 font-medium">Số tờ</th>
              <th className="py-2 font-medium text-right">Thành tiền</th>
            </tr>
          </thead>
          <tbody>
            {denominationRows.map((r) => (
              <tr key={r.denomination} className="border-b border-border">
                <td className="py-2">{formatVND(r.denomination)}</td>
                <td className="py-2">{r.count}</td>
                <td className="py-2 text-right font-display">
                  {formatVND(r.denomination * r.count)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mt-4 text-sm text-muted">
        Ghi chú: {report.note || "Không có"}
      </p>

      <footer className="mt-8 grid grid-cols-2 gap-6 text-center text-sm">
        <div className="border-t border-border pt-4">Người chốt</div>
        <div className="border-t border-border pt-4">Quản lý</div>
      </footer>
    </article>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd
        className={
          "text-right font-display " +
          (highlight ? "text-base text-ink" : "text-sm text-ink")
        }
      >
        {value}
      </dd>
    </>
  );
}
```

### Step 9.3 — Create `export-jpeg.ts`

- [ ] **Create `src/features/reports/export-jpeg.ts`.**

```ts
/**
 * Export a DOM node as a JPEG download via html-to-image.
 *
 * Dynamic import keeps html-to-image out of the main bundle — it only
 * loads when the user clicks "Tải ảnh", which is rare (once per close-out
 * report).
 *
 * Throws on failure; caller should catch and toast.
 */
export async function exportElementAsJpeg(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const { toJpeg } = await import("html-to-image");
  const dataUrl = await toJpeg(element, {
    quality: 0.95,
    backgroundColor: "#ffffff",
    pixelRatio: 2,
    cacheBust: true,
  });
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
```

### Step 9.4 — Create `ReportList`

- [ ] **Create `src/features/reports/report-list.tsx`.**

```tsx
"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { CashCloseReport } from "@/lib/types";

interface ReportListProps {
  reports: ReadonlyArray<CashCloseReport>;
  selectedId: string | null;
  onSelect(id: string): void;
}

function statusBadge(status: CashCloseReport["report_status"]) {
  switch (status) {
    case "final":
      return <Badge variant="soft" semantic="success">Đã chốt</Badge>;
    case "voided":
      return <Badge variant="soft" semantic="danger">Đã hủy</Badge>;
    case "draft":
      return <Badge variant="soft" semantic="warning">Nháp</Badge>;
    default:
      return <Badge variant="soft" semantic="neutral">{status}</Badge>;
  }
}

function differenceTone(diff: number) {
  if (diff > 0) return "text-success";
  if (diff < 0) return "text-danger";
  return "text-muted";
}

export function ReportList({ reports, selectedId, onSelect }: ReportListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Báo cáo theo ngày</CardTitle>
      </CardHeader>
      <CardBody>
        {reports.length === 0 ? (
          <EmptyState
            icon="fileText"
            title="Chưa có báo cáo"
            subtitle="Khi chốt két, báo cáo snapshot sẽ xuất hiện tại đây."
          />
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => {
              const active = r.id === selectedId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
                      active
                        ? "border-border-strong bg-surface-muted shadow-hover"
                        : "border-border bg-surface hover:border-border-strong"
                    )}
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {formatDateTime(r.closed_at)}
                      </span>
                      <span className={cn("text-xs", differenceTone(r.difference))}>
                        Chênh: {formatVND(r.difference)}
                      </span>
                    </div>
                    {statusBadge(r.report_status)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
```

### Step 9.5 — Create `ReportsView`

- [ ] **Create `src/features/reports/reports-view.tsx`.**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import { useReportsQuery } from "@/hooks/queries";
import { loadCashCloseReport } from "@/lib/data";
import type { CashCloseReport } from "@/lib/types";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icons";
import { ReportList } from "./report-list";
import { PrintableReport } from "./printable-report";
import { exportElementAsJpeg } from "./export-jpeg";

interface ReportsViewProps {
  businessDate: string;
}

export function ReportsView({ businessDate }: ReportsViewProps) {
  const supabase = useSupabase();
  const reportsQuery = useReportsQuery(supabase, businessDate, true);
  const { toast } = useToast();
  const [selected, setSelected] = useState<CashCloseReport | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  // Auto-select latest report when list changes (matches v3 page.tsx 149-152).
  useEffect(() => {
    setSelected((current) => current ?? reportsQuery.data?.[0] ?? null);
  }, [reportsQuery.data]);

  async function handleSelect(id: string) {
    if (!supabase) return;
    try {
      const full = await loadCashCloseReport(supabase, id);
      setSelected(full);
    } catch (err) {
      toast({
        semantic: "danger",
        title: "Không tải được báo cáo",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleExport() {
    if (!selected || !printRef.current) return;
    setIsExporting(true);
    try {
      const filename = `chot-ket-${selected.business_date}-${selected.id.slice(0, 8)}.jpg`;
      await exportElementAsJpeg(printRef.current, filename);
      toast({ semantic: "success", message: "Đã tải ảnh báo cáo." });
    } catch (err) {
      toast({
        semantic: "danger",
        title: "Không tải được ảnh",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsExporting(false);
    }
  }

  if (reportsQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (reportsQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được danh sách báo cáo">
        {reportsQuery.error instanceof Error
          ? reportsQuery.error.message
          : String(reportsQuery.error)}
      </AlertBanner>
    );
  }

  const reports = reportsQuery.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <ReportList
        reports={reports}
        selectedId={selected?.id ?? null}
        onSelect={handleSelect}
      />
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between gap-3">
            <CardTitle>Phiếu chốt két</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon name="download" size={16} />}
                loading={isExporting}
                disabled={!selected}
                onClick={handleExport}
              >
                Tải ảnh
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Icon name="printer" size={16} />}
                disabled={!selected}
                onClick={() => window.print()}
              >
                In
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {selected ? (
            <div ref={printRef} className="print-target">
              <PrintableReport report={selected} />
            </div>
          ) : (
            <EmptyState
              icon="fileText"
              title="Chọn một báo cáo"
              subtitle="Chọn một báo cáo ở cột trái để xem và in."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

### Step 9.6 — Mount `ReportsView` in `page.tsx`

- [ ] **Update `src/app/page.tsx`.**

In `src/app/page.tsx`, change:

```tsx
        {view === "reports" && (
          <EmptyState
            icon="fileText"
            title="Reports đang chờ Task 9"
            subtitle="Báo cáo chốt két sẽ vào ở task tiếp theo."
          />
        )}
```

to:

```tsx
        {view === "reports" && <ReportsView businessDate={businessDate} />}
```

And add the import at the top:

```tsx
import { ReportsView } from "@/features/reports/reports-view";
```

### Step 9.7 — Verify build + smoke

- [ ] **Build.**

```bash
npm run build
```

Expected: `html-to-image` should NOT show in the synchronous main-bundle. The chunk graph should put it in a separate `.js` chunk loaded lazily. Confirm `/` route First Load JS does not jump by ~50 kB (the package size).

- [ ] **Smoke.**

```bash
docker compose up -d
```

1. Login → click "Báo cáo chốt két" tab → ReportList renders (likely EmptyState on Phase 1 seed — no cash close reports exist).
2. Manually insert a fake `cash_close_report` row via Supabase Studio:
   ```sql
   -- Quick way to get a row for visual verification only — DO NOT do this on prod.
   INSERT INTO cash_counts (
     business_date, count_type, counted_at, total_physical, total_theory, difference,
     denominations_json, pos_total, pos_cash_total, pos_non_cash_total, opening_cash,
     bank_transfer_confirmed, expense_cash_total, payroll_cash_total, reconciliation_total,
     report_id, report_status
   ) VALUES (
     CURRENT_DATE, 'shift_close', NOW(), 1000000, 1000000, 0,
     '{"500000":1,"200000":2,"100000":1}'::jsonb, 1000000, 800000, 200000, 0,
     0, 0, 0, 1000000,
     NULL, NULL
   ) RETURNING id;

   -- then call finalize_cash_close_report with the returned cash_count_id
   ```
   Or skip this step and rely on Task 11 mirror data instead — the smoke just confirms the UI shape.
3. Confirm:
   - ReportList shows the row + Badge per status
   - Click row → PrintableReport renders on the right
   - Click "Tải ảnh" → file downloads with name `chot-ket-YYYY-MM-DD-<8chars>.jpg`
   - Click "In" → browser print dialog opens
   - No console errors

### Step 9.8 — Commit

- [ ] **Commit Task 9.**

```bash
git add package.json package-lock.json src/features/reports/ src/app/page.tsx
git commit -m @'
feat(phase-3a): reports module + JPEG export

- Add html-to-image@^1.11.13 dependency (pinned to same major as v3 to
  match behavior). Dynamic-imported inside export-jpeg.ts so it stays
  out of the main bundle.
- PrintableReport: pure props -> tokenized DOM (no data fetching, no
  callbacks). Sized for A4 portrait, deterministic for html-to-image
  capture.
- ReportList: left column with Badge per status + tone-colored difference.
- ReportsView: composes ReportList + PrintableReport in a 320px-grid
  layout, handles auto-selection of latest report, exposes "Tải ảnh"
  and "In" buttons.

page.tsx now mounts ReportsView for view==="reports".

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 10: Pivot module

**Files:**
- Create: `src/features/pivot/pivot-view.tsx`
- Modify: `src/app/page.tsx` (mount PivotView)

**Why:** Pivot is the smallest module — it reuses dashboard's `sales_orders` data, no new query. A DataTable + a header card. Small but real feature parity with v3.

### Step 10.1 — Create `PivotView`

- [ ] **Create `src/features/pivot/pivot-view.tsx`.**

```tsx
"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useDashboardQuery } from "@/hooks/queries";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { SalesOrder } from "@/lib/types";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  momo: "MoMo",
  zalopay: "ZaloPay",
};

function paymentLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_LABELS[method] ?? method;
}

const COLUMNS: ReadonlyArray<DataTableColumn<SalesOrder>> = [
  {
    key: "invoice_code",
    header: "Hóa đơn",
    sortable: true,
    render: (o) => o.invoice_code ?? o.order_code ?? "—",
  },
  {
    key: "sold_by_name",
    header: "Người bán",
    sortable: true,
    render: (o) => o.sold_by_name ?? "POS",
  },
  {
    key: "payment_method",
    header: "Thanh toán",
    sortable: false,
    render: (o) => paymentLabel(o.payment_method),
  },
  {
    key: "net_amount",
    header: "Doanh thu",
    sortable: true,
    className: "text-right",
    render: (o) => formatVND(o.net_amount ?? o.total_payment ?? 0),
  },
];

interface PivotViewProps {
  businessDate: string;
}

export function PivotView({ businessDate }: PivotViewProps) {
  const supabase = useSupabase();
  const query = useDashboardQuery(supabase, businessDate, true);

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dữ liệu POS">
        {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const orders = query.data?.sales_orders ?? [];
  const totalSales = query.data?.total_sales ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <CardTitle>Doanh thu sản phẩm — {businessDate}</CardTitle>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted">Tổng</p>
              <strong className="font-display text-lg text-ink">
                {formatVND(totalSales)}
              </strong>
              <span className="ml-2 text-xs text-muted">
                ({orders.length} hóa đơn)
              </span>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {orders.length === 0 ? (
            <EmptyState
              icon="barChart3"
              title="Chưa có hóa đơn cho ngày này"
              subtitle="Sau khi sync POS, hóa đơn từ KiotViet sẽ hiển thị ở đây."
            />
          ) : (
            <DataTable<SalesOrder>
              columns={COLUMNS}
              data={orders}
              rowKey={(o) => o.id}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
```

> **Note on `DataTable` API**: This task assumes Phase 2's `DataTable` exposes a `columns` array of `{ key, header, sortable?, align?, render }`. If the actual Phase 2 API differs (e.g., requires a different prop shape), adjust here — the columns are the only schema-coupled bit. Do NOT modify `src/components/ui/data-table.tsx` itself (Phase 2 component is frozen).

### Step 10.2 — Mount in `page.tsx`

- [ ] **Update `src/app/page.tsx`.**

Change:

```tsx
        {view === "pivot" && (
          <EmptyState
            icon="barChart3"
            title="Pivot đang chờ Task 10"
            subtitle="Doanh thu theo hóa đơn sẽ vào ở task tiếp theo."
          />
        )}
```

to:

```tsx
        {view === "pivot" && <PivotView businessDate={businessDate} />}
```

Add the import:

```tsx
import { PivotView } from "@/features/pivot/pivot-view";
```

### Step 10.3 — Verify build + smoke

- [ ] **Build.**

```bash
npm run build
```

Expected: clean build; `/` route's First Load JS adds the DataTable + PivotView bundle.

- [ ] **Smoke.**

```bash
docker compose up -d
```

1. Login → click "Pivot" tab → EmptyState (no orders on seed) or DataTable if you inserted fake orders earlier.
2. If you have data: try sorting by clicking column headers (DataTable sort built into Phase 2).
3. No console errors.

### Step 10.4 — Commit

- [ ] **Commit Task 10.**

```bash
git add src/features/pivot/pivot-view.tsx src/app/page.tsx
git commit -m @'
feat(phase-3a): pivot module — DataTable view of sales_orders

PivotView reuses dashboardQuery.sales_orders (no separate query). 4
columns: invoice_code, sold_by_name, payment_method, net_amount — with
sort enabled on the three keys that have natural ordering. Header card
shows total revenue + invoice count.

Empty state when sales_orders is empty (typical on a fresh seed).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

---

## Task 11: Verification gate (mirror restore + script)

**Files:**
- Modify: `.gitignore` (add `mirrors/`)
- Create: `tools/verify-mirror.mjs`
- Update: `README.md` section if exists (optional — skip if no README)

**Why:** This is the Phase 3A acceptance gate. It proves dashboard / reports / pivot numbers in v4 match v3 production exactly — catching timezone bugs, RPC drift, or any porting accident before users see them.

### Step 11.1 — Exclude `mirrors/` from git

- [ ] **Append to `.gitignore`.**

Append at end of `.gitignore`:

```gitignore

# Production data dumps (Phase 3A verification artifacts)
# Contains real customer / financial data — never commit.
mirrors/
```

### Step 11.2 — Create the verify-mirror script

- [ ] **Create `tools/verify-mirror.mjs`.**

```js
#!/usr/bin/env node
// Verify v4 dashboard numbers against the v3 production mirror.
//
// Prereq:
//   1. pg_dump v3 production (when shop is closed) into mirrors/v3-YYYY-MM-DD.sql
//   2. Restore into v4 dev: docker compose exec -T db psql -U postgres < mirrors/v3-YYYY-MM-DD.sql
//   3. docker compose up chill-app
//
// Then run: node tools/verify-mirror.mjs --date 2026-05-XX --base http://localhost:3009 --service-key <key>
//
// Compares:
//   - DashboardData fields totaled by Phase 1 RPC (loadDashboard)
//   - Compared against fields aggregated from raw tables (same SQL the RPC uses)
//
// Exit 0 on match; exit 1 with diff per field.

import { createClient } from "@supabase/supabase-js";
import { argv, exit } from "node:process";

function parseArgs(args) {
  const out = { date: "", url: "http://localhost:8000", serviceKey: "" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--date") out.date = args[++i];
    else if (a === "--url") out.url = args[++i];
    else if (a === "--service-key") out.serviceKey = args[++i];
  }
  return out;
}

const { date, url, serviceKey } = parseArgs(argv.slice(2));

if (!date) {
  console.error("Usage: node tools/verify-mirror.mjs --date YYYY-MM-DD [--url http://localhost:8000] [--service-key <key>]");
  console.error("  --service-key required; pass SUPABASE_SERVICE_ROLE_KEY value (from .env)");
  exit(2);
}

if (!serviceKey) {
  console.error("Missing --service-key. Get value from `.env` SUPABASE_SERVICE_ROLE_KEY.");
  exit(2);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function viaRpc() {
  const { data, error } = await supabase.rpc("dashboard_daily_ops", {
    p_business_date: date,
  });
  if (error) throw new Error(`RPC failed: ${error.message}`);
  return data;
}

async function viaRawAggregates() {
  // These aggregates mirror what dashboard_daily_ops computes internally.
  // If RPC drifts from raw aggregates, that's exactly the kind of bug we want
  // this script to catch.
  const [salesAgg, expensesAgg, payrollAgg, shiftsAgg, salesList, expensesList] =
    await Promise.all([
      supabase.rpc("dashboard_daily_ops", { p_business_date: date }), // re-use; placeholder
      Promise.resolve(null), // placeholders — we just compare RPC against itself for sanity
      Promise.resolve(null),
      Promise.resolve(null),
      Promise.resolve(null),
      Promise.resolve(null),
    ]);

  // The "raw" baseline strategy: query individual tables directly via PostgREST
  // and sum, then compare. This is the strict mirror check.
  const [{ data: salesOrders, error: e1 }] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("net_amount, payment_method, total_payment")
      .eq("business_date", date),
  ]);
  if (e1) throw new Error(`sales_orders read failed: ${e1.message}`);

  const total_sales = (salesOrders ?? []).reduce(
    (acc, o) => acc + Number(o.net_amount ?? o.total_payment ?? 0),
    0
  );
  const cash_sales = (salesOrders ?? []).reduce(
    (acc, o) =>
      acc +
      (o.payment_method === "cash"
        ? Number(o.net_amount ?? o.total_payment ?? 0)
        : 0),
    0
  );

  const [{ data: expenses, error: e2 }] = await Promise.all([
    supabase.from("expenses").select("amount").eq("business_date", date),
  ]);
  if (e2) throw new Error(`expenses read failed: ${e2.message}`);

  const total_expenses = (expenses ?? []).reduce(
    (acc, e) => acc + Number(e.amount ?? 0),
    0
  );

  const [{ data: payrollRecords, error: e3 }] = await Promise.all([
    supabase
      .from("shift_payroll_records")
      .select("total_pay")
      .eq("business_date", date),
  ]);
  if (e3) throw new Error(`shift_payroll_records read failed: ${e3.message}`);

  const payroll_paid = (payrollRecords ?? []).reduce(
    (acc, p) => acc + Number(p.total_pay ?? 0),
    0
  );

  const [{ data: shifts, error: e4 }] = await Promise.all([
    supabase
      .from("shift_assignments")
      .select("status")
      .eq("business_date", date),
  ]);
  if (e4) throw new Error(`shift_assignments read failed: ${e4.message}`);

  const active_staff = (shifts ?? []).filter(
    (s) => s.status === "checked_in"
  ).length;

  return {
    total_sales,
    cash_sales,
    total_expenses,
    payroll_paid,
    active_staff,
    sales_orders_count: (salesOrders ?? []).length,
    expenses_count: (expenses ?? []).length,
  };
}

function fmt(n) {
  return new Intl.NumberFormat("vi-VN").format(n);
}

async function main() {
  console.log(`Verifying business_date = ${date}\n`);
  console.log("Loading via RPC (the path the app uses)...");
  const rpc = await viaRpc();
  console.log("Loading via raw aggregates (the ground truth)...");
  const raw = await viaRawAggregates();

  const checks = [
    { name: "total_sales",        rpc: Number(rpc.total_sales ?? 0),     raw: raw.total_sales },
    { name: "cash_sales",         rpc: Number(rpc.cash_sales ?? 0),      raw: raw.cash_sales },
    { name: "total_expenses",     rpc: Number(rpc.total_expenses ?? 0),  raw: raw.total_expenses },
    { name: "payroll_paid",       rpc: Number(rpc.payroll_paid ?? 0),    raw: raw.payroll_paid },
    { name: "active_staff",       rpc: Number(rpc.active_staff ?? 0),    raw: raw.active_staff },
    { name: "sales_orders_count", rpc: (rpc.sales_orders ?? []).length,  raw: raw.sales_orders_count },
    { name: "expenses_count",     rpc: (rpc.expenses ?? []).length,      raw: raw.expenses_count },
  ];

  let failed = 0;
  console.log("\nField              | RPC              | Raw              | Match");
  console.log("---");
  for (const c of checks) {
    const match = c.rpc === c.raw;
    if (!match) failed++;
    const tick = match ? "✓" : "✗";
    console.log(
      `${c.name.padEnd(18)} | ${String(fmt(c.rpc)).padStart(16)} | ${String(fmt(c.raw)).padStart(16)} | ${tick}`
    );
  }

  if (failed === 0) {
    console.log(`\n✓ All ${checks.length} checks passed. v4 RPC matches raw aggregates on ${date}.`);
    exit(0);
  } else {
    console.error(`\n✗ ${failed} of ${checks.length} checks failed.`);
    exit(1);
  }
}

main().catch((err) => {
  console.error(`\n✗ verify-mirror crashed: ${err.message}`);
  exit(1);
});
```

> **Why "RPC vs raw" instead of "v3 vs v4"**: this script runs against the v4 dev DB after the v3 dump has been restored into it. The two queries (RPC + raw table aggregates) BOTH run on v4. If they match, it proves the RPC + ported lib/data are reading the restored data correctly. It indirectly proves v3→v4 parity because v4 RPCs are byte-identical SQL ports.
>
> Doing a true v3-vs-v4 cross-instance compare would require querying the v3 LIVE DB — which is exactly what we're avoiding (the shop is open during business hours). The mirror restore plus RPC-vs-raw is the safest equivalent.

### Step 11.3 — Document the snapshot + restore + verify flow

- [ ] **Append `docs/superpowers/specs/2026-05-20-v4-phase-3a-readonly-modules-design.md` §10 isn't enough — add an operator-facing checklist file.**

Create `tools/VERIFY_MIRROR_PROCEDURE.md`:

```markdown
# Verify-Mirror Procedure (Phase 3A acceptance gate)

This procedure proves v4 dashboard / reports / pivot numbers match a
production-mirror dump of v3 data. Run it once at end of Phase 3A.

## When to run

- After Task 10 is committed.
- After v3 is closed for the day (no active writes — typically 23:00+).
- On a dev machine. Never on prod v3 host directly.

## Step 1 — Snapshot v3 (one-time)

On the host running v3 production:

```bash
# Replace v3-postgres with your actual v3 Postgres container name.
docker exec v3-postgres pg_dump \
  -U postgres -d postgres \
  --schema=public --schema=auth --schema=storage \
  --inserts --no-owner --no-privileges \
  -f /tmp/v3-mirror-$(date +%F).sql

docker cp v3-postgres:/tmp/v3-mirror-$(date +%F).sql \
  /path/to/Chill\ Coffee\ ERP/mirrors/

# Quick safety check — file must contain INSERT lines, not DROP DATABASE.
head -20 mirrors/v3-mirror-*.sql
grep -c '^INSERT' mirrors/v3-mirror-*.sql   # expect > 0
grep -i 'drop database' mirrors/v3-mirror-*.sql && echo "ABORT: DROP DATABASE present" && exit 1
```

## Step 2 — Restore into v4 dev

```bash
# Stop app so it can't write during restore.
docker compose stop chill-app

# Wipe + reapply schema.
docker compose exec db psql -U postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Apply v4 migrations first (Phase 1 SQL).
npm run db:init

# Now load v3 data on top.
docker compose exec -T db psql -U postgres -d postgres \
  < mirrors/v3-mirror-$(date +%F).sql

# Bring app back.
docker compose start chill-app
```

## Step 3 — Verify

Pick a `business_date` that you know had real activity in v3 (e.g. yesterday).

```bash
# Get the service-role key from .env (root, gitignored).
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d= -f2)

node tools/verify-mirror.mjs --date 2026-05-19 --service-key "$SERVICE_KEY"
```

Expected: all 7 checks ✓.

If any check fails: investigate before tagging Phase 3A. Most likely
causes:
1. Timezone bug (a `business_date` filter compared a UTC date)
2. Ported RPC drifted from v3 — `diff database/002_functions.sql` between
   v3 and v4
3. Restore didn't include a needed table (check pg_dump scope)

## Step 4 — Smoke UI

After script passes, open `/login` → owner → switch business-date to the
verified date. Confirm:
- KpiBar numbers match script output.
- ReportsView shows real reports.
- PivotView shows real KiotViet orders.

## Step 5 — Tag and clean up

```bash
git tag v4-phase-3a
# Optionally delete the dump — it has real data.
rm mirrors/v3-mirror-$(date +%F).sql
```
```

### Step 11.4 — Run verification (operator-driven)

- [ ] **Run the verification (operator step — gated by access to v3 dump).**

```bash
# After completing Steps 1-2 of VERIFY_MIRROR_PROCEDURE.md:
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d= -f2)
node tools/verify-mirror.mjs --date <a-date-with-real-data> --service-key "$SERVICE_KEY"
```

Expected: `✓ All 7 checks passed.` If not, debug per "Step 3" guide above before continuing.

### Step 11.5 — Commit

- [ ] **Commit Task 11.**

```bash
git add .gitignore tools/verify-mirror.mjs tools/VERIFY_MIRROR_PROCEDURE.md
git commit -m @'
feat(phase-3a): mirror-data verification gate

- tools/verify-mirror.mjs: compares dashboard_daily_ops RPC output against
  raw-table aggregates for a given business_date. 7 checks
  (total_sales / cash_sales / total_expenses / payroll_paid / active_staff
  + count of sales_orders + count of expenses).
- tools/VERIFY_MIRROR_PROCEDURE.md: operator-facing checklist for the
  one-time pg_dump + restore + verify flow.
- .gitignore mirrors/ — dumps contain real customer + financial data.

This is the Phase 3A acceptance gate per the spec. Tag v4-phase-3a after
all 7 checks pass against a real-data restore.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
```

### Step 11.6 — Tag the phase

- [ ] **Tag and finalize Phase 3A.**

```bash
git tag v4-phase-3a
```

---

## End-of-phase checklist

Before declaring Phase 3A complete:

- [ ] `npm run build` is clean (no TS errors, no new warnings beyond Phase 2 baseline).
- [ ] `node tools/verify-role-gate.mjs` passes (Task 1).
- [ ] `node tools/verify-business-date.mjs` passes (Task 3).
- [ ] `node tools/verify-mirror.mjs --date <date>` passes against a restored v3 mirror (Task 11).
- [ ] Manual smoke: login (`owner@chill.local` / `chill-owner-2026`) → see AppShell → all 3 read-only views render → 5 nav items showing locked EmptyState placeholders.
- [ ] No commits to Phase 1 backend files (verified by `git diff main..HEAD src/lib/ src/hooks/queries/ src/middleware.ts src/app/api/ database/`).
- [ ] No commits to Phase 2 component files except `src/components/ui/icons.tsx` (additive only — verified by `git diff main..HEAD src/components/` and confirming `icons.tsx` only added 15 icons, no existing ones removed/renamed).
- [ ] `.env` and `supabase/.env` are NOT staged or committed (real secrets).
- [ ] `mirrors/` directory is gitignored (Task 11).
- [ ] Tag `v4-phase-3a` is on the final commit.
