"use client";

import * as RadixRadio from "@radix-ui/react-radio-group";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

export const RadioGroup = forwardRef<
  React.ElementRef<typeof RadixRadio.Root>,
  React.ComponentPropsWithoutRef<typeof RadixRadio.Root>
>(function RadioGroup({ className, ...rest }, ref) {
  return (
    <RadixRadio.Root ref={ref} className={cn("flex flex-col gap-3", className)} {...rest} />
  );
});

export interface RadioProps extends React.ComponentPropsWithoutRef<typeof RadixRadio.Item> {
  label?: React.ReactNode;
}

export const Radio = forwardRef<React.ElementRef<typeof RadixRadio.Item>, RadioProps>(
  function Radio({ label, id, className, ...rest }, ref) {
    const autoId = useId();
    const radioId = id ?? autoId;
    return (
      <div className="inline-flex items-center gap-2">
        <RadixRadio.Item
          ref={ref}
          id={radioId}
          className={cn(
            "w-5 h-5 rounded-full border border-border bg-surface flex items-center justify-center transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
            "data-[state=checked]:border-ink data-[state=checked]:border-2",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            className
          )}
          {...rest}
        >
          <RadixRadio.Indicator className="w-2.5 h-2.5 rounded-full bg-ink" />
        </RadixRadio.Item>
        {label && (
          <label htmlFor={radioId} className="text-sm text-ink select-none cursor-pointer">
            {label}
          </label>
        )}
      </div>
    );
  }
);
