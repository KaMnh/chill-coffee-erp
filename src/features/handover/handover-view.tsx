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
