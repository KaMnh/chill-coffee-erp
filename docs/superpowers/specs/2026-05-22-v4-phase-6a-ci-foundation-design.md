# Phase 6.A — CI Foundation Design

**Parent:** First sub-phase of Phase 6 (Hardening). No parent spec — this is the first sub-phase of a new lane.
**Scope:** Stand up git remote (GitHub private) + GitHub Actions workflow running the full verify gate (typecheck + vitest + pgTAP against Postgres 15 + production build) + Vitest coverage with per-directory thresholds. Foundational layer for all subsequent Phase 6 work.
**Branch:** `phase-6a-ci-foundation` (off `main` @ tag `v4-phase-5`)
**Tag at end:** `v4-phase-6a`

---

## 0. TL;DR

- 4 new files + 3 modified.
- New GitHub Actions workflow at `.github/workflows/verify.yml` with 4 jobs: typecheck → (vitest ∥ pgTAP) → build.
- pgTAP CI strategy: `services: postgres:15` (matches Supabase prod version) + apt-installed pgTAP extension + `apply-schema.mjs` to load `001/002/003.sql` against vanilla PG.
- Vitest: `@vitest/coverage-v8` with per-directory thresholds — `src/lib/**` enforces 80%, all other dirs excluded (re-enabled in 6.B with component tests).
- `scripts/pgtap-run.mjs` gets a backward-compatible `PGTAP_DB_URL` env-var override (CI path) — local docker-exec behavior unchanged.
- No source code (`src/**`) or schema (`database/**`) changes. Pure infrastructure phase.
- After 6.A merges: GitHub repo live + first CI run green + branch protection on `main`. Subsequent Phase 6 sub-phases (B/C/D) build on this foundation.

---

## 1. Goal

Establish a real CI gate so that all future code changes are verified by automation rather than relying on local-only `npm run verify:phase`. Every prior Phase 3–5 spec explicitly deferred infrastructure items "to Phase 6 (with CI)" — this sub-phase pays off that accrued infrastructure debt.

After 6.A:

- All Phase 3–5 deferrals tagged "Phase 6" are unblocked (coverage tooling, pg_prove migration, perf regression checks, CI artifacts, branch protection).
- Future PRs catch typecheck / test / build failures before merge instead of after.
- The code stays mergeable to `main` only via PR + verify-workflow green — a structural guardrail.
- Tag history syncs to GitHub for visibility (v4-phase-1 through v4-phase-5d + umbrellas).

---

## 2. Non-goals (specific to 6.A)

- **No source code (`src/**`) changes** — pure infrastructure. Any code touch is out of scope.
- **No schema (`database/**`) changes** — RPC + pgTAP test files frozen for 6.A. Coverage backfill is 6.C.
- **No component tests** — Vitest + Testing Library setup for UI components is 6.B.
- **No E2E tests** — Playwright setup is 6.D.
- **No Supabase test project** — CI uses ephemeral vanilla Postgres + auth-schema mock. A dedicated Supabase test project (with full auth/storage/realtime) is Phase 6.+ if needed.
- **No `pg_prove` migration** — the existing `scripts/pgtap-run.mjs` (psql + custom TAP parser) runs in CI just fine. `pg_prove` would give nicer PR annotations but isn't load-bearing.
- **No pre-commit hooks (husky, lint-staged)** — solo dev, manual `npm run verify:phase` before push is sufficient.
- **No Dependabot / Renovate** — manual deps updates for now.
- **No PR/issue templates, CODEOWNERS** — solo dev.
- **No release automation** (changesets, semantic-release) — tag pattern is established and works.
- **No coverage upload service** (Codecov, Coveralls) — local HTML + GitHub Actions artifact is sufficient.
- **No status badge in README** — defer to T5 polish if first CI run is green.
- **No CI runs on tag pushes** — `on: push: branches: [main]` + PR triggers cover the merge gate. Tag-time re-verify is YAGNI.

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice |
|----------|--------|
| Direction | **Phase 6 hardening** (4 sub-phases A/B/C/D) over Phase 7 features |
| Phase 6 decomposition | **4 sub-phases:** A=CI / B=component tests / C=pgTAP backfill / D=E2E |
| Git remote | **GitHub private repo** |
| pgTAP-in-CI strategy | **`services: postgres:15`** with apt-installed pgTAP extension + bespoke `apply-schema.mjs` |
| Postgres version | **`postgres:15`** (matches Supabase prod — corrected from initial `postgres:17` choice) |
| pgTAP runner | **Keep existing `scripts/pgtap-run.mjs`** (psql + custom TAP parser). `pg_prove` migration deferred. |
| Coverage tool | **`@vitest/coverage-v8`** (faster than istanbul, recommended default) |
| Coverage thresholds | **Per-directory:** `src/lib/**` enforced at 80% statements/branches/functions/lines. All other dirs excluded from coverage report entirely (re-enabled in 6.B). |
| CI gate scope | **typecheck → vitest (with coverage) ∥ pgtap → build** (4 jobs) |
| Branch protection | **Enable on `main`** — require PR + verify green before merge |
| Pre-commit hooks | Deferred to 6.B+ |
| Auth schema in CI | **Bespoke mock** via `apply-schema.mjs` (creates `auth.users`, `auth.uid()`, `auth.role()` — only what test fixtures need) |

