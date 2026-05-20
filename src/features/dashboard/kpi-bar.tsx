"use client";

import { StatCard } from "@/components/ui/stat-card";
import { formatVND } from "@/lib/format";
import type { DashboardData } from "@/lib/types";

interface KpiBarProps {
  data: DashboardData;
}

/**
 * Top-of-dashboard KPI strip — 5 pastel StatCards mirroring v3 MetricsBar.
 *
 * Mapping vs v3 MetricsBar:
 *   pos     -> "Thu POS"          = total_sales - cash_sales (non-cash POS)
 *   cash    -> "Thu tiền mặt"     = cash_sales
 *   expense -> "Tổng chi"         = total_expenses
 *   payroll -> "Lương đã phát"    = payroll_paid
 *   staff   -> "Đang trong ca"    = active_staff (integer)
 *
 * Color order: peach / blue / mint / lilac / peach — alternates warm/cool.
 */
export function KpiBar({ data }: KpiBarProps) {
  const posSales = Math.max(0, (data.total_sales ?? 0) - (data.cash_sales ?? 0));
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        color="peach"
        title="Thu POS"
        subtitle="Không tiền mặt"
        value={formatVND(posSales)}
      />
      <StatCard
        color="blue"
        title="Thu tiền mặt"
        subtitle="Đếm trong két"
        value={formatVND(data.cash_sales)}
      />
      <StatCard
        color="mint"
        title="Tổng chi"
        subtitle="Hôm nay"
        value={formatVND(data.total_expenses)}
      />
      <StatCard
        color="lilac"
        title="Lương đã phát"
        subtitle="Trong ngày"
        value={formatVND(data.payroll_paid)}
      />
      <StatCard
        color="peach"
        title="Đang trong ca"
        subtitle="Nhân viên"
        value={`${data.active_staff} người`}
      />
    </div>
  );
}
