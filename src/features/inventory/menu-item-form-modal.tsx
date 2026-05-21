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
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useCreateMenuItem,
  useUpdateMenuItem,
} from "@/hooks/mutations/use-inventory-mutations";
import type { MenuItem } from "@/lib/types";

interface MenuItemFormModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Null = create mode. Non-null = edit mode. */
  editingMenuItem: MenuItem | null;
}

const MIN_NAME_LEN = 1;
const MAX_NAME_LEN = 100;
const MAX_EXT_NAME_LEN = 200;

/**
 * Phase 4.B — Menu item create/edit modal.
 *
 * Fields:
 *   - name (required, trimmed)
 *   - external_product_name (optional, max 200 chars; helper explains
 *     the KiotViet matching rule)
 *   - notes (optional)
 *   - is_active (Checkbox, only shown in edit mode)
 *
 * Same lifecycle as IngredientFormModal: init on open, modal stays open
 * during in-flight, closes on success.
 */
export function MenuItemFormModal({
  open,
  onOpenChange,
  editingMenuItem,
}: MenuItemFormModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createM = useCreateMenuItem(supabase);
  const updateM = useUpdateMenuItem(supabase);

  const isEdit = editingMenuItem !== null;

  const [name, setName] = useState("");
  const [externalName, setExternalName] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (editingMenuItem) {
      setName(editingMenuItem.name);
      setExternalName(editingMenuItem.external_product_name ?? "");
      setNotes(editingMenuItem.notes ?? "");
      setIsActive(editingMenuItem.is_active);
    } else {
      setName("");
      setExternalName("");
      setNotes("");
      setIsActive(true);
    }
  }, [open, editingMenuItem]);

  const trimmedName = name.trim();
  const trimmedExt = externalName.trim();
  const nameValid =
    trimmedName.length >= MIN_NAME_LEN && trimmedName.length <= MAX_NAME_LEN;
  const extValid = trimmedExt.length <= MAX_EXT_NAME_LEN;

  const isBusy = createM.isPending || updateM.isPending;
  const canSubmit = nameValid && extValid && !isBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const extValue = trimmedExt === "" ? null : trimmedExt;
    const notesValue = notes.trim() === "" ? null : notes.trim();

    try {
      if (isEdit && editingMenuItem) {
        await updateM.mutateAsync({
          id: editingMenuItem.id,
          name: trimmedName,
          external_product_name: extValue,
          notes: notesValue,
          is_active: isActive,
        });
        toast({ semantic: "success", message: "Đã lưu sản phẩm." });
      } else {
        await createM.mutateAsync({
          name: trimmedName,
          external_product_name: extValue,
          notes: notesValue,
        });
        toast({ semantic: "success", message: "Đã thêm sản phẩm." });
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Có lỗi khi lưu.";
      toast({
        semantic: "danger",
        message: msg.includes("duplicate") ? "Tên sản phẩm đã tồn tại." : msg,
      });
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,32rem)]">
        <ModalTitle>{isEdit ? "Sửa sản phẩm" : "Thêm sản phẩm"}</ModalTitle>
        <ModalDescription>
          {isEdit
            ? "Cập nhật thông tin sản phẩm trong v4."
            : "Thêm sản phẩm để liên kết với công thức và tự động trừ kho khi bán."}
        </ModalDescription>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên sản phẩm (trong v4)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isBusy}
            maxLength={MAX_NAME_LEN + 20}
            placeholder="VD: Cà phê đen đá M"
            error={
              trimmedName.length > 0 && !nameValid
                ? `Tên phải từ ${MIN_NAME_LEN} đến ${MAX_NAME_LEN} ký tự.`
                : undefined
            }
          />

          <TextField
            label="Tên sản phẩm KiotViet (tùy chọn)"
            value={externalName}
            onChange={(e) => setExternalName(e.target.value)}
            disabled={isBusy}
            maxLength={MAX_EXT_NAME_LEN + 20}
            placeholder="VD: Cafe den da M"
            helper="Tên sản phẩm KiotViet phải khớp (không phân biệt hoa thường, đã trim). Để trống = chưa khớp với KiotViet."
            error={
              trimmedExt.length > 0 && !extValid
                ? `Tên KiotViet tối đa ${MAX_EXT_NAME_LEN} ký tự.`
                : undefined
            }
          />

          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isBusy}
            rows={3}
            maxLength={500}
            placeholder="Ghi chú thêm (vd: size, biến thể...)"
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
