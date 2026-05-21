# Phase 3C.2 — Settings Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the owner/manager-only Settings module — sidebar config per-role matrix (auto-save), per-user sidebar override (modal-based Save), and handover default tasks editor (list + inline edit + add/remove with slugified Vietnamese keys).

**Architecture:** All Phase 1 backend RPCs, data-layer functions, query hooks, types, and NAV_ITEMS are already plumbed and frozen. This phase adds: 1 slugify helper, 3 mutation hooks, 5 feature files, page.tsx dispatcher wire. Owner/manager gate via NAV_ITEMS (already in place) + defense-in-depth gate in SettingsView. Auto-save on role-matrix toggles; explicit Save for per-user override modal; full-array mutation for handover task list operations.

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict, TanStack Query 5, Radix UI (Dialog, Checkbox, Select), Tailwind v4, Supabase JS, Vietnamese (vi) UI labels.

---

## File Structure

**New files (6):**
- `src/features/settings/task-key.ts` — slugifyTaskKey helper
- `src/hooks/mutations/use-settings-mutations.ts` — 3 mutation hooks
- `src/features/settings/settings-view.tsx` — owner/manager container
- `src/features/settings/sidebar-config-form.tsx` — role matrix + per-user sub-section
- `src/features/settings/user-sidebar-config-modal.tsx` — nested modal for per-user override
- `src/features/settings/handover-default-tasks-editor.tsx` — list + add/edit/remove

**Modified files (1):**
- `src/app/page.tsx` — swap `view === "settings"` placeholder with `<SettingsView role={account.role} />`

**Off-limits:** `database/**`, `src/lib/data/{app-settings,handover,accounts}.ts`, `src/lib/types.ts`, `src/hooks/queries/use-app-settings-query.ts`, `src/hooks/queries/use-account-query.ts`, `src/features/navigation/navigation.ts`, all prior-phase feature modules, all Phase 2 primitives, `docker-compose.yml`, `.env*`, `vitest.config.mts`, `tsconfig.json`.

---

## Key reference signatures (from existing code)

```ts
// src/lib/data/app-settings.ts — DO NOT MODIFY
loadAppSettings(supabase) → AppSettings
updateSidebarDefaults(supabase, role: string, items: string[]) → sidebar_defaults
updateUserSidebarConfig(supabase, profileId: string, items: string[] | null) → unknown

// src/lib/data/handover.ts — DO NOT MODIFY
updateHandoverDefaultTasks(supabase, tasks: Array<{key: string; label: string}>) → tasks

// src/lib/types.ts — DO NOT MODIFY
type UserRole = "owner" | "manager" | "staff_operator" | "employee_viewer"
type AppSettings = {
  sidebar_defaults: Partial<Record<UserRole, string[]>>;
  handover_default_tasks: Array<{ key: string; label: string }>;
  denominations?: number[];
  cash_diff_threshold?: Record<string, number>;
}
type SettingsAccount = {
  id: string;
  auth_user_id: string;
  role: UserRole;
  status: string;
  employee_name: string | null;
  employee_position: string | null;
  sidebar_config: string[] | null;
}

// src/features/navigation/navigation.ts — DO NOT MODIFY
NAV_ITEMS: { key: ViewKey; label: string; icon: IconName; roles: UserRole[] }[]
  // 8 items total. key === "settings" has roles: ["owner", "manager"]
DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ViewKey[]>
ROLE_LABELS: Record<UserRole, string>  // "Chủ quán" / "Quản lý" / "Nhân viên vận hành" / "Viewer"
type ViewKey = "dashboard" | "expenses" | "shifts" | "cash" | "safe" | "reports" | "pivot" | "settings"

// src/hooks/queries/keys.ts — already has these
queryKeys.appSettings()           // ["app-settings"]
queryKeys.settingsAccounts()      // ["settings-accounts"]
queryKeys.account()                // ["account"]
```

**Checkbox API** (from `src/components/ui/checkbox.tsx`):
```ts
<Checkbox
  label="..."                                   // optional ReactNode
  checked={boolean | "indeterminate"}           // Radix CheckedState
  onCheckedChange={(checked) => ...}            // CheckedState param
  disabled={boolean}
/>
```

---

### Task 1: slugifyTaskKey helper + use-settings-mutations.ts (3 hooks)

**Files:**
- Create: `src/features/settings/task-key.ts`
- Create: `src/hooks/mutations/use-settings-mutations.ts`

- [ ] **Step 1: Create `src/features/settings/task-key.ts`**

```ts
/**
 * Slugify a Vietnamese label into a stable task key for handover defaults.
 *
 * Strips diacritics (NFD + combining mark removal), maps Vietnamese đ → d,
 * lowercases, replaces non-alphanum with underscores, trims leading/trailing
 * underscores, and caps at 40 chars. If the result is empty (label was all
 * special chars), returns "task".
 *
 * Optional `existingKeys` set: if the slug collides, appends "_2", "_3", ...
 * until unique.
 *
 * Examples:
 *   "Đếm doanh thu cuối ngày" → "dem_doanh_thu_cuoi_ngay"
 *   "Khóa két - giao ca"      → "khoa_ket_giao_ca"
 *   ""                         → "task"
 *   "Đếm" with {"dem"} present → "dem_2"
 */
export function slugifyTaskKey(
  label: string,
  existingKeys?: ReadonlySet<string>
): string {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // strip combining diacritics
      .replace(/đ/g, "d")
      .replace(/Đ/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "task";

  if (!existingKeys || !existingKeys.has(base)) return base;

  let n = 2;
  while (existingKeys.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
```

