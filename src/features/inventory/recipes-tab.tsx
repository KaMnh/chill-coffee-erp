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
import { useListPreferences } from "@/hooks/use-list-preferences";
import {
  useRecipesQuery,
  useMenuItemsQuery,
  useIngredientsQuery,
} from "@/hooks/queries";
import { useUpsertRecipe } from "@/hooks/mutations/use-recipe-mutations";
import { getRecipeByMenuItem } from "@/lib/data";
import { InventoryActionButtons } from "./inventory-action-buttons";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { Reveal } from "@/components/ui/reveal";
import { RecipeBuilderModal } from "./recipe-builder-modal";
import type { Recipe, UserRole } from "@/lib/types";

interface RecipesTabProps {
  role: UserRole;
}

/**
 * Phase 4.C — Recipes tab content.
 *
 * Two-section layout:
 *   Section 1: "Sản phẩm chưa có công thức" — gap report (menu_items
 *     with recipe_count=0 AND is_active=true). Each row has a
 *     "Tạo công thức" button (canWrite only).
 *   Section 2: "Công thức hiện có" — existing recipes list with
 *     filter toggle (show inactive), row actions (Sửa/Vô hiệu hóa/Xóa).
 *
 * Prerequisite warnings: if ingredients or menu_items list is empty,
 * show AlertBanner.warning at top and disable "Thêm công thức" button.
 *
 * Toggle-active: fetch-then-upsert pattern (see spec §6.5).
 *
 * Delete: handled inside RecipeBuilderModal. The tab's row trash icon
 * opens the modal in edit mode where "Xóa công thức" + inline confirm
 * lives. Avoids duplicate delete-confirm flows.
 *
 * Write controls hidden for staff_operator via InventoryActionButtons
 * hidden prop + conditional button rendering.
 */
