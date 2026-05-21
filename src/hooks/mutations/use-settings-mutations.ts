"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  updateSidebarDefaults,
  updateUserSidebarConfig,
  updateHandoverDefaultTasks
} from "@/lib/data";
import type { UserRole } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the Settings module — Phase 3C.2.
 *
 * Pattern matches use-cash-mutations.ts: null-supabase guard, useMutation,
 * invalidate dependent query keys on success. No optimistic updates.
 *
 * 3 hooks total:
 *   - useUpdateSidebarDefaults: role matrix toggle (auto-save per cell)
 *   - useUpdateUserSidebarConfig: per-user override (modal explicit Save)
 *   - useUpdateHandoverDefaultTasks: handover template list (full-array writes)
 */

export interface UpdateSidebarDefaultsInput {
  role: UserRole;
  items: string[];
}

export function useUpdateSidebarDefaults(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateSidebarDefaultsInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateSidebarDefaults(supabase, input.role, input.items);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
    }
  });
}

export interface UpdateUserSidebarConfigInput {
  profileId: string;
  items: string[] | null; // null = reset to role default
}

export function useUpdateUserSidebarConfig(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserSidebarConfigInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateUserSidebarConfig(supabase, input.profileId, input.items);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
    }
  });
}

export interface UpdateHandoverDefaultTasksInput {
  tasks: Array<{ key: string; label: string }>;
}

export function useUpdateHandoverDefaultTasks(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverDefaultTasksInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverDefaultTasks(supabase, input.tasks);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
    }
  });
}
