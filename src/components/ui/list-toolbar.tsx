"use client";

import type { ReactNode } from "react";
import { Icon } from "./icons";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./select";
import { cn } from "@/lib/cn";

export interface SortOption {
  value: string;
  label: string;
}

export interface ListToolbarProps {
  /** Current search value (controlled). */
  search: string;
  onSearchChange(value: string): void;
  searchPlaceholder: string;
  /** Optional result count to display (e.g. "12 nguyên liệu"). */
  resultCount?: number;
  /** Label shown after the count. Default: "kết quả". */
  resultLabel?: string;
  /** Sort options + handlers. If omitted, no sort selector renders. */
  sortOptions?: SortOption[];
  sortValue?: string;
  onSortChange?(value: string): void;
  /** Extra slot for filter chips, checkboxes, etc. Rendered between search and sort. */
  children?: ReactNode;
  className?: string;
}

/**
 * Unified toolbar above a list: search input (left), filter slot (center),
 * sort selector + result count (right). Designed for both DataTable and
 * card-based lists.
 *
 * Search input is uncontrolled-style (parent owns value via useListPreferences
 * which debounces persistence — toolbar fires onSearchChange on every keystroke
 * with no internal buffering).
 *
 * Component tests deferred to Phase 6.B (see vitest.config.mts). Smoke-tested
 * via list integrations in feat/list-search-sort PR.
 */
export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  resultCount,
  resultLabel = "kết quả",
  sortOptions,
  sortValue,
  onSortChange,
  children,
  className,
}: ListToolbarProps) {
  const hasSort =
    sortOptions !== undefined &&
    sortOptions.length > 0 &&
    sortValue !== undefined &&
    onSortChange !== undefined;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <div className="flex-1 min-w-[12rem] relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
          <Icon name="search" size={16} />
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          maxLength={100}
          className="h-10 w-full pl-9 pr-3 rounded-sm bg-surface border border-border text-sm text-ink placeholder:text-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong transition-colors"
        />
      </div>

      {children}

      {hasSort && (
        <Select value={sortValue} onValueChange={onSortChange}>
          <SelectTrigger className="h-10 min-w-[10rem]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {resultCount !== undefined && (
        <span className="text-xs text-muted whitespace-nowrap">
          {resultCount} {resultLabel}
        </span>
      )}
    </div>
  );
}
