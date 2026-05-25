import { describe, it, expect } from "vitest";
import { deriveBusinessDate } from "../transform";

/**
 * Regression: KV API trả naive timestamp đại diện giờ VN. JS `new Date(naive)`
 * interpret theo process.TZ → trên container UTC (mặc định Docker), order
 * buổi tối VN bị parse thành sáng UTC hôm sau → off-by-1 trên business_date.
 *
 * Vitest pin `env.TZ = Asia/Ho_Chi_Minh` (vitest.config.mts:37). Sau khi fix,
 * function phải trả đúng VN date BẤT KỂ process.TZ — vì code force +07:00
 * tường minh trước khi parse.
 */

describe("deriveBusinessDate", () => {
  describe("naive timestamps (KV format)", () => {
    it("evening 20:58 VN → same-day", () => {
      expect(deriveBusinessDate("2026-05-25T20:58:44")).toBe("2026-05-25");
    });

    it("1 phút trước nửa đêm VN → same-day", () => {
      expect(deriveBusinessDate("2026-05-25T23:59:59")).toBe("2026-05-25");
    });

    it("1 giây sau nửa đêm VN → next-day", () => {
      expect(deriveBusinessDate("2026-05-26T00:00:01")).toBe("2026-05-26");
    });

    it("ms fraction giữ nguyên ngày", () => {
      expect(deriveBusinessDate("2026-05-25T20:58:44.460")).toBe("2026-05-25");
    });

    it("sáng sớm 03:00 VN → same-day", () => {
      expect(deriveBusinessDate("2026-05-25T03:00:00")).toBe("2026-05-25");
    });
  });

  describe("ISO with Z (UTC) marker", () => {
    it("13:58 UTC = 20:58 VN → ngày 25 VN", () => {
      expect(deriveBusinessDate("2026-05-25T13:58:44Z")).toBe("2026-05-25");
    });

    it("17:30 UTC = 00:30 VN ngày kế tiếp → next-day VN", () => {
      expect(deriveBusinessDate("2026-05-25T17:30:00Z")).toBe("2026-05-26");
    });

    it("23:30 UTC ngày 25 = 06:30 VN ngày 26 → ngày 26", () => {
      expect(deriveBusinessDate("2026-05-25T23:30:00Z")).toBe("2026-05-26");
    });
  });

  describe("ISO với explicit offset", () => {
    it("+07:00 = VN local → same-day", () => {
      expect(deriveBusinessDate("2026-05-25T20:58:44+07:00")).toBe("2026-05-25");
    });

    it("+07 (không có colon) → vẫn parse đúng", () => {
      expect(deriveBusinessDate("2026-05-25T20:58:44+0700")).toBe("2026-05-25");
    });

    it("-05:00 = NY EST, 20:58 EST = 08:58 VN ngày 26", () => {
      expect(deriveBusinessDate("2026-05-25T20:58:44-05:00")).toBe("2026-05-26");
    });
  });

  describe("fallback", () => {
    it("undefined → today (en-CA, VN tz)", () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
      expect(deriveBusinessDate(undefined)).toBe(today);
    });

    it("empty string → today", () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
      expect(deriveBusinessDate("")).toBe(today);
    });

    it("garbage string → today (NaN fallback)", () => {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
      expect(deriveBusinessDate("not-a-date")).toBe(today);
    });
  });
});
