"use client";

import {
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/cn";

interface LineChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  formatY?: (value: number) => string;
  height?: number;
  className?: string;
}

function CustomTooltip({
  active,
  payload,
  formatY,
}: {
  active?: boolean;
  payload?: Array<{ value: number }>;
  formatY?: (v: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const value = payload[0].value;
  return (
    <div className="rounded-sm bg-ink text-white text-xs px-2 py-1 shadow-popover flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-white" />
      <span className="tabular-nums">{formatY ? formatY(value) : value}</span>
    </div>
  );
}

export function LineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  yKey,
  formatY,
  height = 240,
  className,
}: LineChartProps<T>) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RechartsLineChart
          data={data}
          margin={{ top: 24, right: 8, left: 0, bottom: 8 }}
        >
          <XAxis
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dataKey={xKey as any}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: "var(--color-muted)" }}
          />
          <YAxis hide />
          <RechartsTooltip
            cursor={{ stroke: "var(--color-border)" }}
            content={
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <CustomTooltip formatY={formatY} /> as any
            }
          />
          <Line
            type="monotone"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            dataKey={yKey as any}
            stroke="var(--color-ink)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: "var(--color-ink)" }}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}
