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
import { AlertBanner } from "@/components/ui/alert-banner";
import { Icon } from "@/components/ui/icons";
import { formatVND } from "@/lib/format";
import { DenominationGrid } from "./denomination-grid";
import {
  computeDenominationTotal,
  computeGreedyLeaveBreakdown,
  isLeaveAmountValid,
} from "./cash-math";

interface LeaveDenominationPopupProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Target leave amount from parent (current input value). Used to seed greedy breakdown. */
  initialValue: number;
  /** physical_cash of the report — leave cannot exceed. */
  maxValue: number;
  /** Save callback — receives final total. Parent updates its leave input + closes popup. */
  onConfirm(total: number): void;
}

/**
 * Nested popup inside EditCashCloseModal. User clicks calculator icon next
 * to the "Để lại cho ngày mai" input → this popup opens → user counts by
 * denomination → on Save, total is sent back to parent and popup closes.
 *
 * Seed strategy: greedy breakdown from initialValue (e.g. 237_000 → 200k×1
 * + 20k×1 + 10k×1 + 5k×1 + 2k×1). User can adjust.
 *
 * Validation: total must be ≤ maxValue (physical_cash). Submit disabled if
 * overflow.
 */
export function LeaveDenominationPopup({
  open,
  onOpenChange,
  initialValue,
  maxValue,
  onConfirm,
}: LeaveDenominationPopupProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Re-seed on open. Subsequent reopens with same initialValue re-seed too —
  // that's intentional (user revisiting the popup wants fresh breakdown).
  useEffect(() => {
    if (open) {
      setCounts(computeGreedyLeaveBreakdown(initialValue));
    }
  }, [open, initialValue]);

  const total = useMemo(() => computeDenominationTotal(counts), [counts]);
  const valid = isLeaveAmountValid(total, maxValue);

  function handleSave() {
    if (!valid) return;
    onConfirm(total);
    onOpenChange(false);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>{formatVND(total)}</ModalTitle>
        <ModalDescription>
          Đếm để lại ngày mai · Tối đa {formatVND(maxValue)} (= đếm thực). Phần dư tự nạp sổ quỹ.
        </ModalDescription>
        <div className="mt-6 space-y-4">
          <DenominationGrid
            value={counts}
            onChange={setCounts}
            showQuickAdd={false}
            totalLabel="Tổng để lại"
          />
          {!valid && (
            <AlertBanner variant="danger">
              Vượt đếm thực ({formatVND(maxValue)}). Giảm bớt trước khi lưu.
            </AlertBanner>
          )}
        </div>
        <ModalActions>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!valid}
            onClick={handleSave}
            leadingIcon={<Icon name="save" size={16} />}
          >
            Lưu {formatVND(total)}
          </Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
