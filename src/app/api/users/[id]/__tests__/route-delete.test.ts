import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const empUpdatePayloads: unknown[] = [];
const rpc = vi.fn(async () => { calls.push("rpc"); return { data: { cancelled_count: 1 }, error: null }; });
function tableMock(name: string) {
  return {
    update: vi.fn((payload: unknown) => {
      calls.push(`${name}.update`);
      if (name === "employees") empUpdatePayloads.push(payload);
      return { eq: vi.fn(async () => ({ error: null })) };
    }),
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: { role: "staff_operator", employee_id: "emp-1" } }) })) })),
  };
}
vi.mock("@/lib/supabase/server", () => ({
  requireAuth: vi.fn(async () => ({ userId: "owner-auth", role: "owner" })),
  assertCanModifyTarget: vi.fn(),
  assertCanAssignRole: vi.fn(),
  getServiceRoleClient: () => ({ rpc, from: (n: string) => tableMock(n) }),
}));

beforeEach(() => { calls.length = 0; empUpdatePayloads.length = 0; rpc.mockClear(); });

describe("DELETE /api/users/[id]", () => {
  it("huỷ ca mở (rpc) TRƯỚC mọi mutation (account disable + is_active=false)", async () => {
    const { DELETE } = await import("../route");
    const req = { headers: { get: () => "Bearer x" } } as never;
    const res = await DELETE(req, { params: Promise.resolve({ id: "owner-auth" }) });
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("cancel_open_shifts_for_employee", {
      p_employee_id: "emp-1", p_reason: "Huỷ do xoá tài khoản", p_actor: "owner-auth",
    });
    // RPC đứng đầu — trước cả account disable lẫn employees.update.
    expect(calls.indexOf("rpc")).toBe(0);
    expect(calls.indexOf("rpc")).toBeLessThan(calls.indexOf("employee_accounts.update"));
    expect(calls.indexOf("rpc")).toBeLessThan(calls.indexOf("employees.update"));
    expect(empUpdatePayloads).toContainEqual({ is_active: false });
  });
});
