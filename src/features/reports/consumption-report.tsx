"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useInventoryConsumptionQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatUnit } from "@/features/inventory/units";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.A — Top ingredients consumed by sales over a date range.
 *
 * Data source: inventory_consumption_by_ingredient RPC (filters to
 * reason='sale_theoretical'). Sorted DESC by total_consumed; rendered
 * flat (no pagination — typical run is <50 rows for a coffee shop).
 */

interface ConsumptionReportProps {
  dateRange: DateRange;
}

export function ConsumptionReport({ dateRange }: ConsumptionReportProps) {
  const supabase = useSupabase();
  const query = useInventoryConsumptionQuery(
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
      <AlertBanner variant="danger" title="Không tải được báo cáo tiêu thụ">
        Vui lòng tải lại trang. Lỗi:{" "}
        {query.error instanceof Error
          ? query.error.message
          : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="package"
        title="Chưa có tiêu thụ trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc nhập đơn bán mới."
      />
    );
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">
            Tiêu thụ theo nguyên liệu
          </h3>
          <Badge variant="soft" semantic="neutral">
            {data.length} nguyên liệu
          </Badge>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted">
              <th className="text-left pb-2 font-medium">Nguyên liệu</th>
              <th className="text-right pb-2 font-medium">Tổng tiêu thụ</th>
              <th className="text-right pb-2 font-medium">Số đơn</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.ingredient_id} className="border-t border-border">
                <td className="py-2 text-ink">{row.ingredient_name}</td>
                <td className="py-2 text-right font-mono tabular-nums text-ink">
                  {row.total_consumed.toLocaleString("vi-VN")}{" "}
                  {formatUnit(row.unit)}
                </td>
                <td className="py-2 text-right font-mono tabular-nums text-muted">
                  {row.sale_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}
