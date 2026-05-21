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
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useUpsertRecipe,
  useDeleteRecipe,
} from "@/hooks/mutations/use-recipe-mutations";
import { getRecipeByMenuItem } from "@/lib/data";
import { formatUnit } from "./units";
import type { Recipe, MenuItem, Ingredient } from "@/lib/types";

interface RecipeBuilderModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Null = create mode. Non-null = edit mode (modal fetches detail on open). */
  editingRecipe: Recipe | null;
  /** Optional pre-selected menu_item (gap report "Tạo công thức" click). */
  initialMenuItemId?: string | null;
  /** Menu_items available for the Select (parent filters: only WITHOUT recipes for create). */
  availableMenuItems: MenuItem[];
  /** All active ingredients for the row Selects. */
  ingredients: Ingredient[];
}

interface RowState {
  ingredient_id: string;
  /** String to distinguish empty vs zero. */
  quantity: string;
}

/**
 * Phase 4.C — Recipe Builder Modal (single-step composite form).
 *
 * Layout: menu_item Select (locked in edit) + notes + dynamic ingredient rows
 * (each = ingredient Select + qty TextField + unit display + remove button) +
 * is_active Checkbox (edit only) + delete button (edit only, inline confirm).
 *
 * Init pattern: useEffect([open, editingRecipe, initialMenuItemId]) seeds form
 * state. Edit mode fetches getRecipeByMenuItem to populate rows.
 *
 * Submit: client validates (>=1 item, no duplicates, qty>0) → upsert.
 * Delete: inline AlertBanner.warning replaces ModalActions row (matches
 * handover-tasks-editor-modal pattern from 3C.3).
 */
