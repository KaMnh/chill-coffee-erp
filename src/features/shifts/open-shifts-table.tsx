"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { durationLabel } from "@/lib/format";

/** Ngưỡng cảnh báo ca treo quá lâu (giờ). */
export const OVERDUE_HOURS = 12;

/** Shape tối thiểu để render — OpenShift (mọi ngày) lẫn ShiftAssignment (cash-view) đều thoả. */
export interface OpenShiftRow {
  id: string;
  business_date: string;
  check_in_at: string | null;
  // string | null | undefined để nhận cả ShiftAssignment (employee_name optional)
  // lẫn OpenShift (luôn set). Render null-default "NV đã ngừng".
  employee_name?: string | null;
  employee_is_active?: boolean | null;
  // Truyền qua CloseShiftTarget để modal hiển thị "Lương ngày" cho NV fixed.
  // OpenShift luôn set; ShiftAssignment (cash-view) không có → optional.
  pay_type?: "hourly" | "fixed";
  default_daily_pay?: number | null;
}

function elapsedMinutes(checkIn: string | null): number | null {
  if (!checkIn) return null;
  const ms = Date.now() - new Date(checkIn).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

interface OpenShiftsTableProps {
  shifts: ReadonlyArray<OpenShiftRow>;
  onClose(shift: OpenShiftRow): void;
}

export function OpenShiftsTable({ shifts, onClose }: OpenShiftsTableProps) {
  if (shifts.length === 0) {
    return (
      <EmptyState
        icon="checkCircle"
        title="Không có ca đang mở"
        subtitle="Mọi ca đã ra/đóng."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {shifts.map((s) => {
        const mins = elapsedMinutes(s.check_in_at);
        const overdue = mins !== null && mins > OVERDUE_HOURS * 60;
        return (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-surface p-3"
          >
            <div className="min-w-0">
              <strong className="block truncate text-sm font-semibold text-ink">
                {s.employee_name ?? "NV đã ngừng"}
              </strong>
              <span className="text-xs text-muted">
                Ngày {s.business_date}
                {s.check_in_at ? ` · Vào ${new Date(s.check_in_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}` : ""}
                {mins !== null ? ` · Đã làm ${durationLabel(mins)}` : ""}
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {s.employee_is_active === false && (
                <Badge variant="soft" semantic="neutral">Đã ngừng</Badge>
              )}
              {overdue && <Badge variant="soft" semantic="warning">Quá hạn</Badge>}
              <Button type="button" variant="ghost" size="sm" onClick={() => onClose(s)}>
                Đóng ca
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
