import type { SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "./_common";
import type { DashboardPreferences } from "@/lib/types";

/**
 * Patch (merge) per-user dashboard preferences.
 *
 * Server validates known keys (vd: stock_sort regex) trong RPC
 * `update_user_dashboard_preferences`. Pass `{ stock_sort: null }` để clear
 * sort preference.
 */
export async function updateUserDashboardPreferences(
  supabase: SupabaseClient,
  profileId: string,
  patch: Partial<DashboardPreferences>
): Promise<DashboardPreferences> {
  const { data, error } = await supabase.rpc("update_user_dashboard_preferences", {
    p_profile_id: profileId,
    p_patch: patch,
  });
  if (error) throw toAppError(error, "Không lưu được tùy chọn dashboard.");
  return (data ?? {}) as DashboardPreferences;
}
