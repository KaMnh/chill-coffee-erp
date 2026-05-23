"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useSalesProductSummaryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.B — Sales by product over a date range.
 *
 * Data source: sales_product_summary RPC (aggregates
 * sales_order_items joined to sales_orders, grouped by
 * (product_id, product_code, product_name, category_name)).
 * Sorted DESC by total_revenue; rendered flat.
 */

interface ProductSummaryTableProps {
  dateRange: DateRange;
}

export function ProductSummaryTable({ dateRange }: ProductSummaryTableProps) {
  const supabase = useSupabase();
  const query = useSalesProductSummaryQuery(
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
      <AlertBanner variant="danger" title="Không tải được báo cáo doanh thu">
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
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Doanh thu theo sản phẩm</h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} sản phẩm
          </Badge>
        </div>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th scope="col" className="text-left pb-2 font-medium">Sản phẩm</th>
              <th scope="col" className="text-left pb-2 font-medium">Danh mục</th>
              <th scope="col" className="text-right pb-2 font-medium">Số lượng</th>
              <th scope="col" className="text-right pb-2 font-medium">Doanh thu</th>
              <th scope="col" className="text-right pb-2 font-medium">Số đơn</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={row.product_id || row.product_code || row.product_name}
                className="border-t border-border"
              >
                <td className="py-2 text-ink">{row.product_name}</td>
                <td className="py-2 text-muted">
                  {row.category_name ?? "Chưa phân loại"}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-ink">
                  {row.total_quantity.toLocaleString("vi-VN")}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-ink">
                  {formatVND(row.total_revenue)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-muted">
                  {row.order_count.toLocaleString("vi-VN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </CardBody>
    </Card>
  );
}
