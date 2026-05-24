"use client";

import { useState, useRef, useEffect } from "react";
import type { UserRole } from "@/lib/types";
import {
  useBackupRunsQuery,
  useBackupRunLogQuery,
} from "@/hooks/queries/use-backup-runs-query";
import {
  useDownloadBackupMutation,
  streamRestore,
} from "@/hooks/mutations/use-backup-mutations";
import {
  formatBytes,
  formatDuration,
  formatBackupStatus,
} from "@/lib/format/backup";
import { useToast } from "@/components/ui/toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Modal, ModalContent, ModalTitle } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/empty-state";
import { useQueryClient } from "@tanstack/react-query";

interface Props {
  role: UserRole;
  authHeader: string | null;
}

export function BackupRestoreSection({ role, authHeader }: Props) {
  if (role !== "owner") {
    return (
      <EmptyState
        icon="lock"
        title="Owner only"
        subtitle="Backup/restore là thao tác destructive — chỉ owner có quyền."
      />
    );
  }

  return (
    <div className="space-y-6">
      <BackupPanel authHeader={authHeader} />
      <RestorePanel authHeader={authHeader} />
      <HistoryPanel authHeader={authHeader} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// BackupPanel
// ---------------------------------------------------------------------------

function BackupPanel({ authHeader }: { authHeader: string | null }) {
  const { toast } = useToast();
  const runs = useBackupRunsQuery(authHeader, 1).data;
  const lastBackup = runs?.find((r) => r.kind === "backup" && r.status === "success");
  const download = useDownloadBackupMutation(authHeader);

  const handleClick = async () => {
    try {
      const result = await download.mutateAsync();
      toast({
        semantic: "success",
        message: `Backup xong: ${result.filename} (${formatBytes(result.size)})`,
      });
    } catch (e) {
      toast({
        semantic: "danger",
        message: e instanceof Error ? e.message : "Backup failed",
      });
    }
  };

  return (
    <Card className="p-4">
      <h3 className="text-lg font-semibold mb-2">Backup</h3>
      {lastBackup && (
        <p className="text-sm text-muted-foreground mb-3">
          Lần backup cuối:{" "}
          {new Date(lastBackup.started_at).toLocaleString("vi-VN")} (
          {formatBytes(lastBackup.byte_size)})
        </p>
      )}
      <Button onClick={handleClick} disabled={download.isPending}>
        {download.isPending ? "Đang backup..." : "↓ Download backup ngay"}
      </Button>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RestorePanel
// ---------------------------------------------------------------------------

function RestorePanel({ authHeader }: { authHeader: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [logLines, setLogLines] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f && f.size > 100 * 1024 * 1024) {
      toast({
        semantic: "danger",
        message: `File quá lớn (${formatBytes(f.size)}, max 100MB)`,
      });
      return;
    }
    setFile(f);
  };

  const handleConfirm = async () => {
    if (!file || !authHeader || confirmText !== "RESTORE") return;
    setConfirmOpen(false);
    setLogLines([]);
    setRestoring(true);
    try {
      for await (const { line, done, status } of streamRestore(authHeader, file)) {
        if (line) setLogLines((prev) => [...prev, line]);
        if (done) {
          if (status === "success") {
            toast({ semantic: "success", message: "Restore xong!" });
            qc.invalidateQueries();
          } else {
            toast({ semantic: "danger", message: "Restore failed (xem log)" });
          }
          break;
        }
      }
    } catch (e) {
      toast({
        semantic: "danger",
        message: e instanceof Error ? e.message : "Restore error",
      });
    } finally {
      setRestoring(false);
      setConfirmText("");
    }
  };

  return (
    <>
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-2">Restore</h3>
        <p className="text-sm text-orange-600 mb-3">
          ⚠️ Sẽ XÓA toàn bộ data hiện tại!
        </p>
        <div className="flex gap-2 items-center mb-3">
          <label className="text-sm text-ink-2">
            Chọn file backup (.sql):
            <input
              type="file"
              accept=".sql"
              onChange={handleFileChange}
              disabled={restoring}
              className="block mt-1 text-sm"
            />
          </label>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!file || restoring}
            variant="destructive"
          >
            Restore
          </Button>
        </div>
        {logLines.length > 0 && (
          <div className="mt-3">
            <div className="flex justify-between mb-1">
              <span className="text-sm font-medium">Log</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(logLines.join("\n"))}
              >
                Copy
              </Button>
            </div>
            <pre className="bg-surface-muted p-3 rounded text-xs font-mono h-64 overflow-y-auto whitespace-pre-wrap">
              {logLines.join("\n")}
              <div ref={logEndRef} />
            </pre>
          </div>
        )}
      </Card>

      <Modal open={confirmOpen} onOpenChange={setConfirmOpen}>
        <ModalContent>
          <ModalTitle>Confirm Restore</ModalTitle>
          <div className="space-y-3 mt-4">
            <p className="text-sm">
              File:{" "}
              <code className="bg-surface-muted px-1 rounded">{file?.name}</code>{" "}
              ({formatBytes(file?.size ?? null)})
            </p>
            <p className="text-sm text-red-600 font-medium">
              Sẽ DROP toàn bộ public schema và restore từ file này. KHÔNG THỂ
              UNDO.
            </p>
            <label className="block text-sm">
              Gõ{" "}
              <code className="bg-surface-muted px-1 rounded">RESTORE</code> để
              confirm:
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="block mt-1 w-full border border-border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-border-strong"
              />
            </label>
            <div className="flex gap-2 justify-end mt-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={confirmText !== "RESTORE"}
              >
                Confirm Restore
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// HistoryPanel
// ---------------------------------------------------------------------------

function HistoryPanel({ authHeader }: { authHeader: string | null }) {
  const { data: runs = [], isLoading } = useBackupRunsQuery(authHeader, 10);
  const [viewLogId, setViewLogId] = useState<string | null>(null);

  if (isLoading) return <Card className="p-4">Loading...</Card>;
  if (runs.length === 0)
    return <Card className="p-4">History (chưa có run nào)</Card>;

  return (
    <>
      <Card className="p-4">
        <h3 className="text-lg font-semibold mb-2">History (10 gần nhất)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-border">
                <th className="py-2 pr-3">Type</th>
                <th className="pr-3">Status</th>
                <th className="pr-3">Started</th>
                <th className="pr-3">Duration</th>
                <th className="pr-3">Size</th>
                <th className="pr-3">Filename</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const st = formatBackupStatus(r.status);
                const semanticClass =
                  st.semantic === "success"
                    ? "text-success"
                    : st.semantic === "danger"
                    ? "text-danger"
                    : "text-blue-ink";
                return (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 pr-3">{r.kind}</td>
                    <td className={`pr-3 ${semanticClass}`}>{st.label}</td>
                    <td className="pr-3">
                      {new Date(r.started_at).toLocaleString("vi-VN")}
                    </td>
                    <td className="pr-3">
                      {formatDuration(r.started_at, r.finished_at)}
                    </td>
                    <td className="pr-3">{formatBytes(r.byte_size)}</td>
                    <td className="pr-3 truncate max-w-[200px]">
                      {r.filename ?? "—"}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setViewLogId(r.id)}
                      >
                        View log
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {viewLogId && (
        <LogModal
          authHeader={authHeader}
          id={viewLogId}
          onClose={() => setViewLogId(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// LogModal
// ---------------------------------------------------------------------------

function LogModal({
  authHeader,
  id,
  onClose,
}: {
  authHeader: string | null;
  id: string;
  onClose: () => void;
}) {
  const { data, isLoading } = useBackupRunLogQuery(authHeader, id);

  return (
    <Modal open onOpenChange={onClose}>
      <ModalContent className="max-w-3xl w-[min(90vw,48rem)]">
        <ModalTitle>Log của run</ModalTitle>
        {isLoading ? (
          <p className="mt-4 text-sm text-ink-2">Loading...</p>
        ) : (
          <pre className="mt-4 bg-surface-muted p-3 rounded text-xs font-mono h-96 overflow-y-auto whitespace-pre-wrap">
            {data?.log_text || "(empty log)"}
          </pre>
        )}
      </ModalContent>
    </Modal>
  );
}
