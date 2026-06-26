"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  updateSidebarDefaults,
  updateUserSidebarConfig,
  updateHandoverDefaultTasks,
  updateShiftBonusConfig,
  createUserAccount,
  updateUserAccount,
  deactivateUserAccount,
  repointAccount,
  approveSignupRequest,
  rejectSignupRequest,
  type CreateUserPayload
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

export interface UpdateShiftBonusConfigInput {
  threshold_hours: number;
  bonus_amount: number;
}

export function useUpdateShiftBonusConfig(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateShiftBonusConfigInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateShiftBonusConfig(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appSettings() });
    }
  });
}

// ---------------------------------------------------------------------------
// User management mutations (Phase 6+)
// ---------------------------------------------------------------------------

export function useCreateUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateUserPayload) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return createUserAccount(supabase, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.accountedEmployeeIds() });
      queryClient.invalidateQueries({ queryKey: queryKeys.unlinkedAccounts() });
    }
  });
}

export interface UpdateUserInput {
  authUserId: string;
  patch: {
    role?: UserRole;
    status?: "active" | "disabled";
    name?: string;
    position?: string;
    hourly_rate?: number;
    employee_id?: string;
  };
}

export function useUpdateUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateUserInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateUserAccount(supabase, input.authUserId, input.patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
      queryClient.invalidateQueries({ queryKey: queryKeys.accountedEmployeeIds() });
      queryClient.invalidateQueries({ queryKey: queryKeys.unlinkedAccounts() });
    }
  });
}

export function useDeactivateUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (authUserId: string) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deactivateUserAccount(supabase, authUserId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
    }
  });
}

export interface RepointUserInput {
  authUserId: string;
  targetEmployeeId: string;
  sourceEmployeeId: string;
}

export function useRepointUser(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RepointUserInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return repointAccount(
        supabase,
        input.authUserId,
        input.targetEmployeeId,
        input.sourceEmployeeId
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.account() });
      queryClient.invalidateQueries({ queryKey: queryKeys.accountedEmployeeIds() });
      queryClient.invalidateQueries({ queryKey: queryKeys.unlinkedAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.employees() });
    }
  });
}

export interface ApproveSignupInput {
  id: string;
  role: UserRole;
}

export function useApproveSignup(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApproveSignupInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return approveSignupRequest(supabase, input.id, input.role);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settingsAccounts() });
      queryClient.invalidateQueries({ queryKey: queryKeys.signupRequests() });
    }
  });
}

export interface RejectSignupInput {
  id: string;
  note?: string;
}

export function useRejectSignup(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RejectSignupInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return rejectSignupRequest(supabase, input.id, input.note);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.signupRequests() });
    }
  });
}
