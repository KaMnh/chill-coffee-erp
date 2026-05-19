/**
 * Sync orchestrator: fetch invoices từ KiotViet API → transform → ingest vào Supabase.
 *
 * Manual trigger flow (Phase 1):
 *   1. Load credentials từ app_settings.kiotviet_credentials
 *   2. Determine date range (default: today; manual override OK)
 *   3. Page through KV /invoices?fromPurchaseDate=...&toPurchaseDate=...
 *   4. Build ingest payload (mirror ingest_kiotviet_batch contract)
 *   5. Call RPC public.ingest_kiotviet_batch
 *
 * Auth chain: Caller authenticated as owner/manager/staff_operator → Next.js API route
 *   → loads kiotviet_credentials (server-side, never exposed) → loads INGEST_CLIENT_ID/SECRET
 *   from env → calls RPC.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listInvoices } from "./client";
import { buildIngestPayload } from "./transform";
import type { KvCredentials, KvInvoice } from "./types";
import { DEFAULT_KV_CREDENTIALS } from "./types";

export type SyncOptions = {
  /** Default: today. Format: 'YYYY-MM-DD'. */
  fromDate?: string;
  /** Default: same as fromDate. */
  toDate?: string;
  /** Default: 100; max page size from KV API. */
  pageSize?: number;
  /** Hard cap on pages to prevent runaway loops (default: 50 → 5000 invoices). */
  maxPages?: number;
};

export type SyncResult = {
  status: "success" | "skipped" | "error";
  message: string;
  fetched: number;
  ingested: { orders: number; items: number; payments: number } | null;
  run_id?: string;
  pages_scanned: number;
};

export async function loadKvCredentials(supabase: SupabaseClient): Promise<KvCredentials> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "kiotviet_credentials")
    .maybeSingle();
  if (error) throw new Error(`Không tải được kiotviet_credentials: ${error.message}`);
  if (!data?.value) return { ...DEFAULT_KV_CREDENTIALS };
  return { ...DEFAULT_KV_CREDENTIALS, ...(data.value as Partial<KvCredentials>) };
}

export async function saveKvCredentials(
  supabase: SupabaseClient,
  patch: Partial<KvCredentials>
): Promise<KvCredentials> {
  // Load current to merge — preserve fields not in patch.
  const current = await loadKvCredentials(supabase);
  const merged: KvCredentials = { ...current, ...patch };

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "kiotviet_credentials",
      value: merged,
      is_public: false,
      updated_at: new Date().toISOString()
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(`Không lưu được kiotviet_credentials: ${error.message}`);
  return merged;
}

/**
 * Trả về credentials với client_secret bị mask (chỉ show 4 ký tự cuối).
 * webhook_secret được trả nguyên (vì client cần copy nó vào KiotViet manager
 * khi đăng ký webhook). Owner-only access qua RLS đảm bảo không leak ra non-admin.
 */
export function maskCredentials(creds: KvCredentials): KvCredentials & { client_secret_masked: string } {
  const secret = creds.client_secret ?? "";
  const masked = secret.length > 4 ? `••••••${secret.slice(-4)}` : secret ? "••••" : "";
  return {
    ...creds,
    client_secret: "", // never return real secret to client
    client_secret_masked: masked
  };
}

/** Generate cryptographically random hex secret 32 chars (16 bytes). */
export function generateWebhookSecret(): string {
  const bytes = new Uint8Array(16);
  // crypto.getRandomValues works in Node 19+ + Edge runtime
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function todayIso(): string {
  // Sync date default: VN today thay vì UTC. Sync API gọi với business_date_from
  // / _to → cần khớp với DB session VN tz.
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" });
}

/**
 * Main sync entry. Throws on fatal error; partial pages still ingested before throw.
 */
export async function runSync(
  supabase: SupabaseClient,
  ingestClientId: string,
  ingestClientSecret: string,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const creds = await loadKvCredentials(supabase);
  if (!creds.is_active) {
    return {
      status: "skipped",
      message: "Tích hợp KiotViet đang tắt (is_active=false). Bật trong Settings.",
      fetched: 0,
      ingested: null,
      pages_scanned: 0
    };
  }
  if (!creds.client_id || !creds.client_secret || !creds.retailer) {
    return {
      status: "skipped",
      message: "Thiếu KiotViet client_id / client_secret / retailer. Cấu hình trong Settings.",
      fetched: 0,
      ingested: null,
      pages_scanned: 0
    };
  }

  const fromDate = options.fromDate ?? todayIso();
  const toDate = options.toDate ?? fromDate;
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 50;

  // Pagination loop — KV uses `currentItem` offset (0-based).
  const allInvoices: KvInvoice[] = [];
  let currentItem = 0;
  let pagesScanned = 0;
  let total = 0;

  for (let page = 0; page < maxPages; page++) {
    const resp = await listInvoices(creds, {
      fromPurchaseDate: `${fromDate} 00:00:00`,
      toPurchaseDate: `${toDate} 23:59:59`,
      pageSize,
      currentItem,
      orderBy: "purchaseDate",
      orderDirection: "Asc"
    });
    pagesScanned += 1;
    total = resp.total ?? 0;
    if (!Array.isArray(resp.data) || resp.data.length === 0) break;
    allInvoices.push(...resp.data);
    currentItem += resp.data.length;
    if (allInvoices.length >= total) break;
  }

  if (allInvoices.length === 0) {
    return {
      status: "success",
      message: "Không có hóa đơn nào trong khoảng thời gian.",
      fetched: 0,
      ingested: { orders: 0, items: 0, payments: 0 },
      pages_scanned: pagesScanned
    };
  }

  // Build payload + call ingest RPC
  const payload = buildIngestPayload(allInvoices, {
    clientId: ingestClientId,
    clientSecret: ingestClientSecret,
    businessDateFrom: fromDate,
    businessDateTo: toDate
  });

  const { data, error } = await supabase.rpc("ingest_kiotviet_batch", {
    p_payload: payload
  });
  if (error) {
    throw new Error(`ingest_kiotviet_batch failed: ${error.message}`);
  }
  const result = data as {
    run_id?: string;
    inserted_or_updated_orders?: number;
    items?: number;
    payments?: number;
    status?: string;
  };

  return {
    status: "success",
    message: `Đã sync ${result.inserted_or_updated_orders ?? 0} hóa đơn (${result.items ?? 0} items, ${result.payments ?? 0} payments).`,
    fetched: allInvoices.length,
    ingested: {
      orders: result.inserted_or_updated_orders ?? 0,
      items: result.items ?? 0,
      payments: result.payments ?? 0
    },
    run_id: result.run_id,
    pages_scanned: pagesScanned
  };
}
