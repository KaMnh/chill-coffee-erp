import type { BackupRunStatus } from "@/lib/types";

const KB = 1024;
const MB = 1024 * KB;
const GB = 1024 * MB;

export function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  if (bytes < KB) return `${bytes} B`;
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(1)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

export function formatDuration(startedAt: string, finishedAt: string | null): string {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export interface BackupStatusDisplay {
  label: string;
  semantic: "info" | "success" | "danger";
  icon: "spinner" | "check" | "x";
}

export function formatBackupStatus(status: BackupRunStatus): BackupStatusDisplay {
  switch (status) {
    case "running": return { label: "Đang chạy", semantic: "info", icon: "spinner" };
    case "success": return { label: "Thành công", semantic: "success", icon: "check" };
    case "failed":  return { label: "Lỗi", semantic: "danger", icon: "x" };
  }
}
