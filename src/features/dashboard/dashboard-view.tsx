"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useDashboardQuery, useHandoverQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import type { DashboardData } from "@/lib/types";
import type { ViewKey } from "@/features/navigation/navigation";
import { KpiBar } from "./kpi-bar";
import { ShortcutGrid } from "./shortcut-grid";
import { ExpenseLogCard } from "./expense-log-card";
import { SalesFeedCard } from "./sales-feed-card";
import { StoreStatusCard } from "./store-status-card";
import { HandoverPanel } from "./handover-panel";

const EMPTY: DashboardData = {
  business_date: "",
  total_sales: 0,
  cash_sales: 0,
  non_cash_sales: 0,
  opening_cash: 0,
  total_expenses: 0,
  payroll_paid: 0,
  active_staff: 0,
  expenses: [],
  sales_orders: [],
};

interface DashboardViewProps {
  businessDate: string;
  onNavigate(view: ViewKey): void;
}

export function DashboardView({ businessDate, onNavigate }: DashboardViewProps) {
  const supabase = useSupabase();
  const dashboardQuery = useDashboardQuery(supabase, businessDate, true);
  const handoverQuery = useHandoverQuery(supabase, businessDate, true);

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dashboard">
        {dashboardQuery.error instanceof Error
          ? dashboardQuery.error.message
          : String(dashboardQuery.error)}
      </AlertBanner>
    );
  }

  const data = dashboardQuery.data ?? { ...EMPTY, business_date: businessDate };
  const handover = handoverQuery.data ?? null;

  return (
    <div className="space-y-6">
      <KpiBar data={data} />
      <ShortcutGrid onNavigate={onNavigate} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ExpenseLogCard expenses={data.expenses} total={data.total_expenses} />
          <StoreStatusCard
            activeStaff={data.active_staff}
            latestSync={data.latest_sync}
            latestCashCount={data.latest_cash_count}
          />
        </div>
        <div className="space-y-6">
          <HandoverPanel handover={handover} />
          <SalesFeedCard orders={data.sales_orders} totalSales={data.total_sales} />
        </div>
      </div>
    </div>
  );
}
