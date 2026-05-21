# Phase 3C.3 — Handover Module Design Spec

**Date:** 2026-05-21
**Branch:** `phase-3c3-handover` (off `main` @ `2a5166b` = tag `v4-phase-3c2`)
**Tag at end:** `v4-phase-3c3`
**Predecessor:** Phase 3C.2 (Settings module — sidebar + handover defaults editor)
**Sub-phase position:** 3 of 3 in Phase 3C (Safe → Settings → Handover)
**Closes:** Phase 3C — owner/manager/staff administration suite complete

---

## 0. TL;DR

Build the staff-or-above end-of-day handover module (sổ bàn giao cuối ngày) UI:
- Single-page view with sections: active-shifts summary + checklist + note editor + complete button
- Auto-save per checkbox toggle (matches Settings role-matrix UX)
- Save-on-blur for note Textarea (free-form text — debounced explicit save unnecessary)
- Owner/manager admin per-day task editor (modal, reuses slugify from 3C.2)
- Complete button: irreversible session lock with destructive confirm (warn if incomplete tasks)
- New sidebar nav item: "Bàn giao" with `roles: ["owner","manager","staff_operator"]`

Phase 1 backend RPCs, data layer, types, and query hook all exist and are frozen. This phase adds: 4 mutation hooks, 1 new icon (clipboardList), additive nav modifications, 7 feature files (1 container + 5 sub-components + 1 modal), page.tsx wire.

**Closes Phase 3C** — all 3 sub-phases (Safe, Settings, Handover) merged means the owner/manager admin suite is complete.

---

## 1. Goal

Deliver a working staff-or-above end-of-day handover view that:
- Auto-creates session per business_date via `get_or_create_handover_session` RPC (seeded from `app_settings.handover_default_tasks` from 3C.2)
- Lets any staff_or_above user toggle checklist items + edit note + complete the session
- Lets owner/manager edit the THIS SESSION's task list (additive override; default template unchanged)
- Locks the session read-only after completion
- Surfaces a progress badge (`{doneCount}/{totalCount}`) prominently

**Acceptance criteria:**
- Staff_operator login → "Bàn giao" sidebar item visible → HandoverView renders → checklist + note editor work
- Toggle a task → auto-save → progress badge updates
- Edit note → blur → save-on-blur fires → "Đã lưu" timestamp shows
- Click "Hoàn tất bàn giao" with incomplete tasks → warning banner → confirm → session locked
- Owner/manager: "Sửa task cho ngày này" button visible + opens admin editor modal
- Staff_operator: "Sửa task cho ngày này" button NOT visible (defense-in-depth — RPC also gates owner/manager)
- Employee_viewer login: "Bàn giao" NOT in sidebar (NAV_ITEMS roles already filter)
- Settings page (3C.2): new "Bàn giao" row appears in role matrix automatically (proves dynamic NAV_ITEMS iteration)
- `npm run verify:phase` passes unchanged (75 Vitest + 50 pgTAP)

---

## 2. Non-Goals (deferred)

| Item | Deferred to | Reason |
|---|---|---|
| Un-complete (re-open) a completed session | Phase 6 or future | Needs new RPC + audit-trail consideration; out of MVP scope |
| Browse past handover sessions (history view) | Phase 6 | Per-day workflow doesn't need historical UI in MVP |
| Drag-to-reorder tasks within a session | Phase 6 | YAGNI; tasks have `sort_order` but no reorder UI |
| Multi-shift handover (morning → afternoon → evening) | Phase 6+ | Current model is one session per business_date |
| Vitest for handover helpers | Phase 6 | Component test infra deferred |
| Auto-fill note from cash_close_report + safe transactions summary | Phase 6 | Nice-to-have summarization; YAGNI |
| Email/SMS handover notification | Phase 4+ | Notification infra not yet built |
| Photo attachment on tasks | Phase 6+ | Reuse FileUploadField from 3C.1 if needed; not in MVP |
| Real-time sync for multi-staff handover (2 people checking off tasks simultaneously) | Phase 6 | Single-shift handover assumed |
| Required-task validation (some tasks must be done before complete) | Phase 6 | Currently all tasks soft-warning only |

