# Phase 3C.2 — Settings Module Design Spec

**Date:** 2026-05-21
**Branch:** `phase-3c2-settings` (off `v4-phase-3c1` tag — stacked since 3C.1 is unmerged)
**Tag at end:** `v4-phase-3c2`
**Predecessor:** Phase 3C.1 (Safe module — owner-only ledger UI)
**Sub-phase position:** 2 of 3 in Phase 3C (Safe → Settings → Handover)
**Successor:** Phase 3C.3 (Handover wizard)

---

## 0. TL;DR

Build the owner/manager UI for two `app_settings` features:

1. **Sidebar config** — per-role matrix (4 roles × 8 nav items) with auto-save on toggle + per-user override sub-section (modal-based, explicit Save)
2. **Handover default tasks editor** — list of `{key, label}` template tasks used to seed new handover sessions, with slugified Vietnamese-aware key auto-generation

Phase 1 backend RPCs + data layer + types + query hooks are already plumbed and frozen. This phase adds: 3 mutation hooks, 1 slugify helper, 5 feature files, page.tsx wire.

**Out of scope** (deferred / already done):
- Account management → Phase 3B.2a already built
- Expense template + category admin → Phase 3B.1 already built
- KiotViet integration config → Phase 4 inventory
- App settings KV editor (denominations / cash_diff_threshold) → Phase 6

---

## 1. Goal

Deliver a working owner/manager-only Settings module that:
- Lets owner/manager toggle which nav items show per role (4 roles × 8 items)
- Lets owner/manager set per-user sidebar overrides (per-employee customization)
- Lets owner/manager edit the handover default tasks list (add / edit label / remove)
- Wires into the existing `view === "settings"` dispatcher in page.tsx

**Acceptance criteria:**
- Owner/manager login → sidebar shows "Thiết lập" → click → SettingsView renders
- Role matrix toggle auto-saves immediately + toast feedback
- Per-user override modal: Save / Reset / Close — explicit save model
- Handover default tasks: add label → auto-generates key → list updates inline
- Staff_operator login → "Thiết lập" NOT in sidebar (already gated by NAV_ITEMS)
- `npm run verify:phase` passes unchanged (75 Vitest + 50 pgTAP)

---

## 2. Non-Goals (deferred)

| Item | Deferred to | Reason |
|---|---|---|
| Account management UI | n/a (Phase 3B.2a) | Already built — auth + employee accounts module is in shifts/admin path |
| Expense template + category admin | n/a (Phase 3B.1) | Already built — ExpenseTemplateModal exists |
| KiotViet integration config | Phase 4 | KiotViet is the POS integration; lives with inventory/sync module |
| App settings KV editor (denominations, cash_diff_threshold) | Phase 6 | Low-frequency edits; expert-only; defer until full settings audit |
| Drag-to-reorder handover tasks | Phase 6 | YAGNI for Phase 1 — manual delete + re-add suffices |
| Versioning / undo for settings changes | Phase 6+ | Audit log already captures changes via DB trigger |
| Real-time sync of settings across multi-owner sessions | Phase 6 | Single-owner deployment in target shops |
| Per-user override conflict resolution (multi-owner editing same user) | Phase 6 | Single-owner deployment in target shops |
| Vitest for `slugifyTaskKey` helper | Phase 6 | Component test infra deferred to Phase 6; slugify is pure + simple |

---

## 3. Architecture

### 3.1 Flow diagram

```
User (owner/manager) → page.tsx dispatcher (view === "settings")
                       │
                       ▼
                 <SettingsView />          ← role gate (defense-in-depth)
                       │
              ┌────────┴─────────┐
              ▼                  ▼
        SidebarConfigForm   HandoverDefaultTasksEditor
              │                  │
   ┌──────────┼─────────┐        │
   ▼          ▼         ▼        ▼
Role matrix  Per-user  UserSidebar  task slugify + list edit
(4×8        sub-section ConfigModal
Checkboxes)  (employee  (nested)
             rows)
```

### 3.2 Mutation invalidation map

