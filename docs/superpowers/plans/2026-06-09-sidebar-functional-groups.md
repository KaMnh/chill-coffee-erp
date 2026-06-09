# Sidebar Functional Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nhóm 11 mục sidebar (đang đổ phẳng vào 1 section "Vận hành") thành 6 nhóm chức năng cố định theo dòng tiền — metadata cố định trong code, không migration DB.

**Architecture:** Thêm field bắt buộc `group: NavGroupKey` lên `NavItem` + hằng `NAV_GROUPS` (thứ tự nhóm cố định) trong `navigation.ts`. `getGroupedNav` tái dùng `getVisibleNav` (giữ thứ tự `NAV_ITEMS`), partition theo `group`, ẩn nhóm rỗng. `useRoleGate` expose thêm `groupedNav` (memoized). `page.tsx` map qua `groupedNav` thay cho 1 section phẳng.

**Tech Stack:** Next.js (App Router) client component, TypeScript strict, Vitest (node env, coverage v8). Không có jsdom/component-test → `page.tsx` verify bằng `tsc` + mắt thường; logic verify bằng Vitest.

**Spec:** `docs/superpowers/specs/2026-06-09-sidebar-functional-groups-design.md`

**Base:** `origin/main` (KHÔNG phải phase-6a cũ). `NAV_ITEMS` trên main có **11 view** (gồm `cashflow` "Dòng tiền"). Taxonomy đã cập nhật: `cashflow` view → nhóm `overview`.

---

## Taxonomy (group cho từng item, theo thứ tự `NAV_ITEMS`)

| # | ViewKey (NAV_ITEMS order) | `group` |
|---|---------------------------|---------|
| 0 | dashboard  | `overview`  |
| 1 | expenses   | `cashflow`  |
| 2 | shifts     | `staff`     |
| 3 | cash       | `cashflow`  |
| 4 | safe       | `cashflow`  |
| 5 | handover   | `staff`     |
| 6 | inventory  | `inventory` |
| 7 | reports    | `reports`   |
| 8 | pivot      | `reports`   |
| 9 | cashflow   | `overview`  |  ← view "Dòng tiền" → nhóm overview (KHÔNG vào nhóm tên `cashflow`) |
| 10| settings   | `system`    |

Thứ tự render trong nhóm = thứ tự `NAV_ITEMS` ⇒ nhóm `cashflow` ("Thu – Chi – Quỹ") = `[expenses, cash, safe]`; nhóm `overview` = `[dashboard, cashflow]`; `reports` = `[reports, pivot]`; `staff` = `[shifts, handover]`.

## File Structure

- **Modify** `src/features/navigation/navigation.ts` — types nhóm, `NAV_GROUPS`, field `group` trên 11 item, `getGroupedNav`.
- **Create** `src/features/navigation/navigation.test.ts` — Vitest cho `getGroupedNav`.
- **Modify** `src/hooks/use-role-gate.ts` — expose `groupedNav` (memoized).
- **Modify** `src/app/page.tsx` — render `groupedNav` thay cho 1 `SidebarSection`.

Không đụng: `sidebar.tsx`, `nav-item.tsx`, `sidebar-config-form.tsx`, `user-sidebar-config-modal.tsx`, DB.

---

### Task 1: navigation.ts grouping + tests (TDD)

