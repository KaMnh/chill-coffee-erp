"use client";

import { useMemo, useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import { useSalesHourlySummaryQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DateRangePicker,
  defaultDateRange,
  type DateRange,
} from "./date-range-picker";
import { HourlyKpiRow } from "./hourly-kpi-row";
import { HourlyBarChart } from "./hourly-bar-chart";
import type { HourlyRow } from "@/lib/data";

/**
 * Phase 5.D — Hourly trends tab inside ReportsView.
 *
 * Differs from 5.A/B/C tabs: this tab OWNS the query (not a pure
 * composition). Branches loading/error/empty at the tab level
 * (not per-child) because both children share the same data array.
 *
 * Empty detection uses `every(d => total_revenue === 0)` because
 * the RPC always returns 24 rows (generate_series) — `data.length
 * === 0` would never trigger.
 *
 * `is_peak` is derived client-side via argmax over total_revenue.
 * The guard `maxRevenue > 0` prevents highlighting hour=0 in an
 * empty range (defensive — the EmptyState branch would have
 * rendered first anyway).
 */
export function HourlyTrendsTab() {
  const supabase = useSupabase();
  const [dateRange, setDateRange] = useState<DateRange>(() => defaultDateRange());
  const query = useSalesHourlySummaryQuery(
    supabase,
    dateRange.from,
    dateRange.to,
    !!supabase
  );

  const enrichedData = useMemo<(HourlyRow & { is_peak: boolean })[]>(() => {
    const data = query.data ?? [];
    const maxRevenue = Math.max(0, ...data.map((d) => d.total_revenue));
    return data.map((row) => ({
      ...row,
      is_peak: maxRevenue > 0 && row.total_revenue === maxRevenue,
    }));
  }, [query.data]);

  const hasRevenue = enrichedData.some((d) => d.total_revenue > 0);

  return (
    <div className="space-y-6">
      <DateRangePicker value={dateRange} onChange={setDateRange} />

      {query.isLoading && (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      )}

      {query.isError && (
        <AlertBanner variant="danger" title="Không tải được báo cáo theo giờ">
          Vui lòng tải lại trang. Lỗi:{" "}
          {query.error instanceof Error ? query.error.message : String(query.error)}
        </AlertBanner>
      )}

      {!query.isLoading && !query.isError && !hasRevenue && (
        <EmptyState
          dashedBorder
          icon="barChart3"
          title="Chưa có doanh số trong khoảng này"
          subtitle="Đổi khoảng thời gian hoặc đợi sync POS mới."
        />
      )}

      {!query.isLoading && !query.isError && hasRevenue && (
        <>
          <HourlyKpiRow data={enrichedData} />
          <HourlyBarChart data={enrichedData} />
        </>
      )}
    </div>
  );
}