---

## 4. Architecture

### 4.1 Two parallel tracks

```
Phase 6.A scope
├── Track 1: Git remote + GitHub repo (user-driven setup)
│   ├── Create GitHub private repo
│   ├── git remote add origin <url>
│   ├── git push -u origin main + git push --tags
│   └── Configure branch protection
│
└── Track 2: CI workflow + coverage (code changes)
    ├── .github/workflows/verify.yml (new)
    ├── scripts/ci/apply-schema.mjs (new)
    ├── scripts/pgtap-run.mjs (modify — add PGTAP_DB_URL env-var override)
    ├── vitest.config.ts (modify — add coverage block)
    ├── package.json (modify — add @vitest/coverage-v8 + test:coverage script)
    └── docs/contributing.md (new)
```

### 4.2 CI workflow shape

4 jobs with explicit dependency tree:

```
typecheck (gate, ~30s)
    ├── vitest (parallel, ~45s with coverage)
    └── pgtap (parallel, ~90s with Postgres warmup)
            ↓
        build (final gate, ~60s)
```

Total wall-clock: ~3-5 min cold cache, ~2-3 min warm.

### 4.3 Local dev parity

Critical: **CI must use the same Postgres major version as local Supabase dev** (PG 15). Otherwise version-specific behaviors (JSON functions, RLS quirks, pgTAP function signatures) would diverge silently.

Local: `supabase_db_erp-ice-factory-v2` container = PG 15
CI: `postgres:15` service container = PG 15
Both: apt-installed pgTAP 1.3.x

### 4.4 Backward compatibility

`scripts/pgtap-run.mjs` modification is **strictly backward-compatible**:
- `PGTAP_DB_URL` env var **unset** → existing docker-exec behavior (unchanged for local dev)
- `PGTAP_DB_URL` env var **set** → direct psql against the URL (CI path)

No existing dev workflow breaks.

---

## 5. CI workflow specs (full content)

### 5.1 `.github/workflows/verify.yml`

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
  # Job 1: TypeScript strict check (fast — gates everything else)
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

**Key choices documented in the YAML:**
- `postgres:15` matches Supabase prod version
- `postgresql-15-pgtap` is Ubuntu's apt package for pgTAP 1.3.x, pre-built for PG 15
- `PGTAP_DB_URL` env var is the new override (added to `scripts/pgtap-run.mjs` in T1)
- `cache: npm` keeps subsequent runs fast via `package-lock.json` hash
- Job ordering: typecheck gates everything; vitest+pgtap parallel; build last (uses outputs implicitly)

### 5.2 `scripts/ci/apply-schema.mjs` (new)

