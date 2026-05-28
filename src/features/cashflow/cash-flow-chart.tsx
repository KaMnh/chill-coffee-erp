"use client";

import {
  ComposedChart,
  Bar,
  Line,
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
  /** ISO date "YYYY-MM-DD" of the currently filtered day, or null for "all". */
  selectedDate: string | null;
  /** Called when user clicks a bar — passes the bar's date. */
  onSelectDate(date: string): void;
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
          <span style={{ color: entry.color }}>●</span>{" "}
          {entry.name === "in"
            ? "Thu"
            : entry.name === "out"
              ? "Chi"
              : "Nạp két"}
          : {formatVND(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function CashFlowChart({
  byDay,
  selectedDate,
  onSelectDate,
}: CashFlowChartProps) {
  // We preserve `date` (raw ISO) for click handlers; `date_label` (DD/MM)
  // is only for axis display.
  const data = byDay.map((d) => ({
    date: d.date,
    date_label: shortDate(d.date),
    in: d.in,
    out: d.out,
    safe_deposit: d.safe_deposit,
  }));

  function handleBarClick(payload: unknown) {
    const date = (payload as { date?: unknown })?.date;
    if (typeof date === "string") onSelectDate(date);
  }

  return (
    <Card>
      <CardBody>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-ink">Thu / Chi theo ngày</h3>
          {selectedDate && (
            <span className="text-xs text-muted">
              Click bar khác để đổi ngày
            </span>
          )}
        </div>
        <div className="w-full" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 16, right: 8, left: 0, bottom: 8 }}
            >
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
                formatter={(value) =>
                  value === "in"
                    ? "Thu"
                    : value === "out"
                      ? "Chi"
                      : "Nạp két"
                }
              />
              <Bar
                dataKey="in"
                fill="var(--color-success)"
                radius={[6, 6, 0, 0]}
                cursor="pointer"
                onClick={handleBarClick}
              />
              <Bar
                dataKey="out"
                fill="var(--color-danger)"
                radius={[6, 6, 0, 0]}
                cursor="pointer"
                onClick={handleBarClick}
              />
              <Line
                type="monotone"
                dataKey="safe_deposit"
                stroke="var(--color-warning)"
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: "var(--color-warning)" }}
                activeDot={{ r: 5 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
