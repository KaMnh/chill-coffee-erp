"use client";

import { useMemo } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { formatUnit } from "./units";
import type { StockBalance } from "@/lib/types";

interface NegativeBalanceListProps {
  balances: StockBalance[];
}

/**
 * Phase 4.E — Tồn âm list.
 *
 * Filters balances where theoretical_balance < 0.
 * Sorts ascending (most negative first). Returns top 10.
 */
export function NegativeBalanceList({ balances }: NegativeBalanceListProps) {
  const negative = useMemo(() => {
    return balances
      .filter((b) => b.theoretical_balance < 0)
      .sort((a, b) => a.theoretical_balance - b.theoretical_balance)
      .slice(0, 10);
  }, [balances]);

  return (
    <Card>
      <CardBody>
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h3 className="text-sm font-medium text-ink">
            Tồn âm — cần kiểm tra
          </h3>
          {negative.length > 0 && (
            <Badge variant="soft" semantic="danger">
              {negative.length}
            </Badge>
          )}
        </div>

        {negative.length === 0 ? (
          <p className="text-sm text-muted">Không có nguyên liệu nào âm ✓</p>
        ) : (
          <div className="space-y-2">
            {negative.map((b) => (
              <div
                key={b.ingredient_id}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon name="package" size={16} className="text-muted shrink-0" />
                  <p className="text-sm text-ink truncate">{b.name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <p className="text-xs font-mono tabular-nums text-danger">
                    {b.theoretical_balance} {formatUnit(b.unit)}
                  </p>
                  <Badge variant="soft" semantic="danger">
                    Âm {Math.abs(b.theoretical_balance)} {formatUnit(b.unit)}
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
