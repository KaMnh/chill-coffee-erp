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
import { useFinalizePeriodClose } from "@/hooks/mutations/use-period-close-mutations";
import { formatVND, moneyFromInput } from "@/lib/format";
import { todayInVN } from "@/lib/datetime";
import { isFundSplitValid } from "@/features/safe/fund-split";
import { drawFromFloat } from "./float-split";
import type { PeriodClosePreview, SafeBalances } from "@/lib/types";

interface PeriodCloseModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  preview: PeriodClosePreview;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/**
 * Modal kết toán kỳ: nhập "số vốn để lại" (float) → tự tính phần rút =
 * số dư − float, tách quỹ kiểu F4 (rút CK trước → phần để lại ưu tiên tiền
 * mặt; cả 2 ô sửa được, sửa ô này ô kia tự bù cho khớp tổng rút).
 * Cho phép rút 0 (chỉ chốt sổ — vẫn ghi snapshot kỳ).
 * Ngày kết = hôm nay (VN) — backdate không hỗ trợ ở UI (RPC có tham số cho test).
 */
export function PeriodCloseModal({ open, onOpenChange, preview }: PeriodCloseModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const finalizeM = useFinalizePeriodClose(supabase);

  const balances: SafeBalances = {
    cash: preview.balance_cash,
    transfer: preview.balance_transfer,
    total: preview.balance_total
  };

  const [floatStr, setFloatStr] = useState("0");
  const [cashStr, setCashStr] = useState("");
  const [transferStr, setTransferStr] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      // Mặc định float 0 → gợi ý rút hết (spec §4.1 suggested_draw_total).
      setFloatStr("0");
      const split = drawFromFloat(
        {
          cash: preview.balance_cash,
          transfer: preview.balance_transfer,
          total: preview.balance_total
        },
        0
      );
      setCashStr(split.cash > 0 ? String(split.cash) : "");
      setTransferStr(split.transfer > 0 ? String(split.transfer) : "");
      setNote("");
    }
  }, [open, preview.balance_cash, preview.balance_transfer, preview.balance_total]);

  const floatTotal = moneyFromInput(floatStr);
  const drawTotal = Math.max(0, balances.total - Math.min(floatTotal, balances.total));
  const drawCash = moneyFromInput(cashStr);
  const drawTransfer = moneyFromInput(transferStr);

  /** Đổi float → áp lại split mặc định cho phần rút (CK trước). */
  function handleFloatChange(raw: string) {
    setFloatStr(raw);
    const split = drawFromFloat(balances, moneyFromInput(raw));
    setCashStr(split.cash > 0 ? String(split.cash) : "");
    setTransferStr(split.transfer > 0 ? String(split.transfer) : "");
  }

  /** Sửa 1 ô quỹ → ô kia tự bù để tổng rút luôn = số dư − float. */
  function handleTransferChange(raw: string) {
    setTransferStr(raw);
    setCashStr(String(Math.max(0, drawTotal - moneyFromInput(raw))));
  }
  function handleCashChange(raw: string) {
    setCashStr(raw);
    setTransferStr(String(Math.max(0, drawTotal - moneyFromInput(raw))));
  }

  const splitValid =
    drawTotal === 0
      ? drawCash === 0 && drawTransfer === 0
      : isFundSplitValid(
          { cash: drawCash, transfer: drawTransfer },
          drawTotal,
          balances.cash,
          balances.transfer
        );
  const floatTooBig = floatTotal > balances.total;
  const isBusy = finalizeM.isPending;
  const hasError = !splitValid || isBusy;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (hasError) return;
    try {
      await finalizeM.mutateAsync({
        closeDate: todayInVN(),
        drawCash,
        drawTransfer,
        note: note || undefined
      });
      toast({
        semantic: "success",
        message:
          drawTotal > 0
            ? `Đã kết kỳ ${shortDate(preview.period_start)}–${shortDate(preview.period_end)} · rút ${formatVND(drawTotal)} · để lại ${formatVND(balances.total - drawTotal)}.`
            : `Đã kết kỳ ${shortDate(preview.period_start)}–${shortDate(preview.period_end)} (không rút).`
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không kết toán được kỳ."
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,36rem)]">
        <ModalTitle>Kết toán kỳ {shortDate(preview.period_start)} – {shortDate(preview.period_end)}</ModalTitle>
        <ModalDescription>
          Lợi nhuận kỳ: <strong>{formatVND(preview.profit)}</strong> · Quỹ tiền mặt:{" "}
          <strong>{formatVND(balances.cash)}</strong> · Quỹ CK:{" "}
          <strong>{formatVND(balances.transfer)}</strong>
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Số vốn để lại (float)"
            value={floatStr}
            onChange={(e) => handleFloatChange(e.target.value)}
            inputMode="numeric"
            placeholder="0"
            disabled={isBusy}
            helper={
              floatTooBig
                ? undefined
                : `Để lại ${formatVND(Math.min(floatTotal, balances.total))} → rút ${formatVND(drawTotal)}`
            }
            error={floatTooBig ? `Số để lại vượt tổng quỹ (${formatVND(balances.total)}).` : undefined}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Rút từ chuyển khoản"
              value={transferStr}
              onChange={(e) => handleTransferChange(e.target.value)}
              inputMode="numeric"
              placeholder="0"
              disabled={isBusy || drawTotal <= 0}
              helper={`Còn ${formatVND(balances.transfer)}`}
            />
            <TextField
              label="Rút từ tiền mặt"
              value={cashStr}
              onChange={(e) => handleCashChange(e.target.value)}
              inputMode="numeric"
              placeholder="0"
              disabled={isBusy || drawTotal <= 0}
              helper={`Còn ${formatVND(balances.cash)}`}
            />
          </div>
          {drawTotal > 0 && drawCash + drawTransfer !== drawTotal && (
            <AlertBanner variant="danger">
              Tách quỹ ({formatVND(drawCash + drawTransfer)}) chưa khớp số rút ({formatVND(drawTotal)}).
            </AlertBanner>
          )}
          {drawTotal === 0 && !floatTooBig && (
            <AlertBanner variant="info">
              Không rút — chỉ ghi snapshot kỳ (doanh thu, chi phí, lương, lợi nhuận).
            </AlertBanner>
          )}
          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="VD: Kết sổ cuối tháng âm lịch..."
            disabled={isBusy}
            helper="Tùy chọn"
          />
          <p className="text-xs text-muted mt-1">
            Khoản rút là <strong>rút lợi nhuận (owner&apos;s draw)</strong> — KHÔNG tính vào chi phí,
            lợi nhuận báo cáo không bị trừ.
          </p>
          <ModalActions>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isBusy}>
              Hủy
            </Button>
            <Button type="submit" variant="primary" loading={isBusy} disabled={hasError}>
              {drawTotal > 0 ? `Kết kỳ & rút ${formatVND(drawTotal)}` : "Kết kỳ (không rút)"}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
