import { describe, it, expect } from "vitest";
import { drawFromFloat } from "../float-split";

const BAL = { cash: 5_000_000, transfer: 2_000_000, total: 7_000_000 };

describe("drawFromFloat — rút = số dư − float, ưu tiên ĐỂ LẠI tiền mặt", () => {
  it("float 0 → rút hết cả hai quỹ", () => {
    expect(drawFromFloat(BAL, 0)).toEqual({ cash: 5_000_000, transfer: 2_000_000 });
  });

  it("float nhỏ hơn cash → rút hết transfer trước, float nằm lại ở cash", () => {
    // draw 6tr = transfer 2tr + cash 4tr → để lại 1tr toàn tiền mặt
    expect(drawFromFloat(BAL, 1_000_000)).toEqual({ cash: 4_000_000, transfer: 2_000_000 });
  });

  it("float lớn → chỉ rút từ transfer", () => {
    // draw 1tr < transferBalance → transfer 1tr, cash giữ nguyên
    expect(drawFromFloat(BAL, 6_000_000)).toEqual({ cash: 0, transfer: 1_000_000 });
  });

  it("float ≥ tổng → không rút gì", () => {
    expect(drawFromFloat(BAL, 7_000_000)).toEqual({ cash: 0, transfer: 0 });
    expect(drawFromFloat(BAL, 99_000_000)).toEqual({ cash: 0, transfer: 0 });
  });

  it("float âm / NaN coi như 0 → rút hết", () => {
    expect(drawFromFloat(BAL, -5)).toEqual({ cash: 5_000_000, transfer: 2_000_000 });
    expect(drawFromFloat(BAL, Number.NaN)).toEqual({ cash: 5_000_000, transfer: 2_000_000 });
  });

  it("float lẻ bị floor về VND nguyên", () => {
    // float 999.999,5 → floor 999.999 → draw 6.000.001
    expect(drawFromFloat(BAL, 999_999.5)).toEqual({ cash: 4_000_001, transfer: 2_000_000 });
  });
});
