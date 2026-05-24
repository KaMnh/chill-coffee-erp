# On-prem Dockge Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up production deployment of Chill Coffee ERP v4 on an on-prem mini-PC managed by Dockge, with a tag-driven GitHub Actions release pipeline pushing app images to GHCR.

**Architecture:** Two independent flows — (1) Release: `git push --tags` → Actions builds image with `NEXT_PUBLIC_*` placeholders → push to GHCR; (2) Deploy: user copies `deploy/dockge/` to `/opt/stacks/chill-coffee-erp/`, fills `.env`, hits Deploy in Dockge UI. Runtime `sed` replaces placeholders in the built bundle so one image works for any deployment.

**Tech Stack:** GitHub Actions, GHCR, Docker Compose v2.23+, Dockge, Bash, Next.js 15 standalone build, self-hosted Supabase stack (13 services).

**Reference spec:** [docs/superpowers/specs/2026-05-24-onprem-dockge-deploy-design.md](../specs/2026-05-24-onprem-dockge-deploy-design.md)

---

## Phase 1: Runtime placeholder injection mechanism

This phase lets one image work for many deployments by replacing `NEXT_PUBLIC_*` env values in the built bundle at container start. We validate it works against the existing dev compose before moving on.

### Task 1: Add docker-entrypoint.sh with placeholder replacement

**Files:**
- Create: `docker-entrypoint.sh`
- Create: `tests/entrypoint/test-replacement.sh`

- [ ] **Step 1: Write the failing shell test**

Create `tests/entrypoint/test-replacement.sh`:

```bash
#!/usr/bin/env bash
# Test that docker-entrypoint.sh replaces NEXT_PUBLIC_* placeholders
# in built JS files with current env values.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENTRYPOINT="$REPO_ROOT/docker-entrypoint.sh"

# Create a synthetic .next/standalone tree
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/.next/standalone/.next/static/chunks"
mkdir -p "$WORK/.next/standalone/.next/server/app"

cat > "$WORK/.next/standalone/.next/static/chunks/main.js" <<EOF
const url = "__SUPABASE_URL_PLACEHOLDER__";
const key = "__SUPABASE_ANON_KEY_PLACEHOLDER__";
const app = "__APP_URL_PLACEHOLDER__";
EOF

cat > "$WORK/.next/standalone/.next/server/app/page.js" <<EOF
export const config = { url: "__SUPABASE_URL_PLACEHOLDER__" };
EOF

# Run entrypoint in dry mode (no exec at end) with test env
cd "$WORK"
NEXT_PUBLIC_SUPABASE_URL="https://supabase.test.local" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJtest" \
NEXT_PUBLIC_APP_URL="https://app.test.local" \
ENTRYPOINT_DRY_RUN=1 \
  bash "$ENTRYPOINT"

# Verify replacements
grep -q "https://supabase.test.local" .next/standalone/.next/static/chunks/main.js \
  || { echo "FAIL: SUPABASE_URL not replaced in static chunk"; exit 1; }
grep -q "eyJtest" .next/standalone/.next/static/chunks/main.js \
  || { echo "FAIL: ANON_KEY not replaced in static chunk"; exit 1; }
grep -q "https://app.test.local" .next/standalone/.next/static/chunks/main.js \
  || { echo "FAIL: APP_URL not replaced in static chunk"; exit 1; }
grep -q "https://supabase.test.local" .next/standalone/.next/server/app/page.js \
  || { echo "FAIL: SUPABASE_URL not replaced in server chunk"; exit 1; }

# Verify no placeholders remain
if grep -r "__SUPABASE_URL_PLACEHOLDER__" .next/standalone/ 2>/dev/null; then
  echo "FAIL: placeholder still present"
  exit 1
fi

echo "PASS: all placeholders replaced in static + server bundles"
```

Make it executable:

```bash
chmod +x tests/entrypoint/test-replacement.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash tests/entrypoint/test-replacement.sh`
Expected: FAIL — `docker-entrypoint.sh` doesn't exist yet (`bash: ... No such file or directory`)

- [ ] **Step 3: Write the entrypoint script**

Create `docker-entrypoint.sh`:

