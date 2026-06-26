import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAccountedEmployeeIds } from "@/lib/data/accounts";
import { queryKeys } from "./keys";

/** Which employees already have a login account (owner/manager only). */
export function useAccountedEmployeeIdsQuery(supabase: SupabaseClient | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.accountedEmployeeIds(),
    enabled: enabled && !!supabase,
    queryFn: () => loadAccountedEmployeeIds(supabase!)
  });
}
