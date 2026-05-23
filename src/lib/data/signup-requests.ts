import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignupRequest, UserRole } from "@/lib/types";
import { toAppError } from "./_common";

async function authHeader(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Load all signup_requests rows with status="pending_approval".
 *
 * RLS already restricts SELECT to owner/manager (or self) — verified in
 * database/003_rls.sql policy `signup_select_self_admin`. No RPC needed.
 */
export async function loadPendingSignupRequests(
  supabase: SupabaseClient
): Promise<SignupRequest[]> {
  const { data, error } = await supabase
    .from("signup_requests")
    .select(
      "id, auth_user_id, email, name, employee_code, status, requested_at, reviewed_by, reviewed_at, note"
    )
    .eq("status", "pending_approval")
    .order("requested_at", { ascending: false });
  if (error) throw toAppError(error, "Không tải được danh sách đơn đăng ký.");
  return (data ?? []) as SignupRequest[];
}

/** Approve a pending signup_request, picking a role for the new account. */
export async function approveSignupRequest(
  supabase: SupabaseClient,
  id: string,
  role: UserRole
): Promise<void> {
  const headers = { ...(await authHeader(supabase)), "Content-Type": "application/json" };
  const res = await fetch(`/api/signup-requests/${id}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ role })
  });
  const json = (await res.json()) as { status: string; error?: string; warning?: string };
  if (!res.ok || (json.status !== "ok" && json.status !== "ok_with_warning")) {
    throw new Error(json.error ?? `Duyệt thất bại (HTTP ${res.status}).`);
  }
  if (json.status === "ok_with_warning" && json.warning) {
    // Account exists but signup_requests.status didn't flip — surface to the
    // caller via a non-fatal warning. Caller can choose to toast or log.
    // eslint-disable-next-line no-console
    console.warn("[approveSignupRequest] partial success:", json.warning);
  }
}

/** Reject a pending signup_request. Optional note for audit. */
export async function rejectSignupRequest(
  supabase: SupabaseClient,
  id: string,
  note?: string
): Promise<void> {
  const headers = { ...(await authHeader(supabase)), "Content-Type": "application/json" };
  const res = await fetch(`/api/signup-requests/${id}/reject`, {
    method: "POST",
    headers,
    body: JSON.stringify({ note })
  });
  const json = (await res.json()) as { status: string; error?: string };
  if (!res.ok || json.status !== "ok") {
    throw new Error(json.error ?? `Từ chối thất bại (HTTP ${res.status}).`);
  }
}
