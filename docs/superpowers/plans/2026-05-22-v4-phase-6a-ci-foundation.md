# Phase 6.A — CI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up GitHub Actions CI gate (typecheck + Vitest with coverage + pgTAP against Postgres 15 + production build) so future PRs are verified by automation rather than relying on local `npm run verify:phase`. Establishes the foundation for all subsequent Phase 6 sub-phases (component tests / pgTAP backfill / E2E).

**Architecture:** Pure infrastructure phase. No `src/**` or `database/**` changes. 4-job GitHub Actions workflow with `services: postgres:15` for pgTAP. Existing `scripts/pgtap-run.mjs` gets a backward-compatible `PGTAP_DB_URL` env-var override so it can target the CI Postgres directly instead of `docker compose exec`. New `scripts/ci/apply-schema.mjs` loads `001/002/003.sql` against vanilla PG 15 with a minimal `auth` schema mock. Vitest gains `@vitest/coverage-v8` with per-directory thresholds (only `src/lib/**` enforced at 80%; other dirs excluded until 6.B).

**Tech Stack:** GitHub Actions · Node 22 (matches existing Vitest config) · Postgres 15 (matches Supabase prod) · `postgresql-15-pgtap` apt package · `@vitest/coverage-v8` 2.1.x · Existing Vitest 2.1.9 + `vite-tsconfig-paths`.

**Spec:** `docs/superpowers/specs/2026-05-22-v4-phase-6a-ci-foundation-design.md`
**Branch:** `phase-6a-ci-foundation` (already created off `main` @ tag `v4-phase-5`)
**Tag at end:** `v4-phase-6a` (placed on T5 merge commit)
**Final verify target:** 75 Vitest + 131 pgTAP = 206 green (UNCHANGED — no test additions in 6.A)

---

## File Manifest

### 4 new files
| Path | Lines (est) | Created in |
|------|-------------|------------|
| `scripts/ci/apply-schema.mjs` | ~85 | T2 |
| `.github/workflows/verify.yml` | ~85 | T4 |
| `docs/contributing.md` | ~60 | T4 |
| `.github/` directory (implicit container for workflows) | n/a | T4 |

### 3 modified files
| Path | Change | Touched in |
|------|--------|------------|
| `scripts/pgtap-run.mjs` | Add `PGTAP_DB_URL` env-var override; preserve existing docker-compose-exec default | T1 |
| `vitest.config.mts` | Add `coverage` block with per-directory thresholds | T3 |
| `package.json` | Add `@vitest/coverage-v8` devDep + `test:coverage` script | T3 |

### Off-limits (DO NOT TOUCH)
- `src/**` — no source code changes in 6.A (pure infrastructure phase)
- `database/**` — no schema/functions/RLS/tests changes
- `scripts/db-init.mjs` — local dev script frozen
- `scripts/seed.mjs`, `scripts/smoke-test.mjs` — out of scope
- `tools/verify-mirror.mjs` — out of scope
- All Phase 1-5 feature modules

---

## Conventions reminder (apply to every commit)

1. **Vietnamese diacritics break PowerShell here-strings.** Use this pattern EVERY commit:
   ```powershell
   @'
   <commit body>
   '@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
   git add <files>
   git commit -F .git/COMMIT_MSG_TMP
   Remove-Item .git/COMMIT_MSG_TMP
   ```

2. **Commit message MUST end with:** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

3. **NO modifications to v3 production code, Supabase containers, or `.env` files.**

4. **`.gitignored` files stay gitignored.**

---

## Important context for the engineer

Read these BEFORE T1:

- The current `scripts/pgtap-run.mjs` (138 lines) uses `docker compose exec -T db psql ...` (NOT `docker exec`). The compose service name is `db`. Local dev reads `POSTGRES_PASSWORD` from `supabase/.env`.
- The Vitest config file is `vitest.config.mts` (NOT `.ts`).
- All schema files (`001/002/003.sql`) are stored at repo root under `database/`.
- pgTAP test files live in `database/tests/0xx_*.sql` (currently 000_setup, 010–190 numbered files, 20 files total, 131 assertions).
- `apply-schema.mjs` (new in T2) uses `psql` shell-out (same pattern as `pgtap-run.mjs`) to avoid adding a node-postgres dependency.

---

## Task 1: `scripts/pgtap-run.mjs` — add `PGTAP_DB_URL` env-var override

**Files:**
- Modify: `scripts/pgtap-run.mjs` — backward-compatible env-var override

### - [ ] Step 1: Replace the current file

Open `scripts/pgtap-run.mjs`. Replace the entire file content with:

