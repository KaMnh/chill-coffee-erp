import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest config — Phase 3B.2b.ii.a.
 *
 * - `tsconfigPaths()` plugin resolves the `@/*` → `./src/*` alias declared in
 *   tsconfig.json so test files can import like the rest of the codebase.
 * - `environment: "node"` because all current tests are pure functions (no
 *   DOM). Component tests in Phase 6 will introduce a separate jsdom config.
 * - `env.TZ = "Asia/Ho_Chi_Minh"` pins TZ so `Intl.DateTimeFormat("vi-VN", ...)`
 *   and `Date.prototype.toLocaleDateString` produce deterministic output across
 *   machines. Without this, CI on UTC boxes would diverge from local VN dev.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: { TZ: "Asia/Ho_Chi_Minh" },
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
