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
import { Reveal } from "@/components/ui/reveal";
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
          <Reveal onScroll className="space-y-2">
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
          </Reveal>
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
