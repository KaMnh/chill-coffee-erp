"use client";

import { useMemo } from "react";
import type { Account, AppSettings } from "@/lib/types";
import {
  getVisibleNav,
  canSee as canSeeFn,
  type NavItem,
  type ViewKey,
} from "@/features/navigation/navigation";

export interface UseRoleGateResult {
  /** Nav items visible to this account, ordered per sidebar_config (fallback DEFAULT_SIDEBAR_BY_ROLE). */
  visibleNav: ReadonlyArray<NavItem>;
  /** First visible view, used as fallback when current view is hidden by role change. */
  defaultView: ViewKey;
  /** Whether this account can see a given view (with current app settings). */
  canSee(key: ViewKey): boolean;
}

const EMPTY_SETTINGS: AppSettings = {
  sidebar_defaults: {},
  handover_default_tasks: [],
};

/**
 * Memoized role gate. Pure wrapper over navigation.ts so consumers (sidebar,
 * topbar, page.tsx) don't repeatedly recompute the visibleNav list.
 *
 * If account is null, returns an empty matrix — caller should render the
 * login screen, not the AppShell.
 */
export function useRoleGate(
  account: Account | null,
  settings: AppSettings | undefined
): UseRoleGateResult {
  const effectiveSettings = settings ?? EMPTY_SETTINGS;

  const visibleNav = useMemo(
    () => getVisibleNav(account, effectiveSettings),
    [account, effectiveSettings]
  );

  const defaultView: ViewKey = visibleNav[0]?.key ?? "dashboard";

  const canSee = useMemo(
    () => (key: ViewKey) => canSeeFn(account, key, effectiveSettings),
    [account, effectiveSettings]
  );

  return { visibleNav, defaultView, canSee };
}
