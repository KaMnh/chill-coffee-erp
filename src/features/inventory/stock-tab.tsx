"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useStockBalancesQuery,
  useIngredientsQuery,
} from "@/hooks/queries";
import { StockBalanceList } from "./stock-balance-list";
import { StockCountModal } from "./stock-count-modal";
import { StockMovementModal } from "./stock-movement-modal";
import {
  StockLedgerSection,
  type LedgerFilter,
} from "./stock-ledger-section";
import type { UserRole } from "@/lib/types";

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
 *   Section 1: "Tồn hiện tại" — StockBalanceList
 *   Section 2: "Lịch sử nhập xuất" — StockLedgerSection
 *
 * Toolbar (top): "+ Kiểm kê" + "+ Nhập xuất" buttons (canWrite only).
 *
 * canWrite = role !== "employee_viewer"
 *   (broader than 4.B/4.C; first writeable tab for staff_operator)
 *
 * Filter state for ledger lives here, passed to StockLedgerSection.
 *
 * Active ingredients filtered client-side for the modal Select dropdowns.
 */
export function StockTab({ role }: StockTabProps) {
  const supabase = useSupabase();
  const balancesQuery = useStockBalancesQuery(supabase, true);
  const ingredientsQuery = useIngredientsQuery(supabase, true);

  const canWrite = role !== "employee_viewer";

  const [countModalOpen, setCountModalOpen] = useState(false);
  const [movementModalOpen, setMovementModalOpen] = useState(false);
  const [filter, setFilter] = useState<LedgerFilter>(INITIAL_FILTER);

  const balances = balancesQuery.data ?? [];
  const ingredients = ingredientsQuery.data ?? [];

  const activeIngredients = useMemo(
    () => ingredients.filter((i) => i.is_active),
    [ingredients]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-ink">Tồn kho</h2>
        {canWrite && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => setCountModalOpen(true)}
              leadingIcon={<Icon name="plus" size={16} />}
            >
              Kiểm kê
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setMovementModalOpen(true)}
              leadingIcon={<Icon name="plus" size={16} />}
            >
              Nhập xuất
            </Button>
          </div>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Tồn hiện tại</h3>
        <StockBalanceList
          balances={balances}
          isLoading={balancesQuery.isLoading}
          isError={balancesQuery.isError}
        />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-medium text-ink">Lịch sử nhập xuất</h3>
        <StockLedgerSection
          filter={filter}
          onFilterChange={setFilter}
          ingredients={activeIngredients}
        />
      </section>

      <StockCountModal
        open={countModalOpen}
        onOpenChange={setCountModalOpen}
        ingredients={activeIngredients}
        balances={balances}
      />
      <StockMovementModal
        open={movementModalOpen}
        onOpenChange={setMovementModalOpen}
        ingredients={activeIngredients}
        balances={balances}
      />
    </div>
  );
}
