import { describe, it, expect } from "vitest";
import type { Account, AppSettings, UserRole } from "@/lib/types";
import { getGroupedNav, NAV_GROUPS } from "../navigation";

const SETTINGS: AppSettings = { sidebar_defaults: {}, handover_default_tasks: [] };

function makeAccount(role: UserRole, sidebar_config: string[] | null = null): Account {
  return { id: "a1", auth_user_id: "u1", employee_id: null, role, status: "active", sidebar_config };
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
    expect(byKey.cashflow).toEqual(["expenses", "cash", "safe"]);
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
