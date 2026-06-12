import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadPeriodClosePreview,
  loadPeriodCloses,
  finalizePeriodClose,
  voidPeriodClose,
} from "../period-close";

function mockRpc(result: { data?: unknown; error?: { message: string } | null }) {
  return {
    rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })),
  } as unknown as SupabaseClient;
}

describe("period-close data layer", () => {
  it("preview gọi đúng RPC và trả object", async () => {
    const sb = mockRpc({ data: { period_start: "2026-06-01", profit: 5 } });
    const out = await loadPeriodClosePreview(sb);
    expect(out.period_start).toBe("2026-06-01");
    expect(sb.rpc).toHaveBeenCalledWith("period_close_preview");
  });

  it("list trả [] khi data null", async () => {
    const sb = mockRpc({ data: null });
    expect(await loadPeriodCloses(sb)).toEqual([]);
  });

  it("finalize map đúng tham số p_*", async () => {
    const sb = mockRpc({ data: { id: "x", draw_total: 100 } });
    await finalizePeriodClose(sb, { closeDate: "2026-06-12", drawCash: 70, drawTransfer: 30 });
    expect(sb.rpc).toHaveBeenCalledWith("finalize_period_close", {
      p_close_date: "2026-06-12",
      p_draw_cash: 70,
      p_draw_transfer: 30,
      p_note: null,
    });
  });

  it("lỗi RPC → throw với message fallback", async () => {
    const sb = mockRpc({ error: { message: "boom" } });
    await expect(
      voidPeriodClose(sb, { id: "x", reason: "huỷ thử nghiệm" })
    ).rejects.toThrow();
  });
});
