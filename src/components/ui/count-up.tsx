"use client";

import { useRef } from "react";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import { cn } from "@/lib/cn";

interface CountUpProps {
  /** Target number to count up to. */
  value: number;
  /** Formats the (rounded) number for display — e.g. `formatVND`. */
  format: (n: number) => string;
  className?: string;
}

/**
 * Animated number. The span's text is owned by GSAP (not React children) so a
 * parent re-render can't fight the running tween. Counts 0 → `value` on mount
 * and re-counts when `value` changes. Respects reduced motion (shows the final
 * value immediately). The layout-effect inside `useGSAP` sets the start value
 * before paint, so the final value never flashes.
 */
export function CountUp({ value, format, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (prefersReducedMotion()) {
        el.textContent = format(value);
        return;
      }
      const counter = { n: 0 };
      el.textContent = format(0);
      gsap.to(counter, {
        n: value,
        duration: DUR.slow,
        ease: "power2.out",
        onUpdate: () => {
          el.textContent = format(Math.round(counter.n));
        },
      });
    },
    { dependencies: [value], scope: ref, revertOnUpdate: true },
  );

  return <span ref={ref} className={cn("tabular-nums", className)} />;
}
