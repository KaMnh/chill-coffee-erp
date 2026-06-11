"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/format";
import type { PreviewRole, Scenario } from "../_mock/data";

/* ===== Preview context — role + kịch bản, set từ PreviewShell ===== */

export interface PreviewState {
  role: PreviewRole;
  scenario: Scenario;
}

export const PreviewContext = createContext<PreviewState>({ role: "staff", scenario: "on" });

export function usePreview(): PreviewState {
  return useContext(PreviewContext);
}

/* ===== Chú thích "đề xuất / chưa có data thật" ===== */

export function SuggestNote({ children = "Đề xuất — chưa có data thật", className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full",
        "border border-dashed border-warning/50 bg-warning-soft/40",
        "text-[10px] font-medium text-warning whitespace-nowrap",
        className
      )}
    >
      <Icon name="sparkles" size={16} className="w-3 h-3" />
      {children}
    </span>
  );
}

/* ===== 3-state wrapper: loading (Skeleton) / empty (EmptyState) / data ===== */

interface ViewStatesProps {
  scenario: Scenario;
  skeleton: ReactNode;
  empty: ReactNode;
  children: ReactNode;
}

export function ViewStates({ scenario, skeleton, empty, children }: ViewStatesProps) {
  if (scenario === "loading") return <>{skeleton}</>;
  if (scenario === "empty") return <>{empty}</>;
  return <>{children}</>;
}

/* ===== Section heading kiểu eyebrow (đồng bộ desktop) ===== */

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("text-xs font-medium uppercase tracking-wide text-muted", className)}>
      {children}
    </div>
  );
}

/* ===== Ô nhập tiền VND lớn cho mobile =====
 * - inputMode numeric → numeric keypad
 * - text-2xl (≥16px) → iOS không auto-zoom
 * - nút xóa nhanh
 * - hiển thị dấu chấm ngăn cách nghìn khi gõ
 */

interface MoneyFieldProps {
  label: string;
  value: number;
  onChange(next: number): void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

export function MoneyField({ label, value, onChange, placeholder = "0", autoFocus, className }: MoneyFieldProps) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-ink-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          value={value === 0 ? "" : formatNumber(value)}
          placeholder={placeholder}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, "");
            onChange(digits ? Number(digits) : 0);
          }}
          className={cn(
            "w-full h-14 pl-4 pr-20 rounded-md bg-surface border border-border",
            "font-display text-2xl font-bold text-ink tabular-nums placeholder:text-muted/50",
            "focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong"
          )}
        />
        <span className="absolute right-12 top-1/2 -translate-y-1/2 text-sm text-muted">₫</span>
        {value > 0 && (
          <button
            type="button"
            onClick={() => onChange(0)}
            aria-label={`Xóa ${label}`}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center text-muted hover:bg-surface-muted"
          >
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ===== Chip chọn nhanh (hạng mục, preset…) ===== */

interface ChipProps {
  active?: boolean;
  onClick?(): void;
  children: ReactNode;
  className?: string;
}

export function Chip({ active, onClick, children, className }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-11 px-4 rounded-full border text-sm font-medium transition-colors whitespace-nowrap",
        active
          ? "bg-ink text-white border-ink"
          : "bg-surface text-ink border-border hover:bg-surface-muted",
        className
      )}
    >
      {children}
    </button>
  );
}
