"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/use-supabase";
import { useAccountQuery, queryKeys } from "@/hooks/queries";
import type { Account } from "@/lib/types";

export type AuthStatus = "loading" | "authed" | "unauthed";

export interface UseAuthSessionResult {
  status: AuthStatus;
  /** Loaded employee_accounts row for the signed-in Supabase user. null while loading or unauthed. */
  account: Account | null;
  /** True while account row is being fetched after Supabase auth resolves. */
  isLoadingAccount: boolean;
  /** Sign in with email + password. Throws on failure (caller handles UX). */
  signIn(email: string, password: string): Promise<void>;
  /** Sign out + clear cached account row. */
  signOut(): Promise<void>;
  /**
   * Self-signup as viewer. Creates auth user + inserts signup_requests row
   * with status="pending_approval" — owner/manager approves in Settings later.
   * Throws on auth-side error; signup_requests insert failure surfaces as
   * a warning, not a hard error (auth user is already created).
   */
  signupViewer(email: string, password: string, fullName: string): Promise<void>;
}

/**
 * Composes Supabase auth state (getSession + onAuthStateChange) with the
 * existing useAccountQuery so consumers see a single { status, account } pair.
 *
 * Supabase auth doesn't fit useQuery cleanly — session state changes via
 * event listener, not on-demand fetch. We keep the listener pattern from v3
 * (page.tsx lines 99-117) but expose it as a hook for testability.
 */
export function useAuthSession(): UseAuthSessionResult {
  const supabase = useSupabase();
  const queryClient = useQueryClient();
  const [hasSession, setHasSession] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Track unmount so async callbacks don't set state after dispose.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Auth lifecycle — getSession on mount + subscribe to changes.
  useEffect(() => {
    if (!supabase) {
      setAuthChecked(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (!mountedRef.current) return;
      setHasSession(Boolean(data.session));
      setAuthChecked(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mountedRef.current) return;
      setHasSession(Boolean(session));
      setAuthChecked(true);
      if (!session) {
        queryClient.removeQueries({ queryKey: queryKeys.account() });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient, supabase]);

  // Load account row only when authed.
  const accountQuery = useAccountQuery(supabase, hasSession);

  const status: AuthStatus = !authChecked
    ? "loading"
    : hasSession
      ? "authed"
      : "unauthed";

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    queryClient.removeQueries({ queryKey: queryKeys.account() });
  }, [queryClient, supabase]);

  const signupViewer = useCallback(
    async (email: string, password: string, fullName: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { name: fullName } },
      });
      if (error) throw error;
      if (data.user) {
        // Best-effort: row is approved manually later. Failure here doesn't
        // hide the fact that the auth user was created.
        await supabase.from("signup_requests").insert({
          auth_user_id: data.user.id,
          email,
          name: fullName,
          status: "pending_approval",
        });
      }
    },
    [supabase]
  );

  return {
    status,
    account: accountQuery.data ?? null,
    isLoadingAccount: status === "authed" && accountQuery.isLoading,
    signIn,
    signOut,
    signupViewer,
  };
}
