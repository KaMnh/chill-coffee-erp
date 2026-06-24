"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { matchesSearch } from "@/lib/normalize-search";
import { Icon } from "./icons";

export type ComboboxOption = {
  value: string;
  label: string;
  /** Extra terms to match on (codes, alt names). */
  keywords?: string[];
  disabled?: boolean;
};

export interface ComboboxProps {
  value: string | null;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * 1:1 copy of SelectTrigger's classes (src/components/ui/select.tsx) so the
 * Combobox trigger is visually identical to every other dropdown pill. Kept
 * in sync manually — if SelectTrigger's styling changes, update here too.
 */
const TRIGGER_CLASS =
  "inline-flex items-center justify-between gap-2 h-10 px-4 rounded-full border border-border bg-surface text-sm text-ink " +
  "focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong " +
  "disabled:opacity-40 disabled:cursor-not-allowed";

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Chọn…",
  searchPlaceholder = "Tìm…",
  emptyText = "Không tìm thấy",
  disabled,
  className,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // cmdk's "active item" (highlighted row). Controlled so reopening highlights
  // the currently-selected option instead of always defaulting to the first
  // item. cmdk lowercases item values internally, so seed lowercase.
  const [active, setActive] = useState("");

  const selected = options.find((o) => o.value === value) ?? null;
  // cmdk's built-in filter is disabled (shouldFilter={false}); we control
  // visibility with our own diacritic-insensitive matcher over label+keywords.
  const visible = options.filter((o) =>
    matchesSearch([o.label, ...(o.keywords ?? [])].join(" "), query)
  );

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setActive((value ?? "").toLowerCase()); // highlight current selection on open
    } else {
      setQuery("");
    }
  }

  function handleSelect(next: string) {
    onValueChange(next);
    handleOpenChange(false);
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          className={cn(TRIGGER_CLASS, className)}
        >
          <span className={cn("truncate", selected ? "text-ink" : "text-muted")}>
            {selected ? selected.label : placeholder}
          </span>
          <Icon name="chevronDown" size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        {/* Cap the WHOLE popover (header + list) at the available height so it
            never overflows the viewport on mobile. The list flexes to fill the
            space below the fixed search header and scrolls. Esc closes via
            Radix Popover's dismissable layer; cmdk owns ↑/↓/Enter + ARIA. */}
        <Popover.Content
          align="start"
          sideOffset={4}
          className={cn(
            "z-50 flex max-h-[min(360px,var(--radix-popover-content-available-height))] w-[var(--radix-popover-trigger-width)] flex-col overflow-hidden rounded-md border border-border bg-surface shadow-popover",
            "data-[state=open]:animate-in data-[state=closed]:animate-out"
          )}
        >
          <Command
            shouldFilter={false}
            label={searchPlaceholder}
            value={active}
            onValueChange={setActive}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
              <Icon name="search" size={16} className="shrink-0 text-muted" />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                className="h-10 w-full bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none"
              />
            </div>
            <Command.List className="min-h-0 flex-1 overflow-y-auto p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-muted">
                {emptyText}
              </Command.Empty>
              {visible.map((o) => (
                <Command.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  onSelect={() => handleSelect(o.value)}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-3 py-2 text-sm text-ink outline-none",
                    "data-[selected=true]:bg-surface-muted",
                    "data-[disabled=true]:opacity-40 data-[disabled=true]:cursor-not-allowed"
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && (
                    <Icon name="check" size={16} className="ml-auto" />
                  )}
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
