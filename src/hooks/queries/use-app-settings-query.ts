"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAppSettings } from "@/lib/data";
import { queryKeys } from "./keys";

export function useAppSettingsQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.appSettings(),
    queryFn: () => loadAppSettings(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 5 * 60_000
  });
}
