"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { TextField } from "@/components/ui/text-field";
import { cn } from "@/lib/cn";
import { formatVND } from "@/lib/format";
import { computeReconciliation, computeReconcileDiff } from "./cash-math";

interface ReconciliationSummaryProps {
  posTotal: number;
  posCash: number;
  posNonCash: number;
  openingCash: number;
  physical: number;
  bankTransferConfirmed: number;
  expenseCashTotal: number;
  payrollCashTotal: number;

  /** Manual POS override block. */
  isManualPos: boolean;
  manualPosTotal: string;
  manualPosCash: string;
  manualPosNonCash: string;
  onManualPosToggle(v: boolean): void;
  onManualPosTotalChange(v: string): void;
  onManualPosCashChange(v: string): void;
  onManualPosNonCashChange(v: string): void;
  disabled?: boolean;
}

/**
 * Display-only reconciliation panel. Renders 10-row summary table + formula
 * card + manual POS override block.
 *
 * Math is delegated to cash-math.ts pure helpers — keeps component free of
 * arithmetic and testable from the helper side.
 */
export function ReconciliationSummary({
  posTotal,
  posCash,
  posNonCash,
  openingCash,
  physical,
  bankTransferConfirmed,
  expenseCashTotal,
  payrollCashTotal,
  isManualPos,
  manualPosTotal,
  manualPosCash,
  manualPosNonCash,
  onManualPosToggle,
  onManualPosTotalChange,
  onManualPosCashChange,
  onManualPosNonCashChange,
  disabled = false,
}: ReconciliationSummaryProps) {
  const reconciliation = computeReconciliation({
    physical,
    openingCash,
    bankTransferConfirmed,
    expenseCashTotal,
    payrollCashTotal,
  });
  const difference = computeReconcileDiff(posTotal, reconciliation);
  const diffTone = difference === 0 ? "text-success" : "text-danger";

  return (
    <Card>
      <CardHeader>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Kết quả đối soát</p>
          <CardTitle>Chênh lệch két</CardTitle>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        {/* 10-row summary */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">Tổng POS</dt>
          <dd className="text-right font-display text-ink">{formatVND(posTotal)}</dd>
          <dt className="text-muted">POS tiền mặt</dt>
          <dd className="text-right font-display text-ink">{formatVND(posCash)}</dd>
          <dt className="text-muted">POS chuyển khoản</dt>
          <dd className="text-right font-display text-ink">{formatVND(posNonCash)}</dd>
          <dt className="text-muted">Tiền vào ca</dt>
          <dd className="text-right font-display text-ink">{formatVND(openingCash)}</dd>
          <dt className="text-muted">Tiền thực đếm</dt>
          <dd className="text-right font-display text-ink">{formatVND(physical)}</dd>
          <dt className="text-muted">Chuyển khoản đã nhận</dt>
          <dd className="text-right font-display text-ink">{formatVND(bankTransferConfirmed)}</dd>
          <dt className="text-muted">Chi phí cash</dt>
          <dd className="text-right font-display text-ink">{formatVND(expenseCashTotal)}</dd>
          <dt className="text-muted">Lương đã phát</dt>
          <dd className="text-right font-display text-ink">{formatVND(payrollCashTotal)}</dd>
          <dt className="text-muted border-t border-border pt-1">Tổng đối soát</dt>
          <dd className="text-right font-display text-ink border-t border-border pt-1">
            {formatVND(reconciliation)}
          </dd>
          <dt className="text-muted">Chênh lệch</dt>
          <dd className={cn("text-right font-display font-bold", diffTone)}>
            {formatVND(difference)}
          </dd>
        </dl>

        {/* Formula card */}
        <div className="rounded-md bg-surface-muted p-3">
          <p className="text-xs uppercase tracking-wide text-muted">Công thức đối soát</p>
          <p className="mt-2 font-mono text-xs text-ink-2 leading-relaxed">
            <strong>{formatVND(posTotal)}</strong> − ((<strong>{formatVND(physical)}</strong> − <strong>{formatVND(openingCash)}</strong>) + <strong>{formatVND(bankTransferConfirmed)}</strong> + <strong>{formatVND(expenseCashTotal)}</strong> + <strong>{formatVND(payrollCashTotal)}</strong>) = <strong className={diffTone}>{formatVND(difference)}</strong>
          </p>
          <p className="mt-1 text-xs text-muted">
            Tổng POS − ((Tiền thực đếm − Tiền vào ca) + Chuyển khoản đã nhận + Chi phí cash + Lương đã phát)
          </p>
        </div>

        {/* Manual POS override */}
        <div className="rounded-md border border-border p-3">
          <Checkbox
            label="Nhập POS thủ công"
            checked={isManualPos}
            onCheckedChange={(checked) => onManualPosToggle(checked === true)}
            disabled={disabled}
          />
          <p className="mt-1 text-xs text-muted">
            Dùng khi POS không sync được (KiotViet API offline, mất kết nối).
          </p>
          {isManualPos && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <TextField
                label="Tổng POS (thủ công)"
                value={manualPosTotal}
                onChange={(e) => onManualPosTotalChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={disabled}
              />
              <TextField
                label="POS tiền mặt"
                value={manualPosCash}
                onChange={(e) => onManualPosCashChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={disabled}
              />
              <TextField
                label="POS chuyển khoản"
                value={manualPosNonCash}
                onChange={(e) => onManualPosNonCashChange(e.target.value)}
                inputMode="numeric"
                placeholder="0"
                disabled={disabled}
              />
              <p className="sm:col-span-3 text-xs text-muted">
                Khi bật, các giá trị POS ở bảng đối soát phía trên sẽ dùng số bạn nhập tay thay vì dữ liệu sync.
              </p>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
