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
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useRecordStockMovement } from "@/hooks/mutations/use-stock-mutations";
import { formatUnit } from "./units";
import type { Ingredient, StockBalance } from "@/lib/types";

type ManualReason =
  | "purchase_received"
  | "manual_adjustment_in"
  | "manual_adjustment_out"
  | "waste";

interface StockMovementModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialIngredientId?: string | null;
  initialReason?: ManualReason | null;
  ingredients: Ingredient[];
  balances: StockBalance[];
}

const MANUAL_REASON_OPTIONS: ReadonlyArray<{
  value: ManualReason;
  label: string;
  sign: 1 | -1;
  description: string;
}> = [
  {
    value: "purchase_received",
    label: "Nhập mua",
    sign: 1,
    description: "Nhập hàng từ nhà cung cấp",
  },
  {
    value: "manual_adjustment_in",
    label: "Điều chỉnh tăng",
    sign: 1,
    description: "Tăng tồn do nhập sai, tìm thấy hàng dư, v.v.",
  },
  {
    value: "manual_adjustment_out",
    label: "Điều chỉnh giảm",
    sign: -1,
    description: "Giảm tồn do nhập dư, kiểm kê khác, v.v.",
  },
  {
    value: "waste",
    label: "Hao hụt",
    sign: -1,
    description: "Đổ vỡ, hết hạn, chuyển dùng nội bộ, v.v.",
  },
];

/**
 * Phase 4.D — Stock movement modal.
 *
 * Form: ingredient Select + reason Select + positive quantity +
 * sign hint preview + notes.
 *
 * Sign normalization: user always enters POSITIVE quantity; sign is
 * applied based on reason on submit (purchase + adjustment_in → +;
 * adjustment_out + waste → −). Backend CHECK constraint
 * stock_movements_sign_matches_reason validates the result.
 */
export function StockMovementModal({
  open,
  onOpenChange,
  initialIngredientId,
  initialReason,
  ingredients,
  balances,
}: StockMovementModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const recordMovementM = useRecordStockMovement(supabase);

  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState<ManualReason | null>(null);
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedIngredientId(initialIngredientId ?? null);
    setSelectedReason(initialReason ?? null);
    setQuantity("");
    setNotes("");
  }, [open, initialIngredientId, initialReason]);

  const selectedBalance = balances.find(
    (b) => b.ingredient_id === selectedIngredientId
  );
  const currentBalance = selectedBalance?.theoretical_balance ?? 0;
  const unit = selectedBalance?.unit ?? "";

  const reasonMeta = MANUAL_REASON_OPTIONS.find(
    (r) => r.value === selectedReason
  );
  const sign = reasonMeta?.sign ?? null;

  const quantityTrimmed = quantity.trim();
  const quantityNum = quantityTrimmed === "" ? null : Number(quantityTrimmed);
  const quantityValid =
    quantityNum !== null && !Number.isNaN(quantityNum) && quantityNum > 0;

  const signHint =
    selectedReason !== null && quantityValid && quantityNum !== null && sign !== null
      ? sign === 1
        ? `Sẽ tăng ${quantityNum} ${formatUnit(unit)} vào tồn`
        : `Sẽ trừ ${quantityNum} ${formatUnit(unit)} khỏi tồn`
      : null;

  const isBusy = recordMovementM.isPending;
  const canSubmit =
    selectedIngredientId !== null &&
    selectedReason !== null &&
    quantityValid &&
    !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (
      !canSubmit ||
      !selectedIngredientId ||
      !selectedReason ||
      sign === null ||
      quantityNum === null
    )
      return;

    try {
      await recordMovementM.mutateAsync({
        ingredient_id: selectedIngredientId,
        quantity_delta: sign * quantityNum,
        reason: selectedReason,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      toast({ semantic: "success", message: "Đã ghi nhận nhập xuất." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message:
          err instanceof Error
            ? err.message
            : "Có lỗi khi ghi nhận nhập xuất.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>Ghi nhập xuất</ModalTitle>
        <ModalDescription>
          Ghi nhận thay đổi tồn kho thủ công (nhập mua, hao hụt, điều chỉnh).
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">
              Nguyên liệu
            </label>
            <Combobox
              value={selectedIngredientId}
              onValueChange={(v) => setSelectedIngredientId(v)}
              disabled={isBusy || initialIngredientId != null}
              className="w-full"
              placeholder="Chọn nguyên liệu..."
              searchPlaceholder="Tìm nguyên liệu..."
              emptyText="Chưa có nguyên liệu"
              options={ingredients.map((i) => ({ value: i.id, label: i.name }))}
            />
          </div>

          {selectedBalance && (
            <p className="text-xs text-muted">
              Tồn hiện tại:{" "}
              <span className="font-mono tabular-nums">
                {currentBalance} {formatUnit(unit)}
              </span>
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">Lý do</label>
            <Select
              value={selectedReason ?? undefined}
              onValueChange={(v) => setSelectedReason(v as ManualReason)}
              disabled={isBusy || initialReason != null}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn lý do..." />
              </SelectTrigger>
              <SelectContent>
                {MANUAL_REASON_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reasonMeta && (
              <p className="text-xs text-muted">{reasonMeta.description}</p>
            )}
          </div>

          <TextField
            label="Số lượng"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={isBusy || selectedIngredientId === null}
            placeholder="0"
            helper={signHint ?? undefined}
            error={
              quantityTrimmed !== "" && !quantityValid
                ? "Số lượng phải lớn hơn 0."
                : undefined
            }
          />

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={2}
            maxLength={500}
            placeholder={
              selectedReason === "waste" ||
              selectedReason === "manual_adjustment_out"
                ? "Ghi chú (khuyến nghị) — VD: đổ vỡ, hết hạn..."
                : "Ghi chú (tùy chọn)"
            }
            helper="Tùy chọn"
          />

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isBusy}
              disabled={!canSubmit}
            >
              Lưu
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
