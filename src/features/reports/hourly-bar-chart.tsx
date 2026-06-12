"use client";

import { Card, CardBody } from "@/components/ui/card";
import { BarChart } from "@/components/charts/bar-chart";
import { Badge } from "@/components/ui/badge";
import { formatVND } from "@/lib/format";
import type { HourlyRow } from "@/lib/data";

/**
 * Phase 5.D — 24-bar Recharts chart of revenue per hour, with the
 * peak hour highlighted.
 *
 * Wraps the EXISTING <BarChart> primitive at
 * src/components/charts/bar-chart.tsx (Recharts wrapper that
 * already supports highlightKey + formatY). Phase 5.D is the
 * first production consumer of this primitive — playground was
 * the only prior user.
 *
 * The is_peak boolean is computed in the parent tab (T5) and
 * passed through; the BarChart's highlightKey="is_peak" reads it
 * to fill the peak bar with var(--color-ink) (others get
 * var(--color-border)).
 *
 * X-axis labels use "HH:00" short form (24 labels fit horizontally).
 * Tooltip uses formatVND for revenue display on hover.
 */

interface HourlyBarChartProps {
  data: (HourlyRow & { is_peak: boolean })[];
}

type ChartRow = Record<string, unknown> & {
  hour_label: string;
  total_revenue: number;
  is_peak: boolean;
};

export function HourlyBarChart({ data }: HourlyBarChartProps) {
  const chartData: ChartRow[] = data.map((row) => ({
    hour_label: `${String(row.sale_hour).padStart(2, "0")}:00`,
    total_revenue: row.total_revenue,
    is_peak: row.is_peak,
  }));

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Doanh thu theo giờ</h3>
          <Badge variant="soft" semantic="neutral">24 giờ</Badge>
        </div>
        <BarChart<ChartRow>
          data={chartData}
          xKey="hour_label"
          yKey="total_revenue"
          highlightKey="is_peak"
          formatY={formatVND}
          height={280}
          // 24 nhãn HH:00 chèn nhau ở màn hẹp → hiện mỗi 3 giờ (00,03,06…).
          xTickInterval={2}
        />
      </CardBody>
    </Card>
  );
}
