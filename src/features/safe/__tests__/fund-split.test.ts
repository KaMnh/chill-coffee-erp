import { describe, expect, it } from "vitest";
import { defaultFundSplit, isFundSplitValid } from "../fund-split";

describe("defaultFundSplit", () => {
  it("CK trước, tiền mặt bù phần thiếu", () => {
    expect(defaultFundSplit(500_000, 300_000)).toEqual({ cash: 200_000, transfer: 300_000 });
  });

  it("CK đủ → dồn hết vào CK", () => {
    expect(defaultFundSplit(500_000, 2_000_000)).toEqual({ cash: 0, transfer: 500_000 });
  });

  it("CK = 0 → toàn bộ tiền mặt", () => {
    expect(defaultFundSplit(500_000, 0)).toEqual({ cash: 500_000, transfer: 0 });
  });

  it("CK âm (dữ liệu hỏng) → coi như 0, không tạo cash > total", () => {
    expect(defaultFundSplit(500_000, -10_000)).toEqual({ cash: 500_000, transfer: 0 });
  });

  it("làm tròn xuống số nguyên VND", () => {
    expect(defaultFundSplit(500_000.9, 300_000.7)).toEqual({ cash: 200_000, transfer: 300_000 });
  });
});

describe("isFundSplitValid", () => {
  const bal = { cashBal: 1_000_000, transferBal: 300_000 };

  it("split hợp lệ", () => {
    expect(isFundSplitValid({ cash: 200_000, transfer: 300_000 }, 500_000, bal.cashBal, bal.transferBal)).toBe(true);
  });

  it("tổng không khớp → false", () => {
    expect(isFundSplitValid({ cash: 100_000, transfer: 300_000 }, 500_000, bal.cashBal, bal.transferBal)).toBe(false);
  });

  it("vượt số dư CK → false", () => {
    expect(isFundSplitValid({ cash: 100_000, transfer: 400_000 }, 500_000, bal.cashBal, bal.transferBal)).toBe(false);
  });

  it("vượt số dư tiền mặt → false", () => {
    expect(isFundSplitValid({ cash: 1_100_000, transfer: 0 }, 1_100_000, bal.cashBal, bal.transferBal)).toBe(false);
  });

  it("phần âm → false", () => {
    expect(isFundSplitValid({ cash: 600_000, transfer: -100_000 }, 500_000, bal.cashBal, bal.transferBal)).toBe(false);
  });

  it("không nguyên (VND lẻ xu) → false", () => {
    expect(isFundSplitValid({ cash: 200_000.5, transfer: 299_999.5 }, 500_000, bal.cashBal, bal.transferBal)).toBe(false);
  });

  it("biên đúng bằng số dư cả 2 quỹ → true", () => {
    expect(isFundSplitValid({ cash: 1_000_000, transfer: 300_000 }, 1_300_000, bal.cashBal, bal.transferBal)).toBe(true);
  });
});
