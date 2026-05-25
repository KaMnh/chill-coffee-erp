/**
 * Transform KiotViet FNB API invoices → ingest_kiotviet_batch payload shape.
 * Mirror SQL contract in `database/002_functions.sql:802` (ingest_kiotviet_batch).
 *
 * Differences with KV API:
 * - KV uses camelCase (`purchaseDate`, `productCode`); SQL expects snake_case
 * - KV `total` → `gross_amount`; `totalPayment` → `total_payment`; net = totalPayment
 * - Cash payment: KV doesn't return cash_received/change_given separately — derive when method=cash
 * - business_date derived from purchaseDate
 *
 * **Timezone handling**: KiotViet trả naive timestamp ("2024-05-04T18:00:00",
 * không có TZ marker), đại diện giờ Việt Nam. DB session timezone =
 * 'Asia/Ho_Chi_Minh' (set globally) → PG tự interpret naive string là VN
 * local khi cast timestamptz, không cần convert ở frontend. Nếu KV nào đó
 * trả ISO với Z marker (UTC), PG vẫn parse đúng instant.
 */
import type { KvInvoice, KvInvoiceDetail, KvPayment } from "./types";

type IngestOrderItem = {
  item_key?: string;
  product_id?: string;
  product_code?: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
  discount_amount?: number;
  discount_ratio?: number;
  line_total: number;
  note?: string;
  return_quantity?: number;
  category_name?: string;
};

type IngestOrderPayment = {
  payment_method: string;
  amount: number;
  cash_received?: number | null;
  change_given?: number | null;
  payment_time?: string;
  source: string;
  confidence?: string;
};

type IngestOrder = {
  kiotviet_invoice_id: string;
  invoice_uuid?: string;
  invoice_code: string;
  kiotviet_order_id?: string;
  order_uuid?: string;
  table_or_order_code?: string;
  purchase_at: string;
  business_date: string;
  branch_id?: string;
  branch_name?: string;
  sold_by_id?: string;
  sold_by_name?: string;
  customer_code?: string;
  customer_name?: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  total_payment: number;
  status_code?: string;
  status_value?: string;
  using_cod?: boolean;
  source_created_at?: string;
  invoice_details: IngestOrderItem[];
  payments: IngestOrderPayment[];
};

export type IngestBatchPayload = {
  client_id: string;
  client_secret: string;
  batch_id: string;
  source: "kiotviet";
  started_at: string;
  business_date_from?: string | null;
  business_date_to?: string | null;
  orders: IngestOrder[];
};

/**
 * Derive business_date (YYYY-MM-DD) từ purchase_at ISO string trong múi giờ
 * Asia/Ho_Chi_Minh.
 *
 * Quirk KV: API trả naive timestamp ("2026-05-25T20:58:44", KHÔNG có Z/offset)
 * và string đó đại diện giờ VN (wall-clock). Nếu pass thẳng `new Date(naive)`,
 * JS engine interpret naive theo PROCESS.TZ:
 *   - Server VN tz (laptop dev) → đúng.
 *   - Server UTC tz (container Docker mặc định) → lệch 7h → đơn 17:00-23:59 VN
 *     bị bucket sang ngày kế tiếp (off-by-1).
 *
 * Fix: detect TZ marker. Nếu thiếu, append "+07:00" trước khi parse. Sau khi
 * có instant chính xác, extract date theo wall-clock VN bằng en-CA locale.
 *
 * Test cases (xem __tests__/transform.test.ts):
 *   - Naive evening "2026-05-25T20:58:44"          → "2026-05-25"
 *   - Naive midnight-1 "2026-05-25T23:59:59"       → "2026-05-25"
 *   - Naive midnight+1 "2026-05-26T00:00:01"       → "2026-05-26"
 *   - UTC Z "2026-05-25T13:58:44Z" (= 20:58 VN)    → "2026-05-25"
 *   - Explicit +07 "2026-05-25T20:58:44+07:00"     → "2026-05-25"
 */
export function deriveBusinessDate(purchaseAtIso: string | undefined): string {
  if (!purchaseAtIso) {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  }
  const hasTzMarker = /[Zz]$|[+-]\d{2}:?\d{2}$/.test(purchaseAtIso);
  const normalized = hasTzMarker ? purchaseAtIso : `${purchaseAtIso}+07:00`;
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
  }
  return dt.toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

/**
 * KV payment.method may be a string ("cash"/"transfer"/"card") or numeric code.
 * Normalize to known enum used by SQL: cash | transfer | card | unknown.
 */
