"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { CashCloseReport } from "@/lib/types";
import { depositForDay } from "./deposit-summary";

interface ReportListProps {
  reports: ReadonlyArray<CashCloseReport>;
  selectedId: string | null;
  onSelect(id: string): void;
}

function statusBadge(status: CashCloseReport["report_status"]) {
  switch (status) {
    case "final":
      return <Badge variant="soft" semantic="success">Đã chốt</Badge>;
    case "voided":
      return <Badge variant="soft" semantic="danger">Đã hủy</Badge>;
    case "draft":
      return <Badge variant="soft" semantic="warning">Nháp</Badge>;
    default:
      return <Badge variant="soft" semantic="neutral">{status}</Badge>;
  }
}

function differenceTone(diff: number) {
  if (diff > 0) return "text-success";
  if (diff < 0) return "text-danger";
  return "text-muted";
}

/** "2026-03-05" → "05/03/2026" (parse thủ công, không qua Date để tránh lệch tz). */
function formatBusinessDate(value: string): string {
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function ReportList({ reports, selectedId, onSelect }: ReportListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Báo cáo theo ngày</CardTitle>
      </CardHeader>
      <CardBody>
        {reports.length === 0 ? (
          <EmptyState
            icon="fileText"
            title="Chưa có báo cáo"
            subtitle="Khi chốt két, báo cáo snapshot sẽ xuất hiện tại đây."
          />
        ) : (
          <ul className="space-y-2">
            {reports.map((r) => {
              const active = r.id === selectedId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(r.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
                      active
                        ? "border-border-strong bg-surface-muted shadow-hover"
                        : "border-border bg-surface hover:border-border-strong"
                    )}
                  >
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {formatBusinessDate(r.business_date)}
                      </span>
                      {(() => {
                        const { cash, transfer } = depositForDay(r);
                        const voided = r.report_status === "voided";
                        return (
                          <span
                            className={cn(
                              "block text-xs",
                              voided ? "text-muted line-through" : "text-ink-2"
                            )}
                          >
                            Nạp tiền mặt: {formatVND(cash)} · CK xác nhận: {formatVND(transfer)}
                          </span>
                        );
                      })()}
                      <span className={cn("block text-xs", differenceTone(r.difference))}>
                        Chênh: {formatVND(r.difference)}
                      </span>
                    </div>
                    {statusBadge(r.report_status)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