export function RecipesTab({ role }: RecipesTabProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const recipesQuery = useRecipesQuery(supabase);
  const menuItemsQuery = useMenuItemsQuery(supabase);
  const ingredientsQuery = useIngredientsQuery(supabase);
  const upsertM = useUpsertRecipe(supabase);

  const canWrite = role === "owner" || role === "manager";

  const [showInactive, setShowInactive] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [initialMenuItemId, setInitialMenuItemId] = useState<string | null>(null);
  const [busyRecipeId, setBusyRecipeId] = useState<string | null>(null);

  const recipes = recipesQuery.data ?? [];
  const menuItems = menuItemsQuery.data ?? [];
  const ingredients = ingredientsQuery.data ?? [];

  const availableMenuItems = useMemo(
    () => menuItems.filter((m) => m.is_active && (m.recipe_count ?? 0) === 0),
    [menuItems]
  );
  const activeIngredients = useMemo(
    () => ingredients.filter((i) => i.is_active),
    [ingredients]
  );

  const inactiveRecipeCount = useMemo(
    () => recipes.filter((r) => !r.is_active).length,
    [recipes]
  );
  const visibleRecipes = useMemo(
    () => (showInactive ? recipes : recipes.filter((r) => r.is_active)),
    [recipes, showInactive]
  );

  const noIngredients = activeIngredients.length === 0;
  const noMenuItems = menuItems.length === 0;
  const prereqMissing = noIngredients || noMenuItems;
  const canAddNew = canWrite && !prereqMissing && availableMenuItems.length > 0;

  const { prefs, setSearch, setSortExplicit } = useListPreferences("inventory.recipes");

  const filteredSortedRecipes = useMemo(() => {
    const term = prefs.search.trim().toLowerCase();
    const filtered = !term
      ? visibleRecipes
      : visibleRecipes.filter((r) =>
          r.menu_item_name.toLowerCase().includes(term)
        );
    if (!prefs.sortColumn) return filtered;
    return [...filtered].sort((a, b) => {
      if (prefs.sortColumn !== "name") return 0;
      const cmp =
        a.menu_item_name.toLowerCase() < b.menu_item_name.toLowerCase()
          ? -1
          : 1;
      return prefs.sortDirection === "asc" ? cmp : -cmp;
    });
  }, [visibleRecipes, prefs.search, prefs.sortColumn, prefs.sortDirection]);

  const recipeSortOptions = [
    { value: "name:asc", label: "Tên (A→Z)" },
    { value: "name:desc", label: "Tên (Z→A)" },
  ];

  const recipeSortValue = prefs.sortColumn
    ? `${prefs.sortColumn}:${prefs.sortDirection}`
    : "name:asc";

  function handleRecipeSortChange(value: string) {
    const [col, dir] = value.split(":") as [string, "asc" | "desc"];
    setSortExplicit(col, dir);
  }

  function handleOpenCreate(menuItemId?: string) {
    if (!canWrite) return;
    setEditingRecipe(null);
    setInitialMenuItemId(menuItemId ?? null);
    setIsModalOpen(true);
  }

  function handleOpenEdit(recipe: Recipe) {
    if (!canWrite) return;
    setEditingRecipe(recipe);
    setInitialMenuItemId(null);
    setIsModalOpen(true);
  }

  async function handleToggleActive(recipe: Recipe) {
    if (busyRecipeId || !canWrite || !supabase) return;
    setBusyRecipeId(recipe.recipe_id);
    try {
      // Fetch detail to get items array (required by upsert_recipe)
      const detail = await getRecipeByMenuItem(supabase, recipe.menu_item_id);
      if (!detail) {
        throw new Error("Không tìm thấy chi tiết công thức.");
      }
      await upsertM.mutateAsync({
        menu_item_id: recipe.menu_item_id,
        is_active: !recipe.is_active,
        notes: detail.notes,
        items: detail.items.map((it) => ({
          ingredient_id: it.ingredient_id,
          quantity: it.quantity,
        })),
      });
      toast({
        semantic: "success",
        message: recipe.is_active ? "Đã vô hiệu hóa." : "Đã kích hoạt.",
      });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Có lỗi khi cập nhật.",
      });
    } finally {
      setBusyRecipeId(null);
    }
  }

  const prereqBanner = prereqMissing && (
    <AlertBanner variant="warning">
      {noIngredients && noMenuItems
        ? "Cần thêm nguyên liệu + sản phẩm trước khi tạo công thức."
        : noIngredients
          ? "Cần thêm nguyên liệu trước."
          : "Cần thêm sản phẩm trước."}
    </AlertBanner>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-ink">Công thức</h2>
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            onClick={() => handleOpenCreate()}
            disabled={!canAddNew}
            leadingIcon={<Icon name="plus" size={16} />}
          >
            Thêm công thức
          </Button>
        )}
      </div>

      {prereqBanner}

      {/* Section 1: Gap report */}
      <section className="space-y-3">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm font-medium text-ink">
            Sản phẩm chưa có công thức
          </h3>
          {availableMenuItems.length > 0 && (
            <Badge variant="soft" semantic="warning">
              {availableMenuItems.length}
            </Badge>
          )}
        </div>

        {availableMenuItems.length === 0 ? (
          <p className="text-sm text-muted">
            Tất cả sản phẩm đã có công thức ✓
          </p>
        ) : (
          <Reveal onScroll className="space-y-2">
            {availableMenuItems.map((m) => (
              <Card key={m.id}>
                <CardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <Icon
                        name="package"
                        size={20}
                        className="text-muted mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink truncate">
                          {m.name}
                        </p>
                        {m.external_product_name && (
                          <p className="text-xs text-muted mt-0.5 truncate">
                            KiotViet: {m.external_product_name}
                          </p>
                        )}
                      </div>
                    </div>
                    {canWrite && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenCreate(m.id)}
                        disabled={prereqMissing}
                        leadingIcon={<Icon name="plus" size={16} />}
                      >
                        Tạo công thức
                      </Button>
                    )}
                  </div>
                </CardBody>
              </Card>
            ))}
          </Reveal>
        )}
      </section>

      {/* Section 2: Existing recipes */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-medium text-ink">Công thức hiện có</h3>
          <Checkbox
            checked={showInactive}
            onCheckedChange={(checked) => setShowInactive(checked === true)}
            label="Hiện cả ngưng dùng"
          />
        </div>

        {!showInactive && inactiveRecipeCount > 0 && (
          <AlertBanner variant="info">
            Đang ẩn {inactiveRecipeCount} công thức đã ngưng dùng. Bật &quot;Hiện cả ngưng dùng&quot; để xem.
          </AlertBanner>
        )}

        <ListToolbar
          search={prefs.search}
          onSearchChange={setSearch}
          searchPlaceholder="Tìm theo tên sản phẩm..."
          resultCount={filteredSortedRecipes.length}
          resultLabel="công thức"
          sortOptions={recipeSortOptions}
          sortValue={recipeSortValue}
          onSortChange={handleRecipeSortChange}
        />

        {recipesQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size={32} />
          </div>
        ) : recipesQuery.isError ? (
          <AlertBanner variant="danger">
            Không tải được danh sách công thức. Vui lòng tải lại trang.
          </AlertBanner>
        ) : filteredSortedRecipes.length === 0 ? (
          <EmptyState
            icon="checkCircle"
            title={prefs.search ? "Không tìm thấy công thức" : "Chưa có công thức nào"}
            subtitle={
              prefs.search
                ? "Thử từ khóa khác."
                : canWrite
                  ? "Bấm 'Thêm công thức' để bắt đầu."
                  : "Owner/manager có thể thêm công thức mới."
            }
            dashedBorder
          />
        ) : (
          <Reveal onScroll className="space-y-2">
            {filteredSortedRecipes.map((r) => {
              const isRowBusy = busyRecipeId === r.recipe_id;
              return (
                <Card
                  key={r.recipe_id}
                  className={!r.is_active ? "opacity-70" : ""}
                >
                  <CardBody>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <Icon
                          name="checkCircle"
                          size={20}
                          className="text-muted mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-ink truncate">
                              {r.menu_item_name}
                            </p>
                            <Badge
                              variant="soft"
                              semantic={r.is_active ? "success" : "neutral"}
                            >
                              {r.is_active ? "Đang dùng" : "Ngưng dùng"}
                            </Badge>
                            <Badge variant="soft" semantic="neutral">
                              {r.item_count} nguyên liệu
                            </Badge>
                          </div>
                          {r.notes && (
                            <p className="text-xs text-muted mt-0.5 truncate">
                              {r.notes}
                            </p>
                          )}
                        </div>
                      </div>
                      <InventoryActionButtons
                        isActive={r.is_active}
                        onEdit={() => handleOpenEdit(r)}
                        onToggleActive={() => handleToggleActive(r)}
                        onDelete={() => handleOpenEdit(r)}
                        isBusy={isRowBusy}
                        hidden={!canWrite}
                      />
                    </div>
                  </CardBody>
                </Card>
              );
            })}
          </Reveal>
        )}
      </section>

      <RecipeBuilderModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        editingRecipe={editingRecipe}
        initialMenuItemId={initialMenuItemId}
        availableMenuItems={availableMenuItems}
        ingredients={activeIngredients}
      />
    </div>
  );
}
