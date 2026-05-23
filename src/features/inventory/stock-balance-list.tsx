"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import { formatUnit } from "./units";
import type { StockBalance } from "@/lib/types";

interface StockBalanceListProps {
  balances: StockBalance[];
  isLoading: boolean;
  isError: boolean;
  /**
   * Optional click handler — when present, each ingredient row becomes
   * interactive (button role, keyboard activation). Used by Kho tab to
   * open the unified "Ghi nhận" modal with the row's ingredient
   * pre-selected.
   */
  onSelectIngredient?(ingredientId: string): void;
}

/**
 * Phase 4.D — Stock balance list (display only).
 *
 * Renders one card per active ingredient with:
 *   - Icon + name
 *   - Theoretical balance + unit (large, tabular-nums)
 *   - is_low badge (warning) if backend flag set
 *   - "Âm" badge (danger) if balance < 0 (overdraft signal)
 *   - Last-movement relative time
 *
 * Pure presentation — parent owns the query.
 */
export function StockBalanceList({
  balances,
  isLoading,
  isError,
  onSelectIngredient,
}: StockBalanceListProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }
  if (isError) {
    return (
      <AlertBanner variant="danger">
        Không tải được tồn kho. Vui lòng tải lại trang.
      </AlertBanner>
    );
  }
  if (balances.length === 0) {
    return (
      <EmptyState
        icon="package"
        title="Chưa có nguyên liệu nào"
        subtitle="Thêm nguyên liệu ở tab Nguyên liệu trước."
        dashedBorder
      />
    );
  }

  return (
    <div className="space-y-2">
      {balances.map((b) => {
        const isNegative = b.theoretical_balance < 0;
        const clickable = onSelectIngredient != null;
        const interactiveProps = clickable
          ? {
              role: "button" as const,
              tabIndex: 0,
              onClick: () => onSelectIngredient?.(b.ingredient_id),
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectIngredient?.(b.ingredient_id);
                }
              },
              className:
                "cursor-pointer transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
              "aria-label": `Ghi nhận kho cho ${b.name}`,
            }
          : {};
        return (
          <Card key={b.ingredient_id} {...interactiveProps}>
            <CardBody>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <Icon
                    name="package"
                    size={20}
                    className="text-muted mt-0.5"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate">
                      {b.name}
                    </p>
                    {b.last_movement_at && (
                      <p className="text-xs text-muted mt-0.5">
                        Lần cuối: {formatRelative(b.last_movement_at)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <p
                    className={
                      "text-base font-mono tabular-nums " +
                      (isNegative ? "text-danger" : "text-ink")
                    }
                  >
                    {b.theoretical_balance} {formatUnit(b.unit)}
                  </p>
                  {isNegative && (
                    <Badge variant="soft" semantic="danger">
                      Âm
                    </Badge>
                  )}
                  {b.is_low && b.low_stock_threshold !== null && (
                    <Badge variant="soft" semantic="warning">
                      Sắp hết — dưới {b.low_stock_threshold}{" "}
                      {formatUnit(b.unit)}
                    </Badge>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

/**
 * Format a timestamp as Vietnamese relative time.
 * "hôm nay HH:MM" for today, "hôm qua" for yesterday,
 * "{N} ngày trước" for older within a week, else absolute date.
 */
function formatRelative(iso: string): string {
  const then = new Date(iso);
  const now = new Date();

  const isSameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();

  if (isSameDay) {
    const hh = String(then.getHours()).padStart(2, "0");
    const mm = String(then.getMinutes()).padStart(2, "0");
    return `hôm nay ${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();
  if (isYesterday) return "hôm qua";

  const diffMs = now.getTime() - then.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays > 0 && diffDays <= 7) return `${diffDays} ngày trước`;

  const dd = String(then.getDate()).padStart(2, "0");
  const mo = String(then.getMonth() + 1).padStart(2, "0");
  const yyyy = then.getFullYear();
  return `${dd}/${mo}/${yyyy}`;
}
