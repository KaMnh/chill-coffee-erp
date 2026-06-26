"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useAnchorHeartbeat } from "@/hooks/use-anchor-heartbeat";

/**
 * Headless mount-point for the anchor heartbeat (Task 9).
 *
 * Render this ONCE inside the authed shell. On devices that hold an anchor
 * token in localStorage it keeps the shop's public IP fresh; on every other
 * logged-in device it is a no-op. Renders nothing.
 */
export function AnchorHeartbeat(): null {
  const supabase = useSupabase();
  useAnchorHeartbeat(supabase);
  return null;
}
