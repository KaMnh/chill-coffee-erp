"use client";

import { useMemo } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import type { StockMovement } from "@/lib/types";

interface TopConsumptionListProps {
  /** Already filtered to last 7 days by parent. */
  weeklyMovements: StockMovement[];
}

interface AggregatedItem {
  ingredient_id: string;
  name: string;
  total: number;
}

/**
 * Phase 4.E — Top tiêu thụ tuần này list.
 *
 * Aggregation:
 *   1. Filter weeklyMovements where reason === "sale_theoretical"
 *   2. Group by ingredient_id; sum abs(quantity_delta) per group
 *   3. Sort by total descending; take top 5
 *
 * Display: name + magnitude (no unit suffix — mixed units across ingredients;
 * ranking by absolute magnitude is still the meaningful signal).
 */
export function TopConsumptionList({
  weeklyMovements,
}: TopConsumptionListProps) {
  const topConsumption = useMemo<AggregatedItem[]>(() => {
    const byIngredient = new Map<string, { name: string; total: number }>();
    for (const m of weeklyMovements) {
      if (m.reason !== "sale_theoretical") continue;
      const existing = byIngredient.get(m.ingredient_id);
      if (existing) {
        existing.total += Math.abs(m.quantity_delta);
      } else {
        byIngredient.set(m.ingredient_id, {
          name: m.ingredient_name,
          total: Math.abs(m.quantity_delta),
        });
      }
    }
    return Array.from(byIngredient.entries())
      .map(([id, v]) => ({
        ingredient_id: id,
        name: v.name,
        total: v.total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [weeklyMovements]);

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-medium text-ink mb-3">
          Top tiêu thụ tuần này
        </h3>

        {topConsumption.length === 0 ? (
          <EmptyState
            icon="info"
            title="Chưa có bán hàng trong tuần"
            subtitle="Chưa có dữ liệu tiêu thụ để hiển thị."
            dashedBorder
          />
        ) : (
          <div className="space-y-2">
            {topConsumption.map((item, idx) => (
              <div
                key={item.ingredient_id}
                className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-b-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="soft" semantic="neutral">
                    #{idx + 1}
                  </Badge>
                  <Icon name="package" size={16} className="text-muted shrink-0" />
                  <p className="text-sm text-ink truncate">{item.name}</p>
                </div>
                <p className="text-sm font-mono tabular-nums text-ink flex-shrink-0">
                  {item.total}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
