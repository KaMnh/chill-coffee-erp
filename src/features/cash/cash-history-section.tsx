"use client";

import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, formatVND } from "@/lib/format";
import type { CashCount } from "@/lib/types";
import { DENOMINATIONS } from "./denominations";

interface CashHistorySectionProps {
  counts: ReadonlyArray<CashCount>;
  isLoading: boolean;
  isFetching: boolean;
  canManage: boolean;
  onEditReport(reportId: string): void;
  onVoidReport(reportId: string): void;
  onEditCount(count: CashCount): void;
}

function countTypeBadge(count: CashCount) {
  if (count.report_status === "voided") {
    return <Badge variant="soft" semantic="danger">Đã hủy</Badge>;
  }
  if (count.count_type === "shift_close") {
    if (count.report_status === "final") {
      return <Badge variant="soft" semantic="success">Chốt két</Badge>;
    }
    return <Badge variant="soft" semantic="warning">Chốt két (pending)</Badge>;
  }
  return <Badge variant="soft" semantic="neutral">Kiểm két nhanh</Badge>;
}

/**
 * History list of today's cash counts (both spot_audit and shift_close).
 *
 * Row collapsed: meta (badge + time + physical + difference + chevron toggle).
 * Row expanded: denomination grid breakdown + POS snapshot + note + admin action buttons.
 *
 * Admin buttons (owner/manager only):
 *  - "Sửa count" — enabled for spot_audit always, shift_close only if report not final
 *  - "Sửa báo cáo" + "Hủy báo cáo" — enabled when count has report_id with status="final"
 *
 * Pattern matches v3 cash-history-section: toggle ONE row open at a time.
 */
export function CashHistorySection({
  counts,
  isLoading,
  isFetching,
  canManage,
  onEditReport,
  onVoidReport,
  onEditCount,
}: CashHistorySectionProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function toggleExpand(id: string) {
    setExpandedId((current) => (current === id ? null : id));
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Lịch sử trong ngày</p>
            <CardTitle>Kiểm két & chốt két</CardTitle>
          </div>
          {isFetching && !isLoading && (
            <span className="text-xs text-muted">Đang cập nhật...</span>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {isLoading && counts.length === 0 ? (
          <EmptyState icon="loader" title="Đang tải..." subtitle="Đang lấy lịch sử kiểm két." />
        ) : counts.length === 0 ? (
          <EmptyState
            icon="banknote"
            title="Chưa có lượt kiểm két nào hôm nay"
            subtitle='Bấm "Kiểm két nhanh" để lưu spot audit, hoặc "Chốt két & tạo báo cáo" để chốt cuối ca.'
          />
        ) : (
          <div className="space-y-2">
            {counts.map((count) => {
              const isExpanded = expandedId === count.id;
              const isVoided = count.report_status === "voided";
              return (
                <article
                  key={count.id}
                  className={cn(
                    "rounded-md border border-border transition-colors",
                    isVoided && "opacity-60 bg-surface-muted"
                  )}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                    onClick={() => toggleExpand(count.id)}
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {countTypeBadge(count)}
                      <span className="text-sm text-muted">{formatDateTime(count.counted_at)}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <span className="block text-xs text-muted">Đếm thực</span>
                        <strong className="font-display text-sm text-ink">
                          {formatVND(count.total_physical)}
                        </strong>
                      </div>
                      <div className="text-right">
                        <span className="block text-xs text-muted">Chênh lệch</span>
                        <strong
                          className={cn(
                            "font-display text-sm",
                            count.difference === 0 ? "text-success" : "text-danger"
                          )}
                        >
                          {formatVND(count.difference)}
                        </strong>
                      </div>
                      <Icon
                        name="chevronDown"
                        size={16}
                        className={cn("transition-transform text-muted", isExpanded && "rotate-180")}
                      />
                    </div>
                  </button>
                  {isExpanded && (
                    <CashHistoryDetail
                      count={count}
                      canManage={canManage}
                      onEditReport={onEditReport}
                      onVoidReport={onVoidReport}
                      onEditCount={onEditCount}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function CashHistoryDetail({
  count,
  canManage,
  onEditReport,
  onVoidReport,
  onEditCount,
}: {
  count: CashCount;
  canManage: boolean;
  onEditReport(reportId: string): void;
  onVoidReport(reportId: string): void;
  onEditCount(count: CashCount): void;
}) {
  const denominations = count.denominations_json ?? {};
  const hasDenominations = Object.values(denominations).some((value) => Number(value) > 0);
  const canEditReport =
    canManage && Boolean(count.report_id) && count.report_status === "final";
  // Sửa count enabled for spot_audit always; for shift_close only when no final report
  const canEditCount =
    canManage && (count.count_type !== "shift_close" || count.report_status !== "final");

  return (
    <div className="border-t border-border px-3 py-3 space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <section>
          <p className="text-xs uppercase tracking-wide text-muted mb-2">Chi tiết mệnh giá</p>
          {!hasDenominations ? (
            <p className="text-sm text-muted">Không có dữ liệu mệnh giá.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {DENOMINATIONS.map((denom) => {
                const qty = Number(denominations[String(denom)] ?? 0);
                if (qty <= 0) return null;
                return (
                  <li key={denom} className="flex items-center justify-between gap-2">
                    <strong className="text-ink">{formatVND(denom)}</strong>
                    <span className="text-muted">× {formatNumber(qty)}</span>
                    <em className="font-display text-ink not-italic">{formatVND(denom * qty)}</em>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section>
          <p className="text-xs uppercase tracking-wide text-muted mb-2">
            POS & đối soát tại thời điểm đếm
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Tổng POS</dt>
            <dd className="text-right text-ink">{formatVND(count.pos_total ?? 0)}</dd>
            <dt className="text-muted">POS tiền mặt</dt>
            <dd className="text-right text-ink">{formatVND(count.pos_cash_total ?? 0)}</dd>
            <dt className="text-muted">POS chuyển khoản</dt>
            <dd className="text-right text-ink">{formatVND(count.pos_non_cash_total ?? 0)}</dd>
            <dt className="text-muted">Tiền vào ca</dt>
            <dd className="text-right text-ink">{formatVND(count.opening_cash ?? 0)}</dd>
            <dt className="text-muted">Chuyển khoản đã nhận</dt>
            <dd className="text-right text-ink">{formatVND(count.bank_transfer_confirmed ?? 0)}</dd>
            <dt className="text-muted">Tổng đối soát</dt>
            <dd className="text-right text-ink">{formatVND(count.reconciliation_total ?? 0)}</dd>
            <dt className="text-muted">Trạng thái</dt>
            <dd className="text-right text-ink">
              {count.report_id
                ? count.report_status === "final"
                  ? "Đã chốt"
                  : count.report_status === "voided"
                    ? "Đã hủy"
                    : (count.report_status ?? "—")
                : "Chưa chốt"}
            </dd>
          </dl>
        </section>
      </div>
      {count.note && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Ghi chú</p>
          <p className="text-sm text-ink mt-1">{count.note}</p>
        </div>
      )}
      {(canEditReport || canEditCount) && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          {canEditCount && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              leadingIcon={<Icon name="pencil" size={16} />}
              onClick={() => onEditCount(count)}
            >
              Sửa count
            </Button>
          )}
          {canEditReport && count.report_id && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leadingIcon={<Icon name="pencil" size={16} />}
                onClick={() => onEditReport(count.report_id!)}
              >
                Sửa báo cáo
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leadingIcon={<Icon name="trash" size={16} />}
                onClick={() => onVoidReport(count.report_id!)}
                className="text-danger hover:bg-danger-soft"
              >
                Hủy báo cáo
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
