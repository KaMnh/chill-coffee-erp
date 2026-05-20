"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export const TooltipProvider = RadixTooltip.Provider;

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  delayDuration?: number;
}

export function Tooltip({ content, children, side = "top", delayDuration = 500 }: TooltipProps) {
  return (
    <RadixTooltip.Root delayDuration={delayDuration}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className={cn(
            "rounded-sm bg-ink text-white text-xs px-2 py-1 shadow-popover z-50",
            "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out"
          )}
        >
          {content}
          <RadixTooltip.Arrow className="fill-ink" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
