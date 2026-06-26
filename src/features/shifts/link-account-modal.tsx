"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCreateUser, useUpdateUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { Employee, UserRole } from "@/lib/types";
import type { UnlinkedAccount } from "@/lib/data/accounts";

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer", "employee_self_service"];
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

interface LinkAccountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  employee: Employee | null;
  unlinkedAccounts: UnlinkedAccount[];
  approverRole: UserRole;
}

/**
 * "Cấp tài khoản" for an existing employee on the shift page. Two modes:
 *  - Tạo mới: create a new login linked to THIS employee (no duplicate employee).
 *  - Liên kết: attach an already-created, unlinked account to this employee.
 *
 * Owner-only role ceiling (UI; server enforces too): non-owners can't grant `owner`.
 */
export function LinkAccountModal({
  open,
  onOpenChange,
  employee,
  unlinkedAccounts,
  approverRole
}: LinkAccountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateUser(supabase);
  const updateM = useUpdateUser(supabase);

  const [tab, setTab] = useState<"create" | "link">("create");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("employee_self_service");
  const [selectedAuthUserId, setSelectedAuthUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab("create");
    setEmail("");
    setPassword("");
    setRole("employee_self_service");
    setSelectedAuthUserId("");
    setError(null);
  }, [open]);

  if (!employee) return null;

  const emp = employee;
  const roleOptions = approverRole === "owner" ? ROLES : ROLES.filter((r) => r !== "owner");
  const isBusy = createM.isPending || updateM.isPending;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!EMAIL_REGEX.test(email.trim())) {
      setError("Email không hợp lệ.");
      return;
    }
    if (password.length < 8) {
      setError("Mật khẩu tối thiểu 8 ký tự.");
      return;
    }
    try {
      await createM.mutateAsync({
        email: email.trim(),
        password,
        name: emp.name,
        role,
        employee_id: emp.id
      });
      toast({ semantic: "success", message: `Đã cấp tài khoản cho ${emp.name}.` });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cấp tài khoản thất bại.");
    }
  }

  async function handleLink(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedAuthUserId) {
      setError("Chọn một tài khoản để liên kết.");
      return;
    }
    try {
      await updateM.mutateAsync({ authUserId: selectedAuthUserId, patch: { employee_id: emp.id } });
      toast({ semantic: "success", message: `Đã liên kết tài khoản với ${emp.name}.` });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Liên kết thất bại.");
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent>
        <ModalTitle>Cấp tài khoản — {emp.name}</ModalTitle>
        <ModalDescription>
          Tạo tài khoản đăng nhập mới gắn vào nhân viên này, hoặc liên kết một tài
          khoản đã có (chưa gắn ai).
        </ModalDescription>

        {error && (
          <AlertBanner variant="danger" title="Không thực hiện được">
            {error}
          </AlertBanner>
        )}

        <Tabs value={tab} onValueChange={(v) => setTab(v as "create" | "link")} className="mt-4 space-y-4">
          <TabsList>
            <TabsTrigger value="create">Tạo mới</TabsTrigger>
            <TabsTrigger value="link">Liên kết TK có sẵn</TabsTrigger>
          </TabsList>

          <TabsContent value="create">
            <form onSubmit={handleCreate} className="space-y-3">
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isBusy}
                placeholder="nhanvien@chill.local"
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
              <div className="flex flex-col gap-1.5">
                <label htmlFor="grant-role" className="text-sm text-ink-2">Vai trò</label>
                <Select value={role} onValueChange={(v) => setRole(v as UserRole)} disabled={isBusy}>
                  <SelectTrigger id="grant-role" className="w-full">
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
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                  Hủy
                </Button>
                <Button type="submit" variant="primary" loading={createM.isPending}>
                  Tạo &amp; cấp
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="link">
            <form onSubmit={handleLink} className="space-y-3">
              {unlinkedAccounts.length === 0 ? (
                <p className="text-sm text-muted">
                  Không có tài khoản nào chưa gắn nhân viên. Dùng tab &quot;Tạo mới&quot;.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="link-account" className="text-sm text-ink-2">Tài khoản chưa gắn</label>
                  <Select value={selectedAuthUserId} onValueChange={setSelectedAuthUserId} disabled={isBusy}>
                    <SelectTrigger id="link-account" className="w-full">
                      <SelectValue placeholder="Chọn tài khoản…" />
                    </SelectTrigger>
                    <SelectContent>
                      {unlinkedAccounts.map((a) => (
                        <SelectItem key={a.auth_user_id} value={a.auth_user_id}>
                          {a.email} ({ROLE_LABELS[a.role]})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                  Hủy
                </Button>
                <Button type="submit" variant="primary" loading={updateM.isPending} disabled={unlinkedAccounts.length === 0}>
                  Liên kết
                </Button>
              </div>
            </form>
          </TabsContent>
        </Tabs>
      </ModalContent>
    </Modal>
  );
}