- [ ] **Step 2: Create `src/hooks/mutations/use-settings-mutations.ts`**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  updateSidebarDefaults,
  updateUserSidebarConfig,
  updateHandoverDefaultTasks
} from "@/lib/data";
import type { UserRole } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the Settings module — Phase 3C.2.
 *
 * Pattern matches use-cash-mutations.ts: null-supabase guard, useMutation,
 * invalidate dependent query keys on success. No optimistic updates.
 *
 * 3 hooks total:
 *   - useUpdateSidebarDefaults: role matrix toggle (auto-save per cell)
 *   - useUpdateUserSidebarConfig: per-user override (modal explicit Save)
 *   - useUpdateHandoverDefaultTasks: handover template list (full-array writes)
 */

export interface UpdateSidebarDefaultsInput {
  role: UserRole;
  items: string[];
}

export function useUpdateSidebarDefaults(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSidebarDefaultsInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateSidebarDefaults(supabase, input.role, input.items);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
    }
  });
}

export interface UpdateUserSidebarConfigInput {
  profileId: string;
  items: string[] | null; // null = reset to role default
}

export function useUpdateUserSidebarConfig(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserSidebarConfigInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateUserSidebarConfig(supabase, input.profileId, input.items);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
    }
  });
}

export interface UpdateHandoverDefaultTasksInput {
  tasks: Array<{ key: string; label: string }>;
}

export function useUpdateHandoverDefaultTasks(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverDefaultTasksInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverDefaultTasks(supabase, input.tasks);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
    }
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Run verify:phase**

```bash
npm run verify:phase
```

Expected: 75 Vitest + 50 pgTAP = 125 green, exit 0.

- [ ] **Step 5: Commit using `.git/COMMIT_MSG_TMP` file pattern**

Write to `.git/COMMIT_MSG_TMP`:

```
feat(phase-3c2): slugifyTaskKey + use-settings-mutations (3 hooks)

- src/features/settings/task-key.ts: Vietnamese-aware slugify with
  collision resolution. Strips diacritics (NFD), maps đ→d, lowercases,
  non-alphanum→_, max 40 chars. Examples: "Đếm doanh thu" → "dem_doanh_thu".
- src/hooks/mutations/use-settings-mutations.ts: 3 hooks following
  use-cash-mutations.ts template.
  - useUpdateSidebarDefaults: invalidates appSettings + account
  - useUpdateUserSidebarConfig: invalidates settingsAccounts + account
  - useUpdateHandoverDefaultTasks: invalidates appSettings

Verify:phase still 125/125 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then:

```bash
git add src/features/settings/task-key.ts src/hooks/mutations/use-settings-mutations.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 2: SidebarConfigForm — role matrix only (per-user sub-section in T3)

**Files:**
- Create: `src/features/settings/sidebar-config-form.tsx`

This task implements ONLY the role-matrix half of SidebarConfigForm. The per-user sub-section is added in T3 (after the modal exists).

- [ ] **Step 1: Create `src/features/settings/sidebar-config-form.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateSidebarDefaults } from "@/hooks/mutations/use-settings-mutations";
import {
  NAV_ITEMS,
  DEFAULT_SIDEBAR_BY_ROLE,
  ROLE_LABELS
} from "@/features/navigation/navigation";
import type { AppSettings, SettingsAccount, UserRole, ViewKey } from "@/lib/types";

interface SidebarConfigFormProps {
  sidebarDefaults: AppSettings["sidebar_defaults"];
  accounts: SettingsAccount[];
  currentUserAuthId: string;
}

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];

/**
 * Sidebar config: role-matrix section (top) + per-user override sub-section (T3).
 *
 * Role matrix: 4 columns × 8 rows of checkboxes driven by sidebar_defaults
 * (with DEFAULT_SIDEBAR_BY_ROLE fallback). Each toggle fires
 * useUpdateSidebarDefaults with the FULL new items array for that role.
 *
 * Hard floor: cells where NAV_ITEMS[i].roles does NOT include the role are
 * disabled + grayed out. Defense-in-depth against accidentally granting
 * access beyond what the role can have.
 *
 * Self-lock-out guard: the "settings" cell for the current user's role is
 * permanently checked + disabled, preventing owner/manager from accidentally
 * hiding Settings for themselves.
 *
 * Auto-save: while a mutation for a role is pending, that entire column is
 * disabled.
 */
export function SidebarConfigForm({
  sidebarDefaults,
  accounts: _accounts, // used in T3
  currentUserAuthId: _currentUserAuthId // used in T3
}: SidebarConfigFormProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateSidebarDefaults(supabase);

  // Track which role's column is currently saving (for column-level disable).
  const [savingRole, setSavingRole] = useState<UserRole | null>(null);

  // Find current user's role (used for self-lock-out guard).
  const currentUserRole = _accounts.find((a) => a.auth_user_id === _currentUserAuthId)?.role ?? null;

  function getItemsForRole(role: UserRole): string[] {
    const fromSettings = sidebarDefaults[role];
    if (fromSettings && fromSettings.length > 0) return fromSettings;
    return [...DEFAULT_SIDEBAR_BY_ROLE[role]];
  }

  async function handleToggle(role: UserRole, navKey: ViewKey, checked: boolean) {
    const current = getItemsForRole(role);
    const next = checked
      ? Array.from(new Set([...current, navKey]))
      : current.filter((k) => k !== navKey);

    setSavingRole(role);
    try {
      await updateM.mutateAsync({ role, items: next });
      toast({
        semantic: "success",
        message: `Đã cập nhật sidebar mặc định cho ${ROLE_LABELS[role]}.`
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không cập nhật được sidebar."
      });
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Sidebar mặc định theo role</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Tick / bỏ tick để hiển thị mục sidebar cho từng role. Tự động lưu khi thay đổi.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <AlertBanner variant="info">
          Mỗi role chỉ thấy được những mục mà NAV_ITEMS cho phép. Các ô bị tắt
          (xám) là mục role đó không có quyền vào — không thể bật. Mục
          &quot;Thiết lập&quot; cho role của bạn được khóa để tránh tự khóa mình.
        </AlertBanner>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted">
                  Mục sidebar
                </th>
                {ROLES.map((role) => (
                  <th
                    key={role}
                    className="text-center py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted"
                  >
                    {ROLE_LABELS[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NAV_ITEMS.map((item) => (
                <tr key={item.key} className="border-b border-border last:border-0">
                  <td className="py-3 pr-4 text-sm text-ink">{item.label}</td>
                  {ROLES.map((role) => {
                    const allowedByNav = item.roles.includes(role);
                    const isCurrentUserRole = role === currentUserRole;
                    const isSelfLockSettings = item.key === "settings" && isCurrentUserRole;
                    const currentItems = getItemsForRole(role);
                    const isChecked = allowedByNav && currentItems.includes(item.key);
                    const isColumnSaving = savingRole === role;

                    return (
                      <td key={role} className="text-center py-3 px-2">
                        <div className="inline-flex justify-center">
                          <Checkbox
                            checked={isSelfLockSettings ? true : isChecked}
                            onCheckedChange={(checked) =>
                              handleToggle(role, item.key, checked === true)
                            }
                            disabled={!allowedByNav || isSelfLockSettings || isColumnSaving}
                            aria-label={`${ROLE_LABELS[role]} - ${item.label}`}
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors. The `_accounts` and `_currentUserAuthId` prefix marks props as intentionally unused in this task (used in T3).

- [ ] **Step 3: Commit**

Write to `.git/COMMIT_MSG_TMP`:

```
feat(phase-3c2): SidebarConfigForm — role matrix (per-user sub-section in T3)

