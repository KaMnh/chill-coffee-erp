"use client";

import { useEffect } from "react";
import { sendAnchorHeartbeat } from "@/lib/data/checkin";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Anchor heartbeat driver (Task 9, §5.5/§6; token-only since 2026-06-26).
 *
 * If THIS device has been marked as a shop anchor (i.e. localStorage holds
 * `checkin:anchorId` + `checkin:anchorToken`), this hook keeps the anchor's
 * public IP fresh by pinging the heartbeat route:
 *   - once on mount
 *   - on every window `focus`
 *   - every 6h while the tab is open
 *
 * Authentication is the DEVICE TOKEN alone — no login session is needed — so the
 * shop's always-on device keeps its IP fresh under ANY session (manager/staff).
 * It is a NO-OP on devices without an anchor token. Errors are swallowed: a
 * transient failure is graceful (grace_hours absorbs short gaps; the gate fails
 * closed if the anchor goes truly stale).
 */
export function useAnchorHeartbeat(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;

    async function beat() {
      if (cancelled) return;
      const anchorId = window.localStorage.getItem("checkin:anchorId");
      const token = window.localStorage.getItem("checkin:anchorToken");
      if (!anchorId || !token) return; // not an anchor device — no-op
      try {
        await sendAnchorHeartbeat(anchorId, token);
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
  }, []);
}