```js
#!/usr/bin/env node
/**
 * Phase 6.A — Apply schema/functions/RLS to a bare Postgres in CI.
 *
 * Local dev uses `scripts/db-init.mjs` which targets the Supabase
 * docker container (and includes Supabase-specific bootstrap like
 * auth schema seeding). This script is the CI-equivalent: targets
 * a vanilla Postgres 15 instance pointed by PGTAP_DB_URL.
 *
 * Steps:
 *   1. Create the minimal Supabase auth schema mock that our pgTAP
 *      tests need (auth.users + auth.uid() + auth.role() helpers).
 *   2. Apply database/001_schema.sql
 *   3. Apply database/002_functions.sql
 *   4. Apply database/003_rls.sql
 *
 * Idempotent — uses CREATE OR REPLACE / CREATE IF NOT EXISTS
 * patterns from the schema files.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const DB_URL = process.env.PGTAP_DB_URL;
if (!DB_URL) {
  console.error("PGTAP_DB_URL env var required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DB_URL });

async function applySqlFile(label, relativePath) {
  const absPath = resolve(REPO_ROOT, relativePath);
  const sql = readFileSync(absPath, "utf8");
  process.stdout.write(`>>> Applying ${label}... `);
  await client.query(sql);
  console.log("OK");
}

async function main() {
  await client.connect();

  // 1. Mock Supabase auth schema (only what the test fixtures touch).
  // pgTAP test files insert into auth.users with these columns and
  // call auth.uid() / auth.role() via the RLS policies.
  process.stdout.write(">>> Seeding auth schema mock... ");
  await client.query(`
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
  `);
  console.log("OK");

  // 2-4. Apply schema in order
  await applySqlFile("schema", "database/001_schema.sql");
  await applySqlFile("functions", "database/002_functions.sql");
  await applySqlFile("rls", "database/003_rls.sql");

  await client.end();
  console.log(">>> apply-schema.mjs DONE");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
```

### 5.3 `scripts/pgtap-run.mjs` modification

The implementer will read the existing file first, then add a `PGTAP_DB_URL` env-var override. **Conceptual shape of the diff** (exact lines depend on current file structure):

```js
// At top of scripts/pgtap-run.mjs (or wherever the psql invocation is constructed)
const PGTAP_DB_URL = process.env.PGTAP_DB_URL;

function psqlCommand(sqlFilePath) {
  if (PGTAP_DB_URL) {
    // CI mode: direct psql against the connection string
    return ["psql", PGTAP_DB_URL, "-v", "ON_ERROR_STOP=1", "-f", sqlFilePath];
  }
  // Local dev mode: docker exec into supabase container (unchanged)
  return [
    "docker", "exec", "-i", "supabase_db_erp-ice-factory-v2",
    "psql", "-U", "postgres", "-d", "postgres",
    "-v", "ON_ERROR_STOP=1",
    "-f", `/var/lib/postgresql/tests/${basename(sqlFilePath)}`,
  ];
}
```

**Critical constraint:** when `PGTAP_DB_URL` is unset, behavior MUST be identical to the existing implementation. Local `npm run pgtap` must still produce 131 green without any changes to the dev workflow.

The exact change set is `~10 lines added` + `~5 lines modified` based on the current file shape (~80 lines total). The implementer will provide the diff inline during T1.

