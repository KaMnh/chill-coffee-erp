import { describe, it, expect } from "vitest";
import { computeSyncRange, subtractDays, clampWindowDays } from "../sync-range";

describe("subtractDays", () => {
  it("subtracts across month/year boundaries (tz-independent)", () => {
    expect(subtractDays("2026-05-01", 1)).toBe("2026-04-30");
    expect(subtractDays("2026-03-01", 1)).toBe("2026-02-28");
    expect(subtractDays("2026-01-01", 1)).toBe("2025-12-31");
    expect(subtractDays("2026-05-29", 6)).toBe("2026-05-23");
    expect(subtractDays("2026-05-29", 0)).toBe("2026-05-29");
  });
});

describe("clampWindowDays", () => {
  it("clamps to 1..31 and floors fractionals", () => {
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(1)).toBe(1);
    expect(clampWindowDays(7)).toBe(7);
    expect(clampWindowDays(31)).toBe(31);
    expect(clampWindowDays(99)).toBe(31);
    expect(clampWindowDays(3.9)).toBe(3);
    expect(clampWindowDays(undefined)).toBe(1);
    expect(clampWindowDays(Number.NaN)).toBe(1);
  });
});

describe("computeSyncRange", () => {
  const today = "2026-05-29";

  it("single day when window not applied (even if N=7)", () => {
    expect(computeSyncRange({ anchorDate: "2026-05-15", applyWindow: false, windowDays: 7, today }))
      .toEqual({ from: "2026-05-15", to: "2026-05-15", mode: "single" });
  });

  it("single day when applyWindow but N=1", () => {
    expect(computeSyncRange({ anchorDate: "2026-05-15", applyWindow: true, windowDays: 1, today }))
      .toEqual({ from: "2026-05-15", to: "2026-05-15", mode: "single" });
  });

  it("windowed N=7 ends at anchor, extends back N-1", () => {
    expect(computeSyncRange({ anchorDate: "2026-05-29", applyWindow: true, windowDays: 7, today }))
      .toEqual({ from: "2026-05-23", to: "2026-05-29", mode: "window" });
  });

  it("falls back to today when no anchor", () => {
    expect(computeSyncRange({ applyWindow: false, today }))
      .toEqual({ from: "2026-05-29", to: "2026-05-29", mode: "single" });
  });

  it("range mode passes explicit from/to through", () => {
    expect(computeSyncRange({ fromDate: "2026-05-01", toDate: "2026-05-10", today }))
      .toEqual({ from: "2026-05-01", to: "2026-05-10", mode: "range" });
  });

  it("range mode normalizes inverted from/to", () => {
    expect(computeSyncRange({ fromDate: "2026-05-10", toDate: "2026-05-01", today }))
      .toEqual({ from: "2026-05-01", to: "2026-05-10", mode: "range" });
  });

  it("ignores a partial range (only fromDate) → window/single path", () => {
    expect(computeSyncRange({ fromDate: "2026-05-01", anchorDate: "2026-05-29", applyWindow: false, today }))
      .toEqual({ from: "2026-05-29", to: "2026-05-29", mode: "single" });
  });

  it("clamps oversized window", () => {
    const r = computeSyncRange({ anchorDate: "2026-05-29", applyWindow: true, windowDays: 999, today });
    expect(r).toEqual({ from: subtractDays("2026-05-29", 30), to: "2026-05-29", mode: "window" });
  });
});
