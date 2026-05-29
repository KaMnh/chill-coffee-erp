import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Trigger KiotViet sync — gọi trực tiếp Next.js API route `/api/kiotviet/sync`.
 * Server-side route đọc kiotviet_credentials từ app_settings và gọi KiotViet API.
 *
 * Returns:
 *   - status: "success" | "skipped" | "error"
 *   - message: human-readable
 *   - ingested: { orders, items, payments } (chỉ khi success)
 */
export async function triggerPosSync(
  supabase: SupabaseClient,
  payload: { businessDate: string; applyWindow?: boolean; force?: boolean; reason?: string }
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Chưa đăng nhập.");

  const res = await fetch("/api/kiotviet/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      // Server resolves the actual range from the owner-only window setting.
      anchorDate: payload.businessDate,
      applyWindow: payload.applyWindow ?? false,
      force: Boolean(payload.force),
      reason: payload.reason ?? "manual_refresh"
    })
  });

  const json = (await res.json().catch(() => ({}))) as {
    status?: "success" | "skipped" | "error";
    message?: string;
    error?: string;
    ingested?: { orders: number; items: number; payments: number };
  };

  if (!res.ok || json.status === "error") {
    throw new Error(json.error ?? json.message ?? `Sync POS thất bại (HTTP ${res.status}).`);
  }

  return {
    status: (json.status === "skipped" ? "skipped" : "triggered") as "triggered" | "skipped",
    message: json.message,
    ingested: json.ingested
  };
}

/**
 * Owner/manager manual backfill of an explicit date range. Always force
 * (bypass the 30s cooldown). Returns fetched/ingested counts + truncated flag.
 */
export async function triggerPosRangeSync(
  supabase: SupabaseClient,
  payload: { fromDate: string; toDate: string; reason?: string }
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Chưa đăng nhập.");

  const res = await fetch("/api/kiotviet/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      force: true,
      reason: payload.reason ?? "manual_range"
    })
  });

  const json = (await res.json().catch(() => ({}))) as {
    status?: "success" | "skipped" | "error";
    message?: string;
    error?: string;
    fetched?: number;
    ingested?: { orders: number; items: number; payments: number };
    truncated?: boolean;
  };

  if (!res.ok || json.status === "error") {
    throw new Error(json.error ?? json.message ?? `Sync khoảng ngày thất bại (HTTP ${res.status}).`);
  }

  return {
    status: (json.status ?? "success") as "success" | "skipped",
    message: json.message,
    fetched: json.fetched ?? 0,
    ingested: json.ingested,
    truncated: Boolean(json.truncated)
  };
}
