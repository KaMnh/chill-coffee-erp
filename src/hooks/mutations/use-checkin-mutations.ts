"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addShopAnchor,
  removeShopAnchor,
  updateCheckinNetworkConfig,
} from "@/lib/data/checkin";
import type { CheckinNetworkConfig } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the owner anchor/gate panel — Task 9.
 *
 * Pattern matches use-settings-mutations.ts: null-supabase guard, useMutation,
 * invalidate dependent query keys on success.
 *   - useAddShopAnchor / useRemoveShopAnchor → invalidate shopAnchors()
 *   - useUpdateCheckinNetworkConfig          → invalidate appSettings()
 */

export interface AddShopAnchorInput {
  label: string;
  tokenHash: string;
}

export function useAddShopAnchor(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddShopAnchorInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return addShopAnchor(supabase, input.label, input.tokenHash);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shopAnchors() });
    },
  });
}

export function useRemoveShopAnchor(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (anchorId: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return removeShopAnchor(supabase, anchorId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shopAnchors() });
    },
  });
}

export function useUpdateCheckinNetworkConfig(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: CheckinNetworkConfig) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateCheckinNetworkConfig(supabase, config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
    },
  });
}
