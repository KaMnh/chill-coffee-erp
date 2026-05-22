"use client";

import { useState } from "react";
import { DateRangePicker, defaultDateRange, type DateRange } from "./date-range-picker";
import { ExpenseByCategoryTable } from "./expense-by-category-table";
import { PayrollSummaryTable } from "./payroll-summary-table";

/**
 * Phase 5.C — Expense + payroll tab inside ReportsView.
 *
 * Single source of truth for the date range: both
 * ExpenseByCategoryTable and PayrollSummaryTable receive the same
 * value. Changing the picker re-keys both TanStack Query caches.
 *
 * Mirrors InventoryAnalyticsTab (5.A) and SalesByProductTab (5.B)
 * verbatim.
 */
export function ExpensePayrollTab() {
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      <section className="space-y-3">
        <ExpenseByCategoryTable dateRange={dateRange} />
      </section>

      <section className="space-y-3">
        <PayrollSummaryTable dateRange={dateRange} />
      </section>
    </div>
  );
}
