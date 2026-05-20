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
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCheckIn } from "@/hooks/mutations/use-shift-mutations";
import { fromDatetimeLocal, toDatetimeLocal, todayInVN } from "@/lib/datetime";
import { formatVND } from "@/lib/format";
import type { Employee } from "@/lib/types";

interface CheckInModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  employee: Employee | null;
  businessDate: string;
}

/**
 * Default time cho check-in modal.
 * - business_date = hôm nay (giờ VN) → now
 * - business_date khác → 08:00 ngày đó (đầu ca mặc định)
 *
 * Uses todayInVN() — not new Date().toISOString().slice(0,10) — to avoid
 * UTC-rollover bug (UTC date != VN date after 17:00 UTC).
 */
function defaultCheckInTime(businessDate: string): string {
  if (todayInVN() === businessDate) {
    return toDatetimeLocal(new Date().toISOString());
  }
  return `${businessDate}T08:00`;
}

/** Validate: giờ check-in phải trong cùng business_date. */
function isCheckInTimeValid(checkIn: string, businessDate: string): boolean {
  if (!checkIn) return false;
  return checkIn.slice(0, 10) === businessDate;
}

/**
 * Check-in modal. Sets shift_assignment status=checked_in via
 * check_in_employee RPC. Allows operator to override the time before
 * confirming (e.g., employee forgot to check in at start of shift).
 */
export function CheckInModal({
  open,
  onOpenChange,
  employee,
  businessDate,
}: CheckInModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const checkInM = useCheckIn(supabase, businessDate);
  const [checkInTime, setCheckInTime] = useState("");

  // Reset to default time when modal opens (or employee changes).
  useEffect(() => {
    if (open && employee) {
      setCheckInTime(defaultCheckInTime(businessDate));
    }
  }, [open, employee?.id, businessDate]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!employee) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const timeValid = isCheckInTimeValid(checkInTime, businessDate);
  const isBusy = checkInM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employee || !timeValid || isBusy) return;
    try {
      await checkInM.mutateAsync({
        employee_id: employee.id,
        business_date: businessDate,
        check_in_at: fromDatetimeLocal(checkInTime) ?? "",
      });
      toast({ semantic: "success", message: `${employee.name} đã vào ca.` });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không vào ca được.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>{employee.name}</ModalTitle>
        <ModalDescription>
          Vào ca · {employee.position ?? "Nhân viên"} ·{" "}
          {formatVND(employee.hourly_rate)}/giờ
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Giờ vào ca"
            type="datetime-local"
            value={checkInTime}
            onChange={(e) => setCheckInTime(e.target.value)}
            disabled={isBusy}
            autoFocus
            helper={`Mặc định là giờ hiện tại. Phải nằm trong ngày ${businessDate}.`}
          />
          {checkInTime && !timeValid && (
            <AlertBanner variant="danger">
              Giờ vào ca phải nằm trong ngày {businessDate}.
            </AlertBanner>
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
              disabled={!timeValid}
            >
              Xác nhận vào ca
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
