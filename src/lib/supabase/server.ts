/**
 * Server-side Supabase clients for Next.js API routes.
 * - `getServiceRoleClient()`: bypasses RLS — use ONLY in API routes/server code.
 *    Never import in 'use client' components.
 * - `getUserClient(authHeader)`: uses caller's JWT, RLS applies.
 *
 * Env vars:
 *   NEXT_PUBLIC_SUPABASE_URL — public (set in client + server)
 *   SUPABASE_INTERNAL_URL — optional; server-side URL override (e.g. http://kong:8000 inside Docker)
 *   SUPABASE_SERVICE_ROLE_KEY — server-only, NEVER expose to browser
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { UserRole } from "@/lib/types";

export function getServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY env. " +
        "Service role chỉ dùng server-side."
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * Build a client scoped to the caller's JWT (passed via Authorization: Bearer header).
 * RLS policies will apply as if the user is making the request directly.
 */
export function getUserClient(authHeader: string | null): SupabaseClient {
  const url = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY env.");
  }
  const headers: Record<string, string> = {};
  if (authHeader) headers.Authorization = authHeader;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers }
  });
}

/**
 * Verify the caller's JWT and return their employee_account row.
 * Throws if not authenticated, not active, or role not in allowedRoles.
 */
export async function requireAuth(
  authHeader: string | null,
  allowedRoles: Array<UserRole>
): Promise<{
  userId: string;
  role: UserRole;
}> {
  if (!authHeader) {
    throw new Error("Thiếu Authorization header.");
  }
  const userClient = getUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    throw new Error("Token không hợp lệ.");
  }

  // Use service role to read employee_accounts (avoid RLS recursion)
  const admin = getServiceRoleClient();
  const { data: account, error: accountError } = await admin
    .from("employee_accounts")
    .select("role, status")
    .eq("auth_user_id", userData.user.id)
    .maybeSingle();
  if (accountError || !account) {
    throw new Error("Không tìm thấy tài khoản employee_accounts.");
  }
  if (account.status !== "active") {
    throw new Error("Tài khoản chưa active.");
  }
  if (!allowedRoles.includes(account.role as never)) {
    throw new Error(`Role ${account.role} không có quyền (cần: ${allowedRoles.join(", ")}).`);
  }
  return { userId: userData.user.id, role: account.role };
}

/** Only an owner may grant/modify the `owner` role. Throws (caller maps to 403). */
export function assertCanAssignRole(approverRole: UserRole, targetRole: UserRole): void {
  if (targetRole === "owner" && approverRole !== "owner") {
    throw new Error("Chỉ owner mới được cấp quyền owner.");
  }
}

/** Only an owner may modify an account that is currently an owner (demote, disable, etc.). Throws → 403. */
export function assertCanModifyTarget(approverRole: UserRole, currentTargetRole: UserRole): void {
  if (currentTargetRole === "owner" && approverRole !== "owner") {
    throw new Error("Chỉ owner mới được sửa tài khoản owner.");
  }
}
