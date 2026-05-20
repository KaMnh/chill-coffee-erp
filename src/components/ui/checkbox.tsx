"use client";

import * as RadixCheckbox from "@radix-ui/react-checkbox";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface CheckboxProps extends React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root> {
  label?: React.ReactNode;
}

export const Checkbox = forwardRef<
  React.ElementRef<typeof RadixCheckbox.Root>,
  CheckboxProps
>(function Checkbox({ label, id, className, ...rest }, ref) {
  const autoId = useId();
  const checkboxId = id ?? autoId;
  return (
    <div className="inline-flex items-center gap-2">
      <RadixCheckbox.Root
        ref={ref}
        id={checkboxId}
        className={cn(
          "w-5 h-5 rounded-xs border border-border bg-surface flex items-center justify-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
          "data-[state=checked]:bg-ink data-[state=checked]:border-ink",
          "disabled:opacity-40 disabled:cursor-not-allowed",
          className
        )}
        {...rest}
      >
        <RadixCheckbox.Indicator>
          <Icon name="check" size={16} className="text-white" />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label && (
        <label htmlFor={checkboxId} className="text-sm text-ink select-none cursor-pointer">
          {label}
        </label>
      )}
    </div>
  );
});