**Files:**
- Test: `src/features/navigation/navigation.test.ts` (create)
- Modify: `src/features/navigation/navigation.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/navigation/navigation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Account, AppSettings, UserRole } from "@/lib/types";
import { getGroupedNav, NAV_GROUPS } from "./navigation";

const SETTINGS: AppSettings = { sidebar_defaults: {}, handover_default_tasks: [] };

function makeAccount(role: UserRole, sidebar_config: string[] | null = null): Account {
  return { id: "a1", auth_user_id: "u1", employee_id: null, role, status: "active", sidebar_config };
}

describe("getGroupedNav", () => {
  it("owner mặc định → đủ 6 nhóm, đúng thứ tự NAV_GROUPS", () => {
    const groups = getGroupedNav(makeAccount("owner"), SETTINGS);
    expect(groups).toHaveLength(6);
    expect(groups.map((g) => g.key)).toEqual(NAV_GROUPS.map((g) => g.key));
  });

  it("nhóm đúng item + thứ tự trong nhóm theo NAV_ITEMS", () => {
    const groups = getGroupedNav(makeAccount("owner"), SETTINGS);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.key)]));
    expect(byKey.overview).toEqual(["dashboard", "cashflow"]);
    expect(byKey.cashflow).toEqual(["expenses", "cash", "safe"]);
    expect(byKey.staff).toEqual(["shifts", "handover"]);
    expect(byKey.inventory).toEqual(["inventory"]);
    expect(byKey.reports).toEqual(["reports", "pivot"]);
    expect(byKey.system).toEqual(["settings"]);
  });

  it("view `cashflow` (Dòng tiền) ở nhóm overview, KHÔNG ở nhóm tên cashflow", () => {
    const groups = getGroupedNav(makeAccount("owner"), SETTINGS);
    const overview = groups.find((g) => g.key === "overview")!;
    const cashflowGroup = groups.find((g) => g.key === "cashflow")!;
    expect(overview.items.map((i) => i.key)).toContain("cashflow");
    expect(cashflowGroup.items.map((i) => i.key)).not.toContain("cashflow");
  });

  it("ẩn nhóm rỗng: employee_viewer (chỉ dashboard) → đúng 1 nhóm overview", () => {
    const groups = getGroupedNav(makeAccount("employee_viewer"), SETTINGS);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("overview");
    expect(groups[0].items.map((i) => i.key)).toEqual(["dashboard"]);
  });

  it("thứ tự trong nhóm theo NAV_ITEMS, KHÔNG theo thứ tự sidebar_config", () => {
    // config liệt kê safe trước cash — kết quả vẫn theo NAV_ITEMS (expenses, cash, safe)
    const acc = makeAccount("owner", ["dashboard", "safe", "cash", "expenses"]);
    const cashflow = getGroupedNav(acc, SETTINGS).find((g) => g.key === "cashflow")!;
    expect(cashflow.items.map((i) => i.key)).toEqual(["expenses", "cash", "safe"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/features/navigation/navigation.test.ts`
Expected: FAIL — `getGroupedNav` / `NAV_GROUPS` not exported (import error).

- [ ] **Step 3: Implement in `navigation.ts`**

3a. Add after the `ViewKey` type:

```ts
export type NavGroupKey =
  | "overview" | "cashflow" | "staff" | "inventory" | "reports" | "system";
```

3b. Add `group` to the `NavItem` interface:

```ts
export interface NavItem {
  key: ViewKey;
  label: string;
  icon: IconName;
  roles: ReadonlyArray<UserRole>;
  group: NavGroupKey;
}
```

3c. Add `group` to every item in `NAV_ITEMS` (per the taxonomy table — note `cashflow` view → `overview`):

```ts
export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: "dashboard", label: "Bảng vận hành", icon: "layoutDashboard", roles: ["owner", "manager", "staff_operator", "employee_viewer"], group: "overview" },
  { key: "expenses",  label: "Chi phí",       icon: "wallet",          roles: ["owner", "manager", "staff_operator"], group: "cashflow" },
  { key: "shifts",    label: "Ca & lương",    icon: "users",           roles: ["owner", "manager", "staff_operator"], group: "staff" },
  { key: "cash",      label: "Chốt két",      icon: "banknote",        roles: ["owner", "manager", "staff_operator"], group: "cashflow" },
  { key: "safe",      label: "Sổ quỹ",        icon: "piggyBank",       roles: ["owner"], group: "cashflow" },
  { key: "handover",  label: "Bàn giao",      icon: "clipboardList",   roles: ["owner", "manager", "staff_operator"], group: "staff" },
  { key: "inventory", label: "Kho",           icon: "package",         roles: ["owner", "manager", "staff_operator"], group: "inventory" },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"], group: "reports" },
  { key: "pivot",     label: "Pivot",         icon: "barChart3",       roles: ["owner", "manager"], group: "reports" },
  { key: "cashflow",  label: "Dòng tiền",     icon: "trendingUp",      roles: ["owner", "manager"], group: "overview" },
  { key: "settings",  label: "Thiết lập",     icon: "settings",        roles: ["owner", "manager"], group: "system" },
];
```

