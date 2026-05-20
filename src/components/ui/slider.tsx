"use client";

import * as RadixSlider from "@radix-ui/react-slider";
import { forwardRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface SliderProps extends React.ComponentPropsWithoutRef<typeof RadixSlider.Root> {
  formatValue?: (value: number) => string;
}

export const Slider = forwardRef<
  React.ElementRef<typeof RadixSlider.Root>,
  SliderProps
>(function Slider({ formatValue, className, value, defaultValue, onValueChange, ...rest }, ref) {
  const [internal, setInternal] = useState<number[]>(
    (value as number[] | undefined) ?? (defaultValue as number[] | undefined) ?? [0]
  );
  const current = (value as number[] | undefined) ?? internal;
  return (
    <RadixSlider.Root
      ref={ref}
      className={cn("relative flex items-center w-full h-6 select-none touch-none", className)}
      value={current}
      onValueChange={(v) => {
        setInternal(v);
        onValueChange?.(v);
      }}
      {...rest}
    >
      <RadixSlider.Track className="relative flex-1 h-0.5 rounded-full bg-border">
        <RadixSlider.Range className="absolute h-full rounded-full bg-ink" />
      </RadixSlider.Track>
      {current.map((_, i) => (
        <RadixSlider.Thumb
          key={i}
          className={cn(
            "block h-[18px] w-[18px] rounded-full bg-white border-2 border-ink shadow-hover transition-shadow",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
            "hover:shadow-raised"
          )}
        >
          <span className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-sm bg-ink text-white text-xs px-2 py-1 whitespace-nowrap opacity-0 group-data-[dragging=true]:opacity-100">
            {formatValue ? formatValue(current[i]) : current[i]}
          </span>
        </RadixSlider.Thumb>
      ))}
    </RadixSlider.Root>
  );
});
