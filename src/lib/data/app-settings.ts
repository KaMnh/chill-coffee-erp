import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSettings } from "@/lib/types";
import { toAppError } from "./_common";

export async function loadAppSettings(supabase: SupabaseClient): Promise<AppSettings> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["sidebar_defaults", "handover_default_tasks", "denominations", "cash_diff_threshold"]);
  if (error) throw toAppError(error, "Không tải được cấu hình.");

  const settings: AppSettings = { sidebar_defaults: {}, handover_default_tasks: [] };
  for (const row of (data ?? []) as Array<{ key: string; value: unknown }>) {
    if (row.key === "sidebar_defaults" && row.value && typeof row.value === "object") {
      settings.sidebar_defaults = row.value as AppSettings["sidebar_defaults"];
    }
    if (row.key === "handover_default_tasks" && Array.isArray(row.value)) {
      settings.handover_default_tasks = row.value as AppSettings["handover_default_tasks"];
    }
    if (row.key === "denominations" && Array.isArray(row.value)) {
      settings.denominations = row.value as number[];
    }
    if (row.key === "cash_diff_threshold" && row.value && typeof row.value === "object") {
      settings.cash_diff_threshold = row.value as Record<string, number>;
    }
  }
  return settings;
}

export async function updateSidebarDefaults(supabase: SupabaseClient, role: string, items: string[]) {
  const { data, error } = await supabase.rpc("update_sidebar_defaults", { p_role: role, p_items: items });
  if (error) throw toAppError(error, "Không cập nhật được sidebar defaults.");
  return data as AppSettings["sidebar_defaults"];
}

export async function updateUserSidebarConfig(supabase: SupabaseClient, profileId: string, items: string[] | null) {
  const { data, error } = await supabase.rpc("update_user_sidebar_config", { p_profile_id: profileId, p_items: items });
  if (error) throw toAppError(error, "Không cập nhật được sidebar cá nhân.");
  return data;
}
