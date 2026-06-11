"use client";

import * as RadixProgress from "@radix-ui/react-progress";
import { cn } from "@/lib/cn";

interface ProgressBarProps {
  value?: number; // 0-100; undefined = indeterminate
  showLabel?: boolean;
  className?: string;
  /** Tên cho screen reader (axe: aria-progressbar-name). */
  "aria-label"?: string;
}

export function ProgressBar({ value, showLabel, className, "aria-label": ariaLabel }: ProgressBarProps) {
  const indeterminate = value == null;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <RadixProgress.Root
        value={indeterminate ? undefined : value}
        aria-label={ariaLabel ?? "Tiến độ"}
        className="relative w-full h-2 rounded-full bg-border overflow-hidden"
      >
        {indeterminate ? (
          <div className="absolute inset-0 shimmer bg-ink" />
        ) : (
          <RadixProgress.Indicator
            className="h-full rounded-full bg-ink transition-transform duration-200"
            style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
          />
        )}
      </RadixProgress.Root>
      {showLabel && !indeterminate && (
        <span className="text-xs text-muted tabular-nums w-10 text-right">{value}%</span>
      )}
    </div>
  );
}
