"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useStockBalancesQuery,
  useIngredientsQuery,
  useIngredientPricesQuery,
} from "@/hooks/queries";
import { useSetIngredientPrice } from "@/hooks/mutations/use-ingredient-price-mutations";
import { useToast } from "@/components/ui/toast";
import { formatVND } from "@/lib/format";
import { stockTotals } from "./stock-value";
import { IngredientPriceModal } from "./ingredient-price-modal";
import { StockBalanceList } from "./stock-balance-list";
import { StockEntryModal } from "./stock-entry-modal";
import {
  StockLedgerSection,
  type LedgerFilter,
} from "./stock-ledger-section";
import type { UserRole } from "@/lib/types";
import { useListPreferences } from "@/hooks/use-list-preferences";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState } from "@/components/ui/empty-state";

interface StockTabProps {
  role: UserRole;
}

const INITIAL_FILTER: LedgerFilter = {
  ingredient_id: null,
  reason: null,
  dateRange: "today",
  limit: 50,
};

/**
 * Phase 4.D — Stock tab content.
 *
 * Two stacked sections:
 *   Section 1: "Tồn hiện tại" — StockBalanceList (rows clickable → opens entry modal)
 *   Section 2: "Lịch sử nhập xuất" — StockLedgerSection
 *
 * Toolbar (top): single "+ Ghi nhận" button (canWrite only). The button
 * opens the unified StockEntryModal with no ingredient pre-selected;
 * clicking a row in the balance list opens the same modal with the
 * row's ingredient pre-selected.
 *
 * canWrite = role !== "employee_viewer"
 *   (broader than 4.B/4.C; first writeable tab for staff_operator)
 *
 * Filter state for ledger lives here, passed to StockLedgerSection.
 *
 * Active ingredients filtered client-side for the modal Select dropdown.
 */
