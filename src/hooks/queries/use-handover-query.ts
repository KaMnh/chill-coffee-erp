"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadHandoverSession } from "@/lib/data";
import { queryKeys } from "./keys";

export function useHandoverQuery(supabase: SupabaseClient | null, businessDate: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.handover(businessDate),
    queryFn: () => loadHandoverSession(supabase!, businessDate).catch(() => null),
    enabled: enabled && !!supabase,
    staleTime: 30_000
  });
}
