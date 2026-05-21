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
 *   - "Đã làm lúc {ts}" muted text when is_done
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

  const doneCount = tasks.filter((t) => t.is_done).length;

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
          <span className="text-xs text-muted">{doneCount}/{tasks.length} đã xong</span>
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
                  className="flex flex-col p-3 rounded-md border border-border bg-surface"
                >
                  <Checkbox
                    checked={task.is_done}
                    onCheckedChange={(checked) => handleToggle(task, checked === true)}
                    disabled={disabled || isRowSaving}
                    label={task.label}
                  />
                  {task.is_done && (
                    <p className="text-xs text-muted mt-0.5 ml-7">
                      Đã làm{" "}
                      {task.checked_at && `lúc ${formatDateTime(task.checked_at)}`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
