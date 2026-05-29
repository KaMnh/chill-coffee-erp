import { describe, it, expect, afterEach } from "vitest";
import { prefersReducedMotion } from "../reduced-motion";

/**
 * prefersReducedMotion() — pure DOM feature-detection helper.
 *
 * Runs in Vitest's `node` environment (no `window`/`matchMedia` by default),
 * so the SSR-guard branch is exercised naturally and the matching branches are
 * driven by stubbing `globalThis.window`. Kept free of any GSAP import so this
 * test stays in the pure-`lib` layer with no animation side-effects.
 */
describe("prefersReducedMotion", () => {
  afterEach(() => {
    // Remove any stubbed window so the next test starts from SSR (no window).
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns false when window is undefined (SSR / Node)", () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns true when the reduce media query matches", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: (query: string) => ({ matches: query.includes("reduce") }),
    };
    expect(prefersReducedMotion()).toBe(true);
  });

  it("returns false when the reduce media query does not match", () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: false }),
    };
    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns false when matchMedia is unavailable on window", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(prefersReducedMotion()).toBe(false);
  });
});
