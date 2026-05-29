"use client";

import { useSupabase } from "@/hooks/use-supabase";
import { useInventoryVarianceQuery } from "@/hooks/queries";
import { Spinner } from "@/components/ui/spinner";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { Reveal } from "@/components/ui/reveal";
import { formatUnit } from "@/features/inventory/units";
import type { DateRange } from "./date-range-picker";
import type { VarianceRow } from "@/lib/data";

/**
 * Phase 5.A — Audit log of count_correction stock movements.
 *
 * Each row = one count_correction movement (date, ingredient, delta,
 * notes, actor). Sorted DESC by occurred_at. Read-only; owner drills
 * into Stock tab for full ledger context.
 */

interface VarianceAuditReportProps {
  dateRange: DateRange;
}

const VISIBLE_LIMIT = 50;

export function VarianceAuditReport({ dateRange }: VarianceAuditReportProps) {
  const supabase = useSupabase();
  const query = useInventoryVarianceQuery(
    supabase,
    dateRange.from,
    dateRange.to,
    !!supabase
  );

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner size={24} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được lịch sử kiểm kê">
        Vui lòng tải lại trang. Lỗi: {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  const data = query.data ?? [];

  if (data.length === 0) {
    return (
      <EmptyState
        dashedBorder
        icon="package"
        title="Chưa có kiểm kê trong khoảng này"
        subtitle="Vào tab Tồn kho → Kiểm đếm để bắt đầu."
      />
    );
  }

  const visible = data.slice(0, VISIBLE_LIMIT);
  const hidden = data.length - visible.length;

  return (
    <Reveal onScroll>
      <Card>
        <CardBody>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h3 className="text-sm font-medium text-ink">Chênh lệch kiểm kê</h3>
            <Badge variant="soft" semantic="neutral">
              {data.length} lần kiểm
            </Badge>
          </div>

          <div className="divide-y divide-border">
            {visible.map((row) => (
              <VarianceRowItem key={row.movement_id} row={row} />
            ))}
          </div>

          {hidden > 0 && (
            <p className="text-xs text-muted mt-3">
              Hiển thị {VISIBLE_LIMIT} dòng gần nhất. Còn {hidden} dòng nữa — xem chi tiết hơn vào tab Tồn kho.
            </p>
          )}
        </CardBody>
      </Card>
    </Reveal>
  );
}

function VarianceRowItem({ row }: { row: VarianceRow }) {
  const sign = row.quantity_delta > 0 ? "+" : "";
  const color =
    row.quantity_delta > 0
      ? "text-success"
      : row.quantity_delta < 0
        ? "text-warning"
        : "text-muted";

  return (
    <div className="flex items-start gap-3 py-2">
      <Icon name="package" size={16} className="text-muted mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-ink truncate">{row.ingredient_name}</p>
          <p className={`text-sm font-mono tabular-nums ${color}`}>
            Δ {sign}{row.quantity_delta.toLocaleString("vi-VN")} {formatUnit(row.unit)}
          </p>
        </div>
        <p className="text-xs text-muted mt-0.5">
          {formatOccurred(row.occurred_at)}
          {row.created_by ? " · bởi: nhân viên" : " · (hệ thống)"}
        </p>
        {row.notes && (
          <p className="text-xs text-muted mt-0.5 truncate">{row.notes}</p>
        )}
      </div>
    </div>
  );
}

function formatOccurred(iso: string): string {
  const then = new Date(iso);
  const now = new Date();
  const isSameDay =
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate();

  if (isSameDay) {
    const hh = String(then.getHours()).padStart(2, "0");
    const mm = String(then.getMinutes()).padStart(2, "0");
    return `hôm nay ${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    then.getFullYear() === yesterday.getFullYear() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getDate() === yesterday.getDate();
  if (isYesterday) {
    const hh = String(then.getHours()).padStart(2, "0");
    const mm = String(then.getMinutes()).padStart(2, "0");
    return `hôm qua ${hh}:${mm}`;
  }

  const dd = String(then.getDate()).padStart(2, "0");
  const mo = String(then.getMonth() + 1).padStart(2, "0");
  const yyyy = then.getFullYear();
  const hh = String(then.getHours()).padStart(2, "0");
  const mm = String(then.getMinutes()).padStart(2, "0");
  return `${dd}/${mo}/${yyyy} ${hh}:${mm}`;
}
