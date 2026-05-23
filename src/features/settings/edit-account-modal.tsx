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
import { TextField } from "@/components/ui/text-field";
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
import { useUpdateUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { SettingsAccount, UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];

interface EditAccountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  account: SettingsAccount | null;
  currentUserAuthId: string;
}

/**
 * Modal form: edit role / status / employee fields of an existing account.
 *
 * Self-lockout (UI layer only):
 *   - Editing self → role select is disabled.
 *   - Status can be toggled to "disabled" for others; self cannot disable
 *     itself (the AccountsManagerCard already hides the disable button for
 *     self, but we also defend in depth here).
 */
export function EditAccountModal({
  open,
  onOpenChange,
  account,
  currentUserAuthId
}: EditAccountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateUser(supabase);

  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Initialise state when modal opens with a different account.
  useEffect(() => {
    if (!open || !account) return;
    setRole(account.role);
    setStatus(account.status === "disabled" ? "disabled" : "active");
    setName(account.employee_name ?? "");
    setPosition(account.employee_position ?? "");
    setHourlyRate(""); // backend doesn't return hourly_rate in SettingsAccount; leave blank → unchanged
    setError(null);
  }, [open, account]);

  if (!account) return null;

  const isSelf = account.auth_user_id === currentUserAuthId;
  const isBusy = updateM.isPending;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Họ và tên bắt buộc.");
      return;
    }
    const rateStr = hourlyRate.trim();
    const rateNum = rateStr === "" ? undefined : Number(rateStr);
    if (rateNum !== undefined && (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 10_000_000)) {
      setError("Lương theo giờ phải nằm trong 0–10.000.000.");
      return;
    }

    // Build patch with only the changed fields. Skip role for self.
    const patch: {
      role?: UserRole;
      status?: "active" | "disabled";
      name?: string;
      position?: string;
      hourly_rate?: number;
    } = {};

    if (!account) return;
    if (!isSelf && role !== account.role) patch.role = role;
    if (!isSelf && status !== (account.status === "disabled" ? "disabled" : "active")) {
      patch.status = status;
    }
    if (name.trim() !== (account.employee_name ?? "")) patch.name = name.trim();
    if (position.trim() !== (account.employee_position ?? "")) {
      patch.position = position.trim();
    }
    if (rateNum !== undefined) patch.hourly_rate = rateNum;

    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }

    try {
      await updateM.mutateAsync({ authUserId: account.auth_user_id, patch });
      toast({ semantic: "success", message: "Đã cập nhật tài khoản." });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cập nhật thất bại.");
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Sửa tài khoản</ModalTitle>
        <ModalDescription>
          {account.employee_name ?? "(chưa có tên)"}
          {isSelf && " — đây là bạn"}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-account-role" className="text-sm text-ink-2">Vai trò</label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as UserRole)}
              disabled={isBusy || isSelf}
            >
              <SelectTrigger id="edit-account-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-xs text-muted">
                Không thể tự đổi vai trò của chính mình.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-account-status" className="text-sm text-ink-2">Trạng thái</label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "active" | "disabled")}
              disabled={isBusy || isSelf}
            >
              <SelectTrigger id="edit-account-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <TextField
            label="Họ và tên"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isBusy}
          />
          <TextField
            label="Vị trí"
            type="text"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            disabled={isBusy}
            placeholder="Barista"
          />
          <TextField
            label="Lương theo giờ (VND) — bỏ trống = không đổi"
            type="number"
            inputMode="numeric"
            min={0}
            max={10_000_000}
            step={1000}
            value={hourlyRate}
            onChange={(e) => setHourlyRate(e.target.value)}
            disabled={isBusy}
            placeholder=""
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
            <Button type="submit" variant="primary" loading={isBusy}>
              Lưu
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
