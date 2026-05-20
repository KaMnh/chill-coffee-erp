"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatVND } from "@/lib/format";
import type { CashCount, SalesSyncRun } from "@/lib/types";

interface StoreStatusCardProps {
  activeStaff: number;
  latestSync: SalesSyncRun | null | undefined;
  latestCashCount: CashCount | null | undefined;
}

function syncBadge(sync: SalesSyncRun | null | undefined) {
  if (!sync) return <Badge variant="soft" semantic="warning">Chưa sync</Badge>;
  if (sync.status === "success") return <Badge variant="soft" semantic="success">OK</Badge>;
  if (sync.status === "failed") return <Badge variant="soft" semantic="danger">Lỗi</Badge>;
  return <Badge variant="soft" semantic="warning">{sync.status}</Badge>;
}

/**
 * 3 mini-metrics: active staff count, latest cash check (with difference),
 * latest POS sync (status badge + finished_at). Mirrors v3 dashboard-view.tsx
 * lines 98-111 plus a simplified SyncIndicator.
 */
export function StoreStatusCard({
  activeStaff,
  latestSync,
  latestCashCount,
}: StoreStatusCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tình trạng quầy hôm nay</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">
              Nhân sự đang làm
            </dt>
            <dd className="mt-1 font-display text-lg text-ink">
              {activeStaff} người
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">
              Kiểm két gần nhất
            </dt>
            <dd className="mt-1 font-display text-lg text-ink">
              {latestCashCount
                ? formatVND(latestCashCount.difference)
                : "Chưa có"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">
              Sync POS
            </dt>
            <dd className="mt-1 flex items-center gap-2">
              <span className="font-display text-base text-ink">
                {formatDateTime(latestSync?.finished_at)}
              </span>
              {syncBadge(latestSync)}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}
