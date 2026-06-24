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
import { Combobox } from "@/components/ui/combobox";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useRecordStockCount } from "@/hooks/mutations/use-stock-mutations";
import { formatUnit } from "./units";
import type { Ingredient, StockBalance } from "@/lib/types";

interface StockCountModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  initialIngredientId?: string | null;
  ingredients: Ingredient[];
  balances: StockBalance[];
}

/**
 * Phase 4.D — Stock count modal.
 *
 * Form: ingredient Select + read-only theoretical_before + actual qty
 * + live variance display + notes.
 *
 * Submit: backend (record_stock_count) computes delta = actual −
 * theoretical_before and emits count_correction movement.
 *
 * Live variance display:
 *   - delta === 0 → "Đúng số" (success semantic)
 *   - delta > 0   → "Thừa N unit" (success semantic — surplus)
 *   - delta < 0   → "Thiếu N unit" (warning semantic — shortage)
 *
 * No extra confirm step — variance is shown live, then user clicks Lưu.
 */
export function StockCountModal({
  open,
  onOpenChange,
  initialIngredientId,
  ingredients,
  balances,
}: StockCountModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const recordCountM = useRecordStockCount(supabase);

  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [actual, setActual] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedIngredientId(initialIngredientId ?? null);
    setActual("");
    setNotes("");
  }, [open, initialIngredientId]);

  const selectedBalance = balances.find(
    (b) => b.ingredient_id === selectedIngredientId
  );
  const theoreticalBefore = selectedBalance?.theoretical_balance ?? 0;
  const unit = selectedBalance?.unit ?? "";

  const actualTrimmed = actual.trim();
  const actualNum = actualTrimmed === "" ? null : Number(actualTrimmed);
  const actualValid =
    actualNum !== null && !Number.isNaN(actualNum) && actualNum >= 0;
  const delta =
    actualValid && actualNum !== null ? actualNum - theoreticalBefore : null;

  const isBusy = recordCountM.isPending;
  const canSubmit = selectedIngredientId !== null && actualValid && !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedIngredientId || actualNum === null) return;
    try {
      await recordCountM.mutateAsync({
        ingredient_id: selectedIngredientId,
        actual_quantity: actualNum,
        notes: notes.trim() === "" ? null : notes.trim(),
      });
      toast({ semantic: "success", message: "Đã ghi nhận kiểm kê." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message:
          err instanceof Error ? err.message : "Có lỗi khi ghi nhận kiểm kê.",
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>Kiểm kê tồn kho</ModalTitle>
        <ModalDescription>
          Nhập số lượng thực tế từ kiểm đếm. Hệ thống sẽ ghi chênh lệch so với tồn lý thuyết.
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
            <div className="rounded-md border border-border bg-surface-muted p-3">
              <p className="text-xs text-muted">Tồn lý thuyết</p>
              <p className="text-lg font-mono tabular-nums text-ink">
                {theoreticalBefore} {formatUnit(unit)}
              </p>
            </div>
          )}

          <TextField
            label="Số lượng thực tế"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            disabled={isBusy || selectedIngredientId === null}
            placeholder="0"
            error={
              actualTrimmed !== "" && !actualValid
                ? "Số lượng thực tế không thể âm."
                : undefined
            }
          />

          {delta !== null && selectedBalance && (
            <div className="rounded-md border border-border p-3">
              <p className="text-xs text-muted mb-1">Chênh lệch</p>
              {delta === 0 ? (
                <p className="text-sm font-medium text-success">Đúng số</p>
              ) : delta > 0 ? (
                <p className="text-sm font-medium text-success">
                  Thừa {delta} {formatUnit(unit)}
                </p>
              ) : (
                <p className="text-sm font-medium text-warning">
                  Thiếu {Math.abs(delta)} {formatUnit(unit)}
                </p>
              )}
            </div>
          )}

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={2}
            maxLength={500}
            placeholder="Ghi chú (tùy chọn) — VD: kiểm cuối ngày, ca sáng..."
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
