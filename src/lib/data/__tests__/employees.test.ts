import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadEmployees } from "../employees";

function makeSb() {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return { sb: { from: vi.fn(() => builder) } as unknown as SupabaseClient, builder };
}

describe("loadEmployees", () => {
  it("mặc định lọc is_active=true", async () => {
    const { sb, builder } = makeSb();
    await loadEmployees(sb);
    expect(builder.eq).toHaveBeenCalledWith("is_active", true);
  });
  it("includeInactive=true → KHÔNG gọi .eq(is_active)", async () => {
    const { sb, builder } = makeSb();
    await loadEmployees(sb, true);
    expect(builder.eq).not.toHaveBeenCalled();
  });
});