---

## 3. Architecture

### 3.1 Flow diagram

```
User (staff_or_above) → page.tsx (view === "handover")
                        │
                        ▼
                  <HandoverView />          ← role gate (defense-in-depth)
                        │
              ┌─────────┼─────────┬─────────┐
              ▼         ▼         ▼         ▼
       ShiftsSummary  Checklist  NoteEditor  CompleteAction
       (active        (Checkbox  (Textarea  (destructive
        staff count    per task   save-on-   confirm modal)
        + link to      auto-save) blur)
        Shifts)
                                  │
                                  ▼
                    Admin (owner/manager) only:
                    "Sửa task cho ngày này" button →
                    <HandoverTasksEditorModal />
                    (per-day session task editor, reuses
                     slugifyTaskKey from 3C.2)
```

### 3.2 Session lifecycle

```
First visit                        After complete
─────────                          ──────────────
loadHandoverSession                 status: "completed"
  → get_or_create_handover_session  completed_at: timestamp
  RPC                               completed_by: auth.uid()
                                    All sub-components:
status: "draft"                       disabled = true
created_by: auth.uid()              AlertBanner.success at top:
created_at: now()                     "Đã hoàn tất lúc {ts}"
tasks: seeded from
  app_settings.handover_default_tasks
```

### 3.3 Mutation invalidation map

All 4 hooks invalidate the SAME key: `queryKeys.handover(businessDate)`.

| Hook | RPC | Notes |
|---|---|---|
| `useUpdateHandoverTask` | `update_handover_task(taskId, isDone)` | Auto-save on Checkbox toggle |
| `useUpdateHandoverNote` | `update_handover_note(sessionId, note)` | Save-on-blur |
| `useCompleteHandoverSession` | `complete_handover_session(sessionId)` | Irreversible — modal confirm |
| `useUpdateHandoverSessionTasks` | `update_handover_session_tasks(sessionId, tasks)` | Owner/manager only (RPC also gates) |

Handover is per-day and self-contained — no cross-module invalidations needed.

### 3.4 Auto-save matrix (consistent with 3C.2 patterns)

| Operation | Save model | Why |
|---|---|---|
| Toggle checklist item | Auto-save on toggle | Single discrete action, matches Settings role-matrix |
| Edit note | Save-on-blur | Free-form text; debounced auto-save adds complexity, explicit Save button feels heavy |
| Complete session | Explicit confirm modal | Irreversible, deserves friction |
| Admin per-day task add/edit/delete | Full-array mutation per operation | Mirrors HandoverDefaultTasksEditor (3C.2) exactly |

### 3.5 Read-only mode when completed

When `session.status === "completed"`:
- Sub-components receive `disabled={true}` (Checkbox disabled, Textarea disabled, complete button hidden)
- Banner at top: AlertBanner.success "Đã hoàn tất bàn giao lúc {completed_at} bởi {completed_by_name}"
- Admin per-day editor button STILL DISABLED (cannot edit completed session — would need un-complete first, which we defer)

### 3.6 NAV_ITEMS additive modification

Modify `src/features/navigation/navigation.ts` — additive changes only:

1. **ViewKey union**: add `"handover"` variant
2. **NAV_ITEMS array**: insert new entry between `cash` and `reports` (logical end-of-day flow order):
   ```ts
   { key: "handover", label: "Bàn giao", icon: "clipboardList",
     roles: ["owner", "manager", "staff_operator"] }
   ```
3. **DEFAULT_SIDEBAR_BY_ROLE**: insert `"handover"` between `"cash"` and `"reports"` for owner/manager/staff_operator. employee_viewer unchanged.

**Side-effect**: Settings role-matrix (3C.2) iterates `NAV_ITEMS.map(...)` dynamically. Once handover is added, a new "Bàn giao" row appears automatically. Verified via `sidebar-config-form.tsx` row mapping.

