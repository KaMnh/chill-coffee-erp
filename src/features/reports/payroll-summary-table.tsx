"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { usePayrollSummaryByEmployeeQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { formatVND } from "@/lib/format";
import type { DateRange } from "./date-range-picker";

/**
 * Phase 5.C — Payroll aggregated by employee over a date range.
 *
 * Data source: payroll_summary_by_employee RPC. Sorted DESC by
 * total_pay. Includes inactive employees (historical pay records
 * must surface).
 *
 * 4-column table: Nhân viên / Tổng lương / Số ca / Tổng giờ.
 * total_minutes formatted client-side as "8 giờ 25" via
 * formatHours below.
 */

interface PayrollSummaryTableProps {
  dateRange: DateRange;
}

export function PayrollSummaryTable({ dateRange }: PayrollSummaryTableProps) {
  const supabase = useSupabase();
  const query = usePayrollSummaryByEmployeeQuery(
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
      <AlertBanner variant="danger" title="Không tải được báo cáo lương">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="users"
        title="Chưa có lương trong khoảng này"
        subtitle="Đổi khoảng thời gian hoặc tạo ca chấm công mới."
      />
    );
  }

  return (
    <Reveal onScroll>
      <Card>
        <CardBody>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="text-sm font-medium text-ink">Lương theo nhân viên</h3>
            <Badge variant="soft" semantic="neutral">
              {data.length} nhân viên
            </Badge>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="text-left pb-2 font-medium">Nhân viên</th>
                <th scope="col" className="text-right pb-2 font-medium">Tổng lương</th>
                <th scope="col" className="text-right pb-2 font-medium">Số ca</th>
                <th scope="col" className="text-right pb-2 font-medium">Tổng giờ</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.employee_id} className="border-t border-border">
                  <td className="py-2 text-ink">{row.employee_name}</td>
                  <td className="py-2 text-right font-mono tabular-nums text-ink">
                    {formatVND(row.total_pay)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-muted">
                    {row.shift_count.toLocaleString("vi-VN")}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums text-muted">
                    {formatHours(row.total_minutes)}
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

/**
 * Format a number of minutes as "{H} giờ {MM}" or "{H} giờ" if minutes=0.
 * Examples:
 *   505 → "8 giờ 25"
 *   480 → "8 giờ"
 *     0 → "0 giờ"
 */
function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} giờ`;
  return `${h} giờ ${String(m).padStart(2, "0")}`;
}
