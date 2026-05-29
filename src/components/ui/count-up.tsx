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
 * parent re-render can't fight the running tween. Counts up to `value`: from 0
 * on mount, and from the previously-shown value on change (so a data refetch
 * doesn't snap back to 0). Respects reduced motion (shows the final value
 * immediately). The layout-effect inside `useGSAP` sets the start value before
 * paint, so the final value never flashes.
 */
export function CountUp({ value, format, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  // Last value we animated to — updates tween from here (not 0) on data change.
  const prev = useRef(0);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const from = prev.current;
      prev.current = value;
      if (prefersReducedMotion()) {
        el.textContent = format(value);
        return;
      }
      const counter = { n: from };
      el.textContent = format(Math.round(from));
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