### 3.7 New icon additive to Phase 2

Add `clipboardList` to `src/components/ui/icons.tsx`:

```ts
import {
  // ... existing imports
  // Phase 3C.3 — handover icon
  ClipboardList,
  // ...
} from "lucide-react";

// In Icons const:
clipboardList: ClipboardList,
```

---

## 4. Components

### 4.1 `useHandoverMutations` (`src/hooks/mutations/use-handover-mutations.ts`, ~140 LOC)

4 hooks following `use-cash-mutations.ts` template.

```ts
interface UpdateHandoverTaskInput {
  taskId: string;
  isDone: boolean;
}
useUpdateHandoverTask(supabase, businessDate)
  → updateHandoverTask(supabase, taskId, isDone)
  → invalidates queryKeys.handover(businessDate)

interface UpdateHandoverNoteInput {
  sessionId: string;
  note: string;
}
useUpdateHandoverNote(supabase, businessDate)
  → updateHandoverNote(supabase, sessionId, note)
  → invalidates queryKeys.handover(businessDate)

interface CompleteHandoverSessionInput {
  sessionId: string;
}
useCompleteHandoverSession(supabase, businessDate)
  → completeHandoverSession(supabase, sessionId)
  → invalidates queryKeys.handover(businessDate)

interface UpdateHandoverSessionTasksInput {
  sessionId: string;
  tasks: Array<{ id?: string; key?: string; label: string; sort_order?: number }>;
}
useUpdateHandoverSessionTasks(supabase, businessDate)
  → updateHandoverSessionTasks(supabase, sessionId, tasks)
  → invalidates queryKeys.handover(businessDate)
```

All 4: null-supabase guard throwing `"Thiếu cấu hình Supabase."`. No optimistic updates.

### 4.2 `HandoverView` container (`src/features/handover/handover-view.tsx`, ~150 LOC)

```ts
interface HandoverViewProps {
  businessDate: string;
  role: UserRole;
}
```

**Defense-in-depth gate**:
```tsx
if (role === "employee_viewer") {
  return <EmptyState icon="lock" title="Bàn giao staff trở lên" subtitle="..." />;
}
```

**Queries:**
- `useHandoverQuery(supabase, businessDate, isEnabled)` — loads/auto-creates session

**State**: `[isEditorOpen, setEditorOpen] = useState(false)` for admin per-day editor modal.

**Loading state**: full-page Spinner if `handoverQuery.isLoading`.
**Error state**: if `handoverQuery.data === null` after load, EmptyState.alertTriangle "Không tải được sổ bàn giao".

**Composition (top to bottom):**

```tsx
<div className="space-y-6">
  {/* Header card with title + progress badge + status banner */}
  <Card>
    <CardBody>
      <header>
        <CardTitle>Bàn giao cuối ngày — {businessDate}</CardTitle>
        <ProgressBadge done={doneCount} total={totalCount} />
      </header>
      {isCompleted && (
        <AlertBanner variant="success">
          Đã hoàn tất bàn giao lúc {formatDateTime(session.completed_at)}.
        </AlertBanner>
      )}
    </CardBody>
  </Card>

  <HandoverShiftsSummary businessDate={businessDate} disabled={isCompleted} />
  <HandoverChecklist
    sessionId={session.id}
    businessDate={businessDate}
    tasks={session.tasks}
    disabled={isCompleted}
  />
  <HandoverNoteEditor
    sessionId={session.id}
    businessDate={businessDate}
    note={session.note ?? ""}
    disabled={isCompleted}
  />

  {/* Admin per-day editor button (owner/manager only, hidden when completed) */}
  {(role === "owner" || role === "manager") && !isCompleted && (
    <Button variant="secondary" onClick={() => setEditorOpen(true)}>
      Sửa task cho ngày này
    </Button>
  )}

  {/* Complete button (hidden when already completed) */}
  {!isCompleted && (
    <HandoverCompleteAction
      sessionId={session.id}
      businessDate={businessDate}
      doneCount={doneCount}
      totalCount={totalCount}
    />
  )}

  <HandoverTasksEditorModal
    open={isEditorOpen}
    onOpenChange={setEditorOpen}
    sessionId={session.id}
    businessDate={businessDate}
    tasks={session.tasks}
  />
</div>
```

