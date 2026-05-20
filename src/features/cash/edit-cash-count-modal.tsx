"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useUpdateCashCount } from "@/hooks/mutations/use-cash-mutations";
import { cn } from "@/lib/cn";
import { formatDateTime, formatVND, moneyFromInput } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { CashCount } from "@/lib/types";
import { DenominationGrid } from "./denomination-grid";
import { computeDenominationTotal } from "./cash-math";
import { DENOMINATIONS } from "./denominations";

interface EditCashCountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  count: CashCount | null;
}

function countsFromCashCount(count: CashCount | null): Record<string, number> {
  if (!count) return {};
  const result: Record<string, number> = {};
  for (const denom of DENOMINATIONS) {
    result[String(denom)] = Number(count.denominations_json?.[String(denom)] ?? 0);
  }
  return result;
}

/**
 * Admin edit cash_count denominations + bank_transfer + note. RPC will
 * recompute physical/theory/reconciliation/difference + re-snapshot
 * cash_drawer_events. UI shows live preview (delta-based) — final values
 * come from server.
 *
 * Reject if shift_close + report_status === "final" (parent disables
 * "Sửa count" button; RPC also rejects defense-in-depth).
 */
export function EditCashCountModal({
  open,
  onOpenChange,
  count,
}: EditCashCountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateM = useUpdateCashCount(supabase, count?.business_date ?? "");

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [bankTransfer, setBankTransfer] = useState("");
  const [note, setNote] = useState("");

  // Reset on open + count change.
  useEffect(() => {
    if (open && count) {
      setCounts(countsFromCashCount(count));
      setBankTransfer(String(count.bank_transfer_confirmed ?? 0));
      setNote(count.note ?? "");
    }
  }, [open, count?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const physical = useMemo(() => computeDenominationTotal(counts), [counts]);
  const bankTransferValue = moneyFromInput(bankTransfer);

  // Live preview reconciliation (delta-based, mirrors v3 logic).
  const reconciliationPreview = useMemo(() => {
    if (!count) return 0;
    const cachedReconciliation = Number(count.reconciliation_total ?? 0);
    const cachedPhysical = Number(count.total_physical ?? 0);
    const cachedBankTransfer = Number(count.bank_transfer_confirmed ?? 0);
    return cachedReconciliation + (physical - cachedPhysical) + (bankTransferValue - cachedBankTransfer);
  }, [count, physical, bankTransferValue]);

  const posTotal = Number(count?.pos_total ?? 0);
  const differencePreview = posTotal - reconciliationPreview;

  if (!count) {
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const initialDenoms = countsFromCashCount(count);
  const denomsDirty = DENOMINATIONS.some(
    (d) => (counts[String(d)] ?? 0) !== (initialDenoms[String(d)] ?? 0)
  );
  const bankDirty = bankTransferValue !== Number(count.bank_transfer_confirmed ?? 0);
  const noteDirty = note !== (count.note ?? "");
  const dirty = denomsDirty || bankDirty || noteDirty;

  const tooBigBank = bankTransferValue > limits.amount.max;
  const negBank = bankTransferValue < 0;
  const noteTooLong = note.length > limits.note;
  const hasError = tooBigBank || negBank || noteTooLong;
  const isShiftClose = count.count_type === "shift_close";
  const isBusy = updateM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!count || hasError || !dirty || isBusy) return;
    try {
      const denomsToSubmit: Record<string, number> = {};
      for (const d of DENOMINATIONS) denomsToSubmit[String(d)] = counts[String(d)] ?? 0;
      const result = await updateM.mutateAsync({
        id: count.id,
        denominations_json: denomsDirty ? denomsToSubmit : undefined,
        bank_transfer_confirmed: bankDirty ? bankTransferValue : undefined,
        note: noteDirty ? note : undefined,
      });
      toast({
        semantic: "success",
        message: `Đã sửa kiểm két. Đếm thực ${formatVND(result.total_physical)}, chênh lệch ${formatVND(result.difference)}.`,
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được kiểm két.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,42rem)]">
        <ModalTitle>{formatVND(physical)}</ModalTitle>
        <ModalDescription>
          {isShiftClose ? "Sửa chốt két" : "Sửa kiểm két nhanh"} · {formatDateTime(count.counted_at)}
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <dl className="grid grid-cols-3 gap-3 rounded-md border border-border bg-surface-muted p-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Loại</dt>
              <dd className="text-ink">{isShiftClose ? "Chốt két" : "Kiểm két nhanh"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Tiền vào ca</dt>
              <dd className="text-ink">{formatVND(count.opening_cash ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Tổng POS</dt>
              <dd className="text-ink">{formatVND(posTotal)}</dd>
            </div>
          </dl>

          <div>
            <p className="text-xs uppercase tracking-wide text-muted mb-2">Số tờ tiền</p>
            <DenominationGrid
              value={counts}
              onChange={setCounts}
              disabled={isBusy}
              showQuickAdd={false}
              totalLabel="Tổng đếm"
            />
          </div>

          <TextField
            label="Chuyển khoản đã nhận"
            value={bankTransfer}
            onChange={(e) => setBankTransfer(e.target.value)}
            inputMode="numeric"
            disabled={isBusy}
            error={negBank ? "Không được âm." : tooBigBank ? `Vượt ${formatVND(limits.amount.max)}.` : undefined}
          />

          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={limits.note}
            rows={2}
            disabled={isBusy}
            helper={`${note.length}/${limits.note} ký tự`}
            error={noteTooLong ? `Vượt ${limits.note} ký tự.` : undefined}
          />

          <div className="grid grid-cols-3 gap-3 rounded-md border border-border p-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Đếm thực</p>
              <strong className="block font-display text-ink">{formatVND(physical)}</strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Đối soát (preview)</p>
              <strong className="block font-display text-ink">{formatVND(reconciliationPreview)}</strong>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Chênh lệch (preview)</p>
              <strong
                className={cn(
                  "block font-display",
                  differencePreview === 0 ? "text-success" : "text-danger"
                )}
              >
                {formatVND(differencePreview)}
              </strong>
            </div>
          </div>
          <p className="text-xs text-muted">
            Server sẽ tính lại fresh khi lưu (expense + payroll + theory mới nhất).
          </p>

          <ModalActions>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={hasError || !dirty}
              leadingIcon={<Icon name="save" size={16} />}
            >
              Lưu thay đổi
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
