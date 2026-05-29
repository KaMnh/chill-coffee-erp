"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useSalesCategorySummaryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.B — Sales by category over a date range.
 *
 * Data source: sales_category_summary RPC (groups by
 * category_name only — NULL gets its own bucket displayed as
 * "Chưa phân loại"). Sorted DESC by total_revenue.
 *
 * Deliberately no order_count column — would overcount when
 * one order has multiple products in the same category.
 */

interface CategorySummaryTableProps {
  dateRange: DateRange;
}

export function CategorySummaryTable({ dateRange }: CategorySummaryTableProps) {
  const supabase = useSupabase();
  const query = useSalesCategorySummaryQuery(
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
      <AlertBanner variant="danger" title="Không tải được báo cáo danh mục">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="barChart3"
        title="Chưa có doanh số trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc đợi sync POS mới."
      />
    );
  }

  return (
    <Reveal onScroll>
      <Card>
        <CardBody>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="text-sm font-medium text-ink">Doanh thu theo danh mục</h3>
            <Badge variant="soft" semantic="neutral">
              {data.length} danh mục
            </Badge>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="text-left pb-2 font-medium">Danh mục</th>
                <th scope="col" className="text-right pb-2 font-medium">Số lượng</th>
                <th scope="col" className="text-right pb-2 font-medium">Doanh thu</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr
                  key={row.category_name ?? `null-${i}`}
                  className="border-t border-border"
                >
                  <td className="py-2 text-ink">
                    {row.category_name ?? "Chưa phân loại"}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-ink">
                    {row.total_quantity.toLocaleString("vi-VN")}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-ink">
                    {formatVND(row.total_revenue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </CardBody>
      </Card>
    </Reveal>
  );
}
