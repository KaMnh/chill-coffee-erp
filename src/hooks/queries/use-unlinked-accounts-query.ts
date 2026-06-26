import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchUnlinkedAccounts } from "@/lib/data/accounts";
import { queryKeys } from "./keys";

/** Active accounts not yet attached to any employee (owner/manager only). */
export function useUnlinkedAccountsQuery(supabase: SupabaseClient | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.unlinkedAccounts(),
    enabled: enabled && !!supabase,
    queryFn: () => fetchUnlinkedAccounts(supabase!)
  });
}
