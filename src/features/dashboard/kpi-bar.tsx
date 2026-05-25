"use client";

import { StatCard } from "@/components/ui/stat-card";
import { formatVND } from "@/lib/format";
import type { DashboardData } from "@/lib/types";

interface KpiBarProps {
  data: DashboardData;
}

/**
 * Top-of-dashboard KPI strip — 4 pastel StatCards.
 *
 * Mapping:
 *   pos     -> "Thu POS"          = total_sales (cash + non-cash, recorded via POS)
 *   expense -> "Tổng chi"         = total_expenses
 *   payroll -> "Lương đã phát"    = payroll_paid
 *   staff   -> "Đang trong ca"    = active_staff (integer)
 *
 * Note: quán bán 100% qua POS nên một thẻ "Thu POS" đủ thể hiện doanh thu.
 * Cash vs non-cash breakdown vẫn được dùng ở Chốt két (reads from RPC fields).
 *
 * Color order: peach / mint / lilac / peach — alternates warm/cool.
 */
export function KpiBar({ data }: KpiBarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4">
      <StatCard
        color="peach"
        title="Thu POS"
        subtitle="Tổng doanh thu"
        value={formatVND(data.total_sales)}
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
