import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadIngredientReferencePrices,
  upsertIngredientReferencePrice,
  deleteIngredientReferencePrice,
} from "../ingredient-prices";

/** Mock chainable Supabase: mọi method trả chain, await chain resolve kết quả. */
function mockSupabase(result: { data?: unknown; error?: { message: string } | null }) {
  const terminal = Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "upsert", "delete", "eq", "order"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = terminal.then.bind(terminal);
  chain.catch = terminal.catch.bind(terminal);
  return chain as unknown as SupabaseClient;
}

describe("ingredient-prices data layer", () => {
  it("load trả Map ingredient_id → row", async () => {
    const sb = mockSupabase({
      data: [{ ingredient_id: "i1", unit_price: 200000, updated_at: "2026-06-12T00:00:00Z" }],
    });
    const map = await loadIngredientReferencePrices(sb);
    expect(map.get("i1")?.unit_price).toBe(200000);
    expect(map.size).toBe(1);
  });

  it("load data null → Map rỗng", async () => {
    const sb = mockSupabase({ data: null });
    const map = await loadIngredientReferencePrices(sb);
    expect(map.size).toBe(0);
  });

  it("load lỗi → throw Error có message", async () => {
    const sb = mockSupabase({ error: { message: "boom" } });
    await expect(loadIngredientReferencePrices(sb)).rejects.toThrow("boom");
  });

  it("upsert resolve khi không lỗi", async () => {
    const sb = mockSupabase({ data: null });
    await expect(upsertIngredientReferencePrice(sb, "i1", 150000)).resolves.toBeUndefined();
  });

  it("upsert lỗi → throw", async () => {
    const sb = mockSupabase({ error: { message: "denied" } });
    await expect(upsertIngredientReferencePrice(sb, "i1", 150000)).rejects.toThrow();
  });

  it("delete resolve khi không lỗi", async () => {
    const sb = mockSupabase({ data: null });
    await expect(deleteIngredientReferencePrice(sb, "i1")).resolves.toBeUndefined();
  });

  it("delete lỗi → throw", async () => {
    const sb = mockSupabase({ error: { message: "denied" } });
    await expect(deleteIngredientReferencePrice(sb, "i1")).rejects.toThrow();
  });
});
