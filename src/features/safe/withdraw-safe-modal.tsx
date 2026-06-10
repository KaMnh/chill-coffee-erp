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
import { todayInVN } from "@/lib/datetime";
import { validateSafeWithdraw } from "@/lib/validation";
import type { SafeBalances, SafeWithdrawCategory } from "@/lib/types";
import { defaultFundSplit } from "./fund-split";
import { SafeAttachmentUpload } from "./safe-attachment-upload";

interface WithdrawSafeModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  balances: SafeBalances;
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
 * Sổ quỹ 2 quỹ: khoản chi TÁCH giữa quỹ chuyển khoản + quỹ tiền mặt (mặc định
 * CK trước, tiền mặt bù; cả 2 ô sửa được — sửa ô này tự bù ô kia để tổng khớp).
 * F4: ô chọn ngày (nhãn lịch sử; số dư vẫn giảm ngay).
 * Two-phase modal:
 *   Phase A: form (tổng + tách quỹ + ngày + category + description) → "Rút"
 *   Phase B: RPC succeeded, SafeAttachmentUpload mounted for the new transaction.
 */
export function WithdrawSafeModal({ open, onOpenChange, balances }: WithdrawSafeModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const withdrawM = useWithdrawSafeOther(supabase);
  const today = todayInVN();

  const [amountStr, setAmountStr] = useState("");
  const [cashStr, setCashStr] = useState("");
  const [transferStr, setTransferStr] = useState("");
  const [occurredDate, setOccurredDate] = useState(today);
  const [category, setCategory] = useState<SafeWithdrawCategory>("other");
  const [description, setDescription] = useState("");
  const [createdTxId, setCreatedTxId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmountStr("");
      setCashStr("");
      setTransferStr("");
      setOccurredDate(todayInVN());
      setCategory("other");
      setDescription("");
      setCreatedTxId(null);
    }
  }, [open]);

  const total = moneyFromInput(amountStr);
  const cashAmount = moneyFromInput(cashStr);
  const transferAmount = moneyFromInput(transferStr);

  /** Đổi Tổng → áp lại split mặc định (CK trước, tiền mặt bù). */
  function handleTotalChange(raw: string) {
    setAmountStr(raw);
    const split = defaultFundSplit(moneyFromInput(raw), balances.transfer);
    setCashStr(split.cash > 0 ? String(split.cash) : "");
    setTransferStr(split.transfer > 0 ? String(split.transfer) : "");
  }

  /** Sửa 1 ô split → ô kia tự bù để tổng luôn khớp. */
  function handleTransferChange(raw: string) {
    setTransferStr(raw);
    setCashStr(String(Math.max(0, total - moneyFromInput(raw))));
  }
  function handleCashChange(raw: string) {
    setCashStr(raw);
    setTransferStr(String(Math.max(0, total - moneyFromInput(raw))));
  }

  const validation = validateSafeWithdraw(
    { cashAmount, transferAmount, category, description: description || undefined },
    balances.cash,
    balances.transfer
  );
  const splitMatchesTotal = cashAmount + transferAmount === total;
  const isFutureDate = occurredDate > today;
  const isBusy = withdrawM.isPending;
  const hasError = !validation.ok || !splitMatchesTotal || isFutureDate || total <= 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasError || isBusy || createdTxId) return;
    try {
      // Ngày chọn + giờ hiện tại (tránh lệch ngày khi cast timestamptz theo TZ VN).
      const occurredAt =
        occurredDate === today
          ? undefined
          : new Date(`${occurredDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString();
      const result = await withdrawM.mutateAsync({
        cashAmount,
        transferAmount,
        category,
        description: description || undefined,
        occurredAt
      });
      setCreatedTxId(result.cash_id ?? result.transfer_id);
      toast({
        semantic: "success",
        message: `Đã rút ${formatVND(total)} (CK ${formatVND(transferAmount)} · tiền mặt ${formatVND(cashAmount)}).`
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
          Quỹ tiền mặt: <strong>{formatVND(balances.cash)}</strong> · Quỹ chuyển khoản:{" "}
          <strong>{formatVND(balances.transfer)}</strong>
        </ModalDescription>

        {!createdTxId ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <TextField
              label="Tổng tiền rút"
              value={amountStr}
              onChange={(e) => handleTotalChange(e.target.value)}
              inputMode="numeric"
              placeholder="0"
              disabled={isBusy}
              helper={total > 0 ? formatVND(total) : "Nhập tổng số tiền (VND)"}
              error={
                amountStr.length > 0 && !validation.ok && validation.field === "amount"
                  ? validation.message
                  : undefined
              }
              autoFocus
            />
            <div className="grid grid-cols-2 gap-3">
              <TextField
                label="Trả từ chuyển khoản"
                value={transferStr}
                onChange={(e) => handleTransferChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={isBusy || total <= 0}
                helper={`Còn ${formatVND(balances.transfer)}`}
                error={
                  !validation.ok && validation.field === "transfer" ? validation.message : undefined
                }
              />
              <TextField
                label="Trả từ tiền mặt"
                value={cashStr}
                onChange={(e) => handleCashChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={isBusy || total <= 0}
                helper={`Còn ${formatVND(balances.cash)}`}
                error={
                  !validation.ok && validation.field === "cash" ? validation.message : undefined
                }
              />
            </div>
            {total > 0 && !splitMatchesTotal && (
              <AlertBanner variant="danger">
                Tách quỹ ({formatVND(cashAmount + transferAmount)}) chưa khớp tổng ({formatVND(total)}).
              </AlertBanner>
            )}
            <TextField
              label="Ngày chi"
              type="date"
              value={occurredDate}
              onChange={(e) => setOccurredDate(e.target.value)}
              disabled={isBusy}
              max={today}
              helper="Ghi muộn khoản đã chi: chọn ngày quá khứ — số dư vẫn trừ ngay."
              error={isFutureDate ? "Không được chọn ngày tương lai." : undefined}
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
            <p className="text-xs text-muted mt-1">
              Khoản này sẽ được ghi vào sổ chi (chỉ owner xem được).
            </p>
            <ModalActions>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
                Hủy
              </Button>
              <Button type="submit" variant="primary" loading={isBusy} disabled={hasError}>
                Rút {total > 0 ? formatVND(total) : ""}
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
