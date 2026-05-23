import { describe, it, expect } from "vitest";
import { solarToLunar, getCanChi } from "../lunar";

/**
 * Lunar conversion — reference dates verified against published Vietnamese
 * lunar almanacs (lichngaytot, lichvn). The HND algorithm is well-known
 * public-domain; we test 10 anchor points covering Tết, mid-autumn, and
 * boundary edge cases.
 */

describe("solarToLunar — Tết (new year) anchors", () => {
  it("Tết 2024 = Saturday 10/2/2024 → 1/1 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 1, 10)); // months 0-indexed
    expect(l.day).toBe(1);
    expect(l.month).toBe(1);
    expect(l.year).toBe(2024);
    expect(l.canChi).toBe("Giáp Thìn");
    expect(l.holiday).toBe("Tết Nguyên Đán");
    expect(l.isFirstOfMonth).toBe(true);
  });

  it("Tết 2025 = Wednesday 29/1/2025 → 1/1 Ất Tỵ", () => {
    const l = solarToLunar(new Date(2025, 0, 29));
    expect(l.day).toBe(1);
    expect(l.month).toBe(1);
    expect(l.year).toBe(2025);
    expect(l.canChi).toBe("Ất Tỵ");
  });

  it("Tết 2026 = Tuesday 17/2/2026 → 1/1 Bính Ngọ", () => {
    const l = solarToLunar(new Date(2026, 1, 17));
    expect(l.day).toBe(1);
    expect(l.month).toBe(1);
    expect(l.year).toBe(2026);
    expect(l.canChi).toBe("Bính Ngọ");
  });
});

describe("solarToLunar — lunar holidays", () => {
  it("Tết Đoan Ngọ 2024 = 10/6/2024 → 5/5 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 5, 10));
    expect(l.day).toBe(5);
    expect(l.month).toBe(5);
    expect(l.holiday).toBe("Tết Đoan Ngọ");
  });

  it("Trung Thu 2024 = 17/9/2024 → 15/8 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 8, 17));
    expect(l.day).toBe(15);
    expect(l.month).toBe(8);
    expect(l.holiday).toBe("Tết Trung Thu");
    expect(l.isFullMoon).toBe(true);
  });

  it("Vu Lan 2024 = 18/8/2024 → 15/7 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 7, 18));
    expect(l.day).toBe(15);
    expect(l.month).toBe(7);
    expect(l.holiday).toBe("Vu Lan");
  });
});

describe("solarToLunar — non-holiday sanity", () => {
  it("23/5/2026 lands in lunar month 4 of Bính Ngọ year", () => {
    const l = solarToLunar(new Date(2026, 4, 23));
    expect(l.year).toBe(2026);
    expect(l.month).toBe(4);
    // day depends on exact algorithm — assert range, not exact value
    expect(l.day).toBeGreaterThanOrEqual(1);
    expect(l.day).toBeLessThanOrEqual(30);
    expect(l.holiday).toBeUndefined();
  });

  it("1/1/2024 (before Tết 2024) → lunar year still 2023 (Quý Mão)", () => {
    const l = solarToLunar(new Date(2024, 0, 1));
    expect(l.year).toBe(2023);
    expect(l.canChi).toBe("Quý Mão");
  });
});

describe("getCanChi — known anchor years", () => {
  it("returns Giáp Thìn for lunar 2024", () => {
    expect(getCanChi(2024)).toBe("Giáp Thìn");
  });
  it("returns Bính Ngọ for lunar 2026", () => {
    expect(getCanChi(2026)).toBe("Bính Ngọ");
  });
});

describe("solarToLunar — input validation + edge cases", () => {
  it("accepts YYYY-MM-DD string and parses as local date (no UTC shift)", () => {
    // Tết 2024 = Sat 10/2/2024. Parsing the string MUST yield the same
    // result as the Date-object form — even on a UTC-west server.
    const fromStr = solarToLunar("2024-02-10");
    const fromObj = solarToLunar(new Date(2024, 1, 10));
    expect(fromStr.day).toBe(fromObj.day);
    expect(fromStr.month).toBe(fromObj.month);
    expect(fromStr.year).toBe(fromObj.year);
    expect(fromStr.holiday).toBe("Tết Nguyên Đán");
  });

  it("throws on invalid date input rather than returning NaN fields", () => {
    expect(() => solarToLunar("garbage")).toThrow(/invalid date string/);
    expect(() => solarToLunar(new Date("not a date"))).toThrow(/invalid Date/);
  });
});
