"use client";

import { useEffect, useState } from "react";
import { Modal, ModalContent, ModalTitle, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { formatNumber, formatVND } from "@/lib/format";

interface IngredientPriceModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  ingredientName: string;
  /** Giá tham chiếu hiện tại (null = chưa đặt). */
  currentPrice: number | null;
  /** Giá nhập gần nhất (gợi ý — last_unit_price). */
  lastUnitPrice: number;
  saving: boolean;
  onSave(price: number): void;
  onClear(): void;
}

/**
 * Modal "Đơn giá — {tên NL}" (owner-only, mở từ dòng Tồn kho).
 * Input numeric ≥16px + dấu chấm nghìn (chống auto-zoom iOS).
 * Nâng thành bottom sheet khi làm phase Modal→Sheet của spec mobile.
 */
export function IngredientPriceModal({
  open,
  onOpenChange,
  ingredientName,
  currentPrice,
  lastUnitPrice,
  saving,
  onSave,
  onClear,
}: IngredientPriceModalProps) {
  const [value, setValue] = useState<number>(currentPrice ?? 0);

  // Mỗi lần mở, đồng bộ lại từ giá hiện tại.
  useEffect(() => {
    if (open) setValue(currentPrice ?? 0);
  }, [open, currentPrice]);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,24rem)]">
        <ModalTitle>Đơn giá — {ingredientName}</ModalTitle>
        <div className="mt-4 space-y-3">
          <div className="relative">
            <input
              inputMode="numeric"
              autoFocus
              value={value === 0 ? "" : formatNumber(value)}
              placeholder="0"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                setValue(digits ? Number(digits) : 0);
              }}
              aria-label="Đơn giá tham chiếu (VND)"
              className="w-full h-14 pl-4 pr-10 rounded-md bg-surface border border-border font-display text-2xl font-bold text-ink tabular-nums placeholder:text-muted/50 focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">₫</span>
          </div>
          {lastUnitPrice > 0 && (
            <button
              type="button"
              onClick={() => setValue(lastUnitPrice)}
              className="text-sm text-ink underline-offset-4 hover:underline"
            >
              Giá nhập gần nhất: {formatVND(lastUnitPrice)} — Dùng giá này
            </button>
          )}
        </div>
        <ModalActions>
          {currentPrice != null && (
            <Button variant="ghost" onClick={onClear} disabled={saving}>
              Xóa giá
            </Button>
          )}
          <Button onClick={() => onSave(value)} loading={saving} disabled={value === 0}>
            Lưu
          </Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
