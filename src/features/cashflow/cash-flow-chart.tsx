"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardBody } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import type { CashFlowDayPoint } from "@/lib/types";

interface CashFlowChartProps {
  byDay: CashFlowDayPoint[];
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function abbreviateVND(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm bg-ink text-white text-xs px-2 py-1.5 shadow-popover space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="tabular-nums">
          <span style={{ color: entry.color }}>●</span> {entry.name}: {formatVND(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function CashFlowChart({ byDay }: CashFlowChartProps) {
  const data = byDay.map((d) => ({
    date_label: shortDate(d.date),
    in: d.in,
    out: d.out,
  }));

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-medium text-ink mb-3">
          Thu / Chi theo ngày
        </h3>
        <div className="w-full" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
              <XAxis
                dataKey="date_label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted)" }}
              />
              <YAxis
                tickFormatter={abbreviateVND}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted)" }}
                width={40}
              />
              <RechartsTooltip
                cursor={{ fill: "var(--color-border)", opacity: 0.2 }}
                content={<ChartTooltip />}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) => (value === "in" ? "Thu" : "Chi")}
              />
              <Bar dataKey="in" fill="var(--color-success)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="out" fill="var(--color-danger)" radius={[6, 6, 0, 0]} />
            </RechartsBarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
