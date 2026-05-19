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
  payload: { businessDate: string; force?: boolean; reason?: string }
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
      // Sync only the active business date by default; user can extend via Settings UI
      fromDate: payload.businessDate,
      toDate: payload.businessDate,
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
