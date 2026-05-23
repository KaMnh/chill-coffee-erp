"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { CashFlowTopCategory } from "@/lib/types";

interface TopCategoriesTableProps {
  rows: CashFlowTopCategory[];
}

export function TopCategoriesTable({ rows }: TopCategoriesTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 5 hạng mục chi</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="Chưa có chi phí trong kỳ"
            subtitle="Khi có expense thì top hạng mục sẽ hiện ra đây."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-2 text-xs font-medium uppercase tracking-wider text-muted w-10">
                  #
                </th>
                <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Hạng mục
                </th>
                <th className="text-right py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Số tiền
                </th>
                <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted w-16">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.category_name} className="border-b border-border last:border-0">
                  <td className="py-3 pr-2 text-muted">{i + 1}</td>
                  <td className="py-3 px-2 text-ink">{row.category_name}</td>
                  <td className="py-3 px-2 text-right tabular-nums text-ink">
                    {formatVND(row.amount)}
                  </td>
                  <td className="py-3 pl-2 text-right tabular-nums text-muted">
                    {(row.pct * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
