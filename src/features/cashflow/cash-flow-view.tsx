"use client";

import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import { useCashFlowOverviewQuery } from "@/hooks/queries";
import {
  getCurrentMonthRange,
  getPreviousPeriod,
} from "@/lib/period-math";
import type { PeriodState, UserRole } from "@/lib/types";
import { PeriodSelector } from "./period-selector";
import { CashFlowKpiBar } from "./cash-flow-kpi-bar";
import { CashFlowChart } from "./cash-flow-chart";
import { TopCategoriesTable } from "./top-categories-table";
import { LunarCalendarWidget } from "./lunar-calendar-widget";

interface CashFlowViewProps {
  role: UserRole;
}

function defaultPeriod(): PeriodState {
  const r = getCurrentMonthRange();
  return { preset: "month", start: r.start, end: r.end };
}

export function CashFlowView({ role }: CashFlowViewProps) {
  const supabase = useSupabase();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);

  const compare = useMemo(
    () => getPreviousPeriod(period.start, period.end, period.preset),
    [period.start, period.end, period.preset],
  );

  const query = useCashFlowOverviewQuery(
    supabase,
    {
      start: period.start,
      end: period.end,
      compareStart: compare.start,
      compareEnd: compare.end,
    },
    role === "owner" || role === "manager",
  );

  if (role !== "owner" && role !== "manager") {
    return (
      <EmptyState
        icon="lock"
        title="Module dành cho owner/manager"
        subtitle="Bạn chưa có quyền vào trang này."
      />
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dòng tiền">
        {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  return (
    <div className="space-y-6">
      <PeriodSelector value={period} onChange={setPeriod} />
      <CashFlowKpiBar data={query.data} preset={period.preset} />
      <CashFlowChart byDay={query.data?.by_day ?? []} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopCategoriesTable rows={query.data?.top_categories ?? []} />
        <LunarCalendarWidget start={period.start} end={period.end} />
      </div>
    </div>
  );
}
