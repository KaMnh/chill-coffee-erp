"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { TextField } from "@/components/ui/text-field";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { formatVND, formatDateTime } from "@/lib/format";
import type { SafeTransaction, SafeTransactionType } from "@/lib/types";

interface SafeHistorySectionProps {
  transactions: SafeTransaction[];
  fromDate: string;
  toDate: string;
  typeFilter: SafeTransactionType | "all";
  isLoading: boolean;
  isFetching: boolean;
  onFromDateChange(value: string): void;
  onToDateChange(value: string): void;
  onTypeFilterChange(value: SafeTransactionType | "all"): void;
  onLoadOlder(): void;
  onResetFilter(): void;
  onSelectTx(id: string): void;
}

const TYPE_LABELS: Record<SafeTransactionType, string> = {
  initial_setup: "Mở sổ",
  deposit_close: "Nạp từ chốt két",
  withdraw_open: "Rút mở két",
  withdraw_other: "Rút khác",
  adjustment: "Điều chỉnh"
};

const TYPE_SEMANTICS: Record<SafeTransactionType, "success" | "danger" | "warning" | "neutral"> = {
  initial_setup: "neutral",
  deposit_close: "success",
  withdraw_open: "warning",
  withdraw_other: "warning",
  adjustment: "neutral"
};

const TYPES: SafeTransactionType[] = ["initial_setup", "deposit_close", "withdraw_open", "withdraw_other", "adjustment"];

/**
 * Transaction history with date-range + type filtering.
 *
 * Pagination is date-range windowing: default last 90 days, "Tải thêm" extends
 * fromDate backward 90 more days. Custom from/to via inputs overrides.
 */
export function SafeHistorySection({
  transactions,
  fromDate,
  toDate,
  typeFilter,
  isLoading,
  isFetching,
  onFromDateChange,
  onToDateChange,
  onTypeFilterChange,
  onLoadOlder,
  onResetFilter,
  onSelectTx
}: SafeHistorySectionProps) {
  const columns: DataTableColumn<SafeTransaction>[] = [
    {
      key: "occurred_at",
      header: "Thời điểm",
      sortable: true,
      render: (row) => <span className="text-xs">{formatDateTime(row.occurred_at)}</span>
    },
    {
      key: "transaction_type",
      header: "Loại",
      render: (row) => (
        <Badge variant="soft" semantic={TYPE_SEMANTICS[row.transaction_type]}>
          {TYPE_LABELS[row.transaction_type]}
        </Badge>
      )
    },
    {
      key: "amount",
      header: "Số tiền",
      sortable: true,
      className: "text-right",
      render: (row) => (
        <span className={row.amount < 0 ? "text-danger" : "text-success"}>
          {row.amount > 0 ? "+" : ""}{formatVND(row.amount)}
        </span>
      )
    },
    {
      key: "balance_after",
      header: "Số dư sau",
      className: "text-right",
      render: (row) => <span>{formatVND(row.balance_after)}</span>
    },
    {
      key: "reason_category",
      header: "Hạng mục",
      render: (row) => row.reason_category ?? "—"
    },
    {
      key: "description",
      header: "Mô tả",
      render: (row) => (
        <span className="text-xs truncate max-w-[16rem] block" title={row.description ?? ""}>
          {row.description ?? "—"}
        </span>
      )
    },
    {
      key: "id",
      header: "",
      render: (row) => (
        <Button size="sm" variant="ghost" onClick={() => onSelectTx(row.id)}>
          Xem
        </Button>
      )
    }
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between">
          <CardTitle>Lịch sử sổ quỹ</CardTitle>
          {isFetching && !isLoading && <span className="text-xs text-muted">Đang tải...</span>}
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[10rem]">
            <TextField
              label="Từ ngày"
              type="date"
              value={fromDate}
              onChange={(e) => onFromDateChange(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <TextField
              label="Đến ngày"
              type="date"
              value={toDate}
              onChange={(e) => onToDateChange(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label className="text-xs font-medium text-ink-2">Loại</label>
            <Select value={typeFilter} onValueChange={(v) => onTypeFilterChange(v as SafeTransactionType | "all")}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả</SelectItem>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" onClick={onResetFilter}>
            Xóa lọc
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : transactions.length === 0 ? (
          <EmptyState
            icon="fileText"
            title="Không có giao dịch nào"
            subtitle="Thử mở rộng khoảng ngày hoặc xóa lọc."
          />
        ) : (
          <>
            <DataTable columns={columns} data={transactions} rowKey={(row) => row.id} />
            <div className="flex justify-center">
              <Button variant="ghost" onClick={onLoadOlder}>
                Tải thêm 90 ngày trước
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
