"use client";

import { useEffect, useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/text-field";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useSafeBalanceQuery } from "@/hooks/queries";
import { useSaveCashDayOpening } from "@/hooks/mutations/use-cash-mutations";
import { loadPreviousDayLeave } from "@/lib/data";
import { formatVND, moneyFromInput } from "@/lib/format";
import type { CashDayOpening, UserRole } from "@/lib/types";
import { DenominationGrid } from "./denomination-grid";
import { computeDenominationTotal } from "./cash-math";
import { DENOMINATIONS } from "./denominations";

interface OpeningCashModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  opening: CashDayOpening | null;
  businessDate: string;
  role: UserRole;
}

function countsFromOpening(opening: CashDayOpening | null): Record<string, number> {
  const result: Record<string, number> = {};
  for (const denom of DENOMINATIONS) {
    const raw = opening?.denominations_json?.[String(denom)] ?? 0;
    result[String(denom)] = Math.max(0, Number(raw) || 0);
  }
  return result;
}

/**
 * Opening cash modal. Three modes:
 *  - Create (opening === null, canCreate): fresh form
 *  - Edit (opening !== null, canEdit): pre-fill, all editable
 *  - View-only (opening !== null, !canEdit): read-only DenominationGrid + close button only
 *
 * Owner-only safe_withdrawal_amount field — manager can create/edit
 * opening but only owner sees safe withdrawal (sổ quỹ owner-only constraint).
 *
 * Previous-day-leave hint fetched via loadPreviousDayLeave when no opening
 * exists for today — encourages cashier to verify count against yesterday's leave.
 */
export function OpeningCashModal({
  open,
  onOpenChange,
  opening,
  businessDate,
  role,
}: OpeningCashModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const saveOpeningM = useSaveCashDayOpening(supabase, businessDate);

  const isOwner = role === "owner";
  const canCreate = isOwner || role === "manager";
  const canEdit = isOwner;
  const readOnly = Boolean(opening) && !canEdit;

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [carried, setCarried] = useState(false);
  const [safeWithdrawal, setSafeWithdrawal] = useState("");
  const [previousLeave, setPreviousLeave] = useState<{
    business_date: string;
    leave_for_next_day: number;
  } | null>(null);

  const safeBalanceQuery = useSafeBalanceQuery(supabase, open && isOwner && !readOnly);
  const safeBalance = safeBalanceQuery.data?.cash ?? 0;

  // Reset state on open + load previous-day-leave hint.
  useEffect(() => {
    if (!open) return;
    setCounts(countsFromOpening(opening));
    setCarried(Boolean(opening?.carried_from_previous_day));
    setSafeWithdrawal(opening?.safe_withdrawal_amount ? String(opening.safe_withdrawal_amount) : "");
    setPreviousLeave(null);
    if (opening || !supabase) return;
    let cancelled = false;
    void loadPreviousDayLeave(supabase, businessDate)
      .then((result) => {
        if (!cancelled && result && result.leave_for_next_day > 0) setPreviousLeave(result);
      })
      .catch(() => {
        // Silent — hint is nice-to-have, never block UI.
      });
    return () => {
      cancelled = true;
    };
  }, [open, opening, supabase, businessDate]);

  const total = computeDenominationTotal(counts);
  const safeWithdrawalAmount = moneyFromInput(safeWithdrawal);
  const carriedAmount = Math.max(0, total - safeWithdrawalAmount);
  const safeOverflow = safeWithdrawalAmount > safeBalance;
  const safeOverTotal = safeWithdrawalAmount > total;

  const isBusy = saveOpeningM.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (readOnly || isBusy || safeOverflow || safeOverTotal) return;
    try {
      await saveOpeningM.mutateAsync({
        business_date: businessDate,
        denominations_json: counts,
        carried_from_previous_day: carried,
        ...(isOwner && safeWithdrawalAmount > 0
          ? { safe_withdrawal_amount: safeWithdrawalAmount }
          : {}),
      });
      toast({
        semantic: "success",
        message:
          safeWithdrawalAmount > 0
            ? `Đã lưu tiền đầu ngày — rút ${formatVND(safeWithdrawalAmount)} từ sổ quỹ.`
            : opening
              ? "Đã cập nhật tiền đầu ngày."
              : "Đã lưu tiền đầu ngày.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được tiền đầu ngày.",
      });
    }
  }

  const titleText = readOnly
    ? "Xem tiền mở két"
    : opening
      ? "Sửa tiền mở két"
      : "Nhập tiền mở két";

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,40rem)]">
        <ModalTitle>{titleText}</ModalTitle>
        <ModalDescription>
          Tiền đầu ngày — {businessDate}
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {readOnly && (
            <AlertBanner variant="info">
              Tiền đầu ngày đã lưu. Manager chỉ được xem; chủ quán mới được chỉnh sửa.
            </AlertBanner>
          )}
          {previousLeave && !readOnly && (
            <AlertBanner variant="info">
              <strong>Báo cáo chốt két ngày {previousLeave.business_date}</strong> đã để lại{" "}
              <strong>{formatVND(previousLeave.leave_for_next_day)}</strong> cho hôm nay. Đếm tờ tiền — tổng nên khớp với số này. (KHÔNG auto-fill, đếm tay để xác nhận.)
            </AlertBanner>
          )}
          <DenominationGrid
            value={counts}
            onChange={setCounts}
            readOnly={readOnly}
            disabled={isBusy}
            showQuickAdd={false}
            totalLabel="Tổng tiền đầu ngày"
          />
          <Checkbox
            label="Chuyển từ tiền cuối ngày trước"
            checked={carried}
            onCheckedChange={(checked) => setCarried(checked === true)}
            disabled={readOnly || isBusy}
          />
          {isOwner && !readOnly && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted">Rút từ sổ quỹ (tùy chọn)</p>
              <p className="text-xs text-muted">
                Số dư sổ quỹ: <strong>{formatVND(safeBalance)}</strong>. Rút bao nhiêu sẽ trừ trực tiếp khỏi sổ quỹ và tính vào tiền đầu ngày.
              </p>
              <TextField
                value={safeWithdrawal}
                onChange={(e) => setSafeWithdrawal(e.target.value)}
                inputMode="numeric"
                placeholder="0 = chỉ carry-over"
                disabled={isBusy}
              />
              {safeOverflow && (
                <AlertBanner variant="danger">
                  Sổ quỹ không đủ ({formatVND(safeBalance)}).
                </AlertBanner>
              )}
              {safeOverTotal && (
                <AlertBanner variant="danger">
                  Số rút không được vượt tổng tiền đầu ngày ({formatVND(total)}).
                </AlertBanner>
              )}
              {safeWithdrawalAmount > 0 && !safeOverflow && !safeOverTotal && (
                <p className="text-xs text-muted">
                  Phân bổ: <strong>{formatVND(carriedAmount)}</strong> carry-over từ ngày cũ +{" "}
                  <strong>{formatVND(safeWithdrawalAmount)}</strong> rút từ sổ quỹ.
                </p>
              )}
            </div>
          )}
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Đóng
            </Button>
            {!readOnly && canCreate && (
              <Button
                type="submit"
                variant="primary"
                loading={isBusy}
                disabled={safeOverflow || safeOverTotal || total === 0}
              >
                Lưu tiền đầu ngày
              </Button>
            )}
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
