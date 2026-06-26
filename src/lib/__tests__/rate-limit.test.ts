import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/lib/rate-limit";
describe("createRateLimiter", () => {
  it("allows up to max then blocks", () => {
    const rl = createRateLimiter({ max: 3, windowMs: 1000 });
    expect(rl.check("a",0).allowed).toBe(true); expect(rl.check("a",100).allowed).toBe(true);
    expect(rl.check("a",200).allowed).toBe(true);
    const b = rl.check("a",300); expect(b.allowed).toBe(false); expect(b.retryAfterMs).toBeGreaterThan(0);
  });
  it("resets after window", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.check("b",0).allowed).toBe(true); expect(rl.check("b",500).allowed).toBe(false); expect(rl.check("b",1001).allowed).toBe(true);
  });
  it("independent keys", () => {
    const rl = createRateLimiter({ max: 1, windowMs: 1000 });
    expect(rl.check("c",0).allowed).toBe(true); expect(rl.check("d",0).allowed).toBe(true); expect(rl.check("c",0).allowed).toBe(false);
  });
  it("sweep evicts stale", () => { const rl = createRateLimiter({ max:1, windowMs:1000 }); rl.check("e",0); rl.sweep(2000); expect(rl.size()).toBe(0); });
});