- 4-column × 8-row matrix of checkboxes (4 roles × NAV_ITEMS)
- Auto-save: each toggle fires useUpdateSidebarDefaults with the FULL
  updated items array for that role; column disabled during save
- Hard floor: cells where NAV_ITEMS[i].roles excludes the role are
  disabled + grayed out (e.g., Sổ quỹ for non-owner)
- Self-lock-out guard: Thiết lập for the current user's role is
  permanently checked + disabled to prevent self-lock-out
- AlertBanner explains the disabled-cell semantics

Per-user override sub-section added in T3.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then:

```bash
git add src/features/settings/sidebar-config-form.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 3: UserSidebarConfigModal + per-user override sub-section

**Files:**
- Create: `src/features/settings/user-sidebar-config-modal.tsx`
- Modify: `src/features/settings/sidebar-config-form.tsx` (add per-user sub-section + modal mount)

- [ ] **Step 1: Create `src/features/settings/user-sidebar-config-modal.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateUserSidebarConfig } from "@/hooks/mutations/use-settings-mutations";
import {
  NAV_ITEMS,
  DEFAULT_SIDEBAR_BY_ROLE,
  ROLE_LABELS
} from "@/features/navigation/navigation";
import type { AppSettings, SettingsAccount, ViewKey } from "@/lib/types";

interface UserSidebarConfigModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  account: SettingsAccount | null;
  sidebarDefaults: AppSettings["sidebar_defaults"];
  currentUserAuthId: string;
}

/**
 * Per-user sidebar override modal.
 *
 * Explicit Save model: user toggles multiple checkboxes, then clicks Lưu
 * (commit) or Reset (clear override). Auto-save would clutter the toast
 * feed for batch operations.
 *
 * Hard floor: only NAV_ITEMS where account.role is allowed are listed.
 *
 * Self-lock-out guard: if account is the current user, "Thiết lập" is
 * permanently checked + disabled.
 *
 * Reset flow: if account.sidebar_config !== null, shows inline AlertBanner
 * confirm before firing reset mutation.
 */
