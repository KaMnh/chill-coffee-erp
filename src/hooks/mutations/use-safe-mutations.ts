"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  setupSafeInitial,
  withdrawSafeOther,
  adjustSafe,
  countSafe,
  uploadSafeAttachment,
  deleteSafeAttachment
} from "@/lib/data";
import type { SafeWithdrawCategory } from "@/lib/types";
import { queryKeys } from "@/hooks/queries/keys";

/**
 * Mutation hooks for the Safe (sổ quỹ) module — Phase 3C.1.
 *
 * Pattern matches use-cash-mutations.ts: null-supabase guard, useMutation,
 * invalidate dependent query keys on success. No optimistic updates.
 *
 * 6 hooks total:
 *   - useSetupSafeInitial: first-time init
 *   - useWithdrawSafeOther: rút khác (utilities/rent/inventory/maintenance/other)
 *   - useAdjustSafe: điều chỉnh số dư (note ≥ 5)
 *   - useCountSafe: snapshot mệnh giá (KHÔNG ảnh hưởng balance)
 *   - useUploadSafeAttachment: upload ảnh hóa đơn (≤5/txn, ≤5MB, jpeg/png/heic/heif)
 *   - useDeleteSafeAttachment: xóa ảnh + metadata
 */

export interface SetupSafeInitialInput {
  cash: number;
  transfer: number;
  note?: string;
}

export function useSetupSafeInitial(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetupSafeInitialInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return setupSafeInitial(supabase, input.cash, input.transfer, input.note);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    }
  });
}

export interface WithdrawSafeOtherInput {
  amount: number;
  category: SafeWithdrawCategory;
  description?: string;
}

export function useWithdrawSafeOther(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: WithdrawSafeOtherInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return withdrawSafeOther(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    }
  });
}

export interface AdjustSafeInput {
  newBalance: number;
  note: string;
}

export function useAdjustSafe(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdjustSafeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return adjustSafe(supabase, input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.safeBalance() });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    }
  });
}

export interface CountSafeInput {
  denominations: Record<string, number>;
  note?: string;
}

export function useCountSafe(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CountSafeInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return countSafe(supabase, input);
    },
    onSuccess: () => {
      // Count is a snapshot — does NOT change balance. Only invalidate counts.
      queryClient.invalidateQueries({ queryKey: queryKeys.safeCounts() });
    }
  });
}

export interface UploadSafeAttachmentInput {
  transactionId: string;
  file: File;
}

export function useUploadSafeAttachment(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadSafeAttachmentInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return uploadSafeAttachment(supabase, input.transactionId, input.file);
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.safeAttachments(input.transactionId)
      });
      // Refetch transactions to update attachment_count column if present.
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    }
  });
}

export interface DeleteSafeAttachmentInput {
  attachmentId: string;
  storagePath: string;
  transactionId: string;
}

export function useDeleteSafeAttachment(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: DeleteSafeAttachmentInput) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      return deleteSafeAttachment(supabase, input.attachmentId, input.storagePath);
    },
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.safeAttachments(input.transactionId)
      });
      queryClient.invalidateQueries({ queryKey: ["safe", "transactions"] });
    }
  });
}
