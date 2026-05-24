"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useAppSettingsQuery,
  useSettingsAccountsQuery,
  useAccountQuery
} from "@/hooks/queries";
import type { UserRole } from "@/lib/types";
import { SidebarConfigForm } from "./sidebar-config-form";
import { HandoverDefaultTasksEditor } from "./handover-default-tasks-editor";
import { BackupRestoreSection } from "./backup-restore-section";

interface SettingsViewProps {
  role: UserRole;
  authHeader: string | null;
}

/**
 * Owner/manager-only Settings container.
 *
 * Defense-in-depth: NAV_ITEMS already gates `settings` to owner+manager, but
 * render an EmptyState fallback if somehow reached as another role.
 *
 * Composes:
 *   - SidebarConfigForm (role matrix + per-user override sub-section)
 *   - HandoverDefaultTasksEditor (list editor)
 */
export function SettingsView({ role, authHeader }: SettingsViewProps) {
  const supabase = useSupabase();
  const isEnabled = role === "owner" || role === "manager";

  const appSettingsQuery = useAppSettingsQuery(supabase, isEnabled);
  const settingsAccountsQuery = useSettingsAccountsQuery(supabase, isEnabled);
  const accountQuery = useAccountQuery(supabase, isEnabled);

  if (!isEnabled) {
    return (
      <EmptyState
        icon="lock"
        title="Thiết lập owner/manager only"
        subtitle="Module này dành cho owner và manager."
      />
    );
  }

  const isLoading =
    appSettingsQuery.isLoading ||
    settingsAccountsQuery.isLoading ||
    accountQuery.isLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  const appSettings = appSettingsQuery.data;
  const accounts = settingsAccountsQuery.data ?? [];
  const currentAccount = accountQuery.data;

  if (!appSettings || !currentAccount) {
    return (
      <EmptyState
        icon="alertTriangle"
        title="Không tải được cấu hình"
        subtitle="Vui lòng tải lại trang."
      />
    );
  }

  return (
    <Tabs defaultValue="general" className="space-y-6">
      <TabsList>
        <TabsTrigger value="general">Cài đặt chung</TabsTrigger>
        <TabsTrigger value="backup">Sao lưu / Khôi phục</TabsTrigger>
      </TabsList>

      <TabsContent value="general">
        <div className="space-y-6">
          <SidebarConfigForm
            sidebarDefaults={appSettings.sidebar_defaults}
            accounts={accounts}
            currentUserAuthId={currentAccount.auth_user_id}
          />
          <HandoverDefaultTasksEditor tasks={appSettings.handover_default_tasks} />
        </div>
      </TabsContent>

      <TabsContent value="backup">
        <BackupRestoreSection role={role} authHeader={authHeader} />
      </TabsContent>
    </Tabs>
  );
}
