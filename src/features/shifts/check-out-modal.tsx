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
import { useCheckOut } from "@/hooks/mutations/use-shift-mutations";
import { useAppSettingsQuery } from "@/hooks/queries";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import { durationLabel, formatVND, moneyFromInput } from "@/lib/format";
import type { Employee, ShiftAssignment } from "@/lib/types";

const DEFAULT_BONUS_CONFIG = { threshold_hours: 7, bonus_amount: 10000 };

interface CheckOutModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shift: ShiftAssignment | null;
  employee: Employee | null;
  businessDate: string;
}

/**
 * Check-out modal. Closes a shift_assignment (status=checked_out) AND
 * creates a payroll_record snapshot via check_out_employee RPC.
 *
 * Live derived (useMemo):
 *   minutes   = max(0, round((endMs - startMs) / 60_000))
 *   basePay   = round((minutes / 60) * hourly_rate / 1000) * 1000  // 1k VND
 *   totalPay  = basePay + moneyFromInput(allowance)
 *
 * invalidTime = startTime && endTime && endTimeMs < startTimeMs
 *   - render AlertBanner danger when true
 *   - submit disabled when true
 */
export function CheckOutModal({
  open,
  onOpenChange,
  shift,
  employee,
  businessDate,
}: CheckOutModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const checkOutM = useCheckOut(supabase, businessDate);
  const appSettingsQuery = useAppSettingsQuery(supabase, true);
  const bonusConfig = appSettingsQuery.data?.shift_bonus_config ?? DEFAULT_BONUS_CONFIG;

  const isFixed = employee?.pay_type === "fixed";

  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowance, setAllowance] = useState("0");
  const [allowanceAutoFilled, setAllowanceAutoFilled] = useState(false);
  const [dailyPay, setDailyPay] = useState("0");
  const [note, setNote] = useState("");

  // Reset state when modal opens with a new shift.
  // Auto-fill allowance khi ca đã đủ threshold (dùng elapsed-time tại lúc mở modal).
  useEffect(() => {
    if (open && shift) {
      const checkInIso = shift.check_in_at ?? new Date().toISOString();
      const nowIso = new Date().toISOString();
      setStartTime(toDatetimeLocal(checkInIso));
      setEndTime(toDatetimeLocal(nowIso));
      const minutesEst = Math.max(
        0,
        Math.round((Date.now() - new Date(checkInIso).getTime()) / 60_000)
      );
      const shouldAutoFill = minutesEst >= bonusConfig.threshold_hours * 60;
      setAllowance(shouldAutoFill ? String(bonusConfig.bonus_amount) : "0");
      setAllowanceAutoFilled(shouldAutoFill);
      setDailyPay(String(employee?.default_daily_pay ?? 0));
      setNote("");
    }
  }, [open, shift?.id, bonusConfig.threshold_hours, bonusConfig.bonus_amount]); // eslint-disable-line react-hooks/exhaustive-deps

  const minutes = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const startMs = new Date(startTime).getTime();
    const endMs = new Date(endTime).getTime();
    return Math.max(0, Math.round((endMs - startMs) / 60_000));
  }, [startTime, endTime]);

  const hourlyBasePay = useMemo(() => {
    if (!employee) return 0;
    return Math.round(((minutes / 60) * employee.hourly_rate) / 1000) * 1000;
  }, [minutes, employee]);

  const dailyPayAmount = moneyFromInput(dailyPay);
  const basePay = isFixed ? dailyPayAmount : hourlyBasePay;
  const allowanceAmount = moneyFromInput(allowance);
  const totalPay = basePay + allowanceAmount;
  const invalidTime = Boolean(
    startTime && endTime && new Date(endTime).getTime() < new Date(startTime).getTime()
  );

  if (!shift || !employee) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const isBusy = checkOutM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!shift || !employee || invalidTime || isBusy) return;
    try {
      await checkOutM.mutateAsync({
        shift_assignment_id: shift.id,
        employee_id: shift.employee_id,
        business_date: businessDate,
        check_in_at: fromDatetimeLocal(startTime) ?? "",
        check_out_at: fromDatetimeLocal(endTime) ?? "",
        allowance_amount: allowanceAmount,
        note: note.trim(),
        ...(isFixed ? { override_pay: dailyPayAmount } : {}),
      });
      toast({ semantic: "success", message: "Đã ra ca và lưu lương theo lượt." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không ra ca được.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{employee.name}</ModalTitle>
        <ModalDescription>
          {isFixed
            ? "Xác nhận ra ca · Lương ngày"
            : `Xác nhận ra ca · ${formatVND(employee.hourly_rate)}/giờ`}
        </ModalDescription>
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
              value={dailyPay}
              onChange={(e) => setDailyPay(e.target.value)}
              inputMode="numeric"
              disabled={isBusy}
            />
          ) : (
            /* 3-metric mini-grid */
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
          {/* Payout hero — visually prominent */}
          <div className="rounded-lg bg-mint p-4 text-mint-ink">
            <p className="text-xs uppercase tracking-wide opacity-80">
              Tổng thực nhận ca này
            </p>
            <strong className="block font-display text-2xl">
              {formatVND(totalPay)}
            </strong>
          </div>
          <TextField
            label="Bồi dưỡng"
            value={allowance}
            onChange={(e) => {
              setAllowance(e.target.value);
              setAllowanceAutoFilled(false);
            }}
            inputMode="numeric"
            disabled={isBusy}
            helper={
              allowanceAutoFilled
                ? `Tự động — ca từ ${bonusConfig.threshold_hours}h (${formatVND(bonusConfig.bonus_amount)}). Sửa để override.`
                : undefined
            }
          />
          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Lý do chỉnh giờ hoặc bồi dưỡng..."
            rows={2}
            disabled={isBusy}
          />
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
              Xác nhận ra ca
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
