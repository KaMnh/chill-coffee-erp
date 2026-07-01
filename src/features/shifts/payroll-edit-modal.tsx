"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdatePayrollRecord } from "@/hooks/mutations/use-shift-mutations";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { durationLabel, formatNumber, formatVND, moneyFromInput } from "@/lib/format";
import { validatePayrollEdit } from "@/lib/validation";
import type { PayrollRecord } from "@/lib/types";

interface PayrollEditModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  payroll: PayrollRecord | null;
}

/**
 * Edit a payroll_record (owner/manager only, gated by parent).
 *
 * Same live-derived shape as CheckOutModal — minutes / basePay / totalPay
 * recompute as user adjusts start/end/allowance. validatePayrollEdit
 * enforces server-side parity (check_out >= check_in, allowance in range).
 *
 * useUpdatePayrollRecord invalidates payroll(date) + dashboard(date)
 * (payroll_paid total changes when total_pay changes).
 */
export function PayrollEditModal({
  open,
  onOpenChange,
  payroll,
}: PayrollEditModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  // payroll?.business_date threaded through useUpdatePayrollRecord — Phase 1
  // payroll record has business_date field; same as the day being edited.
  const updateM = useUpdatePayrollRecord(supabase, payroll?.business_date ?? "");

  const isFixed = payroll?.pay_type === "fixed";

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowance, setAllowance] = useState("0");
  const [overridePay, setOverridePay] = useState("0");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Reset state when modal opens with a new payroll record.
  useEffect(() => {
    if (open && payroll) {
      setStartTime(toDatetimeLocal(payroll.check_in_at));
      setEndTime(toDatetimeLocal(payroll.check_out_at));
      setAllowance(formatNumber(payroll.allowance_amount));
      setOverridePay(formatNumber(payroll.override_pay ?? 0));
      setNote(payroll.note ?? "");
      setFieldError(null);
    }
  }, [open, payroll?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    return Math.max(0, Math.round((endMs - startMs) / 60_000));
  }, [startTime, endTime]);

  const overridePayAmount = moneyFromInput(overridePay);

  const basePay = useMemo(() => {
    if (!payroll) return 0;
    // Fixed NV: "Lương ngày" thay cho giờ×rate (bỏ qua total_minutes).
    if (payroll.pay_type === "fixed") return overridePayAmount;
    return Math.round(((minutes / 60) * payroll.hourly_rate) / 1000) * 1000;
  }, [minutes, payroll, overridePayAmount]);

  const allowanceAmount = moneyFromInput(allowance);
  const totalPay = basePay + allowanceAmount;
  const invalidTime = Boolean(
    startTime && endTime && new Date(endTime).getTime() < new Date(startTime).getTime()
  );

  if (!payroll) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const isBusy = updateM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payroll || invalidTime || isBusy) return;
    const validation = validatePayrollEdit({
      check_in_at: fromDatetimeLocal(startTime),
      check_out_at: fromDatetimeLocal(endTime),
      allowance_amount: allowanceAmount,
      note,
      pay_type: payroll.pay_type,
      override_pay: isFixed ? overridePayAmount : undefined,
    });
    if (!validation.ok) {
      setFieldError(validation.message);
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    setFieldError(null);
    try {
      await updateM.mutateAsync({
        payroll_record_id: payroll.id,
        check_in_at: fromDatetimeLocal(startTime) ?? "",
        check_out_at: fromDatetimeLocal(endTime) ?? "",
        allowance_amount: allowanceAmount,
        note: note.trim(),
        // Fixed NV: gửi "Lương ngày" đã sửa; hourly bỏ qua override_pay.
        ...(isFixed ? { override_pay: overridePayAmount } : {}),
      });
      toast({ semantic: "success", message: "Đã cập nhật lượt lương đã chốt." });
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Không sửa được lượt lương.";
      setFieldError(message);
      toast({ semantic: "danger", message });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{payroll.employee_name ?? "Nhân viên"}</ModalTitle>
        <ModalDescription>Sửa lượt lương</ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Giờ vào"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              disabled={isBusy}
            />
            <TextField
              label="Giờ ra"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              disabled={isBusy}
            />
          </div>
          {invalidTime && (
            <AlertBanner variant="danger">
              Giờ ra không được nhỏ hơn giờ vào.
            </AlertBanner>
          )}
          {isFixed ? (
            <TextField
              label="Lương ngày"
              value={overridePay}
              onChange={(e) => setOverridePay(e.target.value)}
              inputMode="numeric"
              disabled={isBusy}
              helper="Lương cố định theo lượt — thay cho giờ × đơn giá."
            />
          ) : (
            <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-surface-muted p-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Tổng giờ</p>
                <strong className="block font-display text-base text-ink">
                  {durationLabel(minutes)}
                </strong>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Lương giờ</p>
                <strong className="block font-display text-base text-ink">
                  {formatVND(basePay)}
                </strong>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Thực nhận</p>
                <strong className="block font-display text-base text-ink">
                  {formatVND(totalPay)}
                </strong>
              </div>
            </div>
          )}
          <div className="rounded-lg bg-mint p-4 text-mint-ink">
            <p className="text-xs uppercase tracking-wide opacity-80">
              Tổng thực nhận sau chỉnh sửa
            </p>
            <strong className="block font-display text-2xl">
              {formatVND(totalPay)}
            </strong>
          </div>
          <TextField
            label="Bồi dưỡng"
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            inputMode="numeric"
            disabled={isBusy}
          />
          <Textarea
            label="Ghi chú chỉnh sửa"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Lý do chỉnh giờ, bồi dưỡng hoặc ghi chú ca..."
            rows={2}
            disabled={isBusy}
          />
          {fieldError && (
            <AlertBanner variant="danger">{fieldError}</AlertBanner>
          )}
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={invalidTime}
            >
              Lưu chỉnh sửa
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
