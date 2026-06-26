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
import { useUpdateUser, useRepointUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { SettingsAccount, UserRole } from "@/lib/types";

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer", "employee_self_service"];

interface EditAccountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  account: SettingsAccount | null;
  currentUserAuthId: string;
  /** The current user's role — owner-only ceiling: only an owner may grant/modify `owner`. */
  approverRole: UserRole;
  /** Active employees with no account yet — for linking an UNLINKED account. */
  unlinkedEmployees: { id: string; name: string }[];
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
  currentUserAuthId,
  approverRole,
  unlinkedEmployees
}: EditAccountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateUser(supabase);
  const repointM = useRepointUser(supabase);
  const [repointTargetId, setRepointTargetId] = useState("");
  const [repointConfirm, setRepointConfirm] = useState(false);
  const [repointError, setRepointError] = useState<string | null>(null);

  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [status, setStatus] = useState<"active" | "disabled">("active");
  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [linkEmployeeId, setLinkEmployeeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Initialise state when modal opens with a different account.
  useEffect(() => {
    if (!open || !account) return;
    setRole(account.role);
    setStatus(account.status === "disabled" ? "disabled" : "active");
    setName(account.employee_name ?? "");
    setPosition(account.employee_position ?? "");
    setHourlyRate(""); // backend doesn't return hourly_rate in SettingsAccount; leave blank → unchanged
    setLinkEmployeeId("");
    setError(null);
    setRepointTargetId("");
    setRepointConfirm(false);
    setRepointError(null);
  }, [open, account]);

  if (!account) return null;

  const isSelf = account.auth_user_id === currentUserAuthId;
  const isBusy = updateM.isPending || repointM.isPending;
  // An account with no employee can only be LINKED here (no name/position/rate to edit).
  const isUnlinked = !account.employee_id;

  // Re-point: chỉ owner, account ĐÃ gắn NV, và không phải chính mình.
  const canRepoint = !isUnlinked && !isSelf && approverRole === "owner";
  const repointTargetName =
    unlinkedEmployees.find((e) => e.id === repointTargetId)?.name ?? "";

  async function handleRepoint() {
    if (!account || !account.employee_id || !repointTargetId) return;
    setRepointError(null);
    try {
      await repointM.mutateAsync({
        authUserId: account.auth_user_id,
        targetEmployeeId: repointTargetId,
        sourceEmployeeId: account.employee_id
      });
      toast({ semantic: "success", message: "Đã đổi nhân viên cho tài khoản." });
      onOpenChange(false);
    } catch (err) {
      setRepointError(err instanceof Error ? err.message : "Đổi nhân viên thất bại.");
    }
  }

  // Owner-only ceiling (UI; server also enforces): a non-owner cannot grant `owner`
  // nor modify an account that is currently `owner`.
  const isOwnerApprover = approverRole === "owner";
  const cannotModifyOwner = account.role === "owner" && !isOwnerApprover;
  // Include `owner` in the options when the target IS owner (so the disabled select
  // can still render the current value), otherwise hide it from non-owners.
  const roleOptions =
    isOwnerApprover || account.role === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");
  const roleStatusDisabled = isBusy || isSelf || cannotModifyOwner;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!account) return;

    // Build patch with only the changed fields.
    const patch: {
      role?: UserRole;
      status?: "active" | "disabled";
      name?: string;
      position?: string;
      hourly_rate?: number;
      employee_id?: string;
    } = {};

    // role/status apply to any account (skip role for self).
    if (!isSelf && role !== account.role) patch.role = role;
    if (!isSelf && status !== (account.status === "disabled" ? "disabled" : "active")) {
      patch.status = status;
    }

    if (isUnlinked) {
      // No employee attached → the only employee action is linking to an existing one.
      if (linkEmployeeId) patch.employee_id = linkEmployeeId;
    } else {
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
      if (name.trim() !== (account.employee_name ?? "")) patch.name = name.trim();
      if (position.trim() !== (account.employee_position ?? "")) {
        patch.position = position.trim();
      }
      if (rateNum !== undefined) patch.hourly_rate = rateNum;
    }

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
          {account.employee_name ?? "(chưa gắn nhân viên)"}
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
              disabled={roleStatusDisabled}
            >
              <SelectTrigger id="edit-account-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => (
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
            {cannotModifyOwner && !isSelf && (
              <p className="text-xs text-muted">
                Chỉ owner mới sửa được tài khoản owner.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="edit-account-status" className="text-sm text-ink-2">Trạng thái</label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "active" | "disabled")}
              disabled={roleStatusDisabled}
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

          {isUnlinked ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-account-link" className="text-sm text-ink-2">
                Gắn vào nhân viên có sẵn
              </label>
              {unlinkedEmployees.length === 0 ? (
                <p className="text-sm text-muted">
                  Không có nhân viên nào chưa có tài khoản để gắn.
                </p>
              ) : (
                <Select
                  value={linkEmployeeId || "__none__"}
                  onValueChange={(v) => setLinkEmployeeId(v === "__none__" ? "" : v)}
                  disabled={isBusy}
                >
                  <SelectTrigger id="edit-account-link" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Không gắn —</SelectItem>
                    {unlinkedEmployees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted">
                Tài khoản này chưa gắn nhân viên. Chọn một nhân viên (chưa có tài khoản) để liên kết.
              </p>
            </div>
          ) : (
            <>
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
            </>
          )}

          {canRepoint && (
            <div className="mt-2 flex flex-col gap-1.5 rounded-md border border-border p-3">
              <label htmlFor="edit-account-repoint" className="text-sm font-medium text-ink">Đổi nhân viên cho tài khoản</label>
              {repointError && (
                <AlertBanner variant="danger" title="Không đổi được">
                  {repointError}
                </AlertBanner>
              )}
              {unlinkedEmployees.length === 0 ? (
                <p className="text-sm text-muted">
                  Không có nhân viên (chưa có tài khoản) để chuyển sang.
                </p>
              ) : (
                <>
                  <Select
                    value={repointTargetId || "__none__"}
                    onValueChange={(v) => {
                      setRepointTargetId(v === "__none__" ? "" : v);
                      setRepointConfirm(false);
                    }}
                    disabled={repointM.isPending}
                  >
                    <SelectTrigger id="edit-account-repoint" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Chọn nhân viên đích —</SelectItem>
                      {unlinkedEmployees.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {repointTargetId && !repointConfirm && (
                    <>
                      <p className="text-xs text-warning">
                        Nhân viên nguồn «{account.employee_name}» sẽ chuyển sang Nghỉ;
                        tài khoản sẽ gắn vào «{repointTargetName}».
                      </p>
                      <div>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => setRepointConfirm(true)}
                          disabled={repointM.isPending}
                        >
                          Đổi nhân viên
                        </Button>
                      </div>
                    </>
                  )}
                  {repointTargetId && repointConfirm && (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRepointConfirm(false)}
                        disabled={repointM.isPending}
                      >
                        Hủy
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleRepoint}
                        loading={repointM.isPending}
                      >
                        Xác nhận đổi sang «{repointTargetName}»
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
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
            <Button type="submit" variant="primary" loading={isBusy}>
              Lưu
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
