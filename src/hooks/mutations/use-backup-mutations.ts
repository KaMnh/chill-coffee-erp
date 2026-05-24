"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BACKUP_RUNS_QUERY_KEY } from "@/hooks/queries/use-backup-runs-query";

/** Download backup: fetch /api/backup/full, trigger browser download. */
export function useDownloadBackupMutation(authHeader: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!authHeader) throw new Error("Not authenticated");
      const res = await fetch("/api/backup/full", {
        method: "POST",
        headers: { Authorization: authHeader },
      });
      if (!res.ok) throw new Error(`Backup failed: ${res.status} ${await res.text()}`);

      const blob = await res.blob();
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match ? match[1] : `chill-backup-${Date.now()}.sql`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      return { filename, size: blob.size };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BACKUP_RUNS_QUERY_KEY });
    },
  });
}

/**
 * Restore backup: upload file, stream stderr.
 * Returns AsyncIterable<string> để consumer (UI) iterate log lines.
 */
export interface RestoreProgress {
  line: string;
  done: boolean;
  status?: "success" | "failed";
}

export async function* streamRestore(
  authHeader: string,
  file: File
): AsyncIterableIterator<RestoreProgress> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/api/backup/restore", {
    method: "POST",
    headers: { Authorization: authHeader },
    body: formData,
  });

  if (!res.ok) {
    yield { line: `❌ Server error: ${res.status} ${await res.text()}`, done: true, status: "failed" };
    return;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer) yield { line: buffer, done: false };
        yield { line: "", done: true };
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const endMatch = line.match(/===END=== status=(\w+)/);
        if (endMatch) {
          yield { line, done: true, status: endMatch[1] as "success" | "failed" };
          return;
        }
        yield { line, done: false };
      }
    }
  } finally {
    reader.cancel().catch(() => {});  // Best-effort cleanup, don't crash
  }
}
