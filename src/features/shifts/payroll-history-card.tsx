"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { CountUp } from "@/components/ui/count-up";
import { formatDateTime, formatVND, durationLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { PayrollRecord } from "@/lib/types";

interface PayrollHistoryCardProps {
  payroll: ReadonlyArray<PayrollRecord>;
  canManage: boolean;
  onEditRow(payroll: PayrollRecord): void;
}

/**
 * List of today's payroll records. Pure prop-driven (no own queries).
 *
 * Rows clickable for owner/manager only — staff_operator sees static
 * rows. Pattern matches ExpenseHistoryCard (3B.1).
 *
 * Row shows: employee name (truncate), duration + allowance + edited
 * badge if edited_at, total_pay right-aligned.
 *
 * Stale-row guard via useEffect (matches 3B.1 ExpenseHistoryCard fix):
 * if editingId was set and the row disappears from the array (e.g. delete
 * from another tab), reset editingId so the modal closes cleanly.
 */
export function PayrollHistoryCard({
  payroll,
  canManage,
  onEditRow,
}: PayrollHistoryCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId
    ? payroll.find((p) => p.id === editingId) ?? null
    : null;

  // Stale-row guard: if a refresh removes the row being edited, clear.
  useEffect(() => {
    if (editingId && !editing) setEditingId(null);
  }, [editingId, editing]);

  function open(p: PayrollRecord) {
    if (!canManage) return;
    setEditingId(p.id);
    onEditRow(p);
  }

  const total = payroll.reduce((sum, row) => sum + row.total_pay, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Lương theo lượt</CardTitle>
          <strong className="font-display text-base text-ink">
            <CountUp value={total} format={formatVND} />
          </strong>
        </div>
      </CardHeader>
      <CardBody>
        {payroll.length === 0 ? (
          <EmptyState
            icon="users"
            title="Chưa có dòng lương"
            subtitle="Khi xác nhận ra ca, dòng lương mới sẽ nằm trên cùng."
          />
        ) : (
          <Reveal onScroll>
            <ul className="divide-y divide-border">
              {payroll.map((row) => (
              <li
                key={row.id}
                onClick={canManage ? () => open(row) : undefined}
                onKeyDown={
                  canManage
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          open(row);
                        }
                      }
                    : undefined
                }
                tabIndex={canManage ? 0 : undefined}
                role={canManage ? "button" : undefined}
                aria-label={canManage ? `Sửa lượt lương ${row.employee_name ?? ""}` : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 py-3 px-2 -mx-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
                  canManage && "cursor-pointer hover:bg-surface-muted"
                )}
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-ink">
                    {row.employee_name ?? "Nhân viên"}
                  </strong>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <span>{durationLabel(row.total_minutes)}</span>
                    <span>·</span>
                    <span>Bồi dưỡng {formatVND(row.allowance_amount)}</span>
                    {row.edited_at && (
                      <Badge variant="soft" semantic="warning">
                        Đã sửa {formatDateTime(row.edited_at)}
                      </Badge>
                    )}
                  </div>
                </div>
                <strong className="shrink-0 font-display text-sm text-ink">
                  {formatVND(row.total_pay)}
                </strong>
              </li>
            ))}
            </ul>
          </Reveal>
        )}
      </CardBody>
    </Card>
  );
}
