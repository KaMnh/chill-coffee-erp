"use client";

import { Fragment, useMemo, useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { formatVND } from "@/lib/format";
import type { CashFlowExpenseCategory } from "@/lib/types";

interface ExpenseBreakdownTableProps {
  /** Full breakdown from RPC (all categories with nested expenses). */
  rows: CashFlowExpenseCategory[];
  /** If set, filter expenses to this single date (YYYY-MM-DD). */
  selectedDate: string | null;
  /** Called when the "Tất cả" pill is clicked to clear the date filter. */
  onClearDate(): void;
}

function formatDayLabel(iso: string): string {
  // "2026-05-28" → "28/05/2026"
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Cashflow expense breakdown with master-detail accordion:
 *   - rows: one row per category (name, amount, % of total)
 *   - selectedDate=null: shows all categories aggregated over the whole period
 *   - selectedDate!=null: client-side filters each category's expenses to that
 *     date, recomputes category-local amount + pct based on the day's total
 *   - row click toggles inline expand showing the individual expenses
 */
export function ExpenseBreakdownTable({
  rows,
  selectedDate,
  onClearDate,
}: ExpenseBreakdownTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggleExpanded(key: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const filtered = useMemo(() => {
    if (!selectedDate) {
      return rows;
    }
    return rows
      .map((row) => ({
        ...row,
        expenses: row.expenses.filter((e) => e.business_date === selectedDate),
      }))
      .filter((row) => row.expenses.length > 0)
      .map((row) => ({
        ...row,
        amount: row.expenses.reduce((sum, e) => sum + e.amount, 0),
      }));
  }, [rows, selectedDate]);

  const total = useMemo(
    () => filtered.reduce((sum, r) => sum + r.amount, 0),
    [filtered],
  );

  // Stable row key — category_id can be null for "(chưa phân loại)"
  function rowKey(row: CashFlowExpenseCategory): string {
    return row.category_id ?? `__null__::${row.category_name}`;
  }

  return (
    <Reveal onScroll>
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>
            Hạng mục chi
            {selectedDate && (
              <span className="ml-2 font-normal text-muted">
                · ngày {formatDayLabel(selectedDate)}
              </span>
            )}
          </CardTitle>
          {selectedDate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onClearDate}
              trailingIcon={<Icon name="x" size={16} />}
            >
              Tất cả
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody>
        {filtered.length === 0 ? (
          <EmptyState
            icon="wallet"
            title={
              selectedDate
                ? `Ngày ${formatDayLabel(selectedDate)} không có khoản chi`
                : "Chưa có chi phí trong kỳ"
            }
            subtitle={
              selectedDate
                ? "Chọn ngày khác hoặc bấm Tất cả để xem cả kỳ."
                : "Khi có expense thì hạng mục sẽ hiện ở đây."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-2 text-xs font-medium uppercase tracking-wider text-muted w-8" />
                  <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Hạng mục
                  </th>
                  <th className="text-right py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                    Số tiền
                  </th>
                  <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted w-16">
                    %
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const key = rowKey(row);
                  const isOpen = expanded.has(key);
                  const pct = total === 0 ? 0 : row.amount / total;
                  return (
                    <Fragment key={key}>
                      <tr
                        className="border-b border-border last:border-0 cursor-pointer hover:bg-surface-muted"
                        onClick={() => toggleExpanded(key)}
                      >
                        <td className="py-3 pr-2 text-muted">
                          <Icon
                            name="chevronDown"
                            size={16}
                            className={cn(
                              "transition-transform",
                              isOpen ? "" : "-rotate-90",
                            )}
                          />
                        </td>
                        <td className="py-3 px-2 text-ink">
                          {row.category_name}
                        </td>
                        <td className="py-3 px-2 text-right tabular-nums text-ink">
                          {formatVND(row.amount)}
                        </td>
                        <td className="py-3 pl-2 text-right tabular-nums text-muted">
                          {(pct * 100).toFixed(0)}%
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-surface-muted/40">
                          <td colSpan={4} className="px-4 py-3">
                            <ul className="space-y-1.5">
                              {row.expenses.map((e) => (
                                <li
                                  key={e.id}
                                  className="flex items-start justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0 flex-1">
                                    <span className="text-muted mr-2">
                                      {formatDayLabel(e.business_date)}
                                    </span>
                                    <span className="text-ink">
                                      {e.description}
                                    </span>
                                    {e.note && (
                                      <span className="text-muted ml-2">
                                        · {e.note}
                                      </span>
                                    )}
                                  </div>
                                  <strong className="tabular-nums text-ink shrink-0">
                                    {formatVND(e.amount)}
                                  </strong>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
    </Reveal>
  );
}
