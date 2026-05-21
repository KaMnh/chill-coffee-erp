"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  updateHandoverTask,
  updateHandoverNote,
  completeHandoverSession,
  updateHandoverSessionTasks
} from "@/lib/data";
import type { HandoverSession } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the Handover module — Phase 3C.3.
 *
 * Pattern matches use-cash-mutations.ts: null-supabase guard, useMutation,
 * invalidate dependent query keys on success. No optimistic updates.
 *
 * All 4 hooks invalidate the SAME key (handover is per-day, self-contained):
 *   queryKeys.handover(businessDate)
 *
 * 4 hooks total:
 *   - useUpdateHandoverTask: checkbox toggle (auto-save)
 *   - useUpdateHandoverNote: textarea (save-on-blur)
 *   - useCompleteHandoverSession: irreversible session lock
 *   - useUpdateHandoverSessionTasks: admin per-day task editor (owner/manager)
 */

export interface UpdateHandoverTaskInput {
  taskId: string;
  isDone: boolean;
}

export function useUpdateHandoverTask(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverTaskInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverTask(supabase, input.taskId, input.isDone);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}

export interface UpdateHandoverNoteInput {
  sessionId: string;
  note: string;
}

export function useUpdateHandoverNote(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverNoteInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverNote(supabase, input.sessionId, input.note);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}

export interface CompleteHandoverSessionInput {
  sessionId: string;
}

export function useCompleteHandoverSession(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CompleteHandoverSessionInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return completeHandoverSession(supabase, input.sessionId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}

export interface UpdateHandoverSessionTasksInput {
  sessionId: string;
  tasks: Array<{ id?: string; key?: string; label: string; sort_order?: number }>;
}

export function useUpdateHandoverSessionTasks(
  supabase: SupabaseClient | null,
  businessDate: string
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UpdateHandoverSessionTasksInput): Promise<HandoverSession> => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return updateHandoverSessionTasks(supabase, input.sessionId, input.tasks);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.handover(businessDate) });
    }
  });
}
