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
