"use client";

import { useMemo } from "react";
import type { Account, AppSettings } from "@/lib/types";
import {
  getVisibleNav,
  getGroupedNav,
  getMobileTabs,
  getMobileDrawerGroups,
  canSee as canSeeFn,
  type NavItem,
  type NavGroupWithItems,
  type ViewKey,
} from "@/features/navigation/navigation";

export interface UseRoleGateResult {
  /** Nav items visible to this account, ordered per sidebar_config (fallback DEFAULT_SIDEBAR_BY_ROLE). */
  visibleNav: ReadonlyArray<NavItem>;
  /** Visible nav partitioned into fixed functional groups (NAV_GROUPS order, empty groups dropped). */
  groupedNav: ReadonlyArray<NavGroupWithItems>;
  /** Bottom tab bar mobile: ≤4 tab role-aware (spec 2026-06-11-mobile-uiux-design). */
  mobileTabs: ReadonlyArray<NavItem>;
  /** Drawer "Thêm" mobile: phần visible còn lại ngoài tabs, nhóm theo NAV_GROUPS. */
  mobileDrawerGroups: ReadonlyArray<NavGroupWithItems>;
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

  const groupedNav = useMemo(
    () => getGroupedNav(account, effectiveSettings),
    [account, effectiveSettings]
  );

  const mobileTabs = useMemo(
    () => getMobileTabs(account, effectiveSettings),
    [account, effectiveSettings]
  );

  const mobileDrawerGroups = useMemo(
    () => getMobileDrawerGroups(account, effectiveSettings),
    [account, effectiveSettings]
  );

  const defaultView: ViewKey = visibleNav[0]?.key ?? "dashboard";

  const canSee = useMemo(
    () => (key: ViewKey) => canSeeFn(account, key, effectiveSettings),
    [account, effectiveSettings]
  );

  return { visibleNav, groupedNav, mobileTabs, mobileDrawerGroups, defaultView, canSee };
}
