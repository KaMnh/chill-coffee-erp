import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatBackupStatus } from "../backup";

describe("formatBytes", () => {
  it("formats 0 as 0 B", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
  it("formats bytes under 1KB", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats KB with 1 decimal", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
  });
  it("formats MB with 1 decimal", () => {
    expect(formatBytes(2_156_234)).toBe("2.1 MB");
  });
  it("formats GB with 1 decimal", () => {
    expect(formatBytes(1_500_000_000)).toBe("1.4 GB");
  });
  it("handles null gracefully", () => {
    expect(formatBytes(null)).toBe("—");
  });
});

describe("formatDuration", () => {
  it("returns dash if no end time", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", null)).toBe("—");
  });
  it("formats milliseconds", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", "2026-05-24T10:00:00.500Z")).toBe("500ms");
  });
  it("formats seconds with 1 decimal", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", "2026-05-24T10:00:01.200Z")).toBe("1.2s");
  });
  it("formats minutes", () => {
    expect(formatDuration("2026-05-24T10:00:00Z", "2026-05-24T10:02:30Z")).toBe("2m 30s");
  });
});

describe("formatBackupStatus", () => {
  it("running has spinner semantic", () => {
    expect(formatBackupStatus("running")).toEqual({ label: "Đang chạy", semantic: "info", icon: "spinner" });
  });
  it("success has check icon", () => {
    expect(formatBackupStatus("success")).toEqual({ label: "Thành công", semantic: "success", icon: "check" });
  });
  it("failed has x icon", () => {
    expect(formatBackupStatus("failed")).toEqual({ label: "Lỗi", semantic: "danger", icon: "x" });
  });
});
