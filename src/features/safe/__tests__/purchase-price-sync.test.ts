import { describe, it, expect } from "vitest";
import {
  DEFAULT_SYNC_PRICE,
  PRICE_DEVIATION_THRESHOLD,
  priceDeviation,
  buildPurchaseLine,
} from "../purchase-price-sync";

describe("DEFAULT_SYNC_PRICE", () => {
  it("mặc định BẬT đồng bộ giá", () => {
    expect(DEFAULT_SYNC_PRICE).toBe(true);
  });
});

describe("priceDeviation", () => {
  it("không có giá cũ (null) → ratio null, không cảnh báo", () => {
    expect(priceDeviation(null, 100000)).toEqual({ ratio: null, isLarge: false });
    expect(priceDeviation(undefined, 100000)).toEqual({ ratio: null, isLarge: false });
    expect(priceDeviation(0, 100000)).toEqual({ ratio: null, isLarge: false });
  });

  it("lệch trong ngưỡng (±<20%) → không cảnh báo", () => {
    expect(priceDeviation(100000, 110000).isLarge).toBe(false); // +10%
    expect(priceDeviation(100000, 90000).isLarge).toBe(false);  // -10%
    expect(priceDeviation(100000, 100000).ratio).toBe(0);
  });

  it("lệch >= ngưỡng (tăng) → cảnh báo", () => {
    expect(priceDeviation(100000, 120000).isLarge).toBe(true); // +20% biên
    expect(priceDeviation(100000, 150000).isLarge).toBe(true); // +50%
  });

  it("lệch >= ngưỡng (giảm) → cảnh báo", () => {
    expect(priceDeviation(100000, 80000).isLarge).toBe(true); // -20% biên
    expect(priceDeviation(100000, 0).isLarge).toBe(true);     // -100%
  });

  it("ngưỡng = 0.2", () => {
    expect(PRICE_DEVIATION_THRESHOLD).toBe(0.2);
  });
});

describe("buildPurchaseLine", () => {
  it("map đủ field + cờ sync_price=true", () => {
    expect(
      buildPurchaseLine({ ingredientId: "i1", quantity: 2, unitPrice: 100000, syncPrice: true })
    ).toEqual({ ingredient_id: "i1", quantity: 2, unit_price: 100000, sync_price: true });
  });

  it("giữ nguyên sync_price=false khi tắt", () => {
    expect(
      buildPurchaseLine({ ingredientId: "i2", quantity: 1, unitPrice: 5000, syncPrice: false }).sync_price
    ).toBe(false);
  });
});
