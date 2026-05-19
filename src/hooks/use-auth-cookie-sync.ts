"use client";

import { useEffect } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

const AUTH_COOKIE = "chill-auth-state";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function setAuthCookie(value: "1" | "0") {
  if (typeof document === "undefined") return;
  if (value === "1") {
    document.cookie = `${AUTH_COOKIE}=1; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
  } else {
    document.cookie = `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}

/**
 * Mirror Supabase session state into a sentinel cookie so that the
 * Next.js middleware can do defense-in-depth checks (no flash of protected
 * shell). The cookie is NOT a security boundary — RLS is. Forgeable, so
 * never trust it server-side beyond UX routing.
 */
export function useAuthCookieSync(supabase: SupabaseClient | null) {
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setAuthCookie(data.session ? "1" : "0");
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthCookie(session ? "1" : "0");
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [supabase]);
}
