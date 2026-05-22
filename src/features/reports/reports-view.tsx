"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import { useReportsQuery } from "@/hooks/queries";
import { loadCashCloseReport } from "@/lib/data";
import type { CashCloseReport } from "@/lib/types";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ReportList } from "./report-list";
import { PrintableReport } from "./printable-report";
import { exportElementAsJpeg } from "./export-jpeg";
import { InventoryAnalyticsTab } from "./inventory-analytics-tab";

interface ReportsViewProps {
  businessDate: string;
}

export function ReportsView({ businessDate }: ReportsViewProps) {
  return (
    <Tabs defaultValue="cash_close">
      <TabsList>
        <TabsTrigger value="cash_close">Chốt két</TabsTrigger>
        <TabsTrigger value="inventory">Tồn kho</TabsTrigger>
        <TabsTrigger value="sales_product">Doanh số</TabsTrigger>
        <TabsTrigger value="expense_payroll">Chi phí + lương</TabsTrigger>
        <TabsTrigger value="hourly">Theo giờ</TabsTrigger>
      </TabsList>

      <TabsContent value="cash_close">
        <CashCloseTab businessDate={businessDate} />
      </TabsContent>

      <TabsContent value="inventory">
        <InventoryAnalyticsTab />
      </TabsContent>

      <TabsContent value="sales_product">
        <EmptyState
          icon="barChart3"
          title="Doanh số"
          subtitle="Phát hành trong giai đoạn 5.B — báo cáo doanh số theo sản phẩm và danh mục."
          dashedBorder
        />
      </TabsContent>

      <TabsContent value="expense_payroll">
        <EmptyState
          icon="wallet"
          title="Chi phí + lương"
          subtitle="Phát hành trong giai đoạn 5.C — báo cáo chi phí và lương theo khoảng."
          dashedBorder
        />
      </TabsContent>

      <TabsContent value="hourly">
        <EmptyState
          icon="info"
          title="Theo giờ"
          subtitle="Phát hành trong giai đoạn 5.D — xu hướng doanh số theo giờ."
          dashedBorder
        />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------
// Cash close tab — extracted from the previous ReportsView body
// without semantic changes. Renders the existing two-pane layout.
// ---------------------------------------------------------------------

interface CashCloseTabProps {
  businessDate: string;
}

function CashCloseTab({ businessDate }: CashCloseTabProps) {
  const supabase = useSupabase();
  const reportsQuery = useReportsQuery(supabase, businessDate, true);
  const { toast } = useToast();
  const [selected, setSelected] = useState<CashCloseReport | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  // Auto-select latest report when list changes (matches v3 page.tsx 149-152).
  useEffect(() => {
    setSelected((current) => current ?? reportsQuery.data?.[0] ?? null);
  }, [reportsQuery.data]);

  async function handleSelect(id: string) {
    if (!supabase) return;
    try {
      const full = await loadCashCloseReport(supabase, id);
      setSelected(full);
    } catch (err) {
      toast({
        semantic: "danger",
        title: "Không tải được báo cáo",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function handleExport() {
    if (!selected || !printRef.current) return;
    setIsExporting(true);
    try {
      const filename = `chot-ket-${selected.business_date}-${selected.id.slice(0, 8)}.jpg`;
      await exportElementAsJpeg(printRef.current, filename);
      toast({ semantic: "success", message: "Đã tải ảnh báo cáo." });
    } catch (err) {
      toast({
        semantic: "danger",
        title: "Không tải được ảnh",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsExporting(false);
    }
  }

  if (reportsQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (reportsQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được danh sách báo cáo">
        {reportsQuery.error instanceof Error
          ? reportsQuery.error.message
          : String(reportsQuery.error)}
      </AlertBanner>
    );
  }

  const reports = reportsQuery.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <ReportList
        reports={reports}
        selectedId={selected?.id ?? null}
        onSelect={handleSelect}
      />
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between gap-3">
            <CardTitle>Phiếu chốt két</CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon name="download" size={16} />}
                loading={isExporting}
                disabled={!selected}
                onClick={handleExport}
              >
                Tải ảnh
              </Button>
              <Button
                variant="primary"
                size="sm"
                leadingIcon={<Icon name="printer" size={16} />}
                disabled={!selected}
                onClick={() => window.print()}
              >
                In
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardBody>
          {selected ? (
            <div ref={printRef} className="print-target">
              <PrintableReport report={selected} />
            </div>
          ) : (
            <EmptyState
              icon="fileText"
              title="Chọn một báo cáo"
              subtitle="Chọn một báo cáo ở cột trái để xem và in."
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
