"use client";

import { useMemo } from "react";
import { Icon } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Tooltip } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";
import { formatNumber, formatVND } from "@/lib/format";
import { rowValue } from "@/features/inventory/stock-value";
import type { StockBalance, IngredientReferencePrice } from "@/lib/types";

export type StockSortColumn = "name" | "balance" | "low_stock";
export type StockSortDir = "asc" | "desc";
export interface StockSortState {
  column: StockSortColumn;
  dir: StockSortDir;
}

interface DashboardStockListProps {
  balances: StockBalance[];
  isLoading: boolean;
  isError: boolean;
  sort: StockSortState | null;
  onSortChange: (next: StockSortState) => void;
  isLocked: boolean;
  onToggleLock: () => void;
  /**
   * Owner-only (spec 2026-06-12): map đơn giá tham chiếu — có mặt thì thêm
   * cột "Giá trị" (không sortable). Không truyền = bảng 3 cột như cũ.
   */
  prices?: ReadonlyMap<string, IngredientReferencePrice>;
}

const HEADERS: Array<{ column: StockSortColumn; label: string; align: "left" | "right" }> = [
  { column: "name", label: "Tên nguyên liệu", align: "left" },
  { column: "balance", label: "Tồn hiện tại", align: "right" },
  { column: "low_stock", label: "Cảnh báo", align: "right" },
];

/**
 * Bảng tồn kho compact cho Dashboard. Khác với StockBalanceList (card vertical
 * dùng trong tab Kho), bảng này dày và sortable.
 *
 * Default sort khi không có locked preference: low-stock first → name asc.
 *
 * Lock icon hiển thị cạnh header của cột đang sort. Click lock → save current
 * sort vào profiles.dashboard_preferences.stock_sort. Click lại → clear.
 */
export function DashboardStockList({
  balances,
  isLoading,
  isError,
  sort,
  onSortChange,
  isLocked,
  onToggleLock,
  prices,
}: DashboardStockListProps) {
  const sorted = useMemo(() => {
    const arr = [...balances];
    if (!sort) {
      // Default: low-stock first → name asc.
      arr.sort((a, b) => {
        if (a.is_low !== b.is_low) return a.is_low ? -1 : 1;
        return a.name.localeCompare(b.name, "vi");
      });
      return arr;
    }
    const dirMul = sort.dir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      if (sort.column === "name") {
        return dirMul * a.name.localeCompare(b.name, "vi");
      }
      if (sort.column === "balance") {
        return dirMul * (a.theoretical_balance - b.theoretical_balance);
      }
      // low_stock: true (sắp hết) đặt theo dir
      if (a.is_low !== b.is_low) return dirMul * (a.is_low ? -1 : 1);
      return a.name.localeCompare(b.name, "vi");
    });
    return arr;
  }, [balances, sort]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={24} />
      </div>
    );
  }

  if (isError) {
    return (
      <EmptyState
        icon="alertTriangle"
        title="Không tải được tồn kho"
        subtitle="Có thể bạn không có quyền xem hoặc kết nối DB lỗi."
      />
    );
  }

  if (sorted.length === 0) {
    return (
      <EmptyState
        icon="package"
        title="Chưa có nguyên liệu"
        subtitle="Thêm nguyên liệu trong Kho → tab Nguyên liệu."
      />
    );
  }

  function handleHeaderClick(column: StockSortColumn) {
    if (sort && sort.column === column) {
      onSortChange({ column, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ column, dir: column === "balance" ? "desc" : "asc" });
    }
  }

  const activeColumn = sort?.column ?? null;
  const activeDir = sort?.dir ?? null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
            {HEADERS.map((h) => {
              const isActive = activeColumn === h.column;
              return (
                <th
                  key={h.column}
                  className={cn(
                    "py-2 px-3 font-medium",
                    h.align === "right" ? "text-right" : "text-left"
                  )}
                >
                  <div
                    className={cn(
                      "inline-flex items-center gap-1",
                      h.align === "right" ? "flex-row-reverse" : ""
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleHeaderClick(h.column)}
                      className={cn(
                        "inline-flex items-center gap-1 hover:text-ink transition-colors",
                        isActive && "text-ink"
                      )}
                    >
                      {h.label}
                      {isActive && (
                        <Icon
                          name={activeDir === "asc" ? "chevronUp" : "chevronDown"}
                          size={16}
                        />
                      )}
                    </button>
                    {isActive && (
                      <Tooltip
                        content={isLocked ? "Bỏ khóa thứ tự (về mặc định)" : "Khóa thứ tự này làm mặc định"}
                        side="top"
                      >
                        <IconButton
                          icon={isLocked ? "lock" : "lockOpen"}
                          size={32}
                          variant="ghost"
                          onClick={onToggleLock}
                          aria-label={isLocked ? "Bỏ khóa thứ tự sắp xếp" : "Khóa thứ tự sắp xếp"}
                        />
                      </Tooltip>
                    )}
                  </div>
                </th>
              );
            })}
            {prices && (
              <th className="py-2 px-3 font-medium text-right">Giá trị</th>
            )}
          </tr>
        </thead>
        <tbody>
          {sorted.map((b) => {
            const balanceClass = cn(
              "tabular-nums",
              b.theoretical_balance < 0 && "text-danger font-medium"
            );
            return (
              <tr
                key={b.ingredient_id}
                className="border-b border-border-soft last:border-b-0 hover:bg-surface-muted/50"
              >
                <td className="py-2 px-3 text-ink">{b.name}</td>
                <td className={cn("py-2 px-3 text-right", balanceClass)}>
                  {formatNumber(b.theoretical_balance)} {b.unit}
                </td>
                <td className="py-2 px-3 text-right">
                  {b.theoretical_balance < 0 ? (
                    <span className="inline-flex items-center rounded-full bg-danger/10 text-danger px-2 py-0.5 text-xs font-medium">
                      Âm
                    </span>
                  ) : b.is_low ? (
                    <span className="inline-flex items-center rounded-full bg-peach/40 text-peach-ink px-2 py-0.5 text-xs font-medium">
                      Sắp hết
                    </span>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </td>
                {prices && (
                  <td className="py-2 px-3 text-right tabular-nums">
                    {(() => {
                      const v = rowValue(
                        b.theoretical_balance,
                        prices.get(b.ingredient_id)?.unit_price
                      );
                      if (v == null) return <span className="text-muted/60">—</span>;
                      return (
                        <span className={v < 0 ? "text-danger" : "text-ink"}>
                          {formatVND(v)}
                        </span>
                      );
                    })()}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
