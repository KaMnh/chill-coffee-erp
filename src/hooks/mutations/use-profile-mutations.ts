"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateUserDashboardPreferences } from "@/lib/data";
import type { DashboardPreferences } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

export interface UpdateDashboardPrefsInput {
  profileId: string;
  patch: Partial<DashboardPreferences>;
}

/**
 * Patch per-user dashboard preferences (vd: stock_sort).
 * Invalidates account query nên Account.dashboard_preferences re-fetch.
 */
export function useUpdateUserDashboardPreferences(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateDashboardPrefsInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateUserDashboardPreferences(supabase, input.profileId, input.patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
    },
  });
}
