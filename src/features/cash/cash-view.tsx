"use client";

import { useState } from "react";
import { useSupabase } from "@/hooks/use-supabase";
import {
  useCashCountsQuery,
  useCashOpeningQuery,
  useDashboardQuery,
} from "@/hooks/queries";
import {
  useSaveCashCount,
  useFinalizeCashClose,
} from "@/hooks/mutations/use-cash-mutations";
import { useCashDraftPersistence } from "@/hooks/use-cash-draft-persistence";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { Textarea } from "@/components/ui/textarea";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/toast";
import { formatNumber, formatVND, moneyFromInput } from "@/lib/format";
import { validateCashCount } from "@/lib/validation";
import type { CashCount, UserRole } from "@/lib/types";
import { CashCountWizard, type WizardStep } from "./cash-count-wizard";
import { ReconciliationSummary } from "./reconciliation-summary";
import { CashHistorySection } from "./cash-history-section";
import { OpeningCashModal } from "./opening-cash-modal";
import { EditCashCountModal } from "./edit-cash-count-modal";
import { EditCashCloseModal } from "./edit-cash-close-modal";
import { VoidCashCloseModal } from "./void-cash-close-modal";
import { computeDenominationTotal } from "./cash-math";

interface CashViewProps {
  businessDate: string;
  role: UserRole;
}

/**
 * Top-level container for view === "cash". Mounts 3 queries (dashboard for
 * POS + expense + payroll totals; cashOpening for tiền đầu ngày; cashCounts
 * for history). Owns all modal state + denomination grid state + manual POS
 * override state.
 *
 * Two main actions:
 *  - "Kiểm két nhanh" (spot_audit): save cash_count, no report
 *  - "Chốt két & tạo báo cáo" (shift_close): save cash_count → finalize → create report + auto safe_deposit
 *
 * Counts stay after spot_audit (operator may re-audit); reset after shift_close.
 */
