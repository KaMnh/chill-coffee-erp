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
