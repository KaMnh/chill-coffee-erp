/**
 * KiotViet OAuth client_credentials token cache.
 * Module-level cache (per-Node-process). For multi-instance Next.js,
 * cache is per-instance — acceptable since token TTL is ~24h and refresh is cheap.
 *
 * Credentials passed in (loaded from app_settings server-side, never from client).
 */
import type { KvCredentials, KvTokenResponse } from "./types";

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
  // Cache key derived from credentials so we don't reuse token across different retailers.
  cacheKey: string;
}

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;

function buildCacheKey(creds: KvCredentials): string {
  // Use client_id + retailer to scope cache; secret intentionally not included
  // (changing secret rotates by clearing cache via clearTokenCache()).
  return `${creds.retailer}:${creds.client_id}`;
}

async function fetchToken(creds: KvCredentials): Promise<CachedToken> {
  const body = new URLSearchParams({
    scopes: creds.scope,
    grant_type: "client_credentials",
    client_id: creds.client_id,
    client_secret: creds.client_secret
  });

  let lastError: unknown = null;
  // 3 attempts with exponential backoff (1s, 2s, 4s)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(creds.token_url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString()
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`KV token HTTP ${res.status}: ${text.slice(0, 300)}`);
      }
      const data = (await res.json()) as KvTokenResponse;
      const expiresAt = Date.now() + data.expires_in * 1000;
      return {
        accessToken: data.access_token,
        expiresAt,
        cacheKey: buildCacheKey(creds)
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("KV token fetch failed");
}

export async function getAccessToken(creds: KvCredentials, forceRefresh = false): Promise<string> {
  const now = Date.now();
  const wantedKey = buildCacheKey(creds);

  if (
    !forceRefresh &&
    cached &&
    cached.cacheKey === wantedKey &&
    cached.expiresAt - now > REFRESH_BUFFER_MS
  ) {
    return cached.accessToken;
  }

  if (inflight) return inflight;
  inflight = (async () => {
    try {
      cached = await fetchToken(creds);
      return cached.accessToken;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function getTokenExpiry(): number | null {
  return cached?.expiresAt ?? null;
}

export function clearTokenCache(): void {
  cached = null;
}
