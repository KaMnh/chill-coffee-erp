"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem
} from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useApproveSignup } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { SignupRequest, UserRole } from "@/lib/types";

const ROLES: UserRole[] = [
  "owner",
  "manager",
  "staff_operator",
  "employee_viewer",
  "employee_self_service"
];

interface ApproveSignupModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  request: SignupRequest | null;
  /** Role of the approver — only an owner may grant `owner` (role ceiling). */
  approverRole: UserRole;
}

export function ApproveSignupModal({
  open,
  onOpenChange,
  request,
  approverRole
}: ApproveSignupModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const approveM = useApproveSignup(supabase);

  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [error, setError] = useState<string | null>(null);

  // Role ceiling: only an owner may grant `owner`. Hide it for other approvers
  // so a manager can't reach owner via this UI (the server enforces this too).
  const availableRoles =
    approverRole === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");

  useEffect(() => {
    if (open) {
      setRole("employee_viewer");
      setError(null);
    }
  }, [open]);

  if (!request) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request) return;
    setError(null);
    try {
      await approveM.mutateAsync({ id: request.id, role });
      toast({
        semantic: "success",
        title: "Đã duyệt đơn",
        message: `${request.name ?? request.email} (${ROLE_LABELS[role]}) đã có thể đăng nhập.`
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duyệt thất bại.");
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Duyệt đơn đăng ký</ModalTitle>
        <ModalDescription>
          Email: <span className="font-medium text-ink">{request.email}</span>
          {request.name && (
            <>
              <br />
              Họ tên: <span className="font-medium text-ink">{request.name}</span>
            </>
          )}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="approve-signup-role" className="text-sm text-ink-2">Vai trò gán cho tài khoản</label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              disabled={approveM.isPending}
            >
              <SelectTrigger id="approve-signup-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-xs text-muted">
            Thông tin nhân viên (lương theo giờ, vị trí) có thể bổ sung sau
            trong bảng quản lý tài khoản.
          </p>

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={approveM.isPending}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={approveM.isPending}>
              Duyệt
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
