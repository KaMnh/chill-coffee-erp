import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  getCurrentWeekRange,
  getCurrentMonthRange,
  getPreviousPeriod,
  countDaysInclusive
} from "../period-math";

/**
 * period-math — pure helpers for cash-flow period selection.
 *
 * Vitest is set to TZ="Asia/Ho_Chi_Minh" via vitest.config.mts, so all
 * Date math here is interpreted in VN time. Mocking the clock to a fixed
 * "today" lets us assert exact boundary dates without flake.
 */

beforeAll(() => {
  // Fix "today" to Saturday 23/5/2026 (matches the brainstorm date).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-23T10:00:00+07:00"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("getCurrentWeekRange", () => {
  it("returns Monday→Sunday of the week containing today", () => {
    // 23/5/2026 is a Saturday. Week is Mon 18/5 → Sun 24/5.
    const r = getCurrentWeekRange();
    expect(r.start).toBe("2026-05-18");
    expect(r.end).toBe("2026-05-24");
  });
});

describe("getCurrentMonthRange", () => {
  it("returns the 1st through last day of the current month", () => {
    const r = getCurrentMonthRange();
    expect(r.start).toBe("2026-05-01");
    expect(r.end).toBe("2026-05-31");
  });
});

describe("getPreviousPeriod", () => {
  it("week preset → previous Mon-Sun", () => {
    const prev = getPreviousPeriod("2026-05-18", "2026-05-24", "week");
    expect(prev.start).toBe("2026-05-11");
    expect(prev.end).toBe("2026-05-17");
  });

  it("month preset → previous calendar month", () => {
    const prev = getPreviousPeriod("2026-05-01", "2026-05-31", "month");
    expect(prev.start).toBe("2026-04-01");
    expect(prev.end).toBe("2026-04-30");
  });

  it("month preset preserves shorter previous-month day-count (Mar→Feb)", () => {
    const prev = getPreviousPeriod("2026-03-01", "2026-03-31", "month");
    expect(prev.start).toBe("2026-02-01");
    expect(prev.end).toBe("2026-02-28");
  });

  it("custom preset → N days immediately before start", () => {
    const prev = getPreviousPeriod("2026-05-10", "2026-05-12", "custom");
    // 3-day window (10,11,12) → prev = 7,8,9
    expect(prev.start).toBe("2026-05-07");
    expect(prev.end).toBe("2026-05-09");
  });

  it("custom preset preserves N-day length across month boundary", () => {
    const prev = getPreviousPeriod("2026-05-01", "2026-05-31", "custom");
    // 31-day window → prev = 31 days ending 30/4 = 31/3..30/4
    expect(prev.start).toBe("2026-03-31");
    expect(prev.end).toBe("2026-04-30");
  });
});

describe("countDaysInclusive", () => {
  it("counts both endpoints", () => {
    expect(countDaysInclusive("2026-05-01", "2026-05-31")).toBe(31);
    expect(countDaysInclusive("2026-05-01", "2026-05-01")).toBe(1);
    expect(countDaysInclusive("2026-05-01", "2026-05-02")).toBe(2);
  });
});
