"use client";

import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useAdjustSafe } from "@/hooks/mutations/use-safe-mutations";
import { formatVND, moneyFromInput } from "@/lib/format";
import { validateSafeAdjust } from "@/lib/validation";
import { SafeAttachmentUpload } from "./safe-attachment-upload";

interface AdjustSafeModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  currentBalance: number;
  /** Pre-fill new balance value (e.g. from Count→Adjust chain). */
  initialNewBalance?: number | null;
}

type Step = "form" | "confirm" | "attach";

/**
 * Adjust the safe balance to correct a discrepancy. Three-step UX:
 *   1. form: newBalance + note (≥5 chars)
 *   2. confirm: AlertBanner.danger showing currentBalance → newBalance + delta
 *   3. attach (after RPC succeeds): SafeAttachmentUpload for the new txn
 *
 * Step 1's newBalance can be pre-filled via initialNewBalance (used by
 * Count→Adjust chain in CountSafeModal).
 */
export function AdjustSafeModal({
  open,
  onOpenChange,
  currentBalance,
  initialNewBalance
}: AdjustSafeModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const adjustM = useAdjustSafe(supabase);

  const [step, setStep] = useState<Step>("form");
  const [newBalanceStr, setNewBalanceStr] = useState("");
  const [note, setNote] = useState("");
  const [createdTxId, setCreatedTxId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStep("form");
      setNewBalanceStr(initialNewBalance != null ? String(initialNewBalance) : "");
      setNote("");
      setCreatedTxId(null);
    }
  }, [open, initialNewBalance]);

  const newBalance = moneyFromInput(newBalanceStr);
  const delta = newBalance - currentBalance;
  const validation = validateSafeAdjust({ newBalance, note }, currentBalance);
  const isBusy = adjustM.isPending;
  const hasError = !validation.ok;

  async function handleConfirm() {
    if (hasError || isBusy) return;
    try {
      const result = await adjustM.mutateAsync({ newBalance, note });
      setCreatedTxId(result.id);
      setStep("attach");
      toast({
        semantic: "success",
        message: `Đã điều chỉnh sang ${formatVND(result.balance_after)} (${delta > 0 ? "+" : ""}${formatVND(delta)}).`
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không điều chỉnh được sổ quỹ."
      });
    }
  }

  function handleStep1Submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasError) return;
    setStep("confirm");
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,36rem)]">
        <ModalTitle>
          {step === "form" && "Điều chỉnh sổ quỹ"}
          {step === "confirm" && "Xác nhận điều chỉnh"}
          {step === "attach" && "Đã điều chỉnh — upload hóa đơn (tùy chọn)"}
        </ModalTitle>
        <ModalDescription>
          Số dư hiện tại: <strong>{formatVND(currentBalance)}</strong>
        </ModalDescription>

        {step === "form" && (
          <form onSubmit={handleStep1Submit} className="mt-6 space-y-4">
            <TextField
              label="Số dư mới (sau điều chỉnh)"
              value={newBalanceStr}
              onChange={(e) => setNewBalanceStr(e.target.value)}
              inputMode="numeric"
              placeholder="0"
              disabled={isBusy}
              helper={
                newBalance > 0
                  ? `Chênh lệch: ${delta > 0 ? "+" : ""}${formatVND(delta)}`
                  : "Nhập số dư mới (VND)"
              }
              error={
                newBalanceStr.length > 0 && !validation.ok && validation.field === "newBalance"
                  ? validation.message
                  : undefined
              }
              autoFocus
            />
            <Textarea
              label="Lý do điều chỉnh *"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="VD: Đếm két phát hiện lệch 50k do trộn ngăn..."
              disabled={isBusy}
              helper="Bắt buộc ≥ 5 ký tự (ghi vào audit log)."
              error={
                note.length > 0 && !validation.ok && validation.field === "note"
                  ? validation.message
                  : undefined
              }
            />
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button type="submit" variant="primary" disabled={hasError}>
                Tiếp
              </Button>
            </ModalActions>
          </form>
        )}

        {step === "confirm" && (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="danger">
              <p>
                <strong>Bạn chắc chứ?</strong> Điều chỉnh sổ quỹ ghi vào audit log
                và KHÔNG hoàn tác được.
              </p>
              <p className="mt-2">
                Số dư: <strong>{formatVND(currentBalance)}</strong> → <strong>{formatVND(newBalance)}</strong>
                {" "}({delta > 0 ? "+" : ""}{formatVND(delta)})
              </p>
              <p className="mt-2 text-xs">Lý do: {note}</p>
            </AlertBanner>
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => setStep("form")} disabled={isBusy}>
                Quay lại
              </Button>
              <Button type="button" variant="destructive" loading={isBusy} onClick={handleConfirm}>
                Xác nhận điều chỉnh
              </Button>
            </ModalActions>
          </div>
        )}

        {step === "attach" && createdTxId && (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="success">
              Đã điều chỉnh. Upload ảnh hóa đơn / bằng chứng nếu có.
            </AlertBanner>
            <SafeAttachmentUpload transactionId={createdTxId} loadExisting={false} />
            <ModalActions>
              <Button type="button" variant="primary" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </ModalActions>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
