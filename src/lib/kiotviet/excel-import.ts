/**
 * Parse a KiotViet "Chi tiết hóa đơn" (.xlsx) export into the payload consumed
 * by the `import_sales_from_excel` RPC. The sheet is line-item level (each
 * invoice repeats across rows, one row per product); we group by invoice_code.
 *
 * Matching key is **invoice_code** ("Mã hóa đơn") — the Excel has no internal
 * KiotViet invoice id. business_date is derived from "Thời gian(Giờ đi)".
 */
import { deriveBusinessDate } from "./transform";

/** Exact Vietnamese header labels in the KiotViet detail export (row 1). */
const H = {
  code: "Mã hóa đơn",
  time: "Thời gian(Giờ đi)",
  status: "Trạng thái",
  branch: "Chi nhánh",
  customer: "Khách hàng",
  soldBy: "Người nhận đơn",
  tableCode: "Phòng/Bàn",
  gross: "Tổng tiền hàng",
  discount: "Giảm giá hóa đơn",
  net: "Khách cần trả",
  cash: "Tiền mặt",
  card: "Thẻ",
  transfer: "Chuyển khoản",
  productCode: "Mã hàng",
  productName: "Tên hàng",
  unit: "ĐVT",
  itemNote: "Ghi chú hàng hóa",
  qty: "Số lượng",
  price: "Đơn giá",
  discPct: "Giảm giá %",
  discAmt: "Giảm giá",
  lineTotal: "Thành tiền",
} as const;

const COMPLETED_STATUS = "Hoàn thành";

export interface ExcelImportItem {
  item_key: string;
  product_code?: string;
  product_name: string;
  unit?: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  discount_ratio: number;
  line_total: number;
  note?: string;
}

export interface ExcelImportPayment {
  payment_method: "cash" | "card" | "transfer";
  amount: number;
  cash_received?: number;
  change_given?: number;
  source: string;
  confidence: string;
}

export interface ExcelImportOrder {
  invoice_code: string;
  purchase_at: string;
  business_date: string;
  branch_name?: string;
  sold_by_name?: string;
  customer_name?: string;
  table_or_order_code?: string;
  status_value?: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  total_payment: number;
  invoice_details: ExcelImportItem[];
  payments: ExcelImportPayment[];
}

export interface ExcelImportPayload {
  source: "excel_import";
  batch_id?: string;
  started_at?: string;
  orders: ExcelImportOrder[];
  meta: { row_count: number; invoice_count: number; skipped_count: number };
}

type Row = Record<string, unknown>;

/** Normalize an Excel time cell (raw serial number, string, or Date) to a NAIVE
 * ISO string ("YYYY-MM-DDTHH:mm:ss[.sss]"). business_date is computed by
 * deriveBusinessDate (which appends +07:00). */
export function excelTimeToIso(raw: unknown): string {
  if (typeof raw === "number") {
    // Excel date serial → naive wall-clock ISO via tz-independent arithmetic.
    // (SheetJS's own Date conversion is tz/precision-lossy, so we read raw serials.)
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 23); // "YYYY-MM-DDTHH:mm:ss.sss"
  }
  if (raw instanceof Date) {
    // Defensive fallback if a reader yields cellDates: treat UTC fields as wall-clock.
    const p = (n: number) => String(n).padStart(2, "0");
    return (
      `${raw.getUTCFullYear()}-${p(raw.getUTCMonth() + 1)}-${p(raw.getUTCDate())}` +
      `T${p(raw.getUTCHours())}:${p(raw.getUTCMinutes())}:${p(raw.getUTCSeconds())}`
    );
  }
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(" ", "T"); // first space → T
  s = s.replace(/([+-]\d{2}:?\d{2}|Z)$/i, ""); // strip any tz marker → naive
  s = s.replace(/(\.\d{3})\d+$/, "$1"); // truncate fractional seconds to 3 digits
  return s;
}

/** Parse a VND/number cell. SheetJS yields real numbers for numeric cells; coerce
 * strings defensively (vi-VN dot/comma thousands), but keep true decimals (e.g. %). */
export function parseVndNumber(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  s = s.replace(/\s/g, "");
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); // 63.000 → 63000
  else if (/^-?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, ""); // 63,000 → 63000
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return s ? s : undefined;
}

