"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { cn } from "@/lib/cn";

interface BarChartProps<T extends Record<string, unknown>> {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  highlightKey?: keyof T & string;
  formatY?: (value: number) => string;
  height?: number;
  className?: string;
}

interface TooltipPayloadEntry {
  payload: Record<string, unknown>;
  value: number;
}

function CustomTooltip({
  active,
  payload,
  formatY,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
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

export function BarChart<T extends Record<string, unknown>>({
  data,
  xKey,
  yKey,
  highlightKey,
  formatY,
  height = 240,
  className,
}: BarChartProps<T>) {
  return (
    <div className={cn("w-full", className)} style={{ height }}>
      {/* initialDimension height>0 avoids Recharts' benign mount-time
          width(-1)/height(-1) warning before its ResizeObserver measures. */}
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 0, height }}>
        <RechartsBarChart
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
            cursor={false}
            content={
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              <CustomTooltip formatY={formatY} /> as any
            }
          />
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <Bar dataKey={yKey as any} radius={[8, 8, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={
                  highlightKey && entry[highlightKey]
                    ? "var(--color-ink)"
                    : "var(--color-border)"
                }
              />
            ))}
          </Bar>
        </RechartsBarChart>
      </ResponsiveContainer>
    </div>
  );
}
