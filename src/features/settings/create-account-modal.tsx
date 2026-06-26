"use client";

import { useState, type FormEvent } from "react";
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
import { useCreateUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { UserRole } from "@/lib/types";
import type { CreateUserPayload } from "@/lib/data/accounts";

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer", "employee_self_service"];
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

interface CreateAccountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The current user's role — owner-only role ceiling: only an owner may grant `owner`. */
  approverRole: UserRole;
  /** Active employees with no account yet — for the optional "gắn vào NV có sẵn" picker. */
  unlinkedEmployees: { id: string; name: string }[];
}

/**
 * Modal form: create a new auth user + employee + employee_account.
 *
 * Validation mirrors the server-side checks in /api/users (email regex,
 * password ≥8, name required, role enum, hourly_rate 0..10_000_000).
 * Showing inline errors avoids a round-trip for obvious typos.
 */
export function CreateAccountModal({ open, onOpenChange, approverRole, unlinkedEmployees }: CreateAccountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateUser(supabase);

  // Owner-only role ceiling (UI layer; server enforces it too in /api/users): a
  // non-owner cannot grant the `owner` role, so hide it from the dropdown.
  const roleOptions = approverRole === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [position, setPosition] = useState("");
  const [code, setCode] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  // Explicit, REQUIRED choice — guardrail against silently creating a duplicate
  // employee. "" = chưa chọn, "__new__" = tạo nhân viên mới, else an employee id.
  const [employeeChoice, setEmployeeChoice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isNewMode = employeeChoice === "__new__";
  // When an existing employee is picked, we LINK the new login to it (no duplicate
  // employee); name/position/rate come from that employee.
  const linkedEmp =
    employeeChoice && employeeChoice !== "__new__"
      ? unlinkedEmployees.find((e) => e.id === employeeChoice) ?? null
      : null;

  function reset() {
    setEmail("");
    setPassword("");
    setName("");
    setRole("employee_viewer");
    setPosition("");
    setCode("");
    setHourlyRate("");
    setEmployeeChoice("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Client-side validation (email/password always required)
    if (!EMAIL_REGEX.test(email.trim())) {
      setError("Email không hợp lệ.");
      return;
    }
    if (password.length < 8) {
      setError("Mật khẩu tối thiểu 8 ký tự.");
      return;
    }

    // Guardrail: force an explicit choice so we never silently create a duplicate NV.
    if (employeeChoice === "") {
      setError("Hãy chọn nhân viên có sẵn, hoặc 'Tạo nhân viên mới'.");
      return;
    }
    if (!isNewMode && !linkedEmp) {
      setError("Nhân viên đã chọn không còn khả dụng (có thể vừa được cấp tài khoản). Chọn lại.");
      return;
    }

    // Two paths: link to an existing employee (no new employee — name comes from
    // that employee, position/rate are ignored server-side) vs create a new one.
    let payload: CreateUserPayload;
    if (linkedEmp) {
      payload = {
        email: email.trim(),
        password,
        name: linkedEmp.name,
        role,
        employee_id: linkedEmp.id
      };
    } else {
      if (!name.trim()) {
        setError("Họ và tên bắt buộc.");
        return;
      }
      const rateNum = hourlyRate.trim() === "" ? 0 : Number(hourlyRate);
      if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 10_000_000) {
        setError("Lương theo giờ phải nằm trong 0–10.000.000.");
        return;
      }
      payload = {
        email: email.trim(),
        password,
        name: name.trim(),
        role,
        position: position.trim() || undefined,
        code: code.trim() || undefined,
        hourly_rate: rateNum
      };
    }

    try {
      await createM.mutateAsync(payload);
      const displayName = linkedEmp ? linkedEmp.name : name.trim();
      toast({
        semantic: "success",
        title: "Đã tạo tài khoản",
        message: `${displayName} (${ROLE_LABELS[role]}) đã có thể đăng nhập.`
      });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tạo tài khoản thất bại.");
    }
  }

  const isBusy = createM.isPending;

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent>
        <ModalTitle>Thêm tài khoản</ModalTitle>
        <ModalDescription>
          Tạo tài khoản đăng nhập cho một nhân viên — chọn nhân viên có sẵn để gắn,
          hoặc tạo nhân viên mới. Tài khoản active ngay.
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="create-account-link" className="text-sm text-ink-2">
              Tài khoản này dành cho nhân viên nào? <span className="text-danger">*</span>
            </label>
            <Select value={employeeChoice} onValueChange={setEmployeeChoice} disabled={isBusy}>
              <SelectTrigger id="create-account-link" className="w-full">
                <SelectValue placeholder="— Chọn nhân viên có sẵn, hoặc tạo mới —" />
              </SelectTrigger>
              <SelectContent>
                {unlinkedEmployees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
                <SelectItem value="__new__">➕ Tạo nhân viên mới</SelectItem>
              </SelectContent>
            </Select>
            {isNewMode && (
              <p className="text-xs text-warning">
                Sẽ tạo MỘT nhân viên mới. Nếu người này đã là nhân viên, hãy chọn họ ở danh sách trên để tránh trùng.
              </p>
            )}
          </div>

          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isBusy}
            placeholder="staff@chill.local"
          />
          <TextField
            label="Mật khẩu"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={isBusy}
            placeholder="≥ 8 ký tự"
          />
          {linkedEmp && (
            <p className="text-sm text-ink-2">
              Sẽ gắn tài khoản vào nhân viên có sẵn:{" "}
              <strong className="text-ink">{linkedEmp.name}</strong>
            </p>
          )}
          {isNewMode && (
            <TextField
              label="Họ và tên"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isBusy}
              placeholder="Nguyễn Văn A"
            />
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="create-account-role" className="text-sm text-ink-2">Vai trò</label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={isBusy}>
              <SelectTrigger id="create-account-role" className="w-full">
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
          </div>

          {/* New-employee fields — only when creating a brand-new employee. */}
          {isNewMode && (
            <>
              <TextField
                label="Mã nhân viên (tuỳ chọn)"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isBusy}
                placeholder="NV001"
              />
              <TextField
                label="Vị trí (tuỳ chọn)"
                type="text"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                disabled={isBusy}
                placeholder="Barista"
              />
              <TextField
                label="Lương theo giờ (tuỳ chọn, VND)"
                type="number"
                inputMode="numeric"
                min={0}
                max={10_000_000}
                step={1000}
                value={hourlyRate}
                onChange={(e) => setHourlyRate(e.target.value)}
                disabled={isBusy}
                placeholder="0"
              />
            </>
          )}

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={isBusy}>
              Tạo tài khoản
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
