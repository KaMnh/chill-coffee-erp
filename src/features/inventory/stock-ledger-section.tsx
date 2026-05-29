"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Icon } from "@/components/ui/icons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Reveal } from "@/components/ui/reveal";
import { useSupabase } from "@/hooks/use-supabase";
import { useStockMovementsQuery } from "@/hooks/queries";
import type {
  Ingredient,
  StockMovement,
  StockMovementReason,
} from "@/lib/types";

export type DateRangePreset = "today" | "week" | "month" | "all";

export interface LedgerFilter {
  ingredient_id: string | null;
  reason: StockMovementReason | null;
  dateRange: DateRangePreset;
  limit: number;
}

interface StockLedgerSectionProps {
  filter: LedgerFilter;
  onFilterChange(next: LedgerFilter): void;
  ingredients: Ingredient[];
}

const REASON_OPTIONS: ReadonlyArray<{
  value: StockMovementReason;
  label: string;
}> = [
  { value: "purchase_received", label: "Nhập mua" },
  { value: "sale_theoretical", label: "Bán (lý thuyết)" },
  { value: "manual_adjustment_in", label: "Điều chỉnh tăng" },
  { value: "manual_adjustment_out", label: "Điều chỉnh giảm" },
  { value: "count_correction", label: "Kiểm kê (điều chỉnh)" },
  { value: "waste", label: "Hao hụt" },
];

const REASON_LABELS: Record<StockMovementReason, string> = {
  purchase_received: "Nhập mua",
  sale_theoretical: "Bán (lý thuyết)",
  manual_adjustment_in: "Điều chỉnh tăng",
  manual_adjustment_out: "Điều chỉnh giảm",
  count_correction: "Kiểm kê (điều chỉnh)",
  waste: "Hao hụt",
};

/**
 * Phase 4.D — Stock ledger section with inline filter bar.
 *
 * Filter bar: ingredient + reason + date preset.
 * Filter state owned by parent (StockTab); passed via props.
 *
 * Reason filter applied CLIENT-SIDE (RPC doesn't accept reason param).
 * Ingredient + date filters reach the RPC via the query hook.
 *
 * Pagination: "Xem thêm" button increments filter.limit by 50.
 * When returned count < filter.limit, hide button (no more rows).
 */
export function StockLedgerSection({
  filter,
  onFilterChange,
  ingredients,
}: StockLedgerSectionProps) {
  const supabase = useSupabase();

  const queryFilter = buildQueryFilter(filter);
  const movementsQuery = useStockMovementsQuery(supabase, queryFilter, true);

  const allMovements = movementsQuery.data ?? [];
  const visibleMovements =
    filter.reason === null
      ? allMovements
      : allMovements.filter((m) => m.reason === filter.reason);

  const reachedLimit = allMovements.length >= filter.limit;

  function handleLoadMore() {
    onFilterChange({ ...filter, limit: filter.limit + 50 });
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filter.ingredient_id ?? "__all"}
          onValueChange={(v) =>
            onFilterChange({
              ...filter,
              ingredient_id: v === "__all" ? null : v,
              limit: 50,
            })
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tất cả nguyên liệu</SelectItem>
            {ingredients.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.reason ?? "__all"}
          onValueChange={(v) =>
            onFilterChange({
              ...filter,
              reason: v === "__all" ? null : (v as StockMovementReason),
              limit: 50,
            })
          }
        >
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Tất cả lý do</SelectItem>
            {REASON_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.dateRange}
          onValueChange={(v) =>
            onFilterChange({
              ...filter,
              dateRange: v as DateRangePreset,
              limit: 50,
            })
          }
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hôm nay</SelectItem>
            <SelectItem value="week">Tuần này</SelectItem>
            <SelectItem value="month">Tháng này</SelectItem>
            <SelectItem value="all">Tất cả thời gian</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {movementsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size={32} />
        </div>
      ) : movementsQuery.isError ? (
        <AlertBanner variant="danger">
          Không tải được lịch sử. Vui lòng tải lại trang.
        </AlertBanner>
      ) : visibleMovements.length === 0 ? (
        <EmptyState
          icon="info"
          title="Chưa có giao dịch nào trong khoảng này"
          subtitle="Đổi bộ lọc hoặc ghi kiểm kê / nhập xuất mới."
          dashedBorder
        />
      ) : (
        <>
          <Reveal onScroll className="space-y-2">
            {visibleMovements.map((m) => (
              <LedgerRow key={m.id} movement={m} />
            ))}
          </Reveal>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted">
              Hiển thị {visibleMovements.length} giao dịch
            </p>
            {reachedLimit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleLoadMore}
              >
                Xem thêm
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function buildQueryFilter(filter: LedgerFilter): {
  ingredient_id?: string;
  from?: string;
  to?: string;
  limit?: number;
} {
  const out: {
    ingredient_id?: string;
    from?: string;
    to?: string;
    limit?: number;
  } = {};
  if (filter.ingredient_id) out.ingredient_id = filter.ingredient_id;
  if (filter.dateRange === "today") {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    out.from = today.toISOString();
  } else if (filter.dateRange === "week") {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - dayOfWeek);
    monday.setHours(0, 0, 0, 0);
    out.from = monday.toISOString();
  } else if (filter.dateRange === "month") {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    out.from = start.toISOString();
  }
  out.limit = filter.limit;
  return out;
}

function LedgerRow({ movement }: { movement: StockMovement }) {
  const m = movement;
  const isPositive = m.quantity_delta > 0;

  // Reason color: success (green) for inbound, muted (gray) for outbound system,
  // warning (amber) for adjustment_out, danger (red) for waste, success for count_correction.
  // Fall back to text-muted if specific tokens don't exist; verified text-success/warning/danger exist.
  const deltaColor =
    m.reason === "purchase_received" || m.reason === "manual_adjustment_in"
      ? "text-success"
      : m.reason === "manual_adjustment_out"
        ? "text-warning"
        : m.reason === "sale_theoretical"
          ? "text-muted"
          : m.reason === "waste"
            ? "text-danger"
            : "text-success"; // count_correction (treat as informational)

  const occurred = formatOccurred(m.occurred_at);

  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <Icon
              name="package"
              size={20}
              className="text-muted mt-0.5"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-medium text-ink truncate">
                  {m.ingredient_name}
                </p>
                <p
                  className={`text-sm font-mono tabular-nums ${deltaColor}`}
                >
                  {isPositive ? "+" : ""}
                  {m.quantity_delta}
                </p>
                {m.source_order_id && (
                  <Badge variant="soft" semantic="neutral">
                    Từ đơn KiotViet
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted mt-0.5">
                {REASON_LABELS[m.reason]} · {occurred}
                {m.created_by ? " · bởi: nhân viên" : " · (hệ thống)"}
              </p>
              {m.notes && (
                <p className="text-xs text-muted mt-0.5 truncate">
                  {m.notes}
                </p>
              )}
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
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
