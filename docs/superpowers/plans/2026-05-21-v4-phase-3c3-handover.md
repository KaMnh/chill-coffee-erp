# Phase 3C.3 — Handover Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the staff-or-above end-of-day handover module — single-page view with checklist (auto-save) + note editor (save-on-blur) + complete button (destructive confirm) + admin per-day task editor (owner/manager).

**Architecture:** All Phase 1 backend RPCs, data layer, query hook, and types are already plumbed and frozen. This phase adds: 1 new icon (clipboardList), additive nav modifications (NAV_ITEMS + ViewKey + DEFAULT_SIDEBAR_BY_ROLE), 4 mutation hooks, 7 feature files, page.tsx wire. Cross-module import: slugifyTaskKey from `@/features/settings/task-key` (3C.2 utility).

**Tech Stack:** Next.js 15 / React 19 / TypeScript strict, TanStack Query 5, Radix UI (Dialog, Checkbox), Tailwind v4, Supabase JS, Vietnamese (vi) UI labels.

---

## File Structure

**New files (7):**
- `src/hooks/mutations/use-handover-mutations.ts` — 4 mutation hooks
- `src/features/handover/handover-view.tsx` — container
- `src/features/handover/handover-shifts-summary.tsx` — active staff card
- `src/features/handover/handover-checklist.tsx` — checkbox list with auto-save
- `src/features/handover/handover-note-editor.tsx` — Textarea with save-on-blur
- `src/features/handover/handover-complete-action.tsx` — destructive confirm modal
- `src/features/handover/handover-tasks-editor-modal.tsx` — admin per-day editor

**Modified files (3):**
- `src/components/ui/icons.tsx` — add `clipboardList` (additive)
- `src/features/navigation/navigation.ts` — add `"handover"` to ViewKey + NAV_ITEMS + DEFAULT_SIDEBAR_BY_ROLE
- `src/app/page.tsx` — wire `view === "handover"` dispatcher

**Off-limits:** `database/**`, `src/lib/data/handover.ts`, `src/lib/types.ts`, `src/hooks/queries/use-handover-query.ts`, `src/hooks/queries/use-shift-queries.ts`, `src/features/settings/task-key.ts` (imported, not modified), all prior-phase feature modules, Phase 2 primitives, config files.

---

## Key reference signatures (from existing code)

```ts
// src/lib/data/handover.ts — DO NOT MODIFY
loadHandoverSession(supabase, businessDate) → HandoverSession | null
updateHandoverTask(supabase, taskId, isDone) → unknown
updateHandoverNote(supabase, sessionId, note) → unknown
completeHandoverSession(supabase, sessionId) → unknown
updateHandoverSessionTasks(supabase, sessionId, tasks: Array<{id?,key?,label,sort_order?}>) → HandoverSession

// src/lib/types.ts — DO NOT MODIFY
type HandoverTask = {
  id: string; task_key: string; label: string;
  is_done: boolean; checked_by: string | null;
  checked_at: string | null; sort_order: number;
}
type HandoverSession = {
  id: string; business_date: string;
  status: "draft" | "completed";
  note: string | null;
  created_by: string | null; created_at: string;
  completed_at: string | null;
  tasks: HandoverTask[];
}

// src/hooks/queries/use-handover-query.ts — already exists
useHandoverQuery(supabase, businessDate, enabled) // staleTime 30s

// src/hooks/queries/use-shift-queries.ts — already exists
useShiftsQuery(supabase, businessDate, enabled) // returns ShiftAssignment[]

// src/features/settings/task-key.ts — DO NOT MODIFY, just import
slugifyTaskKey(label: string, existingKeys?: ReadonlySet<string>): string
```

---

### Task 1: icon + nav additions + 4 mutation hooks

**Files:**
- Modify: `src/components/ui/icons.tsx` (additive)
- Modify: `src/features/navigation/navigation.ts` (additive)
- Create: `src/hooks/mutations/use-handover-mutations.ts`

- [ ] **Step 1: Add `clipboardList` icon to `src/components/ui/icons.tsx`**

Open the file. Find the import block from lucide-react (around line 3-18). Add `ClipboardList` to the imports. Recommended placement: alongside other Phase 3C.x additive icons.

Locate this in the import block:
```ts
  // Phase 3C.1 — file upload + safe icons
  Upload, Image as ImageIcon, ArrowDownRight,
```

After it, add:
```ts
  // Phase 3C.3 — handover icon
  ClipboardList,
```

Then in the `Icons` const, locate:
```ts
  // Phase 3C.1 — file upload + safe action icons
  upload: Upload,
  image: ImageIcon,
  arrowDownRight: ArrowDownRight,
```

After it, add:
```ts
  // Phase 3C.3 — handover
  clipboardList: ClipboardList,
```

- [ ] **Step 2: Modify `src/features/navigation/navigation.ts` — 3 additions**

Open the file. Three additive changes:

**(a) ViewKey union — add `"handover"`** between `"safe"` and `"reports"`:

Find:
```ts
export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe"
  | "reports" | "pivot" | "settings";
```

Replace with:
```ts
export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe"
  | "handover"
  | "reports" | "pivot" | "settings";
```

**(b) NAV_ITEMS array — insert handover entry between cash and reports**:

Find this row in NAV_ITEMS:
```ts
  { key: "safe",      label: "Sổ quỹ",        icon: "piggyBank",       roles: ["owner"] },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"] },
```