export function RecipeBuilderModal({
  open,
  onOpenChange,
  editingRecipe,
  initialMenuItemId,
  availableMenuItems,
  ingredients,
}: RecipeBuilderModalProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const upsertM = useUpsertRecipe(supabase);
  const deleteM = useDeleteRecipe(supabase);

  const isEdit = editingRecipe !== null;

  const [selectedMenuItemId, setSelectedMenuItemId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [items, setItems] = useState<RowState[]>([
    { ingredient_id: "", quantity: "" },
  ]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Init on open / target change
  useEffect(() => {
    if (!open) return;
    setConfirmingDelete(false);

    if (editingRecipe && supabase) {
      // Edit mode — fetch detail
      setIsLoadingDetail(true);
      setSelectedMenuItemId(editingRecipe.menu_item_id);
      getRecipeByMenuItem(supabase, editingRecipe.menu_item_id)
        .then((detail) => {
          if (!detail) {
            toast({
              semantic: "danger",
              message: "Không tải được chi tiết công thức.",
            });
            onOpenChange(false);
            return;
          }
          setNotes(detail.notes ?? "");
          setIsActive(detail.is_active);
          setItems(
            detail.items.length > 0
              ? detail.items.map((it) => ({
                  ingredient_id: it.ingredient_id,
                  quantity: String(it.quantity),
                }))
              : [{ ingredient_id: "", quantity: "" }]
          );
        })
        .catch((err) => {
          toast({
            semantic: "danger",
            message:
              err instanceof Error
                ? err.message
                : "Không tải được chi tiết công thức.",
          });
          onOpenChange(false);
        })
        .finally(() => setIsLoadingDetail(false));
    } else {
      // Create mode
      setSelectedMenuItemId(initialMenuItemId ?? null);
      setNotes("");
      setIsActive(true);
      setItems([{ ingredient_id: "", quantity: "" }]);
      setIsLoadingDetail(false);
    }
  }, [open, editingRecipe, initialMenuItemId, supabase, toast, onOpenChange]);

  const filteredItems = items.filter(
    (it) => it.ingredient_id !== "" && it.quantity.trim() !== ""
  );
  const allItemsValid = filteredItems.every(
    (it) => !Number.isNaN(Number(it.quantity)) && Number(it.quantity) > 0
  );
  const ingredientIds = filteredItems.map((it) => it.ingredient_id);
  const noDuplicates = new Set(ingredientIds).size === ingredientIds.length;

  const isBusy = upsertM.isPending || deleteM.isPending || isLoadingDetail;
  const canSubmit =
    selectedMenuItemId !== null &&
    filteredItems.length >= 1 &&
    allItemsValid &&
    noDuplicates &&
    !isBusy;

  function handleAddRow() {
    setItems([...items, { ingredient_id: "", quantity: "" }]);
  }
  function handleRemoveRow(idx: number) {
    setItems(items.filter((_, i) => i !== idx));
  }
  function handleChangeIngredient(idx: number, ingredient_id: string) {
    setItems(items.map((it, i) => (i === idx ? { ...it, ingredient_id } : it)));
  }
  function handleChangeQuantity(idx: number, quantity: string) {
    setItems(items.map((it, i) => (i === idx ? { ...it, quantity } : it)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !selectedMenuItemId) return;

    try {
      await upsertM.mutateAsync({
        menu_item_id: selectedMenuItemId,
        is_active: isActive,
        notes: notes.trim() === "" ? null : notes.trim(),
        items: filteredItems.map((it) => ({
          ingredient_id: it.ingredient_id,
          quantity: Number(it.quantity),
        })),
      });
      toast({
        semantic: "success",
        message: isEdit ? "Đã lưu công thức." : "Đã tạo công thức.",
      });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi lưu công thức.",
      });
    }
  }

  async function handleConfirmDelete() {
    if (!editingRecipe || isBusy) return;
    try {
      await deleteM.mutateAsync({ id: editingRecipe.recipe_id });
      toast({ semantic: "success", message: "Đã xóa công thức." });
      onOpenChange(false);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi xóa.",
      });
      setConfirmingDelete(false);
    }
  }

  // Resolve menu_item display name for title / delete confirm
  const menuItemName = isEdit
    ? editingRecipe.menu_item_name
    : selectedMenuItemId
      ? availableMenuItems.find((m) => m.id === selectedMenuItemId)?.name ?? ""
      : "";

  const menuItemOptionsForCreate = availableMenuItems;

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,36rem)]">
        <ModalTitle>
          {isEdit ? `Sửa công thức cho ${menuItemName}` : "Thêm công thức"}
        </ModalTitle>
        <ModalDescription>
          Công thức gắn 1 sản phẩm với nhiều nguyên liệu. Khi có đơn bán, hệ thống tự trừ kho theo công thức.
        </ModalDescription>

        {isLoadingDetail ? (
          <div className="flex justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Menu item picker */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-ink-2">Sản phẩm</label>
              <Select
                value={selectedMenuItemId ?? undefined}
                onValueChange={(v) => setSelectedMenuItemId(v)}
                disabled={isEdit || isBusy}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Chọn sản phẩm..." />
                </SelectTrigger>
                <SelectContent>
                  {isEdit && editingRecipe ? (
                    <SelectItem value={editingRecipe.menu_item_id}>
                      {editingRecipe.menu_item_name}
                    </SelectItem>
                  ) : menuItemOptionsForCreate.length === 0 ? (
                    <SelectItem value="__empty" disabled>
                      Không còn sản phẩm khả dụng
                    </SelectItem>
                  ) : (
                    menuItemOptionsForCreate.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            {/* Notes */}
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isBusy}
              rows={2}
              maxLength={500}
              placeholder="Ghi chú thêm về công thức (tùy chọn)"
              helper="Tùy chọn"
            />

            {/* Ingredient rows */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <label className="text-xs font-medium text-ink-2">
                  Nguyên liệu
                </label>
                <span className="text-xs text-muted">
                  {filteredItems.length} nguyên liệu
                </span>
              </div>

              {filteredItems.length === 0 && (
                <p className="text-xs text-muted">Thêm ít nhất 1 nguyên liệu</p>
              )}
              {!noDuplicates && (
                <AlertBanner variant="warning">
                  Mỗi nguyên liệu chỉ xuất hiện 1 lần trong công thức.
                </AlertBanner>
              )}
              {filteredItems.length > 0 && !allItemsValid && (
                <AlertBanner variant="warning">
                  Số lượng phải lớn hơn 0.
                </AlertBanner>
              )}

              {items.map((it, idx) => {
                const ing = ingredients.find((i) => i.id === it.ingredient_id);
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-2 p-2 rounded-md border border-border bg-surface"
                  >
                    <div className="flex-1 min-w-0">
                      <Select
                        value={it.ingredient_id || undefined}
                        onValueChange={(v) => handleChangeIngredient(idx, v)}
                        disabled={isBusy}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Chọn nguyên liệu..." />
                        </SelectTrigger>
                        <SelectContent>
                          {ingredients.length === 0 ? (
                            <SelectItem value="__empty" disabled>
                              Chưa có nguyên liệu
                            </SelectItem>
                          ) : (
                            ingredients.map((i) => (
                              <SelectItem key={i.id} value={i.id}>
                                {i.name}
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24">
                      <TextField
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min="0"
                        value={it.quantity}
                        onChange={(e) =>
                          handleChangeQuantity(idx, e.target.value)
                        }
                        disabled={isBusy}
                        placeholder="0"
                        aria-label="Số lượng"
                      />
                    </div>
                    <div className="w-12 pt-2 text-xs text-muted">
                      {ing ? formatUnit(ing.unit) : ""}
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => handleRemoveRow(idx)}
                      disabled={isBusy}
                      aria-label="Xóa nguyên liệu khỏi công thức"
                    >
                      <Icon name="trash" size={16} />
                    </Button>
                  </div>
                );
              })}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleAddRow}
                disabled={isBusy}
                leadingIcon={<Icon name="plus" size={16} />}
              >
                Thêm nguyên liệu
              </Button>
            </div>

            {/* is_active (edit mode only) */}
            {isEdit && (
              <Checkbox
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked === true)}
                disabled={isBusy}
                label="Đang dùng"
              />
            )}

            {/* Actions */}
            {confirmingDelete ? (
              <div className="space-y-3 border-t border-border pt-4">
                <AlertBanner variant="warning">
                  Xóa công thức của &quot;{menuItemName}&quot;? Hành động này không hoàn tác.
                </AlertBanner>
                <div className="flex justify-end gap-2">
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
                    loading={deleteM.isPending}
                    onClick={handleConfirmDelete}
                  >
                    Xác nhận xóa
                  </Button>
                </div>
              </div>
            ) : (
              <ModalActions>
                {isEdit && (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => setConfirmingDelete(true)}
                    disabled={isBusy}
                  >
                    Xóa công thức
                  </Button>
                )}
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
                  loading={upsertM.isPending}
                  disabled={!canSubmit}
                >
                  {isEdit ? "Lưu" : "Thêm"}
                </Button>
              </ModalActions>
            )}
          </form>
        )}
      </ModalContent>
    </Modal>
  );
}
