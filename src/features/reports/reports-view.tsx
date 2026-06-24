"use client";

import { useEffect, useRef, useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import { useReportsByPeriodQuery } from "@/hooks/queries";
import { loadCashCloseReport } from "@/lib/data";
import { todayInVN, subtractDays } from "@/lib/datetime";
import type { CashCloseReport } from "@/lib/types";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { Icon } from "@/components/ui/icons";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { TextField } from "@/components/ui/text-field";
import { Reveal } from "@/components/ui/reveal";
import { DUR } from "@/lib/gsap";
import { ReportList } from "./report-list";
import { PrintableReport } from "./printable-report";
import { exportElementAsJpeg } from "./export-jpeg";
import { InventoryAnalyticsTab } from "./inventory-analytics-tab";
import { SalesByProductTab } from "./sales-by-product-tab";
import { ExpensePayrollTab } from "./expense-payroll-tab";
import { HourlyTrendsTab } from "./hourly-trends-tab";

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
        <Reveal duration={DUR.fast}>
          <CashCloseTab businessDate={businessDate} />
        </Reveal>
      </TabsContent>

      <TabsContent value="inventory">
        <Reveal duration={DUR.fast}>
          <InventoryAnalyticsTab />
        </Reveal>
      </TabsContent>

      <TabsContent value="sales_product">
        <Reveal duration={DUR.fast}>
          <SalesByProductTab />
        </Reveal>
      </TabsContent>

      <TabsContent value="expense_payroll">
        <Reveal duration={DUR.fast}>
          <ExpensePayrollTab />
        </Reveal>
      </TabsContent>

      <TabsContent value="hourly">
        <Reveal duration={DUR.fast}>
          <HourlyTrendsTab />
        </Reveal>
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
  const today = businessDate || todayInVN();
  const [fromDate, setFromDate] = useState(() => subtractDays(today, 6));
  const [toDate, setToDate] = useState(today);
  const rangeValid = !!fromDate && !!toDate && fromDate <= toDate;
  const reportsQuery = useReportsByPeriodQuery(supabase, fromDate, toDate, rangeValid);
  const { toast } = useToast();
  const [selected, setSelected] = useState<CashCloseReport | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const printRef = useRef<HTMLDivElement | null>(null);

  // Auto-select báo cáo mới nhất; khi đổi khoảng mà selection cũ không còn
  // trong list → chọn lại data[0] (mới nhất).
  useEffect(() => {
    const list = reportsQuery.data ?? [];
    setSelected((current) => {
      if (current && list.some((r) => r.id === current.id)) return current;
      return list[0] ?? null;
    });
  }, [reportsQuery.data]);

  function handleResetRange() {
    setFromDate(subtractDays(today, 6));
    setToDate(today);
  }

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

  const reports = reportsQuery.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <TextField
              label="Từ ngày"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="min-w-[9rem]"
            />
            <TextField
              label="Đến ngày"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="min-w-[9rem]"
            />
            <Button variant="ghost" onClick={handleResetRange}>
              7 ngày gần nhất
            </Button>
          </CardBody>
        </Card>

        {!rangeValid ? (
          <AlertBanner variant="warning" title="Khoảng ngày không hợp lệ">
            Chọn cả “Từ ngày” và “Đến ngày”, với Từ ≤ Đến.
          </AlertBanner>
        ) : reportsQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : reportsQuery.isError ? (
          <AlertBanner variant="danger" title="Không tải được danh sách báo cáo">
            {reportsQuery.error instanceof Error
              ? reportsQuery.error.message
              : String(reportsQuery.error)}
          </AlertBanner>
        ) : (
          <ReportList
            reports={reports}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
          />
        )}
      </div>
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
