"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { AlertBanner } from "@/components/ui/alert-banner";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Textarea } from "@/components/ui/textarea";
import { Reveal } from "@/components/ui/reveal";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import { Sheet } from "../sheet";
import { usePreview, ViewStates, SectionLabel } from "../bits";
import { getPreviewData, BUSINESS_DATE } from "../../_mock/data";

/**
 * Bàn giao — Tier A. Checklist = hàng lớn 56px bấm cả hàng để toggle,
 * ghi chú autosave-on-blur, "Hoàn tất bàn giao" sticky đáy + sheet xác nhận.
 */
export function MobileHandoverView() {
  const { scenario } = usePreview();
  const mock = getPreviewData(scenario).handover;

  const [tasks, setTasks] = useState(mock.tasks);
  const [note, setNote] = useState(mock.note);
  const [noteSavedAt, setNoteSavedAt] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [completed, setCompleted] = useState(false);

  const done = tasks.filter((t) => t.done).length;
  const total = tasks.length;
  const allDone = done === total;

  function toggle(id: string) {
    if (completed) return;
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: !t.done, at: t.done ? undefined : "bây giờ" } : t))
    );
  }

  const skeleton = (
    <div className="p-4 space-y-3">
      <Skeleton height="5rem" rounded="lg" />
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} height="3.5rem" rounded="lg" />
      ))}
      <Skeleton height="8rem" rounded="lg" />
    </div>
  );

  const empty = (
    <div className="p-4">
      <EmptyState
        icon="clipboardList"
        title="Chưa có task nào"
        subtitle="Owner/manager thêm task từ 'Sửa task cho ngày này' hoặc Thiết lập → Checklist mặc định."
        dashedBorder
      />
    </div>
  );

  return (
    <ViewStates scenario={scenario} skeleton={skeleton} empty={empty}>
      <div className="flex flex-col min-h-full">
        <Reveal stagger className="p-4 space-y-4">
          {/* Header tiến độ */}
          <div className="rounded-lg bg-surface shadow-raised p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <SectionLabel>Bàn giao cuối ngày</SectionLabel>
                <div className="font-display text-lg font-bold text-ink">{BUSINESS_DATE}</div>
              </div>
              <Badge variant="soft" semantic={allDone ? "success" : "warning"}>
                {done}/{total} việc xong
              </Badge>
            </div>
            <ProgressBar value={Math.round((done / total) * 100)} />
          </div>

          {completed && (
            <AlertBanner variant="success" title="Đã hoàn tất bàn giao.">
              Session bị khóa — không thể tick / sửa lại.
            </AlertBanner>
          )}

          {mock.staffInShift > 0 && !completed && (
            <AlertBanner variant="warning">
              Còn {mock.staffInShift} nhân viên đang trong ca. Check-out tất cả ở
              &quot;Ca &amp; lương&quot; trước khi hoàn tất.
            </AlertBanner>
          )}

          {/* Checklist — hàng lớn bấm được */}
          <div className="space-y-2">
            <SectionLabel>Checklist</SectionLabel>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} disabled={completed} onToggle={() => toggle(task.id)} />
            ))}
          </div>

          {/* Ghi chú bàn giao */}
          <div className="rounded-lg bg-surface shadow-raised p-4 space-y-2">
            <SectionLabel>Ghi chú bàn giao</SectionLabel>
            <Textarea
              rows={4}
              value={note}
              disabled={completed}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => setNoteSavedAt(new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }))}
              placeholder="Ghi chú đặc biệt cho ca sau (vd: thiếu nguyên liệu A, máy POS chậm…)"
              className="text-base"
            />
            <div className="text-xs text-muted">
              {noteSavedAt ? `Đã lưu lúc ${noteSavedAt}` : "Sẽ lưu khi rời ô"} · {note.length}/1000 ký tự
            </div>
          </div>
        </Reveal>

        {/* Sticky đáy */}
        {!completed && (
          <div className="sticky bottom-0 z-20 mt-auto bg-surface/95 backdrop-blur border-t border-border px-4 pt-3 pb-3">
            <Button size="lg" className="w-full" onClick={() => setConfirmOpen(true)}>
              Hoàn tất bàn giao
            </Button>
          </div>
        )}

        {/* Sheet xác nhận */}
        <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Xác nhận hoàn tất bàn giao">
          <div className="space-y-3">
            <AlertBanner variant={allDone ? "info" : "warning"}>
              {allDone
                ? `Đã hoàn thành tất cả ${total} task. Xác nhận hoàn tất?`
                : `Còn ${total - done} task chưa xong (trong tổng ${total}). Vẫn hoàn tất bàn giao?`}
            </AlertBanner>
            <p className="text-sm text-ink-2">
              Sau khi hoàn tất, session sẽ bị khóa — không thể tick / sửa lại task hay ghi chú.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="ghost" size="lg" onClick={() => setConfirmOpen(false)}>
                Hủy
              </Button>
              <Button
                variant="destructive"
                size="lg"
                onClick={() => {
                  setCompleted(true);
                  setConfirmOpen(false);
                }}
              >
                Xác nhận hoàn tất
              </Button>
            </div>
          </div>
        </Sheet>
      </div>
    </ViewStates>
  );
}

interface TaskRowProps {
  task: { id: string; label: string; done: boolean; at?: string };
  disabled: boolean;
  onToggle(): void;
}

/** Hàng task 56px — cả hàng là nút; tick có pop nhẹ (GSAP, tôn trọng reduced-motion). */
function TaskRow({ task, disabled, onToggle }: TaskRowProps) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);

  useGSAP(
    () => {
      if (!el || !task.done || prefersReducedMotion()) return;
      gsap.fromTo(el, { scale: 0.5 }, { scale: 1, duration: DUR.fast, ease: "back.out(2.5)" });
    },
    { dependencies: [task.done, el] }
  );

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={task.done}
      className={cn(
        "w-full min-h-14 px-3 py-2.5 rounded-lg border flex items-center gap-3 text-left transition-colors",
        task.done ? "bg-success-soft/40 border-success/30" : "bg-surface border-border",
        disabled && "opacity-60"
      )}
    >
      <span
        ref={setEl}
        className={cn(
          "w-6 h-6 shrink-0 rounded-full border-2 flex items-center justify-center",
          task.done ? "bg-success border-success text-white" : "border-border-strong/30"
        )}
      >
        {task.done && <Icon name="check" size={16} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className={cn("block text-sm font-medium", task.done ? "text-success line-through decoration-success/40" : "text-ink")}>
          {task.label}
        </span>
        {task.done && task.at && (
          <span className="block text-xs text-muted mt-0.5">Đã làm lúc {task.at}</span>
        )}
      </span>
    </button>
  );
}
