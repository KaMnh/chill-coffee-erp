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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useCreateIngredient,
  useUpdateIngredient,
} from "@/hooks/mutations/use-inventory-mutations";
import { STOCK_UNITS, STOCK_UNIT_LABELS_VI } from "./units";
import type { Ingredient } from "@/lib/types";

interface IngredientFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Null = create mode. Non-null = edit mode (form prefills from this). */
  editingIngredient: Ingredient | null;
}

const MIN_NAME_LEN = 1;
const MAX_NAME_LEN = 100;

/**
 * Phase 4.B — Ingredient create/edit modal.
 *
 * Form fields:
 *   - name (required, trimmed)
 *   - unit (required, Select from STOCK_UNITS)
 *   - low_stock_threshold (optional, must be > 0 if set)
 *   - notes (optional)
 *   - is_active (Checkbox, only shown in edit mode)
 *
 * Initialization: form state is initialized once on modal open via
 * useEffect([open, editingIngredient]). Refetch-driven prop changes do
 * NOT clobber user edits (matches HandoverNoteEditor pattern from 3C.3).
 *
 * Submit: client-side validation for quick feedback, then mutation.
 * Backend remains authoritative; on error, toast surfaces the error
 * message verbatim. Modal stays open during in-flight and on error;
 * closes on success.
 */
export function IngredientFormModal({
  open,
  onOpenChange,
  editingIngredient,
}: IngredientFormModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateIngredient(supabase);
  const updateM = useUpdateIngredient(supabase);

  const isEdit = editingIngredient !== null;

  const [name, setName] = useState("");
  const [unit, setUnit] = useState<string>(STOCK_UNITS[0]);
  const [thresholdInput, setThresholdInput] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editingIngredient) {
      setName(editingIngredient.name);
      setUnit(editingIngredient.unit);
      setThresholdInput(
        editingIngredient.low_stock_threshold != null
          ? String(editingIngredient.low_stock_threshold)
          : ""
      );
      setNotes(editingIngredient.notes ?? "");
      setIsActive(editingIngredient.is_active);
    } else {
      setName("");
      setUnit(STOCK_UNITS[0]);
      setThresholdInput("");
      setNotes("");
      setIsActive(true);
    }
  }, [open, editingIngredient]);

  const trimmedName = name.trim();
  const nameValid =
    trimmedName.length >= MIN_NAME_LEN && trimmedName.length <= MAX_NAME_LEN;

  const thresholdValue: number | null =
    thresholdInput.trim() === "" ? null : Number(thresholdInput);
  const thresholdValid =
    thresholdValue === null ||
    (!Number.isNaN(thresholdValue) && thresholdValue > 0);

  const isBusy = createM.isPending || updateM.isPending;
  const canSubmit = nameValid && thresholdValid && !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      if (isEdit && editingIngredient) {
        await updateM.mutateAsync({
          id: editingIngredient.id,
          name: trimmedName,
          unit,
          low_stock_threshold: thresholdValue,
          notes: notes.trim() === "" ? null : notes.trim(),
          is_active: isActive,
        });
        toast({ semantic: "success", message: "Đã lưu nguyên liệu." });
      } else {
        await createM.mutateAsync({
          name: trimmedName,
          unit,
          low_stock_threshold: thresholdValue,
          notes: notes.trim() === "" ? null : notes.trim(),
        });
        toast({ semantic: "success", message: "Đã thêm nguyên liệu." });
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Có lỗi khi lưu.";
      toast({
        semantic: "danger",
        message: msg.includes("duplicate")
          ? "Tên nguyên liệu đã tồn tại."
          : msg,
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>
          {isEdit ? "Sửa nguyên liệu" : "Thêm nguyên liệu"}
        </ModalTitle>
        <ModalDescription>
          {isEdit
            ? "Cập nhật thông tin nguyên liệu. Có thể tạm thời ngưng dùng nếu chưa muốn xóa."
            : "Thêm nguyên liệu mới vào kho. Số lượng tồn sẽ tính tự động từ các giao dịch."}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên nguyên liệu"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBusy}
            maxLength={MAX_NAME_LEN + 20}
            placeholder="VD: Sữa tươi"
            error={
              trimmedName.length > 0 && !nameValid
                ? `Tên phải từ ${MIN_NAME_LEN} đến ${MAX_NAME_LEN} ký tự.`
                : undefined
            }
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-2">Đơn vị</label>
            <Select value={unit} onValueChange={setUnit} disabled={isBusy}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {STOCK_UNIT_LABELS_VI[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <TextField
            label="Ngưỡng cảnh báo (tùy chọn)"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={thresholdInput}
            onChange={(e) => setThresholdInput(e.target.value)}
            disabled={isBusy}
            placeholder="Để trống = không cảnh báo"
            helper={`Cảnh báo khi tồn dưới mức này (đơn vị: ${STOCK_UNIT_LABELS_VI[unit as keyof typeof STOCK_UNIT_LABELS_VI] ?? unit})`}
            error={
              thresholdInput.trim() !== "" && !thresholdValid
                ? "Ngưỡng phải là số dương."
                : undefined
            }
          />

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={3}
            maxLength={500}
            placeholder="Ghi chú thêm (vd: hãng, quy cách đóng gói...)"
            helper="Tùy chọn — hiển thị dưới tên trong danh sách"
          />

          {isEdit && (
            <Checkbox
              checked={isActive}
              onCheckedChange={(checked) => setIsActive(checked === true)}
              disabled={isBusy}
              label="Đang dùng"
            />
          )}

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
              {isEdit ? "Lưu" : "Thêm"}
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