function normalizePaymentMethod(raw: string | number | undefined): string {
  if (raw === undefined || raw === null) return "unknown";
  const s = String(raw).toLowerCase().trim();
  if (s === "cash" || s.includes("tien mat") || s.includes("tiền mặt")) return "cash";
  if (s === "transfer" || s.includes("chuyen") || s.includes("chuyển khoản") || s.includes("bank")) return "transfer";
  if (s === "card" || s.includes("the") || s.includes("thẻ")) return "card";
  if (s === "voucher" || s.includes("voucher")) return "voucher";
  return s; // pass-through for visibility
}

function transformItem(item: KvInvoiceDetail, index: number): IngestOrderItem {
  const qty = Number(item.quantity ?? 0);
  const price = Number(item.price ?? 0);
  const disc = Number(item.discount ?? 0);
  const line = Number(item.subTotal ?? qty * price - disc);
  return {
    item_key: `${item.productId ?? "product"}-${index}`,
    product_id: item.productId != null ? String(item.productId) : undefined,
    product_code: item.productCode,
    product_name: item.productName ?? "Sản phẩm",
    quantity: qty,
    unit_price: price,
    discount_amount: disc,
    discount_ratio: Number(item.discountRatio ?? 0),
    line_total: line,
    note: item.note,
    return_quantity: 0,
    category_name: item.categoryName
  };
}

function transformPayment(payment: KvPayment, fallbackTime: string): IngestOrderPayment {
  const method = normalizePaymentMethod(payment.method);
  const amount = Number(payment.amount ?? 0);
  return {
    payment_method: method,
    amount,
    // KV API không trả cash_received/change_given riêng — set null, SQL sẽ fallback.
    cash_received: method === "cash" ? amount : null,
    change_given: method === "cash" ? 0 : null,
    payment_time: payment.transDate ?? fallbackTime,
    source: "kiotviet",
    confidence: "exact"
  };
}

function transformInvoice(invoice: KvInvoice): IngestOrder {
  const purchaseAt = invoice.purchaseDate ?? invoice.createdDate ?? new Date().toISOString();
  const gross = Number(invoice.total ?? 0);
  const discount = Number(invoice.discount ?? 0);
  const totalPayment = Number(invoice.totalPayment ?? gross - discount);

  const items = (invoice.invoiceDetails ?? []).map(transformItem);
  const payments = (invoice.payments ?? [])
    .filter((p) => Number(p.amount ?? 0) > 0)
    .map((p) => transformPayment(p, purchaseAt));

  // Fallback nếu invoice không có payment array — derive từ usingCod
  if (payments.length === 0) {
    payments.push({
      payment_method: invoice.usingCod ? "cash" : "unknown",
      amount: totalPayment,
      cash_received: invoice.usingCod ? totalPayment : null,
      change_given: invoice.usingCod ? 0 : null,
      payment_time: purchaseAt,
      source: "kiotviet",
      confidence: "derived"
    });
  }

  return {
    kiotviet_invoice_id: String(invoice.id),
    invoice_uuid: invoice.uuid,
    invoice_code: invoice.code,
    purchase_at: purchaseAt,
    business_date: deriveBusinessDate(purchaseAt),
    branch_id: invoice.branchId != null ? String(invoice.branchId) : undefined,
    branch_name: invoice.branchName,
    sold_by_id: invoice.soldById != null ? String(invoice.soldById) : undefined,
    sold_by_name: invoice.soldByName,
    customer_code: invoice.customerCode,
    customer_name: invoice.customerName,
    gross_amount: gross,
    discount_amount: discount,
    net_amount: totalPayment,
    total_payment: totalPayment,
    status_code: String(invoice.status ?? ""),
    status_value: invoice.statusValue,
    using_cod: Boolean(invoice.usingCod),
    source_created_at: invoice.createdDate,
    invoice_details: items,
    payments
  };
}

export function buildIngestPayload(
  invoices: KvInvoice[],
  ctx: {
    clientId: string;
    clientSecret: string;
    batchId?: string;
    businessDateFrom?: string;
    businessDateTo?: string;
  }
): IngestBatchPayload {
  return {
    client_id: ctx.clientId,
    client_secret: ctx.clientSecret,
    batch_id: ctx.batchId ?? `kiotviet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    source: "kiotviet",
    started_at: new Date().toISOString(),
    business_date_from: ctx.businessDateFrom ?? null,
    business_date_to: ctx.businessDateTo ?? null,
    orders: invoices.map(transformInvoice)
  };
}