```bash
#!/bin/sh
# Runtime injection of NEXT_PUBLIC_* env values into the Next.js standalone build.
#
# Next.js inlines NEXT_PUBLIC_* values into the JS bundle at build time. To make
# one image work for many deployments, we build with stable placeholder strings
# and replace them at container start with the current env values.
#
# Placeholders (must match values used in Dockerfile build-args):
#   __SUPABASE_URL_PLACEHOLDER__       ← $NEXT_PUBLIC_SUPABASE_URL
#   __SUPABASE_ANON_KEY_PLACEHOLDER__  ← $NEXT_PUBLIC_SUPABASE_ANON_KEY
#   __APP_URL_PLACEHOLDER__            ← $NEXT_PUBLIC_APP_URL

set -e

STANDALONE_DIR="${STANDALONE_DIR:-/app/.next/standalone}"
[ "${ENTRYPOINT_DRY_RUN:-0}" = "1" ] && STANDALONE_DIR="$(pwd)/.next/standalone"

if [ ! -d "$STANDALONE_DIR" ]; then
  echo "entrypoint: $STANDALONE_DIR not found, skipping placeholder replacement" >&2
  exec "$@"
fi

replace_in_bundle() {
  placeholder="$1"
  value="$2"
  name="$3"

  if [ -z "$value" ]; then
    echo "entrypoint: WARN $name is empty, leaving placeholder in place" >&2
    return 0
  fi

  # Escape sed metacharacters in value: \ & /
  escaped=$(printf '%s' "$value" | sed 's/[\\&/]/\\&/g')

  count=$(grep -rl "$placeholder" "$STANDALONE_DIR/.next" 2>/dev/null | wc -l)
  if [ "$count" -eq 0 ]; then
    echo "entrypoint: WARN no files contain $placeholder" >&2
    return 0
  fi

  find "$STANDALONE_DIR/.next" -type f \( -name '*.js' -o -name '*.json' -o -name '*.html' \) \
    -exec sed -i "s/$placeholder/$escaped/g" {} +

  echo "entrypoint: replaced $name in $count file(s)"
}

replace_in_bundle "__SUPABASE_URL_PLACEHOLDER__"      "${NEXT_PUBLIC_SUPABASE_URL:-}"      NEXT_PUBLIC_SUPABASE_URL
replace_in_bundle "__SUPABASE_ANON_KEY_PLACEHOLDER__" "${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}" NEXT_PUBLIC_SUPABASE_ANON_KEY
replace_in_bundle "__APP_URL_PLACEHOLDER__"           "${NEXT_PUBLIC_APP_URL:-}"           NEXT_PUBLIC_APP_URL

# Fail loud if any placeholder survived
if grep -rq "__SUPABASE_URL_PLACEHOLDER__\|__SUPABASE_ANON_KEY_PLACEHOLDER__\|__APP_URL_PLACEHOLDER__" "$STANDALONE_DIR/.next" 2>/dev/null; then
  echo "entrypoint: ERROR placeholders still present after replacement" >&2
  exit 1
fi

if [ "${ENTRYPOINT_DRY_RUN:-0}" = "1" ]; then
  exit 0
fi

exec "$@"
```

Make it executable:

```bash
chmod +x docker-entrypoint.sh
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash tests/entrypoint/test-replacement.sh`
Expected: PASS with output:
```
entrypoint: replaced NEXT_PUBLIC_SUPABASE_URL in 2 file(s)
entrypoint: replaced NEXT_PUBLIC_SUPABASE_ANON_KEY in 1 file(s)
entrypoint: replaced NEXT_PUBLIC_APP_URL in 1 file(s)
PASS: all placeholders replaced in static + server bundles
```

- [ ] **Step 5: Commit**

```bash
git add docker-entrypoint.sh tests/entrypoint/test-replacement.sh
git commit -m "feat(deploy): add runtime NEXT_PUBLIC_* placeholder injection"
```

---

### Task 2: Modify Dockerfile to use entrypoint + accept placeholder build-args

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Update Dockerfile build-args and runner stage**

Replace the contents of `Dockerfile` with:

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
# Build-args default to placeholders. The release workflow always passes these.
# Local dev builds (npm run dev / docker compose build) can override with real
# values, in which case the entrypoint replacement is a no-op.
ARG NEXT_PUBLIC_SUPABASE_URL=__SUPABASE_URL_PLACEHOLDER__
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=__SUPABASE_ANON_KEY_PLACEHOLDER__
ARG NEXT_PUBLIC_APP_URL=__APP_URL_PLACEHOLDER__
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# HOSTNAME=0.0.0.0 — Next.js standalone binds process.env.HOSTNAME. Docker auto-sets
# HOSTNAME to the container ID, so without this the server binds the container IP only
# and the in-container healthcheck (wget localhost:3000) fails permanently.
ENV HOSTNAME=0.0.0.0
# postgresql-client provides pg_dump for the /api/backup/full route.
RUN apk add --no-cache postgresql-client \
    && addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
```

- [ ] **Step 2: Build image with placeholders and verify**

Run from repo root:

```bash
docker build -t chill-erp:test-placeholders .
```

Expected: build succeeds, takes ~3-5 min on first run.

- [ ] **Step 3: Verify placeholders are present in built image**

```bash
docker run --rm --entrypoint sh chill-erp:test-placeholders -c \
  "grep -rl __SUPABASE_URL_PLACEHOLDER__ /app/.next | head -5"
```

Expected: prints at least one file path (e.g. a chunk file under `/app/.next/static/chunks/`). If empty → build did not pick up the placeholder.

- [ ] **Step 4: Verify runtime replacement works inside the container**

```bash
docker run --rm \
  -e NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com \
  -e NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon \
  -e NEXT_PUBLIC_APP_URL=https://app.example.com \
  --entrypoint sh \
  chill-erp:test-placeholders \
  -c "/app/docker-entrypoint.sh true && grep -l 'supabase.example.com' /app/.next/static/chunks/*.js | head -3"
```

Expected: prints at least one chunk file containing the replaced URL. No `entrypoint: ERROR` messages.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "feat(deploy): wire docker-entrypoint.sh + placeholder build-args"
```

---

## Phase 2: deploy/dockge/ skeleton (gitignore, env template, static volumes)

### Task 3: Create deploy/dockge/ directory + .gitignore

**Files:**
- Create: `deploy/dockge/.gitignore`
- Create: `deploy/dockge/.gitkeep` (placeholder)