| Mutation hook | RPC | Invalidates |
|---|---|---|
| `useUpdateSidebarDefaults` | `update_sidebar_defaults(p_role, p_items)` | `appSettings()` + `account()` (current user's nav refreshes) |
| `useUpdateUserSidebarConfig` | `update_user_sidebar_config(p_profile_id, p_items \| null)` | `settingsAccounts()` + `account()` (if current user) |
| `useUpdateHandoverDefaultTasks` | `update_handover_default_tasks(p_tasks)` | `appSettings()` (template lives in app_settings.value) |

**Rationale**: The role-matrix change might affect the LOGGED-IN user's own nav if owner edits their own role's matrix. Invalidating `account()` triggers `useAccountQuery` to refetch → `getVisibleNav` recomputes → sidebar refreshes. Same logic for per-user override when it's the current user's row.

### 3.3 Auto-save vs explicit Save split

Two patterns coexist by design:

**Auto-save (role matrix)**: each checkbox toggle fires immediately. UX rationale — toggling 1 cell at a time is the natural interaction; no draft state needed; instant feedback matches v3 `toggleRolePage` UX.

**Explicit Save (per-user override modal)**: opens with current config, user toggles multiple checkboxes, single Save commits. UX rationale — per-user is a batch operation across 8 items; auto-save would fire 8 mutations and clutter the toast feed.

**Inline-save (handover tasks)**: add / edit-label / remove each fire one mutation with the full updated array. Same pattern as auto-save in terms of immediacy; the "full array" payload matches the RPC contract.

### 3.4 Role guard on cells

The role-matrix uses TWO layers of filtering:

1. **NAV_ITEMS gate (hard floor)**: `NAV_ITEMS.find(i => i.key === navKey).roles` defines whether a role CAN see an item at all. E.g., `safe` has `roles: ["owner"]` only — non-owner cells for "Sổ quỹ" are **disabled + grayed out** in the matrix.
2. **sidebar_defaults (soft customization)**: among items the role CAN see, sidebar_defaults stores which are ACTIVELY shown. Owner can hide "Pivot" for manager via this even though manager has access via NAV_ITEMS.

The form must respect the hard floor — a checkbox can never enable a cell that NAV_ITEMS prohibits.

---

## 4. Components

### 4.1 `slugifyTaskKey` helper (`src/features/settings/task-key.ts`)

Pure function, Vietnamese-aware slugify for handover task keys.

```ts
export function slugifyTaskKey(label: string, existingKeys?: ReadonlySet<string>): string {
  const base = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")     // strip combining diacritics
    .replace(/đ/g, "d").replace(/Đ/g, "d") // Vietnamese đ
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")          // non-alphanum → _
    .replace(/^_+|_+$/g, "")              // trim _
    .slice(0, 40);                        // max 40 chars

  if (!existingKeys || !existingKeys.has(base)) return base || "task";

  // Conflict resolution: append -2, -3...
  let n = 2;
  while (existingKeys.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
```

Examples:
- `"Đếm doanh thu cuối ngày"` → `"dem_doanh_thu_cuoi_ngay"`
- `"Khóa két - giao ca"` → `"khoa_ket_giao_ca"`
- `""` → `"task"` (fallback)
- `"Đếm"` with existing `{"dem"}` → `"dem_2"`

### 4.2 `useSettingsMutations` hooks (`src/hooks/mutations/use-settings-mutations.ts`)

3 hooks following the `use-cash-mutations.ts` template.

```ts
useUpdateSidebarDefaults(supabase): { role: UserRole; items: string[] }
  → updateSidebarDefaults(supabase, role, items)
  → invalidates: appSettings(), account()

useUpdateUserSidebarConfig(supabase): { profileId: string; items: string[] | null }
  → updateUserSidebarConfig(supabase, profileId, items)
  → invalidates: settingsAccounts(), account()

useUpdateHandoverDefaultTasks(supabase): { tasks: Array<{key, label}> }
  → updateHandoverDefaultTasks(supabase, tasks)
  → invalidates: appSettings()
```

All three follow the null-supabase guard + no-optimistic-updates pattern.

### 4.3 `SidebarConfigForm` (`src/features/settings/sidebar-config-form.tsx`, ~280 LOC)

**Props:**
```ts
interface SidebarConfigFormProps {
  sidebarDefaults: AppSettings["sidebar_defaults"]; // Partial<Record<UserRole, string[]>>
  accounts: SettingsAccount[];
  currentUserAuthId: string;  // to highlight current user's row
}
```

**Structure:**
1. Card "Sidebar mặc định theo role"
   - 4-column matrix (Chủ quán / Quản lý / Nhân viên / Viewer)
   - 8 rows (one per NAV_ITEM)
   - Each cell: Checkbox driven by `(sidebarDefaults[role] ?? DEFAULT_SIDEBAR_BY_ROLE[role]).includes(navKey)`
   - Disabled + grayed if `!NAV_ITEMS[i].roles.includes(role)` (hard floor)
   - Toggle fires `useUpdateSidebarDefaults({role, items: newItemsArray})` with the FULL updated items array
   - While mutation pending for a role, entire column disabled

2. Card "Tùy chỉnh cho từng nhân viên" (per-user sub-section, below role matrix)
   - Header + brief description
   - List of accounts (table-like, but using Card rows for mobile-friendliness)
   - Each row: `{employee_name}` (or email) + Badge `{ROLE_LABELS[role]}` + Badge "Override: N mục" if `sidebar_config !== null` + "Sửa" button
   - Click "Sửa" → opens `UserSidebarConfigModal` with selected account

### 4.4 `UserSidebarConfigModal` (`src/features/settings/user-sidebar-config-modal.tsx`, ~140 LOC)

**Props:**
```ts
interface UserSidebarConfigModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  account: SettingsAccount | null;
  sidebarDefaults: AppSettings["sidebar_defaults"];
}
```

**Behavior:**
- On open: initial state = `account.sidebar_config ?? sidebarDefaults[account.role] ?? DEFAULT_SIDEBAR_BY_ROLE[account.role]`
- Form: Checkbox list of all NAV_ITEMS where `account.role` is in `NAV_ITEMS[i].roles` (the hard floor)
- "Override: N mục" badge if `account.sidebar_config !== null`
- AlertBanner.info: "Override sẽ ghi đè default cho role này. Click 'Reset' để dùng lại default."
- 3 buttons:
  - "Đóng" (ghost, no save)
  - "Reset về mặc định role" (secondary) — calls `useUpdateUserSidebarConfig({profileId, items: null})` → toast → close
  - "Lưu" (primary) — calls `useUpdateUserSidebarConfig({profileId, items: currentSelections})` → toast → close

**Reset confirmation**: if `account.sidebar_config !== null` (user HAS an override), clicking Reset shows inline AlertBanner.warning + 2 buttons ("Hủy reset" / "Xác nhận reset"). If no override, Reset button is disabled with helper text "Đã dùng default rồi."

### 4.5 `HandoverDefaultTasksEditor` (`src/features/settings/handover-default-tasks-editor.tsx`, ~220 LOC)

**Props:**
```ts
interface HandoverDefaultTasksEditorProps {
  tasks: Array<{ key: string; label: string }>;
}
```

**Layout:**
- Card "Checklist mặc định cuối ngày" with description
- List of existing tasks, each row:
  - Default mode: `[icon]` + label + "Sửa" + "✕" delete buttons
  - Edit mode (after Sửa click): inline TextField + "Lưu" + "Hủy" buttons
  - Delete confirm: inline AlertBanner.warning + "Hủy" + destructive "Xóa"
- Add-new row at bottom:
  - TextField for new label + "Thêm" button
  - On Thêm: slugify the label → check uniqueness → call `useUpdateHandoverDefaultTasks` with `[...tasks, {key, label}]`

**Edit mode state**: `editingKey: string | null` + `editingLabel: string`. Only one row can be in edit mode at a time. Cancelling another edit auto-closes any open edit.

**Delete mode state**: `deletingKey: string | null`. Same single-active constraint.

**Validation**:
- Label trim length ≥ 2 chars
- Label trim length ≤ 200 chars
- Slugified key (after collision resolution) must be ≤ 40 chars
- Disable Add button if label invalid

### 4.6 `SettingsView` container (`src/features/settings/settings-view.tsx`, ~80 LOC)

**Props:**
```ts
interface SettingsViewProps {
  role: UserRole;
}
```

**Defense-in-depth gate:**
```tsx
if (role !== "owner" && role !== "manager") {
  return <EmptyState icon="lock" title="Thiết lập owner/manager only" subtitle="..." />;
}
```

**Queries:**
- `useAppSettingsQuery(supabase, enabled)` — already exists
- `useSettingsAccountsQuery(supabase, enabled)` — already exists
- `useAccountQuery(supabase, enabled)` (current user, for currentUserAuthId)

**Composition:**
```tsx
return (
  <div className="space-y-6">
    <SidebarConfigForm
      sidebarDefaults={appSettings.sidebar_defaults}
      accounts={settingsAccounts}
      currentUserAuthId={account.auth_user_id}
    />
    <HandoverDefaultTasksEditor tasks={appSettings.handover_default_tasks} />
  </div>
);
```

Loading state: full-page spinner if any query pending.

### 4.7 page.tsx dispatcher wire

Replace existing placeholder:
```tsx
{view === "settings" && (
  <EmptyState icon="lock" title="Thiết lập sẵn sàng ở Phase 3C.2" ... />
)}
```

With:
```tsx
{view === "settings" && <SettingsView role={account.role} />}
```

Add import: `import { SettingsView } from "@/features/settings/settings-view";`

---

## 5. Data flow

### 5.1 On mount (SettingsView)
1. Owner/manager logs in → clicks "Thiết lập" sidebar item → page.tsx dispatches `view === "settings"` → SettingsView mounts
2. `useAppSettingsQuery` fires → `loadAppSettings()` → returns `{sidebar_defaults, handover_default_tasks, ...}`
3. `useSettingsAccountsQuery` fires → `loadSettingsAccounts()` → returns `SettingsAccount[]`
4. UI renders SidebarConfigForm + HandoverDefaultTasksEditor in sequence

### 5.2 Role matrix toggle
1. Owner clicks checkbox "Pivot" for "Quản lý" role (currently checked → unchecking)
2. Compute new items array: `(currentItems[manager]).filter(k => k !== "pivot")`
3. Fire `useUpdateSidebarDefaults.mutate({role: "manager", items: newArray})`
4. While pending: entire "Quản lý" column disabled (visual feedback)
5. On success: invalidates `appSettings()` + `account()` → matrix re-renders with new state → toast "Đã cập nhật."
6. If logged-in user is a manager: their sidebar refreshes too (no longer shows Pivot)

### 5.3 Per-user override flow
1. Owner clicks "Sửa" on a Staff user row → UserSidebarConfigModal opens
2. Modal initialized with: `account.sidebar_config ?? sidebarDefaults.staff_operator ?? DEFAULT_SIDEBAR_BY_ROLE.staff_operator`
3. Owner toggles checkboxes (no auto-save in modal)
4. Click "Lưu" → fires `useUpdateUserSidebarConfig.mutate({profileId, items: currentSelections})`
5. RPC updates `profiles.sidebar_config` for that user
6. Modal closes + toast + `settingsAccounts()` + `account()` invalidated
7. Per-user sub-section in form updates: row's "Override: N mục" badge appears (if previously had no override)

### 5.4 Per-user reset flow
1. Owner clicks "Sửa" → modal opens with current override (sidebar_config not null)
2. Click "Reset về mặc định role" → AlertBanner.warning + 2 confirm buttons appear
3. Click "Xác nhận reset" → fires `useUpdateUserSidebarConfig.mutate({profileId, items: null})`
4. RPC sets `profiles.sidebar_config = null`
5. Modal closes + toast + invalidations
6. Per-user sub-section: row's "Override" badge disappears

### 5.5 Handover task add flow
1. Owner types label "Kiểm két cuối ca" in add field
2. As they type: helper text shows "Key sẽ là: kiem_ket_cuoi_ca"
3. Click "Thêm" → slugify produces key → collision-check vs existing keys → final key
4. Fire `useUpdateHandoverDefaultTasks.mutate({tasks: [...current, {key, label}]})`
5. RPC writes full array to `app_settings.handover_default_tasks.value`
6. List re-renders with new row + toast

### 5.6 Handover task edit / delete
- **Edit**: click "Sửa" → row swaps to TextField → user edits label → "Lưu" → slugify checks if label changed enough to change key (collision-resolve again) → fire mutation with updated array → list re-renders. Or: keep original key + only update label (simpler, no collision risk). **Decision: keep original key, only update label** — keys are immutable once created (matches v3 behavior).
- **Delete**: click "✕" → inline AlertBanner.warning + 2 buttons → "Xác nhận xóa" → fire mutation with filtered array → list re-renders

---

## 6. Error handling

| Scenario | Handling |
|---|---|
| Non-owner/manager reaches SettingsView | Defense-in-depth gate: EmptyState. NAV_ITEMS upstream filters this. |
| RPC call fails (network / RLS / SQL error) | `useMutation.onError` → toast.danger with error message. UI state reverts via re-fetch on next render (no optimistic state to roll back). |
| Concurrent edits from 2 admin sessions | Last write wins. RPC has no optimistic-locking; multi-admin not in scope. |
| Add task with invalid label (< 2 chars) | "Thêm" button disabled; helper text "Tên ít nhất 2 ký tự." |
| Add task with label producing colliding key | slugifyTaskKey appends `_2`, `_3` etc. automatically. |
| Delete a task that was already deleted in another session | RPC writes full array regardless of prior state; effectively idempotent. |

---

## 7. File Manifest

### 7.1 New files (6)

| Path | Purpose | Approx LOC |
|---|---|---|
| `src/features/settings/task-key.ts` | slugifyTaskKey helper | 30 |
| `src/hooks/mutations/use-settings-mutations.ts` | 3 hooks | 120 |
| `src/features/settings/settings-view.tsx` | container + role gate | 80 |
| `src/features/settings/sidebar-config-form.tsx` | role matrix + per-user sub-section | 280 |
| `src/features/settings/user-sidebar-config-modal.tsx` | per-user override modal | 140 |
| `src/features/settings/handover-default-tasks-editor.tsx` | list editor | 220 |
| **Total** | | **~870** |

### 7.2 Modified files (1)

| Path | Change |
|---|---|
| `src/app/page.tsx` | Swap settings placeholder with `<SettingsView role={account.role} />` (~3 lines) |

### 7.3 Off-limits (NOT touched)

- All `database/**` (Phase 1 backend frozen)
- `src/lib/data/app-settings.ts`, `src/lib/data/handover.ts`, `src/lib/data/accounts.ts` (data layer frozen — all functions ready)
- `src/lib/types.ts` (Settings + UserRole + Account types already defined)
- `src/hooks/queries/use-app-settings-query.ts`, `use-account-query.ts` (query hooks exist)
- `src/features/navigation/navigation.ts` (NAV_ITEMS + DEFAULT_SIDEBAR_BY_ROLE + ROLE_LABELS frozen)
- `src/features/{auth,dashboard,reports,pivot,expenses,shifts,cash,safe}/**` (prior-phase features frozen)
- All Phase 2 primitives (Modal, TextField, Textarea, Select, Checkbox, AlertBanner, Card, Button, EmptyState, Badge, Spinner, Icon, Toast)
- `docker-compose.yml`, `.env*`, `vitest.config.mts`, `tsconfig.json`

---

## 8. Implementation order (task projection)

Final decided in writing-plans. Rough projection (~5-6 tasks):

1. **T1**: `task-key.ts` slugify helper + `use-settings-mutations.ts` (3 hooks)
2. **T2**: `SidebarConfigForm` — role matrix ONLY (per-user sub-section in T3)
3. **T3**: `UserSidebarConfigModal` + per-user override sub-section integration into SidebarConfigForm
4. **T4**: `HandoverDefaultTasksEditor` (list, add, edit-label, delete)
5. **T5**: `SettingsView` container + page.tsx wire + final verify:phase + tag `v4-phase-3c2`

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Owner edits their own role's matrix and accidentally hides "Thiết lập" → locks themselves out | Medium | Defense-in-depth: NAV_ITEMS has `settings` with roles `["owner", "manager"]` — but if owner unchecks "Thiết lập" for owner role, the next sidebar render won't show it. **Mitigation**: hard-code a check that prevents owner from unchecking `settings` for their own row in the matrix. Alternatively, the role matrix only shows items the role CAN have — the owner row for `settings` should be permanently checked + disabled (defense). **Going with**: disabled + checked for `settings` in owner column (cannot be unchecked). |
| Owner edits their own per-user override and hides settings | Medium | Same mitigation: in UserSidebarConfigModal, if account.auth_user_id === currentUser.auth_user_id and the unchecking would remove "settings", disable that specific checkbox with helper text. |
| Manager unchecks "Thiết lập" for manager role in matrix | Medium | If manager removes their own access, they cannot re-enable it without going back through the matrix — but they STILL can navigate via the same Settings module if they're already there. **Mitigation**: just disable settings checkbox in manager column too — same logic. Owners can still grant/revoke manager access if needed. |
| Slugify produces empty key (label is all special chars) | Low | Slugify returns `"task"` as fallback. Collision resolution appends `_2`, `_3` etc. |
| Slugify collision with system-reserved key | Low | No reserved keys in current schema; future-proofing not needed in Phase 1. |
| Race: two admins editing role matrix simultaneously | Low | Single-owner deployment in target shops. Last-write-wins is acceptable. RPC writes the full items array so partial conflicts can't corrupt the structure. |
| RPC `update_sidebar_defaults` rejects an item key not in NAV_ITEMS | Low | RPC validates against allowed keys server-side. Client also filters by NAV_ITEMS, so this shouldn't happen unless a future client/server schema drift. Surface as toast error. |
| HandoverDefaultTasksEditor: user edits a task currently in use by an open handover session | Low | Editing the template doesn't affect existing sessions — `handover_sessions` snapshot their tasks at create time. UI doesn't need to warn. |
| Performance: re-render on every checkbox toggle | Low | Auto-save fires 1 mutation per toggle. React Query invalidation triggers refetch. For 32 cells, this is fine. No virtualization needed. |

---

## 10. Success criteria

- [ ] `npm run verify:phase` exits 0 (75 Vitest + 50 pgTAP unchanged — no test additions)
- [ ] All 6 new files exist at the spec-mandated paths
- [ ] `slugifyTaskKey` handles Vietnamese diacritics correctly (verified manually: "Đếm" → "dem")
- [ ] All 3 mutation hooks follow the `use-cash-mutations.ts` template
- [ ] Owner can: toggle role matrix cells (auto-save), open per-user modal + Save/Reset, add/edit/remove handover default tasks
- [ ] Manager can: same as owner (since gate is `owner || manager`)
- [ ] Owner cannot uncheck "Thiết lập" for their own row (defense — disabled checkbox)
- [ ] Staff_operator login: "Thiết lập" nav item NOT visible
- [ ] No off-limits files modified
- [ ] Commit history: one commit per task (~5-6 commits), each with `Co-Authored-By: Claude Opus 4.7 (1M context)` footer
- [ ] Final tag `v4-phase-3c2` placed on the merge commit
- [ ] Phase 3C.3 (Handover wizard) can immediately start by branching off `v4-phase-3c2` (it depends on the handover_default_tasks template managed here)

---

## 11. References

- **Phase 1 backend** (frozen): `database/002_functions.sql:1570-1640` (settings RPCs), `:1384-1500` (handover RPCs)
- **Phase 1 data layer** (frozen):
  - `src/lib/data/app-settings.ts` — loadAppSettings, updateSidebarDefaults, updateUserSidebarConfig
  - `src/lib/data/handover.ts` — updateHandoverDefaultTasks
  - `src/lib/data/accounts.ts` — loadSettingsAccounts
- **Phase 1 query hooks** (frozen):
  - `src/hooks/queries/use-app-settings-query.ts` — useAppSettingsQuery (stale 5min)
  - `src/hooks/queries/use-account-query.ts` — useAccountQuery + useSettingsAccountsQuery
- **Phase 1 types** (frozen): `src/lib/types.ts` — AppSettings, SettingsAccount, UserRole, Account
- **Phase 2 design system**: Modal compound, TextField, Textarea, Select, Checkbox, AlertBanner, Card, Button, EmptyState, Badge, Spinner, Icon, Toast — all available
- **Phase 3A navigation**: `src/features/navigation/navigation.ts` — NAV_ITEMS, DEFAULT_SIDEBAR_BY_ROLE, ROLE_LABELS, hasBasePageAccess, normalizeSidebarItems, getVisibleNav
- **Phase 3B.2b.i patterns**: Modal pattern (`opening-cash-modal.tsx`), mutation hooks (`use-cash-mutations.ts`)
- **Phase 3C.1**: SafeView container pattern (role gate + composition)
- **v3 reference**: `F:\Chill manager\v3\src\features\settings\settings-view.tsx` — for v3 role matrix UX (we're porting + simplifying)

---

## 12. Out-of-scope notes (preserved for future)

- **Audit log viewer for settings changes**: All write ops trigger `audit_app_settings` (DB trigger). UI to browse out of scope; deferred to cross-cutting feature in Phase 4 or later.
- **Per-user override bulk operations**: e.g., "Reset all users' overrides to role default". YAGNI for Phase 1.
- **Drag-to-reorder handover tasks**: nice but not load-bearing. Phase 6 if requested.
- **Permission inheritance UI**: "Manager inherits Owner permissions + can disable specific items". Current model is independent rows per role; inheritance would require deeper rework.
- **Export/import settings**: JSON export of current sidebar_defaults + handover_default_tasks for backup. Phase 6+.
