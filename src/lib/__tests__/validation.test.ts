import { describe, it, expect } from "vitest";
import {
  validateExpense,
  validateEmployee,
  validatePayrollEdit,
  validateDenominations,
  validateCashCount,
  validateHandoverNote,
  validateSafeSetup,
  validateSafeWithdraw,
  validateSafeAdjust,
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
    expect(
      validateEmployee({ name: "Khoa", hourly_rate: 50_000, pay_type: "hourly", default_daily_pay: null })
    ).toEqual({ ok: true });
  });

  it("rejects empty name with field=name", () => {
    const result = validateEmployee({ name: "  ", hourly_rate: 50_000, pay_type: "hourly", default_daily_pay: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("name");
  });

  it("rejects hourly_rate exceeding 10M", () => {
    const result = validateEmployee({ name: "Khoa", hourly_rate: 10_000_001, pay_type: "hourly", default_daily_pay: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("hourly_rate");
  });
});

describe("validateEmployee fixed pay", () => {
  it("fixed với default_daily_pay hợp lệ → ok", () => {
    expect(
      validateEmployee({ name: "A", hourly_rate: 0, pay_type: "fixed", default_daily_pay: 250_000 }).ok
    ).toBe(true);
  });

  it("fixed với default_daily_pay âm → fail (field=default_daily_pay)", () => {
    const result = validateEmployee({ name: "A", hourly_rate: 0, pay_type: "fixed", default_daily_pay: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("default_daily_pay");
  });

  it("fixed với default_daily_pay vượt max → fail", () => {
    const result = validateEmployee({
      name: "A",
      hourly_rate: 0,
      pay_type: "fixed",
      default_daily_pay: limits.dailyPay.max + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("default_daily_pay");
  });

  it("hourly không cần default_daily_pay → ok", () => {
    expect(
      validateEmployee({ name: "A", hourly_rate: 30_000, pay_type: "hourly", default_daily_pay: null }).ok
    ).toBe(true);
  });

  it("fixed KHÔNG kiểm hourly_rate (rate = 0 vẫn ok)", () => {
    expect(
      validateEmployee({ name: "A", hourly_rate: 0, pay_type: "fixed", default_daily_pay: 200_000 }).ok
    ).toBe(true);
  });

  it("pay_type lạ → fail (field=pay_type)", () => {
    const result = validateEmployee({
      name: "A",
      hourly_rate: 30_000,
      pay_type: "bogus" as unknown as "hourly",
      default_daily_pay: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("pay_type");
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

  it("fixed: override_pay hợp lệ → ok", () => {
    expect(
      validatePayrollEdit({ ...valid, pay_type: "fixed", override_pay: 280_000 }).ok
    ).toBe(true);
  });

  it("fixed: override_pay âm → fail (field=override_pay)", () => {
    const result = validatePayrollEdit({ ...valid, pay_type: "fixed", override_pay: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("override_pay");
  });

  it("fixed: override_pay vượt max → fail", () => {
    const result = validatePayrollEdit({
      ...valid,
      pay_type: "fixed",
      override_pay: limits.dailyPay.max + 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("override_pay");
  });

  it("hourly: override_pay bị bỏ qua (không kiểm) → ok", () => {
    expect(
      validatePayrollEdit({ ...valid, pay_type: "hourly", override_pay: -999 }).ok
    ).toBe(true);
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

describe("validateSafeSetup (2 quỹ)", () => {
  it("accepts cash + transfer hợp lệ", () => {
    expect(validateSafeSetup({ cash: 1_000_000, transfer: 2_000_000 })).toEqual({ ok: true });
  });

  it("accepts một quỹ = 0 khi quỹ kia > 0", () => {
    expect(validateSafeSetup({ cash: 0, transfer: 500_000 })).toEqual({ ok: true });
    expect(validateSafeSetup({ cash: 500_000, transfer: 0 })).toEqual({ ok: true });
  });

  it("rejects cả 2 quỹ = 0 với field=cash", () => {
    const result = validateSafeSetup({ cash: 0, transfer: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("cash");
  });

  it("rejects cash âm / vượt max", () => {
    expect(validateSafeSetup({ cash: -1, transfer: 0 }).ok).toBe(false);
    expect(validateSafeSetup({ cash: limits.amount.max + 1, transfer: 0 }).ok).toBe(false);
  });

  it("rejects transfer âm với field=transfer", () => {
    const result = validateSafeSetup({ cash: 100, transfer: -1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("transfer");
  });

  it("rejects note quá dài", () => {
    const result = validateSafeSetup({ cash: 100, transfer: 0, note: "x".repeat(limits.note + 1) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("note");
  });
});

describe("validateSafeWithdraw (tách quỹ)", () => {
  const CASH_BAL = 1_000_000;
  const TRANSFER_BAL = 300_000;
  const valid = { cashAmount: 200_000, transferAmount: 300_000, category: "rent" };

  it("accepts split hợp lệ", () => {
    expect(validateSafeWithdraw(valid, CASH_BAL, TRANSFER_BAL)).toEqual({ ok: true });
  });

  it("rejects phần âm với field=amount", () => {
    const result = validateSafeWithdraw({ ...valid, transferAmount: -1 }, CASH_BAL, TRANSFER_BAL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("amount");
  });

  it("rejects tổng = 0", () => {
    const result = validateSafeWithdraw(
      { ...valid, cashAmount: 0, transferAmount: 0 }, CASH_BAL, TRANSFER_BAL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("amount");
  });

  it("rejects vượt quỹ tiền mặt với field=cash", () => {
    const result = validateSafeWithdraw(
      { ...valid, cashAmount: CASH_BAL + 1 }, CASH_BAL, TRANSFER_BAL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("cash");
  });

  it("rejects vượt quỹ chuyển khoản với field=transfer", () => {
    const result = validateSafeWithdraw(
      { ...valid, transferAmount: TRANSFER_BAL + 1 }, CASH_BAL, TRANSFER_BAL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("transfer");
  });

  it("rejects category lạ", () => {
    const result = validateSafeWithdraw({ ...valid, category: "bogus" }, CASH_BAL, TRANSFER_BAL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("category");
  });

  it("rejects description quá dài", () => {
    const result = validateSafeWithdraw(
      { ...valid, description: "x".repeat(limits.note + 1) }, CASH_BAL, TRANSFER_BAL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("description");
  });

  it("biên: rút đúng bằng cả 2 số dư → ok", () => {
    expect(validateSafeWithdraw(
      { cashAmount: CASH_BAL, transferAmount: TRANSFER_BAL, category: "other" },
      CASH_BAL, TRANSFER_BAL
    )).toEqual({ ok: true });
  });
});

describe("validateSafeAdjust", () => {
  it("accepts số dư mới khác hiện tại + note ≥ 5 ký tự", () => {
    expect(validateSafeAdjust({ newBalance: 500_000, note: "lệch do đếm" }, 400_000)).toEqual({ ok: true });
  });

  it("rejects số dư mới = hiện tại", () => {
    const result = validateSafeAdjust({ newBalance: 400_000, note: "không đổi gì" }, 400_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("newBalance");
  });

  it("rejects note < 5 ký tự", () => {
    const result = validateSafeAdjust({ newBalance: 500_000, note: "abc" }, 400_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe("note");
  });
});
