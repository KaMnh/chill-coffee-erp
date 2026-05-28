"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface DataTableColumn<T> {
  key: keyof T & string;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

export interface DataTableSortState {
  key: string;
  direction: "asc" | "desc";
}

interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyMessage?: string;
  className?: string;
  /**
   * Optional controlled sort state. When `sortKey` is provided (even as null),
   * the table does NOT sort internally — the parent owns sorted data and
   * handles sort changes via {@link onSortChange}. When omitted, internal
   * state is used (backward compatible).
   */
  sortKey?: string | null;
  sortDirection?: "asc" | "desc";
  onSortChange?(next: DataTableSortState): void;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage = "Không có dữ liệu",
  className,
  sortKey: controlledSortKey,
  sortDirection: controlledSortDirection,
  onSortChange,
}: DataTableProps<T>) {
  const [internalSortKey, setInternalSortKey] = useState<string | null>(null);
  const [internalSortDir, setInternalSortDir] = useState<"asc" | "desc">("asc");

  const isControlled = controlledSortKey !== undefined;
  const sortKey = isControlled ? controlledSortKey : internalSortKey;
  const sortDir = isControlled
    ? (controlledSortDirection ?? "asc")
    : internalSortDir;

  // Internal sort only applies when uncontrolled — parent passes pre-sorted
  // data when controlled.
  const sorted =
    !isControlled && sortKey
      ? [...data].sort((a, b) => {
          const av = (a as Record<string, unknown>)[sortKey];
          const bv = (b as Record<string, unknown>)[sortKey];
          if (av === bv) return 0;
          const cmp = (av as string | number) < (bv as string | number) ? -1 : 1;
          return sortDir === "asc" ? cmp : -cmp;
        })
      : data;

  function toggleSort(key: string) {
    if (isControlled) {
      const nextDir: "asc" | "desc" =
        sortKey === key && sortDir === "asc" ? "desc" : "asc";
      onSortChange?.({ key, direction: nextDir });
      return;
    }
    if (internalSortKey === key) {
      setInternalSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setInternalSortKey(key);
      setInternalSortDir("asc");
    }
  }

  return (
    <div className={cn("bg-surface rounded-lg overflow-hidden", className)}>
      <table className="w-full text-sm">
        <thead className="bg-surface-muted">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "text-left px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted",
                  col.className,
                )}
              >
                {col.sortable ? (
                  <button
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-ink transition-colors"
                  >
                    {col.header}
                    {sortKey === col.key && (
                      <Icon
                        name="chevronDown"
                        size={16}
                        className={cn(sortDir === "asc" && "rotate-180")}
                      />
                    )}
                  </button>
                ) : (
                  col.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center py-8 text-muted text-sm"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-t border-border tabular-nums"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn("px-4 py-3 text-ink", col.className)}
                  >
                    {col.render
                      ? col.render(row)
                      : String(
                          (row as Record<string, unknown>)[col.key] ?? "",
                        )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
