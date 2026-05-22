"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ConsumptionReport } from "./consumption-report";
import { VarianceAuditReport } from "./variance-audit-report";

/**
 * Phase 5.A — Inventory tab inside ReportsView.
 *
 * Single source of truth for the date range: both ConsumptionReport
 * and VarianceAuditReport receive the same value. Changing the
 * picker re-keys both TanStack Query caches and refetches.
 */
export function InventoryAnalyticsTab() {
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      <section className="space-y-3">
        <ConsumptionReport dateRange={dateRange} />
      </section>

      <section className="space-y-3">
        <VarianceAuditReport dateRange={dateRange} />
      </section>
    </div>
  );
}
