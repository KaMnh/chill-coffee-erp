"use client";

import { useMemo, useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import { useDashboardQuery, useHandoverQuery } from "@/hooks/queries";
import { useStockBalancesQuery } from "@/hooks/queries/use-inventory-queries";
import { useUpdateUserDashboardPreferences } from "@/hooks/mutations/use-profile-mutations";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { Account, DashboardData } from "@/lib/types";
import type { ViewKey } from "@/features/navigation/navigation";
import { KpiBar } from "./kpi-bar";
import { ShortcutGrid } from "./shortcut-grid";
import { ExpenseLogCard } from "./expense-log-card";
import { SalesFeedCard } from "./sales-feed-card";
import { StoreStatusCard } from "./store-status-card";
import { HandoverPanel } from "./handover-panel";
import {
  DashboardStockList,
  type StockSortColumn,
  type StockSortDir,
  type StockSortState,
} from "./dashboard-stock-list";

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
  account: Account;
}

const SORT_COLUMNS: ReadonlyArray<StockSortColumn> = ["name", "balance", "low_stock"];
const SORT_DIRS: ReadonlyArray<StockSortDir> = ["asc", "desc"];

function parseSortString(raw: string | null | undefined): StockSortState | null {
  if (!raw) return null;
  const [c, d] = raw.split("|");
  if (!SORT_COLUMNS.includes(c as StockSortColumn)) return null;
  if (!SORT_DIRS.includes(d as StockSortDir)) return null;
  return { column: c as StockSortColumn, dir: d as StockSortDir };
}

function sortStateToString(s: StockSortState): string {
  return `${s.column}|${s.dir}`;
}

export function DashboardView({ businessDate, onNavigate, account }: DashboardViewProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const dashboardQuery = useDashboardQuery(supabase, businessDate, true);
  const handoverQuery = useHandoverQuery(supabase, businessDate, true);
  const stockQuery = useStockBalancesQuery(supabase, true);
  const updatePrefsM = useUpdateUserDashboardPreferences(supabase);

  // Saved sort from profile.dashboard_preferences.stock_sort
  const savedSort = useMemo(
    () => parseSortString(account.dashboard_preferences?.stock_sort),
    [account.dashboard_preferences?.stock_sort]
  );

  // Current sort = saved sort hydrated, but user can change at runtime.
  // When `sort === null`, the saved value is null AND user hasn't picked yet.
  const [sort, setSort] = useState<StockSortState | null>(savedSort);

  // Keep currentSort in sync nếu saved value đổi (vd: tab khác cập nhật).
  // Chỉ sync nếu user chưa thay đổi (= current matches old saved).
  const currentSortString = sort ? sortStateToString(sort) : null;
  const savedSortString = savedSort ? sortStateToString(savedSort) : null;

  // isLocked: true khi sort hiện tại đúng bằng saved sort (và saved sort không null).
  const isLocked = Boolean(
    savedSortString && currentSortString && savedSortString === currentSortString
  );

  async function handleToggleLock() {
    try {
      if (isLocked) {
        // Hiện đang lock → clear saved sort.
        await updatePrefsM.mutateAsync({
          profileId: account.auth_user_id,
          patch: { stock_sort: null },
        });
        toast({ semantic: "success", message: "Đã bỏ khóa thứ tự sắp xếp." });
      } else if (sort) {
        await updatePrefsM.mutateAsync({
          profileId: account.auth_user_id,
          patch: { stock_sort: sortStateToString(sort) },
        });
        toast({ semantic: "success", message: "Đã khóa thứ tự này làm mặc định." });
      }
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được preference.",
      });
    }
  }

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

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tồn kho hiện tại</CardTitle>
            <p className="mt-1 text-xs text-muted">
              Click vào tiêu đề cột để sắp xếp. Bấm khóa cạnh cột đang sort để
              lưu làm mặc định riêng cho bạn.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          <DashboardStockList
            balances={stockQuery.data ?? []}
            isLoading={stockQuery.isLoading}
            isError={stockQuery.isError}
            sort={sort}
            onSortChange={setSort}
            isLocked={isLocked}
            onToggleLock={handleToggleLock}
          />
        </CardBody>
      </Card>
    </div>
  );
}
