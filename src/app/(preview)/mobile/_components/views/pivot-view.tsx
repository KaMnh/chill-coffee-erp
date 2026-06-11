"use client";

import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { formatNumber, formatVND } from "@/lib/format";
import { SectionLabel } from "../bits";
import { PIVOT_ORDERS, PIVOT_TOTAL, BUSINESS_DATE } from "../../_mock/data";

/**
 * Pivot — Tier B: bảng đơn hàng rộng → scroll ngang + cột "Hóa đơn" sticky
 * trái, header sticky, gợi ý vuốt rõ ràng. (DataTable desktop sẽ thêm
 * card-mode/scroll-mode khi build thật.)
 */
export function MobilePivotView() {
  return (
    <Reveal className="p-4 space-y-3">
      <div className="rounded-lg bg-surface shadow-raised p-4 flex items-center justify-between">
        <div>
          <SectionLabel>Doanh thu sản phẩm</SectionLabel>
          <div className="text-xs text-muted mt-0.5">{BUSINESS_DATE}</div>
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-bold text-ink tabular-nums">
            {formatVND(PIVOT_TOTAL.amount)}
          </div>
          <div className="text-xs text-muted">{PIVOT_TOTAL.orders} hóa đơn</div>
        </div>
      </div>

      {/* Gợi ý vuốt */}
      <div className="flex items-center gap-1.5 text-xs text-muted px-1">
        <Icon name="chevronRight" size={16} className="animate-pulse" />
        Vuốt ngang để xem thêm cột
      </div>

      <div className="rounded-lg bg-surface shadow-raised overflow-hidden">
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="text-sm min-w-[480px] w-full">
            <thead>
              <tr className="bg-surface-muted">
                <th className="sticky left-0 z-10 bg-surface-muted text-left px-3 py-3 text-xs font-medium uppercase tracking-wider text-muted border-r border-border">
                  Hóa đơn
                </th>
                <th className="text-left px-3 py-3 text-xs font-medium uppercase tracking-wider text-muted">Giờ</th>
                <th className="text-left px-3 py-3 text-xs font-medium uppercase tracking-wider text-muted">Người bán</th>
                <th className="text-left px-3 py-3 text-xs font-medium uppercase tracking-wider text-muted">Thanh toán</th>
                <th className="text-right px-3 py-3 text-xs font-medium uppercase tracking-wider text-muted">Doanh thu</th>
              </tr>
            </thead>
            <tbody>
              {PIVOT_ORDERS.map((o, i) => (
                <tr key={o.code} className={cn("tabular-nums", i > 0 && "border-t border-border")}>
                  <td className="sticky left-0 z-10 bg-surface px-3 py-3 font-medium text-ink border-r border-border whitespace-nowrap">
                    {o.code}
                  </td>
                  <td className="px-3 py-3 text-muted whitespace-nowrap">{o.time}</td>
                  <td className="px-3 py-3 text-ink whitespace-nowrap">{o.seller}</td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    <Badge variant="soft" semantic={o.method === "Tiền mặt" ? "neutral" : o.method === "—" ? "neutral" : "success"}>
                      {o.method}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-right text-ink font-semibold whitespace-nowrap">
                    {formatNumber(o.amount)} ₫
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Reveal>
  );
}