3d. Add groups + helper at the end of the file (after `canSee`):

```ts
export interface NavGroup {
  key: NavGroupKey;
  label: string;
}

// Thứ tự nhóm cố định — render theo đúng thứ tự mảng này.
export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  { key: "overview",  label: "Tổng quan" },
  { key: "cashflow",  label: "Thu – Chi – Quỹ" },
  { key: "staff",     label: "Nhân sự & Ca" },
  { key: "inventory", label: "Kho hàng" },
  { key: "reports",   label: "Báo cáo" },
  { key: "system",    label: "Thiết lập" },
];

export interface NavGroupWithItems extends NavGroup {
  items: ReadonlyArray<NavItem>;
}

export function getGroupedNav(
  account: Account | null,
  settings: AppSettings
): ReadonlyArray<NavGroupWithItems> {
  const visible = getVisibleNav(account, settings);
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: visible.filter((item) => item.group === group.key),
    }))
    .filter((group) => group.items.length > 0);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test:run -- src/features/navigation/navigation.test.ts`
Expected: PASS (5 tests).
Run: `npx tsc --noEmit`
Expected: PASS — field `group` bắt buộc nên TS ép gán đủ 11 item; nếu sót sẽ báo lỗi tại `NAV_ITEMS`.

- [ ] **Step 5: Commit**

```bash
git add src/features/navigation/navigation.ts src/features/navigation/navigation.test.ts
git commit -m "feat(nav): add functional groups + getGroupedNav to navigation"
```

---

### Task 2: Expose `groupedNav` from `useRoleGate`

**Files:**
- Modify: `src/hooks/use-role-gate.ts`

- [ ] **Step 1: Update imports** (add `getGroupedNav` + `NavGroupWithItems`):

```ts
import {
  getVisibleNav,
  getGroupedNav,
  canSee as canSeeFn,
  type NavItem,
  type NavGroupWithItems,
  type ViewKey,
} from "@/features/navigation/navigation";
```

- [ ] **Step 2: Add `groupedNav` to the result interface** (in `UseRoleGateResult`, after `visibleNav`):

```ts
  /** Visible nav partitioned into fixed functional groups (empty groups dropped). */
  groupedNav: ReadonlyArray<NavGroupWithItems>;
```

- [ ] **Step 3: Compute + return it** (after the `visibleNav` useMemo, before `defaultView`):

```ts
  const groupedNav = useMemo(
    () => getGroupedNav(account, effectiveSettings),
    [account, effectiveSettings]
  );
```

And add `groupedNav` to the returned object:

```ts
  return { visibleNav, groupedNav, defaultView, canSee };
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-role-gate.ts
git commit -m "feat(nav): expose groupedNav from useRoleGate"
```

---

### Task 3: Render grouped sidebar in `page.tsx` + verify

**Files:**
- Modify: `src/app/page.tsx` (line ~48 destructure; lines ~191–203 sidebar render)

- [ ] **Step 1: Destructure `groupedNav`** — change line 48 from:

```tsx
  const { visibleNav, defaultView, canSee } = useRoleGate(account, appSettingsQuery.data);
```

to (drop now-unused `visibleNav`, add `groupedNav`):

```tsx
  const { groupedNav, defaultView, canSee } = useRoleGate(account, appSettingsQuery.data);
```

