"use client";

import { useQuery } from "@tanstack/react-query";
import { listBackupRuns, getBackupRunLog } from "@/lib/data/backup";

const KEY = ["backup-runs"] as const;

export function useBackupRunsQuery(authHeader: string | null, limit = 10, enabled = true) {
  return useQuery({
    queryKey: [...KEY, limit],
    queryFn: () => listBackupRuns(authHeader!, limit),
    enabled: enabled && Boolean(authHeader),
    refetchInterval: (q) => {
      // Auto-refresh mỗi 5s nếu có run đang chạy
      const runs = q.state.data;
      const hasRunning = runs?.some((r) => r.status === "running");
      return hasRunning ? 5000 : false;
    },
    staleTime: 10_000,
  });
}

export function useBackupRunLogQuery(authHeader: string | null, id: string | null) {
  return useQuery({
    queryKey: [...KEY, "log", id],
    queryFn: () => getBackupRunLog(authHeader!, id!),
    enabled: Boolean(authHeader && id),
    staleTime: Infinity, // log không đổi sau khi run xong
  });
}

export const BACKUP_RUNS_QUERY_KEY = KEY;