```js
#!/usr/bin/env node
// scripts/pgtap-run.mjs — Run all database/tests/*.sql files through pgTAP,
// parse TAP output, exit 0 on success, 1 on first failure.
//
// Two modes:
//   1. Local dev (default): docker compose exec into the Supabase `db`
//      service; reads POSTGRES_PASSWORD from supabase/.env.
//   2. CI mode (PGTAP_DB_URL set): direct `psql <url>` against the
//      connection string. No docker, no supabase/.env required.
//
// Usage:
//   node scripts/pgtap-run.mjs              # run all files
//   node scripts/pgtap-run.mjs --setup-only # run 000_setup.sql only
//   node scripts/pgtap-run.mjs --file <path># run a single file
//
// CI mode example:
//   PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/postgres \
//     node scripts/pgtap-run.mjs

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const TESTS_DIR = "database/tests";
const CI_DB_URL = process.env.PGTAP_DB_URL ?? null;

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

// Only read POSTGRES_PASSWORD when running in local-docker mode.
// CI mode never needs the supabase/.env file.
let POSTGRES_PASSWORD = null;
if (!CI_DB_URL) {
  if (!existsSync("supabase/.env")) {
    throw new Error(
      "supabase/.env not found. Either run from project root with the Supabase " +
      "docker stack, or set PGTAP_DB_URL env var to use CI mode."
    );
  }
  POSTGRES_PASSWORD = readEnvValue("supabase/.env", "POSTGRES_PASSWORD");
}

function parseArgs(args) {
  const out = { setupOnly: false, file: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--setup-only") out.setupOnly = true;
    else if (a === "--file") out.file = args[++i];
  }
  return out;
}

function listTestFiles({ setupOnly, file }) {
  if (file) return [file];
  const all = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(TESTS_DIR, f));
  if (setupOnly) return all.filter((f) => f.endsWith("000_setup.sql"));
  return all;
}

function psqlFile(sqlContent) {
  if (CI_DB_URL) {
    // CI mode: direct psql against the connection string. The runner
    // already has psql installed (postgresql-client-15) and the
    // postgres service is reachable on localhost:5432.
    return execFileSync(
      "psql",
      [
        CI_DB_URL,
        "-v", "ON_ERROR_STOP=1",
        "-AtX",
        "-f", "-",
      ],
      { input: sqlContent, encoding: "utf8" }
    );
  }
  // Local-dev mode: docker compose exec into the Supabase `db` service.
  // psql runs inside the container; we pipe SQL via stdin.
  return execFileSync(
    "docker",
    [
      "compose", "exec", "-T",
      "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`,
      "db",
      "psql", "-U", "postgres", "-d", "postgres", "-h", "127.0.0.1",
      "-v", "ON_ERROR_STOP=1",
      "-AtX",
      "-f", "-",
    ],
    { input: sqlContent, encoding: "utf8" }
  );
}

function parseTap(output) {
  const lines = output.split(/\r?\n/);
  let plan = null;
  const passes = [];
  const fails = [];
  for (const line of lines) {
    const planMatch = line.match(/^1\.\.(\d+)/);
    if (planMatch) plan = Number(planMatch[1]);
    const okMatch = line.match(/^ok (\d+)(?:\s+-\s+(.*))?/);
    if (okMatch) passes.push({ n: Number(okMatch[1]), desc: okMatch[2] ?? "" });
    const notOkMatch = line.match(/^not ok (\d+)(?:\s+-\s+(.*))?/);
    if (notOkMatch) fails.push({ n: Number(notOkMatch[1]), desc: notOkMatch[2] ?? "" });
  }
  return { plan, passes, fails };
}

const args = parseArgs(process.argv.slice(2));
const files = listTestFiles(args);

let totalPasses = 0;
let totalFails = 0;
let firstFailFile = null;

for (const file of files) {
  const sql = readFileSync(file, "utf8");
  process.stdout.write(`\n>>> ${file}\n`);
  let output;
  try {
    output = psqlFile(sql);
  } catch (err) {
    console.error(`  ✗ psql crashed: ${err.message}`);
    process.exit(1);
  }
  const { plan, passes, fails } = parseTap(output);
  totalPasses += passes.length;
  totalFails += fails.length;

  // Plan-vs-count mismatch is a TAP-spec failure (e.g. a file declared 1..6
  // but bailed out after 4 ok lines). Treat as a fail so the gate doesn't
  // silently pass partially-run suites.
  const planMismatch =
    plan !== null && fails.length === 0 && passes.length !== plan;

  if (fails.length > 0 || planMismatch) {
    if (!firstFailFile) firstFailFile = file;
    for (const f of fails) {
      console.error(`  ✗ not ok ${f.n} - ${f.desc}`);
    }
    if (planMismatch) {
      console.error(
        `  ✗ plan mismatch: declared 1..${plan} but found ${passes.length} ok lines`
      );
      totalFails += 1;
    }
    console.error(`  ${passes.length}/${plan ?? "?"} passed in this file`);
    break;
  } else if (plan !== null) {
    console.log(`  ${passes.length}/${plan} passed`);
  } else {
    console.log(`  ${passes.length} ok lines (no plan declared)`);
  }
}

console.log(`\n────────────────────────────────────────────────`);
console.log(`Files run: ${files.length}`);
console.log(`Total assertions passed: ${totalPasses}`);
if (totalFails > 0) {
  console.error(`Total assertions failed: ${totalFails}`);
  console.error(`First failure in: ${firstFailFile}`);
  process.exit(1);
}
console.log(`✓ All assertions passed.`);
process.exit(0);
```

Key changes vs original:
- New `CI_DB_URL` constant reads `process.env.PGTAP_DB_URL ?? null` once at module top
- New `existsSync` import (used for graceful check when `supabase/.env` missing in CI mode)
- `POSTGRES_PASSWORD` read is now conditional — skipped in CI mode (where supabase/.env doesn't exist on the runner)
- `psqlFile()` now branches: CI mode → direct `psql <url>`, local mode → existing `docker compose exec` (verbatim)
- Added comment header explaining both modes

### - [ ] Step 2: Smoke-test local-dev mode is unchanged

```powershell
npm run pgtap
```

Expected: **131 assertions passing** (no regression). The full output should match the pre-T1 run line-for-line.

If you see "supabase/.env not found", the `existsSync` guard fired incorrectly — likely the relative path isn't being resolved from project root. Check that the command is being run from project root, then re-verify the guard logic.

### - [ ] Step 3: Smoke-test CI mode preflight

The CI mode requires a vanilla Postgres + pgTAP extension. We can't fully test this until T2's `apply-schema.mjs` exists. For T1 alone, just verify the env-var branch is reached:

```powershell
$env:PGTAP_DB_URL = "postgres://postgres:postgres@localhost:5432/nonexistent_db"
node scripts/pgtap-run.mjs --setup-only
$env:PGTAP_DB_URL = $null
```

Expected: psql fails with a connection or authentication error (NOT a "supabase/.env not found" error). The point is to confirm the CI mode branch is taken — the actual connection failure is fine for this smoke check.

### - [ ] Step 4: TypeScript strict check (no TS changes but cheap sanity)

```powershell
npx tsc --noEmit
```
Expected: zero errors (this file is `.mjs` so TS doesn't typecheck it directly, but full project check should still be clean).

### - [ ] Step 5: Commit

```powershell
@'
feat(phase-6a): T1 — pgtap-run.mjs PGTAP_DB_URL env-var override