### 4.3 `HandoverShiftsSummary` (`handover-shifts-summary.tsx`, ~60 LOC)

**Props**: `{ businessDate: string; disabled: boolean }`

**Behavior:**
- Reads active shifts via `useShiftsQuery(supabase, businessDate)` — verify this query hook exists; if not, fall back to a simpler "Đảm bảo nhân viên đã check-out trước khi bàn giao." static text Card
- Counts shifts where `status === "checked_in"`
- Card with:
  - Header: "Nhân viên đang trong ca"
  - Big number badge: `{activeCount}`
  - Helper text: "Đảm bảo tất cả nhân viên đã check-out trước khi hoàn tất bàn giao."
  - Action link: "Đi đến Ca & lương" (calls parent's view navigation if exposed; if not, just renders as descriptive text — keep simple)

Pure read-only — no mutations.

### 4.4 `HandoverChecklist` (`handover-checklist.tsx`, ~120 LOC)

**Props:**
```ts
interface HandoverChecklistProps {
  sessionId: string;
  businessDate: string;
  tasks: HandoverTask[];
  disabled: boolean;
}
```

**Behavior:**
- Sort tasks by `sort_order` then `task_key` (stable order across renders)
- Card with checklist rows:
  - Default: `<Checkbox checked={task.is_done} onCheckedChange={(c) => handleToggle(task.id, c)} disabled={disabled || savingTaskId === task.id} label={task.label} />`
  - When `is_done`: small muted text below label "Đã làm bởi {checked_by ?? "—"} lúc {formatDateTime(checked_at)}"
- `savingTaskId: string | null` tracks in-flight toggle to disable the row
- Empty state when `tasks.length === 0`:
  - `<EmptyState icon="checkCircle" title="Chưa có task nào" subtitle="Owner/manager có thể thêm task từ nút 'Sửa task cho ngày này' hoặc từ Settings → Checklist mặc định." />`

### 4.5 `HandoverNoteEditor` (`handover-note-editor.tsx`, ~100 LOC)

**Props:**
```ts
interface HandoverNoteEditorProps {
  sessionId: string;
  businessDate: string;
  note: string;
  disabled: boolean;
}
```

**Behavior:**
- Local state `[currentNote, setCurrentNote] = useState(note)` + `[lastSavedNote, setLastSavedNote] = useState(note)`
- Initialize state from `note` prop via `useEffect([note])` — refetch can update the source note
- Textarea with `value={currentNote}`, `onChange={(e) => setCurrentNote(e.target.value)}`, `onBlur={handleBlur}`, `disabled={disabled || isBusy}`, `maxLength={limits.note}` (1000)
- `handleBlur`: if `currentNote !== lastSavedNote && currentNote.length <= limits.note` → fires `useUpdateHandoverNote({sessionId, note: currentNote})` → on success `setLastSavedNote(currentNote)` + toast → on error toast.danger
- Helper text: dynamic
  - While `isBusy`: "Đang lưu..."
  - When `currentNote !== lastSavedNote`: "Sẽ lưu khi rời ô" (italic)
  - Otherwise: `{currentNote.length}/{limits.note} ký tự` (consistent with shift / cash notes)
- Error text: when `currentNote.length > limits.note` → `Vượt ${limits.note} ký tự.`

**No explicit Save button** — save-on-blur model. User can click anywhere outside to save.

### 4.6 `HandoverCompleteAction` (`handover-complete-action.tsx`, ~80 LOC)

**Props:**
```ts
interface HandoverCompleteActionProps {
  sessionId: string;
  businessDate: string;
  doneCount: number;
  totalCount: number;
}
```

**Behavior:**
- Large primary button "Hoàn tất bàn giao" (variant primary, size large) — or normal-size with prominent placement
- Click → opens nested confirm modal
- Confirm modal:
  - ModalTitle: "Xác nhận hoàn tất"
  - If `doneCount < totalCount`:
    - AlertBanner.warning: "Còn {totalCount - doneCount} task chưa xong. Vẫn hoàn tất bàn giao?"
  - If all done:
    - AlertBanner.info: "Đã hoàn thành tất cả {totalCount} task. Xác nhận hoàn tất?"
  - 2 buttons: "Hủy" (ghost) + "Xác nhận hoàn tất" (destructive, loading state)
- Confirm → `useCompleteHandoverSession.mutateAsync({sessionId})` → toast → modal closes → session refetches → parent re-renders read-only

### 4.7 `HandoverTasksEditorModal` (`handover-tasks-editor-modal.tsx`, ~200 LOC, admin-only)

**Props:**
```ts
interface HandoverTasksEditorModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  sessionId: string;
  businessDate: string;
  tasks: HandoverTask[];
}
```

**Behavior:**
- Same UX as `HandoverDefaultTasksEditor` (3C.2) but operates on `useUpdateHandoverSessionTasks` (RPC for THIS session) instead of `useUpdateHandoverDefaultTasks` (template in app_settings)
- 3 operations: add (with slugify) / edit label (key immutable) / delete with inline confirm
- Reuses `slugifyTaskKey` from `@/features/settings/task-key`
- Cross-module import: `import { slugifyTaskKey } from "@/features/settings/task-key";` — settings module is technically prior phase but task-key.ts is a pure utility safe to reuse
- Important: this edits the CURRENT session's tasks. The default template (Settings → Checklist mặc định) is unchanged.
- ModalTitle: "Sửa task cho ngày {businessDate}"
- ModalDescription: "Thay đổi chỉ áp dụng cho session ngày này. Default template (cho các ngày sau) thay đổi qua Settings."
- All 3 ops fire `useUpdateHandoverSessionTasks` with the FULL updated array

**Task ID handling**: existing tasks have `id`; new tasks added in this session only have `{key, label, sort_order}` — RPC handles insert vs update by presence of `id`. Plan needs to mirror this carefully.

### 4.8 Helper: `ProgressBadge` (`handover-progress-badge.tsx`, ~30 LOC)

Inline component used in header. Small helper:

```tsx
interface ProgressBadgeProps {
  done: number;
  total: number;
}

export function ProgressBadge({ done, total }: ProgressBadgeProps) {
  const allDone = done === total && total > 0;
  return (
    <Badge variant="soft" semantic={allDone ? "success" : "neutral"}>
      {done}/{total} task xong
    </Badge>
  );
}
```

(Inline in HandoverView is also OK — separate file is preference for testability. Will inline in T2 if no separate file.)

### 4.9 page.tsx wire-up

Add import after SettingsView:
```tsx
import { SettingsView } from "@/features/settings/settings-view";
import { HandoverView } from "@/features/handover/handover-view";
```

Insert dispatcher block between `view === "safe"` and `view === "settings"`:
```tsx
{view === "handover" && <HandoverView businessDate={businessDate} role={account.role} />}
```

---

## 5. Data flow

### 5.1 On mount
1. Staff_or_above clicks "Bàn giao" sidebar → page.tsx dispatches `view === "handover"` → HandoverView mounts
2. `useHandoverQuery(supabase, businessDate)` fires → `loadHandoverSession(supabase, businessDate)` → calls `get_or_create_handover_session` RPC → returns session
3. If session is freshly created: tasks are seeded from `app_settings.handover_default_tasks` (the 3C.2 editor's output)
4. UI renders: header card + shifts summary + checklist + note editor + complete button

### 5.2 Toggle checklist task
1. User clicks Checkbox on a task → setSavingTaskId(taskId) → fires `useUpdateHandoverTask.mutate({taskId, isDone: !current})`
2. RPC updates `handover_tasks.is_done + checked_by + checked_at`
3. On success: invalidate `handover(businessDate)` → query refetches → session.tasks update → progress badge updates → setSavingTaskId(null)
4. Toast on error only (success is implicit via UI update)

### 5.3 Edit note (save-on-blur)
1. User types in Textarea → `currentNote` state updates
2. User blurs (clicks elsewhere) → handleBlur fires
3. If dirty + valid: `useUpdateHandoverNote.mutate({sessionId, note: currentNote})`
4. Helper text changes to "Đang lưu..."
5. On success: setLastSavedNote(currentNote) + toast.success + helper text returns to "{X}/1000 ký tự"
6. On error: toast.danger; user can fix and re-blur

### 5.4 Complete session
1. User clicks "Hoàn tất bàn giao" → confirm modal opens
2. Modal shows warning if undone tasks, info if all done
3. User clicks "Xác nhận hoàn tất" → `useCompleteHandoverSession.mutate({sessionId})`
4. RPC updates `handover_sessions.status='completed' + completed_at + completed_by`
5. On success: invalidate → refetch → `session.status === "completed"` → view re-renders in read-only mode (Checkbox disabled, Textarea disabled, complete button gone, AlertBanner.success at top)

### 5.5 Admin per-day task edit
1. Owner/manager clicks "Sửa task cho ngày này" → HandoverTasksEditorModal opens
2. User edits tasks (add/edit-label/delete) — each operation fires `useUpdateHandoverSessionTasks` with full updated array
3. RPC handles insert/update/delete based on task ID presence in payload
4. On each success: invalidate → modal stays open with refreshed list (refetch via React Query)
5. User closes modal when done

### 5.6 Settings impact
- After 3C.3 ships, owner/manager visits Settings → SidebarConfigForm's role matrix shows a new "Bàn giao" row automatically (NAV_ITEMS.map renders it)
- No code change in Settings module needed
- Per-user override modal also auto-includes "Bàn giao" checkbox for staff_or_above accounts

---

## 6. Error handling

| Scenario | Handling |
|---|---|
| Employee_viewer reaches HandoverView | Defense-in-depth gate: EmptyState.lock. NAV_ITEMS upstream already filters. |
| RPC fails (network / RLS) | `onError` → toast.danger with error message. State reverts via re-fetch. |
| Note > 1000 chars | Client validation: TextField shows error + "Lưu" never fires (handleBlur exits early). |
| User toggles task during in-flight save | savingTaskId disables that row; user can't double-fire. Other rows still toggleable. |
| Complete clicked while session has 0 tasks | Edge case — RPC accepts. Confirm modal shows "Đã hoàn thành tất cả 0 task" (acceptable text). |
| Session auto-created twice (race condition) | RPC uses `INSERT ... ON CONFLICT business_date DO NOTHING` semantics — see Phase 1 RPC source. Idempotent. |
| Admin edits a task that was just toggled in another session | Last-write-wins on the updateHandoverSessionTasks call. Refetch overwrites local state. |
| Complete during in-flight task save | `useCompleteHandoverSession.isPending` blocks button; also `savingTaskId` blocks checkbox toggles. Two flags, two surfaces, no overlap. |

---

## 7. File Manifest

### 7.1 New files (7)

| Path | Purpose | LOC est. |
|---|---|---|
| `src/hooks/mutations/use-handover-mutations.ts` | 4 mutation hooks | 140 |
| `src/features/handover/handover-view.tsx` | Container + role gate + composition | 150 |
| `src/features/handover/handover-shifts-summary.tsx` | Active staff count card | 60 |
| `src/features/handover/handover-checklist.tsx` | Checkbox list, auto-save | 120 |
| `src/features/handover/handover-note-editor.tsx` | Textarea save-on-blur | 100 |
| `src/features/handover/handover-complete-action.tsx` | Button + destructive confirm modal | 80 |
| `src/features/handover/handover-tasks-editor-modal.tsx` | Admin per-day editor (reuses slugifyTaskKey) | 200 |
| **Total** | | **~850** |

### 7.2 Modified files (3)

| Path | Change |
|---|---|
| `src/components/ui/icons.tsx` | Add `clipboardList: ClipboardList` (additive) |
| `src/features/navigation/navigation.ts` | Add `"handover"` to ViewKey union + NAV_ITEMS entry + DEFAULT_SIDEBAR_BY_ROLE for 3 roles (additive) |
| `src/app/page.tsx` | Add HandoverView import + dispatcher block for `view === "handover"` (~4 lines) |

### 7.3 Off-limits (NOT touched)

- All `database/**` (Phase 1 backend frozen)
- `src/lib/data/handover.ts` (data layer frozen — all functions ready)
- `src/lib/types.ts` (HandoverSession + HandoverTask + UserRole already defined)
- `src/hooks/queries/use-handover-query.ts` (query hook exists)
- `src/features/settings/task-key.ts` (T1 of 3C.2 — we IMPORT slugifyTaskKey but do not modify)
- All `src/features/{auth,dashboard,reports,pivot,expenses,shifts,cash,safe,settings}/**` (prior-phase features frozen)
- All Phase 2 primitives (Modal, TextField, Textarea, Select, Checkbox, AlertBanner, Card, Button, EmptyState, Badge, Spinner, Icon, Toast, Stepper)
- `docker-compose.yml`, `.env*`, `vitest.config.mts`, `tsconfig.json`

---

## 8. Implementation order (task projection)

Final decided in writing-plans. Rough projection (~5-6 tasks):

1. **T1**: icon (`clipboardList`) + nav additions (NAV_ITEMS + ViewKey + DEFAULT_SIDEBAR_BY_ROLE) + 4 mutation hooks
2. **T2**: HandoverChecklist + HandoverNoteEditor (the two main interactive parts)
3. **T3**: HandoverShiftsSummary + HandoverCompleteAction (the two simpler sub-components)
4. **T4**: HandoverTasksEditorModal (admin per-day editor — reuses slugifyTaskKey from 3C.2)
5. **T5**: HandoverView container + page.tsx wire + final verify:phase + tag `v4-phase-3c3` + (optional) tag `v4-phase-3c`

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Save-on-blur doesn't fire if user navigates away via sidebar before blurring | Medium | Browser fires `blur` on element removal in modern React. If reliability issue surfaces, fall back to explicit "Lưu ghi chú" button. Acceptable in MVP. |
| Concurrent task toggles by 2 staff members | Low | Single-shift handover assumed. Last-write-wins via RPC. React Query 30s staleTime + refetch on focus mitigates stale state. |
| User clicks Complete on a session with 0 tasks (edge case) | Low | Confirm modal handles it gracefully ("Đã hoàn thành tất cả 0 task. Xác nhận?"). User can still cancel. |
| `useShiftsQuery` may not exist for `HandoverShiftsSummary` | Medium | Check during T1 or T3 implementation. If missing, write fallback: static-text Card without count. Plan T3 should include the discovery + fallback path. |
| Cross-module import (`slugifyTaskKey` from settings) tight-couples handover to settings | Low | `task-key.ts` is a pure utility (no deps on settings UI). Could be moved to `src/lib/` later if needed. For now, the import is one-way + safe. |
| Settings role-matrix doesn't refresh after handover nav added | Low | Settings reads NAV_ITEMS as a module-level const; module re-import on next render shows the new entry. No code change needed. |
| Locking on complete is irreversible — user may complete by accident despite confirm | Medium | Destructive confirm with warning text. If un-complete is needed, defer to Phase 6 (new RPC). Document in spec §2 non-goals. |
| Toast feed gets noisy from 8-task auto-save sequence | Low | Each toggle fires 1 toast. User typically clicks tasks sequentially, so 8 toasts over 30s = fine. If problematic, could batch via debounce — defer. |
| Sort_order ties cause inconsistent task ordering across sessions | Low | Sort by `sort_order` then `task_key` (alphabetical fallback) — stable across renders. |

---

## 10. Success criteria

- [ ] `npm run verify:phase` exits 0 (75 Vitest + 50 pgTAP unchanged — no test additions)
- [ ] All 7 new files exist at spec-mandated paths
- [ ] `clipboardList` icon added additively to `icons.tsx`
- [ ] NAV_ITEMS additions: ViewKey + entry + DEFAULT_SIDEBAR_BY_ROLE for 3 roles
- [ ] 4 mutation hooks follow `use-cash-mutations.ts` template
- [ ] Owner/manager/staff_operator can: see "Bàn giao" sidebar item + render HandoverView + toggle tasks + edit note (save-on-blur) + click Complete
- [ ] Owner/manager only: "Sửa task cho ngày này" button visible + opens admin per-day editor
- [ ] Completed session locks all controls read-only
- [ ] Employee_viewer login: "Bàn giao" NOT in sidebar
- [ ] Settings page (3C.2): new "Bàn giao" row appears automatically in role matrix
- [ ] No off-limits files modified
- [ ] Commit history: ~5-6 commits, all with `Co-Authored-By: Claude Opus 4.7 (1M context)` footer
- [ ] Final tag `v4-phase-3c3` placed on HEAD
- [ ] Optional umbrella tag `v4-phase-3c` placed on the merge commit (closes Phase 3C)
- [ ] Phase 3C closed → next is Phase 4 (inventory) or Phase 5 (analytics) per master plan

---

## 11. References

- **Phase 1 backend** (frozen): `database/002_functions.sql:1384-1500` (handover RPCs)
- **Phase 1 data layer** (frozen): `src/lib/data/handover.ts` — loadHandoverSession, updateHandoverTask, updateHandoverNote, completeHandoverSession, updateHandoverDefaultTasks, updateHandoverSessionTasks
- **Phase 1 query hook** (frozen): `src/hooks/queries/use-handover-query.ts` — useHandoverQuery (stale 30s)
- **Phase 1 types** (frozen): `src/lib/types.ts` — HandoverSession, HandoverTask, UserRole
- **Phase 2 design system**: Modal compound, TextField, Textarea, Checkbox, AlertBanner, Card, Button, EmptyState, Badge, Spinner, Icon, Toast — all available
- **Phase 3A navigation**: `src/features/navigation/navigation.ts` — NAV_ITEMS, DEFAULT_SIDEBAR_BY_ROLE, ROLE_LABELS, getVisibleNav, canSee
- **Phase 3B.2b.i patterns**: Modal pattern (`opening-cash-modal.tsx`), mutation hook + invalidation (`use-cash-mutations.ts`)
- **Phase 3C.1**: SafeView container pattern (role gate + composition), AdjustSafeModal destructive confirm pattern
- **Phase 3C.2**: HandoverDefaultTasksEditor (for HandoverTasksEditorModal reference), slugifyTaskKey helper (reused via cross-module import)
- **v3 reference** (port-from):
  - `F:\Chill manager\v3\src\features\handover\end-of-day-wizard.tsx` (125 LOC, 3-step wizard — we simplify to single-page)
  - `F:\Chill manager\v3\src\features\handover\checklist-editor-modal.tsx` (149 LOC, dual-mode editor — we keep only the "today" mode here)

---

## 12. Out-of-scope notes (preserved for future)

- **Un-complete (re-open) session**: needs `un_complete_handover_session` RPC + audit-trail consideration. Defer to Phase 6 or beyond.
- **Past handover sessions browsing**: list view of completed sessions with date filter. Phase 6 cross-cutting feature.
- **Sequential task dependencies**: "task B requires task A" — out of scope. Each task is independent.
- **Required-task validation on complete**: forbid completion until specific tasks done. Marked as soft-warning in MVP.
- **Notification on incomplete handover at end-of-day**: cron + push notification. Phase 4+ when notification infra exists.
- **Photo evidence on tasks**: reuse FileUploadField primitive from 3C.1. Out of MVP.
- **Multi-shift handover**: morning shift hands to afternoon shift. Current model is one per business_date. Future enhancement.
- **AI-generated handover note summary**: pulls cash close + safe txns + payroll into a draft note. Phase 5+ analytics.
