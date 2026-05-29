/**
 * Central GSAP setup. Import from here (not directly from "gsap") so the
 * one-time plugin registration below always runs first.
 *
 * Registration + defaults run at module load, including during SSR. That is
 * safe: GSAP only does browser work when a tween/ScrollTrigger actually runs,
 * and every animation in this app lives inside `useGSAP` (client-only).
 */
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

// Subtle, professional defaults for a daily-use operations tool.
gsap.defaults({ duration: 0.4, ease: "power2.out" });

/** Shared timing tokens (seconds) so motion stays consistent across surfaces. */
export const DUR = { fast: 0.2, base: 0.4, slow: 0.8 } as const;

/** Default offset (seconds) between staggered children. */
export const STAGGER = 0.06;

export { gsap, ScrollTrigger, useGSAP };
export { prefersReducedMotion } from "./reduced-motion";
