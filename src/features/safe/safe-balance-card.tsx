"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { CountUp } from "@/components/ui/count-up";
import { formatVND } from "@/lib/format";

interface SafeBalanceCardProps {
  balance: number;
  txnCount: number;
  isLoading: boolean;
  onSetup(): void;
  onWithdraw(): void;
  onAdjust(): void;
  onCount(): void;
}

/**
 * Header card showing safe balance + 4 action buttons.
 * First-time UX: only Setup button visible.
 * After setup: Setup hidden; Withdraw/Adjust/Count visible.
 */
export function SafeBalanceCard({
  balance,
  txnCount,
  isLoading,
  onSetup,
  onWithdraw,
  onAdjust,
  onCount
}: SafeBalanceCardProps) {
  const isFirstTime = txnCount === 0 && balance === 0;

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
            <p className="text-xs uppercase tracking-wide text-muted">Số dư sổ quỹ</p>
            <p className="font-display text-4xl font-bold text-ink tabular-nums mt-1">
              <CountUp value={balance} format={formatVND} />
            </p>
          </div>
          <p className="text-xs text-muted">{txnCount} giao dịch</p>
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
