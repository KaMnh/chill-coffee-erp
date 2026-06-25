"use client";

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authHeader } from "@/lib/data/accounts";
import { sendAnchorHeartbeat } from "@/lib/data/checkin";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Anchor heartbeat driver (Task 9, §5.5/§6).
 *
 * If THIS device has been marked as a shop anchor (i.e. localStorage holds
 * `checkin:anchorId` + `checkin:anchorToken`), this hook keeps the anchor's
 * public IP fresh by pinging the heartbeat route:
 *   - once on mount
 *   - on every window `focus`
 *   - every 6h while the tab is open
 *
 * It is a NO-OP on devices without an anchor token (the common case — every
 * logged-in device mounts it once via <AnchorHeartbeat/>). Errors are swallowed
 * by design: a transient heartbeat failure is graceful (the grace_hours window
 * absorbs short gaps; the gate fails closed if the anchor goes truly stale).
 */
export function useAnchorHeartbeat(supabase: SupabaseClient | null): void {
  useEffect(() => {
    if (!supabase) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    async function beat() {
      if (cancelled || !supabase) return;
      const anchorId = window.localStorage.getItem("checkin:anchorId");
      const token = window.localStorage.getItem("checkin:anchorToken");
      if (!anchorId || !token) return; // not an anchor device — no-op
      try {
        const headers = await authHeader(supabase);
        if (!headers.Authorization) return; // no session — skip silently
        await sendAnchorHeartbeat(anchorId, token, headers);
      } catch {
        // grace: swallow — stale anchor is handled by the fresh-anchor gate.
      }
    }

    void beat();
    const onFocus = () => void beat();
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(() => void beat(), SIX_HOURS_MS);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [supabase]);
}
