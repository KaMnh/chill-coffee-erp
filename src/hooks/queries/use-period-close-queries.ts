"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPeriodClosePreview, loadPeriodCloses } from "@/lib/data";
import { queryKeys } from "./keys";

/** Kỳ đang mở (preview). Owner-only — gate bằng `enabled`. Stale 30s. */
export function usePeriodClosePreviewQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.periodClosePreview(),
    queryFn: () => loadPeriodClosePreview(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 30_000
  });
}

/** Lịch sử các lần kết kỳ. Stale 1 phút. */
export function usePeriodClosesQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.periodCloses(),
    queryFn: () => loadPeriodCloses(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}