### 5.4 `vitest.config.ts` coverage block

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        "src/app/**",          // Next.js page entries — covered by build
        "src/components/ui/**", // Phase 2 design system (deferred to Phase 6.B)
        "src/features/**",     // UI components (deferred to Phase 6.B)
        "src/hooks/**",        // React hooks (deferred to Phase 6.B)
      ],
      thresholds: {
        // Phase 6.A: only enforce coverage on the pure-helper layer.
        // Component / feature tests come in 6.B and 6.D.
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

**Reasoning behind the thresholds:**
- `src/lib/` today has ~90% coverage across the 4 tested files (`format.ts`, `cash-math.ts`, `validation.ts`, `datetime.ts`)
- 80% gives ~10pp headroom for adding new helpers without breaking the gate
- `branches: 75` is slightly more lenient because exhaustive branch coverage on date math (timezone fallbacks etc.) is brittle
- Other directories excluded entirely — including them would dominate the report with 0% noise, masking the signal from `src/lib/`
- 6.B re-enables `src/components/ui/**` and `src/hooks/**` once Testing Library is in place

### 5.5 `package.json` modification

Append to `devDependencies`:
```json
"@vitest/coverage-v8": "^2.1.9"
```
(Matches existing `vitest: ^2.1.9` — no version drift.)

Append to `scripts`:
```json
"test:coverage": "vitest run --coverage"
```

### 5.6 `docs/contributing.md` (new, ~50 lines)

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
container. To test the CI path locally:

```bash
# Spin up a temporary PG 15 container
docker run -d --name pg15-ci-test -e POSTGRES_PASSWORD=postgres \
  -p 5433:5432 postgres:15
# Install pgTAP inside it
docker exec pg15-ci-test bash -c "apt-get update && \
  apt-get install -y postgresql-15-pgtap"
# Create the extension
docker exec -e PGPASSWORD=postgres pg15-ci-test \
  psql -U postgres -c "CREATE EXTENSION pgtap;"
# Apply schema + run tests
PGTAP_DB_URL=postgres://postgres:postgres@localhost:5433/postgres \
  node scripts/ci/apply-schema.mjs
PGTAP_DB_URL=postgres://postgres:postgres@localhost:5433/postgres \
  npm run pgtap
# Cleanup
docker rm -f pg15-ci-test
```

### Branch protection on `main`

The `main` branch requires:
- Pull request before merging (no direct push)
- `verify` workflow green (all 4 jobs)

Bypass possible by temporarily disabling protection in repo Settings → Branches.

### Commit message convention

- Subject prefix: `feat(phase-X.Y): TN — ...` / `fix(phase-X.Y): ...` / `docs(...)`
- Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- PowerShell: use the `Out-File -Encoding utf8 .git/COMMIT_MSG_TMP` + `git commit -F` pattern for Vietnamese diacritics
```

---

## 6. File manifest

### 6.1 New files (4)

| Path | Lines (est) | Responsibility |
|------|-------------|----------------|
| `.github/workflows/verify.yml` | ~80 | 4-job CI gate (typecheck / vitest / pgtap / build) |
| `scripts/ci/apply-schema.mjs` | ~70 | Loads 001/002/003.sql against vanilla PG 15 with auth schema mock |
| `docs/contributing.md` | ~50 | Dev workflow, CI-locally instructions, branch protection notes |
| `.github/CODEOWNERS` | n/a | NOT in 6.A scope (single-owner, defer) |

### 6.2 Modified files (3)

| Path | Change |
|------|--------|
| `scripts/pgtap-run.mjs` | Add `PGTAP_DB_URL` env-var override; preserve docker-exec default behavior |
| `vitest.config.ts` | Add coverage block with per-directory thresholds |
| `package.json` | Add `@vitest/coverage-v8` devDep + `test:coverage` script |

### 6.3 Off-limits (DO NOT TOUCH)

- `src/**` — no source code changes
- `database/**` — no schema/functions/RLS changes
- `docs/superpowers/specs/**` — except this spec
- `scripts/db-init.mjs` — local dev script frozen, don't unify with CI
- `scripts/seed.mjs`, `scripts/smoke-test.mjs` — out of scope
- All Phase 1-5 feature modules

---

## 7. Implementation strategy (task projection)

**5 tasks** — smaller than 5.B/C/D because no source code or RPC work:

| Task | Files | Verify |
|------|-------|--------|
| **T1** | `scripts/pgtap-run.mjs` modification | Local `npm run pgtap` (docker mode) still 131 pass |
| **T2** | `scripts/ci/apply-schema.mjs` (new) — validated locally by spinning up vanilla PG 15 + applying + running pgTAP via PGTAP_DB_URL env var → 131 pass against bare PG | 131 pass against vanilla PG 15 locally |
| **T3** | `package.json` (`@vitest/coverage-v8` + script) + `vitest.config.ts` coverage block | `npm run test:coverage` succeeds; `src/lib/**` thresholds met; coverage/ HTML generated |
| **T4** | `.github/workflows/verify.yml` (new) + `docs/contributing.md` (new) | YAML parses (actionlint or `gh workflow view` clean); doc readable |
| **T5** | GitHub remote setup (user-side: create repo on github.com) + push + first CI run + branch protection + tag `v4-phase-6a` on merge commit | First CI run goes 4/4 green; branch protection rule active |

T5 is user-driven for the repo creation step. The plan documents exact `gh repo create` commands as a fallback if user prefers CLI over UI.

### 7.1 Order rationale

- T1 first because T2 validates against it (apply-schema + pgtap-run together)
- T3 (vitest coverage) is independent — could run in parallel mentally but ordered here for sequential review clarity
- T4 (workflow YAML) depends on T1+T2+T3 being committed so the YAML references real npm scripts and a working PGTAP_DB_URL path
- T5 is the user-facing setup step + first CI run + tag — natural last position

---

## 8. Verification matrix

After T5 merges to `main`:

| Check | Command | Expected |
|-------|---------|----------|
| Local Vitest | `npm test -- --run` | 75 pass (unchanged) |
| Local pgTAP (docker mode) | `npm run pgtap` | 131 pass (unchanged) |
| Local pgTAP (CI mode) | `PGTAP_DB_URL=... npm run pgtap` after apply-schema | 131 pass against vanilla PG 15 |
| Local Vitest with coverage | `npm run test:coverage` | 75 pass + `src/lib/**` ≥80% |
| TypeScript | `npx tsc --noEmit` | 0 errors |
| Build | `npm run build` | success |
| Remote URL | `git remote get-url origin` | GitHub URL |
| Tag pushed | `git ls-remote --tags origin` | v4-phase-1 through v4-phase-5d + umbrellas + v4-phase-6a |
| First CI run | GitHub Actions tab | 4/4 jobs green |
| Branch protection | GitHub Settings → Branches | `main` requires PR + verify workflow |
| Final 6.A tag | `git tag -l v4-phase-6a` | exists on T5 merge commit |

---

## 9. Risks (specific to 6.A)

| Risk | Mitigation |
|------|------------|
| Schema files have Supabase-specific syntax that breaks on vanilla PG 15 | `apply-schema.mjs` seeds the minimal `auth.users` + `auth.uid()` + `auth.role()` mock that test fixtures need. T2 catches additional Supabase-only references locally before T4 wires them into CI. |
| pgTAP extension version mismatch (local docker vs CI apt package) | Both ship 1.3.x. Function signatures (`is()`, `plan()`, `finish()`) are stable across minor versions. No actual divergence risk. |
| Local docker container name hardcoded in `pgtap-run.mjs` | T1 keeps the existing hardcoded name as the default `PGTAP_DB_URL`-unset path. Local dev unchanged. |
| `npm ci` slow in CI | `cache: npm` (setup-node v4 built-in) keeps subsequent runs ~10s. First run cold cache ~60s. |
| `current_date` in pgTAP tests differs between dev clock and CI clock | All current pgTAP tests use `current_date` relative to "now" — works identically. If a future test needs absolute dates, mock `now()` then; out of 6.A scope. |
| Workflow YAML syntax errors only caught post-push | T4 includes a step to `actionlint` the YAML locally (install if needed) before commit. Alternative: `gh workflow view` reads the YAML and surfaces parse errors. |
| GitHub Actions runner has no docker socket for Supabase emulation | Not needed — `apply-schema.mjs` creates the auth schema mock via raw SQL. No Supabase CLI dependency. |
| Coverage threshold blocks legitimate `src/lib/**` additions without tests | `src/lib/` rarely grows; new helpers always come with tests per current convention. If a refactor moves UI logic into `src/lib/`, the failure correctly surfaces "this needs a test." |
| Branch protection locks out emergency direct push | Branch protection can be temporarily disabled in GitHub UI. Acceptable trade-off. |
| First CI run takes longer than the cache builds | Expected. ~5-7 min cold; ~2-3 min warm. |
| Per-directory threshold syntax in Vitest 2.1.x | Vitest 2.1+ supports the per-glob `coverage.thresholds["path/**"]` syntax. T3 confirms against 2.1.9 docs; if syntax changed in 2.1.x, fall back to flat threshold + remove per-dir scope. |
| `PGTAP_DB_URL` env var collision with future GitHub secrets | Variable is workflow-internal. If a real Supabase test project arrives later, it gets a separate `SUPABASE_TEST_URL` etc. |
| Auth schema mock incomplete — some pgTAP test uses an unmocked function | `apply-schema.mjs` failure surfaces at T2 (local CI-mode validation). Add to mock and re-run before T4. |

---

## 10. Success criteria

1. ✅ Local `npm run pgtap` (existing docker-exec mode) still reports 131 passing — no regression
2. ✅ Local `PGTAP_DB_URL=... npm run pgtap` reports 131 passing against vanilla PG 15 (validates CI path locally)
3. ✅ `npm run test:coverage` produces `coverage/index.html` and meets `src/lib/**` thresholds (80/75/80/80)
4. ✅ `npx tsc --noEmit` clean
5. ✅ `npm run build` clean
6. ✅ `.github/workflows/verify.yml` syntactically valid (actionlint or `gh workflow view` clean)
7. ✅ GitHub repo created (private)
8. ✅ `git remote -v` shows `origin` pointing at the GitHub URL
9. ✅ All existing tags pushed: `git ls-remote --tags origin` shows v4-phase-1 through v4-phase-5d + umbrellas
10. ✅ First push to `main` triggers verify workflow on GitHub Actions
11. ✅ First CI run: all 4 jobs (typecheck, vitest, pgtap, build) green
12. ✅ Branch protection rule enabled on `main`: requires PR + verify workflow green before merge
13. ✅ Tag `v4-phase-6a` placed on T5 merge commit (and pushed to remote)

---

## 11. Open decisions (deferred to writing-plans / execution)

- **`actionlint` install** — required for T4 local check? Or trust `gh workflow view` parse check? Implementer decides at T4 step (likely `gh` CLI since it's already in the toolbox).
- **Coverage upload service (Codecov, Coveralls)** — deferred. Local HTML + Actions artifact sufficient for solo dev.
- **README status badge** — deferred to T5 post-first-green polish. One-line README edit after badge URL is known.
- **`npm ci` peer-dep warnings** — surface during T3; deal with case-by-case (likely none, but check).
- **Tag-push trigger** — `on: push: branches: [main]` + PR currently covers the merge gate. Tag-time re-verify is YAGNI.
- **apt cache for pgTAP extension** — each pgtap-job apt-install takes ~20s. Could cache `/var/cache/apt`. Defer until pain is felt.
- **`gh repo create` vs github.com UI** — user preference at T5. Plan documents both paths.

---

## 12. After this sub-phase

Once T5 merges and `v4-phase-6a` is placed + pushed:

- **Phase 6.B (Component tests)** — Vitest browser-mode OR jsdom + Testing Library setup + 4-6 representative component tests. Re-enables `src/components/ui/**` and `src/hooks/**` coverage. ~5-6 tasks.
- **Phase 6.C (pgTAP backfill)** — RPC + RLS pgTAP for non-cash tables. Closes biggest test-coverage gap. ~6-8 tasks.
- **Phase 6.D (E2E foundation)** — Playwright + seeded Docker test profile + auth flow + 2-3 critical-path E2E tests. Heaviest infra. ~6-8 tasks.

After 6.D merges → umbrella `v4-phase-6` tag closes Phase 6.

---

## 13. Self-review

**Placeholder scan:** No "TBD" / "TODO" / "implement later" in normative sections (§§3–10). §11 explicitly labels Open decisions.

**Internal consistency:**
- 4 new + 3 modified files (§6) — confirmed against task projection (§7) ✓
- 5 tasks (§7) — same shape as 5.D ✓
- `postgres:15` consistent across §4.3, §5.1, §5.2, §9, contributing.md ✓
- `PGTAP_DB_URL` env var consistent: introduced in §5.1, defined in §5.3, used in §7 T2 + T4 + contributing.md ✓
- Coverage thresholds (`src/lib/**` 80/75/80/80) consistent across §5.4, §10.3 ✓
- 13 success criteria (§10) cover all 7 file artifacts (§6) + verification (§8) ✓

**Ambiguity check:**
- "CI mode" vs "local mode" for `pgtap-run.mjs` defined explicitly: PGTAP_DB_URL unset = local docker; set = direct psql
- "Vanilla PG 15" defined as `postgres:15` Docker image + apt-installed `postgresql-15-pgtap`
- "Per-directory thresholds" defined explicitly (§5.4) with reasoning
- 4-job dependency tree explicit: typecheck → vitest+pgtap → build
- Branch protection scope: PR + verify workflow green (no other rules in 6.A)

**Scope check:** Pure infrastructure phase. No source code. No schema. Manageable in 5 tasks. Matches 5.D scale (also 5 tasks).

No issues found.

---

## 14. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 5-task implementation plan with full YAML + JS + JSON code inline per task.

After 6.A merges and tag lands, subsequent Phase 6 sub-phases (B/C/D) build on this CI foundation.