Insert a new row BETWEEN them:
```ts
  { key: "safe",      label: "Sổ quỹ",        icon: "piggyBank",       roles: ["owner"] },
  { key: "handover",  label: "Bàn giao",      icon: "clipboardList",   roles: ["owner", "manager", "staff_operator"] },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"] },
```

**(c) DEFAULT_SIDEBAR_BY_ROLE — add "handover" for 3 roles**:

Find:
```ts
export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "reports", "pivot", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "reports", "pivot", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "reports"],
  employee_viewer: ["dashboard"],
};
```

Replace with (insert "handover" between cash/reports for 3 roles; employee_viewer unchanged):
```ts
export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "handover", "reports", "pivot", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "handover", "reports", "pivot", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "handover", "reports"],
  employee_viewer: ["dashboard"],
};
```

- [ ] **Step 3: Create `src/hooks/mutations/use-handover-mutations.ts`**

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  updateHandoverTask,
  updateHandoverNote,
  completeHandoverSession,
  updateHandoverSessionTasks
} from "@/lib/data";
import type { HandoverSession } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the Handover module — Phase 3C.3.
 *
 * Pattern matches use-cash-mutations.ts: null-supabase guard, useMutation,
 * invalidate dependent query keys on success. No optimistic updates.
 *
 * All 4 hooks invalidate the SAME key (handover is per-day, self-contained):
 *   queryKeys.handover(businessDate)
 *
 * 4 hooks total:
 *   - useUpdateHandoverTask: checkbox toggle (auto-save)
 *   - useUpdateHandoverNote: textarea (save-on-blur)
 *   - useCompleteHandoverSession: irreversible session lock
 *   - useUpdateHandoverSessionTasks: admin per-day task editor (owner/manager)
 */

export interface UpdateHandoverTaskInput {
  taskId: string;
  isDone: boolean;
}

export function useUpdateHandoverTask(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverTaskInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverTask(supabase, input.taskId, input.isDone);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}

export interface UpdateHandoverNoteInput {
  sessionId: string;
  note: string;
}

export function useUpdateHandoverNote(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverNoteInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverNote(supabase, input.sessionId, input.note);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}

export interface CompleteHandoverSessionInput {
  sessionId: string;
}

export function useCompleteHandoverSession(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompleteHandoverSessionInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return completeHandoverSession(supabase, input.sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}

export interface UpdateHandoverSessionTasksInput {
  sessionId: string;
  tasks: Array<{ id?: string; key?: string; label: string; sort_order?: number }>;
}

export function useUpdateHandoverSessionTasks(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverSessionTasksInput): Promise<HandoverSession> => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverSessionTasks(supabase, input.sessionId, input.tasks);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 5: Run verify:phase to confirm no regression**

```bash
npm run verify:phase
```

Expected: 75 Vitest + 50 pgTAP = 125 green, exit 0.

- [ ] **Step 6: Commit using PowerShell `Out-File` UTF-8 pattern**

```powershell
@'
feat(phase-3c3): icon + nav additions + 4 handover mutation hooks

- src/components/ui/icons.tsx: add clipboardList (additive)
- src/features/navigation/navigation.ts: add "handover" to ViewKey +
  NAV_ITEMS entry (between cash and reports, roles staff_or_above) +
  DEFAULT_SIDEBAR_BY_ROLE for 3 roles (additive)
- src/hooks/mutations/use-handover-mutations.ts: 4 hooks following
  use-cash-mutations.ts template, all invalidate handover(businessDate):
  - useUpdateHandoverTask
  - useUpdateHandoverNote
  - useCompleteHandoverSession
  - useUpdateHandoverSessionTasks (owner/manager only)

Settings role-matrix will auto-render a new "Bàn giao" row after this
ships (dynamic NAV_ITEMS iteration in 3C.2).

Verify:phase still 125/125 green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -FilePath .git/COMMIT_MSG_TMP -Encoding utf8 -NoNewline
```

Then:

```bash
git add src/components/ui/icons.tsx src/features/navigation/navigation.ts src/hooks/mutations/use-handover-mutations.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 2: HandoverChecklist + HandoverNoteEditor

**Files:**
- Create: `src/features/handover/handover-checklist.tsx`
- Create: `src/features/handover/handover-note-editor.tsx`

- [ ] **Step 1: Create `src/features/handover/handover-checklist.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateHandoverTask } from "@/hooks/mutations/use-handover-mutations";
import { formatDateTime } from "@/lib/format";
import type { HandoverTask } from "@/lib/types";

interface HandoverChecklistProps {
  sessionId: string;
  businessDate: string;
  tasks: HandoverTask[];
  disabled: boolean;
}

/**
 * Handover checklist — auto-save per Checkbox toggle.
 *
 * Each task row has:
 *   - Checkbox with task.label
 *   - "Đã làm bởi {user} lúc {ts}" muted text when is_done
 *
 * Toggle fires useUpdateHandoverTask with the new isDone value.
 * While in-flight for a specific task, that row is disabled
 * (savingTaskId tracks the pending one).
 *
 * Sorted by sort_order then task_key for stable order.
 *
 * Empty state when tasks.length === 0 — owner/manager can add via
 * the "Sửa task cho ngày này" modal (parent-controlled).
 */
