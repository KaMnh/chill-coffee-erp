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
import { useSetupSafeInitial } from "@/hooks/mutations/use-safe-mutations";
import { formatVND, moneyFromInput } from "@/lib/format";
import { validateSafeSetup } from "@/lib/validation";

interface SetupSafeModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

/**
 * One-time initial setup for the safe ledger. Records the opening balance
 * as a transaction_type='initial_setup' row. The RPC enforces single-use
 * (rejects if any safe_transactions row exists), so this modal only renders
 * when the balance card determines it's first-time (balance === 0 + txnCount === 0).
 */
export function SetupSafeModal({ open, onOpenChange }: SetupSafeModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const setupM = useSetupSafeInitial(supabase);

  const [amountStr, setAmountStr] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setAmountStr("");
      setNote("");
    }
  }, [open]);

  const amount = moneyFromInput(amountStr);
  const validation = validateSafeSetup({ amount, note: note || undefined });
  const isBusy = setupM.isPending;
  const hasError = !validation.ok;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasError || isBusy) return;
    try {
      await setupM.mutateAsync({ amount, note: note || undefined });
      toast({
        semantic: "success",
        message: `Đã thiết lập sổ quỹ với ${formatVND(amount)}.`
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không thiết lập được sổ quỹ."
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>Thiết lập sổ quỹ ban đầu</ModalTitle>
        <ModalDescription>
          Khai báo số dư mở đầu một lần duy nhất. Sau đó dùng &quot;Rút khác&quot; /
          &quot;Điều chỉnh&quot; để thay đổi.
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <AlertBanner variant="info">
            Bước này chỉ chạy được 1 lần. Đảm bảo số chính xác — sau khi lưu,
            mọi thay đổi đều qua transaction (Rút khác / Điều chỉnh).
          </AlertBanner>
          <TextField
            label="Số dư ban đầu"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            disabled={isBusy}
            helper={amount > 0 ? formatVND(amount) : "Nhập số tiền (VND)"}
            error={
              amountStr.length > 0 && !validation.ok && validation.field === "amount"
                ? validation.message
                : undefined
            }
            autoFocus
          />
          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="VD: Số dư từ két cũ trước khi vào hệ thống..."
            disabled={isBusy}
            helper="Tùy chọn"
            error={
              !validation.ok && validation.field === "note" ? validation.message : undefined
            }
          />
          <ModalActions>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
              Đóng
            </Button>
            <Button type="submit" variant="primary" loading={isBusy} disabled={hasError}>
              Thiết lập {amount > 0 ? formatVND(amount) : ""}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
