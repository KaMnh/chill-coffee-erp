"use client";

import { cn } from "@/lib/cn";
import { Icon } from "./icons";

interface PaginationProps {
  total: number;
  current: number; // 1-indexed
  onChange: (page: number) => void;
  className?: string;
}

export function Pagination({ total, current, onChange, className }: PaginationProps) {
  const pages = Array.from({ length: total }, (_, i) => i + 1);
  return (
    <nav className={cn("inline-flex items-center gap-1", className)} aria-label="Pagination">
      <PageButton
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
        aria-label="Trang trước"
      >
        <Icon name="chevronLeft" size={16} />
      </PageButton>
      {pages.map((p) => (
        <PageButton key={p} active={p === current} onClick={() => onChange(p)}>
          {p}
        </PageButton>
      ))}
      <PageButton
        disabled={current === total}
        onClick={() => onChange(current + 1)}
        aria-label="Trang sau"
      >
        <Icon name="chevronRight" size={16} />
      </PageButton>
    </nav>
  );
}

function PageButton({
  active,
  disabled,
  children,
  ...rest
}: {
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "min-w-9 h-9 px-2 inline-flex items-center justify-center rounded-sm text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        active
          ? "bg-ink text-white"
          : "text-ink hover:bg-surface-muted"
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
