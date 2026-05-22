"use client";

import { StatCard } from "@/components/ui/stat-card";
import type { StockBalance, StockMovement } from "@/lib/types";

interface InventoryKpiRowProps {
  balances: StockBalance[];
  /** Already filtered to last 7 days by parent. */
  weeklyMovements: StockMovement[];
}

/**
 * Phase 4.E — 4-card KPI row for inventory dashboard.
 *
 * Cards:
 *   1. Tổng nguyên liệu (mint)      → balances.length
 *   2. Sắp hết (peach)              → count where is_low
 *   3. Tồn âm (lilac)               → count where theoretical < 0
 *   4. Tiêu thụ tuần (blue)         → count of sale_theoretical movements
 *
 * Subtitle text adapts to zero vs non-zero state for cards 2 + 3.
 */
export function InventoryKpiRow({
  balances,
  weeklyMovements,
}: InventoryKpiRowProps) {
  const activeCount = balances.length;
  const lowStockCount = balances.filter((b) => b.is_low).length;
  const negativeCount = balances.filter(
    (b) => b.theoretical_balance < 0
  ).length;
  const weeklySaleCount = weeklyMovements.filter(
    (m) => m.reason === "sale_theoretical"
  ).length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        color="mint"
        title="Tổng nguyên liệu"
        subtitle="Đang dùng"
        value={activeCount}
      />
      <StatCard
        color="peach"
        title="Sắp hết"
        subtitle={lowStockCount === 0 ? "Tất cả đủ" : "Cần đặt thêm"}
        value={lowStockCount}
      />
      <StatCard
        color="lilac"
        title="Tồn âm"
        subtitle={negativeCount === 0 ? "Không có" : "Cần kiểm tra"}
        value={negativeCount}
      />
      <StatCard
        color="blue"
        title="Tiêu thụ tuần"
        subtitle="Giao dịch bán (lý thuyết)"
        value={weeklySaleCount}
      />
    </div>
  );
}
