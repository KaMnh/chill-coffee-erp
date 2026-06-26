import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account, SettingsAccount, UserRole } from "@/lib/types";
import { toAppError } from "./_common";

export async function authHeader(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type CreateUserPayload = {
  email: string;
  password: string;
  name: string;
  role: UserRole;
  position?: string;
  hourly_rate?: number;
  code?: string;
  /** Link to an existing employee instead of creating a new one (avoids duplicates). */
  employee_id?: string;
};

export type UnlinkedAccount = { auth_user_id: string; email: string; role: UserRole };

/** Tạo user mới qua /api/users (owner/manager only). */
export async function createUserAccount(supabase: SupabaseClient, payload: CreateUserPayload) {
  const headers = { ...(await authHeader(supabase)), "Content-Type": "application/json" };
  const res = await fetch("/api/users", {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  const json = (await res.json()) as { status: string; error?: string; auth_user_id?: string; employee_id?: string };
  if (!res.ok || json.status !== "ok") {
    throw new Error(json.error ?? `Tạo user thất bại (HTTP ${res.status}).`);
  }
  return json;
}

/** Update role / status / employee fields qua PATCH /api/users/<id>. */
export async function updateUserAccount(
  supabase: SupabaseClient,
  authUserId: string,
  patch: {
    role?: UserRole;
    status?: "active" | "disabled";
    name?: string;
    position?: string;
    hourly_rate?: number;
    /** Link this (currently unlinked) account to an existing employee. */
    employee_id?: string;
  }
) {
  const headers = { ...(await authHeader(supabase)), "Content-Type": "application/json" };
  const res = await fetch(`/api/users/${authUserId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(patch)
  });
  const json = (await res.json()) as { status: string; error?: string };
  if (!res.ok || json.status !== "ok") {
    throw new Error(json.error ?? `Cập nhật thất bại (HTTP ${res.status}).`);
  }
}

/** Soft delete: disable account. KHÔNG xóa hẳn auth user. */
export async function deactivateUserAccount(supabase: SupabaseClient, authUserId: string) {
  const headers = await authHeader(supabase);
  const res = await fetch(`/api/users/${authUserId}`, { method: "DELETE", headers });
  const json = (await res.json()) as { status: string; error?: string };
  if (!res.ok || json.status !== "ok") {
    throw new Error(json.error ?? `Vô hiệu hóa thất bại (HTTP ${res.status}).`);
  }
}

export async function loadCurrentAccount(supabase: SupabaseClient): Promise<Account | null> {
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("employee_accounts")
    .select("id, auth_user_id, employee_id, role, status, employees(name, position)")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) throw toAppError(error, "Không tải được tài khoản.");
  if (!data) return null;

  // Pull profile dashboard_preferences (best-effort; missing profile is fine).
  const { data: profile } = await supabase
    .from("profiles")
    .select("dashboard_preferences")
    .eq("id", user.id)
    .maybeSingle();

  const row = data as unknown as Account & { employees?: Account["employee"] };
  return {
    id: row.id,
    auth_user_id: row.auth_user_id,
    employee_id: row.employee_id,
    role: row.role,
    status: row.status,
    employee: row.employees ?? row.employee ?? null,
    dashboard_preferences: (profile?.dashboard_preferences as Account["dashboard_preferences"]) ?? null
  };
}

export async function loadSettingsAccounts(supabase: SupabaseClient): Promise<SettingsAccount[]> {
  const { data, error } = await supabase
    .from("employee_accounts")
    .select("id, auth_user_id, role, status, employees(name, position)")
    .order("role", { ascending: true });
  if (error) throw toAppError(error, "Không tải được danh sách tài khoản.");

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const profileIds = rows.map((row) => row.auth_user_id).filter(Boolean) as string[];
  const { data: profiles, error: profileError } = profileIds.length
    ? await supabase.from("profiles").select("id, sidebar_config").in("id", profileIds)
    : { data: [], error: null };
  if (profileError) throw toAppError(profileError, "Không tải được profile.");

  const profileMap = new Map(
    (profiles ?? []).map((profile: { id: string; sidebar_config: string[] | null }) => [profile.id, profile.sidebar_config])
  );
  return rows.map((row) => {
    const employee = row.employees as { name?: string | null; position?: string | null } | null;
    return {
      id: row.id as string,
      auth_user_id: row.auth_user_id as string,
      role: row.role as SettingsAccount["role"],
      status: row.status as string,
      employee_name: employee?.name ?? null,
      employee_position: employee?.position ?? null,
      sidebar_config: profileMap.get(row.auth_user_id as string) ?? null
    };
  });
}

/** employee_ids that already have a login account (owner/manager via RLS). */
export async function loadAccountedEmployeeIds(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("employee_accounts")
    .select("employee_id")
    .not("employee_id", "is", null);
  if (error) throw toAppError(error, "Không tải được liên kết tài khoản.");
  return (data ?? [])
    .map((r) => (r as { employee_id: string | null }).employee_id)
    .filter((id): id is string => Boolean(id));
}

/** Active accounts not yet attached to any employee (for the "liên kết" picker). */
export async function fetchUnlinkedAccounts(supabase: SupabaseClient): Promise<UnlinkedAccount[]> {
  const res = await fetch("/api/users/unlinked", { headers: await authHeader(supabase) });
  const json = (await res.json().catch(() => ({}))) as { status?: string; accounts?: UnlinkedAccount[]; error?: string };
  if (!res.ok || json.status !== "ok") throw new Error(json.error ?? "Không tải được tài khoản chưa gắn.");
  return json.accounts ?? [];
}
