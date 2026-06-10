"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { useSupabase } from "@/hooks/use-supabase";
import { useSafeBalanceQuery, useSafeTransactionsQuery } from "@/hooks/queries";
import { todayInVN } from "@/lib/datetime";
import type { SafeTransactionType, UserRole } from "@/lib/types";
import { SafeBalanceCard } from "./safe-balance-card";
import { SafeHistorySection } from "./safe-history-section";
import { SetupSafeModal } from "./setup-safe-modal";
import { WithdrawSafeModal } from "./withdraw-safe-modal";
import { AdjustSafeModal } from "./adjust-safe-modal";
import { CountSafeModal } from "./count-safe-modal";
import { SafeTransactionDetailModal } from "./safe-transaction-detail-modal";

interface SafeViewProps {
  businessDate: string;
  role: UserRole;
}

function subtractDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Owner-only Safe (sổ quỹ) container.
 *
 * Defense-in-depth: NAV_ITEMS already gates `safe` to owner only, but render
 * an EmptyState fallback if somehow reached as non-owner.
 *
 * State:
 *   - 5 modal-open flags
 *   - selectedTxId for the detail modal
 *   - pendingAdjust for the Count→Adjust chain (sets initialNewBalance on
 *     AdjustSafeModal then clears on AdjustSafeModal close)
 *   - fromDate / toDate / typeFilter for history (default last 90 days)
 */
export function SafeView({ businessDate: _businessDate, role }: SafeViewProps) {
  const supabase = useSupabase();
  const today = todayInVN();
  const [fromDate, setFromDate] = useState(() => subtractDays(today, 90));
  const [toDate, setToDate] = useState(today);
  const [typeFilter, setTypeFilter] = useState<SafeTransactionType | "all">("all");

  const [isSetupOpen, setSetupOpen] = useState(false);
  const [isWithdrawOpen, setWithdrawOpen] = useState(false);
  const [isAdjustOpen, setAdjustOpen] = useState(false);
  const [isCountOpen, setCountOpen] = useState(false);
  const [detailTxId, setDetailTxId] = useState<string | null>(null);
  const [pendingAdjust, setPendingAdjust] = useState<{ newBalance: number } | null>(null);

  const balanceQuery = useSafeBalanceQuery(supabase, role === "owner");
  const txnsQuery = useSafeTransactionsQuery(
    supabase,
    {
      fromDate,
      toDate,
      type: typeFilter === "all" ? undefined : typeFilter
    },
    role === "owner"
  );

  const balances = balanceQuery.data ?? { cash: 0, transfer: 0, total: 0 };
  const transactions = useMemo(() => txnsQuery.data ?? [], [txnsQuery.data]);

  if (role !== "owner") {
    return (
      <EmptyState
        icon="lock"
        title="Sổ quỹ owner only"
        subtitle="Module này dành riêng cho chủ quán."
      />
    );
  }

  function handleCountAdjustChain(newBalance: number) {
    setCountOpen(false);
    setPendingAdjust({ newBalance });
    setAdjustOpen(true);
  }

  function handleAdjustClose(open: boolean) {
    setAdjustOpen(open);
    if (!open) setPendingAdjust(null);
  }

  function handleResetFilter() {
    setFromDate(subtractDays(today, 90));
    setToDate(today);
    setTypeFilter("all");
  }

  function handleLoadOlder() {
    setFromDate((current) => subtractDays(current, 90));
  }

  return (
    <div className="space-y-4">
      <SafeBalanceCard
        cash={balances.cash}
        transfer={balances.transfer}
        total={balances.total}
        txnCount={transactions.length}
        isLoading={balanceQuery.isLoading}
        onSetup={() => setSetupOpen(true)}
        onWithdraw={() => setWithdrawOpen(true)}
        onAdjust={() => setAdjustOpen(true)}
        onCount={() => setCountOpen(true)}
      />

      <SafeHistorySection
        transactions={transactions}
        fromDate={fromDate}
        toDate={toDate}
        typeFilter={typeFilter}
        isLoading={txnsQuery.isLoading}
        isFetching={txnsQuery.isFetching}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onTypeFilterChange={setTypeFilter}
        onLoadOlder={handleLoadOlder}
        onResetFilter={handleResetFilter}
        onSelectTx={setDetailTxId}
      />

      <SetupSafeModal open={isSetupOpen} onOpenChange={setSetupOpen} />
      <WithdrawSafeModal open={isWithdrawOpen} onOpenChange={setWithdrawOpen} balances={balances} />
      <AdjustSafeModal
        open={isAdjustOpen}
        onOpenChange={handleAdjustClose}
        balances={balances}
        initialNewBalance={pendingAdjust?.newBalance ?? null}
      />
      <CountSafeModal
        open={isCountOpen}
        onOpenChange={setCountOpen}
        onAdjustChain={handleCountAdjustChain}
      />
      <SafeTransactionDetailModal
        open={detailTxId !== null}
        onOpenChange={(open) => { if (!open) setDetailTxId(null); }}
        transactionId={detailTxId}
      />
    </div>
  );
}
