"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateSidebarDefaults } from "@/hooks/mutations/use-settings-mutations";
import {
  NAV_ITEMS,
  DEFAULT_SIDEBAR_BY_ROLE,
  ROLE_LABELS
} from "@/features/navigation/navigation";
import type { ViewKey } from "@/features/navigation/navigation";
import type { AppSettings, SettingsAccount, UserRole } from "@/lib/types";
import { Reveal } from "@/components/ui/reveal";
import { UserSidebarConfigModal } from "./user-sidebar-config-modal";

interface SidebarConfigFormProps {
  sidebarDefaults: AppSettings["sidebar_defaults"];
  accounts: SettingsAccount[];
  currentUserAuthId: string;
}

const ROLES: UserRole[] = ["owner", "manager", "staff_operator", "employee_viewer"];

/**
 * Sidebar config form — composed of two sections:
 *   1. Role matrix (4 columns × 8 rows of Checkboxes, auto-save per toggle)
 *   2. Per-user override sub-section (list of accounts + "Sửa" → modal)
 *
 * Hard floor: cells where NAV_ITEMS[i].roles excludes the role are disabled.
 * Self-lock-out guard: "Thiết lập" for the current user's role is locked checked.
 */
export function SidebarConfigForm({
  sidebarDefaults,
  accounts,
  currentUserAuthId
}: SidebarConfigFormProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateSidebarDefaults(supabase);

  const [savingRole, setSavingRole] = useState<UserRole | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<SettingsAccount | null>(null);

  const currentUserRole = accounts.find((a) => a.auth_user_id === currentUserAuthId)?.role ?? null;

  function getItemsForRole(role: UserRole): string[] {
    const fromSettings = sidebarDefaults[role];
    if (fromSettings && fromSettings.length > 0) return fromSettings;
    return [...DEFAULT_SIDEBAR_BY_ROLE[role]];
  }

  async function handleToggle(role: UserRole, navKey: ViewKey, checked: boolean) {
    const current = getItemsForRole(role);
    const next = checked
      ? Array.from(new Set([...current, navKey]))
      : current.filter((k) => k !== navKey);

    setSavingRole(role);
    try {
      await updateM.mutateAsync({ role, items: next });
      toast({
        semantic: "success",
        message: `Đã cập nhật sidebar mặc định cho ${ROLE_LABELS[role]}.`
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không cập nhật được sidebar."
      });
    } finally {
      setSavingRole(null);
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Sidebar mặc định theo role</CardTitle>
            <p className="mt-1 text-xs text-muted">
              Tick / bỏ tick để hiển thị mục sidebar cho từng role. Tự động lưu khi thay đổi.
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <AlertBanner variant="info">
            Mỗi role chỉ thấy được những mục mà NAV_ITEMS cho phép. Các ô bị tắt
            (xám) là mục role đó không có quyền vào — không thể bật. Mục
            &quot;Thiết lập&quot; cho role của bạn được khóa để tránh tự khóa mình.
          </AlertBanner>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted">
                    Mục sidebar
                  </th>
                  {ROLES.map((role) => (
                    <th
                      key={role}
                      className="text-center py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted"
                    >
                      {ROLE_LABELS[role]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {NAV_ITEMS.map((item) => (
                  <tr key={item.key} className="border-b border-border last:border-0">
                    <td className="py-3 pr-4 text-sm text-ink">{item.label}</td>
                    {ROLES.map((role) => {
                      const allowedByNav = item.roles.includes(role);
                      const isCurrentUserRole = role === currentUserRole;
                      const isSelfLockSettings = item.key === "settings" && isCurrentUserRole;
                      const currentItems = getItemsForRole(role);
                      const isChecked = allowedByNav && currentItems.includes(item.key);
                      const isColumnSaving = savingRole === role;

                      return (
                        <td key={role} className="text-center py-3 px-2">
                          <div className="inline-flex justify-center">
                            <Checkbox
                              checked={isSelfLockSettings ? true : isChecked}
                              onCheckedChange={(checked) =>
                                handleToggle(role, item.key, checked === true)
                              }
                              disabled={!allowedByNav || isSelfLockSettings || isColumnSaving}
                              aria-label={`${ROLE_LABELS[role]} - ${item.label}`}
                            />
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tùy chỉnh sidebar cho từng nhân viên</CardTitle>
            <p className="mt-1 text-xs text-muted">
              Override sidebar mặc định của role cho từng tài khoản cụ thể.
            </p>
          </div>
        </CardHeader>
        <CardBody>
          {accounts.length === 0 ? (
            <EmptyState
              icon="users"
              title="Chưa có tài khoản nào"
              subtitle="Tài khoản nhân viên hiện ra ở đây sau khi được kích hoạt."
            />
          ) : (
            <Reveal onScroll className="space-y-2">
              {accounts.map((account) => {
                const hasOverride = account.sidebar_config !== null;
                const overrideCount = account.sidebar_config?.length ?? 0;
                const displayName = account.employee_name ?? "(chưa có tên)";
                const isSelf = account.auth_user_id === currentUserAuthId;

                return (
                  <div
                    key={account.id}
                    className="flex items-center justify-between p-3 rounded-md border border-border bg-surface"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {displayName}
                          {isSelf && (
                            <span className="ml-2 text-xs text-muted">(bạn)</span>
                          )}
                        </p>
                        {account.employee_position && (
                          <p className="text-xs text-muted">{account.employee_position}</p>
                        )}
                      </div>
                      <Badge variant="soft" semantic="neutral">
                        {ROLE_LABELS[account.role]}
                      </Badge>
                      {hasOverride && (
                        <Badge variant="soft" semantic="warning">
                          Override: {overrideCount} mục
                        </Badge>
                      )}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setSelectedAccount(account)}
                    >
                      Sửa
                    </Button>
                  </div>
                );
              })}
            </Reveal>
          )}
        </CardBody>
      </Card>

      <UserSidebarConfigModal
        open={selectedAccount !== null}
        onOpenChange={(open) => { if (!open) setSelectedAccount(null); }}
        account={selectedAccount}
        sidebarDefaults={sidebarDefaults}
        currentUserAuthId={currentUserAuthId}
      />
    </>
  );
}
