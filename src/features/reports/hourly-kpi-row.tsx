"use client";

import { Card, CardBody } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import type { HourlyRow } from "@/lib/data";

/**
 * Phase 5.D — 3-tile KPI strip above the hourly chart.
 *
 * Consumes the same 24-row data array as HourlyBarChart, with an
 * `is_peak: boolean` enrichment derived in the parent tab (argmax
 * over total_revenue, client-side).
 *
 *   Giờ cao điểm  — first row where is_peak === true (formatHourRange)
 *   Tổng doanh thu — sum of total_revenue across all 24 rows (formatVND)
 *   Tổng đơn       — sum of order_count across all 24 rows (vi-VN locale)
 */

interface HourlyKpiRowProps {
  data: (HourlyRow & { is_peak: boolean })[];
}

export function HourlyKpiRow({ data }: HourlyKpiRowProps) {
  const peakRow = data.find((d) => d.is_peak);
  const peakLabel = peakRow ? formatHourRange(peakRow.sale_hour) : "—";
  const totalRevenue = data.reduce((sum, d) => sum + d.total_revenue, 0);
  const totalOrders = data.reduce((sum, d) => sum + d.order_count, 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <StatTile label="Giờ cao điểm" value={peakLabel} />
      <StatTile label="Tổng doanh thu" value={formatVND(totalRevenue)} />
      <StatTile
        label="Tổng đơn"
        value={totalOrders.toLocaleString("vi-VN")}
      />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium text-muted uppercase tracking-wide">
          {label}
        </p>
        <p className="mt-1 font-display text-2xl text-ink tabular-nums">
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

/**
 * Format an hour index 0..23 as a one-hour bracket label.
 *   formatHourRange(14) → "14:00 – 15:00"
 *   formatHourRange(23) → "23:00 – 00:00"  (wraparound via (hour+1) % 24)
 */
function formatHourRange(hour: number): string {
  const start = `${String(hour).padStart(2, "0")}:00`;
  const end = `${String((hour + 1) % 24).padStart(2, "0")}:00`;
  return `${start} – ${end}`;
}