export function CashView({ businessDate, role }: CashViewProps) {
  const supabase = useSupabase();
  const { toast } = useToast();
  const dashboardQuery = useDashboardQuery(supabase, businessDate, true);
  const cashOpeningQuery = useCashOpeningQuery(supabase, businessDate, true);
  const cashCountsQuery = useCashCountsQuery(supabase, businessDate, true);
  const saveCountM = useSaveCashCount(supabase, businessDate);
  const finalizeM = useFinalizeCashClose(supabase, businessDate);

  const canManage = role === "owner" || role === "manager";

  // Main panel state.
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [nextDayDenoms, setNextDayDenoms] = useState<Record<string, number>>({});
  const [activeStep, setActiveStep] = useState<WizardStep>(1);
  const [bankTransfer, setBankTransfer] = useState("");
  const [note, setNote] = useState("");
  // Legacy state (kept for backward-compat with useCashDraftPersistence shape).
  // Tổng "Để lại ngày mai" giờ derive từ nextDayDenoms; raw text giữ trống.
  const [leaveForNextDay, setLeaveForNextDay] = useState("");
  const [isManualPos, setIsManualPos] = useState(false);
  const [manualPosTotal, setManualPosTotal] = useState("");
  const [manualPosCash, setManualPosCash] = useState("");
  const [manualPosNonCash, setManualPosNonCash] = useState("");

  // Mirror the 8 unsaved inputs above into localStorage so they survive a
  // page refresh. Source of truth stays in the useState calls above; this
  // hook restores on mount/businessDate change and clears on submit.
  const { clearDraft } = useCashDraftPersistence(
    businessDate,
    { counts, bankTransfer, note, leaveForNextDay, isManualPos, manualPosTotal, manualPosCash, manualPosNonCash },
    { setCounts, setBankTransfer, setNote, setLeaveForNextDay, setIsManualPos, setManualPosTotal, setManualPosCash, setManualPosNonCash },
  );

  // Modal state.
  const [isOpeningOpen, setIsOpeningOpen] = useState(false);
  const [editingCount, setEditingCount] = useState<CashCount | null>(null);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [voidingReportId, setVoidingReportId] = useState<string | null>(null);

  if (dashboardQuery.isLoading || cashOpeningQuery.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dữ liệu POS">
        {dashboardQuery.error instanceof Error
          ? dashboardQuery.error.message
          : String(dashboardQuery.error)}
      </AlertBanner>
    );
  }

  const dashboard = dashboardQuery.data;
  const cashOpening = cashOpeningQuery.data ?? null;
  const cashCounts = cashCountsQuery.data ?? [];

  // Resolve POS values (manual override OR sync).
  const dashboardPosTotal = dashboard?.total_sales ?? 0;
  const dashboardPosCash = dashboard?.cash_sales ?? 0;
  const dashboardPosNonCash =
    dashboard?.non_cash_sales ?? Math.max(0, dashboardPosTotal - dashboardPosCash);

  const posTotal = isManualPos ? moneyFromInput(manualPosTotal) : dashboardPosTotal;
  const posCash = isManualPos ? moneyFromInput(manualPosCash) : dashboardPosCash;
  const posNonCash = isManualPos
    ? moneyFromInput(manualPosNonCash)
    : dashboardPosNonCash;

  const openingCash =
    cashOpening?.opening_total ??
    dashboard?.opening_cash ??
    dashboard?.latest_cash_count?.opening_cash ??
    0;
  const physical = computeDenominationTotal(counts);
  const bankTransferConfirmed = moneyFromInput(bankTransfer);
  const expenseCashTotal = dashboard?.total_expenses ?? 0;
  const payrollCashTotal = dashboard?.payroll_paid ?? 0;
  // Derive "leave for next day" từ bảng mệnh giá ngày mai (Step 2 wizard).
  // Cho phép user override qua TextField fallback (legacy) chỉ khi chưa nhập
  // mệnh giá nào — vd: ca cuối chưa kịp đếm tomorrow vẫn save được total.
  const nextDayDenomTotal = computeDenominationTotal(nextDayDenoms);
  const hasNextDayDenom = Object.values(nextDayDenoms).some((c) => c > 0);
  const leaveAmount = hasNextDayDenom
    ? nextDayDenomTotal
    : moneyFromInput(leaveForNextDay);
  const safeDepositPreview = Math.max(0, physical - leaveAmount);
  const nextDayExceeds = nextDayDenomTotal > physical;

  const canCreateOpening = canManage;
  const canOpenOpeningModal = Boolean(cashOpening) || canCreateOpening;
  const isBusy = saveCountM.isPending || finalizeM.isPending;

  async function submit(mode: "spot_audit" | "shift_close") {
    if (!supabase || isBusy) return;
    const validation = validateCashCount({
      total_physical: physical,
      bank_transfer_confirmed: bankTransferConfirmed,
      note,
      denominations_json: counts,
    });
    if (!validation.ok) {
      toast({ semantic: "danger", message: validation.message });
      return;
    }
    // Track which step succeeded so error messages can be step-aware.
    // If saveCashCount succeeds but finalizeCashCloseReport fails, we have
    // an orphan cash_count without a report. Toast must tell the user clearly
    // so they don't double-submit (spec §9 risk register).
    let savedCountId: string | undefined;
    try {
      const saved = await saveCountM.mutateAsync({
        business_date: businessDate,
        count_type: mode,
        counted_at: new Date().toISOString(),
        denominations_json: counts,
        total_physical: physical,
        bank_transfer_confirmed: bankTransferConfirmed,
        note,
        ...(isManualPos
          ? {
              pos_total: posTotal,
              pos_cash_total: posCash,
              pos_non_cash_total: posNonCash,
            }
          : {}),
      });
      savedCountId = saved.cash_count_id;
      let safeDeposit = 0;
      if (mode === "shift_close" && saved.cash_count_id) {
        const result = await finalizeM.mutateAsync({
          cash_count_id: saved.cash_count_id,
          leave_for_next_day: leaveAmount,
          // Server upsert cash_day_openings cho business_date+1 nếu non-null.
          // Bỏ qua nếu user chưa đếm mệnh giá ngày mai (backward compat).
          next_day_denominations: hasNextDayDenom ? nextDayDenoms : null,
        });
        safeDeposit = result.safe_deposit ?? 0;
      }
      toast({
        semantic: "success",
        message:
          mode === "shift_close"
            ? `Đã chốt két${safeDeposit > 0 ? ` và nạp ${formatVND(safeDeposit)} vào sổ quỹ` : ""}.`
            : "Đã lưu kiểm két nhanh.",
      });
      // Clear the localStorage draft mirror on any successful submit.
      // For spot_audit, React state stays (operator may re-audit on screen);
      // a refresh after submit will show an empty form, which is intentional.
      clearDraft();
      // Reset only after shift_close (spot_audit: counts stay for next audit).
      if (mode === "shift_close") {
        setCounts({});
        setNextDayDenoms({});
        setActiveStep(1);
        setBankTransfer("");
        setNote("");
        setLeaveForNextDay("");
      }
    } catch (err) {
      const baseMsg = err instanceof Error ? err.message : "Lỗi không xác định";
      // Step-aware message: if savedCountId is set, the cash_count is already
      // persisted (visible in history). Tell user to recover via admin menu,
      // do NOT re-click submit (would create a duplicate count).
      if (savedCountId && mode === "shift_close") {
        toast({
          semantic: "danger",
          message: `Đã lưu kiểm két (${savedCountId.slice(0, 8)}) NHƯNG chốt báo cáo lỗi: ${baseMsg}. KHÔNG bấm "Chốt két" lại — vào lịch sử, dùng "Sửa count" hoặc void rồi chốt lại.`,
        });
        // Keep counts state so user can verify in history; do NOT reset.
      } else {
        toast({
          semantic: "danger",
          message: `Không lưu được kiểm két: ${baseMsg}`,
        });
      }
    }
  }

  const openingButtonLabel = cashOpening
    ? role === "owner"
      ? "Sửa tiền đầu ngày"
      : "Xem tiền đầu ngày"
    : "Nhập tiền đầu ngày";

  return (
    <div className="space-y-6">
      {/* Opening cash card */}
      <Card>
        <CardHeader>
          <div className="flex w-full items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted">Tiền đầu ngày</p>
              <CardTitle>
                {cashOpening ? formatVND(cashOpening.opening_total) : "Chưa nhập"}
              </CardTitle>
            </div>
            {canOpenOpeningModal && (
              <Button
                type="button"
                variant={cashOpening ? "secondary" : "primary"}
                onClick={() => setIsOpeningOpen(true)}
                disabled={isBusy}
              >
                {openingButtonLabel}
              </Button>
            )}
          </div>
        </CardHeader>
      </Card>

      {/* Main 2-col: CashCountWizard left (Step 1 = today, Step 2 = next day),
          ReconciliationSummary right */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <CashCountWizard
          todayDenominations={counts}
          onTodayChange={setCounts}
          todayTotal={physical}
          nextDayDenominations={nextDayDenoms}
          onNextDayChange={setNextDayDenoms}
          nextDayTotal={nextDayDenomTotal}
          activeStep={activeStep}
          onActiveStepChange={setActiveStep}
          safeDepositPreview={safeDepositPreview}
          disabled={isBusy}
        />

        <ReconciliationSummary
          posTotal={posTotal}
          posCash={posCash}
          posNonCash={posNonCash}
          openingCash={openingCash}
          physical={physical}
          bankTransferConfirmed={bankTransferConfirmed}
          expenseCashTotal={expenseCashTotal}
          payrollCashTotal={payrollCashTotal}
          isManualPos={isManualPos}
          manualPosTotal={manualPosTotal}
          manualPosCash={manualPosCash}
          manualPosNonCash={manualPosNonCash}
          onManualPosToggle={setIsManualPos}
          onManualPosTotalChange={setManualPosTotal}
          onManualPosCashChange={setManualPosCash}
          onManualPosNonCashChange={setManualPosNonCash}
          disabled={isBusy}
        />
      </div>

      {/* Form fields + submit buttons */}
      <Card>
        <CardBody className="space-y-4">
          <TextField
            label="Chuyển khoản đã nhận"
            value={bankTransfer}
            onChange={(e) => setBankTransfer(e.target.value)}
            inputMode="numeric"
            placeholder={formatNumber(posNonCash)}
            disabled={isBusy}
          />
          <Textarea
            label="Ghi chú"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Lý do lệch két, tình trạng POS sync..."
            disabled={isBusy}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => submit("spot_audit")}
              loading={saveCountM.isPending && !finalizeM.isPending}
              disabled={isBusy || physical === 0}
            >
              Kiểm két nhanh
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => submit("shift_close")}
              loading={isBusy}
              disabled={isBusy || physical === 0 || nextDayExceeds}
            >
              Chốt két &amp; tạo báo cáo
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* History */}
      <CashHistorySection
        counts={cashCounts}
        isLoading={cashCountsQuery.isLoading}
        isFetching={cashCountsQuery.isFetching}
        canManage={canManage}
        onEditCount={setEditingCount}
        onEditReport={setEditingReportId}
        onVoidReport={setVoidingReportId}
      />

      {/* Modals */}
      <OpeningCashModal
        open={isOpeningOpen}
        onOpenChange={setIsOpeningOpen}
        opening={cashOpening}
        businessDate={businessDate}
        role={role}
      />
      <EditCashCountModal
        open={editingCount !== null}
        onOpenChange={(next) => {
          if (!next) setEditingCount(null);
        }}
        count={editingCount}
      />
      <EditCashCloseModal
        open={editingReportId !== null}
        onOpenChange={(next) => {
          if (!next) setEditingReportId(null);
        }}
        reportId={editingReportId}
        businessDate={businessDate}
      />
      <VoidCashCloseModal
        open={voidingReportId !== null}
        onOpenChange={(next) => {
          if (!next) setVoidingReportId(null);
        }}
        reportId={voidingReportId}
        businessDate={businessDate}
      />
    </div>
  );
}
