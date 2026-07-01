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
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpsertEmployee } from "@/hooks/mutations/use-shift-mutations";
import { formatNumber, moneyFromInput } from "@/lib/format";
import { validateEmployee } from "@/lib/validation";
import type { Employee } from "@/lib/types";

interface EmployeeFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** null = create mode; non-null = edit mode. */
  employee: Employee | null;
}

/**
 * Create/edit employee modal. Owner/manager only (gated by parent).
 *
 * Create mode (employee === null): default name="", position="",
 * hourly_rate="", is_active=true. Submit creates new employees row.
 *
 * Edit mode (employee !== null): pre-fill from employee fields. is_active
 * checkbox shown. Submit calls updateEmployee.
 *
 * useUpsertEmployee from use-shift-mutations branches by id presence.
 */
export function EmployeeFormModal({
  open,
  onOpenChange,
  employee,
}: EmployeeFormModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const upsertEmployeeM = useUpsertEmployee(supabase);

  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);

  // Reset state when modal opens (or employee changes).
  useEffect(() => {
    if (!open) return;
    setName(employee?.name ?? "");
    setPosition(employee?.position ?? "");
    setHourlyRate(employee?.hourly_rate ? formatNumber(employee.hourly_rate) : "");
    setIsActive(employee?.is_active ?? true);
    setFieldError(null);
  }, [employee, open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateEmployee({
      name,
      hourly_rate: moneyFromInput(hourlyRate),
      pay_type: "hourly",
      default_daily_pay: null,
    });
    if (!validation.ok) {
      setFieldError({ field: validation.field, message: validation.message });
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    setFieldError(null);
    try {
      await upsertEmployeeM.mutateAsync({
        id: employee?.id,
        name: name.trim(),
        position: position.trim(),
        hourly_rate: moneyFromInput(hourlyRate),
        pay_type: "hourly",
        default_daily_pay: null,
        is_active: isActive,
      });
      toast({
        semantic: "success",
        message: employee ? "Đã cập nhật nhân viên." : "Đã thêm nhân viên mới.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được nhân viên.",
      });
    }
  }

  const isBusy = upsertEmployeeM.isPending;
  const isEditMode = employee !== null;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>
          {isEditMode ? "Sửa thông tin nhân viên" : "Thêm nhân viên mới"}
        </ModalTitle>
        <ModalDescription>
          {isEditMode
            ? "Cập nhật tên, vị trí, lương theo giờ, trạng thái hoạt động."
            : "Nhập thông tin để thêm nhân viên vào danh sách hoạt động."}
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên nhân viên"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ví dụ: Lan"
            required
            autoFocus
            disabled={isBusy}
          />
          <TextField
            label="Vị trí"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            placeholder="Ví dụ: Thu ngân"
            disabled={isBusy}
          />
          <TextField
            label="Lương theo giờ"
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            inputMode="numeric"
            placeholder="26000"
            disabled={isBusy}
          />
          {isEditMode && (
            <Checkbox
              label="Đang hoạt động"
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
              disabled={isBusy}
            />
          )}
          {fieldError && (
            <AlertBanner variant="danger">{fieldError.message}</AlertBanner>
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
              disabled={!name.trim()}
            >
              {isEditMode ? "Lưu thay đổi" : "Thêm nhân viên"}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
