"use client";

import { useEffect, useState } from "react";
import {
  Modal, ModalContent, ModalTitle, ModalDescription, ModalActions
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useWithdrawSafeOther } from "@/hooks/mutations/use-safe-mutations";
import { formatVND, moneyFromInput } from "@/lib/format";
import { validateSafeWithdraw } from "@/lib/validation";
import type { SafeWithdrawCategory } from "@/lib/types";
import { SafeAttachmentUpload } from "./safe-attachment-upload";

interface WithdrawSafeModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  currentBalance: number;
}

const CATEGORY_LABELS: Record<SafeWithdrawCategory, string> = {
  utilities: "Điện / nước / internet",
  rent: "Tiền thuê mặt bằng",
  inventory: "Nhập hàng / nguyên liệu",
  maintenance: "Sửa chữa / bảo trì",
  other: "Khác"
};

const CATEGORIES: SafeWithdrawCategory[] = ["utilities", "rent", "inventory", "maintenance", "other"];

/**
 * Withdraw safe funds for non-cash-close reasons (utilities, rent, etc.).
 * Two-phase modal:
 *   Phase A: form (amount + category + description) → "Rút" button
 *   Phase B: RPC succeeded, modal stays open with SafeAttachmentUpload mounted
 *            for the new transaction. User attaches 0-5 receipts then closes.
 */
export function WithdrawSafeModal({ open, onOpenChange, currentBalance }: WithdrawSafeModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const withdrawM = useWithdrawSafeOther(supabase);

  const [amountStr, setAmountStr] = useState("");
  const [category, setCategory] = useState<SafeWithdrawCategory>("other");
  const [description, setDescription] = useState("");
  const [createdTxId, setCreatedTxId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmountStr("");
      setCategory("other");
      setDescription("");
      setCreatedTxId(null);
    }
  }, [open]);

  const amount = moneyFromInput(amountStr);
  const validation = validateSafeWithdraw(
    { amount, category, description: description || undefined },
    currentBalance
  );
  const isBusy = withdrawM.isPending;
  const hasError = !validation.ok;
  const balanceAfter = currentBalance - amount;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasError || isBusy || createdTxId) return;
    try {
      const result = await withdrawM.mutateAsync({
        amount,
        category,
        description: description || undefined
      });
      setCreatedTxId(result.id);
      toast({
        semantic: "success",
        message: `Đã rút ${formatVND(amount)}. Số dư còn ${formatVND(result.balance_after)}.`
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không rút được sổ quỹ."
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,36rem)]">
        <ModalTitle>
          {createdTxId ? "Đã rút — upload hóa đơn (tùy chọn)" : "Rút sổ quỹ (mục đích khác)"}
        </ModalTitle>
        <ModalDescription>
          Số dư hiện tại: <strong>{formatVND(currentBalance)}</strong>
        </ModalDescription>

        {!createdTxId ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <TextField
              label="Số tiền rút"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              inputMode="numeric"
              placeholder="0"
              disabled={isBusy}
              helper={amount > 0 ? `Số dư còn: ${formatVND(balanceAfter)}` : "Nhập số tiền (VND)"}
              error={
                amountStr.length > 0 && !validation.ok && validation.field === "amount"
                  ? validation.message
                  : undefined
              }
              autoFocus
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-2">Hạng mục</label>
              <Select value={category} onValueChange={(v) => setCategory(v as SafeWithdrawCategory)} disabled={isBusy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              label="Mô tả"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="VD: Tiền điện tháng 5, thanh toán cho EVN..."
              disabled={isBusy}
              helper="Tùy chọn"
              error={
                !validation.ok && validation.field === "description" ? validation.message : undefined
              }
            />
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Hủy
              </Button>
              <Button type="submit" variant="primary" loading={isBusy} disabled={hasError}>
                Rút {amount > 0 ? formatVND(amount) : ""}
              </Button>
            </ModalActions>
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            <AlertBanner variant="success">
              Giao dịch đã lưu. Upload ảnh hóa đơn nếu có, sau đó bấm &quot;Đóng&quot;.
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
