import { describe, it, expect } from "vitest";
import type { Account, AppSettings, UserRole } from "@/lib/types";
import {
  getGroupedNav,
  getMobileTabs,
  getMobileDrawerGroups,
  NAV_GROUPS,
} from "../navigation";

const SETTINGS: AppSettings = { sidebar_defaults: {}, handover_default_tasks: [] };

function makeAccount(role: UserRole, sidebar_config: string[] | null = null): Account {
  return { id: "a1", auth_user_id: "u1", employee_id: null, role, status: "active", sidebar_config };
}

function withMobileTabs(account: Account, mobile_tabs: string[] | null): Account {
  return { ...account, dashboard_preferences: { mobile_tabs } };
}

describe("getGroupedNav", () => {
  it("owner mặc định → đủ 6 nhóm, đúng thứ tự NAV_GROUPS", () => {
    const groups = getGroupedNav(makeAccount("owner"), SETTINGS);
    expect(groups).toHaveLength(6);
    expect(groups.map((g) => g.key)).toEqual(NAV_GROUPS.map((g) => g.key));
  });

  it("nhóm đúng item + thứ tự trong nhóm theo NAV_ITEMS", () => {
    const groups = getGroupedNav(makeAccount("owner"), SETTINGS);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.key)]));
    expect(byKey.overview).toEqual(["dashboard", "cashflow"]);
    expect(byKey.cashflow).toEqual(["expenses", "cash", "safe", "period-close"]);
    expect(byKey.staff).toEqual(["shifts", "handover"]);
    expect(byKey.inventory).toEqual(["inventory"]);
    expect(byKey.reports).toEqual(["reports", "pivot"]);
    expect(byKey.system).toEqual(["settings"]);
  });

  it("view `cashflow` (Dòng tiền) ở nhóm overview, KHÔNG ở nhóm tên cashflow", () => {
    const groups = getGroupedNav(makeAccount("owner"), SETTINGS);
    const overview = groups.find((g) => g.key === "overview")!;
    const cashflowGroup = groups.find((g) => g.key === "cashflow")!;
    expect(overview.items.map((i) => i.key)).toContain("cashflow");
    expect(cashflowGroup.items.map((i) => i.key)).not.toContain("cashflow");
  });

  it("ẩn nhóm rỗng: employee_viewer (chỉ dashboard) → đúng 1 nhóm overview", () => {
    const groups = getGroupedNav(makeAccount("employee_viewer"), SETTINGS);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("overview");
    expect(groups[0].items.map((i) => i.key)).toEqual(["dashboard"]);
  });

  it("thứ tự trong nhóm theo NAV_ITEMS + lọc theo sidebar_config", () => {
    // config: đảo safe trước cash VÀ bỏ expenses → chứng minh cả (a) thứ tự theo
    // NAV_ITEMS (cash trước safe dù config liệt kê safe trước) lẫn (b) filter
    // (expenses không có trong config nên bị loại khỏi nhóm). Một impl bỏ qua
    // sidebar_config (trả default owner) sẽ ra [expenses, cash, safe] → fail.
    const acc = makeAccount("owner", ["dashboard", "safe", "cash"]);
    const cashflow = getGroupedNav(acc, SETTINGS).find((g) => g.key === "cashflow")!;
    expect(cashflow.items.map((i) => i.key)).toEqual(["cash", "safe"]);
  });
});

