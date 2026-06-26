import type { Account, AppSettings, UserRole } from "@/lib/types";
import type { IconName } from "@/components/ui/icons";

export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe" | "period-close"
  | "handover" | "inventory"
  | "reports" | "pivot" | "cashflow" | "settings"
  | "checkin";

export type NavGroupKey =
  | "overview" | "cashflow" | "staff" | "inventory" | "reports" | "system";

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: IconName;
  roles: ReadonlyArray<UserRole>;
  group: NavGroupKey;
}

/**
 * Nav matrix ported verbatim from v3 src/features/navigation.ts.
 * 4 roles × 8 views. Vietnamese labels preserved.
 */
export const NAV_ITEMS: ReadonlyArray<NavItem> = [
  { key: "dashboard", label: "Bảng vận hành", icon: "layoutDashboard", roles: ["owner", "manager", "staff_operator", "employee_viewer"], group: "overview" },
  { key: "expenses",  label: "Chi phí",       icon: "wallet",          roles: ["owner", "manager", "staff_operator"], group: "cashflow" },
  { key: "shifts",    label: "Ca & lương",    icon: "users",           roles: ["owner", "manager", "staff_operator"], group: "staff" },
  { key: "cash",      label: "Chốt két",      icon: "banknote",        roles: ["owner", "manager", "staff_operator"], group: "cashflow" },
  { key: "safe",      label: "Sổ quỹ",        icon: "piggyBank",       roles: ["owner"], group: "cashflow" },
  { key: "period-close", label: "Kết toán kỳ", icon: "handCoins",      roles: ["owner"], group: "cashflow" },
  { key: "handover",  label: "Bàn giao",      icon: "clipboardList",   roles: ["owner", "manager", "staff_operator"], group: "staff" },
  { key: "inventory", label: "Kho",           icon: "package",         roles: ["owner", "manager", "staff_operator"], group: "inventory" },
  { key: "reports",   label: "Báo cáo chốt két", icon: "fileText",     roles: ["owner", "manager", "staff_operator"], group: "reports" },
  { key: "pivot",     label: "Pivot",         icon: "barChart3",       roles: ["owner", "manager"], group: "reports" },
  { key: "cashflow",  label: "Dòng tiền",     icon: "trendingUp",      roles: ["owner", "manager"], group: "overview" },
  { key: "settings",  label: "Thiết lập",     icon: "settings",        roles: ["owner", "manager"], group: "system" },
  { key: "checkin",   label: "Chấm công",     icon: "clock",           roles: ["employee_self_service"], group: "staff" },
];

export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:                 ["dashboard", "expenses", "shifts", "cash", "safe", "period-close", "handover", "inventory", "reports", "pivot", "cashflow", "settings"],
  manager:               ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports", "pivot", "cashflow", "settings"],
  staff_operator:        ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports"],
  employee_viewer:       ["dashboard"],
  employee_self_service: ["checkin"],
};

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: "Chủ quán",
  manager: "Quản lý",
  staff_operator: "Nhân viên vận hành",
  employee_viewer: "Viewer",
  employee_self_service: "Nhân viên",
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

export interface NavGroup {
  key: NavGroupKey;
  label: string;
}

// Thứ tự nhóm cố định — render theo đúng thứ tự mảng này.
export const NAV_GROUPS: ReadonlyArray<NavGroup> = [
  { key: "overview",  label: "Tổng quan" },
  { key: "cashflow",  label: "Thu – Chi – Quỹ" },
  { key: "staff",     label: "Nhân sự & Ca" },
  { key: "inventory", label: "Kho hàng" },
  { key: "reports",   label: "Báo cáo" },
  { key: "system",    label: "Thiết lập" },
];

export interface NavGroupWithItems extends NavGroup {
  items: ReadonlyArray<NavItem>;
}

/**
 * Partition the role-visible nav into the fixed functional groups (in
 * NAV_GROUPS order). Reuses getVisibleNav, so in-group order follows the
 * canonical NAV_ITEMS order. Empty groups are dropped.
 */
export function getGroupedNav(
  account: Account | null,
  settings: AppSettings
): ReadonlyArray<NavGroupWithItems> {
  const visible = getVisibleNav(account, settings);
  return NAV_GROUPS
    .map((group) => ({
      ...group,
      items: visible.filter((item) => item.group === group.key),
    }))
    .filter((group) => group.items.length > 0);
}

/* ===== Mobile bottom tab bar (spec 2026-06-11-mobile-uiux-design §1) =====
 * 4 tab trong tầm ngón cái + tab "Thêm" mở drawer. Role-aware: nhân viên
 * thấy nhóm vận hành lên trước; chủ thấy Sổ quỹ / Báo cáo nổi hơn.
 * Bàn giao KHÔNG vào tab mặc định (feedback owner 2026-06-11 — ít dùng nhất).
 * Danh sách là PREFERENCE đầy đủ: khi sidebar_config ẩn một view ưu tiên,
 * tab backfill ứng viên kế tiếp để vẫn đủ 4 tab.
 */
const MOBILE_TAB_PREFERENCE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:                 ["dashboard", "safe", "reports", "cash", "cashflow", "period-close", "expenses", "shifts", "inventory", "pivot", "settings", "handover"],
  manager:               ["dashboard", "expenses", "reports", "cash", "cashflow", "shifts", "inventory", "pivot", "settings", "handover"],
  staff_operator:        ["dashboard", "cash", "expenses", "shifts", "inventory", "reports", "handover"],
  employee_viewer:       ["dashboard"],
  employee_self_service: ["checkin"],
};

export const MOBILE_TAB_COUNT = 4;

/**
 * 4 tab bottom bar. Ưu tiên tuỳ chỉnh per-user
 * (profiles.dashboard_preferences.mobile_tabs — user tự chọn qua drawer
 * "Thêm" → "Tuỳ chỉnh tab"); key rác / view không được thấy bị lọc bỏ,
 * dedupe, cắt còn 4. Không có (hoặc lọc xong rỗng) → preference theo role.
 */
export function getMobileTabs(
  account: Account | null,
  settings: AppSettings
): ReadonlyArray<NavItem> {
  if (!account) return [];
  const visible = getVisibleNav(account, settings);
  const byKey = new Map(visible.map((item) => [item.key, item]));

  const custom = account.dashboard_preferences?.mobile_tabs;
  if (Array.isArray(custom) && custom.length > 0) {
    const customTabs = [...new Set(custom)]
      .map((key) => byKey.get(key as ViewKey))
      .filter((item): item is NavItem => Boolean(item))
      .slice(0, MOBILE_TAB_COUNT);
    if (customTabs.length > 0) return customTabs;
  }

  return MOBILE_TAB_PREFERENCE[account.role]
    .map((key) => byKey.get(key))
    .filter((item): item is NavItem => Boolean(item))
    .slice(0, MOBILE_TAB_COUNT);
}

/** Drawer "Thêm": phần visible còn lại ngoài tabs, nhóm theo NAV_GROUPS. */
export function getMobileDrawerGroups(
  account: Account | null,
  settings: AppSettings
): ReadonlyArray<NavGroupWithItems> {
  const tabKeys = new Set(getMobileTabs(account, settings).map((t) => t.key));
  return getGroupedNav(account, settings)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !tabKeys.has(item.key)),
    }))
    .filter((group) => group.items.length > 0);
}
