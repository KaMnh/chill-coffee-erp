import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface BentoCardProps extends HTMLAttributes<HTMLDivElement> {
  colSpan?: string;
  rowSpan?: string;
}

export const BentoCard = forwardRef<HTMLDivElement, BentoCardProps>(
  function BentoCard({ colSpan, rowSpan, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn("bg-surface rounded-2xl shadow-raised p-6 overflow-hidden", colSpan, rowSpan, className)}
        {...rest}
      />
    );
  }
);
