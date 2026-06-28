// Vitest global setup for component tests — registers @testing-library/jest-dom
// matchers (e.g. toBeInTheDocument) on `expect`, and unmounts rendered React
// trees after each test. Auto-cleanup only fires when `globals: true`; this
// config keeps globals off, so register cleanup explicitly to stop the DOM
// from accumulating across `it` blocks. Harmless for node-env (*.test.ts) tests.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// jsdom does not implement matchMedia; GSAP/ScrollTrigger touches it on import.
// Stub it so component tests that pull in animated UI don't crash on collect.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

afterEach(() => {
  cleanup();
});
