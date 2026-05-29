"use client";

import { useRef, type ReactNode } from "react";
import {
  gsap,
  useGSAP,
  ScrollTrigger,
  DUR,
  STAGGER,
  prefersReducedMotion,
} from "@/lib/gsap";

interface RevealProps {
  children: ReactNode;
  className?: string;
  /** Stagger the wrapper's direct children instead of the wrapper itself. */
  stagger?: boolean;
  /** Reveal direct children as they scroll into view (for long lists). */
  onScroll?: boolean;
  /** Override the entrance duration (seconds). Defaults to DUR.base. */
  duration?: number;
}

/**
 * Entrance-animation wrapper (fade + rise) built on `useGSAP` for automatic
 * cleanup. Three modes:
 *   - default:   animate the wrapper itself on mount.
 *   - stagger:   animate the wrapper's direct children, offset in sequence.
 *   - onScroll:  reveal direct children via ScrollTrigger.batch as they enter
 *                the viewport (once) — efficient for long lists.
 * Reduced motion: nothing is hidden or animated; children render normally.
 */
export function Reveal({ children, className, stagger, onScroll, duration }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const el = ref.current;
      if (!el) return;

      if (onScroll) {
        const items = Array.from(el.children);
        gsap.set(items, { autoAlpha: 0, y: 16 });
        ScrollTrigger.batch(items, {
          start: "top 85%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, { autoAlpha: 1, y: 0, stagger: STAGGER, overwrite: true }),
        });
        return;
      }

      gsap.from(stagger ? Array.from(el.children) : el, {
        autoAlpha: 0,
        y: 12,
        duration: duration ?? DUR.base,
        stagger: stagger ? STAGGER : 0,
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