describe("getMobileTabs (bottom tab bar — spec 2026-06-11-mobile-uiux-design)", () => {
  it("owner mặc định → Trang chủ · Sổ quỹ · Báo cáo · Chốt két", () => {
    const tabs = getMobileTabs(makeAccount("owner"), SETTINGS);
    expect(tabs.map((t) => t.key)).toEqual(["dashboard", "safe", "reports", "cash"]);
  });

  it("staff_operator mặc định → Trang chủ · Chốt két · Chi phí · Ca & lương", () => {
    const tabs = getMobileTabs(makeAccount("staff_operator"), SETTINGS);
    expect(tabs.map((t) => t.key)).toEqual(["dashboard", "cash", "expenses", "shifts"]);
  });

  it("manager mặc định → như owner nhưng Sổ quỹ thay bằng Chi phí", () => {
    const tabs = getMobileTabs(makeAccount("manager"), SETTINGS);
    expect(tabs.map((t) => t.key)).toEqual(["dashboard", "expenses", "reports", "cash"]);
  });

  it("employee_viewer → chỉ 1 tab dashboard", () => {
    const tabs = getMobileTabs(makeAccount("employee_viewer"), SETTINGS);
    expect(tabs.map((t) => t.key)).toEqual(["dashboard"]);
  });

  it("Bàn giao KHÔNG bao giờ vào tab mặc định (feedback owner 2026-06-11)", () => {
    for (const role of ["owner", "manager", "staff_operator"] as const) {
      const tabs = getMobileTabs(makeAccount(role), SETTINGS);
      expect(tabs.map((t) => t.key)).not.toContain("handover");
    }
  });

  it("mobile_tabs tuỳ chỉnh → đúng thứ tự user chọn, thay preference mặc định", () => {
    const acc = withMobileTabs(makeAccount("owner"), ["cash", "inventory", "shifts", "dashboard"]);
    const tabs = getMobileTabs(acc, SETTINGS);
    expect(tabs.map((t) => t.key)).toEqual(["cash", "inventory", "shifts", "dashboard"]);
  });

  it("mobile_tabs chứa key rác / view không được thấy → lọc bỏ, giữ phần hợp lệ", () => {
    // staff_operator không thấy safe/settings; "bogus" không tồn tại.
    const acc = withMobileTabs(makeAccount("staff_operator"), ["safe", "cash", "bogus", "inventory", "settings"]);
    const tabs = getMobileTabs(acc, SETTINGS);
    expect(tabs.map((t) => t.key)).toEqual(["cash", "inventory"]);
  });

  it("mobile_tabs quá 4 → cắt còn 4; trùng lặp → dedupe", () => {
    const acc = withMobileTabs(makeAccount("owner"), ["cash", "cash", "safe", "reports", "shifts", "inventory"]);
    const tabs = getMobileTabs(acc, SETTINGS);
    expect(tabs.map((t) => t.key)).toEqual(["cash", "safe", "reports", "shifts"]);
  });

  it("mobile_tabs toàn key không hợp lệ / rỗng / null → fallback preference role", () => {
    const fallback = ["dashboard", "safe", "reports", "cash"];
    for (const bad of [["bogus", "nope"], [], null] as Array<string[] | null>) {
      const acc = withMobileTabs(makeAccount("owner"), bad);
      expect(getMobileTabs(acc, SETTINGS).map((t) => t.key)).toEqual(fallback);
    }
  });

  it("drawer loại trừ đúng các tab tuỳ chỉnh (không trùng, gộp đủ visible)", () => {
    const acc = withMobileTabs(makeAccount("owner"), ["cash", "inventory", "shifts", "dashboard"]);
    const tabKeys = getMobileTabs(acc, SETTINGS).map((t) => t.key);
    const drawerKeys = getMobileDrawerGroups(acc, SETTINGS).flatMap((g) => g.items.map((i) => i.key));
    expect(tabKeys.filter((k) => drawerKeys.includes(k))).toEqual([]);
    expect(drawerKeys).toContain("safe");
    expect(drawerKeys).toContain("reports");
    expect([...tabKeys, ...drawerKeys].sort()).toEqual(
      ["dashboard", "expenses", "shifts", "cash", "safe", "period-close", "handover", "inventory", "reports", "pivot", "cashflow", "settings"].sort()
    );
  });

  it("sidebar_config ẩn view ưu tiên → backfill tab kế tiếp theo preference", () => {
    // Owner ẩn safe → tab thứ 2 nhảy sang ứng viên kế (reports), đủ 4 tab.
    const acc = makeAccount("owner", [
      "dashboard", "expenses", "shifts", "cash", "handover",
      "inventory", "reports", "pivot", "cashflow", "settings",
    ]);
    const tabs = getMobileTabs(acc, SETTINGS);
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.key)).not.toContain("safe");
    expect(tabs.map((t) => t.key)).toEqual(["dashboard", "reports", "cash", "cashflow"]);
  });
});

describe("getMobileDrawerGroups (drawer 'Thêm')", () => {
  it("owner mặc định: phần còn lại ngoài tabs, nhóm theo NAV_GROUPS, đúng thứ tự", () => {
    const groups = getMobileDrawerGroups(makeAccount("owner"), SETTINGS);
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g.items.map((i) => i.key)]));
    expect(groups.map((g) => g.key)).toEqual(["overview", "cashflow", "staff", "inventory", "reports", "system"]);
    expect(byKey.overview).toEqual(["cashflow"]);
    expect(byKey.cashflow).toEqual(["expenses", "period-close"]);
    expect(byKey.staff).toEqual(["shifts", "handover"]);
    expect(byKey.inventory).toEqual(["inventory"]);
    expect(byKey.reports).toEqual(["pivot"]);
    expect(byKey.system).toEqual(["settings"]);
  });

  it("staff_operator mặc định: Bàn giao + Kho + Báo cáo", () => {
    const groups = getMobileDrawerGroups(makeAccount("staff_operator"), SETTINGS);
    const flat = groups.flatMap((g) => g.items.map((i) => i.key));
    expect(flat).toEqual(["handover", "inventory", "reports"]);
  });

  it("tabs và drawer không trùng nhau, gộp lại = đúng visible nav", () => {
    const acc = makeAccount("owner");
    const tabKeys = getMobileTabs(acc, SETTINGS).map((t) => t.key);
    const drawerKeys = getMobileDrawerGroups(acc, SETTINGS).flatMap((g) => g.items.map((i) => i.key));
    expect(tabKeys.filter((k) => drawerKeys.includes(k))).toEqual([]);
    expect([...tabKeys, ...drawerKeys].sort()).toEqual(
      ["dashboard", "expenses", "shifts", "cash", "safe", "period-close", "handover", "inventory", "reports", "pivot", "cashflow", "settings"].sort()
    );
  });

  it("employee_viewer → drawer rỗng (dashboard đã ở tab)", () => {
    expect(getMobileDrawerGroups(makeAccount("employee_viewer"), SETTINGS)).toEqual([]);
  });
});
