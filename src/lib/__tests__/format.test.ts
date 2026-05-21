import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatVND,
  formatVNDCompact,
  formatDateTime,
  formatTime,
  durationLabel,
  moneyFromInput,
} from "../format";

/**
 * Format helpers — characterization tests.
 *
 * Assumes TZ = "Asia/Ho_Chi_Minh" (pinned via vitest.config.mts test.env.TZ)
 * and Node ≥ 22 with full ICU for stable vi-VN output.
 */

describe("formatNumber", () => {
  it("formats 0 as '0'", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats 1_234_567 with vi-VN dot separators", () => {
    expect(formatNumber(1_234_567)).toBe("1.234.567");
  });

  it("treats null and undefined as 0", () => {
    expect(formatNumber(null)).toBe("0");
    expect(formatNumber(undefined)).toBe("0");
  });
});

describe("formatVND", () => {
  it("appends ' ₫' suffix", () => {
    expect(formatVND(1_234_567)).toBe("1.234.567 ₫");
  });

  it("treats null as 0 ₫", () => {
    expect(formatVND(null)).toBe("0 ₫");
  });
});

describe("formatVNDCompact", () => {
  it("returns '0' for 0", () => {
    expect(formatVNDCompact(0)).toBe("0");
  });

  it("returns raw value for amounts below 1k", () => {
    expect(formatVNDCompact(500)).toBe("500");
  });

  it("formats 185_000 as '185k'", () => {
    expect(formatVNDCompact(185_000)).toBe("185k");
  });

  it("formats 1_721_000 as '1.7M' with one decimal", () => {
    expect(formatVNDCompact(1_721_000)).toBe("1.7M");
  });

  it("strips '.0' for clean millions: 2_000_000 → '2M'", () => {
    expect(formatVNDCompact(2_000_000)).toBe("2M");
  });

  it("prefixes '-' for negative compact values: -185_000 → '-185k'", () => {
    expect(formatVNDCompact(-185_000)).toBe("-185k");
  });
});

describe("formatDateTime", () => {
  it("returns 'Chưa có' for null", () => {
    expect(formatDateTime(null)).toBe("Chưa có");
  });

  it("returns 'Chưa có' for undefined", () => {
    expect(formatDateTime(undefined)).toBe("Chưa có");
  });

  it("formats a valid ISO into vi-VN short date+time (structure regex; ICU format may vary)", () => {
    // Pin to a fixed instant. 2026-05-21T08:30:00Z = 15:30 VN.
    // vi-VN with dateStyle:short + timeStyle:short on Node (this machine's ICU)
    // produces: "15:30 21/5/26" — time first, then date, 2-digit year, no
    // leading zero on single-digit month. Regex is adjusted from the original
    // spec to match the actual Node ICU output on this platform.
    // Original spec regex: /^\d{1,2}\/\d{1,2}\/\d{4},?\s+\d{2}:\d{2}$/
    // Adjusted to cover both "HH:mm d/M/yy" and "d/M/yyyy, HH:mm" patterns:
    const result = formatDateTime("2026-05-21T08:30:00.000Z");
    expect(result).toMatch(
      /^(\d{2}:\d{2}\s+)?\d{1,2}\/\d{1,2}\/\d{2,4}(,?\s+\d{2}:\d{2})?$/
    );
    // Sanity: result should contain the day, month, and the VN-local hour.
    expect(result).toContain("21");           // pins the day
    expect(result).toContain("15:30");        // pins the VN-local hour
    expect(result).toMatch(/[\/\s]0?5[\/\s]/); // pins month=5, bounded by separators (avoids matching "5" inside "15:30")
    expect(result).toMatch(/\b26\b|\b2026\b/); // pins year (2-digit OR 4-digit)
  });
});

describe("formatTime", () => {
  it("returns '--:--' for null", () => {
    expect(formatTime(null)).toBe("--:--");
  });

  it("formats a valid ISO into HH:mm in VN tz", () => {
    // 2026-05-21T08:30:00Z = 15:30 VN.
    expect(formatTime("2026-05-21T08:30:00.000Z")).toBe("15:30");
  });
});

describe("durationLabel", () => {
  it("formats 0 minutes", () => {
    expect(durationLabel(0)).toBe("0:00 giờ");
  });

  it("formats sub-hour: 45 min → '0:45 giờ'", () => {
    expect(durationLabel(45)).toBe("0:45 giờ");
  });

  it("formats over-hour: 90 min → '1:30 giờ'", () => {
    expect(durationLabel(90)).toBe("1:30 giờ");
  });

  it("treats null as 0", () => {
    expect(durationLabel(null)).toBe("0:00 giờ");
  });
});

describe("moneyFromInput", () => {
  it("strips vi-VN dot separators: '1.234.567' → 1234567", () => {
    expect(moneyFromInput("1.234.567")).toBe(1_234_567);
  });

  it("returns 0 for non-numeric input", () => {
    expect(moneyFromInput("abc")).toBe(0);
  });

  it("returns 0 for empty string", () => {
    expect(moneyFromInput("")).toBe(0);
  });

  it("preserves leading minus for negative values", () => {
    expect(moneyFromInput("-500")).toBe(-500);
  });
});
