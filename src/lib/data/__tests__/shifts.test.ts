import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadOpenShifts, cancelShiftAssignment } from "../shifts";

function mockFrom(rows: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: rows, error: null }),
  };
  return { from: vi.fn(() => builder), _builder: builder } as unknown as SupabaseClient & {
    _builder: typeof builder;
  };
}

describe("loadOpenShifts", () => {
  it("lọc status=checked_in, KHÔNG lọc business_date, map employee_name", async () => {
    const sb = mockFrom([
      { id: "s1", employee_id: "e1", business_date: "2026-06-10", check_in_at: "x",
        check_out_at: null, total_minutes: null, status: "checked_in",
        employees: { name: "An", position: "Pha chế", is_active: false } },
    ]);
    const out = await loadOpenShifts(sb);
    expect(sb.from).toHaveBeenCalledWith("shift_assignments");
    expect((sb as never as { _builder: { eq: ReturnType<typeof vi.fn> } })._builder.eq)
      .toHaveBeenCalledWith("status", "checked_in");
    expect(out[0].employee_name).toBe("An");
    expect(out[0].employee_is_active).toBe(false);
  });

  it("join hụt → employee_name null", async () => {
    const sb = mockFrom([
      { id: "s2", employee_id: "e2", business_date: "2026-06-10", check_in_at: "x",
        check_out_at: null, total_minutes: null, status: "checked_in", employees: null },
    ]);
    const out = await loadOpenShifts(sb);
    expect(out[0].employee_name).toBeNull();
  });
});

describe("cancelShiftAssignment", () => {
  it("gọi RPC cancel_shift_assignment với p_shift_id + p_reason", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "cancelled" }, error: null });
    const sb = { rpc } as unknown as SupabaseClient;
    await cancelShiftAssignment(sb, "s1", "lý do");
    expect(rpc).toHaveBeenCalledWith("cancel_shift_assignment", { p_shift_id: "s1", p_reason: "lý do" });
  });

  it("RPC lỗi → throw", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "denied" } });
    const sb = { rpc } as unknown as SupabaseClient;
    await expect(cancelShiftAssignment(sb, "s1", "x")).rejects.toThrow();
  });
});
