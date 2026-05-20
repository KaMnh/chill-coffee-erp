"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatTime, formatVND } from "@/lib/format";
import type { Expense } from "@/lib/types";

interface ExpenseLogCardProps {
  expenses: ReadonlyArray<Expense>;
  total: number;
}

/**
 * Today's expense rows (top 4 by created_at — list comes pre-sorted from
 * dashboard_daily_ops RPC). Mirrors v3 dashboard-view.tsx lines 73-97.
 *
 * Inline list (not <ListItem>) because we want amount aligned right of the
 * row, which ListItem doesn't directly support — using ListItem would force
 * us to abuse the `action` slot for the amount, which is wrong semantically
 * (amount is the row's primary value, not a side action).
 */
export function ExpenseLogCard({ expenses, total }: ExpenseLogCardProps) {
  const rows = expenses.slice(0, 4);
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Sổ chi trong ngày</CardTitle>
          <strong className="font-display text-base text-ink">{formatVND(total)}</strong>
        </div>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="Chưa có khoản chi"
            subtitle="Khi nhân viên nhập chi, dòng mới sẽ hiện tại đây."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between gap-3 py-3"
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
    </Card>
  );
}
