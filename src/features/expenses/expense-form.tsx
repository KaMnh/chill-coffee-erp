"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertBanner } from "@/components/ui/alert-banner";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useCreateExpense } from "@/hooks/mutations/use-expense-mutations";
import { formatNumber, formatVND, moneyFromInput } from "@/lib/format";
import { validateExpense } from "@/lib/validation";
import type { ExpenseCategory, ExpenseTemplate } from "@/lib/types";
import { ExpenseTemplateModal } from "./expense-template-modal";

interface ExpenseFormProps {
  businessDate: string;
  categories: ReadonlyArray<ExpenseCategory>;
  templates: ReadonlyArray<ExpenseTemplate>;
}

/**
 * Form to create a new expense. Owns:
 * - Field state (useState — simple form, no react-hook-form)
 * - Quick-template rail with click-to-apply behavior
 * - "+ Mẫu" button opens ExpenseTemplateModal (Task 2); on template create,
 *   apply it to the form immediately
 *
 * On submit:
 *   1. validateExpense (Phase 1 helper, mirrors SQL CHECK constraints)
 *   2. mutateAsync via useCreateExpense
 *   3. Toast success + reset form (keep category + unit defaults; clear desc/qty/price/amount/note)
 *
 * Errors surface via AlertBanner inline + toast danger.
 */
export function ExpenseForm({
  businessDate,
  categories,
  templates,
}: ExpenseFormProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const createExpenseM = useCreateExpense(supabase, businessDate);

  const [categoryId, setCategoryId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("cái");
  const [unitPrice, setUnitPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [isTemplateModalOpen, setTemplateModalOpen] = useState(false);

  const computed = (Number(quantity) || 0) * moneyFromInput(unitPrice);
  const finalAmount = moneyFromInput(amount) || computed;
  const topTemplates = templates.slice(0, 8);

  function applyTemplate(template: ExpenseTemplate) {
    setTemplateId(template.id);
    setDescription(template.label);
    setCategoryId(template.default_category_id ?? "");
    setUnit(template.default_unit ?? "cái");
    setUnitPrice(template.last_unit_price ? formatNumber(template.last_unit_price) : "");
    setAmount("");
    toast({ semantic: "info", message: "Đã áp dụng mẫu chi: " + template.label });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateExpense({
      description,
      quantity: Number(quantity) || 0,
      unit_price: moneyFromInput(unitPrice),
      amount: finalAmount,
      note,
    });
    if (!validation.ok) {
      setFieldError({ field: validation.field, message: validation.message });
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    setFieldError(null);
    try {
      await createExpenseM.mutateAsync({
        business_date: businessDate,
        category_id: categoryId || null,
        template_id: templateId || null,
        description: description.trim(),
        quantity: Number(quantity) || 1,
        unit,
        unit_price: moneyFromInput(unitPrice),
        amount: finalAmount,
        note: note.trim(),
        payment_method: "cash",
      });
      // Reset variable fields; keep category + unit as last-used defaults.
      setTemplateId("");
      setDescription("");
      setQuantity("1");
      setUnitPrice("");
      setAmount("");
      setNote("");
      toast({ semantic: "success", message: "Đã lưu khoản chi." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không lưu được khoản chi.",
      });
    }
  }

  const isBusy = createExpenseM.isPending;

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Nhập chi</p>
            <CardTitle>Thêm khoản chi mới</CardTitle>
          </div>
          <strong className="font-display text-base text-ink">
            {formatVND(finalAmount)}
          </strong>
        </div>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Quick-template rail */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">Mẫu nhanh</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTemplateModalOpen(true)}
                disabled={isBusy}
              >
                + Thêm mẫu
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {topTemplates.length === 0 && (
                <span className="text-xs text-muted">Chưa có mẫu chi.</span>
              )}
              {topTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => applyTemplate(t)}
                  disabled={isBusy}
                  className="inline-flex flex-col items-start gap-0.5 rounded-full border border-border bg-surface px-3 py-1.5 text-left transition hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <strong className="text-sm text-ink">{t.label}</strong>
                  <small className="text-xs text-muted">{formatVND(t.last_unit_price)}</small>
                </button>
              ))}
            </div>
          </div>

          {/* Category */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="form-category" className="text-xs font-medium text-ink-2">
              Loại chi phí
            </label>
            <Select
              value={categoryId}
              onValueChange={setCategoryId}
              disabled={isBusy}
            >
              <SelectTrigger id="form-category">
                <SelectValue placeholder="Chọn loại chi phí..." />
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

          {/* Description */}
          <TextField
            label="Nội dung *"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setTemplateId(""); // user edited — no longer the original template
            }}
            placeholder="VD: Bánh mì, trứng, đá viên..."
            required
            disabled={isBusy}
          />

          {/* Qty / unit / unitPrice grid */}
          <div className="grid grid-cols-3 gap-3">
            <TextField
              label="Số lượng"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="decimal"
              disabled={isBusy}
            />
            <TextField
              label="Đơn vị"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              disabled={isBusy}
            />
            <TextField
              label="Đơn giá"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              inputMode="numeric"
              placeholder="50.000"
              disabled={isBusy}
            />
          </div>

          {/* Final amount with auto-compute placeholder */}
          <TextField
            label="Thành tiền"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            placeholder={computed ? formatNumber(computed) : "Tự tính từ SL × đơn giá"}
            disabled={isBusy}
          />

          {/* Note */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="form-note" className="text-xs font-medium text-ink-2">
              Ghi chú
            </label>
            <textarea
              id="form-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="VD: mua tại chợ, người giao..."
              rows={2}
              disabled={isBusy}
              className="rounded-sm bg-surface border border-border px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong disabled:bg-surface-muted disabled:text-muted disabled:cursor-not-allowed"
            />
          </div>

          {fieldError && (
            <AlertBanner variant="danger">{fieldError.message}</AlertBanner>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={isBusy}
            className="w-full"
          >
            Lưu khoản chi · {formatVND(finalAmount)}
          </Button>
        </form>
      </CardBody>

      <ExpenseTemplateModal
        open={isTemplateModalOpen}
        onOpenChange={setTemplateModalOpen}
        categories={categories}
        onCreated={(template) => {
          applyTemplate(template);
        }}
      />
    </Card>
  );
}
