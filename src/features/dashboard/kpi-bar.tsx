"use client";

import { StatCard } from "@/components/ui/stat-card";
import { CountUp } from "@/components/ui/count-up";
import { Reveal } from "@/components/ui/reveal";
import { formatVND } from "@/lib/format";
import type { DashboardData } from "@/lib/types";

interface KpiBarProps {
  data: DashboardData;
  /** Chi phí lương tạm tính hôm nay (đã chốt mọi method + đang phát sinh). */
  liveLaborCost: number;
}

/**
 * Top-of-dashboard KPI strip — 4 pastel StatCards.
 *
 * Mapping:
 *   pos     -> "Thu POS"                     = total_sales (cash + non-cash, qua POS)
 *   expense -> "Tổng chi"                    = total_expenses
 *   payroll -> "Lương hôm nay (tạm tính)"    = liveLaborCost (đã chốt mọi method + đang phát sinh)
 *   staff   -> "Đang trong ca"               = active_staff (integer)
 *
 * Note: quán bán 100% qua POS nên một thẻ "Thu POS" đủ thể hiện doanh thu.
 * Lương tạm tính do useLiveLaborCost tính (client tick 60s); KpiBar chỉ hiển thị.
 *
 * Color order: peach / mint / lilac / peach — alternates warm/cool.
 */
export function KpiBar({ data, liveLaborCost }: KpiBarProps) {
  return (
    <Reveal
      stagger
      className="grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-4"
    >
      <StatCard
        color="peach"
        title="Thu POS"
        subtitle="Tổng doanh thu"
        value={<CountUp value={data.total_sales} format={formatVND} />}
      />
      <StatCard
        color="mint"
        title="Tổng chi"
        subtitle="Hôm nay"
        value={<CountUp value={data.total_expenses} format={formatVND} />}
      />
      <StatCard
        color="lilac"
        title="Lương hôm nay (tạm tính)"
        subtitle="tạm tính"
        value={<CountUp value={liveLaborCost} format={formatVND} />}
      />
      <StatCard
        color="peach"
        title="Đang trong ca"
        subtitle="Nhân viên"
        value={<CountUp value={data.active_staff} format={(n) => `${n} người`} />}
      />
    </Reveal>
  );
}
