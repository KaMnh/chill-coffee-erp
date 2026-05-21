"use client";

import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateUserSidebarConfig } from "@/hooks/mutations/use-settings-mutations";
import {
  NAV_ITEMS,
  DEFAULT_SIDEBAR_BY_ROLE,
  ROLE_LABELS
} from "@/features/navigation/navigation";
import type { ViewKey } from "@/features/navigation/navigation";
import type { AppSettings, SettingsAccount } from "@/lib/types";

interface UserSidebarConfigModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  account: SettingsAccount | null;
  sidebarDefaults: AppSettings["sidebar_defaults"];
  currentUserAuthId: string;
}

/**
 * Per-user sidebar override modal.
 *
 * Explicit Save model: user toggles multiple checkboxes, then clicks Lưu
 * (commit) or Reset (clear override). Auto-save would clutter the toast
 * feed for batch operations.
 *
 * Hard floor: only NAV_ITEMS where account.role is allowed are listed.
 *
 * Self-lock-out guard: if account is the current user, "Thiết lập" is
 * permanently checked + disabled.
 *
 * Reset flow: if account.sidebar_config !== null, shows inline AlertBanner
 * confirm before firing reset mutation.
 */
export function UserSidebarConfigModal({
  open,
  onOpenChange,
  account,
  sidebarDefaults,
  currentUserAuthId
}: UserSidebarConfigModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateUserSidebarConfig(supabase);

  const [selectedKeys, setSelectedKeys] = useState<ReadonlyArray<string>>([]);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Initialize state when modal opens with a new account.
  useEffect(() => {
    if (!open || !account) return;
    const initial =
      account.sidebar_config ??
      sidebarDefaults[account.role] ??
      DEFAULT_SIDEBAR_BY_ROLE[account.role];
    setSelectedKeys([...initial]);
    setConfirmingReset(false);
  }, [open, account, sidebarDefaults]);

  if (!account) return null;

  const allowedItems = NAV_ITEMS.filter((item) => item.roles.includes(account.role));
  const isSelf = account.auth_user_id === currentUserAuthId;
  const hasOverride = account.sidebar_config !== null;
  const isBusy = updateM.isPending;

  function handleToggle(navKey: ViewKey, checked: boolean) {
    setSelectedKeys((current) =>
      checked
        ? Array.from(new Set([...current, navKey]))
        : current.filter((k) => k !== navKey)
    );
  }

  async function handleSave() {
    if (!account || isBusy) return;
    try {
      await updateM.mutateAsync({
        profileId: account.id,
        items: [...selectedKeys]
      });
      toast({
        semantic: "success",
        message: `Đã lưu sidebar riêng cho ${account.employee_name ?? "tài khoản"}.`
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được sidebar cá nhân."
      });
    }
  }

  async function handleConfirmReset() {
    if (!account || isBusy) return;
    try {
      await updateM.mutateAsync({ profileId: account.id, items: null });
      toast({
        semantic: "success",
        message: `Đã reset sidebar cho ${account.employee_name ?? "tài khoản"} về mặc định role.`
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không reset được sidebar."
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>
          Sidebar cá nhân — {account.employee_name ?? "(chưa có tên)"}
        </ModalTitle>
        <ModalDescription>
          <Badge variant="soft" semantic="neutral">{ROLE_LABELS[account.role]}</Badge>
          {hasOverride && (
            <Badge variant="soft" semantic="warning" className="ml-2">
              Đang có override
            </Badge>
          )}
        </ModalDescription>

        {confirmingReset ? (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="warning">
              Reset sẽ xóa override hiện tại — tài khoản này quay về sidebar mặc định
              cho role {ROLE_LABELS[account.role]}. Tiếp tục?
            </AlertBanner>
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setConfirmingReset(false)} disabled={isBusy}>
                Hủy reset
              </Button>
              <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirmReset}>
                Xác nhận reset
              </Button>
            </ModalActions>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="info">
              Override sẽ ghi đè default cho role này. Click &quot;Reset về mặc định role&quot;
              để dùng lại default.
              {isSelf && (
                <> Mục &quot;Thiết lập&quot; bị khóa cho tài khoản hiện tại để tránh tự khóa mình.</>
              )}
            </AlertBanner>

            <div className="space-y-2">
              {allowedItems.map((item) => {
                const isSelfLockSettings = item.key === "settings" && isSelf;
                const isChecked = isSelfLockSettings ? true : selectedKeys.includes(item.key);
                return (
                  <div key={item.key} className="flex items-center gap-3 p-2 rounded-md hover:bg-surface-muted">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => handleToggle(item.key, checked === true)}
                      disabled={isSelfLockSettings || isBusy}
                      label={item.label}
                    />
                  </div>
                );
              })}
            </div>

            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Đóng
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingReset(true)}
                disabled={!hasOverride || isBusy}
                title={!hasOverride ? "Đã dùng default rồi" : undefined}
              >
                Reset về mặc định role
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={isBusy}
                onClick={handleSave}
              >
                Lưu
              </Button>
            </ModalActions>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
