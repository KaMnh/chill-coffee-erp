"use client";

import { useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  usePeriodClosePreviewQuery,
  usePeriodClosesQuery
} from "@/hooks/queries";
import { useVoidPeriodClose } from "@/hooks/mutations/use-period-close-mutations";
import { formatVND } from "@/lib/format";
import { countDaysInclusive } from "@/lib/period-math";
import { cn } from "@/lib/cn";
import type { PeriodCloseRecord, UserRole } from "@/lib/types";
import { CashFlowChart } from "@/features/cashflow/cash-flow-chart";
import { ExpenseBreakdownTable } from "@/features/cashflow/expense-breakdown-table";
import { LunarCalendarWidget } from "@/features/cashflow/lunar-calendar-widget";
import { PeriodCloseModal } from "./period-close-modal";

interface PeriodCloseViewProps {
  role: UserRole;
}

function formatDateVN(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Màn "Kết toán kỳ" (owner-only): thẻ kỳ đang mở (KPI + số dư quỹ + nút kết),
 * chi tiết thu–chi từng ngày (tái dùng cashflow components), lịch sử các lần
 * kết + huỷ lần gần nhất.
 * Spec: docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
 */
export function PeriodCloseView({ role }: PeriodCloseViewProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const isOwner = role === "owner";

  const previewQ = usePeriodClosePreviewQuery(supabase, isOwner);
  const closesQ = usePeriodClosesQuery(supabase, isOwner);
  const voidM = useVoidPeriodClose(supabase);

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<PeriodCloseRecord | null>(null);
  const [voidReason, setVoidReason] = useState("");

  if (!isOwner) {
    return (
      <EmptyState
        icon="lock"
        title="Module dành cho chủ quán"
        subtitle="Bạn chưa có quyền vào trang này."
      />
    );
  }

  if (previewQ.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (previewQ.isError || !previewQ.data) {
    return (
      <AlertBanner variant="danger" title="Không tải được kỳ hiện tại">
        {previewQ.error instanceof Error ? previewQ.error.message : "Lỗi không xác định."}
      </AlertBanner>
    );
  }

  const preview = previewQ.data;
  const closes = closesQ.data ?? [];
  const latestFinalId = closes.find((c) => c.status === "final")?.id ?? null;
  const dayCount = preview.can_close
    ? countDaysInclusive(preview.period_start, preview.period_end)
    : 0;

  const kpis = [
    { label: "Doanh thu", value: preview.revenue, tone: "text-ink" },
    { label: "Chi phí", value: preview.expenses_total, tone: "text-danger" },
    { label: "Lương", value: preview.payroll_total, tone: "text-danger" },
    {
      label: "Lợi nhuận",
      value: preview.profit,
      tone: preview.profit >= 0 ? "text-success" : "text-danger"
    }
  ];

  async function handleVoid() {
    if (!voidTarget || voidReason.trim().length < 5 || voidM.isPending) return;
    try {
      await voidM.mutateAsync({ id: voidTarget.id, reason: voidReason.trim() });
      toast({
        semantic: "success",
        message: `Đã huỷ kỳ kết ${formatDateVN(voidTarget.close_date)} — tiền rút đã hoàn về quỹ.`
      });
      setVoidTarget(null);
      setVoidReason("");
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không huỷ được kỳ kết."
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Thẻ kỳ đang mở */}
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-ink">Kỳ hiện tại</h2>
              <p className="text-sm text-muted mt-0.5">
                {preview.can_close
                  ? `Từ ${formatDateVN(preview.period_start)} đến nay · ${dayCount} ngày`
                  : "Đã kết kỳ hôm nay — huỷ lần gần nhất nếu muốn kết lại."}
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => setCloseModalOpen(true)}
              disabled={!preview.can_close}
            >
              Kết toán kỳ
            </Button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-md bg-surface-muted px-3 py-2.5">
                <p className="text-xs text-muted">{k.label}</p>
                <p className={cn("text-base font-semibold tabular-nums", k.tone)}>
                  {formatVND(k.value)}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-4 text-sm text-ink-2">
            Số dư quỹ: tiền mặt <strong>{formatVND(preview.balance_cash)}</strong> · CK{" "}
            <strong>{formatVND(preview.balance_transfer)}</strong> · tổng{" "}
            <strong className="text-ink">{formatVND(preview.balance_total)}</strong>
          </p>
        </CardBody>
      </Card>

      {/* Chi tiết thu–chi trong kỳ (tái dùng cashflow components) */}
      {preview.can_close && (
        <>
          <CashFlowChart
            byDay={preview.by_day}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <ExpenseBreakdownTable
              rows={preview.expense_breakdown}
              selectedDate={selectedDate}
              onClearDate={() => setSelectedDate(null)}
            />
            <LunarCalendarWidget start={preview.period_start} end={preview.period_end} />
          </div>
        </>
      )}

      {/* Lịch sử kết kỳ */}
      <Card>
        <CardBody>
          <h3 className="text-sm font-medium text-ink mb-3">Lịch sử kết kỳ</h3>
          {closesQ.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner size={24} />
            </div>
          ) : closes.length === 0 ? (
            <p className="text-sm text-muted py-2">Chưa kết kỳ lần nào.</p>
          ) : (
            <ul className="divide-y divide-border">
              {closes.map((c) => (
                <li key={c.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {formatDateVN(c.period_start)} – {formatDateVN(c.period_end)}
                    </p>
                    <p className="text-xs text-muted tabular-nums">
                      Lợi nhuận {formatVND(c.profit)} · rút {formatVND(c.draw_total)} · để lại{" "}
                      {formatVND(c.closing_total)}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant="soft"
                    semantic={c.status === "final" ? "success" : "neutral"}
                  >
                    {c.status === "final" ? "Hoàn tất" : "Đã huỷ"}
                  </Badge>
                  {c.id === latestFinalId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setVoidTarget(c);
                        setVoidReason("");
                      }}
                    >
                      Huỷ
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">
            Snapshot chốt tại thời điểm kết — sửa dữ liệu quá khứ không tự cập nhật; muốn làm
            lại, huỷ kỳ gần nhất rồi kết lại.
          </p>
        </CardBody>
      </Card>

      <PeriodCloseModal
        open={closeModalOpen}
        onOpenChange={setCloseModalOpen}
        preview={preview}
      />

      {/* Modal huỷ kỳ gần nhất */}
      <Modal open={voidTarget !== null} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <ModalContent className="w-[min(95vw,28rem)]">
          <ModalTitle>Huỷ kỳ kết {voidTarget ? formatDateVN(voidTarget.close_date) : ""}</ModalTitle>
          <ModalDescription>
            {voidTarget && voidTarget.draw_total > 0
              ? `${formatVND(voidTarget.draw_total)} đã rút sẽ được hoàn về quỹ (tiền mặt ${formatVND(voidTarget.draw_cash)} · CK ${formatVND(voidTarget.draw_transfer)}).`
              : "Kỳ này không rút tiền — chỉ gỡ snapshot, kỳ kế tiếp neo lại từ lần kết trước đó."}
          </ModalDescription>
          <div className="mt-4 space-y-4">
            <Textarea
              label="Lý do huỷ"
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              rows={2}
              placeholder="VD: Kết nhầm ngày, cần kết lại..."
              helper="Tối thiểu 5 ký tự."
              error={
                voidReason.length > 0 && voidReason.trim().length < 5
                  ? "Lý do huỷ phải ≥ 5 ký tự."
                  : undefined
              }
            />
            <ModalActions>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setVoidTarget(null)}
                disabled={voidM.isPending}
              >
                Đóng
              </Button>
              <Button
                type="button"
                variant="destructive"
                loading={voidM.isPending}
                disabled={voidReason.trim().length < 5 || voidM.isPending}
                onClick={handleVoid}
              >
                Huỷ kỳ kết
              </Button>
            </ModalActions>
          </div>
        </ModalContent>
      </Modal>
    </div>
  );
}
