"use client";

import { useMemo } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useStockBalancesQuery,
  useStockMovementsQuery,
} from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { InventoryKpiRow } from "./inventory-kpi-row";
import { LowStockList } from "./low-stock-list";
import { NegativeBalanceList } from "./negative-balance-list";
import { TopConsumptionList } from "./top-consumption-list";

/**
 * Phase 4.E — Inventory dashboard tab container.
 *
 * Fetches:
 *   - useStockBalancesQuery (no filter) — feeds KPI + LowStock + Negative
 *   - useStockMovementsQuery({from: 7d ago, limit: 1000}) — feeds KPI + TopConsumption
 *
 * Loading: top-level Spinner if EITHER query loading.
 * Error: top-level AlertBanner.danger if EITHER query errored.
 * Data: KPI row + 2-column grid (LowStock + Negative) + TopConsumption.
 *
 * All aggregation happens inside child components via useMemo.
 *
 * No write controls; no canWrite plumbing needed.
 */
export function InventoryDashboardTab() {
  const supabase = useSupabase();
  const balancesQuery = useStockBalancesQuery(supabase, true);

  // Last 7 days rolling window (now - 7×24h)
  const weekAgoISO = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 7);
    return d.toISOString();
  }, []);

  const movementsQuery = useStockMovementsQuery(
    supabase,
    { from: weekAgoISO, limit: 1000 },
    true
  );

  const balances = balancesQuery.data ?? [];
  const weeklyMovements = movementsQuery.data ?? [];

  if (balancesQuery.isLoading || movementsQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (balancesQuery.isError || movementsQuery.isError) {
    return (
      <AlertBanner variant="danger">
        Không tải được tổng quan kho. Vui lòng tải lại trang.
      </AlertBanner>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-base font-medium text-ink">Tổng quan kho</h2>

      <InventoryKpiRow
        balances={balances}
        weeklyMovements={weeklyMovements}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <LowStockList balances={balances} />
        <NegativeBalanceList balances={balances} />
      </div>

      <TopConsumptionList weeklyMovements={weeklyMovements} />
    </div>
  );
}
