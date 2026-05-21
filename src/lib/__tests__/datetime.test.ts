import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toDatetimeLocal, fromDatetimeLocal, todayInVN } from "../datetime";

/**
 * Datetime helpers — characterization tests.
 *
 * The critical test here is `todayInVN` at the 17:00 UTC boundary
 * (= midnight VN). This is the exact bug `todayInVN` was introduced
 * to fix vs the deprecated `todayIso` in format.ts.
 *
 * TZ pinned to Asia/Ho_Chi_Minh via vitest.config.mts test.env.TZ, so
 * `new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })`
 * is deterministic.
 */

describe("toDatetimeLocal", () => {
  it("returns empty string for null", () => {
    expect(toDatetimeLocal(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(toDatetimeLocal(undefined)).toBe("");
  });

  it("converts UTC ISO to VN wall-clock (UTC+7) and slices to 16 chars", () => {
    // 15:47 UTC + 7h = 22:47 VN, same day.
    // Note: the helper reads SYSTEM TZ via date.getTimezoneOffset() — this
    // test only works because vitest.config.mts pins env.TZ = Asia/Ho_Chi_Minh
    // in the worker process. Without that pin, a UTC machine would return
    // -420 → 0 and the result would be "2026-05-04T15:47" (no shift).
    // The arithmetic: getTimezoneOffset() = minutes WEST of UTC = -420 for
    // VN (+7). new Date(time - (-420)*60000) = time + 420 min = VN wall-clock.
    const result = toDatetimeLocal("2026-05-04T15:47:00.000Z");
    expect(result).toBe("2026-05-04T22:47");
  });
});

describe("fromDatetimeLocal", () => {
  it("returns null for empty string", () => {
    expect(fromDatetimeLocal("")).toBeNull();
  });

  it("passes through a valid datetime-local string unchanged", () => {
    expect(fromDatetimeLocal("2026-05-04T05:30")).toBe("2026-05-04T05:30");
  });

  it("passes whitespace through unchanged (non-empty string is truthy)", () => {
    // " " is truthy in JS, so the helper's `value || null` returns " " unchanged.
    // This test pins that behavior. Callers (UI) strip whitespace before calling,
    // so this branch isn't load-bearing in practice — but pinning it catches any
    // future refactor that adds a .trim() inside the helper.
    expect(fromDatetimeLocal(" ")).toBe(" ");
  });
});

describe("todayInVN", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns VN date at 16:59 UTC (= 23:59 VN same day)", () => {
    vi.setSystemTime(new Date("2026-05-21T16:59:00.000Z"));
    expect(todayInVN()).toBe("2026-05-21");
  });

  it("crosses VN midnight at 17:01 UTC (= 00:01 VN next day)", () => {
    vi.setSystemTime(new Date("2026-05-21T17:01:00.000Z"));
    expect(todayInVN()).toBe("2026-05-22");
  });

  it("returns 10-char YYYY-MM-DD format", () => {
    vi.setSystemTime(new Date("2026-05-21T08:00:00.000Z"));
    const result = todayInVN();
    expect(result).toHaveLength(10);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
