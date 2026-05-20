"use client";

import { useState } from "react";
import {
  Modal,
  ModalContent,
  ModalTitle,
  ModalDescription,
  ModalActions,
} from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCreateExpenseTemplate } from "@/hooks/mutations/use-expense-mutations";
import { moneyFromInput } from "@/lib/format";
import type { ExpenseCategory, ExpenseTemplate } from "@/lib/types";

interface ExpenseTemplateModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  categories: ReadonlyArray<ExpenseCategory>;
  /** Called on successful create. Receives the new template so the form can
   *  optionally apply it immediately. */
  onCreated(template: ExpenseTemplate): void;
}

/**
 * Modal to create a new expense template. Lives in a Radix Portal (Phase 2
 * Modal compound), so it's OUTSIDE the DOM tree of ExpenseForm — meaning we
 * can use a real <form> element here (unlike v3, which had to use <div> +
 * keyDown trick to avoid nested-form HTML errors).
 */
export function ExpenseTemplateModal({
  open,
  onOpenChange,
  categories,
  onCreated,
}: ExpenseTemplateModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createTemplate = useCreateExpenseTemplate(supabase);

  const [label, setLabel] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [unit, setUnit] = useState("cái");
  const [unitPrice, setUnitPrice] = useState("");

  function resetForm() {
    setLabel("");
    setCategoryId("");
    setUnit("cái");
    setUnitPrice("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim() || createTemplate.isPending) return;
    try {
      const template = await createTemplate.mutateAsync({
        label: label.trim(),
        default_category_id: categoryId || null,
        default_unit: unit,
        last_unit_price: moneyFromInput(unitPrice),
      });
      toast({ semantic: "success", message: "Đã tạo mẫu chi mới." });
      onCreated(template);
      resetForm();
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không tạo được mẫu chi.",
      });
    }
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  return (
    <Modal open={open} onOpenChange={handleOpenChange}>
      <ModalContent>
        <ModalTitle>Thêm mẫu nhập nhanh</ModalTitle>
        <ModalDescription>
          Mẫu giúp lập form chi phí nhanh hơn lần sau.
        </ModalDescription>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <TextField
            label="Tên mẫu"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ví dụ: Bánh mì"
            required
            autoFocus
            disabled={createTemplate.isPending}
          />
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="template-category"
              className="text-xs font-medium text-ink-2"
            >
              Danh mục
            </label>
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              disabled={createTemplate.isPending}
            >
              <SelectTrigger id="template-category">
                <SelectValue placeholder="Chọn danh mục..." />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Đơn vị mặc định"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="ổ, bao, kg..."
              disabled={createTemplate.isPending}
            />
            <TextField
              label="Đơn giá gần nhất"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              inputMode="numeric"
              placeholder="50.000"
              disabled={createTemplate.isPending}
            />
          </div>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={createTemplate.isPending}
            >
              Đóng
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={createTemplate.isPending}
              disabled={!label.trim()}
            >
              Lưu mẫu và áp dụng
            </Button>
          </ModalActions>
        </form>
      </ModalContent>
    </Modal>
  );
}
