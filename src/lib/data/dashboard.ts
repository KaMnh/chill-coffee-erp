import type { SupabaseClient } from "@supabase/supabase-js";
import type { DashboardData } from "@/lib/types";
import { toAppError, unwrapJson } from "./_common";

export async function loadDashboard(supabase: SupabaseClient, businessDate: string) {
  const { data, error } = await supabase.rpc("dashboard_daily_ops", {
    p_business_date: businessDate
  });
  if (error) throw toAppError(error, "Không tải được dữ liệu dashboard.");
  return unwrapJson<DashboardData>(data, {
    business_date: businessDate,
    total_sales: 0,
    cash_sales: 0,
    non_cash_sales: 0,
    opening_cash: 0,
    total_expenses: 0,
    payroll_paid: 0,
    active_staff: 0,
    expenses: [],
    sales_orders: []
  });
}