- [ ] **Step 1: Create directory and .gitignore**

```bash
mkdir -p deploy/dockge/volumes/{api,db,storage,backups,snippets,functions,logs}
```

Create `deploy/dockge/.gitignore`:

```
# Runtime data — never commit
.env
.env.local
volumes/db/data/
volumes/storage/
volumes/backups/
volumes/snippets/
volumes/functions/
volumes/logs/
volumes/api/kong-temp.yml

# OS noise
.DS_Store
Thumbs.db
```

Create empty `.gitkeep` files so the runtime dirs exist after clone (Dockge creates them on first run but having them helps initial UX):

```bash
touch deploy/dockge/volumes/db/.gitkeep
touch deploy/dockge/volumes/storage/.gitkeep
touch deploy/dockge/volumes/backups/.gitkeep
touch deploy/dockge/volumes/snippets/.gitkeep
touch deploy/dockge/volumes/functions/.gitkeep
touch deploy/dockge/volumes/logs/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add deploy/dockge/.gitignore deploy/dockge/volumes/
git commit -m "chore(deploy): scaffold deploy/dockge/ directory structure"
```

---

### Task 4: Write sync-volumes.sh helper that mirrors static configs from supabase/

**Files:**
- Create: `deploy/dockge/sync-volumes.sh`

- [ ] **Step 1: Write the script**

Create `deploy/dockge/sync-volumes.sh`:

```bash
#!/usr/bin/env bash
# Mirror static Supabase config files from supabase/volumes/ into
# deploy/dockge/volumes/ so the Dockge stack folder is self-contained.
#
# Run this whenever supabase/volumes/{api,db}/ changes upstream.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SRC_API="$REPO_ROOT/supabase/volumes/api"
SRC_DB="$REPO_ROOT/supabase/volumes/db"
DST_API="$SCRIPT_DIR/volumes/api"
DST_DB="$SCRIPT_DIR/volumes/db"

mkdir -p "$DST_API" "$DST_DB"

# Kong config (declarative routes)
cp "$SRC_API/kong.yml"             "$DST_API/kong.yml"
cp "$SRC_API/kong-entrypoint.sh"   "$DST_API/kong-entrypoint.sh"
chmod +x "$DST_API/kong-entrypoint.sh"

# Postgres init SQLs (run once on first DB bootstrap)
for f in _supabase.sql jwt.sql logs.sql pooler.sql realtime.sql roles.sql webhooks.sql; do
  cp "$SRC_DB/$f" "$DST_DB/$f"
done

echo "Synced static volumes: api/ + db/"
echo "Note: runtime dirs (data/, storage/, backups/, ...) are populated by containers on first start."
```

```bash
chmod +x deploy/dockge/sync-volumes.sh
```

- [ ] **Step 2: Run the sync script**

```bash
bash deploy/dockge/sync-volumes.sh
```

Expected output:
```
Synced static volumes: api/ + db/
Note: runtime dirs ...
```

- [ ] **Step 3: Verify expected files now exist**

```bash
ls deploy/dockge/volumes/api/ deploy/dockge/volumes/db/
```

Expected `deploy/dockge/volumes/api/`: `kong.yml`, `kong-entrypoint.sh`
Expected `deploy/dockge/volumes/db/`: `_supabase.sql`, `jwt.sql`, `logs.sql`, `pooler.sql`, `realtime.sql`, `roles.sql`, `webhooks.sql`

- [ ] **Step 4: Commit script + synced files**

```bash
git add deploy/dockge/sync-volumes.sh deploy/dockge/volumes/api/ deploy/dockge/volumes/db/
git commit -m "feat(deploy): add sync-volumes.sh + initial synced Supabase configs"
```

---

### Task 5: Write deploy/dockge/.env.example

**Files:**
- Create: `deploy/dockge/.env.example`

- [ ] **Step 1: Read source .env.examples to know every variable**

Run:

```bash
cat supabase/.env.example
cat .env.example
```

Confirm you can see every variable that needs to appear in the consolidated template.

- [ ] **Step 2: Write the consolidated template**

Create `deploy/dockge/.env.example`:

