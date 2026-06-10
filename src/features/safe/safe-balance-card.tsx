"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { CountUp } from "@/components/ui/count-up";
import { formatVND } from "@/lib/format";

interface SafeBalanceCardProps {
  cash: number;
  transfer: number;
  total: number;
  txnCount: number;
  isLoading: boolean;
  onSetup(): void;
  onWithdraw(): void;
  onPurchase(): void;
  onAdjust(): void;
  onCount(): void;
}

/**
 * Header card showing safe balance + 4 action buttons.
 * First-time UX: only Setup button visible.
 * After setup: Setup hidden; Withdraw/Adjust/Count visible.
 */
export function SafeBalanceCard({
  cash,
  transfer,
  total,
  txnCount,
  isLoading,
  onSetup,
  onWithdraw,
  onPurchase,
  onAdjust,
  onCount
}: SafeBalanceCardProps) {
  const isFirstTime = txnCount === 0 && total === 0;

  if (isLoading) {
    return (
      <Card>
        <CardBody className="flex justify-center py-12">
          <Spinner size={32} />
        </CardBody>
      </Card>
    );
  }

  if (isFirstTime) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon="piggyBank"
            title="Sổ quỹ chưa được thiết lập"
            subtitle="Khai báo số dư mở đầu để bắt đầu theo dõi sổ quỹ."
            action={
              <Button variant="primary" onClick={onSetup} leadingIcon={<Icon name="plus" size={16} />}>
                Thiết lập sổ quỹ
              </Button>
            }
          />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Tổng quỹ hiện tại</p>
            <p className="font-display text-4xl font-bold text-ink tabular-nums mt-1">
              <CountUp value={total} format={formatVND} />
            </p>
          </div>
          <p className="text-xs text-muted">{txnCount} giao dịch</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Quỹ tiền mặt</p>
            <p className="font-display text-lg text-ink tabular-nums mt-1">{formatVND(cash)}</p>
          </div>
          <div className="rounded-md border border-border bg-surface-muted p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Quỹ chuyển khoản</p>
            <p className="font-display text-lg text-ink tabular-nums mt-1">{formatVND(transfer)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={onWithdraw}
            leadingIcon={<Icon name="arrowDownRight" size={16} />}
          >
            Rút khác
          </Button>
          <Button
            variant="secondary"
            onClick={onPurchase}
            leadingIcon={<Icon name="package" size={16} />}
          >
            Nhập nguyên liệu
          </Button>
          <Button
            variant="secondary"
            onClick={onAdjust}
            leadingIcon={<Icon name="pencil" size={16} />}
          >
            Điều chỉnh
          </Button>
          <Button
            variant="secondary"
            onClick={onCount}
            leadingIcon={<Icon name="calculator" size={16} />}
          >
            Đếm sổ quỹ
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
