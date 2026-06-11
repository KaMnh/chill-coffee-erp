"use client";

import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";

interface TopBarProps {
  search?: React.ReactNode;
  actions?: React.ReactNode;
  /** Tiêu đề ngữ cảnh của view — hiện thay search ở mobile (<md). */
  title?: React.ReactNode;
  className?: string;
}

export function TopBar({ search, actions, title, className }: TopBarProps) {
  return (
    <div className={cn("flex items-center gap-2 sm:gap-4 px-4 sm:px-6 py-3 sm:py-4", className)}>
      {title != null && (
        <h1 className="md:hidden flex-1 min-w-0 font-display text-lg font-bold text-ink truncate">
          {title}
        </h1>
      )}
      <div className={cn("flex-1", title != null ? "hidden md:block" : "hidden sm:block")}>
        {search ?? <SearchBar />}
      </div>
      <div className="flex items-center gap-2 sm:gap-3 ml-auto shrink-0">{actions}</div>
    </div>
  );
}

export function SearchBar({
  placeholder = "Tìm kiếm…",
  shortcut = "⌘F",
}: { placeholder?: string; shortcut?: string }) {
  return (
    <div className="relative flex items-center max-w-md">
      <Icon name="search" size={20} className="absolute left-4 text-muted" />
      <input
        type="search"
        placeholder={placeholder}
        aria-label="Tìm kiếm"
        className="w-full h-10 pl-11 pr-16 rounded-full bg-surface-muted border border-transparent text-sm placeholder:text-muted focus-visible:outline-none focus-visible:border-border-strong focus-visible:border-2"
      />
      <kbd className="absolute right-3 hidden sm:inline-flex px-1.5 py-0.5 text-xs text-muted bg-surface rounded-xs border border-border">
        {shortcut}
      </kbd>
    </div>
  );
}
