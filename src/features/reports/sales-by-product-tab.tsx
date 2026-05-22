"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ProductSummaryTable } from "./product-summary-table";
import { CategorySummaryTable } from "./category-summary-table";

/**
 * Phase 5.B — Sales tab inside ReportsView.
 *
 * Single source of truth for the date range: both
 * ProductSummaryTable and CategorySummaryTable receive the same
 * value. Changing the picker re-keys both TanStack Query caches.
 *
 * Mirrors InventoryAnalyticsTab (5.A) verbatim.
 */
export function SalesByProductTab() {
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      <section className="space-y-3">
        <ProductSummaryTable dateRange={dateRange} />
      </section>

      <section className="space-y-3">
        <CategorySummaryTable dateRange={dateRange} />
      </section>
    </div>
  );
}
