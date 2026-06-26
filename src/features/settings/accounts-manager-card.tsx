"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions
} from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useDeactivateUser } from "@/hooks/mutations/use-settings-mutations";
import { ROLE_LABELS } from "@/features/navigation/navigation";
import type { SettingsAccount, UserRole } from "@/lib/types";
import { Reveal } from "@/components/ui/reveal";
import { CreateAccountModal } from "./create-account-modal";
import { EditAccountModal } from "./edit-account-modal";

interface AccountsManagerCardProps {
  accounts: SettingsAccount[];
  currentUserAuthId: string;
  /** Current user's role — drives the owner-only role ceiling in the modals. */
  currentUserRole: UserRole;
  /** Active employees with no account yet — for the create/edit "link" pickers. */
  unlinkedEmployees: { id: string; name: string }[];
}

export function AccountsManagerCard({
  accounts,
  currentUserAuthId,
  currentUserRole,
  unlinkedEmployees
}: AccountsManagerCardProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const deactivateM = useDeactivateUser(supabase);

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SettingsAccount | null>(null);
  const [confirmDisable, setConfirmDisable] = useState<SettingsAccount | null>(null);

  async function handleDeactivate() {
    if (!confirmDisable) return;
    try {
      await deactivateM.mutateAsync(confirmDisable.auth_user_id);
      toast({ semantic: "success", message: "Đã vô hiệu hoá tài khoản." });
      setConfirmDisable(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không vô hiệu hoá được."
      });
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Quản lý tài khoản</CardTitle>
              <p className="mt-1 text-xs text-muted">
                Tạo, sửa vai trò, hoặc vô hiệu hoá tài khoản nhân viên — không
                cần vào Supabase Studio.
              </p>
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              + Thêm tài khoản
            </Button>
          </div>
        </CardHeader>
        <CardBody>
          {accounts.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có tài khoản"
              subtitle="Bấm 'Thêm tài khoản' để tạo người dùng đầu tiên."
            />
          ) : (
            <Reveal onScroll>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted">
                      Tên
                    </th>
                    <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                      Vai trò
                    </th>
                    <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                      Trạng thái
                    </th>
                    <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted">
                      Hành động
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc) => {
                    const isSelf = acc.auth_user_id === currentUserAuthId;
                    const isDisabled = acc.status === "disabled";
                    return (
                      <tr
                        key={acc.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-3 pr-4">
                          <p className="text-sm text-ink">
                            {acc.employee_name ?? "(chưa gắn nhân viên)"}
                            {isSelf && (
                              <span className="ml-2 text-xs text-muted">(bạn)</span>
                            )}
                          </p>
                          {acc.employee_position && (
                            <p className="text-xs text-muted">{acc.employee_position}</p>
                          )}
                          {!acc.employee_id && (
                            <button
                              type="button"
                              className="mt-0.5 text-xs text-warning underline-offset-2 hover:underline"
                              onClick={() => setEditing(acc)}
                            >
                              Chưa gắn nhân viên — gắn ngay
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <Badge variant="soft" semantic="neutral">
                            {ROLE_LABELS[acc.role]}
                          </Badge>
                        </td>
                        <td className="py-3 px-2">
                          <Badge
                            variant="soft"
                            semantic={isDisabled ? "neutral" : "success"}
                          >
                            {isDisabled ? "Disabled" : "Active"}
                          </Badge>
                        </td>
                        <td className="py-3 pl-2 text-right">
                          <div className="inline-flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              onClick={() => setEditing(acc)}
                            >
                              Sửa
                            </Button>
                            {!isSelf && !isDisabled && (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => setConfirmDisable(acc)}
                              >
                                Vô hiệu hoá
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </Reveal>
          )}
        </CardBody>
      </Card>

      <CreateAccountModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        approverRole={currentUserRole}
        unlinkedEmployees={unlinkedEmployees}
      />

      <EditAccountModal
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        account={editing}
        currentUserAuthId={currentUserAuthId}
        approverRole={currentUserRole}
        unlinkedEmployees={unlinkedEmployees}
      />

      <Modal
        open={confirmDisable !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmDisable(null);
        }}
      >
        <ModalContent>
          <ModalTitle>Vô hiệu hoá tài khoản?</ModalTitle>
          <ModalDescription>
            {confirmDisable?.employee_name ?? "Tài khoản"} sẽ không tạo được
            session mới. Session hiện hữu vẫn dùng được tới khi JWT hết hạn.
            Không xoá khỏi auth.users.
          </ModalDescription>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDisable(null)}
              disabled={deactivateM.isPending}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeactivate}
              loading={deactivateM.isPending}
            >
              Vô hiệu hoá
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>
    </>
  );
}
