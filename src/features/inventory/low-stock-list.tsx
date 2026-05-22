"use client";

import { useMemo } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { formatUnit } from "./units";
import type { StockBalance } from "@/lib/types";

interface LowStockListProps {
  balances: StockBalance[];
}

/**
 * Phase 4.E — Sắp hết hàng list.
 *
 * Filters balances where is_low === true AND threshold !== null.
 * Sorts by deficit ratio = (threshold - balance) / threshold descending.
 * Returns top 10.
 */
export function LowStockList({ balances }: LowStockListProps) {
  const lowStock = useMemo(() => {
    return balances
      .filter((b) => b.is_low && b.low_stock_threshold !== null)
      .sort((a, b) => {
        const da =
          (a.low_stock_threshold! - a.theoretical_balance) /
          Math.max(a.low_stock_threshold!, 1);
        const db =
          (b.low_stock_threshold! - b.theoretical_balance) /
          Math.max(b.low_stock_threshold!, 1);
        return db - da;
      })
      .slice(0, 10);
  }, [balances]);

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">Sắp hết hàng</h3>
          {lowStock.length > 0 && (
            <Badge variant="soft" semantic="warning">
              {lowStock.length}
            </Badge>
          )}
        </div>

        {lowStock.length === 0 ? (
          <p className="text-sm text-muted">Tất cả nguyên liệu đủ tồn ✓</p>
        ) : (
          <div className="space-y-2">
            {lowStock.map((b) => (
              <div
                key={b.ingredient_id}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="package" size={16} className="text-muted shrink-0" />
                  <p className="text-sm text-ink truncate">{b.name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="text-xs font-mono tabular-nums text-muted">
                    {b.theoretical_balance}/{b.low_stock_threshold}{" "}
                    {formatUnit(b.unit)}
                  </p>
                  <Badge variant="soft" semantic="warning">
                    Sắp hết
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
