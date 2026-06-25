import { describe, it, expect } from "vitest";
import { assertCanAssignRole, assertCanModifyTarget } from "@/lib/supabase/server";
describe("assertCanAssignRole", () => {
  it("manager cannot grant owner", () => { expect(() => assertCanAssignRole("manager", "owner")).toThrow(); });
  it("staff_operator cannot grant owner", () => { expect(() => assertCanAssignRole("staff_operator", "owner")).toThrow(); });
  it("owner can grant owner", () => { expect(() => assertCanAssignRole("owner", "owner")).not.toThrow(); });
  it("manager can grant non-owner roles", () => {
    expect(() => assertCanAssignRole("manager", "staff_operator")).not.toThrow();
    expect(() => assertCanAssignRole("manager", "employee_self_service")).not.toThrow();
  });
});
describe("assertCanModifyTarget", () => {
  it("manager cannot modify an owner account", () => { expect(() => assertCanModifyTarget("manager", "owner")).toThrow(); });
  it("owner can modify an owner account", () => { expect(() => assertCanModifyTarget("owner", "owner")).not.toThrow(); });
  it("manager can modify a non-owner account", () => { expect(() => assertCanModifyTarget("manager", "staff_operator")).not.toThrow(); });
});
