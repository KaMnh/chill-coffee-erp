import type { Account, AppSettings, UserRole } from "@/lib/types";
import type { IconName } from "@/components/ui/icons";

export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe"
  | "handover" | "inventory"
  | "reports" | "pivot" | "cashflow" | "settings";

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: IconName;
  roles: ReadonlyArray<UserRole>;
}

/**
 * Nav matrix ported verbatim from v3 src/features/navigation.ts.
 * 4 roles × 8 views. Vietnamese labels preserved.
 */
export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: "dashboard", label: "Bảng vận hành", icon: "layoutDashboard", roles: ["owner", "manager", "staff_operator", "employee_viewer"] },
  { key: "expenses",  label: "Chi phí",       icon: "wallet",          roles: ["owner", "manager", "staff_operator"] },
  { key: "shifts",    label: "Ca & lương",    icon: "users",           roles: ["owner", "manager", "staff_operator"] },
  { key: "cash",      label: "Chốt két",      icon: "banknote",        roles: ["owner", "manager", "staff_operator"] },
  { key: "safe",      label: "Sổ quỹ",        icon: "piggyBank",       roles: ["owner"] },
  { key: "handover",  label: "Bàn giao",      icon: "clipboardList",   roles: ["owner", "manager", "staff_operator"] },
  { key: "inventory", label: "Kho",           icon: "package",         roles: ["owner", "manager", "staff_operator"] },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"] },
  { key: "pivot",     label: "Pivot",         icon: "barChart3",       roles: ["owner", "manager"] },
  { key: "cashflow",  label: "Dòng tiền",     icon: "trendingUp",      roles: ["owner", "manager"] },
  { key: "settings",  label: "Thiết lập",     icon: "settings",        roles: ["owner", "manager"] },
];

export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "handover", "inventory", "reports", "pivot", "cashflow", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports", "pivot", "cashflow", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports"],
  employee_viewer: ["dashboard"],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Chủ quán",
  manager: "Quản lý",
  staff_operator: "Nhân viên vận hành",
  employee_viewer: "Viewer",
};

export function hasBasePageAccess(role: UserRole, key: ViewKey): boolean {
  return Boolean(NAV_ITEMS.find((item) => item.key === key)?.roles.includes(role));
}

export function normalizeSidebarItems(
  role: UserRole,
  items?: ReadonlyArray<string> | null
): ViewKey[] {
  const source: ReadonlyArray<string> = items?.length ? items : DEFAULT_SIDEBAR_BY_ROLE[role];
  return source.filter((key): key is ViewKey =>
    NAV_ITEMS.some((item) => item.key === key && hasBasePageAccess(role, key as ViewKey))
  );
}

export function getVisibleNav(
  account: Account | null,
  settings: AppSettings
): ReadonlyArray<NavItem> {
  if (!account) return [];
  const configured =
    account.sidebar_config ??
    settings.sidebar_defaults?.[account.role] ??
    DEFAULT_SIDEBAR_BY_ROLE[account.role];
  const keys = normalizeSidebarItems(account.role, configured);
  return NAV_ITEMS.filter((item) => keys.includes(item.key));
}

export function canSee(
  account: Account | null,
  key: ViewKey,
  settings: AppSettings
): boolean {
  return getVisibleNav(account, settings).some((item) => item.key === key);
}