export function UserSidebarConfigModal({
  open,
  onOpenChange,
  account,
  sidebarDefaults,
  currentUserAuthId
}: UserSidebarConfigModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateUserSidebarConfig(supabase);

  const [selectedKeys, setSelectedKeys] = useState<ReadonlyArray<string>>([]);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Initialize state when modal opens with a new account.
  useEffect(() => {
    if (!open || !account) return;
    const initial =
      account.sidebar_config ??
      sidebarDefaults[account.role] ??
      DEFAULT_SIDEBAR_BY_ROLE[account.role];
    setSelectedKeys([...initial]);
    setConfirmingReset(false);
  }, [open, account, sidebarDefaults]);

  if (!account) return null;

  const allowedItems = NAV_ITEMS.filter((item) => item.roles.includes(account.role));
  const isSelf = account.auth_user_id === currentUserAuthId;
  const hasOverride = account.sidebar_config !== null;
  const isBusy = updateM.isPending;

  function handleToggle(navKey: ViewKey, checked: boolean) {
    setSelectedKeys((current) =>
      checked
        ? Array.from(new Set([...current, navKey]))
        : current.filter((k) => k !== navKey)
    );
  }

  async function handleSave() {
    if (!account || isBusy) return;
    try {
      await updateM.mutateAsync({
        profileId: account.id,
        items: [...selectedKeys]
      });
      toast({
        semantic: "success",
        message: `Đã lưu sidebar riêng cho ${account.employee_name ?? "tài khoản"}.`
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được sidebar cá nhân."
      });
    }
  }

  async function handleConfirmReset() {
    if (!account || isBusy) return;
    try {
      await updateM.mutateAsync({ profileId: account.id, items: null });
      toast({
        semantic: "success",
        message: `Đã reset sidebar cho ${account.employee_name ?? "tài khoản"} về mặc định role.`
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không reset được sidebar."
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>
          Sidebar cá nhân — {account.employee_name ?? "(chưa có tên)"}
        </ModalTitle>
        <ModalDescription>
          <Badge variant="soft" semantic="neutral">{ROLE_LABELS[account.role]}</Badge>
          {hasOverride && (
            <Badge variant="soft" semantic="warning" className="ml-2">
              Đang có override
            </Badge>
          )}
        </ModalDescription>

        {confirmingReset ? (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="warning">
              Reset sẽ xóa override hiện tại — tài khoản này quay về sidebar mặc định
              cho role {ROLE_LABELS[account.role]}. Tiếp tục?
            </AlertBanner>
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setConfirmingReset(false)} disabled={isBusy}>
                Hủy reset
              </Button>
              <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirmReset}>
                Xác nhận reset
              </Button>
            </ModalActions>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="info">
              Override sẽ ghi đè default cho role này. Click &quot;Reset về mặc định role&quot;
              để dùng lại default.
              {isSelf && (
                <> Mục &quot;Thiết lập&quot; bị khóa cho tài khoản hiện tại để tránh tự khóa mình.</>
              )}
            </AlertBanner>

            <div className="space-y-2">
              {allowedItems.map((item) => {
                const isSelfLockSettings = item.key === "settings" && isSelf;
                const isChecked = isSelfLockSettings ? true : selectedKeys.includes(item.key);
                return (
                  <div key={item.key} className="flex items-center gap-3 p-2 rounded-md hover:bg-surface-muted">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => handleToggle(item.key, checked === true)}
                      disabled={isSelfLockSettings || isBusy}
                      label={item.label}
                    />
                  </div>
                );
              })}
            </div>

            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Đóng
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingReset(true)}
                disabled={!hasOverride || isBusy}
                title={!hasOverride ? "Đã dùng default rồi" : undefined}
              >
                Reset về mặc định role
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={isBusy}
                onClick={handleSave}
              >
                Lưu
              </Button>
            </ModalActions>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Modify `src/features/settings/sidebar-config-form.tsx` to add per-user sub-section + mount modal**

Open the file. The current implementation has the role matrix but `_accounts` and `_currentUserAuthId` are unused (prefixed). Now we use them.

Replace the file content with the FULL updated version below (key changes: remove `_` prefixes, add per-user sub-section, mount UserSidebarConfigModal):

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateSidebarDefaults } from "@/hooks/mutations/use-settings-mutations";
import {
  NAV_ITEMS,
  DEFAULT_SIDEBAR_BY_ROLE,
  ROLE_LABELS
} from "@/features/navigation/navigation";
import type { AppSettings, SettingsAccount, UserRole, ViewKey } from "@/lib/types";
import { UserSidebarConfigModal } from "./user-sidebar-config-modal";

interface SidebarConfigFormProps {
  sidebarDefaults: AppSettings["sidebar_defaults"];
  accounts: SettingsAccount[];
  currentUserAuthId: string;
}

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];

/**
 * Sidebar config form — composed of two sections:
 *   1. Role matrix (4 columns × 8 rows of Checkboxes, auto-save per toggle)
 *   2. Per-user override sub-section (list of accounts + "Sửa" → modal)
 *
 * Hard floor: cells where NAV_ITEMS[i].roles excludes the role are disabled.
 * Self-lock-out guard: "Thiết lập" for the current user's role is locked checked.
 */
export function SidebarConfigForm({
  sidebarDefaults,
  accounts,
  currentUserAuthId
}: SidebarConfigFormProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateSidebarDefaults(supabase);

  const [savingRole, setSavingRole] = useState<UserRole | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<SettingsAccount | null>(null);

  const currentUserRole = accounts.find((a) => a.auth_user_id === currentUserAuthId)?.role ?? null;

  function getItemsForRole(role: UserRole): string[] {
    const fromSettings = sidebarDefaults[role];
    if (fromSettings && fromSettings.length > 0) return fromSettings;
    return [...DEFAULT_SIDEBAR_BY_ROLE[role]];
  }

  async function handleToggle(role: UserRole, navKey: ViewKey, checked: boolean) {
    const current = getItemsForRole(role);
    const next = checked
      ? Array.from(new Set([...current, navKey]))
      : current.filter((k) => k !== navKey);

    setSavingRole(role);
    try {
      await updateM.mutateAsync({ role, items: next });
      toast({
        semantic: "success",
        message: `Đã cập nhật sidebar mặc định cho ${ROLE_LABELS[role]}.`
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không cập nhật được sidebar."
      });
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sidebar mặc định theo role</CardTitle>
            <p className="mt-1 text-xs text-muted">
              Tick / bỏ tick để hiển thị mục sidebar cho từng role. Tự động lưu khi thay đổi.
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <AlertBanner variant="info">
            Mỗi role chỉ thấy được những mục mà NAV_ITEMS cho phép. Các ô bị tắt
            (xám) là mục role đó không có quyền vào — không thể bật. Mục
            &quot;Thiết lập&quot; cho role của bạn được khóa để tránh tự khóa mình.
          </AlertBanner>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted">
                    Mục sidebar
                  </th>
                  {ROLES.map((role) => (
                    <th
                      key={role}
                      className="text-center py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted"
                    >
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NAV_ITEMS.map((item) => (
                  <tr key={item.key} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 text-sm text-ink">{item.label}</td>
                    {ROLES.map((role) => {
                      const allowedByNav = item.roles.includes(role);
                      const isCurrentUserRole = role === currentUserRole;
                      const isSelfLockSettings = item.key === "settings" && isCurrentUserRole;
                      const currentItems = getItemsForRole(role);
                      const isChecked = allowedByNav && currentItems.includes(item.key);
                      const isColumnSaving = savingRole === role;

                      return (
                        <td key={role} className="text-center py-3 px-2">
                          <div className="inline-flex justify-center">
                            <Checkbox
                              checked={isSelfLockSettings ? true : isChecked}
                              onCheckedChange={(checked) =>
                                handleToggle(role, item.key, checked === true)
                              }
                              disabled={!allowedByNav || isSelfLockSettings || isColumnSaving}
                              aria-label={`${ROLE_LABELS[role]} - ${item.label}`}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tùy chỉnh sidebar cho từng nhân viên</CardTitle>
            <p className="mt-1 text-xs text-muted">
              Override sidebar mặc định của role cho từng tài khoản cụ thể.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {accounts.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có tài khoản nào"
              subtitle="Tài khoản nhân viên hiện ra ở đây sau khi được kích hoạt."
            />
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => {
                const hasOverride = account.sidebar_config !== null;
                const overrideCount = account.sidebar_config?.length ?? 0;
                const displayName = account.employee_name ?? "(chưa có tên)";
                const isSelf = account.auth_user_id === currentUserAuthId;

                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 rounded-md border border-border bg-surface"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {displayName}
                          {isSelf && (
                            <span className="ml-2 text-xs text-muted">(bạn)</span>
                          )}
                        </p>
                        {account.employee_position && (
                          <p className="text-xs text-muted">{account.employee_position}</p>
                        )}
                      </div>
                      <Badge variant="soft" semantic="neutral">
                        {ROLE_LABELS[account.role]}
                      </Badge>
                      {hasOverride && (
                        <Badge variant="soft" semantic="warning">
                          Override: {overrideCount} mục
                        </Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelectedAccount(account)}
                    >
                      Sửa
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <UserSidebarConfigModal
        open={selectedAccount !== null}
        onOpenChange={(open) => { if (!open) setSelectedAccount(null); }}
        account={selectedAccount}
        sidebarDefaults={sidebarDefaults}
        currentUserAuthId={currentUserAuthId}
      />
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit**

Write to `.git/COMMIT_MSG_TMP`:

```
feat(phase-3c2): UserSidebarConfigModal + per-user sub-section integration

UserSidebarConfigModal:
- Nested modal (sibling Modal Root)
- Initialized with account.sidebar_config ?? sidebarDefaults[role] ?? DEFAULT
- Checkbox list filtered by NAV_ITEMS[i].roles.includes(account.role)
- Self-lock-out guard: "Thiết lập" locked checked if account is current user
- Explicit Save model (batch toggle then commit)
- Reset confirmation flow: inline AlertBanner + 2 buttons if hasOverride
- Disabled "Reset" if no override exists

SidebarConfigForm (modified):
- Per-user sub-section added below role matrix
- Per-account row: name + position + role Badge + Override badge + Sửa button
- "(bạn)" marker on current user's row
- EmptyState if no accounts
- Mounts UserSidebarConfigModal on Sửa click

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then:

```bash
git add src/features/settings/user-sidebar-config-modal.tsx src/features/settings/sidebar-config-form.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 4: HandoverDefaultTasksEditor

**Files:**
- Create: `src/features/settings/handover-default-tasks-editor.tsx`

- [ ] **Step 1: Create `src/features/settings/handover-default-tasks-editor.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Icon } from "@/components/ui/icons";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateHandoverDefaultTasks } from "@/hooks/mutations/use-settings-mutations";
import { slugifyTaskKey } from "./task-key";

interface HandoverDefaultTasksEditorProps {
  tasks: ReadonlyArray<{ key: string; label: string }>;
}

const MIN_LABEL_LEN = 2;
const MAX_LABEL_LEN = 200;

/**
 * Editor for handover_default_tasks (the template seeded into each new
 * handover_session via get_or_create_handover_session RPC).
 *
 * Operations:
 *   - Add: TextField + Thêm button → slugifyTaskKey produces key →
 *     mutation with [...current, {key, label}]
 *   - Edit label: per-row "Sửa" toggles inline TextField → Lưu fires
 *     mutation with updated array (key remains immutable — only label changes)
 *   - Delete: per-row "✕" → inline AlertBanner confirm → mutation with
 *     filtered array
 *
 * Editing an entry does NOT regenerate the key — keys are immutable once
 * created to avoid breaking any in-flight sessions that snapshot tasks at
 * create time.
 *
 * Only one row can be in edit mode at a time. Same for delete-confirm.
 */
export function HandoverDefaultTasksEditor({ tasks }: HandoverDefaultTasksEditorProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateHandoverDefaultTasks(supabase);

  const [newLabel, setNewLabel] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const existingKeys = useMemo(
    () => new Set(tasks.map((t) => t.key)),
    [tasks]
  );

  const newLabelTrimmed = newLabel.trim();
  const newLabelValid =
    newLabelTrimmed.length >= MIN_LABEL_LEN && newLabelTrimmed.length <= MAX_LABEL_LEN;
  const newKeyPreview = newLabelValid ? slugifyTaskKey(newLabelTrimmed, existingKeys) : "";

  const editingLabelTrimmed = editingLabel.trim();
  const editingValid =
    editingLabelTrimmed.length >= MIN_LABEL_LEN && editingLabelTrimmed.length <= MAX_LABEL_LEN;

  const isBusy = updateM.isPending;

  async function handleAdd() {
    if (!newLabelValid || isBusy) return;
    const key = slugifyTaskKey(newLabelTrimmed, existingKeys);
    try {
      await updateM.mutateAsync({
        tasks: [...tasks, { key, label: newLabelTrimmed }]
      });
      toast({ semantic: "success", message: `Đã thêm "${newLabelTrimmed}".` });
      setNewLabel("");
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không thêm được mục."
      });
    }
  }

  function handleStartEdit(key: string, label: string) {
    setEditingKey(key);
    setEditingLabel(label);
    setDeletingKey(null);
  }

  function handleCancelEdit() {
    setEditingKey(null);
    setEditingLabel("");
  }

  async function handleSaveEdit() {
    if (!editingKey || !editingValid || isBusy) return;
    try {
      await updateM.mutateAsync({
        tasks: tasks.map((t) =>
          t.key === editingKey ? { ...t, label: editingLabelTrimmed } : t
        )
      });
      toast({ semantic: "success", message: "Đã sửa nhãn." });
      setEditingKey(null);
      setEditingLabel("");
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được."
      });
    }
  }

  function handleStartDelete(key: string) {
    setDeletingKey(key);
    setEditingKey(null);
  }

  function handleCancelDelete() {
    setDeletingKey(null);
  }

  async function handleConfirmDelete() {
    if (!deletingKey || isBusy) return;
    try {
      await updateM.mutateAsync({
        tasks: tasks.filter((t) => t.key !== deletingKey)
      });
      toast({ semantic: "success", message: "Đã xóa mục." });
      setDeletingKey(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không xóa được."
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Checklist mặc định cuối ngày</CardTitle>
          <p className="mt-1 text-xs text-muted">
            Các mục checkbox tự động tạo cho mỗi handover session mới. Sửa nhãn
            không ảnh hưởng session đã tạo (chúng snapshot lúc create).
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {tasks.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title="Chưa có mục nào"
            subtitle="Thêm mục đầu tiên ở dưới."
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => {
              const isEditing = editingKey === task.key;
              const isDeletingThis = deletingKey === task.key;

              if (isDeletingThis) {
                return (
                  <div key={task.key} className="rounded-md border border-border p-3 space-y-2">
                    <AlertBanner variant="warning">
                      Xóa &quot;{task.label}&quot;? Mục này sẽ không xuất hiện trong các handover
                      session mới. (Session đã tạo sẽ giữ nguyên — snapshot tại thời điểm tạo.)
                    </AlertBanner>
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={handleCancelDelete} disabled={isBusy}>
                        Hủy
                      </Button>
                      <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirmDelete}>
                        Xác nhận xóa
                      </Button>
                    </div>
                  </div>
                );
              }

              if (isEditing) {
                return (
                  <div key={task.key} className="flex items-center gap-2 p-2 rounded-md border border-border bg-surface">
                    <div className="flex-1">
                      <TextField
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        disabled={isBusy}
                        maxLength={MAX_LABEL_LEN}
                        autoFocus
                        helper={`Key: ${task.key} (không đổi)`}
                        error={
                          editingLabelTrimmed.length > 0 && !editingValid
                            ? `Tên phải từ ${MIN_LABEL_LEN} đến ${MAX_LABEL_LEN} ký tự.`
                            : undefined
                        }
                      />
                    </div>
                    <Button type="button" variant="ghost" onClick={handleCancelEdit} disabled={isBusy}>
                      Hủy
                    </Button>
                    <Button type="button" variant="primary" loading={isBusy} onClick={handleSaveEdit} disabled={!editingValid}>
                      Lưu
                    </Button>
                  </div>
                );
              }

              return (
                <div
                  key={task.key}
                  className="flex items-center justify-between p-3 rounded-md border border-border bg-surface"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon name="checkCircle" size={16} />
                    <div className="min-w-0">
                      <p className="text-sm text-ink truncate">{task.label}</p>
                      <p className="text-xs text-muted truncate">Key: {task.key}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleStartEdit(task.key, task.label)}
                      disabled={isBusy}
                    >
                      Sửa
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleStartDelete(task.key)}
                      disabled={isBusy}
                      aria-label={`Xóa ${task.label}`}
                    >
                      <Icon name="trash" size={16} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="border-t border-border pt-4">
          <p className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
            Thêm mục mới
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <TextField
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="VD: Đếm doanh thu cuối ngày"
                disabled={isBusy}
                maxLength={MAX_LABEL_LEN}
                helper={
                  newLabelTrimmed.length === 0
                    ? "Nhập tên mục (tối thiểu 2 ký tự)"
                    : newLabelValid
                      ? `Key sẽ là: ${newKeyPreview}`
                      : `Tên phải từ ${MIN_LABEL_LEN} đến ${MAX_LABEL_LEN} ký tự.`
                }
                error={
                  newLabelTrimmed.length > 0 && !newLabelValid
                    ? `Tên phải từ ${MIN_LABEL_LEN} đến ${MAX_LABEL_LEN} ký tự.`
                    : undefined
                }
              />
            </div>
            <Button
              type="button"
              variant="primary"
              loading={isBusy}
              disabled={!newLabelValid}
              onClick={handleAdd}
              leadingIcon={<Icon name="plus" size={16} />}
            >
              Thêm
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors. If `checkCircle` icon is not in the set, swap for `check`. Verify by reading `src/components/ui/icons.tsx`.

- [ ] **Step 3: Commit**

Write to `.git/COMMIT_MSG_TMP`:

```
feat(phase-3c2): HandoverDefaultTasksEditor — list + inline edit + add/delete

- Existing rows: label + key (immutable) + Sửa + ✕ delete buttons
- Inline edit mode: TextField replaces label + Lưu/Hủy buttons
  Editing label does NOT regenerate key (immutable once created — avoids
  breaking in-flight sessions that snapshot at create)
- Inline delete confirm: AlertBanner.warning + Hủy/destructive Xác nhận xóa
- Add row: TextField (helper shows live slugified key preview) + Thêm button
  slugifyTaskKey runs with existingKeys set for collision resolution
- Validation: label length 2..200 chars; Add/Lưu disabled if invalid
- Only one row can be in edit OR delete mode at a time

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then:

```bash
git add src/features/settings/handover-default-tasks-editor.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 5: SettingsView container + page.tsx wire + verify + tag

**Files:**
- Create: `src/features/settings/settings-view.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create `src/features/settings/settings-view.tsx`**

```tsx
"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useAppSettingsQuery,
  useSettingsAccountsQuery,
  useAccountQuery
} from "@/hooks/queries";
import type { UserRole } from "@/lib/types";
import { SidebarConfigForm } from "./sidebar-config-form";
import { HandoverDefaultTasksEditor } from "./handover-default-tasks-editor";

interface SettingsViewProps {
  role: UserRole;
}

/**
 * Owner/manager-only Settings container.
 *
 * Defense-in-depth: NAV_ITEMS already gates `settings` to owner+manager, but
 * render an EmptyState fallback if somehow reached as another role.
 *
 * Composes:
 *   - SidebarConfigForm (role matrix + per-user override sub-section)
 *   - HandoverDefaultTasksEditor (list editor)
 */
export function SettingsView({ role }: SettingsViewProps) {
  const supabase = useSupabase();
  const isEnabled = role === "owner" || role === "manager";

  const appSettingsQuery = useAppSettingsQuery(supabase, isEnabled);
  const settingsAccountsQuery = useSettingsAccountsQuery(supabase, isEnabled);
  const accountQuery = useAccountQuery(supabase, isEnabled);

  if (!isEnabled) {
    return (
      <EmptyState
        icon="lock"
        title="Thiết lập owner/manager only"
        subtitle="Module này dành cho owner và manager."
      />
    );
  }

  const isLoading =
    appSettingsQuery.isLoading ||
    settingsAccountsQuery.isLoading ||
    accountQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  const appSettings = appSettingsQuery.data;
  const accounts = settingsAccountsQuery.data ?? [];
  const currentAccount = accountQuery.data;

  if (!appSettings || !currentAccount) {
    return (
      <EmptyState
        icon="alertTriangle"
        title="Không tải được cấu hình"
        subtitle="Vui lòng tải lại trang."
      />
    );
  }

  return (
    <div className="space-y-6">
      <SidebarConfigForm
        sidebarDefaults={appSettings.sidebar_defaults}
        accounts={accounts}
        currentUserAuthId={currentAccount.auth_user_id}
      />
      <HandoverDefaultTasksEditor tasks={appSettings.handover_default_tasks} />
    </div>
  );
}
```

- [ ] **Step 2: Modify `src/app/page.tsx` to wire SettingsView**

Read `src/app/page.tsx`. Find the import block near the top:

```tsx
import { SafeView } from "@/features/safe/safe-view";
```

Add SettingsView import right after:

```tsx
import { SafeView } from "@/features/safe/safe-view";
import { SettingsView } from "@/features/settings/settings-view";
```

Then find this block (the settings placeholder added in 3C.1):

```tsx
        {view === "settings" && (
          <EmptyState
            icon="lock"
            title="Thiết lập sẵn sàng ở Phase 3C.2"
            subtitle="Module owner/manager, sẽ vào Phase 3C.2 (Settings)."
          />
        )}
```

Replace with:

```tsx
        {view === "settings" && <SettingsView role={account.role} />}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Build**

```bash
npm run build 2>&1 | Select-Object -Last 30
```

Expected: build succeeds. Warnings about unused vars OK.

- [ ] **Step 5: Run verify:phase**

```bash
npm run verify:phase
```

Expected: vitest 75/75 + pgtap 50/50 = 125 total, exit 0.

- [ ] **Step 6: Verify file manifest**

```bash
git diff v4-phase-3c1..HEAD --name-only
```

Expected ~8 files (relative to the 3C.1 tag, since 3C.2 is stacked off it):
- `docs/superpowers/specs/2026-05-21-v4-phase-3c2-settings-design.md`
- `docs/superpowers/plans/2026-05-21-v4-phase-3c2-settings.md`
- `src/features/settings/task-key.ts`
- `src/hooks/mutations/use-settings-mutations.ts`
- `src/features/settings/sidebar-config-form.tsx`
- `src/features/settings/user-sidebar-config-modal.tsx`
- `src/features/settings/handover-default-tasks-editor.tsx`
- `src/features/settings/settings-view.tsx`
- `src/app/page.tsx` (modified)

If any **off-limits** file appears (database/**, src/lib/data/**, src/lib/types.ts, src/hooks/queries/use-account-query.ts, src/features/navigation/navigation.ts, prior-phase feature modules, Phase 2 primitives), STOP and revert.

- [ ] **Step 7: Place tag v4-phase-3c2**

```bash
git tag v4-phase-3c2
git tag --list v4-phase-3c2
```

Expected: tag appears.

- [ ] **Step 8: Commit SettingsView + page.tsx wire + plan file**

Write to `.git/COMMIT_MSG_TMP`:

```
feat(phase-3c2): SettingsView container + page.tsx wire + tag v4-phase-3c2

SettingsView:
- Owner/manager defense-in-depth gate (NAV_ITEMS already filters upstream)
- useAppSettingsQuery + useSettingsAccountsQuery + useAccountQuery
- Composes SidebarConfigForm + HandoverDefaultTasksEditor
- Loading state (any query pending → centered Spinner)
- Error state (missing appSettings or currentAccount → EmptyState)

page.tsx:
- Wires view === "settings" to <SettingsView role={account.role} />
- Replaces the 3C.1 "sẵn sàng ở Phase 3C.2" placeholder

Final: vitest 75 + pgtap 50 = 125 assertions green.

Tag: v4-phase-3c2 (closes Phase 3C.2, opens 3C.3 Handover).
Branch stacked off v4-phase-3c1 (3C.1 unmerged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

Then:

```bash
git add src/features/settings/settings-view.tsx src/app/page.tsx docs/superpowers/plans/2026-05-21-v4-phase-3c2-settings.md
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

(If the plan file was already committed by writing-plans earlier, skip it from `git add`.)

- [ ] **Step 9: Verify branch state**

```bash
git log --oneline v4-phase-3c1..HEAD
```

Expected ~6 commits (5 task + spec, with plan possibly merged into last task commit):
- `<sha> feat(phase-3c2): SettingsView container + page.tsx wire + tag v4-phase-3c2`
- `<sha> feat(phase-3c2): HandoverDefaultTasksEditor — list + inline edit + add/delete`
- `<sha> feat(phase-3c2): UserSidebarConfigModal + per-user sub-section integration`
- `<sha> feat(phase-3c2): SidebarConfigForm — role matrix (per-user sub-section in T3)`
- `<sha> feat(phase-3c2): slugifyTaskKey + use-settings-mutations (3 hooks)`
- `<sha> docs(phase-3c2): design spec for Settings module` (already done in brainstorming)
- `<sha> docs(phase-3c2): implementation plan for Settings module` (already done in writing-plans)

Ready for `superpowers:finishing-a-development-branch` to (eventually) merge to main and place the tag on the merge commit.

---

## Self-Review (run by author after writing plan)

**Spec coverage check:**
- §0 TL;DR (1 slugify helper + 3 hooks + 5 feature files + page wire) → all covered across T1-T5 ✓
- §1 Goal (4 capabilities: role matrix auto-save / per-user override modal / handover editor / page wire) → T2/T3/T4/T5 ✓
- §2 Non-goals → not implemented, correctly absent ✓
- §3.1 Flow diagram → T5 wires everything into SettingsView ✓
- §3.2 Mutation invalidation map (3 hooks, exact invalidation keys) → T1 step 2 ✓
- §3.3 Auto-save vs explicit Save split → T2 role matrix auto, T3 modal explicit, T4 inline-save ✓
- §3.4 Hard floor (NAV_ITEMS roles) + soft customization (sidebar_defaults) → T2 + T3 enforce both ✓
- §4.1 slugifyTaskKey API + examples → T1 step 1 implements verbatim ✓
- §4.2 3 mutation hooks signatures → T1 step 2 ✓
- §4.3 SidebarConfigForm: role matrix + per-user sub-section → T2 (matrix) + T3 (modifies for sub-section) ✓
- §4.4 UserSidebarConfigModal: explicit Save + Reset confirm + self-lock-out → T3 ✓
- §4.5 HandoverDefaultTasksEditor: list + add + edit-label-only + delete with confirm → T4 ✓
- §4.6 SettingsView container with role gate + 3 queries → T5 ✓
- §4.7 page.tsx wire → T5 step 2 ✓
- §5 Data flows → exercised by manual smoke (no E2E in this phase) ✓
- §6 Error handling matrix → handled per-component (toast on failure, no optimistic state) ✓
- §7 File manifest (6 new + 1 modified) → T1-T5 produce exactly these files ✓
- §8 ~5 tasks → exactly 5 tasks ✓
- §9 Risks → self-lock-out guard implemented in T2 + T3 (settings cell + settings checkbox) ✓
- §10 Success criteria → T5 step 5 (verify:phase) + step 6 (file manifest) + step 7 (tag) ✓

**Placeholder scan:**
- No "TBD" / "TODO" / "implement later" anywhere ✓
- Every code step has full TSX/TS code ✓
- Every command has exact text and expected output ✓
- Commit messages are fully written ✓
- The note "If `checkCircle` icon is not in the set, swap for `check`" in T4 is a robust handling note, not a placeholder — confirmed `checkCircle` IS in `icons.tsx` (line 37: `checkCircle: CheckCircle2`). ✓

**Type consistency:**
- `UserRole`, `ViewKey`, `AppSettings`, `SettingsAccount` imported from `@/lib/types` consistently ✓
- Mutation hook input interfaces match data layer signatures (UpdateSidebarDefaultsInput → updateSidebarDefaults takes role+items array) ✓
- `slugifyTaskKey` signature in T1 (`label: string, existingKeys?: ReadonlySet<string>`) matches usage in T4 ✓
- `useUpdateSidebarDefaults`, `useUpdateUserSidebarConfig`, `useUpdateHandoverDefaultTasks` hook names consistent across tasks ✓
- Modal open/close pattern: `open` + `onOpenChange` consistently used (Radix Dialog convention) ✓
- `currentUserAuthId` prop name consistent between SidebarConfigForm and UserSidebarConfigModal ✓
- `sidebarDefaults` prop name consistent ✓
- Edit-mode state: `editingKey: string | null` + `editingLabel: string` (T4), pattern is clear ✓

**One self-flagged concern (already mitigated):**
- T2 introduces `_accounts` and `_currentUserAuthId` with underscore prefix to mark as intentionally unused; T3 removes the prefix when adding the per-user sub-section. TypeScript's `noUnusedParameters` would normally flag underscore-prefix as the documented opt-out. If the project's tsconfig has stricter unused-prop checking, T2 might fail typecheck. **Mitigation**: T2 step 2 says "Expected: zero errors" — if it fails, T3 is essentially the rest of the file in one shot, can be split into "Build full SidebarConfigForm + UserSidebarConfigModal in T3" with T2 being skipped. Don't anticipate this; project uses standard `strict: true` which allows unused params.

No other issues found.
