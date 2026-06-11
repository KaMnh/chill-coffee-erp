"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { formatNumber, formatVND } from "@/lib/format";
import {
  DENOMINATIONS,
  handleDenominationKeyDown,
  normalizeCount,
  type DenominationInputRefs,
} from "./denominations";
import { computeDenominationTotal } from "./cash-math";

interface DenominationGridProps {
  /** Map of denomination (as string or number) → count. */
  value: Record<string, number>;
  onChange(next: Record<string, number>): void;
  readOnly?: boolean;
  /** Show quick-add chips [+1, +5, +10, +20]. Default true. Pass false for compact mode. */
  showQuickAdd?: boolean;
  /** Disable inputs (during mutation). */
  disabled?: boolean;
  /** Label displayed above the grid total. Default "Tổng". */
  totalLabel?: string;
}

/**
 * Reusable denomination grid — 9 VND mệnh giá (500k → 1k) with stepper,
 * numeric input, quick-add chips (+1/+5/+10/+20), and per-row total.
 * Arrow-key navigation: Up/Down move focus between rows; Left/Right
 * decrement/increment count.
 *
 * Single source of truth for denomination editing across:
 *   - CashView main panel (main cash being counted)
 *   - OpeningCashModal (opening day cash)
 *   - EditCashCountModal (admin edit cash_count)
 *   - LeaveDenominationPopup (leave breakdown)
 */
export function DenominationGrid({
  value,
  onChange,
  readOnly = false,
  showQuickAdd = true,
  disabled = false,
  totalLabel = "Tổng",
}: DenominationGridProps) {
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  function updateCount(denomination: number, delta: number) {
    if (readOnly || disabled) return;
    onChange({
      ...value,
      [String(denomination)]: normalizeCount((value[String(denomination)] ?? 0) + delta),
    });
  }

  function setCount(denomination: number, raw: string) {
    if (readOnly || disabled) return;
    onChange({
      ...value,
      [String(denomination)]: normalizeCount(raw),
    });
  }

  const total = computeDenominationTotal(value);
  const isInteractive = !readOnly && !disabled;

  return (
    <div className="flex flex-col gap-2">
      {DENOMINATIONS.map((denomination) => {
        const count = value[String(denomination)] ?? 0;
        const rowTotal = denomination * count;
        return (
          /* Mobile (<md): hàng 2 tầng — nhãn + tổng dòng trên, stepper 44px +
             ô số + chip wrap dưới (grid 4 cột cũ ép min-width ~412px → cả
             trang bị kéo ngang ở 375px). Desktop (md:) giữ nguyên grid cũ. */
          <article
            key={denomination}
            className="rounded-md border border-border bg-surface p-2 md:grid md:grid-cols-[100px_auto_1fr_auto] md:gap-3 md:items-center"
          >
            <div className="flex items-baseline justify-between md:contents">
              <strong className="font-display text-sm text-ink md:order-1">{formatVND(denomination)}</strong>
              <span className="text-sm text-muted md:hidden">{formatNumber(rowTotal)}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 md:order-2 md:mt-0 md:flex-nowrap md:gap-1">
              <button
                type="button"
                disabled={!isInteractive}
                onClick={() => updateCount(denomination, -1)}
                aria-label={`Giảm 1 tờ ${formatVND(denomination)}`}
                className={cn(
                  "w-11 h-11 md:w-7 md:h-7 shrink-0 rounded-full border border-border flex items-center justify-center transition-colors",
                  isInteractive ? "hover:bg-surface-muted" : "opacity-40 cursor-not-allowed"
                )}
              >
                <Icon name="minus" size={16} />
              </button>
              <input
                ref={(node) => {
                  inputRefs.current[denomination] = node;
                }}
                value={count === 0 ? "" : count}
                onFocus={(e) => e.currentTarget.select()}
                readOnly={readOnly}
                disabled={disabled}
                aria-label={`${formatVND(denomination)} số tờ`}
                onChange={(e) => setCount(denomination, e.target.value)}
                onKeyDown={(e) =>
                  handleDenominationKeyDown(e, denomination, {
                    inputRefs: inputRefs as DenominationInputRefs,
                    updateCount,
                    readOnly: readOnly || disabled,
                  })
                }
                inputMode="numeric"
                className={cn(
                  // text-base ở mobile: ≥16px để iOS không auto-zoom khi focus.
                  "w-16 h-11 text-base md:w-14 md:h-7 md:text-sm rounded-sm border border-border bg-surface text-center text-ink",
                  "focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong",
                  (readOnly || disabled) && "bg-surface-muted text-muted cursor-not-allowed"
                )}
              />
              <button
                type="button"
                disabled={!isInteractive}
                onClick={() => updateCount(denomination, +1)}
                aria-label={`Tăng 1 tờ ${formatVND(denomination)}`}
                className={cn(
                  "w-11 h-11 md:w-7 md:h-7 shrink-0 rounded-full border border-border flex items-center justify-center transition-colors",
                  isInteractive ? "hover:bg-surface-muted" : "opacity-40 cursor-not-allowed"
                )}
              >
                <Icon name="plus" size={16} />
              </button>
              {/* min-w trên cụm chip: không đủ chỗ cạnh stepper thì rớt nguyên
                  hàng xuống dưới (1 hàng ngang gọn) thay vì bị bóp thành cột dọc. */}
              {showQuickAdd && (
                <div className="flex flex-1 min-w-[150px] items-center justify-end gap-1.5 flex-wrap md:hidden" aria-label="Cộng nhanh">
                  {[5, 10, 20].map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      disabled={!isInteractive}
                      onClick={() => updateCount(denomination, delta)}
                      aria-label={`Cộng ${delta} tờ ${formatVND(denomination)}`}
                      className={cn(
                        "h-11 min-w-11 px-2.5 rounded-full border border-border bg-surface-muted text-xs text-ink transition-colors",
                        isInteractive ? "active:border-border-strong" : "opacity-40 cursor-not-allowed"
                      )}
                    >
                      +{delta}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {showQuickAdd ? (
              <div className="hidden md:flex items-center gap-1 flex-wrap md:order-3" aria-label="Cộng nhanh">
                {[1, 5, 10, 20].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    disabled={!isInteractive}
                    onClick={() => updateCount(denomination, delta)}
                    aria-label={`Cộng ${delta} tờ ${formatVND(denomination)}`}
                    className={cn(
                      "px-2 py-0.5 rounded-full border border-border bg-surface text-xs text-ink transition-colors",
                      isInteractive ? "hover:bg-surface-muted hover:border-border-strong" : "opacity-40 cursor-not-allowed"
                    )}
                  >
                    +{delta}
                  </button>
                ))}
              </div>
            ) : (
              <span className="hidden md:block md:order-3" />
            )}
            <span className="hidden md:block text-sm text-muted shrink-0 md:order-4">{formatNumber(rowTotal)}</span>
          </article>
        );
      })}
      <div className="flex items-center justify-between border-t border-border pt-3 mt-1">
        <span className="text-sm text-muted">{totalLabel}</span>
        <strong className="font-display text-base text-ink">{formatVND(total)}</strong>
      </div>
    </div>
  );
}
