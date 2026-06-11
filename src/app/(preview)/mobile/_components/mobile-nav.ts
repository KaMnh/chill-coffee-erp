import type { ViewKey } from "@/features/navigation/navigation";
import type { IconName } from "@/components/ui/icons";
import type { PreviewRole } from "../_mock/data";

/**
 * Nav model mobile (chốt trong spec 2026-06-11-mobile-uiux-design.md):
 * 4 tab trong tầm ngón cái + tab "Thêm" mở drawer. Role-aware:
 *   - Nhân viên: nhóm vận hành lên trước (Chốt két / Chi phí / Bàn giao).
 *   - Chủ quán: Sổ quỹ / Báo cáo nổi hơn.
 * Nguồn label + icon: NAV_ITEMS trong src/features/navigation/navigation.ts.
 */

export interface MobileNavItem {
  key: ViewKey;
  label: string;
  /** Label ngắn cho tab bar (≤8 ký tự cho 5 tab ở 375px). */
  short: string;
  icon: IconName;
}

const ITEM: Record<ViewKey, MobileNavItem> = {
  dashboard: { key: "dashboard", label: "Bảng vận hành", short: "Trang chủ", icon: "layoutDashboard" },
  cash:      { key: "cash",      label: "Chốt két",      short: "Chốt két",  icon: "banknote" },
  expenses:  { key: "expenses",  label: "Chi phí",       short: "Chi phí",   icon: "wallet" },
  handover:  { key: "handover",  label: "Bàn giao",      short: "Bàn giao",  icon: "clipboardList" },
  shifts:    { key: "shifts",    label: "Ca & lương",    short: "Ca & lương", icon: "users" },
  safe:      { key: "safe",      label: "Sổ quỹ",        short: "Sổ quỹ",    icon: "piggyBank" },
  inventory: { key: "inventory", label: "Kho",           short: "Kho",       icon: "package" },
  reports:   { key: "reports",   label: "Báo cáo chốt két", short: "Báo cáo", icon: "fileText" },
  pivot:     { key: "pivot",     label: "Pivot",         short: "Pivot",     icon: "barChart3" },
  cashflow:  { key: "cashflow",  label: "Dòng tiền",     short: "Dòng tiền", icon: "trendingUp" },
  settings:  { key: "settings",  label: "Thiết lập",     short: "Thiết lập", icon: "settings" },
};

// Feedback owner 2026-06-11: Bàn giao ít dùng nhất → KHÔNG đặt ở bottom bar,
// chuyển vào drawer; thay bằng Ca & lương (ra/vào ca là thao tác hằng ngày).
export const TABS_BY_ROLE: Record<PreviewRole, MobileNavItem[]> = {
  staff: [ITEM.dashboard, ITEM.cash, ITEM.expenses, ITEM.shifts],
  owner: [ITEM.dashboard, ITEM.safe, ITEM.reports, ITEM.cash],
};

export interface DrawerGroup {
  label: string;
  items: MobileNavItem[];
}

export const DRAWER_BY_ROLE: Record<PreviewRole, DrawerGroup[]> = {
  staff: [
    { label: "Nhân sự & Ca", items: [ITEM.handover] },
    { label: "Kho hàng", items: [ITEM.inventory] },
    { label: "Báo cáo", items: [ITEM.reports] },
  ],
  owner: [
    { label: "Tổng quan", items: [ITEM.cashflow] },
    { label: "Thu – Chi – Quỹ", items: [ITEM.expenses] },
    { label: "Nhân sự & Ca", items: [ITEM.handover, ITEM.shifts] },
    { label: "Kho hàng", items: [ITEM.inventory] },
    { label: "Báo cáo", items: [ITEM.pivot] },
    { label: "Hệ thống", items: [ITEM.settings] },
  ],
};

export const VIEW_TITLES: Record<ViewKey, string> = {
  dashboard: "Bảng vận hành",
  cash: "Chốt két",
  expenses: "Chi phí",
  handover: "Bàn giao",
  shifts: "Ca & lương",
  safe: "Sổ quỹ",
  inventory: "Kho",
  reports: "Báo cáo",
  pivot: "Pivot",
  cashflow: "Dòng tiền",
  settings: "Thiết lập",
};

/** View khả dụng theo role (mirror DEFAULT_SIDEBAR_BY_ROLE cho 2 role preview). */
export function visibleViews(role: PreviewRole): ViewKey[] {
  return role === "owner"
    ? ["dashboard", "safe", "reports", "cash", "cashflow", "expenses", "handover", "shifts", "inventory", "pivot", "settings"]
    : ["dashboard", "cash", "expenses", "handover", "shifts", "inventory", "reports"];
}
