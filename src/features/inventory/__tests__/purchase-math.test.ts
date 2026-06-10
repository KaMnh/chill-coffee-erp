import { describe, expect, it } from "vitest";
import { lineAmount, deriveQuantity, purchaseTotal } from "../purchase-math";

describe("lineAmount", () => {
  it("thành tiền = SL × đơn giá", () => {
    expect(lineAmount(2, 100_000)).toBe(200_000);
  });

  it("SL lẻ (kg)", () => {
    expect(lineAmount(2.5, 100_000)).toBe(250_000);
  });

  it("input rác → 0", () => {
    expect(lineAmount(Number.NaN, 100_000)).toBe(0);
    expect(lineAmount(2, Number.NaN)).toBe(0);
  });
});

describe("deriveQuantity", () => {
  it("SL = thành tiền / đơn giá", () => {
    expect(deriveQuantity(200_000, 100_000)).toBe(2);
  });

  it("đơn giá 0 → 0 (không chia 0)", () => {
    expect(deriveQuantity(200_000, 0)).toBe(0);
  });

  it("đơn giá âm → 0", () => {
    expect(deriveQuantity(200_000, -5)).toBe(0);
  });
});

describe("purchaseTotal", () => {
  it("tổng = Σ thành tiền các dòng", () => {
    expect(
      purchaseTotal([
        { quantity: 2, unitPrice: 100_000 },
        { quantity: 10, unitPrice: 25_000 }
      ])
    ).toBe(450_000);
  });

  it("danh sách rỗng → 0", () => {
    expect(purchaseTotal([])).toBe(0);
  });
});
