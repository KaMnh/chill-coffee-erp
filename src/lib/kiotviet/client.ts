/**
 * KiotViet FNB API client.
 * - Per-call rate limit (TokenBucket scoped per-credentials)
 * - 401 → auto refresh token + retry once
 * - 429/5xx → exponential backoff retry (3 attempts, 1s/2s/4s)
 * - Uses native fetch (Node 18+)
 *
 * Stateless except for auth token cache (in `auth.ts`).
 */
import { clearTokenCache, getAccessToken } from "./auth";
import type { KvBranch, KvCredentials, KvInvoice, KvListResponse, KvProduct } from "./types";

class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;
  constructor(
    private capacity: number,
    private refillPerSec: number
  ) {
    this.tokens = capacity;
    this.lastRefillAt = Date.now();
  }
  async acquire(): Promise<void> {
    while (true) {
      const now = Date.now();
      const elapsed = (now - this.lastRefillAt) / 1000;
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
      this.lastRefillAt = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const wait = Math.ceil((1 - this.tokens) / this.refillPerSec * 1000);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// Module-level bucket — shared per Node process. Capacity = configured rate.
let bucket: TokenBucket | null = null;
function ensureBucket(rps: number): TokenBucket {
  if (!bucket) bucket = new TokenBucket(rps, rps);
  return bucket;
}

export class KvApiError extends Error {
  constructor(
    public statusCode: number,
    public path: string,
    public body: string
  ) {
    super(`KV API ${statusCode} on ${path}: ${body.slice(0, 200)}`);
    this.name = "KvApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

function buildUrl(creds: KvCredentials, path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, creds.api_base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function rawRequest(
  creds: KvCredentials,
  path: string,
  opts: RequestOptions,
  token: string
): Promise<{ statusCode: number; body: string }> {
  const url = buildUrl(creds, path, opts.query);
  await ensureBucket(creds.rate_limit_per_sec).acquire();
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      Retailer: creds.retailer,
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const body = await res.text();
  return { statusCode: res.status, body };
}

async function apiRequest<T>(creds: KvCredentials, path: string, opts: RequestOptions = {}): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      let token = await getAccessToken(creds);
      let res = await rawRequest(creds, path, opts, token);
      if (res.statusCode === 401) {
        clearTokenCache();
        token = await getAccessToken(creds, true);
        res = await rawRequest(creds, path, opts, token);
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (!res.body) return undefined as T;
        return JSON.parse(res.body) as T;
      }
      throw new KvApiError(res.statusCode, path, res.body);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof KvApiError
          ? error.statusCode === 429 || error.statusCode >= 500
          : true; // network / parse errors → retry
      if (!retryable || attempt === 3) break;
      const delay = Math.min(8000, 1000 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("KV request failed");
}

// ---- Endpoints -------------------------------------------------------------

export async function getInvoiceById(creds: KvCredentials, id: number | string): Promise<KvInvoice> {
  return apiRequest<KvInvoice>(creds, `/invoices/${id}`, {
    query: { includePayment: true, includeOrderDelivery: false }
  });
}

export interface ListInvoicesParams {
  lastModifiedFrom?: string;
  fromPurchaseDate?: string;
  toPurchaseDate?: string;
  pageSize?: number;
  currentItem?: number;
  branchIds?: string;
  orderBy?: string;
  orderDirection?: "Asc" | "Desc";
}

export async function listInvoices(
  creds: KvCredentials,
  params: ListInvoicesParams
): Promise<KvListResponse<KvInvoice>> {
  return apiRequest<KvListResponse<KvInvoice>>(creds, "/invoices", {
    query: {
      pageSize: params.pageSize ?? 100,
      currentItem: params.currentItem ?? 0,
      includePayment: true,
      includeOrderDelivery: false,
      includeInvoiceDelivery: false,
      lastModifiedFrom: params.lastModifiedFrom,
      fromPurchaseDate: params.fromPurchaseDate,
      toPurchaseDate: params.toPurchaseDate,
      branchIds: params.branchIds,
      orderBy: params.orderBy ?? "modifiedDate",
      orderDirection: params.orderDirection ?? "Asc"
    }
  });
}

export async function getProductById(creds: KvCredentials, id: number | string): Promise<KvProduct> {
  return apiRequest<KvProduct>(creds, `/products/${id}`);
}

export async function listBranches(creds: KvCredentials): Promise<KvListResponse<KvBranch>> {
  return apiRequest<KvListResponse<KvBranch>>(creds, "/branches", {
    query: { pageSize: 100 }
  });
}
