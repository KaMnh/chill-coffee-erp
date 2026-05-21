import { describe, it, expect } from "vitest";
import {
  computeDenominationTotal,
  computeReconciliation,
  computeReconcileDiff,
  isLeaveAmountValid,
  computeGreedyLeaveBreakdown,
} from "../cash-math";

/**
 * Pure cash math helpers — characterization tests.
 *
 * These tests pin the EXACT behavior of the helpers as shipped in
 * Phase 3B.2b.i. If a future refactor breaks any of these, the test
 * fails loudly — fix the helper (or, if intentional, update the test
 * with reviewer sign-off).
 */

describe("computeDenominationTotal", () => {
  it("returns 0 for empty counts", () => {
    expect(computeDenominationTotal({})).toBe(0);
  });

  it("returns 0 for all-zero counts", () => {
    expect(
      computeDenominationTotal({
        1000: 0,
        2000: 0,
        5000: 0,
        10000: 0,
        20000: 0,
        50000: 0,
        100000: 0,
        200000: 0,
        500000: 0,
      })
    ).toBe(0);
  });

  it("computes single-denomination total (3 × 200k)", () => {
    expect(computeDenominationTotal({ "200000": 3 })).toBe(600_000);
  });

  it("handles mixed numeric and string keys", () => {
    // Both keys must be summed: 1×500k + 2×100k = 700k
    expect(computeDenominationTotal({ 500000: 1, "100000": 2 })).toBe(700_000);
  });
});

describe("computeReconciliation", () => {
  it("returns 0 for all-zero inputs", () => {
    expect(
      computeReconciliation({
        physical: 0,
        openingCash: 0,
        bankTransferConfirmed: 0,
        expenseCashTotal: 0,
        payrollCashTotal: 0,
      })
    ).toBe(0);
  });

  it("matches v3 fixture: physical 5M, opening 1M, bank 2M, expense 300k, payroll 200k", () => {
    // 5_000_000 - 1_000_000 + 2_000_000 + 300_000 + 200_000 = 6_500_000
    expect(
      computeReconciliation({
        physical: 5_000_000,
        openingCash: 1_000_000,
        bankTransferConfirmed: 2_000_000,
        expenseCashTotal: 300_000,
        payrollCashTotal: 200_000,
      })
    ).toBe(6_500_000);
  });

  it("returns negative when openingCash exceeds physical + extras", () => {
    // 100k - 500k + 0 + 0 + 0 = -400k
    expect(
      computeReconciliation({
        physical: 100_000,
        openingCash: 500_000,
        bankTransferConfirmed: 0,
        expenseCashTotal: 0,
        payrollCashTotal: 0,
      })
    ).toBe(-400_000);
  });
});

describe("computeReconcileDiff", () => {
  it("returns 0 when POS equals reconciliation", () => {
    expect(computeReconcileDiff(1_000_000, 1_000_000)).toBe(0);
  });

  it("returns negative when POS < reconciliation (thiếu)", () => {
    expect(computeReconcileDiff(900_000, 1_000_000)).toBe(-100_000);
  });

  it("returns positive when POS > reconciliation (thừa)", () => {
    expect(computeReconcileDiff(1_100_000, 1_000_000)).toBe(100_000);
  });
});

describe("isLeaveAmountValid", () => {
  it("accepts exactly 0", () => {
    expect(isLeaveAmountValid(0, 1_000_000)).toBe(true);
  });

  it("accepts leave === physical", () => {
    expect(isLeaveAmountValid(1_000_000, 1_000_000)).toBe(true);
  });

  it("rejects leave > physical", () => {
    expect(isLeaveAmountValid(1_000_001, 1_000_000)).toBe(false);
  });

  it("rejects negative leave", () => {
    expect(isLeaveAmountValid(-1, 1_000_000)).toBe(false);
  });

  it("rejects NaN", () => {
    expect(isLeaveAmountValid(Number.NaN, 1_000_000)).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(isLeaveAmountValid(Number.POSITIVE_INFINITY, 1_000_000)).toBe(false);
  });
});

describe("computeGreedyLeaveBreakdown", () => {
  it("matches JSDoc example: 237_000 → {200k:1, 20k:1, 10k:1, 5k:1, 2k:1}", () => {
    expect(computeGreedyLeaveBreakdown(237_000)).toEqual({
      "200000": 1,
      "20000": 1,
      "10000": 1,
      "5000": 1,
      "2000": 1,
    });
  });

  it("returns {} for amount 0", () => {
    expect(computeGreedyLeaveBreakdown(0)).toEqual({});
  });

  it("returns {} for amount below smallest denom (500)", () => {
    expect(computeGreedyLeaveBreakdown(500)).toEqual({});
  });

  it("returns greedy result for 1_000_000 → {500000:2}", () => {
    // DENOMINATIONS starts at 500k, so 1M = 2 × 500k (not 5 × 200k)
    expect(computeGreedyLeaveBreakdown(1_000_000)).toEqual({ "500000": 2 });
  });

  it("handles 1_001_000 → {500000:2, 1000:1}", () => {
    // Greedy: 2 × 500k = 1M, remainder 1k
    expect(computeGreedyLeaveBreakdown(1_001_000)).toEqual({
      "500000": 2,
      "1000": 1,
    });
  });
});