export function StockTab({ role }: StockTabProps) {
  const supabase = useSupabase();
  const balancesQuery = useStockBalancesQuery(supabase, true);
  const ingredientsQuery = useIngredientsQuery(supabase, true);

  const canWrite = role !== "employee_viewer";
  const isOwner = role === "owner";

  // Đơn giá tham chiếu (spec 2026-06-12) — owner-only, RLS chặn role khác.
  const pricesQuery = useIngredientPricesQuery(supabase, isOwner);
  const prices = pricesQuery.data;
  const setPrice = useSetIngredientPrice(supabase);
  const { toast } = useToast();
  const [priceModalId, setPriceModalId] = useState<string | null>(null);

  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [initialIngredientId, setInitialIngredientId] = useState<string | null>(null);
  const [filter, setFilter] = useState<LedgerFilter>(INITIAL_FILTER);

  const balances = balancesQuery.data ?? [];
  const ingredients = ingredientsQuery.data ?? [];

  const activeIngredients = useMemo(
    () => ingredients.filter((i) => i.is_active),
    [ingredients]
  );

  const { prefs, setSearch, setSortExplicit } = useListPreferences("inventory.stock");

  const filteredSortedBalances = useMemo(() => {
    const term = prefs.search.trim().toLowerCase();
    const filtered = !term
      ? balances
      : balances.filter((b) => b.name.toLowerCase().includes(term));
    if (!prefs.sortColumn) return filtered;
    return [...filtered].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      switch (prefs.sortColumn) {
        case "name":
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
          break;
        case "balance":
          av = a.theoretical_balance;
          bv = b.theoretical_balance;
          break;
        default:
          return 0;
      }
      if (av === bv) return 0;
      const cmp = av < bv ? -1 : 1;
      return prefs.sortDirection === "asc" ? cmp : -cmp;
    });
  }, [balances, prefs.search, prefs.sortColumn, prefs.sortDirection]);

  const stockSortOptions = [
    { value: "name:asc", label: "Tên (A→Z)" },
    { value: "name:desc", label: "Tên (Z→A)" },
    { value: "balance:desc", label: "Tồn (cao → thấp)" },
    { value: "balance:asc", label: "Tồn (thấp → cao)" },
  ];

  const stockSortValue = prefs.sortColumn
    ? `${prefs.sortColumn}:${prefs.sortDirection}`
    : "name:asc";

  function handleStockSortChange(value: string) {
    const [col, dir] = value.split(":") as [string, "asc" | "desc"];
    setSortExplicit(col, dir);
  }

  // Tổng giá trị kho theo danh sách đang hiển thị (sau search/sort).
  const totals = useMemo(
    () => (isOwner && prices ? stockTotals(filteredSortedBalances, prices) : null),
    [isOwner, prices, filteredSortedBalances]
  );
  const priceIngredient = ingredients.find((i) => i.id === priceModalId) ?? null;

  function openEntryFromToolbar() {
    setInitialIngredientId(null);
    setEntryModalOpen(true);
  }

  function openEntryFromRow(ingredientId: string) {
    if (!canWrite) return;
    setInitialIngredientId(ingredientId);
    setEntryModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-ink">Tồn kho</h2>
        {canWrite && (
          <Button
            type="button"
            variant="primary"
            onClick={openEntryFromToolbar}
            leadingIcon={<Icon name="plus" size={16} />}
          >
            Ghi nhận
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium text-ink">Tồn hiện tại</h3>
          {totals && (
            <p className="text-sm text-ink-2 tabular-nums">
              Giá trị kho:{" "}
              <strong className="font-display text-ink">{formatVND(totals.total)}</strong>
              {totals.missingCount > 0 && (
                <span className="text-xs text-muted"> ({totals.missingCount} NL chưa có giá)</span>
              )}
            </p>
          )}
        </div>
        <ListToolbar
          search={prefs.search}
          onSearchChange={setSearch}
          searchPlaceholder="Tìm theo tên nguyên liệu..."
          resultCount={filteredSortedBalances.length}
          resultLabel="nguyên liệu"
          sortOptions={stockSortOptions}
          sortValue={stockSortValue}
          onSortChange={handleStockSortChange}
        />
        {prefs.search &&
          !balancesQuery.isLoading &&
          !balancesQuery.isError &&
          filteredSortedBalances.length === 0 ? (
          <EmptyState
            icon="package"
            title="Không tìm thấy nguyên liệu"
            subtitle="Thử từ khóa khác."
            dashedBorder
          />
        ) : (
          <StockBalanceList
            balances={filteredSortedBalances}
            isLoading={balancesQuery.isLoading}
            isError={balancesQuery.isError}
            onSelectIngredient={canWrite ? openEntryFromRow : undefined}
            prices={isOwner ? prices : undefined}
            onEditPrice={isOwner ? setPriceModalId : undefined}
          />
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Lịch sử nhập xuất</h3>
        <StockLedgerSection
          filter={filter}
          onFilterChange={setFilter}
          ingredients={activeIngredients}
        />
      </section>

      {canWrite && (
        <StockEntryModal
          open={entryModalOpen}
          onOpenChange={setEntryModalOpen}
          initialIngredientId={initialIngredientId}
          ingredients={activeIngredients}
          balances={balances}
        />
      )}

      {priceIngredient && (
        <IngredientPriceModal
          open={priceModalId !== null}
          onOpenChange={(o) => {
            if (!o) setPriceModalId(null);
          }}
          ingredientName={priceIngredient.name}
          currentPrice={prices?.get(priceIngredient.id)?.unit_price ?? null}
          lastUnitPrice={priceIngredient.last_unit_price}
          saving={setPrice.isPending}
          onSave={async (p) => {
            try {
              await setPrice.mutateAsync({ ingredientId: priceIngredient.id, unitPrice: p });
              setPriceModalId(null);
              toast({ semantic: "success", message: "Đã lưu đơn giá." });
            } catch (err) {
              toast({
                semantic: "danger",
                message: err instanceof Error ? err.message : "Không lưu được đơn giá.",
              });
            }
          }}
          onClear={async () => {
            try {
              await setPrice.mutateAsync({ ingredientId: priceIngredient.id, unitPrice: null });
              setPriceModalId(null);
              toast({ semantic: "success", message: "Đã xóa đơn giá." });
            } catch (err) {
              toast({
                semantic: "danger",
                message: err instanceof Error ? err.message : "Không xóa được đơn giá.",
              });
            }
          }}
        />
      )}
    </div>
  );
}
