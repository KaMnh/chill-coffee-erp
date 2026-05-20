"use client";

import * as RadixSwitch from "@radix-ui/react-switch";
import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

export interface SwitchProps extends React.ComponentPropsWithoutRef<typeof RadixSwitch.Root> {
  label?: React.ReactNode;
}

export const Switch = forwardRef<
  React.ElementRef<typeof RadixSwitch.Root>,
  SwitchProps
>(function Switch({ label, id, className, ...rest }, ref) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const root = (
    <RadixSwitch.Root
      ref={ref}
      id={switchId}
      className={cn(
        "relative inline-flex h-6 w-11 items-center rounded-full bg-border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "data-[state=checked]:bg-ink",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        className
      )}
      {...rest}
    >
      <RadixSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white transition-transform duration-200 data-[state=checked]:translate-x-[1.375rem]" />
    </RadixSwitch.Root>
  );
  if (!label) return root;
  return (
    <div className="inline-flex items-center gap-2">
      {root}
      <label htmlFor={switchId} className="text-sm text-ink select-none cursor-pointer">
        {label}
      </label>
    </div>
  );
});
