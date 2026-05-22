"use client";

import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * Phase 5.A — Shared DateRangePicker.
 *
 * Used by InventoryAnalyticsTab (5.A) and reused by 5.B/C/D
 * (Sales/Expense/Payroll/Hourly reports). Pure controlled component
 * — parent owns the DateRange state.
 *
 * Preset semantics (Vietnamese business week starts Monday):
 *   - today: [today, today]
 *   - week:  [Monday of this week, today]
 *   - month: [1st of current month, today]
 *   - custom: parent-supplied from/to (HTML date inputs revealed)
 */

export type DateRangePreset = "today" | "week" | "month" | "custom";

export interface DateRange {
  preset: DateRangePreset;
  from: string; // YYYY-MM-DD (local time)
  to: string;   // YYYY-MM-DD (local time)
}

interface DateRangePickerProps {
  value: DateRange;
  onChange(next: DateRange): void;
  className?: string;
}

const PRESET_LABELS: Record<Exclude<DateRangePreset, "custom">, string> = {
  today: "Hôm nay",
  week:  "Tuần này",
  month: "Tháng này",
};

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  function selectPreset(preset: Exclude<DateRangePreset, "custom">) {
    onChange(rangeFromPreset(preset));
  }

  function selectCustom() {
    // Keep current from/to but switch preset flag — reveals the date inputs.
    onChange({ preset: "custom", from: value.from, to: value.to });
  }

  function changeFrom(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ preset: "custom", from: e.target.value, to: value.to });
  }

  function changeTo(e: React.ChangeEvent<HTMLInputElement>) {
    onChange({ preset: "custom", from: value.from, to: e.target.value });
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted mr-1">Khoảng thời gian:</span>
        {(Object.keys(PRESET_LABELS) as Array<Exclude<DateRangePreset, "custom">>).map((p) => (
          <Button
            key={p}
            type="button"
            variant={value.preset === p ? "primary" : "ghost"}
            size="sm"
            onClick={() => selectPreset(p)}
          >
            {PRESET_LABELS[p]}
          </Button>
        ))}
        <Button
          type="button"
          variant={value.preset === "custom" ? "primary" : "ghost"}
          size="sm"
          onClick={selectCustom}
        >
          Khoảng tùy chọn
        </Button>
      </div>

      {value.preset === "custom" && (
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Từ</span>
            <input
              type="date"
              value={value.from}
              onChange={changeFrom}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Đến</span>
            <input
              type="date"
              value={value.to}
              onChange={changeTo}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/**
 * Default = "Tuần này" (Monday → today). Used by the analytics tab
 * to initialise state lazily: `useState(() => defaultDateRange())`.
 */
export function defaultDateRange(): DateRange {
  return rangeFromPreset("week");
}

export function rangeFromPreset(
  preset: Exclude<DateRangePreset, "custom">
): DateRange {
  const now = new Date();
  const today = toISODate(now);

  if (preset === "today") {
    return { preset: "today", from: today, to: today };
  }

  if (preset === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    return { preset: "month", from: toISODate(first), to: today };
  }

  // week: Monday-based
  const dayOfWeek = (now.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek);
  return { preset: "week", from: toISODate(monday), to: today };
}

function toISODate(d: Date): string {
  // YYYY-MM-DD in LOCAL time (avoid toISOString() which is UTC).
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
