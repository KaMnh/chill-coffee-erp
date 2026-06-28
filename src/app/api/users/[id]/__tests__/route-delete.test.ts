import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
const empUpdatePayloads: unknown[] = [];
// Per-test configurable RPC result: default success; a test can set an error to
// assert the early-return safety property (no mutation when RPC fails).
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: { cancelled_count: 1 },
  error: null,
};
const rpc = vi.fn(async () => { calls.push("rpc"); return rpcResult; });
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

beforeEach(() => {
  calls.length = 0;
  empUpdatePayloads.length = 0;
  rpc.mockClear();
  rpcResult = { data: { cancelled_count: 1 }, error: null };
});

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

  it("RPC huỷ ca lỗi → return 500, KHÔNG mutation nào chạy", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    const { DELETE } = await import("../route");
    const req = { headers: { get: () => "Bearer x" } } as never;
    const res = await DELETE(req, { params: Promise.resolve({ id: "owner-auth" }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Không dọn được ca mở");
    // Safety property: lỗi RPC → KHÔNG disable account, KHÔNG vô hiệu NV.
    expect(calls).not.toContain("employee_accounts.update");
    expect(calls).not.toContain("employees.update");
  });
});
