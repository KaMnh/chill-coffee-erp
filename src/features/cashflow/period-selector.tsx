"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { solarToLunar } from "@/lib/lunar";
import {
  getCurrentWeekRange,
  getCurrentMonthRange,
} from "@/lib/period-math";
import type { PeriodPreset, PeriodState } from "@/lib/types";

interface PeriodSelectorProps {
  value: PeriodState;
  onChange(next: PeriodState): void;
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  week: "Tuần này",
  month: "Tháng này",
  custom: "Tuỳ chỉnh",
};

function formatRangeSolar(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-");
  const [ey, em, ed] = end.split("-");
  return `${sd}/${sm}/${sy} — ${ed}/${em}/${ey}`;
}

function formatRangeLunar(start: string, end: string): string {
  const startL = solarToLunar(start);
  const endL = solarToLunar(end);
  return `Âm: ${startL.day}/${startL.month} — ${endL.day}/${endL.month} năm ${endL.canChi}`;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const lunarLabel = useMemo(
    () => formatRangeLunar(value.start, value.end),
    [value.start, value.end],
  );

  function selectPreset(preset: PeriodPreset) {
    if (preset === "week") {
      const r = getCurrentWeekRange();
      onChange({ preset, start: r.start, end: r.end });
      return;
    }
    if (preset === "month") {
      const r = getCurrentMonthRange();
      onChange({ preset, start: r.start, end: r.end });
      return;
    }
    // custom: keep current dates
    onChange({ ...value, preset: "custom" });
  }

  function setCustomStart(start: string) {
    onChange({ ...value, preset: "custom", start });
  }
  function setCustomEnd(end: string) {
    onChange({ ...value, preset: "custom", end });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["week", "month", "custom"] as const).map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={value.preset === p ? "primary" : "secondary"}
            onClick={() => selectPreset(p)}
          >
            {PRESET_LABELS[p]}
          </Button>
        ))}
        {value.preset === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={value.start}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
              aria-label="Từ ngày"
            />
            <span className="text-muted">—</span>
            <input
              type="date"
              value={value.end}
              onChange={(e) => setCustomEnd(e.target.value)}
              min={value.start}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
              aria-label="Đến ngày"
            />
          </div>
        )}
      </div>
      <div>
        <p className="text-sm text-ink">{formatRangeSolar(value.start, value.end)}</p>
        <p className="text-xs text-muted mt-0.5">{lunarLabel}</p>
      </div>
    </div>
  );
}