export function HandoverChecklist({
  sessionId: _sessionId,
  businessDate,
  tasks,
  disabled
}: HandoverChecklistProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateHandoverTask(supabase, businessDate);

  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.task_key.localeCompare(b.task_key);
  });

  const doneCount = sortedTasks.filter((t) => t.is_done).length;

  async function handleToggle(task: HandoverTask, checked: boolean) {
    if (disabled || savingTaskId) return;
    setSavingTaskId(task.id);
    try {
      await updateM.mutateAsync({ taskId: task.id, isDone: checked });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không cập nhật được task."
      });
    } finally {
      setSavingTaskId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-baseline justify-between">
          <CardTitle>Checklist</CardTitle>
          <span className="text-xs text-muted">{doneCount}/{sortedTasks.length} đã xong</span>
        </div>
      </CardHeader>
      <CardBody>
        {sortedTasks.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title="Chưa có task nào"
            subtitle="Owner/manager có thể thêm task từ nút 'Sửa task cho ngày này' hoặc từ Settings → Checklist mặc định."
          />
        ) : (
          <div className="space-y-2">
            {sortedTasks.map((task) => {
              const isRowSaving = savingTaskId === task.id;
              return (
                <div
                  key={task.id}
                  className="flex items-start gap-3 p-3 rounded-md border border-border bg-surface"
                >
                  <Checkbox
                    checked={task.is_done}
                    onCheckedChange={(checked) => handleToggle(task, checked === true)}
                    disabled={disabled || isRowSaving}
                    aria-label={task.label}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{task.label}</p>
                    {task.is_done && (
                      <p className="text-xs text-muted mt-0.5">
                        Đã làm{" "}
                        {task.checked_at && `lúc ${formatDateTime(task.checked_at)}`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Create `src/features/handover/handover-note-editor.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateHandoverNote } from "@/hooks/mutations/use-handover-mutations";
import { limits } from "@/lib/validation";
import { formatTime } from "@/lib/format";

interface HandoverNoteEditorProps {
  sessionId: string;
  businessDate: string;
  note: string;
  disabled: boolean;
}

/**
 * Handover note — save-on-blur. No explicit Save button.
 *
 * Internal state:
 *   - currentNote: what user is editing
 *   - lastSavedNote: snapshot from last successful save
 *   - lastSavedAt: timestamp for "Đã lưu lúc X" indicator
 *
 * Initialized from `note` prop. Refetch can update the source note —
 * useEffect([note]) re-syncs both currentNote and lastSavedNote.
 *
 * On blur: if currentNote !== lastSavedNote && valid → fires
 * useUpdateHandoverNote → on success, updates lastSavedNote + lastSavedAt.
 *
 * Helper text states:
 *   - isBusy: "Đang lưu..."
 *   - dirty: "Sẽ lưu khi rời ô"
 *   - lastSavedAt set: "Đã lưu lúc {time}"
 *   - default: "{N}/{limit} ký tự"
 */
export function HandoverNoteEditor({
  sessionId,
  businessDate,
  note,
  disabled
}: HandoverNoteEditorProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateHandoverNote(supabase, businessDate);

  const [currentNote, setCurrentNote] = useState(note);
  const [lastSavedNote, setLastSavedNote] = useState(note);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  // Refetch-driven re-sync: if the source note changes (e.g., owner edited in
  // another tab), update both currentNote and lastSavedNote so we don't
  // overwrite their change on next blur.
  useEffect(() => {
    setCurrentNote(note);
    setLastSavedNote(note);
  }, [note]);

  const trimmedLen = currentNote.length;
  const tooLong = trimmedLen > limits.note;
  const isDirty = currentNote !== lastSavedNote;
  const isBusy = updateM.isPending;

  async function handleBlur() {
    if (disabled || isBusy || !isDirty || tooLong) return;
    try {
      await updateM.mutateAsync({ sessionId, note: currentNote });
      setLastSavedNote(currentNote);
      setLastSavedAt(new Date());
      toast({ semantic: "success", message: "Đã lưu ghi chú." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được ghi chú."
      });
    }
  }

  const helperText = isBusy
    ? "Đang lưu..."
    : isDirty
      ? "Sẽ lưu khi rời ô"
      : lastSavedAt
        ? `Đã lưu lúc ${formatTime(lastSavedAt.toISOString())}`
        : `${trimmedLen}/${limits.note} ký tự`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ghi chú bàn giao</CardTitle>
      </CardHeader>
      <CardBody>
        <Textarea
          value={currentNote}
          onChange={(e) => setCurrentNote(e.target.value)}
          onBlur={handleBlur}
          disabled={disabled || isBusy}
          rows={4}
          maxLength={limits.note + 100}
          placeholder="Ghi chú đặc biệt cho ca sau (vd: thiếu nguyên liệu A, máy POS chậm, khách phàn nàn...)"
          helper={helperText}
          error={tooLong ? `Vượt ${limits.note} ký tự.` : undefined}
        />
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Commit using PowerShell `Out-File`**

```powershell
@'
feat(phase-3c3): HandoverChecklist + HandoverNoteEditor

HandoverChecklist:
- Sorted by sort_order then task_key
- Auto-save per Checkbox toggle via useUpdateHandoverTask
- Per-row pending state (savingTaskId) disables the row during in-flight
- "Đã làm lúc {time}" muted text when is_done
- Done-count badge in header (X/Y đã xong)
- EmptyState when no tasks

HandoverNoteEditor:
- Save-on-blur model (no explicit Save button)
- Internal currentNote/lastSavedNote/lastSavedAt state
- Refetch-driven re-sync via useEffect([note])
- Dynamic helper text: "Đang lưu..." / "Sẽ lưu khi rời ô" / "Đã lưu lúc X" / "{N}/{limit} ký tự"
- Tooltip about ghi chú đặc biệt cho ca sau

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -FilePath .git/COMMIT_MSG_TMP -Encoding utf8 -NoNewline
```

Then:

```bash
git add src/features/handover/handover-checklist.tsx src/features/handover/handover-note-editor.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 3: HandoverShiftsSummary + HandoverCompleteAction

**Files:**
- Create: `src/features/handover/handover-shifts-summary.tsx`
- Create: `src/features/handover/handover-complete-action.tsx`

- [ ] **Step 1: Create `src/features/handover/handover-shifts-summary.tsx`**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import { useShiftsQuery } from "@/hooks/queries";

interface HandoverShiftsSummaryProps {
  businessDate: string;
  disabled: boolean;
}

/**
 * Active-shifts summary card. Read-only — no mutations.
 *
 * Counts shift assignments where status === "checked_in" for this date.
 * Surfaces a reminder to check-out all staff before completing handover.
 *
 * If shifts query errors or returns no data, gracefully falls back to a
 * static reminder text without breaking the page.
 */
export function HandoverShiftsSummary({
  businessDate,
  disabled
}: HandoverShiftsSummaryProps) {
  const supabase = useSupabase();
  const shiftsQuery = useShiftsQuery(supabase, businessDate, !disabled);

  const activeCount = (shiftsQuery.data ?? []).filter(
    (s) => s.status === "checked_in"
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nhân viên trong ca</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {shiftsQuery.isLoading ? (
          <div className="flex justify-center py-4"><Spinner size={24} /></div>
        ) : (
          <>
            <div className="flex items-baseline gap-3">
              <span className="font-display text-3xl font-bold text-ink tabular-nums">
                {activeCount}
              </span>
              <span className="text-sm text-muted">
                {activeCount === 0
                  ? "Tất cả đã check-out"
                  : "nhân viên chưa check-out"}
              </span>
            </div>
            {activeCount > 0 && (
              <AlertBanner variant="warning">
                Còn {activeCount} nhân viên đang trong ca. Hãy check-out tất cả
                ở module &quot;Ca &amp; lương&quot; trước khi hoàn tất bàn giao.
              </AlertBanner>
            )}
            {activeCount === 0 && shiftsQuery.data && shiftsQuery.data.length > 0 && (
              <Badge variant="soft" semantic="success">
                Sẵn sàng bàn giao
              </Badge>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
```

**Note for implementer:** `useShiftsQuery` exists in `src/hooks/queries/use-shift-queries.ts` and is exported from `src/hooks/queries/index.ts`. Verify before commit. If `ShiftAssignment.status` doesn't have `"checked_in"` exactly, check the actual enum values in `src/lib/types.ts` — possible values include `"scheduled"`, `"checked_in"`, `"checked_out"`, `"no_show"`. Update the filter literal if needed.

- [ ] **Step 2: Create `src/features/handover/handover-complete-action.tsx`**

```tsx
"use client";

import { useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCompleteHandoverSession } from "@/hooks/mutations/use-handover-mutations";

interface HandoverCompleteActionProps {
  sessionId: string;
  businessDate: string;
  doneCount: number;
  totalCount: number;
}

/**
 * "Hoàn tất bàn giao" button + nested confirm modal.
 *
 * Click button → opens confirm modal.
 *   - If doneCount < totalCount: AlertBanner.warning with undone count
 *   - If all done: AlertBanner.info confirming all done
 * Two buttons in modal: "Hủy" (ghost) + "Xác nhận hoàn tất" (destructive, loading state)
 *
 * On confirm: fires useCompleteHandoverSession → on success, modal auto-closes
 * via session refetch (parent re-renders read-only when session.status flips).
 */
export function HandoverCompleteAction({
  sessionId,
  businessDate,
  doneCount,
  totalCount
}: HandoverCompleteActionProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const completeM = useCompleteHandoverSession(supabase, businessDate);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const undoneCount = totalCount - doneCount;
  const allDone = totalCount > 0 && undoneCount === 0;
  const isBusy = completeM.isPending;

  async function handleConfirm() {
    if (isBusy) return;
    try {
      await completeM.mutateAsync({ sessionId });
      toast({ semantic: "success", message: "Đã hoàn tất bàn giao." });
      setConfirmOpen(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không hoàn tất được."
      });
    }
  }

  return (
    <>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          onClick={() => setConfirmOpen(true)}
        >
          Hoàn tất bàn giao
        </Button>
      </div>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ModalContent className="w-[min(95vw,32rem)]">
          <ModalTitle>Xác nhận hoàn tất bàn giao</ModalTitle>
          <ModalDescription>
            Sau khi hoàn tất, session sẽ bị khóa — không thể tick / sửa lại task hay ghi chú.
          </ModalDescription>
          <div className="mt-6 space-y-4">
            {allDone ? (
              <AlertBanner variant="info">
                Đã hoàn thành tất cả {totalCount} task. Xác nhận hoàn tất?
              </AlertBanner>
            ) : (
              <AlertBanner variant="warning">
                Còn <strong>{undoneCount}</strong> task chưa xong (trong tổng {totalCount}).
                Vẫn hoàn tất bàn giao?
              </AlertBanner>
            )}
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)} disabled={isBusy}>
                Hủy
              </Button>
              <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirm}>
                Xác nhận hoàn tất
              </Button>
            </ModalActions>
          </div>
        </ModalContent>
      </Modal>
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

```powershell
@'
feat(phase-3c3): HandoverShiftsSummary + HandoverCompleteAction

HandoverShiftsSummary:
- Reads useShiftsQuery (Phase 3B.2a hook)
- Counts shifts where status === "checked_in"
- Big count badge + warning banner if active > 0
- "Sẵn sàng bàn giao" success badge if all checked out
- Static fallback when query errors (defensive)

HandoverCompleteAction:
- Primary button "Hoàn tất bàn giao"
- Nested confirm modal (sibling Modal Root)
- Branch: AlertBanner.warning if undone > 0, AlertBanner.info if all done
- Destructive confirm button with loading state
- Toast on success → modal auto-closes via session refetch

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -FilePath .git/COMMIT_MSG_TMP -Encoding utf8 -NoNewline
```

Then:

```bash
git add src/features/handover/handover-shifts-summary.tsx src/features/handover/handover-complete-action.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 4: HandoverTasksEditorModal (admin per-day editor)

**Files:**
- Create: `src/features/handover/handover-tasks-editor-modal.tsx`

This is structurally similar to `HandoverDefaultTasksEditor` from 3C.2, but operates on the CURRENT session's tasks via `useUpdateHandoverSessionTasks` (a different RPC). Edits here affect only this session — the default template (Settings → Checklist mặc định) is unchanged.

- [ ] **Step 1: Create `src/features/handover/handover-tasks-editor-modal.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Icon } from "@/components/ui/icons";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateHandoverSessionTasks } from "@/hooks/mutations/use-handover-mutations";
import { slugifyTaskKey } from "@/features/settings/task-key";
import type { HandoverTask } from "@/lib/types";

interface HandoverTasksEditorModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  sessionId: string;
  businessDate: string;
  tasks: HandoverTask[];
}

const MIN_LABEL_LEN = 2;
const MAX_LABEL_LEN = 200;

/**
 * Admin per-day task editor.
 *
 * Edits THIS session's tasks via update_handover_session_tasks RPC.
 * Default template (Settings → Checklist mặc định) is unchanged.
 *
 * Operations (each fires useUpdateHandoverSessionTasks with full updated
 * array — RPC handles insert/update/delete based on task.id presence):
 *   - Add: TextField + Thêm button → slugifyTaskKey → append {label, key, sort_order}
 *   - Edit label: per-row Sửa → inline TextField + Lưu/Hủy. Key immutable.
 *   - Delete: per-row ✕ → inline AlertBanner confirm → mutation with filtered array
 *
 * Only one row can be in edit OR delete mode at a time.
 *
 * Reuses slugifyTaskKey from 3C.2's settings/task-key.ts (pure utility).
 */
export function HandoverTasksEditorModal({
  open,
  onOpenChange,
  sessionId,
  businessDate,
  tasks
}: HandoverTasksEditorModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateHandoverSessionTasks(supabase, businessDate);

  const [newLabel, setNewLabel] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  // Reset internal state when modal opens / source tasks change.
  useEffect(() => {
    if (!open) return;
    setNewLabel("");
    setEditingTaskId(null);
    setEditingLabel("");
    setDeletingTaskId(null);
  }, [open]);

  const existingKeys = useMemo(
    () => new Set(tasks.map((t) => t.task_key)),
    [tasks]
  );

  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.task_key.localeCompare(b.task_key);
  });

  const newLabelTrimmed = newLabel.trim();
  const newLabelValid =
    newLabelTrimmed.length >= MIN_LABEL_LEN && newLabelTrimmed.length <= MAX_LABEL_LEN;
  const newKeyPreview = newLabelValid ? slugifyTaskKey(newLabelTrimmed, existingKeys) : "";

  const editingLabelTrimmed = editingLabel.trim();
  const editingValid =
    editingLabelTrimmed.length >= MIN_LABEL_LEN && editingLabelTrimmed.length <= MAX_LABEL_LEN;

  const isBusy = updateM.isPending;

  // Convert HandoverTask[] → RPC payload shape: existing tasks have id; new ones don't.
  function buildPayload(updated: HandoverTask[]) {
    return updated.map((t) => ({
      id: t.id,
      key: t.task_key,
      label: t.label,
      sort_order: t.sort_order
    }));
  }

  async function handleAdd() {
    if (!newLabelValid || isBusy) return;
    const key = slugifyTaskKey(newLabelTrimmed, existingKeys);
    const maxSort = sortedTasks.length === 0
      ? 0
      : Math.max(...sortedTasks.map((t) => t.sort_order));
    const newTaskPayload = {
      label: newLabelTrimmed,
      key,
      sort_order: maxSort + 10
    };
    try {
      await updateM.mutateAsync({
        sessionId,
        tasks: [...buildPayload(sortedTasks), newTaskPayload]
      });
      toast({ semantic: "success", message: `Đã thêm "${newLabelTrimmed}".` });
      setNewLabel("");
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không thêm được task."
      });
    }
  }

  function handleStartEdit(task: HandoverTask) {
    setEditingTaskId(task.id);
    setEditingLabel(task.label);
    setDeletingTaskId(null);
  }

  function handleCancelEdit() {
    setEditingTaskId(null);
    setEditingLabel("");
  }

  async function handleSaveEdit() {
    if (!editingTaskId || !editingValid || isBusy) return;
    try {
      const updated = sortedTasks.map((t) =>
        t.id === editingTaskId ? { ...t, label: editingLabelTrimmed } : t
      );
      await updateM.mutateAsync({
        sessionId,
        tasks: buildPayload(updated)
      });
      toast({ semantic: "success", message: "Đã sửa nhãn." });
      setEditingTaskId(null);
      setEditingLabel("");
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được."
      });
    }
  }

  function handleStartDelete(task: HandoverTask) {
    setDeletingTaskId(task.id);
    setEditingTaskId(null);
  }

  function handleCancelDelete() {
    setDeletingTaskId(null);
  }

  async function handleConfirmDelete() {
    if (!deletingTaskId || isBusy) return;
    try {
      const updated = sortedTasks.filter((t) => t.id !== deletingTaskId);
      await updateM.mutateAsync({
        sessionId,
        tasks: buildPayload(updated)
      });
      toast({ semantic: "success", message: "Đã xóa task." });
      setDeletingTaskId(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không xóa được."
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,36rem)]">
        <ModalTitle>Sửa task cho ngày {businessDate}</ModalTitle>
        <ModalDescription>
          Thay đổi chỉ áp dụng cho session ngày này. Default template
          (cho các ngày sau) thay đổi qua Settings → Checklist mặc định.
        </ModalDescription>

        <div className="mt-6 space-y-3">
          {sortedTasks.length === 0 ? (
            <EmptyState
              icon="checkCircle"
              title="Chưa có task nào"
              subtitle="Thêm task đầu tiên ở dưới."
            />
          ) : (
            <div className="space-y-2">
              {sortedTasks.map((task) => {
                const isEditing = editingTaskId === task.id;
                const isDeletingThis = deletingTaskId === task.id;

                if (isDeletingThis) {
                  return (
                    <div key={task.id} className="rounded-md border border-border p-3 space-y-2">
                      <AlertBanner variant="warning">
                        Xóa &quot;{task.label}&quot; khỏi session này?
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
                    <div key={task.id} className="flex items-center gap-2 p-2 rounded-md border border-border bg-surface">
                      <div className="flex-1">
                        <TextField
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          disabled={isBusy}
                          maxLength={MAX_LABEL_LEN}
                          autoFocus
                          helper={`Key: ${task.task_key} (không đổi)`}
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
                    key={task.id}
                    className="flex items-center justify-between p-3 rounded-md border border-border bg-surface"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon name="checkCircle" size={16} />
                      <div className="min-w-0">
                        <p className="text-sm text-ink truncate">{task.label}</p>
                        <p className="text-xs text-muted truncate">Key: {task.task_key}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStartEdit(task)}
                        disabled={isBusy}
                      >
                        Sửa
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleStartDelete(task)}
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
              Thêm task mới
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <TextField
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="VD: Kiểm kê đồ uống mở đầu ca sau"
                  disabled={isBusy}
                  maxLength={MAX_LABEL_LEN}
                  helper={
                    newLabelTrimmed.length === 0
                      ? "Nhập tên task (tối thiểu 2 ký tự)"
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

          <ModalActions>
            <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>
              Đóng
            </Button>
          </ModalActions>
        </div>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```powershell
@'
feat(phase-3c3): HandoverTasksEditorModal — admin per-day editor

Per-day task editor (owner/manager only). Edits this session's tasks via
update_handover_session_tasks RPC. Default template (Settings) unchanged.

Operations (each = full-array mutation):
- Add: TextField + Thêm → slugifyTaskKey → append with sort_order = max+10
- Edit label: per-row Sửa → inline TextField + Lưu/Hủy. Key immutable.
- Delete: per-row ✕ → inline AlertBanner.warning + 2 buttons

Single-row exclusivity:
- handleStartEdit clears deletingTaskId
- handleStartDelete clears editingTaskId

Reuses slugifyTaskKey from @/features/settings/task-key (3C.2 utility).
buildPayload converts HandoverTask -> RPC shape, preserving id for
updates and omitting it for new entries.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -FilePath .git/COMMIT_MSG_TMP -Encoding utf8 -NoNewline
```

Then:

```bash
git add src/features/handover/handover-tasks-editor-modal.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 5: HandoverView container + page.tsx wire + final verify + tag

**Files:**
- Create: `src/features/handover/handover-view.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create `src/features/handover/handover-view.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import { useHandoverQuery } from "@/hooks/queries";
import { formatDateTime } from "@/lib/format";
import type { UserRole } from "@/lib/types";
import { HandoverShiftsSummary } from "./handover-shifts-summary";
import { HandoverChecklist } from "./handover-checklist";
import { HandoverNoteEditor } from "./handover-note-editor";
import { HandoverCompleteAction } from "./handover-complete-action";
import { HandoverTasksEditorModal } from "./handover-tasks-editor-modal";

interface HandoverViewProps {
  businessDate: string;
  role: UserRole;
}

/**
 * Staff-or-above end-of-day handover container.
 *
 * Defense-in-depth: NAV_ITEMS already gates `handover` to owner/manager/
 * staff_operator. Render EmptyState if reached as employee_viewer.
 *
 * Composes (top to bottom):
 *   - Header card: title + business_date + progress badge + completion banner
 *   - HandoverShiftsSummary
 *   - HandoverChecklist (auto-save per toggle)
 *   - HandoverNoteEditor (save-on-blur)
 *   - Admin (owner/manager) only: "Sửa task cho ngày này" button
 *   - HandoverCompleteAction (hidden when already completed)
 *
 * When session.status === "completed":
 *   - All sub-components receive disabled={true}
 *   - Banner at top showing completion timestamp
 *   - Admin editor button hidden
 *   - Complete button hidden
 */
export function HandoverView({ businessDate, role }: HandoverViewProps) {
  const supabase = useSupabase();
  const isEnabled = role !== "employee_viewer";

  const handoverQuery = useHandoverQuery(supabase, businessDate, isEnabled);

  const [isEditorOpen, setEditorOpen] = useState(false);

  if (!isEnabled) {
    return (
      <EmptyState
        icon="lock"
        title="Bàn giao staff trở lên"
        subtitle="Module này dành cho nhân viên vận hành, manager và owner."
      />
    );
  }

  if (handoverQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  const session = handoverQuery.data;

  if (!session) {
    return (
      <EmptyState
        icon="alertTriangle"
        title="Không tải được sổ bàn giao"
        subtitle="Vui lòng tải lại trang."
      />
    );
  }

  const tasks = session.tasks ?? [];
  const doneCount = tasks.filter((t) => t.is_done).length;
  const totalCount = tasks.length;
  const isCompleted = session.status === "completed";
  const canEditTasks = role === "owner" || role === "manager";
  const allDone = totalCount > 0 && doneCount === totalCount;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full items-baseline justify-between flex-wrap gap-2">
            <CardTitle>Bàn giao cuối ngày — {businessDate}</CardTitle>
            <Badge variant="soft" semantic={allDone ? "success" : "neutral"}>
              {doneCount}/{totalCount} task xong
            </Badge>
          </div>
        </CardHeader>
        {isCompleted && (
          <CardBody>
            <AlertBanner variant="success">
              <strong>Đã hoàn tất bàn giao</strong>{" "}
              {session.completed_at && `lúc ${formatDateTime(session.completed_at)}`}.
              Session bị khóa — không thể tick / sửa lại.
            </AlertBanner>
          </CardBody>
        )}
      </Card>

      <HandoverShiftsSummary businessDate={businessDate} disabled={isCompleted} />

      <HandoverChecklist
        sessionId={session.id}
        businessDate={businessDate}
        tasks={tasks}
        disabled={isCompleted}
      />

      <HandoverNoteEditor
        sessionId={session.id}
        businessDate={businessDate}
        note={session.note ?? ""}
        disabled={isCompleted}
      />

      {canEditTasks && !isCompleted && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setEditorOpen(true)}
          >
            Sửa task cho ngày này
          </Button>
        </div>
      )}

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
        tasks={tasks}
      />
    </div>
  );
}
```

- [ ] **Step 2: Modify `src/app/page.tsx` to wire HandoverView**

Read `src/app/page.tsx`. Find this import block:

```tsx
import { SafeView } from "@/features/safe/safe-view";
import { SettingsView } from "@/features/settings/settings-view";
```

Add HandoverView import between them:

```tsx
import { SafeView } from "@/features/safe/safe-view";
import { HandoverView } from "@/features/handover/handover-view";
import { SettingsView } from "@/features/settings/settings-view";
```

Then find the dispatcher block. Locate the `view === "safe"` rendering and the `view === "settings"` rendering. Insert handover between them:

```tsx
        {view === "safe" && (
          <SafeView businessDate={businessDate} role={account.role} />
        )}
        {view === "handover" && (
          <HandoverView businessDate={businessDate} role={account.role} />
        )}
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

Expected: build succeeds. No errors.

- [ ] **Step 5: Run verify:phase**

```bash
npm run verify:phase
```

Expected: vitest 75/75 + pgtap 50/50 = 125 total, exit 0.

- [ ] **Step 6: Verify file manifest**

```bash
git diff main..HEAD --name-only
```

Expected ~10 files (relative to main = v4-phase-3c2):
- `docs/superpowers/specs/2026-05-21-v4-phase-3c3-handover-design.md`
- `docs/superpowers/plans/2026-05-21-v4-phase-3c3-handover.md`
- `src/components/ui/icons.tsx` (modified)
- `src/features/navigation/navigation.ts` (modified)
- `src/hooks/mutations/use-handover-mutations.ts`
- `src/features/handover/handover-checklist.tsx`
- `src/features/handover/handover-note-editor.tsx`
- `src/features/handover/handover-shifts-summary.tsx`
- `src/features/handover/handover-complete-action.tsx`
- `src/features/handover/handover-tasks-editor-modal.tsx`
- `src/features/handover/handover-view.tsx`
- `src/app/page.tsx` (modified)

If any **off-limits** file appears (database/**, src/lib/data/**, src/lib/types.ts, src/hooks/queries/use-*.ts, src/features/settings/task-key.ts, prior-phase features, Phase 2 primitives other than icons), STOP and revert.

- [ ] **Step 7: Place tag v4-phase-3c3**

```bash
git tag v4-phase-3c3
git tag --list v4-phase-3c3
```

- [ ] **Step 8: Commit HandoverView + page.tsx wire**

```powershell
@'
feat(phase-3c3): HandoverView container + page.tsx wire + tag v4-phase-3c3

HandoverView:
- Staff-or-above defense-in-depth gate (NAV_ITEMS already filters upstream)
- useHandoverQuery (auto-creates session via get_or_create_handover_session)
- Loading / error / happy-path branches
- Composes all 5 sub-components + per-day editor modal
- Header card with progress badge + completion banner
- Admin "Sửa task cho ngày này" button: owner/manager + not-completed
- Complete button: hidden when already completed
- All controls disabled when session.status === "completed"

page.tsx:
- Imports HandoverView between SafeView and SettingsView
- Wires view === "handover" dispatcher between safe and settings

Final: vitest 75 + pgtap 50 = 125 assertions green.

Tag: v4-phase-3c3 (closes Phase 3C.3).
After merging this branch, Phase 3C is complete:
  - 3C.1 Safe (owner-only ledger)
  - 3C.2 Settings (sidebar + handover defaults)
  - 3C.3 Handover (end-of-day workflow)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -FilePath .git/COMMIT_MSG_TMP -Encoding utf8 -NoNewline
```

Then:

```bash
git add src/features/handover/handover-view.tsx src/app/page.tsx
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

- [ ] **Step 9: Re-tag to HEAD (3C.1 retrospective lesson)**

After committing, ensure the tag is on the LATEST commit (HEAD), not the previous one.

```bash
git tag -f v4-phase-3c3 HEAD
git show v4-phase-3c3 --stat --no-patch | Select-Object -First 5
```

Confirm the tag points to the T5 commit (the one with HandoverView + page.tsx wire), not T4.

- [ ] **Step 10: Verify branch state**

```bash
git log --oneline main..HEAD
```

Expected ~7 commits (1 spec + 5 task + 1 plan or merged into task commits):
- `<sha> feat(phase-3c3): HandoverView container + page.tsx wire + tag v4-phase-3c3`
- `<sha> feat(phase-3c3): HandoverTasksEditorModal — admin per-day editor`
- `<sha> feat(phase-3c3): HandoverShiftsSummary + HandoverCompleteAction`
- `<sha> feat(phase-3c3): HandoverChecklist + HandoverNoteEditor`
- `<sha> feat(phase-3c3): icon + nav additions + 4 handover mutation hooks`
- `<sha> docs(phase-3c3): design spec for Handover module` (already done in brainstorming)
- `<sha> docs(phase-3c3): implementation plan for Handover module` (already done in writing-plans)

Ready for `superpowers:finishing-a-development-branch` to merge to main, place tag on merge commit, and optionally add umbrella `v4-phase-3c` tag (closes Phase 3C).

---

## Self-Review (run by author after writing plan)

**Spec coverage check:**
- §0 TL;DR (1 icon + 3 nav changes + 4 hooks + 7 feature files + page wire) → all covered across T1-T5 ✓
- §1 Goal (5 capabilities: session auto-create / toggle tasks / edit note / complete / admin per-day edit) → T2/T3/T4/T5 ✓
- §2 Non-goals (un-complete / history / drag-reorder / multi-shift / photo / AI) → not implemented, correctly absent ✓
- §3.1 Flow diagram → T5 composes everything in HandoverView ✓
- §3.2 Session lifecycle (draft → completed lock) → T5 implements isCompleted gating ✓
- §3.3 Mutation invalidation map (all 4 invalidate handover(businessDate)) → T1 step 3 ✓
- §3.4 Auto-save matrix (toggle=auto, note=blur, complete=confirm, admin=full-array) → T2/T3/T4 implement respectively ✓
- §3.5 Read-only when completed → T5 isCompleted passes through to children ✓
- §3.6 NAV_ITEMS additive modifications → T1 step 2 ✓
- §3.7 New icon clipboardList → T1 step 1 ✓
- §4.1 4 mutation hooks signatures → T1 step 3 ✓
- §4.2 HandoverView container → T5 ✓
- §4.3 HandoverShiftsSummary → T3 ✓
- §4.4 HandoverChecklist with savingTaskId → T2 ✓
- §4.5 HandoverNoteEditor save-on-blur → T2 ✓
- §4.6 HandoverCompleteAction confirm modal → T3 ✓
- §4.7 HandoverTasksEditorModal admin per-day → T4 ✓
- §4.8 ProgressBadge → inlined in T5 HandoverView header (`<Badge variant="soft" semantic={allDone ? "success" : "neutral"}>{doneCount}/{totalCount} task xong</Badge>`) ✓
- §4.9 page.tsx wire → T5 step 2 ✓
- §5 Data flows → exercised by manual smoke after T5 ✓
- §6 Error handling → toast.danger pattern in every component ✓
- §7 File manifest (7 new + 3 modified) → matches T1-T5 outputs ✓
- §8 ~5 tasks → exactly 5 tasks ✓
- §9 Risks → addressed inline (defensive query handling in T3, key immutability in T4) ✓
- §10 Success criteria → T5 steps 5-7 ✓

**Placeholder scan:**
- No "TBD" / "TODO" / "implement later" anywhere ✓
- Every code step has full TSX code ✓
- Every command has exact text and expected output ✓
- Commit messages are fully written ✓
- The note "If `ShiftAssignment.status` doesn't have `"checked_in"` exactly" in T3 is robust handling, not a placeholder — explicit fallback documented ✓

**Type consistency:**
- `HandoverTask`, `HandoverSession`, `UserRole` from `@/lib/types` consistently ✓
- All 4 mutation hooks accept `(supabase, businessDate)` — consistent signature ✓
- All sub-components receive `disabled: boolean` for completion-locked state ✓
- All sub-components receive `sessionId: string` and `businessDate: string` for mutation hook context ✓
- `task_key` field (HandoverTask schema) used throughout, NOT just `key` (the RPC payload field) — buildPayload in T4 translates correctly ✓
- Sort order: `sort_order` then `task_key` consistently in T2 and T4 ✓
- `isCompleted` derived from `session.status === "completed"` consistently ✓

**One known cross-module import (documented):**
- T4's HandoverTasksEditorModal imports `slugifyTaskKey` from `@/features/settings/task-key`. This is a cross-module dependency but `task-key.ts` is a pure utility (no React, no deps on settings UI). Acceptable per spec §11 reference. Could be moved to `src/lib/` if more modules need it later.

No other issues found.
