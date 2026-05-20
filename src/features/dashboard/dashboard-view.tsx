"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useDashboardQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import type { DashboardData } from "@/lib/types";
import { KpiBar } from "./kpi-bar";

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
}

export function DashboardView({ businessDate }: DashboardViewProps) {
  const supabase = useSupabase();
  const query = useDashboardQuery(supabase, businessDate, true);

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dashboard">
        {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? { ...EMPTY, business_date: businessDate };

  return (
    <div className="space-y-6">
      <KpiBar data={data} />
      {/* Task 8 fills in: shortcut grid, expense log, sales feed, store status, handover */}
      <EmptyState
        icon="sparkles"
        title="Các thẻ chi tiết sẽ vào ở Task 8"
        subtitle="Đang còn thiếu: shortcut grid, expense log, sales feed, store status, handover panel."
      />
    </div>
  );
}
