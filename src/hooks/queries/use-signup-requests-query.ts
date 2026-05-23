"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPendingSignupRequests } from "@/lib/data";
import { queryKeys } from "./keys";

export function useSignupRequestsQuery(
  supabase: SupabaseClient | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: queryKeys.signupRequests(),
    queryFn: () => loadPendingSignupRequests(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}
