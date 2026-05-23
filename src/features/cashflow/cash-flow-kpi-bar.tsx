"use client";

import { Card, CardBody } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import type { CashFlowOverview, PeriodPreset } from "@/lib/types";

interface CashFlowKpiBarProps {
  data?: CashFlowOverview;
  preset: PeriodPreset;
}

function formatDeltaPct(current: number, previous: number | undefined): string {
  if (previous === undefined || previous === 0) return "—";
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "↑" : "↓";
  return `${sign}${Math.abs(pct).toFixed(0)}%`;
}

function previousLabel(preset: PeriodPreset): string {
  if (preset === "week") return "vs tuần trước";
  if (preset === "month") return "vs tháng trước";
  return "vs cùng kỳ trước";
}

interface KpiCardProps {
  label: string;
  amount: number;
  deltaLabel: string;
  delta: string;
  /** "good" = positive direction green; "bad" = positive direction red (OUT). */
  semantic: "good" | "bad" | "neutral";
}

function KpiCard({ label, amount, deltaLabel, delta, semantic }: KpiCardProps) {
  const isPositive = delta.startsWith("↑");
  const isNegative = delta.startsWith("↓");
  const goodIfUp = semantic === "good";
  const goodIfDown = semantic === "bad";
  const tone =
    semantic === "neutral"
      ? "text-muted"
      : (isPositive && goodIfUp) || (isNegative && goodIfDown)
        ? "text-success"
        : (isPositive && goodIfDown) || (isNegative && goodIfUp)
          ? "text-danger"
          : "text-muted";

  return (
    <Card>
      <CardBody>
        <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
        <p className="mt-2 text-2xl font-bold text-ink tabular-nums">
          {formatVND(amount)}
        </p>
        <p className={`mt-1 text-xs ${tone} tabular-nums`}>
          {delta} {deltaLabel}
        </p>
      </CardBody>
    </Card>
  );
}

export function CashFlowKpiBar({ data, preset }: CashFlowKpiBarProps) {
  const in_ = data?.in ?? 0;
  const out = data?.out ?? 0;
  const net = data?.net ?? 0;
  const prevIn = data?.prev_in;
  const prevOut = data?.prev_out;
  const prevNet = data?.prev_net;
  const label = previousLabel(preset);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label="Tổng vào"
        amount={in_}
        deltaLabel={label}
        delta={formatDeltaPct(in_, prevIn)}
        semantic="good"
      />
      <KpiCard
        label="Tổng ra"
        amount={out}
        deltaLabel={label}
        delta={formatDeltaPct(out, prevOut)}
        semantic="bad"
      />
      <KpiCard
        label="Chênh lệch"
        amount={net}
        deltaLabel={label}
        delta={formatDeltaPct(net, prevNet)}
        semantic="good"
      />
    </div>
  );
}
