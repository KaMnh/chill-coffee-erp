"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMyCheckinStatus } from "@/lib/data/checkin";
import { queryKeys } from "./keys";

export function useMyCheckinStatusQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.myCheckinStatus(),
    queryFn: () => getMyCheckinStatus(supabase!),
    enabled: enabled && !!supabase,
  });
}
