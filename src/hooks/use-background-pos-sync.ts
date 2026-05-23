"use client";

import { useEffect, useRef } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { UserRole } from "@/lib/types";

const RESUME_THRESHOLD_MS = 60_000; // 60s hidden → resume triggers a sync
const BACKGROUND_INTERVAL_MS = 120_000; // 2 min between visible ticks

type SyncVars = { force: boolean; reason: string };
type PosSyncMutation = UseMutationResult<unknown, unknown, SyncVars, unknown>;

/**
 * Predictive background POS sync — composes the existing usePosSync mutation
 * so the app refreshes KiotViet data while the user is actually using it,
 * without requiring a manual click or external cron.
 *
 * Two triggers:
 *   1. Visibility resume — when the tab was hidden ≥ RESUME_THRESHOLD_MS and
 *      becomes visible again, fire a non-forced sync. The route's existing
 *      30s cooldown deduplicates against any concurrent request.
 *   2. Periodic interval — every BACKGROUND_INTERVAL_MS while the tab is
 *      visible. Paused (timer cleared) when the tab hides; restarted on
 *      visibility-gain.
 *
 * No-op for `employee_viewer` and when supabase/account are not yet ready.
 * Errors are swallowed; manual sync still surfaces toast on demand.
 *
 * Pair with realtime invalidation (already wired via useRealtimeInvalidate)
 * for the data-update path: a successful sync inserts a `sales_sync_runs`
 * row, which invalidates the dashboard query, which refetches numbers
 * without touching React form state.
 */
export function useBackgroundPosSync(
  posSync: PosSyncMutation,
  role: UserRole | undefined,
): void {
  const lastHiddenAtRef = useRef<number | null>(null);
  // Latest mutate ref so the visibilitychange listener / interval always call
  // the current mutation without re-registering on every render.
  const mutateRef = useRef(posSync.mutate);
  mutateRef.current = posSync.mutate;
  const roleRef = useRef(role);
  roleRef.current = role;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!role || role === "employee_viewer") return;

    function isGated(): boolean {
      const r = roleRef.current;
      return !r || r === "employee_viewer";
    }

    let intervalId: ReturnType<typeof setInterval> | null = null;

    function startInterval() {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        if (isGated()) return;
        mutateRef.current({ force: false, reason: "background_interval" });
      }, BACKGROUND_INTERVAL_MS);
    }

    function stopInterval() {
      if (intervalId === null) return;
      clearInterval(intervalId);
      intervalId = null;
    }

    function onVisibilityChange() {
      if (document.hidden) {
        lastHiddenAtRef.current = Date.now();
        stopInterval();
        return;
      }
      // Becoming visible.
      const hiddenAt = lastHiddenAtRef.current;
      lastHiddenAtRef.current = null;
      if (
        hiddenAt !== null &&
        Date.now() - hiddenAt >= RESUME_THRESHOLD_MS &&
        !isGated()
      ) {
        mutateRef.current({ force: false, reason: "visibility_resume" });
      }
      startInterval();
    }

    // Start the interval immediately if the page is currently visible.
    if (!document.hidden) startInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopInterval();
    };
    // Effect re-runs only when role transitions in/out of viewer — that
    // guards the listener registration. Mutate is referenced via ref above.
  }, [role]);
}
