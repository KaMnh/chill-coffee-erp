"use client";

import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, hasSupabaseConfig } from "@/lib/supabase/client";

/**
 * Returns the singleton Supabase client, or null if env config is missing.
 * Uses useMemo so the same instance is reused across renders.
 */
export function useSupabase(): SupabaseClient | null {
  return useMemo(() => {
    if (!hasSupabaseConfig()) return null;
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);
}
