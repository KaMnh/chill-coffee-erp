"use client";

import { useSupabase } from "@/hooks/use-supabase";
import {
  useDashboardQuery,
  useExpenseCategoriesQuery,
  useExpenseTemplatesQuery,
} from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import type { UserRole } from "@/lib/types";
import { ExpenseForm } from "./expense-form";
import { ExpenseHistoryCard } from "./expense-history-card";

interface ExpensesViewProps {
  businessDate: string;
  role: UserRole;
}

/**
 * Top-level container for view === "expenses". Mounts the 3 queries it
 * needs (dashboard for the expenses list, categories + templates for the
 * form), handles loading / error states, and lays out form-left /
 * history-right in a 2-col bento.
 *
 * The list of today's expenses comes from `dashboardQuery.data.expenses`
 * (no separate query) — this means a new mutation that invalidates
 * dashboard also refreshes this list in the same render cycle.
 */
export function ExpensesView({ businessDate, role }: ExpensesViewProps) {
  const supabase = useSupabase();
  const dashboardQuery = useDashboardQuery(supabase, businessDate, true);
  const categoriesQuery = useExpenseCategoriesQuery(supabase, true);
  const templatesQuery = useExpenseTemplatesQuery(supabase, true);

  if (dashboardQuery.isLoading || categoriesQuery.isLoading || templatesQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dữ liệu chi phí">
        {dashboardQuery.error instanceof Error
          ? dashboardQuery.error.message
          : String(dashboardQuery.error)}
      </AlertBanner>
    );
  }

  const expenses = dashboardQuery.data?.expenses ?? [];
  const totalExpenses = dashboardQuery.data?.total_expenses ?? 0;
  const categories = categoriesQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <ExpenseForm
        businessDate={businessDate}
        categories={categories}
        templates={templates}
      />
      <ExpenseHistoryCard
        expenses={expenses}
        total={totalExpenses}
        role={role}
        businessDate={businessDate}
      />
    </div>
  );
}
