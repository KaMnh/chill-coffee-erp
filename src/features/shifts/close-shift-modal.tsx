"use client";

import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TextField } from "@/components/ui/text-field";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/hooks/queries/keys";
import {
  cancelShiftAssignment, checkOutEmployee, checkOutEmployeeNow,
} from "@/lib/data/shifts";
import { moneyFromInput, durationLabel, formatVND } from "@/lib/format";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/datetime";
import type { UserRole } from "@/lib/types";

export interface CloseShiftTarget {
  id: string;
  employee_id?: string;
  business_date: string;
  check_in_at: string | null;
  employee_name: string | null;
  employee_is_active?: boolean | null;
}

interface CloseShiftModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  shift: CloseShiftTarget | null;
  role: UserRole;
  onClosed?(): void;
}

export function CloseShiftModal({ open, onOpenChange, shift, role, onClosed }: CloseShiftModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isOwner = role === "owner";
  const [mode, setMode] = useState<"cancel" | "pay">("cancel");
  const [reason, setReason] = useState("");
  const [endTime, setEndTime] = useState("");
  const [allowance, setAllowance] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  // Reset khi mở modal cho ca mới.
  useEffect(() => {
    if (open) {
      setMode("cancel");
      setReason("");
      setAllowance("");
      setEndTime(toDatetimeLocal(new Date().toISOString()));
    }
  }, [open, shift?.id]);

  if (!shift) return <Modal open={open} onOpenChange={onOpenChange} />;

  function invalidate() {
    if (!shift) return;
    queryClient.invalidateQueries({ queryKey: queryKeys.openShifts() });
    queryClient.invalidateQueries({ queryKey: queryKeys.shifts(shift.business_date) });
    queryClient.invalidateQueries({ queryKey: queryKeys.payroll(shift.business_date) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(shift.business_date) });
  }

  async function handleConfirm() {
    if (!shift || !supabase || isBusy) return;
    if (mode === "cancel" && reason.trim() === "") {
      toast({ semantic: "danger", message: "Phải nhập lý do huỷ ca." });
      return;
    }
    setIsBusy(true);
    try {
      if (mode === "cancel") {
        await cancelShiftAssignment(supabase, shift.id, reason.trim());
        toast({ semantic: "success", message: `Đã huỷ ca ${shift.employee_name ?? "NV đã ngừng"} (không tính lương).` });
      } else if (isOwner) {
        await checkOutEmployee(supabase, {
          shift_assignment_id: shift.id,
          employee_id: shift.employee_id,
          business_date: shift.business_date,
          check_in_at: shift.check_in_at,
          // VN-local convention: KHÔNG tự convert UTC (giống check-out-modal.tsx:116).
          check_out_at: fromDatetimeLocal(endTime) ?? new Date().toISOString(),
          allowance_amount: moneyFromInput(allowance),
          note: "Đóng ca từ bảng Ca đang mở",
        });
        toast({ semantic: "success", message: `Đã trả lương & đóng ca ${shift.employee_name ?? ""}.` });
      } else {
        const r = await checkOutEmployeeNow(supabase, shift.id);
        toast({ semantic: "success", message: `Đã đóng ca ${r.employee_name}: ${durationLabel(r.total_minutes)} · ${formatVND(r.total_pay)}.` });
      }
      invalidate();
      onClosed?.();
      onOpenChange(false);
    } catch (err) {
      toast({ semantic: "danger", message: err instanceof Error ? err.message : "Không đóng ca được." });
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Đóng ca · {shift.employee_name ?? "NV đã ngừng"}</ModalTitle>
        <ModalDescription>Chọn cách đóng ca treo này.</ModalDescription>
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="close-mode" checked={mode === "cancel"}
              onChange={() => setMode("cancel")} aria-label="Huỷ ca (không tính lương)" />
            <span><strong>Huỷ ca (không tính lương)</strong> — ca đóng, KHÔNG ghi lương.</span>
          </label>
          {mode === "cancel" && (
            <Textarea label="Lý do huỷ" value={reason}
              onChange={(e) => setReason(e.target.value)} rows={2} disabled={isBusy} />
          )}
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="close-mode" checked={mode === "pay"}
              onChange={() => setMode("pay")} aria-label="Trả lương theo giờ" />
            <span><strong>Trả lương theo giờ</strong> — {isOwner ? "chọn giờ ra (mặc định bây giờ)." : "đóng ở giờ hiện tại, làm tròn 15'."}</span>
          </label>
          {mode === "pay" && isOwner && (
            <div className="space-y-2">
              <TextField type="datetime-local" label="Giờ ra" value={endTime}
                onChange={(e) => setEndTime(e.target.value)} disabled={isBusy} />
              <TextField label="Bồi dưỡng (tuỳ chọn)" value={allowance} inputMode="numeric"
                onChange={(e) => setAllowance(e.target.value)} disabled={isBusy} />
            </div>
          )}
        </div>
        <ModalActions>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>Đóng</Button>
          <Button type="button" variant="primary" loading={isBusy} onClick={handleConfirm}>Xác nhận</Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
