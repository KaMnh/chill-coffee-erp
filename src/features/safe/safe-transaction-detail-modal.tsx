"use client";

import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useQuery } from "@tanstack/react-query";
import { useSupabase } from "@/hooks/use-supabase";
import { loadSafeTransactions } from "@/lib/data";
import { formatVND, formatDateTime } from "@/lib/format";
import type { SafeTransactionType } from "@/lib/types";
import { SafeAttachmentUpload } from "./safe-attachment-upload";

interface SafeTransactionDetailModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  transactionId: string | null;
}

const TYPE_LABELS: Record<SafeTransactionType, string> = {
  initial_setup: "Mở sổ",
  deposit_close: "Nạp từ chốt két",
  withdraw_open: "Rút mở két",
  withdraw_other: "Rút khác",
  adjustment: "Điều chỉnh",
  owner_draw: "Rút lợi nhuận"
};

const TYPE_SEMANTICS: Record<SafeTransactionType, "success" | "danger" | "warning" | "neutral"> = {
  initial_setup: "neutral",
  deposit_close: "success",
  withdraw_open: "warning",
  withdraw_other: "warning",
  adjustment: "neutral",
  owner_draw: "warning"
};

/**
 * View-only modal for a single safe_transaction. Loads attachments via
 * SafeAttachmentUpload (loadExisting=true) and allows post-hoc add/delete.
 * Transactions are immutable — corrections happen via a new Adjust txn.
 */
export function SafeTransactionDetailModal({
  open,
  onOpenChange,
  transactionId
}: SafeTransactionDetailModalProps) {
  const supabase = useSupabase();

  // Query the full transactions list and find this one (cached from parent's
  // useSafeTransactionsQuery if filter matches; otherwise refetch a small window).
  // Simpler: filter from already-cached transactions via a wide date range.
  const txQuery = useQuery({
    queryKey: ["safe", "transaction-detail", transactionId],
    queryFn: async () => {
      if (!supabase || !transactionId) return null;
      // Fetch a wide range — RPC has no get-by-id, so we list-and-filter.
      // The cost is small for owner-only data.
      const all = await loadSafeTransactions(supabase, {});
      return all.find((t) => t.id === transactionId) ?? null;
    },
    enabled: Boolean(supabase && transactionId && open),
    staleTime: 30_000
  });

  const tx = txQuery.data;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,40rem)]">
        <ModalTitle>Chi tiết giao dịch</ModalTitle>
        <ModalDescription>
          {tx ? formatDateTime(tx.occurred_at) : "Đang tải..."}
        </ModalDescription>

        {txQuery.isLoading && (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        )}

        {!txQuery.isLoading && !tx && (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="warning">
              Không tìm thấy giao dịch. Có thể đã bị xóa ở phiên khác.
            </AlertBanner>
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </ModalActions>
          </div>
        )}

        {tx && (
          <div className="mt-6 space-y-4">
            <div className="rounded-md border border-border p-3 space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted">Loại:</span>
                <Badge variant="soft" semantic={TYPE_SEMANTICS[tx.transaction_type]}>
                  {TYPE_LABELS[tx.transaction_type]}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Số tiền:</span>
                <strong className={tx.amount < 0 ? "text-danger" : "text-success"}>
                  {tx.amount > 0 ? "+" : ""}{formatVND(tx.amount)}
                </strong>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted">Quỹ:</span>
                <Badge variant="soft" semantic={tx.fund === "transfer" ? "success" : "neutral"}>
                  {tx.fund === "transfer" ? "Chuyển khoản" : "Tiền mặt"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Số dư sau (quỹ):</span>
                <strong>{formatVND(tx.balance_after)}</strong>
              </div>
              {tx.reason_category && (
                <div className="flex justify-between">
                  <span className="text-muted">Hạng mục:</span>
                  <span>{tx.reason_category}</span>
                </div>
              )}
              {tx.description && (
                <div className="border-t border-border pt-2">
                  <p className="text-xs text-muted">Mô tả</p>
                  <p className="text-sm">{tx.description}</p>
                </div>
              )}
            </div>

            <SafeAttachmentUpload transactionId={tx.id} loadExisting={true} />

            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </ModalActions>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
