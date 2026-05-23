"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useAppSettingsQuery,
  useSettingsAccountsQuery,
  useAccountQuery,
  useSignupRequestsQuery
} from "@/hooks/queries";
import type { UserRole } from "@/lib/types";
import { SidebarConfigForm } from "./sidebar-config-form";
import { HandoverDefaultTasksEditor } from "./handover-default-tasks-editor";
import { KiotvietConfigForm } from "./kiotviet-config-form";
import { AccountsManagerCard } from "./accounts-manager-card";
import { SignupRequestsCard } from "./signup-requests-card";

interface SettingsViewProps {
  role: UserRole;
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
export function SettingsView({ role }: SettingsViewProps) {
  const supabase = useSupabase();
  const isEnabled = role === "owner" || role === "manager";

  const appSettingsQuery = useAppSettingsQuery(supabase, isEnabled);
  const settingsAccountsQuery = useSettingsAccountsQuery(supabase, isEnabled);
  const accountQuery = useAccountQuery(supabase, isEnabled);
  const signupRequestsQuery = useSignupRequestsQuery(supabase, isEnabled);

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
    <div className="space-y-6">
      <AccountsManagerCard
        accounts={accounts}
        currentUserAuthId={currentAccount.auth_user_id}
      />
      <SignupRequestsCard requests={signupRequestsQuery.data ?? []} />
      <SidebarConfigForm
        sidebarDefaults={appSettings.sidebar_defaults}
        accounts={accounts}
        currentUserAuthId={currentAccount.auth_user_id}
      />
      <HandoverDefaultTasksEditor tasks={appSettings.handover_default_tasks} />
      <KiotvietConfigForm />
    </div>
  );
}
