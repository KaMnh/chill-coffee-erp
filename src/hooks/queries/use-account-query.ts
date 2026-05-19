"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCurrentAccount, loadSettingsAccounts } from "@/lib/data";
import { queryKeys } from "./keys";

export function useAccountQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.account(),
    queryFn: () => loadCurrentAccount(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 5 * 60_000
  });
}

export function useSettingsAccountsQuery(
  supabase: SupabaseClient | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.settingsAccounts(),
    queryFn: () => loadSettingsAccounts(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 2 * 60_000
  });
}
