import { describe, it, expect } from "vitest";
import {
  validateExpense,
  validateEmployee,
  validatePayrollEdit,
  validateDenominations,
  validateCashCount,
  validateHandoverNote,
  limits,
} from "../validation";

/**
 * Validation helpers — characterization tests.
 *
 * Assert BOTH result.ok AND result.field (when failing) to catch refactors
 * that change which field a validation error attaches to.
 */

describe("validateExpense", () => {
  const valid = {
    description: "Mua đường",
    quantity: 2,
    unit_price: 50_000,
    amount: 100_000,
    note: "",
  };

  it("accepts valid input", () => {
    expect(validateExpense(valid)).toEqual({ ok: true });
  });

  it("rejects empty description with field=description", () => {
    const result = validateExpense({ ...valid, description: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("description");
  });

  it("rejects description over 500 chars", () => {
    const result = validateExpense({ ...valid, description: "x".repeat(501) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("description");
  });

  it("rejects quantity > 99999", () => {
    const result = validateExpense({ ...valid, quantity: 100_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("quantity");
  });

  it("rejects negative amount", () => {
    const result = validateExpense({ ...valid, amount: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("amount");
  });
});

describe("validateEmployee", () => {
  it("accepts valid input", () => {
    expect(validateEmployee({ name: "Khoa", hourly_rate: 50_000 })).toEqual({ ok: true });
  });

  it("rejects empty name with field=name", () => {
    const result = validateEmployee({ name: "  ", hourly_rate: 50_000 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("name");
  });

  it("rejects hourly_rate exceeding 10M", () => {
    const result = validateEmployee({ name: "Khoa", hourly_rate: 10_000_001 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("hourly_rate");
  });
});

describe("validatePayrollEdit", () => {
  const valid = {
    check_in_at: "2026-05-21T08:00",
    check_out_at: "2026-05-21T17:00",
    allowance_amount: 50_000,
    note: "",
  };

  it("accepts valid input", () => {
    expect(validatePayrollEdit(valid)).toEqual({ ok: true });
  });

  it("rejects missing check_in_at with field=check_in_at", () => {
    const result = validatePayrollEdit({ ...valid, check_in_at: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("check_in_at");
  });

  it("rejects check_out < check_in with field=check_out_at", () => {
    const result = validatePayrollEdit({
      ...valid,
      check_in_at: "2026-05-21T17:00",
      check_out_at: "2026-05-21T08:00",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("check_out_at");
  });

  it("rejects note over 1000 chars with field=note", () => {
    const result = validatePayrollEdit({ ...valid, note: "x".repeat(1001) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("note");
  });
});

describe("validateDenominations", () => {
  it("accepts all 9 valid VND keys", () => {
    expect(
      validateDenominations({
        "1000": 0,
        "2000": 1,
        "5000": 2,
        "10000": 3,
        "20000": 0,
        "50000": 0,
        "100000": 5,
        "200000": 0,
        "500000": 1,
      })
    ).toEqual({ ok: true });
  });

  it("rejects invalid denomination key '100'", () => {
    const result = validateDenominations({ "100": 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("denominations_json");
  });

  it("rejects negative count", () => {
    const result = validateDenominations({ "1000": -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("denominations_json");
  });

  it("rejects count > 10000", () => {
    const result = validateDenominations({ "1000": 10_001 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("denominations_json");
  });
});

describe("validateCashCount", () => {
  const validDenoms = { "1000": 0, "2000": 0, "5000": 0, "10000": 0, "20000": 0, "50000": 0, "100000": 5, "200000": 1, "500000": 0 };
  const valid = {
    total_physical: 700_000,
    bank_transfer_confirmed: 0,
    note: "",
    denominations_json: validDenoms,
  };

  it("accepts valid input", () => {
    expect(validateCashCount(valid)).toEqual({ ok: true });
  });

  it("propagates denominations failure with field=denominations_json", () => {
    const result = validateCashCount({ ...valid, denominations_json: { "100": 5 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("denominations_json");
  });

  it("rejects total_physical exceeding limits.amount.max", () => {
    const result = validateCashCount({ ...valid, total_physical: limits.amount.max + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("total_physical");
  });
});

describe("validateHandoverNote", () => {
  it("accepts note ≤ 1000 chars", () => {
    expect(validateHandoverNote("x".repeat(1000))).toEqual({ ok: true });
  });

  it("rejects note > 1000 chars with field=note", () => {
    const result = validateHandoverNote("x".repeat(1001));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("note");
  });
});
