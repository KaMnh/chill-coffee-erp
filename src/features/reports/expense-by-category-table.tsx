"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useExpenseSummaryByCategoryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.C — Expenses aggregated by category over a date range.
 *
 * Data source: expense_summary_by_category RPC (LEFT JOIN to
 * surface NULL category as own row). Sorted DESC by total_amount.
 */

interface ExpenseByCategoryTableProps {
  dateRange: DateRange;
}

export function ExpenseByCategoryTable({ dateRange }: ExpenseByCategoryTableProps) {
  const supabase = useSupabase();
  const query = useExpenseSummaryByCategoryQuery(
    supabase,
    dateRange.from,
    dateRange.to,
    !!supabase
  );

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={24} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được báo cáo chi phí">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="wallet"
        title="Chưa có chi phí trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc nhập chi phí mới."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Chi phí theo danh mục</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} danh mục
          </Badge>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="text-left pb-2 font-medium">Danh mục</th>
              <th scope="col" className="text-right pb-2 font-medium">Tổng tiền</th>
              <th scope="col" className="text-right pb-2 font-medium">Số lần</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.category_id ?? `null-${i}`}
                className="border-t border-border"
              >
                <td className="py-2 text-ink">
                  {row.category_name ?? "Chưa phân loại"}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-ink">
                  {formatVND(row.total_amount)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-muted">
                  {row.expense_count.toLocaleString("vi-VN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </CardBody>
    </Card>
  );
}
