"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

interface InventoryActionButtonsProps {
  /** Whether the row's target entity is currently is_active=true. */
  isActive: boolean;
  /** Click handler for the "Sửa" button (opens edit modal). */
  onEdit(): void;
  /** Click handler for the toggle button. */
  onToggleActive(): void;
  /** Click handler for the delete button (triggers inline confirm in parent). */
  onDelete(): void;
  /** When any mutation is in-flight on this row, disable all buttons. */
  isBusy?: boolean;
  /** When true, returns null — used to hide controls for staff_operator. */
  hidden?: boolean;
}

/**
 * Phase 4.B — Shared row-actions cluster for ingredients + menu_items.
 *
 * Renders three buttons:
 *   [ Sửa ]  [ Vô hiệu hóa | Kích hoạt ]  [ 🗑 ]
 *
 * The toggle label switches based on `isActive`.
 * Delete is an icon-only button (parent component shows the inline
 * AlertBanner confirmation when clicked).
 *
 * Returns null when `hidden === true` (read-only mode for staff_operator).
 */
export function InventoryActionButtons({
  isActive,
  onEdit,
  onToggleActive,
  onDelete,
  isBusy = false,
  hidden = false,
}: InventoryActionButtonsProps) {
  if (hidden) return null;

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onEdit}
        disabled={isBusy}
      >
        Sửa
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onToggleActive}
        disabled={isBusy}
      >
        {isActive ? "Vô hiệu hóa" : "Kích hoạt"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDelete}
        disabled={isBusy}
        aria-label="Xóa"
      >
        <Icon name="trash" size={16} />
      </Button>
    </div>
  );
}
