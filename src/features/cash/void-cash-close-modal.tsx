"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useVoidCashCloseReport } from "@/hooks/mutations/use-cash-mutations";
import { loadCashCloseReport } from "@/lib/data";
import { formatVND } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { CashCloseReport } from "@/lib/types";

interface VoidCashCloseModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  reportId: string | null;
  businessDate: string;
}

const REASON_MIN = 5;

/**
 * Void final cash_close_report. Reason required (≥5 chars for audit trail).
 * RPC marks report voided + inserts adjustment safe_transaction (reverse
 * the original safe_deposit). If safe doesn't have enough balance left
 * (e.g. funds already withdrawn next day), RPC rejects.
 *
 * Report stays in DB with status="voided" — never hard-deleted, preserves
 * audit log.
 */
export function VoidCashCloseModal({
  open,
  onOpenChange,
  reportId,
  businessDate,
}: VoidCashCloseModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const voidM = useVoidCashCloseReport(supabase, businessDate);

  const [report, setReport] = useState<CashCloseReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open || !reportId || !supabase) return;
    let cancelled = false;
    setIsLoading(true);
    setReport(null);
    setReason("");
    void loadCashCloseReport(supabase, reportId)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (cancelled) return;
        toast({
          semantic: "danger",
          message: err instanceof Error ? err.message : "Không tải được báo cáo.",
        });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, reportId, supabase, toast]);

  const reasonTrimmed = reason.trim();
  const reasonShort = reasonTrimmed.length < REASON_MIN;
  const reasonTooLong = reason.length > limits.note;
  const hasError = reasonShort || reasonTooLong;
  const isBusy = voidM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report || !reportId || hasError || isBusy) return;
    try {
      const result = await voidM.mutateAsync({ reportId, reason: reasonTrimmed });
      toast({
        semantic: "success",
        message:
          result.reversed_safe_amount > 0
            ? `Đã hủy và reverse ${formatVND(result.reversed_safe_amount)} khỏi sổ quỹ.`
            : "Đã hủy báo cáo.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không hủy được báo cáo.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{report ? `Ngày ${report.business_date}` : "Đang tải..."}</ModalTitle>
        <ModalDescription>
          {report && report.safe_deposit_amount > 0
            ? `Sẽ trả ${formatVND(report.safe_deposit_amount)} về sổ quỹ qua adjustment.`
            : "Hủy báo cáo chốt két"}
        </ModalDescription>
        {isLoading && (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        )}
        {!isLoading && !report && (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="warning">
              Không tìm thấy báo cáo. Có thể đã bị hủy ở phiên khác.
            </AlertBanner>
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </ModalActions>
          </div>
        )}
        {!isLoading && report && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <AlertBanner variant="warning">
              Báo cáo bị đánh dấu <strong>voided</strong>, KHÔNG xóa khỏi DB (giữ audit trail).
              {report.safe_deposit_amount > 0 && (
                <>
                  {" "}Một adjustment ngược <strong>−{formatVND(report.safe_deposit_amount)}</strong> sẽ được tạo trong sổ quỹ. Nếu sổ quỹ không đủ (đã rút khi mở két ngày sau), thao tác sẽ bị từ chối.
                </>
              )}
            </AlertBanner>
            <Textarea
              label="Lý do hủy *"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={limits.note}
              rows={3}
              placeholder="VD: Đếm sai số liệu, cần chốt lại sau khi đối soát POS..."
              disabled={isBusy}
              autoFocus
              helper={`Bắt buộc ≥ ${REASON_MIN} ký tự (ghi vào audit log).`}
              error={
                reason.length > 0 && reasonShort
                  ? `Lý do phải ≥ ${REASON_MIN} ký tự.`
                  : reasonTooLong
                    ? `Vượt ${limits.note} ký tự.`
                    : undefined
              }
            />
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Đóng
              </Button>
              <Button
                type="submit"
                variant="destructive"
                loading={isBusy}
                disabled={hasError}
                leadingIcon={<Icon name="trash" size={16} />}
              >
                Xác nhận hủy
              </Button>
            </ModalActions>
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}
