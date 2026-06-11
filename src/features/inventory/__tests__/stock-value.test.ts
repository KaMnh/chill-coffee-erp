import { describe, it, expect } from "vitest";
import { rowValue, stockTotals } from "../stock-value";
import type { StockBalance, IngredientReferencePrice } from "@/lib/types";

const bal = (id: string, qty: number): StockBalance => ({
  ingredient_id: id,
  name: id,
  unit: "kg",
  theoretical_balance: qty,
  low_stock_threshold: null,
  is_low: false,
  last_movement_at: null,
});
const price = (id: string, p: number): [string, IngredientReferencePrice] => [
  id,
  { ingredient_id: id, unit_price: p, updated_at: "" },
];

describe("rowValue", () => {
  it("làm tròn VND nguyên: 3.2 kg × 185000 = 592000", () => {
    expect(rowValue(3.2, 185000)).toBe(592000);
  });
  it("tồn âm → giá trị âm", () => {
    expect(rowValue(-2, 50000)).toBe(-100000);
  });
  it("giá null/undefined → null", () => {
    expect(rowValue(5, null)).toBeNull();
    expect(rowValue(5, undefined)).toBeNull();
  });
  it("làm tròn nửa lên: 0.5 đơn vị × 33333 = 16667", () => {
    expect(rowValue(0.5, 33333)).toBe(16667);
  });
});

describe("stockTotals", () => {
  it("tổng = Σ rowValue dòng có giá (kể cả âm); missingCount = dòng thiếu giá", () => {
    const balances = [bal("a", 3.2), bal("b", -2), bal("c", 10)];
    const prices = new Map([price("a", 185000), price("b", 50000)]);
    expect(stockTotals(balances, prices)).toEqual({ total: 492000, missingCount: 1 });
  });
  it("không giá nào → total 0, missing = tất cả", () => {
    expect(stockTotals([bal("a", 1)], new Map())).toEqual({ total: 0, missingCount: 1 });
  });
  it("rỗng → 0/0", () => {
    expect(stockTotals([], new Map())).toEqual({ total: 0, missingCount: 0 });
  });
});
