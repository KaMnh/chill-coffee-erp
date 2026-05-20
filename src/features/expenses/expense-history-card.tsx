"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTime, formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Expense, UserRole } from "@/lib/types";
import { ExpenseEditModal } from "./expense-edit-modal";

interface ExpenseHistoryCardProps {
  expenses: ReadonlyArray<Expense>;
  total: number;
  role: UserRole;
  businessDate: string;
}

/**
 * List of today's expenses with row click → edit modal (owner/manager only).
 * Pure prop-driven — reads from parent's dashboard.expenses array.
 *
 * Rows show description + category + time on the left, formatted VND amount
 * on the right (right-aligned amount is the primary value, so we don't use
 * Phase 2 ListItem which would put it in the side `action` slot).
 */
export function ExpenseHistoryCard({
  expenses,
  total,
  role,
  businessDate,
}: ExpenseHistoryCardProps) {
  const canEdit = role === "owner" || role === "manager";
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId
    ? expenses.find((e) => e.id === editingId) ?? null
    : null;

  // If a refresh removes the expense being edited (e.g. delete from another
  // tab), clear editingId so the modal closes instead of vanishing silently.
  useEffect(() => {
    if (editingId && !editing) setEditingId(null);
  }, [editingId, editing]);

  function open(id: string) {
    if (canEdit) setEditingId(id);
  }

  function handleOpenChange(next: boolean) {
    if (!next) setEditingId(null);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Lịch sử ngày</CardTitle>
          <strong className="font-display text-base text-ink">{formatVND(total)}</strong>
        </div>
      </CardHeader>
      <CardBody>
        {expenses.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="Chưa có khoản chi"
            subtitle="Khi nhân viên nhập chi, dòng mới sẽ hiện tại đây."
          />
        ) : (
          <ul className="divide-y divide-border">
            {expenses.map((e) => (
              <li
                key={e.id}
                onClick={canEdit ? () => open(e.id) : undefined}
                onKeyDown={
                  canEdit
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          open(e.id);
                        }
                      }
                    : undefined
                }
                tabIndex={canEdit ? 0 : undefined}
                role={canEdit ? "button" : undefined}
                aria-label={canEdit ? `Sửa khoản chi ${e.description}` : undefined}
                className={cn(
                  "flex items-center justify-between gap-3 py-3 px-2 -mx-2 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
                  canEdit && "cursor-pointer hover:bg-surface-muted"
                )}
              >
                <div className="min-w-0">
                  <strong className="block truncate text-sm font-semibold text-ink">
                    {e.description}
                  </strong>
                  <span className="text-xs text-muted">
                    {e.category_name ?? "Chi phí"} · {formatTime(e.created_at)}
                  </span>
                </div>
                <strong className="shrink-0 font-display text-sm text-ink">
                  {formatVND(e.amount)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      <ExpenseEditModal
        open={editingId !== null}
        onOpenChange={handleOpenChange}
        expense={editing}
        businessDate={businessDate}
      />
    </Card>
  );
}