/** Build the RPC payload from header-keyed rows. PURE (unit-tested). */
export function buildImportPayloadFromRows(
  rows: Row[],
  opts: { batchId?: string; startedAt?: string } = {},
): ExcelImportPayload {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const code = String(r[H.code] ?? "").trim();
    if (!code) continue;
    const g = groups.get(code);
    if (g) g.push(r);
    else groups.set(code, [r]);
  }

  const orders: ExcelImportOrder[] = [];
  let skipped = 0;

  for (const [code, grp] of groups) {
    const head = grp[0];
    const status = str(head[H.status]);
    if (status && status !== COMPLETED_STATUS) {
      skipped += 1;
      continue;
    }

    const purchase_at = excelTimeToIso(head[H.time]);
    const net = parseVndNumber(head[H.net]);

    const payments: ExcelImportPayment[] = [];
    const cash = parseVndNumber(head[H.cash]);
    const card = parseVndNumber(head[H.card]);
    const transfer = parseVndNumber(head[H.transfer]);
    if (cash > 0)
      payments.push({ payment_method: "cash", amount: cash, cash_received: cash, change_given: 0, source: "kiotviet", confidence: "exact" });
    if (card > 0) payments.push({ payment_method: "card", amount: card, source: "kiotviet", confidence: "exact" });
    if (transfer > 0) payments.push({ payment_method: "transfer", amount: transfer, source: "kiotviet", confidence: "exact" });

    const invoice_details: ExcelImportItem[] = grp.map((r, i) => {
      const quantity = parseVndNumber(r[H.qty]);
      const unit_price = parseVndNumber(r[H.price]);
      const line_total = parseVndNumber(r[H.lineTotal]) || quantity * unit_price;
      return {
        // Unique per line within the order. A product can appear on multiple
        // rows of one invoice, but sales_order_items has
        // unique(sales_order_id, item_key) — so the line index disambiguates.
        // (Re-import deletes+reinserts children, so cross-import stability of
        // the key isn't required.)
        item_key: `${str(r[H.productCode]) ?? code}#${i}`,
        product_code: str(r[H.productCode]),
        product_name: str(r[H.productName]) ?? "Sản phẩm",
        unit: str(r[H.unit]),
        quantity,
        unit_price,
        discount_amount: parseVndNumber(r[H.discAmt]),
        discount_ratio: parseVndNumber(r[H.discPct]) / 100,
        line_total,
        note: str(r[H.itemNote]),
      };
    });

    orders.push({
      invoice_code: code,
      purchase_at,
      business_date: deriveBusinessDate(purchase_at || undefined),
      branch_name: str(head[H.branch]),
      sold_by_name: str(head[H.soldBy]),
      customer_name: str(head[H.customer]),
      table_or_order_code: str(head[H.tableCode]),
      status_value: status,
      gross_amount: parseVndNumber(head[H.gross]),
      discount_amount: parseVndNumber(head[H.discount]),
      net_amount: net,
      total_payment: net,
      invoice_details,
      payments,
    });
  }

  return {
    source: "excel_import",
    batch_id: opts.batchId,
    started_at: opts.startedAt,
    orders,
    meta: { row_count: rows.length, invoice_count: orders.length, skipped_count: skipped },
  };
}

/** Read a KiotViet detail .xlsx buffer → header-keyed rows via SheetJS. Read
 * with raw:true (date cells stay Excel serials → excelTimeToIso handles them
 * tz-safely). exceljs choked on KiotViet's OOXML ('Target' error); SheetJS is
 * tolerant like openpyxl. Loaded lazily so the pure helpers stay test-light. */
export async function parseWorkbookToRows(buffer: Buffer): Promise<Row[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const ws = sheetName ? wb.Sheets[sheetName] : undefined;
  if (!ws) throw new Error("File Excel không có sheet nào.");
  const rows = XLSX.utils.sheet_to_json<Row>(ws, { raw: true, defval: null });
  if (rows.length === 0) throw new Error("File Excel không có dữ liệu.");
  for (const h of [H.code, H.time, H.net] as string[]) {
    if (!(h in rows[0])) {
      throw new Error(`File Excel thiếu cột "${h}". Hãy dùng export "Chi tiết hóa đơn" từ KiotViet.`);
    }
  }
  return rows;
}
