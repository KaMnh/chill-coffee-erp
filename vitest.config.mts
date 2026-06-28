import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import react from "@vitejs/plugin-react";

/**
 * Vitest config — Phase 3B.2b.ii.a + Phase 6.A.
 *
 * - `tsconfigPaths()` plugin resolves the `@/*` → `./src/*` alias declared in
 *   tsconfig.json so test files can import like the rest of the codebase.
 * - `environment: "node"` because all current tests are pure functions (no
 *   DOM). Component tests in Phase 6.B will introduce a separate jsdom config.
 * - `env.TZ = "Asia/Ho_Chi_Minh"` pins TZ so `Intl.DateTimeFormat("vi-VN", ...)`
 *   and `Date.prototype.toLocaleDateString` produce deterministic output across
 *   machines. Without this, CI on UTC boxes would diverge from local VN dev.
 * - `coverage` block added in Phase 6.A. Per-directory thresholds only on
 *   `src/lib/**` (the tested layer) — UI + features + hooks are excluded
 *   until 6.B's component tests land. Provider `v8` for speed.
 * - Excluded from the coverage report entirely (deferred to 6.B or never
 *   unit-testable without live services):
 *     src/app/**          – Next.js page entries (build-time coverage)
 *     src/components/**   – UI design system (Phase 6.B component tests)
 *     src/features/**     – React feature components (Phase 6.B)
 *     src/hooks/**        – React hooks (Phase 6.B)
 *     src/lib/data/**     – Supabase data-access layer (live DB required)
 *     src/lib/kiotviet/** – KiotViet API client (live API required)
 *     src/lib/supabase/** – Supabase client initialisation
 *     src/middleware.ts   – Next.js middleware (integration-level only)
 *     src/lib/cn.ts       – UI class-name utility (no unit tests, 6.B)
 *     src/lib/data.ts     – Barrel re-export for data layer
 *     src/lib/types.ts    – TypeScript-only type definitions (no runtime)
 * The threshold gate thus measures only the genuinely-tested pure helpers:
 *   datetime.ts, format.ts, validation.ts (+ cash-math via features/cash).
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "node",
    // Component tests (*.test.tsx) need a DOM — run those under jsdom while the
    // pure-helper suite (*.test.ts) stays on the faster node environment.
    environmentMatchGlobs: [["src/**/__tests__/**/*.test.tsx", "jsdom"]],
    setupFiles: ["./vitest.setup.ts"],
    env: { TZ: "Asia/Ho_Chi_Minh" },
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    // Phase 6.B placeholder authored before the component-test harness existed
    // (marked `@ts-nocheck`, missing its <ToastProvider> wrapper). It was never
    // collected under the old `.test.ts`-only include; keep it parked until its
    // own phase wires up the providers, so broadening to `.tsx` here doesn't
    // surface unrelated red.
    exclude: [
      ...configDefaults.exclude,
      "src/features/settings/__tests__/backup-restore-section.test.tsx",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/__tests__/**",
        "src/**/*.d.ts",
        "src/app/**",            // Next.js page entries — covered by build
        "src/components/**",     // Design system + layout (deferred to 6.B)
        "src/features/**",       // UI components (deferred to 6.B)
        "src/hooks/**",          // React hooks (deferred to 6.B)
        "src/lib/data/**",       // Data-access layer (requires live DB)
        "src/lib/kiotviet/**",   // KiotViet API client (requires live API)
        "src/lib/supabase/**",   // Supabase client init (deferred to 6.B)
        "src/middleware.ts",     // Next.js middleware (integration-only)
        "src/lib/cn.ts",         // UI utility — no unit tests (Phase 6.B)
        "src/lib/data.ts",       // Barrel re-export for data layer
        "src/lib/types.ts",      // Type-only definitions, no runtime code
      ],
      thresholds: {
        // Phase 6.A: only enforce coverage on the pure-helper layer.
        // Component / feature tests come in 6.B (re-enables ui + features +
        // hooks in the coverage report). 6.A keeps the gate honest by
        // measuring only what we actually test today.
        "src/lib/**": {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
