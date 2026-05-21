"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useSupabase } from "@/hooks/use-supabase";
import { useIngredientsQuery } from "@/hooks/queries";
import {
  useUpdateIngredient,
  useDeleteIngredient,
} from "@/hooks/mutations/use-inventory-mutations";
import { formatUnit } from "./units";
import { InventoryActionButtons } from "./inventory-action-buttons";
import { IngredientFormModal } from "./ingredient-form-modal";
import type { Ingredient, UserRole } from "@/lib/types";

interface IngredientsTabProps {
  role: UserRole;
}

/**
 * Phase 4.B — Ingredients tab content.
 *
 * Layout:
 *   Header row: [✓] Hiện cả ngưng dùng    [+ Thêm nguyên liệu] (owner/manager only)
 *   Loading / Error / Empty / Data states
 *   Each row: icon + name + unit + threshold + notes + action buttons
 *
 * Filter: showInactive (default false) hides is_active=false rows.
 * When filter OFF and inactive_count > 0, an info banner shows the count.
 *
 * Delete: per-row click → row shows inline AlertBanner.warning + 2 buttons
 * (Hủy / Xác nhận xóa). On error (references exist), toast.danger surfaces
 * the backend Vietnamese message and the row collapses back.
 *
 * Write controls (Thêm, Sửa, Vô hiệu hóa, Xóa) hidden for staff_operator.
 */
export function IngredientsTab({ role }: IngredientsTabProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const ingredientsQuery = useIngredientsQuery(supabase);
  const updateM = useUpdateIngredient(supabase);
  const deleteM = useDeleteIngredient(supabase);

  const canWrite = role === "owner" || role === "manager";

  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<Ingredient | null>(
    null
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const ingredients = ingredientsQuery.data ?? [];

  const inactiveCount = useMemo(
    () => ingredients.filter((i) => !i.is_active).length,
    [ingredients]
  );

  const visible = useMemo(
    () => (showInactive ? ingredients : ingredients.filter((i) => i.is_active)),
    [ingredients, showInactive]
  );

  function handleOpenCreate() {
    setEditingIngredient(null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(ing: Ingredient) {
    setEditingIngredient(ing);
    setIsModalOpen(true);
  }

  async function handleToggleActive(ing: Ingredient) {
    if (busyRowId || !canWrite) return;
    setBusyRowId(ing.id);
    try {
      await updateM.mutateAsync({
        id: ing.id,
        name: ing.name,
        unit: ing.unit,
        low_stock_threshold: ing.low_stock_threshold,
        notes: ing.notes,
        is_active: !ing.is_active,
      });
      toast({
        semantic: "success",
        message: ing.is_active ? "Đã vô hiệu hóa." : "Đã kích hoạt.",
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi cập nhật.",
      });
    } finally {
      setBusyRowId(null);
    }
  }

  function handleStartDelete(ing: Ingredient) {
    setDeletingId(ing.id);
  }

  function handleCancelDelete() {
    setDeletingId(null);
  }

  async function handleConfirmDelete(ing: Ingredient) {
    if (busyRowId) return;
    setBusyRowId(ing.id);
    try {
      await deleteM.mutateAsync({ id: ing.id });
      toast({ semantic: "success", message: "Đã xóa." });
      setDeletingId(null);
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi xóa.",
      });
      setDeletingId(null);
    } finally {
      setBusyRowId(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Checkbox
          checked={showInactive}
          onCheckedChange={(checked) => setShowInactive(checked === true)}
          label="Hiện cả ngưng dùng"
        />
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            onClick={handleOpenCreate}
            leadingIcon={<Icon name="plus" size={16} />}
          >
            Thêm nguyên liệu
          </Button>
        )}
      </div>

      {/* Filter info banner */}
      {!showInactive && inactiveCount > 0 && (
        <AlertBanner variant="info">
          Đang ẩn {inactiveCount} nguyên liệu đã ngưng dùng. Bật &quot;Hiện cả
          ngưng dùng&quot; để xem.
        </AlertBanner>
      )}

      {/* Loading / Error / Empty / Data branches */}
      {ingredientsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : ingredientsQuery.isError ? (
        <AlertBanner variant="danger">
          Không tải được danh sách nguyên liệu. Vui lòng tải lại trang.
        </AlertBanner>
      ) : visible.length === 0 ? (
        <EmptyState
          icon="package"
          title="Chưa có nguyên liệu nào"
          subtitle={
            canWrite
              ? "Bấm 'Thêm nguyên liệu' để bắt đầu."
              : "Owner/manager có thể thêm nguyên liệu mới."
          }
          dashedBorder
        />
      ) : (
        <div className="space-y-2">
          {visible.map((ing) => {
            const isDeletingThis = deletingId === ing.id;
            const isRowBusy = busyRowId === ing.id;

            if (isDeletingThis) {
              return (
                <Card key={ing.id}>
                  <CardBody className="space-y-3">
                    <AlertBanner variant="warning">
                      Xóa &quot;{ing.name}&quot; vĩnh viễn? Nếu nguyên liệu đã
                      có giao dịch tồn kho, hệ thống sẽ chặn xóa và gợi ý vô
                      hiệu hóa thay.
                    </AlertBanner>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleCancelDelete}
                        disabled={isRowBusy}
                      >
                        Hủy
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        loading={isRowBusy}
                        onClick={() => handleConfirmDelete(ing)}
                      >
                        Xác nhận xóa
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              );
            }

            return (
              <Card key={ing.id} className={!ing.is_active ? "opacity-70" : ""}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon name="package" size={20} className="text-muted mt-0.5" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-ink truncate">
                            {ing.name}
                          </p>
                          <Badge
                            variant="soft"
                            semantic={ing.is_active ? "success" : "neutral"}
                          >
                            {ing.is_active ? "Đang dùng" : "Ngưng dùng"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted mt-1">
                          Đơn vị: {formatUnit(ing.unit)}
                          {ing.low_stock_threshold != null && (
                            <>
                              {" · "}Cảnh báo dưới {ing.low_stock_threshold}{" "}
                              {formatUnit(ing.unit)}
                            </>
                          )}
                        </p>
                        {ing.notes && (
                          <p className="text-xs text-muted mt-0.5 truncate">
                            {ing.notes}
                          </p>
                        )}
                      </div>
                    </div>
                    <InventoryActionButtons
                      isActive={ing.is_active}
                      onEdit={() => handleOpenEdit(ing)}
                      onToggleActive={() => handleToggleActive(ing)}
                      onDelete={() => handleStartDelete(ing)}
                      isBusy={isRowBusy}
                      hidden={!canWrite}
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <IngredientFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        editingIngredient={editingIngredient}
      />
    </div>
  );
}
