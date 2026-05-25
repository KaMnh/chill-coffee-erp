"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Tooltip } from "@/components/ui/tooltip";
import { IconButton } from "@/components/ui/icon-button";
import { EmptyState } from "@/components/ui/empty-state";
import type { HandoverSession } from "@/lib/types";

interface HandoverPanelProps {
  handover: HandoverSession | null;
}

/**
 * Read-only handover summary widget for the Dashboard. Edits happen in
 * the dedicated Handover module accessed via the sidebar — this is a
 * preview-only surface (checkboxes + note are non-interactive).
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
          <div className="flex items-center gap-1.5">
            <CardTitle>Sổ bàn giao</CardTitle>
            <Tooltip
              content={`Tóm tắt nhanh — bấm "Bàn giao" ở sidebar để chỉnh sửa checklist.`}
              side="bottom"
            >
              <IconButton
                icon="info"
                size={32}
                variant="ghost"
                aria-label="Tóm tắt nhanh sổ bàn giao"
              />
            </Tooltip>
          </div>
          <span className="font-display text-sm text-ink">
            {done}/{total} việc
          </span>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {total > 0 && <ProgressBar value={pct} />}
        {total === 0 ? (
          <EmptyState
            icon="info"
            title="Chưa có checklist"
            subtitle="Owner/manager cấu hình mặc định ở Thiết lập."
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