```bash
# ============================================================================
# Chill Coffee ERP v4 — Production .env (Dockge stack)
# ============================================================================
# 1. Copy this file to `.env` in the same folder (Dockge will edit it via UI).
# 2. Generate Supabase secrets ONCE on a dev machine:
#       bash supabase/utils/generate-keys.sh
#    Paste the output into Section 3 below.
# 3. Set Section 1 (App) values to match your reverse-proxy domains.
# 4. NEVER commit this file. NEVER share JWT_SECRET or SERVICE_ROLE_KEY.
# ============================================================================


# ─────────────────────────────────────────────
# SECTION 0 — Host port mapping
# ─────────────────────────────────────────────
# Change these if the defaults conflict with other services on the mini-PC.
# These are the host (outside Docker) ports the reverse proxy will hit.

APP_PORT=3009
KONG_HTTP_PORT=8000
# KONG_HTTPS_PORT=8443     # Uncomment only if proxying Supabase without upstream TLS


# ─────────────────────────────────────────────
# SECTION 1 — App (Next.js)
# ─────────────────────────────────────────────
# Public URLs are what the BROWSER sees, after your reverse proxy.
# They are independent of the host ports above.

NEXT_PUBLIC_SUPABASE_URL=https://supabase.example.com
NEXT_PUBLIC_APP_URL=https://app.example.com

# Server-only — overridden by docker-compose to point at the internal Kong service.
SUPABASE_INTERNAL_URL=http://kong:8000

# KiotViet POS ingest. INGEST_CLIENT_SECRET is plaintext; bcrypt hash lives in
# the integration_clients table after first deploy. Rotate with `openssl rand -hex 32`.
INGEST_CLIENT_ID=chill-erp
INGEST_CLIENT_SECRET=

# Optional — cron polling secret. Generate with `openssl rand -hex 32`. Empty = cron disabled.
CRON_SECRET=

# Admin Postgres URL for the in-app backup/restore UI. The host `db` resolves
# inside the stack network. Replace POSTGRES_PASSWORD with the value from Section 3.
POSTGRES_BACKUP_URL=postgresql://postgres:REPLACE_WITH_POSTGRES_PASSWORD@db:5432/postgres


# ─────────────────────────────────────────────
# SECTION 2 — Supabase API URLs
# ─────────────────────────────────────────────
# These are used internally by Supabase services. Mostly point at the same
# public URL the browser uses.

API_EXTERNAL_URL=https://supabase.example.com
SUPABASE_PUBLIC_URL=https://supabase.example.com
SITE_URL=https://app.example.com
ADDITIONAL_REDIRECT_URLS=
SUPABASE_ANON_KEY=${ANON_KEY}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}


# ─────────────────────────────────────────────
# SECTION 3 — Supabase secrets (GENERATE, then paste)
# ─────────────────────────────────────────────
# Generate via:    bash supabase/utils/generate-keys.sh
# Paste the printed values below.

POSTGRES_PASSWORD=
JWT_SECRET=
ANON_KEY=
SERVICE_ROLE_KEY=
SECRET_KEY_BASE=
VAULT_ENC_KEY=

# Asymmetric keys (optional — leave empty for legacy HS256 only)
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
JWT_KEYS=
JWT_JWKS=

# Supabase Studio dashboard basic-auth
DASHBOARD_USERNAME=supabase
DASHBOARD_PASSWORD=


# ─────────────────────────────────────────────
# SECTION 4 — Supabase Postgres
# ─────────────────────────────────────────────
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432


# ─────────────────────────────────────────────
# SECTION 5 — Supabase Auth (GoTrue)
# ─────────────────────────────────────────────
DISABLE_SIGNUP=true
JWT_EXPIRY=3600

ENABLE_EMAIL_SIGNUP=false
ENABLE_EMAIL_AUTOCONFIRM=true
ENABLE_ANONYMOUS_USERS=false
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false

SMTP_ADMIN_EMAIL=admin@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SENDER_NAME=Chill Coffee ERP

MAILER_URLPATHS_INVITE=/auth/v1/verify
MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify
MAILER_URLPATHS_RECOVERY=/auth/v1/verify
MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify


# ─────────────────────────────────────────────
# SECTION 6 — Supabase Studio
# ─────────────────────────────────────────────
STUDIO_DEFAULT_ORGANIZATION=Chill Coffee
STUDIO_DEFAULT_PROJECT=Chill Coffee ERP
OPENAI_API_KEY=
PG_META_CRYPTO_KEY=
PGRST_DB_SCHEMAS=public,storage,graphql_public
PGRST_DB_MAX_ROWS=1000
PGRST_DB_EXTRA_SEARCH_PATH=public


# ─────────────────────────────────────────────
# SECTION 7 — Supabase Logflare / Analytics
# ─────────────────────────────────────────────
LOGFLARE_PUBLIC_ACCESS_TOKEN=
LOGFLARE_PRIVATE_ACCESS_TOKEN=


# ─────────────────────────────────────────────
# SECTION 8 — Supabase Functions (optional)
# ─────────────────────────────────────────────
FUNCTIONS_VERIFY_JWT=false


# ─────────────────────────────────────────────
# SECTION 9 — Supabase Supavisor connection pooler
# ─────────────────────────────────────────────
POOLER_PROXY_PORT_TRANSACTION=6543
POOLER_DEFAULT_POOL_SIZE=20
POOLER_MAX_CLIENT_CONN=100
POOLER_TENANT_ID=chill-coffee-erp
POOLER_DB_POOL_SIZE=5


# ─────────────────────────────────────────────
# SECTION 10 — App image tag (Dockge pulls this)
# ─────────────────────────────────────────────
# Set to a specific release like `v4.0.1` for reproducible deploys.
# Use `latest` only for rolling deploys (less safe).

CHILL_ERP_IMAGE=ghcr.io/REPLACE_WITH_GITHUB_OWNER/chill-coffee-erp:v4.0.0
```

- [ ] **Step 3: Validate by sourcing the file (no execution)**

```bash
set -a
. deploy/dockge/.env.example
set +a
echo "OK — file is shell-sourceable"
```

Expected: prints `OK ...`. If error, fix the file.

- [ ] **Step 4: Commit**

```bash
git add deploy/dockge/.env.example
git commit -m "feat(deploy): add consolidated .env.example for Dockge stack"
```

---

## Phase 3: deploy/dockge/compose.yaml — the production stack

### Task 6: Write the production compose.yaml