scripts/pgtap-run.mjs:
- Add CI_DB_URL constant reading process.env.PGTAP_DB_URL at top.
- psqlFile() now branches:
    * CI mode (PGTAP_DB_URL set) → direct `psql <url>` against the
      connection string. No docker, no supabase/.env required.
    * Local-dev mode (PGTAP_DB_URL unset, default) → existing
      `docker compose exec -T db psql ...` unchanged.
- POSTGRES_PASSWORD read is now conditional — skipped in CI mode
  (where supabase/.env doesn't exist on the runner). Guard with
  existsSync("supabase/.env") for graceful error message.

Backward-compatible: local `npm run pgtap` produces 131 green
identically to pre-T1. CI mode validated end-to-end in T2 once
apply-schema.mjs exists.

verify:phase: 75 Vitest + 131 pgTAP = 206 green (unchanged).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add scripts/pgtap-run.mjs
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 2: `scripts/ci/apply-schema.mjs` — vanilla PG 15 schema loader

**Files:**
- Create: `scripts/ci/apply-schema.mjs` (new — uses `psql` shell-out, same pattern as `pgtap-run.mjs`, no new deps)

### - [ ] Step 1: Create the script

Create `scripts/ci/apply-schema.mjs`:

```js
#!/usr/bin/env node
// scripts/ci/apply-schema.mjs — Apply database/{001,002,003}.sql to a vanilla
// Postgres 15 instance pointed at by PGTAP_DB_URL.
//
// Local dev uses `scripts/db-init.mjs` which targets the Supabase docker
// container (and gets the auth schema for free from Supabase's bootstrap).
// This script is the CI equivalent: targets a bare Postgres + seeds the
// minimal auth schema mock that our pgTAP test fixtures need.
//
// Uses psql shell-out (same pattern as scripts/pgtap-run.mjs) to avoid
// adding a node-postgres dependency.
//
// Usage (in CI workflow):
//   PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/postgres \
//     node scripts/ci/apply-schema.mjs
//
// Idempotent — the schema files use CREATE OR REPLACE / CREATE IF NOT
// EXISTS throughout, so this can be run repeatedly against a fresh DB.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const DB_URL = process.env.PGTAP_DB_URL;
if (!DB_URL) {
  console.error("PGTAP_DB_URL env var required");
  process.exit(1);
}

// Minimal Supabase auth schema mock. pgTAP test fixtures insert into
// auth.users (id, email, encrypted_password, email_confirmed_at,
// instance_id) and rely on auth.uid() / auth.role() in RLS policies.
const AUTH_SCHEMA_MOCK = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  instance_id uuid
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '')::text;
$$;
`;

function psqlExec(sql, label) {
  process.stdout.write(`>>> ${label}... `);
  try {
    execFileSync(
      "psql",
      [DB_URL, "-v", "ON_ERROR_STOP=1", "-AtX", "-f", "-"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
    );
  } catch (err) {
    console.error(`FAIL applying ${label}: ${err.message}`);
    process.exit(1);
  }
  console.log("OK");
}

function applyFile(relativePath, label) {
  const absPath = resolve(REPO_ROOT, relativePath);
  const sql = readFileSync(absPath, "utf8");
  psqlExec(sql, label);
}

psqlExec(AUTH_SCHEMA_MOCK, "auth schema mock");
applyFile("database/001_schema.sql", "001_schema.sql");
applyFile("database/002_functions.sql", "002_functions.sql");
applyFile("database/003_rls.sql", "003_rls.sql");

console.log(">>> apply-schema.mjs DONE");
```

Notes:
- Uses `execFileSync("psql", ...)` — same approach as `pgtap-run.mjs`. No new dependency.
- `stdio: ["pipe", "inherit", "inherit"]` so psql NOTICE/WARNING messages stream through to the CI log (useful for debugging schema-apply failures).
- The `AUTH_SCHEMA_MOCK` heredoc captures exactly the columns/functions the pgTAP fixtures use — verified against every `0xx_*.sql` test file that touches `auth.users` or `auth.uid()`.

### - [ ] Step 2: Local validation (CI-mode end-to-end)

This is the critical T2 validation step. Spin up a vanilla `postgres:15` container, install pgTAP, run apply-schema + pgtap-run via `PGTAP_DB_URL`, and verify 131 assertions pass against the bare CI-mode Postgres.

```powershell
# 1. Start a temporary PG 15 container on port 5433 (avoid colliding with
#    the existing Supabase stack on 5432).
docker run -d --name pg15-ci-test `
  -e POSTGRES_PASSWORD=postgres `
  -p 5433:5432 `
  postgres:15

# 2. Wait for it to be ready
Start-Sleep -Seconds 5
docker exec pg15-ci-test pg_isready -U postgres

# 3. Install pgTAP extension inside the container
docker exec pg15-ci-test bash -c "apt-get update && apt-get install -y postgresql-15-pgtap"

# 4. Create the pgTAP extension in the test database
docker exec -e PGPASSWORD=postgres pg15-ci-test `
  psql -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS pgtap;"

# 5. Apply schema via the new script
$env:PGTAP_DB_URL = "postgres://postgres:postgres@localhost:5433/postgres"
node scripts/ci/apply-schema.mjs

# 6. Run pgTAP suite against the CI-mode Postgres
npm run pgtap

# 7. Cleanup
$env:PGTAP_DB_URL = $null
docker rm -f pg15-ci-test
```

Expected output from step 5:
```
>>> auth schema mock... OK
>>> 001_schema.sql... OK
>>> 002_functions.sql... OK
>>> 003_rls.sql... OK
>>> apply-schema.mjs DONE
```

Expected output from step 6:
```
... per-file 0xx_*.sql lines ...
Files run: 20
Total assertions passed: 131
✓ All assertions passed.
```

**If apply-schema fails on `001_schema.sql`** with a Supabase-only-object error (e.g. `schema "storage" does not exist`, `function vault.create_secret() does not exist`), the auth schema mock is incomplete. Add the missing object stub to `AUTH_SCHEMA_MOCK` (or create a new helper schema mock) and re-run. The pgTAP test fixtures only use `auth.users` + `auth.uid()` + `auth.role()` based on grep, but if 001_schema.sql itself references additional Supabase objects, those need stubbing too. Address inline and re-run until step 6 completes with 131/131.

**If apply-schema fails on `002_functions.sql` or `003_rls.sql`** — read the error, add the missing stub, retry. Document any additions in the commit message.

### - [ ] Step 3: Local-mode regression check (the new script should not affect `npm run pgtap` when PGTAP_DB_URL is unset)

```powershell
# Ensure env var is clean
$env:PGTAP_DB_URL = $null
npm run pgtap
```
Expected: **131 assertions passing** (docker-compose-exec local mode). No regression.

### - [ ] Step 4: Commit

```powershell
@'
feat(phase-6a): T2 — apply-schema.mjs for vanilla PG 15 in CI

scripts/ci/apply-schema.mjs (new):
- Loads database/001_schema.sql + 002_functions.sql + 003_rls.sql
  against a vanilla Postgres 15 instance pointed at by PGTAP_DB_URL.
- Seeds minimal Supabase auth schema mock first: auth.users
  (id uuid pk, email, encrypted_password, email_confirmed_at,
  instance_id) + auth.uid() + auth.role() helpers reading
  request.jwt.claims (same pattern Supabase uses in prod).
- Uses psql shell-out (same as pgtap-run.mjs) — no new node-postgres
  dependency. Inherits stdio so NOTICE/WARNING messages reach the
  CI log.

Validated end-to-end locally against postgres:15 docker container
with PGTAP_DB_URL — apply-schema + pgtap-run yields 131/131 green
identically to the local Supabase docker mode.

verify:phase: 75 Vitest + 131 pgTAP = 206 green (unchanged in local
docker mode; same count in CI mode against vanilla PG 15).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add scripts/ci/apply-schema.mjs
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 3: Vitest coverage — `vitest.config.mts` + `package.json`

**Files:**
- Modify: `vitest.config.mts` — add `coverage` block (currently 23 lines, will be ~50)
- Modify: `package.json` — add `@vitest/coverage-v8` devDep + `test:coverage` script

### - [ ] Step 1: Install `@vitest/coverage-v8`

```powershell
npm install -D @vitest/coverage-v8@^2.1.9
```

This adds the package to `devDependencies` AND writes to `package-lock.json`. Both files end up in the next commit.

Verify the version matches existing Vitest (2.1.9):
```powershell
node -e "const p = require('./package.json'); console.log(p.devDependencies.vitest, p.devDependencies['@vitest/coverage-v8'])"
```
Expected: `^2.1.9 ^2.1.9`

### - [ ] Step 2: Add `test:coverage` script to `package.json`

Open `package.json`. Find the `"scripts"` object. Add ONE new key between `"test:watch"` and `"pgtap"`:

```json
  "scripts": {
    "dev": "next dev -p 3009",
    "build": "next build",
    "start": "next start -p 3009",
    "db:init": "node scripts/db-init.mjs",
    "db:seed": "node scripts/seed.mjs",
    "smoke": "node scripts/smoke-test.mjs",
    "test": "vitest",
    "test:run": "vitest run",
    "test:watch": "vitest watch",
    "test:coverage": "vitest run --coverage",
    "pgtap": "node scripts/pgtap-run.mjs",
    "verify:phase": "npm run test:run && npm run pgtap",
    "verify:mirror": "node tools/verify-mirror.mjs"
  },
```

(Only the `"test:coverage"` line is new — the surrounding scripts are unchanged.)

### - [ ] Step 3: Replace `vitest.config.mts` with the coverage-enabled version

Open `vitest.config.mts`. Replace the entire file with:

```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

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
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    env: { TZ: "Asia/Ho_Chi_Minh" },
    include: ["src/**/__tests__/**/*.test.ts"],
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
        "src/components/ui/**",  // Phase 2 design system (deferred to 6.B)
        "src/features/**",       // UI components (deferred to 6.B)
        "src/hooks/**",          // React hooks (deferred to 6.B)
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
```

Key changes vs original:
- Added `coverage` block under `test`
- `provider: "v8"` (faster, recommended default; needs `@vitest/coverage-v8` from Step 1)
- 4 reporters (`text` for CLI, `json` for tooling, `html` for local browsing, `lcov` for future CI/Codecov hookup)
- `reportsDirectory: "coverage"` — make sure this is in `.gitignore` (Step 4)
- `exclude` patterns hide non-`src/lib/` paths so the report's signal isn't drowned by 0%-noise from untested dirs
- Per-directory threshold object — only `src/lib/**` is enforced

### - [ ] Step 4: Add `coverage/` to `.gitignore`

```powershell
$gitignorePath = ".gitignore"
$content = Get-Content $gitignorePath -Raw
if ($content -notmatch "(?m)^coverage/?$") {
    Add-Content $gitignorePath "`ncoverage/"
    Write-Host "Added coverage/ to .gitignore"
} else {
    Write-Host "coverage/ already in .gitignore"
}
```

(If `.gitignore` doesn't include `coverage/`, this adds it. If it's already there, no-op.)

### - [ ] Step 5: Run coverage locally — verify thresholds pass

```powershell
npm run test:coverage
```

Expected: 75 Vitest tests pass + coverage report generated. The terminal output should end with a coverage table similar to:

```
 % Coverage report from v8
-------------|---------|----------|---------|---------|-------------------
File         | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------|---------|----------|---------|---------|-------------------
All files    |   ~85   |   ~80    |   ~90   |   ~85   |
 lib         |   ~85   |   ~80    |   ~90   |   ~85   |
  cash-math  |   ~95   |   ~90    |  100    |   ~95   |
  datetime   |   ~90   |   ~85    |  100    |   ~90   |
  format     |   ~95   |   ~95    |  100    |   ~95   |
  validation |   ~90   |   ~85    |  100    |   ~90   |
  ...        |   ...   |   ...    |   ...   |   ...   |
-------------|---------|----------|---------|---------|-------------------
```

(Exact numbers will vary — the key is that all 4 tested files in `src/lib/` show high coverage and the aggregate meets the `src/lib/**` thresholds of 80/75/80/80.)

**If thresholds FAIL** (e.g. `branches: 75` not met on aggregated `src/lib/**`), inspect which file is below threshold. Likely candidates: `datetime.ts` (has timezone-fallback branches that aren't exercised by tests). Options:
1. Lower the failing threshold by 5 points (e.g. branches: 70). Document the lower number in the comment block above the threshold object.
2. Add an `istanbul-ignore-next` style escape (V8 uses `/* v8 ignore next */` comments) on truly defensive branches.

Use option 1 first — it's reversible and doesn't pollute source files.

### - [ ] Step 6: Verify `coverage/` is not committed

```powershell
git status
```
Expected: `coverage/` does NOT appear in untracked files (because it's in `.gitignore`).

### - [ ] Step 7: TypeScript check + verify:phase still green

```powershell
npx tsc --noEmit
npm run verify:phase
```
Expected: 0 TS errors, 75 + 131 = 206 green.

### - [ ] Step 8: Commit

Stage `package.json`, `package-lock.json`, `vitest.config.mts`, and `.gitignore` (if modified):

```powershell
@'
feat(phase-6a): T3 — Vitest coverage with @vitest/coverage-v8

package.json:
- devDependencies: add @vitest/coverage-v8@^2.1.9 (matches vitest)
- scripts: add test:coverage = "vitest run --coverage"

vitest.config.mts:
- Add coverage block under test:
    * provider: "v8" (faster, recommended)
    * reporters: text + json + html + lcov
    * reportsDirectory: "coverage"
    * include src/**/*.{ts,tsx}; exclude test files, .d.ts files,
      src/app/ (Next pages), and the not-yet-tested dirs
      src/components/ui, src/features, src/hooks (re-enabled in 6.B)
    * thresholds: src/lib/** at 80 statements/functions/lines,
      75 branches. Other dirs excluded entirely.

.gitignore:
- Add coverage/ (vitest output dir)

Local `npm run test:coverage` produces coverage/index.html and
meets src/lib/** thresholds (current snapshot well above floor).

verify:phase: 75 Vitest + 131 pgTAP = 206 green (unchanged).
test:coverage: adds coverage report; CI will upload as artifact.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add package.json package-lock.json vitest.config.mts .gitignore
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 4: GitHub Actions workflow + contributing doc

**Files:**
- Create: `.github/workflows/verify.yml`
- Create: `docs/contributing.md`

### - [ ] Step 1: Create the workflow

Create `.github/workflows/verify.yml`:

```yaml
name: verify

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: "22"

jobs:
  # ----------------------------------------------------------------
  # Job 1: TypeScript strict check (fast gate)
  # ----------------------------------------------------------------
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit

  # ----------------------------------------------------------------
  # Job 2: Vitest with coverage
  # ----------------------------------------------------------------
  vitest:
    runs-on: ubuntu-latest
    needs: typecheck
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-report
          path: coverage/
          retention-days: 14

  # ----------------------------------------------------------------
  # Job 3: pgTAP against Postgres 15 service container
  # ----------------------------------------------------------------
  pgtap:
    runs-on: ubuntu-latest
    needs: typecheck
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci

      - name: Install pgTAP extension + psql client
        run: |
          sudo apt-get update
          sudo apt-get install -y postgresql-15-pgtap postgresql-client-15

      - name: Create pgTAP extension in CI database
        env:
          PGPASSWORD: postgres
        run: |
          psql -h localhost -U postgres -d postgres -c "CREATE EXTENSION IF NOT EXISTS pgtap;"

      - name: Apply schema + functions + RLS
        env:
          PGTAP_DB_URL: postgres://postgres:postgres@localhost:5432/postgres
        run: node scripts/ci/apply-schema.mjs

      - name: Run pgTAP suite
        env:
          PGTAP_DB_URL: postgres://postgres:postgres@localhost:5432/postgres
        run: npm run pgtap

  # ----------------------------------------------------------------
  # Job 4: Production build (catches Next.js compile + page generation errors)
  # ----------------------------------------------------------------
  build:
    runs-on: ubuntu-latest
    needs: [vitest, pgtap]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npm run build
```

### - [ ] Step 2: Validate the YAML locally

If `gh` CLI is installed:
```powershell
gh workflow view verify.yml --yaml
```
Expected: prints the YAML content (proves it parses). Errors here are early signals.

If `gh` CLI is not installed, use Node YAML parsing instead:
```powershell
node -e "const fs = require('fs'); const yaml = require('yaml'); try { yaml.parse(fs.readFileSync('.github/workflows/verify.yml', 'utf8')); console.log('YAML OK'); } catch(e) { console.error('YAML FAIL:', e.message); process.exit(1); }"
```

If `yaml` module isn't installed (npm dep), skip this step — GitHub will surface YAML errors on first push.

### - [ ] Step 3: Create `docs/contributing.md`

Create `docs/contributing.md`:

```markdown
# Contributing

## Local Development

### Prerequisites

- Node 22+ (matches CI)
- Docker (for local Supabase via `ice-factory-v2`)
- PowerShell on Windows (here-string commit pattern uses `Out-File -Encoding utf8`)

### Verify before pushing

```bash
npm run verify:phase   # tsc + vitest + pgtap (~30s local)
npm run build          # Next.js production build check (~5s)
```

This matches the CI gate. If both pass locally, the GitHub Actions
workflow will pass too.

### Running pgTAP in CI mode locally

CI uses a vanilla `postgres:15` instead of the Supabase docker
container. To replicate the CI path locally:

```bash
# Spin up a temporary PG 15 container on port 5433
docker run -d --name pg15-ci-test -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 postgres:15

# Wait for it to be ready
sleep 5
docker exec pg15-ci-test pg_isready -U postgres

# Install pgTAP inside the container
docker exec pg15-ci-test bash -c "apt-get update && \
  apt-get install -y postgresql-15-pgtap"

# Create the extension
docker exec -e PGPASSWORD=postgres pg15-ci-test \
  psql -U postgres -c "CREATE EXTENSION pgtap;"

# Apply schema + run tests via PGTAP_DB_URL override
export PGTAP_DB_URL=postgres://postgres:postgres@localhost:5433/postgres
node scripts/ci/apply-schema.mjs
npm run pgtap

# Cleanup
unset PGTAP_DB_URL
docker rm -f pg15-ci-test
```

PowerShell equivalent:
```powershell
docker run -d --name pg15-ci-test -e POSTGRES_PASSWORD=postgres `
  -p 5433:5432 postgres:15
Start-Sleep -Seconds 5
docker exec pg15-ci-test bash -c "apt-get update && apt-get install -y postgresql-15-pgtap"
docker exec -e PGPASSWORD=postgres pg15-ci-test psql -U postgres -c "CREATE EXTENSION pgtap;"
$env:PGTAP_DB_URL = "postgres://postgres:postgres@localhost:5433/postgres"
node scripts/ci/apply-schema.mjs
npm run pgtap
$env:PGTAP_DB_URL = $null
docker rm -f pg15-ci-test
```

### Branch protection on `main`

The `main` branch requires:
- Pull request before merging (no direct push)
- `verify` workflow green (all 4 jobs: typecheck, vitest, pgtap, build)

Configured in GitHub Settings → Branches. Bypass possible by temporarily
disabling protection.

### Commit message convention

- Subject prefix: `feat(phase-X.Y): TN — ...` / `fix(phase-X.Y): ...` / `docs(...)` / `merge: ...`
- Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- PowerShell + Vietnamese diacritics: use the `Out-File -Encoding utf8 .git/COMMIT_MSG_TMP` + `git commit -F` pattern (here-strings inline break on Vietnamese).

### Coverage report

`npm run test:coverage` writes to `coverage/` (gitignored). Open
`coverage/index.html` in a browser for the line-level view. Only
`src/lib/**` has enforced thresholds (80% statements/functions/lines,
75% branches). Other directories are excluded from the report; they
re-enable in Phase 6.B with component tests.
```

### - [ ] Step 4: TypeScript check + verify:phase

```powershell
npx tsc --noEmit
npm run verify:phase
```
Expected: 0 TS errors, 75 + 131 = 206 green. (No source code touched in T4 — pure documentation + YAML.)

### - [ ] Step 5: Commit

```powershell
@'
feat(phase-6a): T4 — GitHub Actions workflow + contributing doc

.github/workflows/verify.yml (new):
4-job CI gate, all running on ubuntu-latest Node 22:
  1. typecheck    — npx tsc --noEmit (~30s)
  2. vitest       — npm run test:coverage; uploads coverage/ as
                    14-day-retention artifact
  3. pgtap        — services: postgres:15 (matches Supabase prod) +
                    apt-installed postgresql-15-pgtap + psql; runs
                    apply-schema.mjs then npm run pgtap with
                    PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/postgres
  4. build        — npm run build (Next.js production), needs
                    vitest + pgtap to complete first

Dependency tree: typecheck → (vitest + pgtap parallel) → build.
Wall-clock ~3-5 min cold cache, ~2-3 min warm.

docs/contributing.md (new):
- Prerequisites (Node 22, Docker, PowerShell)
- npm run verify:phase as local pre-push gate
- Step-by-step PG 15 CI-mode replication (bash + PowerShell)
- Branch protection requirements
- Commit message convention (prefix + Co-Authored-By trailer +
  PowerShell + Vietnamese diacritic pattern)
- Coverage report notes

Local verify:phase: 75 Vitest + 131 pgTAP = 206 green (unchanged).

Workflow not yet triggered — that happens in T5 when the remote
is created and the first push lands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add .github/workflows/verify.yml docs/contributing.md
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
```

---

## Task 5: GitHub remote setup + first CI run + branch protection + `v4-phase-6a` tag

This is the **user-driven task** — the engineer (or controller running this plan) walks the user through GitHub UI clicks and CLI commands. Some steps require credentials and only the user can perform them; others can be guided.

**Files:** No file changes in T5 (besides T5's own commit creating the tag — no source files).

### - [ ] Step 1: Decide repo name + create GitHub repo (USER ACTION)

User chooses repo name. Suggested: `chill-coffee-erp` (matches the local directory and package.json `name`).

Two paths:

**Path A — `gh` CLI (faster, if installed):**
```powershell
gh repo create chill-coffee-erp --private --description "Chill Coffee shop ERP v4 — Next.js 15 / Supabase / TypeScript strict rebuild"
```
This creates the repo on GitHub AND adds it as `origin` remote AND prompts to push existing commits.

**Path B — GitHub UI:**
1. Open https://github.com/new
2. Owner: <user account>
3. Repository name: `chill-coffee-erp`
4. Description: `Chill Coffee shop ERP v4 — Next.js 15 / Supabase / TypeScript strict rebuild`
5. Visibility: **Private**
6. **DO NOT** initialize with README / .gitignore / license (we have existing files)
7. Click "Create repository"

### - [ ] Step 2: Add the remote + push `main`

If Path A was used in Step 1, the remote is already configured — verify with:
```powershell
git remote -v
```
Expected: shows `origin` pointing at `git@github.com:<user>/chill-coffee-erp.git` or `https://github.com/<user>/chill-coffee-erp.git`.

If Path B was used, add the remote manually:
```powershell
git remote add origin https://github.com/<user>/chill-coffee-erp.git
git remote -v
```

Now push the current branch (`phase-6a-ci-foundation`):
```powershell
git push -u origin phase-6a-ci-foundation
```

### - [ ] Step 3: Push existing tags

```powershell
git push --tags
git ls-remote --tags origin | findstr "v4-phase"
```
Expected: lists v4-phase-1 through v4-phase-5d + umbrellas (v4-phase-3a-readonly, v4-phase-3b1, v4-phase-3b2a, v4-phase-3b2b-i, v4-phase-3b2b-ii-a, v4-phase-3b2b-ii-b, v4-phase-3c1, v4-phase-3c2, v4-phase-3c3, v4-phase-4a/b/c/d/e, v4-phase-4, v4-phase-5a/b/c/d, v4-phase-5 — roughly 23 tags total).

### - [ ] Step 4: Open the first Pull Request

In GitHub UI:
1. Navigate to https://github.com/<user>/chill-coffee-erp
2. GitHub should auto-suggest "Compare & pull request" for the just-pushed `phase-6a-ci-foundation` branch
3. Title: `Phase 6.A — CI Foundation`
4. Body: short summary referencing the spec + plan paths, list of 5 tasks
5. Click "Create pull request"

This triggers the first CI run.

### - [ ] Step 5: Watch the first CI run

In GitHub UI:
- Navigate to the PR's "Checks" tab OR the repo's "Actions" tab
- Watch the 4 jobs run: typecheck → vitest+pgtap (parallel) → build
- Expected wall-clock: ~5-7 min (first run cold caches)

**If any job fails:**
- Read the failing step's log
- Common first-run issues:
  - `npm ci` fails: package-lock.json drift — run `npm install` locally to regenerate, commit, push
  - pgtap fails on `apply-schema.mjs`: missing Supabase auth-schema object — add to `AUTH_SCHEMA_MOCK` in `scripts/ci/apply-schema.mjs`, commit, push
  - pgtap reports a different count than 131: pgTAP extension version mismatch or test-file ordering issue — examine logs
  - typecheck fails on Node 22: pin a different Node version in `env.NODE_VERSION`
  - build fails: missing env vars expected by Next.js — add `NEXT_PUBLIC_*` placeholders to the workflow's build step env

Each fix is a new commit pushed to the same PR branch, which re-triggers the workflow. Iterate until 4/4 green.

### - [ ] Step 6: Enable branch protection on `main` (USER ACTION)

In GitHub UI:
1. Navigate to repo Settings → Branches
2. Add branch protection rule
3. Branch name pattern: `main`
4. Check:
   - ☑ Require a pull request before merging
   - ☑ Require approvals: 0 (solo dev — can change later)
   - ☑ Require status checks to pass before merging
     - Required status checks: search for and select `typecheck`, `vitest`, `pgtap`, `build` (must have run at least once to appear)
   - ☑ Require branches to be up to date before merging (optional but recommended)
   - ☐ Require signed commits (optional)
   - ☐ Require linear history (optional — affects how merges look)
5. Save changes

### - [ ] Step 7: Merge the PR

Once branch protection is active AND the CI is 4/4 green:
1. In the PR page, click "Squash and merge" OR "Create a merge commit" (the project's prior pattern uses `git merge --no-ff` — choose "Create a merge commit" to match)
2. Confirm the merge

**OR** merge locally via `superpowers:finishing-a-development-branch` skill (matches every prior phase pattern):
```powershell
# Switch to main, pull the latest from origin (in case GitHub-side activity)
git checkout main
git pull origin main

# Merge the feature branch with --no-ff for explicit merge commit
git merge --no-ff phase-6a-ci-foundation -m "merge: Phase 6.A — CI Foundation (v4-phase-6a)"

# Push the merge to origin
git push origin main
```

### - [ ] Step 8: Place + push the `v4-phase-6a` tag on the merge commit

```powershell
git tag -a v4-phase-6a -m "Phase 6.A — CI Foundation"
git push origin v4-phase-6a

git tag -l "v4-phase-6*"
```
Expected: shows `v4-phase-6a` locally. Verify it's on the merge commit:
```powershell
git log --oneline -1 v4-phase-6a
```
Expected: shows the `merge:` commit.

### - [ ] Step 9: Verify final state

```powershell
# Working tree clean
git status

# Tags pushed to remote
git ls-remote --tags origin | findstr "v4-phase-6a"

# CI ran on the merge commit too (post-merge push to main triggers `on: push: branches: [main]`)
# Open GitHub Actions tab and verify the latest run is green
```

Expected:
- `git status`: clean on main
- `git ls-remote --tags`: includes `v4-phase-6a`
- GitHub Actions latest run on `main`: 4/4 green

### - [ ] Step 10: Optional polish — README CI badge

(Skip if eager to close T5 and revisit later.)

Add to top of `README.md`:
```markdown
[![verify](https://github.com/<user>/chill-coffee-erp/actions/workflows/verify.yml/badge.svg)](https://github.com/<user>/chill-coffee-erp/actions/workflows/verify.yml)
```

Commit + push:
```powershell
@'
docs(phase-6a): add CI status badge to README
'@ | Out-File -Encoding utf8 .git/COMMIT_MSG_TMP
git add README.md
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP
git push origin main
```

(This will go through the PR + CI gate now that branch protection is active. Easier: open a new PR via UI → merge → done.)

### - [ ] Step 11: Hand off to `superpowers:finishing-a-development-branch`

T5 is unusual in that the merge has likely already happened in Step 7 (either via GitHub UI or local `git merge --no-ff`). If the controller pattern is being followed strictly, invoke `superpowers:finishing-a-development-branch` after Step 6 (PR open, CI green, branch protection enabled) so the skill handles the merge + tag placement.

If merging via GitHub UI in Step 7, the `finishing-a-development-branch` skill would just confirm the state and place the tag (Step 8 above). Pick whichever workflow feels cleaner.

---

## Verification matrix

After T5 completes:

| Check | Command | Expected |
|-------|---------|----------|
| Local Vitest | `npm test -- --run` | 75 pass (unchanged) |
| Local pgTAP (docker mode) | `npm run pgtap` | 131 pass (unchanged) |
| Local pgTAP (CI mode against vanilla PG 15) | `PGTAP_DB_URL=... npm run pgtap` after apply-schema | 131 pass |
| Local Vitest with coverage | `npm run test:coverage` | 75 pass + `src/lib/**` ≥80% thresholds |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| Build | `npm run build` | success |
| Remote URL | `git remote get-url origin` | GitHub URL |
| Tags pushed | `git ls-remote --tags origin` | v4-phase-1 through v4-phase-5d + umbrellas + v4-phase-6a |
| First CI run | GitHub Actions tab | 4/4 jobs green |
| Branch protection | GitHub Settings → Branches | `main` requires PR + 4 status checks |
| Coverage artifact | GitHub Actions run page | `coverage-report` artifact downloadable |

---

## Self-review

### Spec coverage
| Spec section | Requirement | Plan task |
|---|---|---|
| §3 scope decisions | GitHub private + postgres:15 + keep pgtap-run.mjs + v8 coverage + per-dir thresholds + 4-job CI + branch protection | All locked in T1-T5 |
| §4.1 two tracks | Track 1 (remote) + Track 2 (workflow + scripts + config) | T5 (track 1) + T1-T4 (track 2) |
| §4.2 CI shape | typecheck → vitest+pgtap → build | T4 step 1 workflow YAML |
| §4.3 PG 15 parity | postgres:15 image + postgresql-15-pgtap | T4 step 1 |
| §4.4 backward compat | PGTAP_DB_URL unset = docker compose exec; set = direct psql | T1 step 1 |
| §5.1 verify.yml | Full YAML content provided | T4 step 1 |
| §5.2 apply-schema.mjs | psql shell-out + auth schema mock | T2 step 1 |
| §5.3 pgtap-run.mjs mod | env-var override | T1 step 1 |
| §5.4 vitest coverage block | provider v8 + reporters + exclude + per-dir thresholds | T3 step 3 |
| §5.5 package.json | @vitest/coverage-v8 + test:coverage | T3 steps 1+2 |
| §5.6 contributing.md | 60-line doc | T4 step 3 |
| §6 file manifest | 4 new + 3 modified | Confirmed in plan header |
| §7 task projection | 5 tasks T1-T5 | ✓ |
| §10 success criteria (13 items) | All 13 covered | T1-T5 verify steps |

### Placeholder scan
- No "TBD" / "implement later" / "TODO" / "handle edge cases" / "Similar to Task N" in any task
- T2 step 2 troubleshooting section mentions specific fallbacks ("add to AUTH_SCHEMA_MOCK", "lower threshold by 5 points") — these are deliberate contingency notes for known unknowns, not placeholders
- T5 step 5 mentions "Common first-run issues" — same: contingency for plausible CI iteration, not placeholder

### Type / name consistency
- `PGTAP_DB_URL` env var: defined in T1 step 1 (read from `process.env`), used in T2 step 2 + T4 step 1 + T5. Same string throughout.
- `postgres:15` image: used in T4 step 1 (services), T2 step 2 (local validation), and contributing.md. Same version.
- `postgresql-15-pgtap` apt package: T4 step 1, T2 step 2, contributing.md.
- `@vitest/coverage-v8@^2.1.9`: T3 step 1 (install), T3 step 4 (commit message). Same pin.
- File `vitest.config.mts` (not `.ts`): T3 step 3 and step 8 commit `git add`. Consistent with actual file name verified at plan-writing time.
- File `scripts/ci/apply-schema.mjs`: T2 step 1 (create), T4 step 1 (workflow invocation), contributing.md. Same path.
- `coverage/` directory: T3 step 4 (gitignore), T3 step 5 (output), T4 step 1 workflow upload-artifact, contributing.md.
- Coverage thresholds: `src/lib/**` 80/75/80/80 consistent between spec §5.4, plan T3 step 3, plan T3 step 5.

### Scope check
5 tasks × 5-10 steps each = ~35 total steps. Smaller than 5.D (5 tasks × 10-13 steps = ~50). T5 is unusual (user-driven, many GitHub UI steps) but each step is bite-sized and clearly delineated. All steps fit 2-5 minute target except T5 step 5 (waiting for first CI run) which is bounded by CI duration not human effort.

No issues found.

---

## After this plan

Once T5 closes:
- **Phase 6.B (Component tests):** Vitest browser-mode OR jsdom + Testing Library + 4-6 representative component tests. Re-enables `src/components/ui/**` + `src/hooks/**` coverage. ~5-6 tasks.
- **Phase 6.C (pgTAP backfill):** RPC + RLS pgTAP for non-cash tables. Closes the biggest test-coverage gap. ~6-8 tasks.
- **Phase 6.D (E2E foundation):** Playwright + seeded Docker test profile + auth flow + 2-3 critical-path E2E tests. ~6-8 tasks.

After 6.D merges → umbrella `v4-phase-6` tag closes Phase 6.

Phase 7+ deferred features (food cost, KiotViet management UI, etc.) remain in the parking lot — to be re-prioritized when Phase 6 closes.
