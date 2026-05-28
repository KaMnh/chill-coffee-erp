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
import { useMenuItemsQuery } from "@/hooks/queries";
import {
  useUpdateMenuItem,
  useDeleteMenuItem,
} from "@/hooks/mutations/use-inventory-mutations";
import { useListPreferences } from "@/hooks/use-list-preferences";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { InventoryActionButtons } from "./inventory-action-buttons";
import { MenuItemFormModal } from "./menu-item-form-modal";
import type { MenuItem, UserRole } from "@/lib/types";

interface MenuItemsTabProps {
  role: UserRole;
}

/**
 * Phase 4.B — Menu items tab content.
 *
 * Mirrors IngredientsTab structure: filter toggle + create button + list
 * with row actions + inline delete confirm.
 *
 * Differences vs IngredientsTab:
 *   - Shows `external_product_name` as secondary line when present
 *   - Shows "Chưa khớp với KiotViet" warning when external_product_name is null
 *   - Shows "Có công thức" badge if recipe_count > 0
 *   - Delete error message references "công thức" instead of "tồn kho"
 */
export function MenuItemsTab({ role }: MenuItemsTabProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const menuItemsQuery = useMenuItemsQuery(supabase);
  const updateM = useUpdateMenuItem(supabase);
  const deleteM = useDeleteMenuItem(supabase);

  const canWrite = role === "owner" || role === "manager";

  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);

  const menuItems = menuItemsQuery.data ?? [];

  const inactiveCount = useMemo(
    () => menuItems.filter((m) => !m.is_active).length,
    [menuItems]
  );

  const visible = useMemo(
    () => (showInactive ? menuItems : menuItems.filter((m) => m.is_active)),
    [menuItems, showInactive]
  );

  const { prefs, setSearch, setSortExplicit } = useListPreferences("inventory.menu-items");

  const filteredSorted = useMemo(() => {
    const term = prefs.search.trim().toLowerCase();
    const filtered = !term
      ? visible
      : visible.filter(
          (m) =>
            m.name.toLowerCase().includes(term) ||
            (m.external_product_name ?? "").toLowerCase().includes(term),
        );
    if (!prefs.sortColumn) return filtered;
    return [...filtered].sort((a, b) => {
      if (prefs.sortColumn !== "name") return 0;
      const cmp = a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
      return prefs.sortDirection === "asc" ? cmp : -cmp;
    });
  }, [visible, prefs.search, prefs.sortColumn, prefs.sortDirection]);

  const menuItemSortOptions = [
    { value: "name:asc", label: "Tên (A→Z)" },
    { value: "name:desc", label: "Tên (Z→A)" },
  ];

  const menuItemSortValue = prefs.sortColumn
    ? `${prefs.sortColumn}:${prefs.sortDirection}`
    : "name:asc";

  function handleMenuItemSortChange(value: string) {
    const [col, dir] = value.split(":") as [string, "asc" | "desc"];
    setSortExplicit(col, dir);
  }

  function handleOpenCreate() {
    setEditingMenuItem(null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(m: MenuItem) {
    setEditingMenuItem(m);
    setIsModalOpen(true);
  }

  async function handleToggleActive(m: MenuItem) {
    if (busyRowId || !canWrite) return;
    setBusyRowId(m.id);
    try {
      await updateM.mutateAsync({
        id: m.id,
        name: m.name,
        external_product_name: m.external_product_name,
        notes: m.notes,
        is_active: !m.is_active,
      });
      toast({
        semantic: "success",
        message: m.is_active ? "Đã vô hiệu hóa." : "Đã kích hoạt.",
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

  function handleStartDelete(m: MenuItem) {
    setDeletingId(m.id);
  }

  function handleCancelDelete() {
    setDeletingId(null);
  }

  async function handleConfirmDelete(m: MenuItem) {
    if (busyRowId) return;
    setBusyRowId(m.id);
    try {
      await deleteM.mutateAsync({ id: m.id });
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
            Thêm sản phẩm
          </Button>
        )}
      </div>

      <ListToolbar
        search={prefs.search}
        onSearchChange={setSearch}
        searchPlaceholder="Tìm theo tên sản phẩm..."
        resultCount={filteredSorted.length}
        resultLabel="sản phẩm"
        sortOptions={menuItemSortOptions}
        sortValue={menuItemSortValue}
        onSortChange={handleMenuItemSortChange}
      />

      {!showInactive && inactiveCount > 0 && (
        <AlertBanner variant="info">
          Đang ẩn {inactiveCount} sản phẩm đã ngưng dùng. Bật &quot;Hiện cả
          ngưng dùng&quot; để xem.
        </AlertBanner>
      )}

      {menuItemsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : menuItemsQuery.isError ? (
        <AlertBanner variant="danger">
          Không tải được danh sách sản phẩm. Vui lòng tải lại trang.
        </AlertBanner>
      ) : filteredSorted.length === 0 ? (
        <EmptyState
          icon="package"
          title={
            prefs.search
              ? "Không tìm thấy sản phẩm"
              : "Chưa có sản phẩm nào"
          }
          subtitle={
            prefs.search
              ? "Thử từ khóa khác."
              : canWrite
                ? "Bấm 'Thêm sản phẩm' để bắt đầu."
                : "Owner/manager có thể thêm sản phẩm mới."
          }
          dashedBorder
        />
      ) : (
        <div className="space-y-2">
          {filteredSorted.map((m) => {
            const isDeletingThis = deletingId === m.id;
            const isRowBusy = busyRowId === m.id;

            if (isDeletingThis) {
              return (
                <Card key={m.id}>
                  <CardBody className="space-y-3">
                    <AlertBanner variant="warning">
                      Xóa &quot;{m.name}&quot; vĩnh viễn? Nếu sản phẩm đang có
                      công thức, hệ thống sẽ chặn xóa và gợi ý xóa công thức
                      trước.
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
                        onClick={() => handleConfirmDelete(m)}
                      >
                        Xác nhận xóa
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              );
            }

            return (
              <Card key={m.id} className={!m.is_active ? "opacity-70" : ""}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon
                        name="package"
                        size={20}
                        className="text-muted mt-0.5"
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-ink truncate">
                            {m.name}
                          </p>
                          <Badge
                            variant="soft"
                            semantic={m.is_active ? "success" : "neutral"}
                          >
                            {m.is_active ? "Đang dùng" : "Ngưng dùng"}
                          </Badge>
                          {typeof m.recipe_count === "number" && m.recipe_count > 0 && (
                            <Badge variant="soft" semantic="success">
                              Có công thức
                            </Badge>
                          )}
                        </div>
                        {m.external_product_name && (
                          <p className="text-xs text-muted mt-1">
                            Tên KiotViet:{" "}
                            <span className="font-mono">
                              {m.external_product_name}
                            </span>
                          </p>
                        )}
                        {!m.external_product_name && (
                          <p className="text-xs text-muted mt-1 italic">
                            Chưa khớp với KiotViet
                          </p>
                        )}
                        {m.notes && (
                          <p className="text-xs text-muted mt-0.5 truncate">
                            {m.notes}
                          </p>
                        )}
                      </div>
                    </div>
                    <InventoryActionButtons
                      isActive={m.is_active}
                      onEdit={() => handleOpenEdit(m)}
                      onToggleActive={() => handleToggleActive(m)}
                      onDelete={() => handleStartDelete(m)}
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

      <MenuItemFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        editingMenuItem={editingMenuItem}
      />
    </div>
  );
}
