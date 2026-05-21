"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileUploadField } from "@/components/ui/file-upload-field";
import { Button } from "@/components/ui/button";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useUploadSafeAttachment,
  useDeleteSafeAttachment
} from "@/hooks/mutations/use-safe-mutations";
import { loadSafeAttachments, getSafeAttachmentSignedUrl } from "@/lib/data";
import {
  SAFE_ATTACHMENT_MAX_FILE_SIZE,
  SAFE_ATTACHMENT_MAX_COUNT,
  SAFE_ATTACHMENT_ALLOWED_MIME
} from "@/lib/data/safe";
import { queryKeys } from "@/hooks/queries/keys";
import type { SafeAttachment } from "@/lib/types";

interface SafeAttachmentUploadProps {
  /** null = no txn yet (e.g. modal hasn't fired RPC). Hides upload UI. */
  transactionId: string | null;
  /** Whether to load and display existing attachments. Pass false for
   *  inline-after-create flow where the txn just got made (empty list). */
  loadExisting?: boolean;
  disabled?: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const ALLOWED_MIME_STR = SAFE_ATTACHMENT_ALLOWED_MIME.join(",");

export function SafeAttachmentUpload({
  transactionId,
  loadExisting = true,
  disabled
}: SafeAttachmentUploadProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const uploadM = useUploadSafeAttachment(supabase);
  const deleteM = useDeleteSafeAttachment(supabase);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const attachmentsQuery = useQuery({
    queryKey: queryKeys.safeAttachments(transactionId ?? ""),
    queryFn: () => loadSafeAttachments(supabase!, transactionId!),
    enabled: Boolean(transactionId && supabase && loadExisting),
    staleTime: 30_000
  });

  const attachments = attachmentsQuery.data ?? [];
  const atLimit = attachments.length >= SAFE_ATTACHMENT_MAX_COUNT;
  const isBusy = uploadM.isPending || deleteM.isPending || disabled;

  if (transactionId === null) {
    return (
      <AlertBanner variant="info">
        Lưu giao dịch trước, sau đó upload hóa đơn.
      </AlertBanner>
    );
  }

  async function handleUpload() {
    if (!pendingFile || !transactionId) return;
    if (pendingFile.size > SAFE_ATTACHMENT_MAX_FILE_SIZE) {
      toast({ semantic: "danger", message: `File vượt 5 MB.` });
      return;
    }
    if (!(SAFE_ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(pendingFile.type)) {
      toast({ semantic: "danger", message: `Chỉ chấp nhận JPG/PNG/HEIC.` });
      return;
    }
    try {
      await uploadM.mutateAsync({ transactionId, file: pendingFile });
      toast({ semantic: "success", message: `Đã upload "${pendingFile.name}".` });
      setPendingFile(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không upload được."
      });
    }
  }

  async function handleDelete(att: SafeAttachment) {
    if (!transactionId) return;
    try {
      await deleteM.mutateAsync({
        attachmentId: att.id,
        storagePath: att.storage_path,
        transactionId
      });
      toast({ semantic: "success", message: `Đã xóa "${att.file_name}".` });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không xóa được."
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Hóa đơn ({attachments.length}/{SAFE_ATTACHMENT_MAX_COUNT})</span>
        <span>JPG/PNG/HEIC ≤ 5MB mỗi file</span>
      </div>

      {!atLimit && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FileUploadField
              accept={ALLOWED_MIME_STR}
              onSelect={setPendingFile}
              selectedFileName={pendingFile?.name ?? null}
              onClear={() => setPendingFile(null)}
              disabled={isBusy}
            />
          </div>
          <Button
            type="button"
            variant="primary"
            onClick={handleUpload}
            loading={uploadM.isPending}
            disabled={!pendingFile || isBusy}
          >
            Upload
          </Button>
        </div>
      )}

      {atLimit && (
        <AlertBanner variant="warning">
          Đã đạt giới hạn {SAFE_ATTACHMENT_MAX_COUNT} ảnh / giao dịch.
        </AlertBanner>
      )}

      {attachmentsQuery.isLoading && (
        <div className="flex justify-center py-4"><Spinner size={24} /></div>
      )}

      {attachments.length > 0 && (
        <div className="space-y-2">
          {attachments.map((att) => (
            <AttachmentRow key={att.id} attachment={att} onDelete={() => handleDelete(att)} disabled={isBusy} />
          ))}
        </div>
      )}
    </div>
  );
}

function AttachmentRow({
  attachment,
  onDelete,
  disabled
}: {
  attachment: SafeAttachment;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const supabase = useSupabase();
  const [url, setUrl] = useState<string | null>(null);
  const [urlError, setUrlError] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setUrlError(false);
    void getSafeAttachmentSignedUrl(supabase, attachment.storage_path, 3600)
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setUrlError(true); });
    return () => { cancelled = true; };
  }, [supabase, attachment.storage_path]);

  return (
    <div className="flex items-center gap-3 p-2 rounded-md border border-border bg-surface">
      <div className="w-16 h-16 flex-shrink-0 rounded-sm bg-surface-muted overflow-hidden flex items-center justify-center">
        {urlError ? (
          <Icon name="image" size={20} />
        ) : url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={url} target="_blank" rel="noopener noreferrer">
            <img src={url} alt={attachment.file_name} className="w-full h-full object-cover" />
          </a>
        ) : (
          <Spinner size={16} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-ink truncate" title={attachment.file_name}>
          {attachment.file_name}
        </p>
        <p className="text-xs text-muted">{formatFileSize(attachment.file_size)}</p>
      </div>
      <button
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`Xóa ${attachment.file_name}`}
        className="h-8 w-8 inline-flex items-center justify-center rounded-full text-danger hover:bg-danger/10 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}
