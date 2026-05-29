import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client-side wrappers around `/api/kiotviet/config` (owner/manager-gated).
 *
 * The route masks `client_secret` on read (always empty string + a
 * `client_secret_masked` display string). On write, an empty `client_secret`
 * means "preserve the existing secret" and an empty `webhook_secret` means
 * "revoke the webhook".
 *
 * Auth pattern mirrors `triggerPosSync` in pos-sync.ts.
 */

export interface KvConfigDto {
  retailer: string;
  client_id: string;
  /** Always empty when returned from the server. Send empty to preserve. */
  client_secret: string;
  /** Display-only mask like "••••••a1b2". Present only when a secret is stored. */
  client_secret_masked?: string;
  token_url: string;
  api_base: string;
  scope: string;
  rate_limit_per_sec: number;
  is_active: boolean;
  /** Empty string when no webhook is configured. */
  webhook_secret: string;
  /** Default sync window in days (1..31). */
  sync_window_days?: number;
}

async function getJwt(supabase: SupabaseClient): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Chưa đăng nhập.");
  return token;
}

export async function loadKiotvietConfig(supabase: SupabaseClient): Promise<KvConfigDto> {
  const token = await getJwt(supabase);
  const res = await fetch("/api/kiotviet/config", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: "ok" | "error";
    config?: KvConfigDto;
    error?: string;
  };
  if (!res.ok || json.status !== "ok" || !json.config) {
    throw new Error(json.error ?? `Không tải được cấu hình KiotViet (HTTP ${res.status}).`);
  }
  return json.config;
}

export async function saveKiotvietConfig(
  supabase: SupabaseClient,
  patch: Partial<KvConfigDto>,
): Promise<KvConfigDto> {
  const token = await getJwt(supabase);
  const res = await fetch("/api/kiotviet/config", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch),
  });
  const json = (await res.json().catch(() => ({}))) as {
    status?: "ok" | "error";
    config?: KvConfigDto;
    error?: string;
  };
  if (!res.ok || json.status !== "ok" || !json.config) {
    throw new Error(json.error ?? `Không lưu được cấu hình KiotViet (HTTP ${res.status}).`);
  }
  return json.config;
}
