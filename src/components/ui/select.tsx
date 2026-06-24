"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export const Select = RadixSelect.Root;
export const SelectValue = RadixSelect.Value;

export interface SelectTriggerProps extends React.ComponentPropsWithoutRef<typeof RadixSelect.Trigger> {}

export const SelectTrigger = forwardRef<
  React.ElementRef<typeof RadixSelect.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ className, children, ...rest }, ref) {
  return (
    <RadixSelect.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-between gap-2 h-10 px-4 rounded-full border border-border bg-surface text-sm text-ink",
        "focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong",
        "data-[placeholder]:text-muted",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
      {...rest}
    >
      {children}
      <RadixSelect.Icon>
        <Icon name="chevronDown" size={16} />
      </RadixSelect.Icon>
    </RadixSelect.Trigger>
  );
});

export interface SelectContentProps extends React.ComponentPropsWithoutRef<typeof RadixSelect.Content> {}

export const SelectContent = forwardRef<
  React.ElementRef<typeof RadixSelect.Content>,
  SelectContentProps
>(function SelectContent({ className, children, position = "popper", ...rest }, ref) {
  return (
    <RadixSelect.Portal>
      <RadixSelect.Content
        ref={ref}
        position={position}
        sideOffset={4}
        className={cn(
          "min-w-[8rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-surface shadow-popover z-50",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          className
        )}
        {...rest}
      >
        {/* Radix sets `overflow:hidden auto` inline on the viewport; we only
            add the height cap so long lists actually scroll. position="popper"
            (the default) exposes --radix-select-content-available-height. The
            outer Content keeps `overflow-hidden`, so rounded-md corners stay
            clean. A visible scrollbar is restored globally in globals.css
            (Radix hides it via an injected stylesheet). */}
        <RadixSelect.Viewport className="p-1 max-h-[min(320px,var(--radix-select-content-available-height))]">
          {children}
        </RadixSelect.Viewport>
      </RadixSelect.Content>
    </RadixSelect.Portal>
  );
});

export const SelectItem = forwardRef<
  React.ElementRef<typeof RadixSelect.Item>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Item>
>(function SelectItem({ className, children, ...rest }, ref) {
  return (
    <RadixSelect.Item
      ref={ref}
      className={cn(
        "relative flex items-center gap-2 rounded-sm px-3 py-2 text-sm text-ink cursor-pointer outline-none select-none",
        "data-[highlighted]:bg-surface-muted data-[state=checked]:font-medium",
        "data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed",
        className
      )}
      {...rest}
    >
      <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
      <RadixSelect.ItemIndicator className="ml-auto">
        <Icon name="check" size={16} />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
});
