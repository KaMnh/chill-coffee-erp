"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { AlertBanner } from "@/components/ui/alert-banner";
import { cn } from "@/lib/cn";
import { formatVND } from "@/lib/format";
import { DenominationGrid } from "./denomination-grid";

export type WizardStep = 1 | 2;

interface CashCountWizardProps {
  // Step 1 — đếm cuối ngày
  todayDenominations: Record<string, number>;
  onTodayChange(next: Record<string, number>): void;
  todayTotal: number;

  // Step 2 — đầu ngày mai
  nextDayDenominations: Record<string, number>;
  onNextDayChange(next: Record<string, number>): void;
  nextDayTotal: number;

  // Wizard control
  activeStep: WizardStep;
  onActiveStepChange(step: WizardStep): void;

  /** safe_deposit = todayTotal - nextDayTotal (clamped >= 0). Hiển thị inline. */
  safeDepositPreview: number;

  /** Disable all inputs (during mutation). */
  disabled?: boolean;
}

/**
 * 2-step wizard cho màn Chốt két:
 *   - Bước 1: đếm mệnh giá tiền cuối ngày (today's close)
 *   - Bước 2: đếm mệnh giá tiền đầu ngày mai → tự derive safe_deposit
 *
 * Cùng 1 thời điểm chỉ 1 bước expanded; bước kia thu thành header summary.
 * Header có thể bấm để switch active step (2-way toggle).
 *
 * Validation:
 *   - "Tiếp →" disabled nếu todayTotal === 0
 *   - Banner cảnh báo nếu nextDayTotal > todayTotal (vượt physical_cash)
 */
export function CashCountWizard({
  todayDenominations,
  onTodayChange,
  todayTotal,
  nextDayDenominations,
  onNextDayChange,
  nextDayTotal,
  activeStep,
  onActiveStepChange,
  safeDepositPreview,
  disabled = false,
}: CashCountWizardProps) {
  const isStep1Active = activeStep === 1;
  const isStep2Active = activeStep === 2;
  const exceedsToday = nextDayTotal > todayTotal;
  const canAdvance = todayTotal > 0;

  return (
    <Card>
      <CardBody className="space-y-3 p-3">
        {/* === Step 1: Đếm cuối ngày === */}
        <section
          className={cn(
            "rounded-md border transition-colors",
            isStep1Active ? "border-border-strong bg-surface" : "border-border bg-surface-muted/40"
          )}
        >
          <button
            type="button"
            onClick={() => onActiveStepChange(1)}
            disabled={disabled || isStep1Active}
            className="flex w-full items-center justify-between gap-3 p-3 text-left"
            aria-expanded={isStep1Active}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                  isStep1Active ? "bg-ink text-white" : "bg-surface-muted text-ink-2"
                )}
              >
                1
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Đếm tiền cuối ngày</p>
                <p className="text-xs text-muted">
                  Đếm tổng số tiền mặt thực có trong két lúc chốt.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <strong className="font-display text-sm tabular-nums text-ink">
                {formatVND(todayTotal)}
              </strong>
              <Icon name={isStep1Active ? "chevronUp" : "chevronDown"} size={16} />
            </div>
          </button>

          {isStep1Active && (
            <div className="border-t border-border p-3 space-y-3">
              <DenominationGrid
                value={todayDenominations}
                onChange={onTodayChange}
                disabled={disabled}
                showQuickAdd={true}
                totalLabel="Tổng đếm cuối ngày"
              />
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => onActiveStepChange(2)}
                  disabled={disabled || !canAdvance}
                  trailingIcon={<Icon name="arrowRight" size={16} />}
                >
                  Tiếp · đếm đầu ngày mai
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* === Step 2: Đầu ngày mai === */}
        <section
          className={cn(
            "rounded-md border transition-colors",
            isStep2Active ? "border-border-strong bg-surface" : "border-border bg-surface-muted/40"
          )}
        >
          <button
            type="button"
            onClick={() => onActiveStepChange(2)}
            disabled={disabled || isStep2Active}
            className="flex w-full items-center justify-between gap-3 p-3 text-left"
            aria-expanded={isStep2Active}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                  isStep2Active ? "bg-ink text-white" : "bg-surface-muted text-ink-2"
                )}
              >
                2
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Tiền đầu ngày mai</p>
                <p className="text-xs text-muted">
                  Đếm phần để lại cho ca mở ngày kế. Số còn lại nạp vào sổ quỹ.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <strong className="font-display text-sm tabular-nums text-ink">
                {formatVND(nextDayTotal)}
              </strong>
              <Icon name={isStep2Active ? "chevronUp" : "chevronDown"} size={16} />
            </div>
          </button>

          {isStep2Active && (
            <div className="border-t border-border p-3 space-y-3">
              {exceedsToday && (
                <AlertBanner variant="danger">
                  Tiền đầu ngày mai ({formatVND(nextDayTotal)}) đang vượt tiền đếm
                  cuối ngày ({formatVND(todayTotal)}). Giảm bớt mệnh giá hoặc quay
                  lại bước 1 để đếm lại.
                </AlertBanner>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">
                  Copy số tờ đã đếm cuối ngày rồi bớt phần nạp sổ quỹ để chừa lại một phần.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onNextDayChange({ ...todayDenominations })}
                  disabled={disabled || todayTotal === 0}
                  leadingIcon={<Icon name="clipboardList" size={16} />}
                >
                  Copy từ đếm thực
                </Button>
              </div>
              <DenominationGrid
                value={nextDayDenominations}
                onChange={onNextDayChange}
                disabled={disabled}
                showQuickAdd={true}
                totalLabel="Tổng để lại ngày mai"
              />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-md border border-border bg-surface-muted p-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Tổng đếm cuối ngày</p>
                  <strong className="block font-display text-base text-ink tabular-nums">
                    {formatVND(todayTotal)}
                  </strong>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Để lại ngày mai</p>
                  <strong className="block font-display text-base text-ink tabular-nums">
                    {formatVND(nextDayTotal)}
                  </strong>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">Nạp sổ quỹ</p>
                  <strong className="block font-display text-base text-ink tabular-nums">
                    {formatVND(safeDepositPreview)}
                  </strong>
                </div>
              </div>
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onActiveStepChange(1)}
                  disabled={disabled}
                  leadingIcon={<Icon name="chevronLeft" size={16} />}
                >
                  Quay lại
                </Button>
              </div>
            </div>
          )}
        </section>
        <p className="border-t border-border pt-3 text-xs text-muted">
          Sau khi bấm &quot;Chốt két &amp; tạo báo cáo&quot;: hệ thống tự nạp{" "}
          <strong>{formatVND(safeDepositPreview)}</strong> vào sổ quỹ và tạo sẵn
          tiền đầu ngày mai theo bảng mệnh giá ở Bước 2.
        </p>
      </CardBody>
    </Card>
  );
}
