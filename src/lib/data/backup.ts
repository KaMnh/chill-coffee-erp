import type { BackupRun, BackupRunWithLog } from "@/lib/types";

/** GET /api/backup/runs?limit=N — list các runs gần nhất. Owner-only. */
export async function listBackupRuns(authHeader: string, limit = 10): Promise<BackupRun[]> {
  const res = await fetch(`/api/backup/runs?limit=${limit}`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`listBackupRuns failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.runs as BackupRun[];
}

/** GET /api/backup/runs/:id/log — get full log_text. */
export async function getBackupRunLog(authHeader: string, id: string): Promise<BackupRunWithLog> {
  const res = await fetch(`/api/backup/runs/${id}/log`, {
    headers: { Authorization: authHeader },
  });
  if (!res.ok) throw new Error(`getBackupRunLog failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as BackupRunWithLog;
}
