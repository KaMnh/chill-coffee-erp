"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useDashboardQuery } from "@/hooks/queries";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { SalesOrder } from "@/lib/types";

const PAYMENT_LABELS: Record<string, string> = {
  cash: "Tiền mặt",
  transfer: "Chuyển khoản",
  card: "Thẻ",
  momo: "MoMo",
  zalopay: "ZaloPay",
};

function paymentLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_LABELS[method] ?? method;
}

const COLUMNS: DataTableColumn<SalesOrder>[] = [
  {
    key: "invoice_code",
    header: "Hóa đơn",
    sortable: true,
    render: (o) => o.invoice_code ?? o.order_code ?? "—",
  },
  {
    key: "sold_by_name",
    header: "Người bán",
    sortable: true,
    render: (o) => o.sold_by_name ?? "POS",
  },
  {
    key: "payment_method",
    header: "Thanh toán",
    sortable: false,
    render: (o) => paymentLabel(o.payment_method),
  },
  {
    key: "net_amount",
    header: "Doanh thu",
    sortable: true,
    className: "text-right",
    render: (o) => formatVND(o.net_amount ?? o.total_payment ?? 0),
  },
];

interface PivotViewProps {
  businessDate: string;
}

export function PivotView({ businessDate }: PivotViewProps) {
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
      <AlertBanner variant="danger" title="Không tải được dữ liệu POS">
        {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const orders = query.data?.sales_orders ?? [];
  const totalSales = query.data?.total_sales ?? 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <CardTitle>Doanh thu sản phẩm — {businessDate}</CardTitle>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-muted">Tổng</p>
              <strong className="font-display text-lg text-ink">
                {formatVND(totalSales)}
              </strong>
              <span className="ml-2 text-xs text-muted">
                ({orders.length} hóa đơn)
              </span>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {orders.length === 0 ? (
            <EmptyState
              icon="barChart3"
              title="Chưa có hóa đơn cho ngày này"
              subtitle="Sau khi sync POS, hóa đơn từ KiotViet sẽ hiển thị ở đây."
            />
          ) : (
            <DataTable<SalesOrder>
              columns={COLUMNS}
              data={orders}
              rowKey={(o) => o.id}
              mobileCards
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
