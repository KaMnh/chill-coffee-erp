"use client";

import { useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import { checkOutEmployeeNow } from "@/lib/data/shifts";
import { durationLabel, formatVND } from "@/lib/format";
import type { ShiftAssignment } from "@/lib/types";

interface ManagerCheckoutModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shift: ShiftAssignment | null;
  businessDate: string;
}

/**
 * Confirm modal cho quản lý đóng ca hộ (Phase 2c). Khác CheckOutModal
 * (owner sửa giờ/bồi dưỡng): quản lý chỉ xác nhận đóng ca tại thời điểm
 * hiện tại, làm tròn phút lên bội 15, qua RPC check_out_employee_now.
 *
 * Đóng ca làm:
 *   - shift_assignment -> checked_out
 *   - tạo payroll_record snapshot
 *   - ảnh hưởng dashboard (active_staff giảm, payroll tăng)
 * => invalidate shifts + payroll + dashboard giống useCheckOut.
 */
export function ManagerCheckoutModal({
  open,
  onOpenChange,
  shift,
  businessDate,
}: ManagerCheckoutModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isBusy, setIsBusy] = useState(false);

  if (!shift) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  async function handleConfirm() {
    if (!shift || !supabase || isBusy) return;
    setIsBusy(true);
    try {
      const result = await checkOutEmployeeNow(supabase, shift.id);
      queryClient.invalidateQueries({ queryKey: queryKeys.shifts(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.payroll(businessDate) });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(businessDate) });
      toast({
        semantic: "success",
        message: `Đã đóng ca ${result.employee_name}: ${durationLabel(result.total_minutes)} · ${formatVND(result.total_pay)}.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không đóng ca được.",
      });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Đóng ca hộ · {shift.employee_name ?? "Nhân viên"}</ModalTitle>
        <ModalDescription>
          Đóng ca tại thời điểm hiện tại, làm tròn phút lên bội số 15. Lương
          được chốt theo giờ vào đã ghi nhận.
        </ModalDescription>
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
            type="button"
            variant="primary"
            loading={isBusy}
            onClick={handleConfirm}
          >
            Xác nhận đóng ca
          </Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
