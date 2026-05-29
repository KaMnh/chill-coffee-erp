import { describe, it, expect } from "vitest";
import {
  excelTimeToIso,
  parseVndNumber,
  buildImportPayloadFromRows,
} from "../excel-import";

/**
 * Pure-logic tests for the KiotViet Excel import. The SheetJS workbook reader
 * (`parseWorkbookToRows`) is NOT unit-tested (I/O); these cover the mapping core.
 * TZ pinned to Asia/Ho_Chi_Minh via vitest.config.mts.
 */

describe("excelTimeToIso", () => {
  it("normalizes 'YYYY-MM-DD HH:mm:ss.ffffff' → naive ISO with 3-digit ms", () => {
    expect(excelTimeToIso("2026-05-29 15:28:12.893000")).toBe("2026-05-29T15:28:12.893");
  });
  it("keeps a plain date-time as naive (no tz marker appended)", () => {
    expect(excelTimeToIso("2026-05-29 23:50:00")).toBe("2026-05-29T23:50:00");
  });
  it("reads a Date as the wall-clock value (UTC fields)", () => {
    expect(excelTimeToIso(new Date(Date.UTC(2026, 4, 29, 15, 28, 12)))).toBe("2026-05-29T15:28:12");
  });
  it("converts an Excel date serial (tz-independent) — SheetJS raw cells", () => {
    expect(excelTimeToIso(25569)).toBe("1970-01-01T00:00:00.000"); // serial for Unix epoch
    expect(excelTimeToIso(25569.5)).toBe("1970-01-01T12:00:00.000"); // +half day
  });
});

describe("parseVndNumber", () => {
  it("passes numbers through", () => expect(parseVndNumber(63000)).toBe(63000));
  it("parses plain digit strings", () => expect(parseVndNumber("63000")).toBe(63000));
  it("strips vi-VN thousands dots", () => expect(parseVndNumber("63.000")).toBe(63000));
  it("keeps real decimals (e.g. discount %)", () => expect(parseVndNumber("46.15")).toBeCloseTo(46.15));
  it("treats blank/null as 0", () => {
    expect(parseVndNumber("")).toBe(0);
    expect(parseVndNumber(null)).toBe(0);
  });
});

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "Mã hóa đơn": "HD1",
    "Thời gian(Giờ đi)": "2026-05-29 15:28:12.000",
    "Trạng thái": "Hoàn thành",
    "Chi nhánh": "Chi nhánh trung tâm",
    "Khách hàng": "Khách lẻ",
    "Người nhận đơn": "Thuận",
    "Tổng tiền hàng": 63000,
    "Giảm giá hóa đơn": 0,
    "Khách cần trả": 63000,
    "Tiền mặt": 63000,
    "Thẻ": 0,
    "Chuyển khoản": 0,
    "Mã hàng": "SP1",
    "Tên hàng": "Trà Nhiệt Đới",
    "ĐVT": "Ly",
    "Số lượng": 1,
    "Đơn giá": 34000,
    "Giảm giá %": 0,
    "Giảm giá": 0,
    "Thành tiền": 34000,
    ...over,
  };
}

describe("buildImportPayloadFromRows", () => {
  it("groups line items by invoice_code into one order; invoice totals taken once", () => {
    const p = buildImportPayloadFromRows([
      row(),
      row({ "Mã hàng": "SP2", "Tên hàng": "Sinh Tố Dâu", "Đơn giá": 29000, "Thành tiền": 29000 }),
    ]);
    expect(p.orders).toHaveLength(1);
    const o = p.orders[0];
    expect(o.invoice_code).toBe("HD1");
    expect(o.invoice_details).toHaveLength(2);
    expect(o.net_amount).toBe(63000); // taken from first row, NOT summed
    expect(o.gross_amount).toBe(63000);
    expect(o.business_date).toBe("2026-05-29");
    expect(o.purchase_at).toBe("2026-05-29T15:28:12.000");
    expect(o.payments).toEqual([
      expect.objectContaining({ payment_method: "cash", amount: 63000, cash_received: 63000, change_given: 0 }),
    ]);
    expect(p.meta.invoice_count).toBe(1);
    expect(p.meta.row_count).toBe(2);
  });

  it("skips invoices whose status is not 'Hoàn thành' and counts them", () => {
    const p = buildImportPayloadFromRows([
      row(),
      row({ "Mã hóa đơn": "HD2", "Trạng thái": "Đã hủy" }),
    ]);
    expect(p.orders.map((o) => o.invoice_code)).toEqual(["HD1"]);
    expect(p.meta.skipped_count).toBe(1);
  });

  it("splits multiple payment methods (cash + transfer)", () => {
    const p = buildImportPayloadFromRows([row({ "Tiền mặt": 30000, "Chuyển khoản": 33000 })]);
    expect(p.orders[0].payments.map((x) => x.payment_method).sort()).toEqual(["cash", "transfer"]);
  });

  it("gives each line a UNIQUE item_key even when a product code repeats in one invoice", () => {
    // KiotViet exports can list the same product on two rows (e.g. sold twice).
    // item_key must stay unique per order or the INSERT violates
    // unique(sales_order_id, item_key). Regression for the live-import 500.
    const p = buildImportPayloadFromRows([
      row(), // Mã hàng = SP1
      row({ "Tên hàng": "Trà Nhiệt Đới (lần 2)" }), // SAME Mã hàng SP1
      row({ "Mã hàng": null, "Tên hàng": "Ghi chú không mã" }), // no product code
    ]);
    const keys = p.orders[0].invoice_details.map((d) => d.item_key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3); // all distinct
  });
});
