/**
 * True when the user has asked the OS/browser to reduce motion.
 *
 * SSR-safe: returns `false` when there is no `window` (server render) or when
 * `matchMedia` is unavailable. Kept free of any GSAP import so it can be unit
 * tested in the pure `lib` layer and imported anywhere without side-effects.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