- [ ] **Step 2: Replace the single-section render** — change the block at lines ~191–203 from:

```tsx
          <SidebarSection label="Vận hành">
            {visibleNav.map((item) => (
              <NavItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                active={view === item.key}
                onClick={() => handleNavClick(item.key)}
                onPointerEnter={() => handleNavHover(item.key)}
                onPointerLeave={() => handleNavHoverLeave(item.key)}
              />
            ))}
          </SidebarSection>
```

to (map over groups; **preserve `active`, `onClick`, and both prefetch handlers**):

```tsx
          {groupedNav.map((group) => (
            <SidebarSection key={group.key} label={group.label}>
              {group.items.map((item) => (
                <NavItem
                  key={item.key}
                  icon={item.icon}
                  label={item.label}
                  active={view === item.key}
                  onClick={() => handleNavClick(item.key)}
                  onPointerEnter={() => handleNavHover(item.key)}
                  onPointerLeave={() => handleNavHoverLeave(item.key)}
                />
              ))}
            </SidebarSection>
          ))}
```

- [ ] **Step 3: Verify (full)**

Run: `npx tsc --noEmit` → Expected: PASS (no unused `visibleNav`, all types resolve).
Run: `npm run test:run` → Expected: PASS (full suite incl. navigation.test.ts; nothing else broken).

- [ ] **Step 4: Manual eyeball** (dev server đã chạy ở 3009; KHÔNG `npm run build` khi 3009 đang chạy):
  - owner → thấy 6 nhóm theo thứ tự: Tổng quan (Bảng vận hành, Dòng tiền) · Thu – Chi – Quỹ (Chi phí, Chốt két, Sổ quỹ) · Nhân sự & Ca (Ca & lương, Bàn giao) · Kho hàng (Kho) · Báo cáo (Báo cáo chốt két, Pivot) · Thiết lập.
  - `employee_viewer` → chỉ thấy nhóm "Tổng quan" với 1 mục "Bảng vận hành".
  - Hover một mục vẫn prefetch (network tab thấy request sau ~200ms).

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(nav): render sidebar grouped by functional groups"
```

---

## Self-Review

**1. Spec coverage:**
- 6 nhóm + thứ tự cố định → `NAV_GROUPS` (Task 1.3d) + test "đúng thứ tự NAV_GROUPS". ✓
- field `group` trên 11 item → Task 1.3c + `tsc` ép phủ. ✓
- `getGroupedNav` reuse `getVisibleNav`, ẩn nhóm rỗng → Task 1.3d + test employee_viewer. ✓
- Label đồng nhất (kể cả nhóm 1 mục) → `SidebarSection label={group.label}` luôn truyền label (Task 3.2). ✓
- `cashflow` view → `overview` → taxonomy + test "không ở nhóm tên cashflow". ✓
- Thứ tự trong nhóm = `NAV_ITEMS` → test "không theo sidebar_config". ✓
- Không đụng form/sidebar.tsx/nav-item.tsx/DB → chỉ 4 file trên. ✓

**2. Placeholder scan:** không có TBD/TODO; mọi step có code/command + expected. ✓

**3. Type consistency:** `getGroupedNav`, `NAV_GROUPS`, `NavGroupKey`, `NavGroupWithItems`, `groupedNav` đồng nhất giữa navigation.ts ↔ test ↔ use-role-gate ↔ page.tsx. `NavItem.group: NavGroupKey` khớp giá trị gán. ✓

**4. Ambiguity:** in-group order (NAV_ITEMS) + cashflow→overview đã chốt rõ. ✓

## Rủi ro / lưu ý
- `getVisibleNav`/`canSee` không đổi → các consumer khác (topbar) không ảnh hưởng. `defaultView` vẫn từ `visibleNav[0]` (dashboard).
- KHÔNG chạy `npm run build` khi `next dev` (3009) đang chạy — clobber `.next` → 404 chunks. Build sạch: kill 3009 → `rm -rf .next` → restart.
