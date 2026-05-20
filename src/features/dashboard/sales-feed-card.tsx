"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatTime, formatVND } from "@/lib/format";
import type { SalesOrder } from "@/lib/types";

interface SalesFeedCardProps {
  orders: ReadonlyArray<SalesOrder>;
  totalSales: number;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  momo: "MoMo",
  zalopay: "ZaloPay",
};

function paymentLabel(method: string | null | undefined) {
  if (!method) return "POS";
  return PAYMENT_LABELS[method] ?? method;
}

/**
 * 5 most recent KiotViet orders + total. Mirrors v3 dashboard-view.tsx
 * lines 112-133. Empty state if POS hasn't synced yet today.
 */
export function SalesFeedCard({ orders, totalSales }: SalesFeedCardProps) {
  const rows = orders.slice(0, 5);
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Thu từ KiotViet</CardTitle>
          <strong className="font-display text-base text-ink">
            {formatVND(totalSales)}
          </strong>
        </div>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon="banknote"
            title="Chưa có đơn POS"
            subtitle="Dữ liệu KiotViet sau khi sync sẽ hiện ở đây."
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate text-sm font-semibold text-ink">
                      {o.invoice_code ?? o.order_code ?? "Hóa đơn"}
                    </strong>
                    <Badge variant="soft" semantic="neutral">
                      {paymentLabel(o.payment_method)}
                    </Badge>
                  </div>
                  <span className="text-xs text-muted">
                    {o.sold_by_name ?? "POS"} · {formatTime(o.purchase_at)}
                  </span>
                </div>
                <strong className="shrink-0 font-display text-sm text-ink">
                  {formatVND(o.net_amount ?? o.total_payment ?? 0)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
