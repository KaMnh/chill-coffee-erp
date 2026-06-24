import { describe, it, expect } from "vitest";
import { depositForDay } from "../deposit-summary";
import type { CashCloseReport } from "@/lib/types";

function makeReport(overrides: Partial<CashCloseReport>): CashCloseReport {
  return {
    id: "r1",
    business_date: "2026-03-01",
    cash_count_id: "c1",
    closed_at: "2026-03-01T13:00:00.000Z",
    closed_by: null,
    opening_cash: 0,
    pos_cash_total: 0,
    expense_cash_total: 0,
    payroll_cash_total: 0,
    theory_cash: 0,
    physical_cash: 0,
    difference: 0,
    denominations_json: {},
    sync_snapshot_at: null,
    note: null,
    report_status: "final",
    safe_deposit_amount: 0,
    leave_for_next_day: 0,
    ...overrides
  };
}

describe("depositForDay", () => {
  it("final: trả cash = safe_deposit_amount, transfer = bank_transfer_confirmed", () => {
    const r = makeReport({
      report_status: "final",
      safe_deposit_amount: 900000,
      bank_transfer_confirmed: 250000
    });
    expect(depositForDay(r)).toEqual({ cash: 900000, transfer: 250000 });
  });

  it("voided: cả hai = 0 (khoản nạp đã bị đảo qua adjustment)", () => {
    const r = makeReport({
      report_status: "voided",
      safe_deposit_amount: 900000,
      bank_transfer_confirmed: 250000
    });
    expect(depositForDay(r)).toEqual({ cash: 0, transfer: 0 });
  });

  it("bank_transfer_confirmed thiếu → transfer = 0", () => {
    const r = makeReport({
      report_status: "final",
      safe_deposit_amount: 100000,
      bank_transfer_confirmed: undefined
    });
    expect(depositForDay(r)).toEqual({ cash: 100000, transfer: 0 });
  });
});
