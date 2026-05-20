"use client";

import { useState, useEffect } from "react";
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
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useUpdateExpense,
  useDeleteExpense,
} from "@/hooks/mutations/use-expense-mutations";
import { formatDateTime, formatVND } from "@/lib/format";
import { limits } from "@/lib/validation";
import type { Expense } from "@/lib/types";

interface ExpenseEditModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  expense: Expense | null;
  businessDate: string;
}

/**
 * Edit modal for an existing expense row. Allows description + note edit
 * + delete (with nested confirm Modal).
 *
 * Preserves v3 constraint: amount / category / payment_method are IMMUTABLE
 * after create — editing those would require sync'ing cash_drawer_events
 * and recomputing reports. Out of scope for this phase.
 *
 * Mounted by ExpenseHistoryCard (Task 5). When expense is null (e.g., during
 * close animation), render nothing in the body but keep the Modal Root so
 * onOpenChange still fires.
 */
export function ExpenseEditModal({
  open,
  onOpenChange,
  expense,
  businessDate,
}: ExpenseEditModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const updateExpenseM = useUpdateExpense(supabase, businessDate);
  const deleteExpenseM = useDeleteExpense(supabase, businessDate);

  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Reset state when a new expense is opened.
  useEffect(() => {
    if (expense) {
      setDescription(expense.description ?? "");
      setNote(expense.note ?? "");
      setConfirmingDelete(false);
    }
  }, [expense?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!expense) {
    // Modal closed or no expense selected — render the Root so consumers can
    // still toggle but no body.
    return <Modal open={open} onOpenChange={onOpenChange} />;
  }

  const original = {
    description: expense.description ?? "",
    note: expense.note ?? "",
  };
  const dirty = description !== original.description || note !== original.note;
  const descEmpty = !description.trim();
  const descTooLong = description.length > limits.description;
  const noteTooLong = note.length > limits.note;
  const hasError = descEmpty || descTooLong || noteTooLong;
  const isBusy = updateExpenseM.isPending || deleteExpenseM.isPending;

  async function handleSave() {
    if (!expense || hasError || !dirty || isBusy) return;
    try {
      await updateExpenseM.mutateAsync({
        id: expense.id,
        patch: {
          description: description.trim(),
          note: note.trim() ? note.trim() : null,
        },
      });
      toast({ semantic: "success", message: "Đã cập nhật khoản chi." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không sửa được khoản chi.",
      });
    }
  }

  async function handleDelete() {
    if (!expense || isBusy) return;
    try {
      await deleteExpenseM.mutateAsync(expense.id);
      toast({
        semantic: "success",
        message: `Đã xóa khoản chi ${formatVND(expense.amount)}.`,
      });
      setConfirmingDelete(false);
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không xóa được khoản chi.",
      });
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl/Cmd + Enter saves (matches v3). Plain Enter still creates newline
    // in textarea — don't intercept that.
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleSave();
    }
  }

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange}>
        <ModalContent onKeyDown={handleKeyDown}>
          <ModalTitle>{formatVND(expense.amount)}</ModalTitle>
          <ModalDescription>
            Sửa khoản chi · {expense.category_name ?? "Không có danh mục"} ·{" "}
            {formatDateTime(expense.created_at)}
          </ModalDescription>

          <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Số lượng</dt>
              <dd className="text-ink">
                {expense.quantity ?? 1} {expense.unit ?? ""}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Đơn giá</dt>
              <dd className="text-ink">{formatVND(expense.unit_price ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted">Ngày</dt>
              <dd className="text-ink">{expense.business_date}</dd>
            </div>
          </dl>

          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-description" className="text-xs font-medium text-ink-2">
                Mô tả *
              </label>
              <textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={limits.description}
                disabled={isBusy}
                autoFocus
                rows={3}
                className="rounded-sm bg-surface border border-border px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong disabled:bg-surface-muted disabled:text-muted disabled:cursor-not-allowed"
              />
              <span className="text-xs text-muted">
                {description.length}/{limits.description} ký tự
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="edit-note" className="text-xs font-medium text-ink-2">
                Ghi chú
              </label>
              <textarea
                id="edit-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={limits.note}
                disabled={isBusy}
                rows={3}
                placeholder="Tùy chọn — chi tiết thêm về khoản chi này..."
                className="rounded-sm bg-surface border border-border px-3 py-2 text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong disabled:bg-surface-muted disabled:text-muted disabled:cursor-not-allowed"
              />
              <span className="text-xs text-muted">
                {note.length}/{limits.note} ký tự
              </span>
            </div>
          </div>

          {hasError && (
            <div className="mt-4">
              <AlertBanner variant="danger">
                {descEmpty && "Mô tả không được rỗng. "}
                {descTooLong && `Mô tả vượt ${limits.description} ký tự. `}
                {noteTooLong && `Ghi chú vượt ${limits.note} ký tự.`}
              </AlertBanner>
            </div>
          )}

          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              disabled={isBusy}
              leadingIcon={<Icon name="trash" size={16} />}
              className="mr-auto text-danger hover:bg-danger-soft"
            >
              Xóa
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={!dirty || hasError || isBusy}
              loading={updateExpenseM.isPending}
              leadingIcon={<Icon name="save" size={16} />}
            >
              Lưu thay đổi
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>

      {/* Nested confirm-delete Modal. Separate state from main Modal so we
          can keep the main edit Modal open while showing the confirm. */}
      <Modal open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <ModalContent>
          <ModalTitle>Xóa khoản chi này?</ModalTitle>
          <ModalDescription>
            <strong>{formatVND(expense.amount)}</strong> — {expense.description}.
            Thao tác này KHÔNG thể hoàn tác.
          </ModalDescription>
          <ModalActions>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
              disabled={isBusy}
            >
              Hủy
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              loading={deleteExpenseM.isPending}
              leadingIcon={<Icon name="trash" size={16} />}
            >
              Xóa
            </Button>
          </ModalActions>
        </ModalContent>
      </Modal>
    </>
  );
}
