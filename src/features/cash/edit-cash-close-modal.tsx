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
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { IconButton } from "@/components/ui/icon-button";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useEditCashCloseReport } from "@/hooks/mutations/use-cash-mutations";
import { loadCashCloseReport } from "@/lib/data";
import { formatVND, moneyFromInput } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { CashCloseReport } from "@/lib/types";
import { LeaveDenominationPopup } from "./leave-denomination-popup";

interface EditCashCloseModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  reportId: string | null;
  businessDate: string;
}

/**
 * Edit final cash_close_report. Editable: note + leave_for_next_day.
 * Snapshot fields (POS, opening, physical) immutable — to change those,
 * void the report and chốt két fresh.
 *
 * Side effect: leave change → RPC inserts adjustment safe_transaction to
 * keep safe balance consistent.
 *
 * One-shot loadCashCloseReport on open (not TanStack query because the
 * report is editable here; we don't want stale-while-revalidate).
 */
export function EditCashCloseModal({
  open,
  onOpenChange,
  reportId,
  businessDate,
}: EditCashCloseModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const editM = useEditCashCloseReport(supabase, businessDate);

  const [report, setReport] = useState<CashCloseReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [note, setNote] = useState("");
  const [leaveInput, setLeaveInput] = useState("");
  const [popupOpen, setPopupOpen] = useState(false);

  useEffect(() => {
    if (!open || !reportId || !supabase) return;
    let cancelled = false;
    setIsLoading(true);
    setReport(null);
    void loadCashCloseReport(supabase, reportId)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        if (r) {
          setNote(r.note ?? "");
          setLeaveInput(String(r.leave_for_next_day ?? 0));
        }
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

  const leaveValue = moneyFromInput(leaveInput);
  const newDeposit = report ? Math.max(0, report.physical_cash - leaveValue) : 0;
  const diff = report ? newDeposit - report.safe_deposit_amount : 0;
  const noteChanged = report ? (note ?? "") !== (report.note ?? "") : false;
  const leaveChanged = report ? leaveValue !== report.leave_for_next_day : false;
  const dirty = noteChanged || leaveChanged;
  const tooBig = report ? leaveValue > report.physical_cash : false;
  const tooSmall = leaveValue < 0;
  const noteTooLong = note.length > limits.note;
  const hasError = tooBig || tooSmall || noteTooLong || !dirty;
  const isBusy = editM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!report || !reportId || hasError || isBusy) return;
    try {
      await editM.mutateAsync({
        reportId,
        note: noteChanged ? note : null,
        leaveForNextDay: leaveChanged ? leaveValue : null,
      });
      toast({
        semantic: "success",
        message:
          diff === 0
            ? "Đã cập nhật ghi chú."
            : `Đã sửa và điều chỉnh sổ quỹ ${diff > 0 ? "+" : ""}${formatVND(diff)}.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được báo cáo.",
      });
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange}>
        <ModalContent>
          <ModalTitle>{report ? `Ngày ${report.business_date}` : "Đang tải..."}</ModalTitle>
          <ModalDescription>
            {report
              ? `Đếm thực ${formatVND(report.physical_cash)} · Hiện đang nạp ${formatVND(report.safe_deposit_amount)} vào sổ quỹ`
              : "Sửa báo cáo chốt két"}
          </ModalDescription>
          {isLoading && (
            <div className="flex justify-center py-8">
              <Spinner size={24} />
            </div>
          )}
          {!isLoading && report && (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <Textarea
                label="Ghi chú"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={limits.note}
                rows={2}
                placeholder="VD: Sửa số liệu sau khi đối soát lại..."
                disabled={isBusy}
                helper={`${note.length}/${limits.note} ký tự`}
                error={noteTooLong ? `Vượt ${limits.note} ký tự.` : undefined}
              />
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <TextField
                    label="Để lại cho ngày mai"
                    value={leaveInput}
                    onChange={(e) => setLeaveInput(e.target.value)}
                    inputMode="numeric"
                    placeholder="0"
                    disabled={isBusy}
                    helper={`Tối đa ${formatVND(report.physical_cash)}. Phần dư tự nạp sổ quỹ.`}
                    error={
                      tooSmall
                        ? "Không được âm."
                        : tooBig
                          ? `Vượt đếm thực (${formatVND(report.physical_cash)}).`
                          : undefined
                    }
                  />
                </div>
                <IconButton
                  type="button"
                  icon="calculator"
                  size={40}
                  variant="secondary"
                  aria-label="Đếm theo mệnh giá"
                  disabled={isBusy}
                  onClick={() => setPopupOpen(true)}
                />
              </div>
              {leaveChanged && diff !== 0 && (
                <AlertBanner variant={diff > 0 ? "success" : "warning"}>
                  {diff > 0
                    ? `Sẽ nạp thêm ${formatVND(diff)} vào sổ quỹ.`
                    : `Sẽ rút ${formatVND(Math.abs(diff))} khỏi sổ quỹ.`}
                </AlertBanner>
              )}
              <ModalActions>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                  Hủy
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={isBusy}
                  disabled={hasError}
                  leadingIcon={<Icon name="pencil" size={16} />}
                >
                  Lưu thay đổi
                </Button>
              </ModalActions>
            </form>
          )}
        </ModalContent>
      </Modal>

      {/* Nested popup. Separate Modal Root with own open state. */}
      <LeaveDenominationPopup
        open={popupOpen}
        onOpenChange={setPopupOpen}
        initialValue={leaveValue}
        maxValue={report?.physical_cash ?? 0}
        onConfirm={(total) => setLeaveInput(String(total))}
      />
    </>
  );
}
