"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listShopAnchors } from "@/lib/data/checkin";
import { queryKeys } from "./keys";

export function useShopAnchorsQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.shopAnchors(),
    queryFn: () => listShopAnchors(supabase!),
    enabled: enabled && !!supabase,
  });
}
