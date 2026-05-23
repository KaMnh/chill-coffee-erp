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

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

interface CreateAccountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * Modal form: create a new auth user + employee + employee_account.
 *
 * Validation mirrors the server-side checks in /api/users (email regex,
 * password ≥8, name required, role enum, hourly_rate 0..10_000_000).
 * Showing inline errors avoids a round-trip for obvious typos.
 */
export function CreateAccountModal({ open, onOpenChange }: CreateAccountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateUser(supabase);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("employee_viewer");
  const [position, setPosition] = useState("");
  const [code, setCode] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setPassword("");
    setName("");
    setRole("employee_viewer");
    setPosition("");
    setCode("");
    setHourlyRate("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Client-side validation
    if (!EMAIL_REGEX.test(email.trim())) {
      setError("Email không hợp lệ.");
      return;
    }
    if (password.length < 8) {
      setError("Mật khẩu tối thiểu 8 ký tự.");
      return;
    }
    if (!name.trim()) {
      setError("Họ và tên bắt buộc.");
      return;
    }
    const rateNum = hourlyRate.trim() === "" ? 0 : Number(hourlyRate);
    if (!Number.isFinite(rateNum) || rateNum < 0 || rateNum > 10_000_000) {
      setError("Lương theo giờ phải nằm trong 0–10.000.000.");
      return;
    }

    try {
      await createM.mutateAsync({
        email: email.trim(),
        password,
        name: name.trim(),
        role,
        position: position.trim() || undefined,
        code: code.trim() || undefined,
        hourly_rate: rateNum
      });
      toast({
        semantic: "success",
        title: "Đã tạo tài khoản",
        message: `${name.trim()} (${ROLE_LABELS[role]}) đã có thể đăng nhập.`
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
          Tạo auth user + employee + employee_account trong 1 bước. Tài khoản
          ở trạng thái active ngay.
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {error && (
            <AlertBanner variant="danger" title="Không thực hiện được">
              {error}
            </AlertBanner>
          )}

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

          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-ink-2">Vai trò</label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={isBusy}>
              <SelectTrigger className="w-full">
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
          </div>

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