**Files:**
- Create: `deploy/dockge/compose.yaml`

This is the largest file. Strategy: copy `supabase/docker-compose.yml` as the base, then apply these transformations:

1. Remove the file-level `name: supabase` → replace with `name: chill-coffee-erp` (so Dockge groups everything under one stack)
2. Add the `app` service at the top of `services:` (inserted ahead of `studio:`)
3. Change `kong.ports` to use `${KONG_HTTP_PORT:-8000}:8000` and comment out the `${KONG_HTTPS_PORT}:8443` line
4. Leave volume paths as `./volumes/...` — they resolve relative to the stack folder when Dockge runs `docker compose`

- [ ] **Step 1: Copy supabase compose as starting point**

```bash
cp supabase/docker-compose.yml deploy/dockge/compose.yaml
```

- [ ] **Step 2: Apply transformation 1 — rename stack**

Edit `deploy/dockge/compose.yaml`. Find:

```yaml
name: supabase
```

Replace with:

```yaml
# Chill Coffee ERP v4 — production stack for Dockge.
# Generated from supabase/docker-compose.yml + app service.
# Edit supabase/docker-compose.yml upstream and re-run deploy/dockge/sync-volumes.sh
# + manual re-port of changes here when Supabase versions bump.
name: chill-coffee-erp
```

- [ ] **Step 3: Apply transformation 2 — insert app service**

Find the line:

```yaml
services:

  studio:
```

Replace with:

```yaml
services:

  app:
    container_name: chill-app
    image: ${CHILL_ERP_IMAGE:-ghcr.io/REPLACE_WITH_GITHUB_OWNER/chill-coffee-erp:latest}
    restart: unless-stopped
    env_file: .env
    environment:
      NODE_ENV: production
      # Override SUPABASE_INTERNAL_URL so server-side fetches use the Docker network,
      # not the public URL. The .env value is ignored for this var.
      SUPABASE_INTERNAL_URL: http://kong:8000
    ports:
      - "${APP_PORT:-3009}:3000"
    depends_on:
      kong:
        condition: service_healthy
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:3000/"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 60s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  studio:
```

- [ ] **Step 4: Apply transformation 3 — Kong port mapping**

Find the kong service's `ports:` block (around line 92-94 in the source):

```yaml
    ports:
      - ${KONG_HTTP_PORT}:8000/tcp
      - ${KONG_HTTPS_PORT}:8443/tcp
```

Replace with:

```yaml
    ports:
      - "${KONG_HTTP_PORT:-8000}:8000/tcp"
      # - "${KONG_HTTPS_PORT:-8443}:8443/tcp"  # Uncomment if proxying Supabase without upstream TLS
```

- [ ] **Step 5: Validate compose syntax**

```bash
cd deploy/dockge
cp .env.example .env
# Fill required vars enough to pass `docker compose config`:
sed -i 's/POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=test/' .env
sed -i 's/JWT_SECRET=$/JWT_SECRET=test-jwt-secret-at-least-32-characters-long/' .env
sed -i 's/ANON_KEY=$/ANON_KEY=test-anon/' .env
sed -i 's/SERVICE_ROLE_KEY=$/SERVICE_ROLE_KEY=test-service/' .env
sed -i 's/SECRET_KEY_BASE=$/SECRET_KEY_BASE=test-secret-base/' .env
sed -i 's/VAULT_ENC_KEY=$/VAULT_ENC_KEY=test-vault-key-32-chars-minimum/' .env
sed -i 's/DASHBOARD_PASSWORD=$/DASHBOARD_PASSWORD=test/' .env
sed -i 's/PG_META_CRYPTO_KEY=$/PG_META_CRYPTO_KEY=test-meta-key-32-chars-minimum/' .env
sed -i 's/LOGFLARE_PUBLIC_ACCESS_TOKEN=$/LOGFLARE_PUBLIC_ACCESS_TOKEN=test-pub/' .env
sed -i 's/LOGFLARE_PRIVATE_ACCESS_TOKEN=$/LOGFLARE_PRIVATE_ACCESS_TOKEN=test-priv/' .env

docker compose -f compose.yaml --env-file .env config > /tmp/compose-resolved.yaml
echo "Exit: $?"
```

Expected: exit code 0. If non-zero, fix env vars or yaml syntax in compose.yaml.

- [ ] **Step 6: Verify resolved output has 14 services**

```bash
grep -E "^\s+(app|studio|kong|auth|rest|realtime|storage|imgproxy|meta|functions|analytics|db|vector|supavisor):" /tmp/compose-resolved.yaml | wc -l
```

Expected: `14`

- [ ] **Step 7: Verify port mappings**

```bash
grep -E "published:" /tmp/compose-resolved.yaml
```

Expected: two `published: "3009"` and `published: "8000"` lines (only app + Kong HTTP). No 8443.

- [ ] **Step 8: Clean up test .env, then commit**

```bash
rm deploy/dockge/.env
git add deploy/dockge/compose.yaml
git commit -m "feat(deploy): add production compose.yaml (app + full Supabase stack)"
```

---

## Phase 4: Documentation

### Task 7: Write deploy/dockge/README.md

**Files:**
- Create: `deploy/dockge/README.md`

- [ ] **Step 1: Write the README**

Create `deploy/dockge/README.md`:

````markdown
# Chill Coffee ERP v4 — Dockge Production Stack

This folder is a self-contained [Dockge](https://dockge.kuma.pet/) stack that runs:

- The Next.js app (pulled as a pre-built image from GHCR)
- The full self-hosted Supabase stack (13 services: Postgres, Auth, Kong, Studio, ...)

The user handles NAT + reverse proxy + TLS externally. Only two host ports
reach the network by default: `APP_PORT` (Next.js) and `KONG_HTTP_PORT`
(Supabase API gateway).

## Prerequisites

On the mini-PC:
- Docker Engine 24+
- Docker Compose v2.23+
- Dockge installed and running
- ~4 GB RAM free (Supabase stack baseline ~2 GB, headroom for queries)
- ~20 GB disk in the partition holding `/opt/stacks/`

On a dev machine (one-time, for key generation):
- This repo cloned
- Bash + `openssl`

## First-time setup

### 1. Generate Supabase secrets (on the dev machine)

```bash
cd /path/to/Chill-Coffee-ERP
bash supabase/utils/generate-keys.sh
```

The script prints values for `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`,
`SERVICE_ROLE_KEY`, `SECRET_KEY_BASE`, `VAULT_ENC_KEY`,
`LOGFLARE_PUBLIC_ACCESS_TOKEN`, `LOGFLARE_PRIVATE_ACCESS_TOKEN`,
`DASHBOARD_PASSWORD`, and `PG_META_CRYPTO_KEY`.

**Save these to your password manager NOW.** If you lose them, existing
backup files cannot be restored.

### 2. Prepare the stack folder on the mini-PC

```bash
sudo mkdir -p /opt/stacks/chill-coffee-erp
sudo chown $(whoami):$(whoami) /opt/stacks/chill-coffee-erp
```

### 3. Copy the deploy folder to the server

From the dev machine:

```bash
rsync -av --exclude='.env' deploy/dockge/ user@mini-pc:/opt/stacks/chill-coffee-erp/
```

### 4. Write the `.env` file on the server

On the mini-PC:

```bash
cd /opt/stacks/chill-coffee-erp
cp .env.example .env
nano .env   # or edit via Dockge UI after step 6
```

Fill at minimum:
- `APP_PORT`, `KONG_HTTP_PORT` (change if defaults conflict with other services)
- `NEXT_PUBLIC_SUPABASE_URL` — the public URL of your reverse-proxied Kong (e.g. `https://supabase.example.com`)
- `NEXT_PUBLIC_APP_URL` — the public URL of your reverse-proxied app (e.g. `https://app.example.com`)
- `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL` — usually same as the URLs above
- All Section 3 secrets (paste from step 1)
- `INGEST_CLIENT_SECRET` — `openssl rand -hex 32`
- `CRON_SECRET` — `openssl rand -hex 32` (or leave empty to disable cron)
- `POSTGRES_BACKUP_URL` — replace `REPLACE_WITH_POSTGRES_PASSWORD` with the value from step 1
- `CHILL_ERP_IMAGE` — replace `REPLACE_WITH_GITHUB_OWNER` with your GitHub username/org; pin to a release tag like `:v4.0.0`

### 5. Set Postgres data directory permissions

Supabase's Postgres image runs as UID 70. The bind-mounted data dir must be owned by it:

```bash
sudo mkdir -p volumes/db/data
sudo chown -R 70:70 volumes/db/data
```

Skip this and the first deploy will fail with `chown: changing ownership of '/var/lib/postgresql/data': Permission denied`.

### 6. Login to GHCR if the image is private

If you set your GHCR package to "Private" on GitHub:

```bash
# Create a PAT at https://github.com/settings/tokens with scope: read:packages
echo "<your-pat>" | docker login ghcr.io -u <github-username> --password-stdin
```

Public packages skip this step.

### 7. Deploy in Dockge

1. Open the Dockge UI
2. Click "Add Stack"
3. Set stack name: `chill-coffee-erp`
4. Dockge detects `/opt/stacks/chill-coffee-erp/compose.yaml` automatically
5. Click "Deploy"
6. Wait ~2 minutes for all healthchecks to pass (watch the logs panel)

### 8. Initialize the database schema and seed

```bash
docker exec -it chill-app sh -c "npm run db:init && npm run db:seed"
```

Expected: `db:init` applies schema (~30 SQL files), `db:seed` inserts demo
inventory/recipes/etc. Roughly 60 seconds total.

### 9. Smoke test

```bash
curl -fsS http://localhost:${APP_PORT:-3009}/        # 200 OK
curl -fsS http://localhost:${KONG_HTTP_PORT:-8000}/  # Kong response (HTTP 404 is fine — root has no route)

# On a LAN device:
xdg-open http://<server-ip>:${APP_PORT:-3009}        # Chill ERP login screen
```

### 10. Configure your reverse proxy

(Out of scope of this stack — example mappings.)

```
app.example.com       → http://127.0.0.1:${APP_PORT}
supabase.example.com  → http://127.0.0.1:${KONG_HTTP_PORT}
```

## Updates

When a new release is published to GHCR:

```bash
# Option A: edit .env, change CHILL_ERP_IMAGE tag to the new version
nano /opt/stacks/chill-coffee-erp/.env

# Dockge UI → chill-coffee-erp → "Pull & Recreate"
```

Or for a rolling deploy with `:latest`:

```bash
# Dockge UI → chill-coffee-erp → "Pull" → "Recreate"
```

Only the `app` container restarts; Supabase containers stay up.

## Rollback

```bash
# Edit .env: revert CHILL_ERP_IMAGE to the last known good tag
nano /opt/stacks/chill-coffee-erp/.env

# Dockge UI → "Pull & Recreate"
```

If the bad release also ran a destructive DB migration, restore the most
recent `.sql` backup via App Settings → Backup → "Restore from file"
(you DID download a backup before updating, right?).

## Backups

- **Manual**: App → Settings → Backup → "Download now". Saves a `.sql` to
  `volumes/backups/` on the server AND triggers a browser download.
- **Recommended cadence**: nightly via cron job on the mini-PC OS (NOT a
  stack container — out of scope of this stack):

```cron
0 2 * * * docker exec chill-app sh -c "curl -fsS -X POST -H 'Authorization: Bearer $CRON_SECRET' http://localhost:3000/api/backup/full" >> /var/log/chill-backup.log 2>&1
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `chill-app` keeps restarting | Placeholders not replaced — image was built without placeholder build-args | Re-pull the latest release tag; confirm release.yml ran |
| Browser shows "Failed to fetch" on Supabase calls | `NEXT_PUBLIC_SUPABASE_URL` mismatch with reverse proxy | Check `.env`, recreate `app` container |
| `chill-db` exits with `Permission denied on /var/lib/postgresql/data` | Postgres UID 70 can't write to bind-mount | `sudo chown -R 70:70 volumes/db/data` |
| Kong healthcheck never passes | `volumes/api/kong.yml` missing or stale | Re-run `deploy/dockge/sync-volumes.sh` from dev machine and re-rsync |
| Dockge "Pull" doesn't find image | GHCR package is private + no docker login | Step 6 of first-time setup |
````

- [ ] **Step 2: Commit**

```bash
git add deploy/dockge/README.md
git commit -m "docs(deploy): add Dockge stack deploy README"
```

---

## Phase 5: GitHub Actions release workflow

### Task 8: Add .github/workflows/release.yml

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: release

on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        description: 'Tag to rebuild (e.g. v4.0.1). Leave empty to build from current commit as :dev-<sha>.'
        required: false

permissions:
  contents: read
  packages: write

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-push:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          ref: ${{ github.event.inputs.tag || github.ref }}

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Derive image metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=tag
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest,enable={{is_default_branch}}
            type=sha,prefix=dev-,enable=${{ github.event_name == 'workflow_dispatch' && github.event.inputs.tag == '' }}

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile
          platforms: linux/amd64
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            NEXT_PUBLIC_SUPABASE_URL=__SUPABASE_URL_PLACEHOLDER__
            NEXT_PUBLIC_SUPABASE_ANON_KEY=__SUPABASE_ANON_KEY_PLACEHOLDER__
            NEXT_PUBLIC_APP_URL=__APP_URL_PLACEHOLDER__

      - name: Smoke-test the pushed image
        run: |
          IMAGE_TAG=$(echo "${{ steps.meta.outputs.tags }}" | head -1)
          docker pull "$IMAGE_TAG"
          # Verify placeholders are present
          if ! docker run --rm --entrypoint sh "$IMAGE_TAG" \
               -c "grep -rq __SUPABASE_URL_PLACEHOLDER__ /app/.next"; then
            echo "::error::SUPABASE_URL placeholder missing from built image"
            exit 1
          fi
          # Verify entrypoint can replace them
          docker run --rm \
            -e NEXT_PUBLIC_SUPABASE_URL=https://test.local \
            -e NEXT_PUBLIC_SUPABASE_ANON_KEY=test \
            -e NEXT_PUBLIC_APP_URL=https://test.local \
            --entrypoint sh "$IMAGE_TAG" \
            -c "/app/docker-entrypoint.sh true && grep -lq test.local /app/.next/static/chunks/*.js || (echo 'replacement failed'; exit 1)"
          echo "Smoke test passed for $IMAGE_TAG"
```

- [ ] **Step 2: Validate workflow YAML locally**

If `actionlint` is installed:

```bash
actionlint .github/workflows/release.yml
```

Otherwise sanity-check with:

```bash
python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))" && echo "YAML OK"
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): add release workflow that builds + pushes to GHCR on tag"
```

- [ ] **Step 4: Document GHCR setup steps (one-time, manual)**

These are NOT code changes — they go in the task notes for the implementer to communicate to the user.

1. After the first tag push, navigate to `https://github.com/<owner>/<repo>/pkgs/container/chill-coffee-erp`
2. Click "Package settings" → "Change visibility" → choose Public (no auth on pull) or keep Private (requires PAT on the mini-PC)
3. If choosing Private, link the package to the repo so the workflow's `GITHUB_TOKEN` retains write access:
   "Manage Actions access" → "Add repository" → select the source repo with role "Write"

---

## Phase 6: End-to-end local validation

### Task 9: Local dry-run of the full deploy

**Files:** none (verification only)

- [ ] **Step 1: Build the image as the workflow would**

```bash
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=__SUPABASE_URL_PLACEHOLDER__ \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=__SUPABASE_ANON_KEY_PLACEHOLDER__ \
  --build-arg NEXT_PUBLIC_APP_URL=__APP_URL_PLACEHOLDER__ \
  -t ghcr.io/local/chill-coffee-erp:dev \
  .
```

Expected: succeeds in ~3-5 min.

- [ ] **Step 2: Prepare a temp Dockge-style stack folder**

```bash
TMPSTACK=$(mktemp -d)
cp -r deploy/dockge/* "$TMPSTACK/"
cp deploy/dockge/.gitignore "$TMPSTACK/"
cd "$TMPSTACK"

# Generate Supabase keys
bash /path/to/repo/supabase/utils/generate-keys.sh > /tmp/keys.txt
cat /tmp/keys.txt   # copy values into .env in next step

cp .env.example .env
# Edit .env: paste secrets, set CHILL_ERP_IMAGE=ghcr.io/local/chill-coffee-erp:dev,
# set NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000,
# set NEXT_PUBLIC_APP_URL=http://localhost:3009, etc.
nano .env

# Set Postgres data dir permissions
mkdir -p volumes/db/data
sudo chown -R 70:70 volumes/db/data
```

- [ ] **Step 3: Bring the stack up**

```bash
docker compose -f compose.yaml --env-file .env up -d
```

Expected: ~14 containers start. Some take 60s to pass healthchecks.

- [ ] **Step 4: Verify all containers are healthy**

```bash
sleep 90
docker ps --filter "label=com.docker.compose.project=chill-coffee-erp" \
  --format 'table {{.Names}}\t{{.Status}}'
```

Expected: every line shows `Up X minutes (healthy)`. If any shows `unhealthy`:

```bash
docker logs <unhealthy-container-name> --tail 50
```

Investigate and fix before continuing.

- [ ] **Step 5: Initialize schema + seed**

```bash
docker exec -it chill-app sh -c "npm run db:init && npm run db:seed"
```

Expected: exits 0 with no errors. Roughly 60s.

- [ ] **Step 6: Smoke test app + Supabase**

```bash
curl -fsS http://localhost:3009/ -o /dev/null -w "App: %{http_code}\n"
curl -fsS http://localhost:8000/auth/v1/health -o /dev/null -w "Kong→Auth: %{http_code}\n"
```

Expected:
```
App: 200
Kong→Auth: 200
```

- [ ] **Step 7: Verify placeholder replacement happened in the running container**

```bash
docker exec chill-app sh -c "grep -rl __SUPABASE_URL_PLACEHOLDER__ /app/.next 2>/dev/null | wc -l"
```

Expected: `0` (no remaining placeholders).

```bash
docker exec chill-app sh -c "grep -rl localhost:8000 /app/.next/static/chunks 2>/dev/null | head -3"
```

Expected: at least one chunk file path printed.

- [ ] **Step 8: Verify backup flow works**

```bash
curl -fsS -X POST -H "Authorization: Bearer $(grep ^CRON_SECRET .env | cut -d= -f2)" \
  http://localhost:3009/api/backup/full -o /tmp/backup.sql

ls -lh /tmp/backup.sql
head -20 /tmp/backup.sql
```

Expected: non-empty file starting with `-- PostgreSQL database dump`.

- [ ] **Step 9: Tear down and clean up**

```bash
cd "$TMPSTACK"
docker compose -f compose.yaml --env-file .env down -v
sudo rm -rf "$TMPSTACK"
docker rmi ghcr.io/local/chill-coffee-erp:dev
```

- [ ] **Step 10: No code changes to commit — verification complete**

If all steps passed, the deploy stack is production-ready. The user can:
1. Push a real version tag (`git tag v4.0.1 && git push --tags`) to trigger the workflow
2. Follow `deploy/dockge/README.md` on the mini-PC

---

## Final commit + handoff

### Task 10: Update root CHANGELOG (if present) or skip

**Files:**
- Possibly modify: `CHANGELOG.md` (root)

- [ ] **Step 1: Check if a CHANGELOG exists**

```bash
ls CHANGELOG.md 2>/dev/null || echo "No root CHANGELOG.md — skipping"
```

If absent: skip remaining steps of this task.

- [ ] **Step 2: If present, prepend the release entry**

Add at the top of `CHANGELOG.md`:

```markdown
## [Unreleased]

### Added
- On-prem Dockge deploy stack at `deploy/dockge/` (compose + env template + README)
- Runtime `NEXT_PUBLIC_*` placeholder injection via `docker-entrypoint.sh`
- GHCR release pipeline at `.github/workflows/release.yml` triggered by `v*` tags

### Changed
- `Dockerfile` now uses `ENTRYPOINT` to run `docker-entrypoint.sh` before `node server.js`
```

- [ ] **Step 3: Commit if changed**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for on-prem Dockge deploy"
```

---

## Self-review checklist

Before declaring the plan implemented:

- [ ] All 10 tasks above marked complete
- [ ] `git log` shows ~9 commits (one per non-verification task)
- [ ] `bash tests/entrypoint/test-replacement.sh` exits 0
- [ ] `docker compose -f deploy/dockge/compose.yaml --env-file deploy/dockge/.env config` exits 0 (with a populated .env)
- [ ] `python -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"` exits 0
- [ ] `deploy/dockge/sync-volumes.sh` runs without error and produces expected files
- [ ] Phase 6 end-to-end test passed
