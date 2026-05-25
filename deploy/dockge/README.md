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

## DATA LOSS PREVENTION (read this first)

PostgreSQL data lives in a Docker **external named volume**, NOT a bind mount.
This is on purpose: external volumes survive every normal compose/Dockge
operation (down, up, recreate, build, prune-while-in-use, even "Delete
stack folder" in the Dockge UI) and can only be removed with an explicit
`docker volume rm`.

### DO

- ✅ `docker volume create chill-erp-db-data && docker volume create chill-erp-db-backups` **once** before first deploy (see "First-time volume setup" below).
- ✅ Set `CHILL_REQUIRE_EXISTING_DATA=1` in `.env` after the first successful deploy. The init-guard script will then refuse to bootstrap an empty PGDATA — converts silent data loss into a loud failure.
- ✅ Download a fresh backup via App → Settings → Backup → "Download now" before ANY change to `CHILL_ERP_IMAGE`.
- ✅ Verify backups periodically: `docker run --rm -v chill-erp-db-backups:/b postgres:15-alpine pg_restore --list /b/db-LATEST.dump | head`.

### DO NOT

- ❌ `docker volume rm chill-erp-db-data` or `chill-erp-db-backups` — these hold all customer data. There is no undo.
- ❌ `docker system prune --volumes` while the stack is stopped — `prune` removes external volumes that have no attached container.
- ❌ Change `CHILL_ERP_IMAGE` to a Postgres tag with a different major version (e.g. 15 → 17) without first running `pg_upgrade`. The existing PG_VERSION mismatch will cause Postgres to refuse to start, and the temptation to "fix" it by deleting the data dir is a one-way trip. See `supabase/utils/upgrade-pg17.sh`.
- ❌ Trigger `/api/backup/restore` with a file you haven't validated. The endpoint drops the public schema before restoring; a bad file means partial loss.
- ❌ Run `supabase/reset.sh` on production. It is a dev-machine script that explicitly wipes volumes.
- ❌ Run the compose file from a directory other than `/opt/stacks/chill-coffee-erp/`. Relative paths in the compose file resolve against CWD.

### Recovery

If something goes wrong: see the "Recovery runbook — empty PGDATA detected"
section at the bottom of this README.

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
- `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL` — usually same as the URLs above (interpolated from `NEXT_PUBLIC_*` by default)
- All Section 3 secrets (paste from step 1)
- `CRON_SECRET` — `openssl rand -hex 32` (or leave empty to disable cron)
- `INGEST_CLIENT_SECRET` — `openssl rand -hex 32`. The `migrator` container will hash + insert this into `integration_clients` automatically during seed.
- `CHILL_ERP_IMAGE` — replace `REPLACE_WITH_GITHUB_OWNER` with your GitHub username/org; pin to a release tag like `:v4.0.0`
- **Section 12 — `OWNER_EMAIL` + `OWNER_PASSWORD`**: the first owner account the migrator will auto-create. Password >= 8 chars. After first successful deploy you can clear these (migrator will skip seed once an owner exists).

Note: `POSTGRES_BACKUP_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are constructed automatically inside `compose.yaml` from the values you paste into Section 3 — do not set them in `.env`.

### 5. Create the external named volumes (one-time)

PGDATA and pg_dump backups live in Docker-managed external volumes — NOT host
directories — so accidental folder deletion or `down -v` cannot wipe them.

```bash
docker volume create chill-erp-db-data
docker volume create chill-erp-db-backups
docker volume ls | grep chill-erp     # both should be listed
```

Skip this and the first `docker compose up` will fail with
`network chill-coffee-erp_default Created ... external volume "chill-erp-db-data" not found`.

The Postgres image initializes the volume with UID 70 ownership automatically
on first start — no manual chown needed (named volumes have no host-side
permissions step).

> **Already have a running stack with data in `volumes/db/data/`?** Don't
> recreate yet. Skip to the
> "Migrating an existing installation (bind mount → named volume)" section
> below for the safe one-shot migration commands.

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
6. Wait ~3 minutes:
   - ~30s for Postgres + Kong + Auth + Studio to reach healthy
   - The `chill-migrator` container auto-runs, applies schema + migrations,
     creates the owner account, exits 0 (you can watch its logs in Dockge)
   - The `chill-app` container starts ONLY after migrator succeeds
   - All 14 services Up + 1 Exited(0) when done

No SSH, no manual `npm` commands, no repo clone on the server. The image
ships `scripts/` + `database/` baked in; the `migrator` service runs them
inside the Docker network.

### 8. Smoke test

```bash
curl -fsS http://localhost:${APP_PORT:-3009}/        # 200 OK
curl -fsS http://localhost:${KONG_HTTP_PORT:-8000}/  # Kong response (HTTP 404 is fine — root has no route)

# On a LAN device:
xdg-open http://<server-ip>:${APP_PORT:-3009}        # Chill ERP login screen
```

### 9. Configure your reverse proxy

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

On every recreate, the `chill-migrator` container runs again first, applies
any new `database/migrations/*.sql` files baked into the image, then exits 0
and lets `chill-app` start with the up-to-date schema. Idempotent — re-running
against an already-migrated DB is a no-op. Supabase containers (Postgres,
Kong, Auth, ...) stay running across updates.

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

There are three backup paths, in order of automation:

### Automatic — `backup-cron` sidecar (recommended, default)

The `chill-backup-cron` service in this stack runs `pg_dump -Fc` daily into
the `chill-erp-db-backups` external volume, alongside a tarball of `db-config`
(pgsodium decryption key). Configure via `.env`:

- `BACKUP_TIME_UTC=02:00` — UTC time of the daily run (default 02:00 UTC = 09:00 ICT)
- `BACKUP_RETENTION_DAYS=14` — files older than this are pruned automatically
- `RUN_INITIAL_BACKUP=1` — also run one backup immediately on container start

Inspect backups:

```bash
docker run --rm -v chill-erp-db-backups:/b alpine ls -lh /b/
docker logs chill-backup-cron --tail 50
```

Verify a backup is restorable (does not modify anything):

```bash
docker run --rm -v chill-erp-db-backups:/b postgres:15-alpine \
  pg_restore --list "/b/$(docker run --rm -v chill-erp-db-backups:/b alpine sh -c 'ls -t /b/db-*.dump | head -1' | xargs basename)" | head
```

### Manual — App UI

App → Settings → Backup → "Download now". Streams `pg_dump --schema=public`
to your browser AND records a row in `backup_runs`. Use this before any risky
operation (image bump, schema migration).

### Off-host (your responsibility, out of scope of this stack)

The two paths above keep backups on the same Docker host as the DB — that's
defense for app-level mistakes but NOT for disk loss, host theft, or
`docker volume rm chill-erp-db-backups`. Set up a host-level `rsync` /
`rclone` / `restic` job that copies `/var/lib/docker/volumes/chill-erp-db-backups/_data/`
to another machine or S3 bucket. Example crontab (replace placeholder):

```cron
30 2 * * * rsync -a --delete /var/lib/docker/volumes/chill-erp-db-backups/_data/ user@offsite:/backups/chill/
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `chill-app` keeps restarting | Placeholders not replaced — image was built without placeholder build-args | Re-pull the latest release tag; confirm release.yml ran |
| Browser shows "Failed to fetch" on Supabase calls | `NEXT_PUBLIC_SUPABASE_URL` mismatch with reverse proxy | Check `.env`, recreate `app` container |
| `chill-db` exits with `external volume "chill-erp-db-data" not found` | The one-time `docker volume create` step was skipped | Run section "5. Create the external named volumes (one-time)" of First-time setup |
| `chill-db` exits with `[init-guard] FATAL: ... CHILL_REQUIRE_EXISTING_DATA=1 ... empty data directory` | Production guard refused to fresh-init an empty PGDATA — your data volume is missing or wiped | See "Recovery runbook — empty PGDATA detected" section below |
| Kong healthcheck never passes | `volumes/api/kong.yml` missing or stale | Re-run `deploy/dockge/sync-volumes.sh` from dev machine and re-rsync |
| Dockge "Pull" doesn't find image | GHCR package is private + no docker login | Step 6 of first-time setup |
| `docker compose config` errors with `ANON_KEY is missing` | Section 3 secrets not pasted into `.env` | Edit `.env`, paste values from `generate-keys.sh` |
| `supabase-vector` keeps restarting with "Configuration error" | `volumes/logs/vector.yml` missing or invalid | Re-run `deploy/dockge/sync-volumes.sh` from dev machine; if the stub doesn't work for your needs, copy the official `vector.yml` from https://github.com/supabase/supabase/tree/master/docker/volumes/logs |
| `supabase-pooler` keeps restarting with "cat: pooler.exs: Is a directory" | `volumes/pooler/pooler.exs` missing | Same as above; copy official `pooler.exs` if needed |
| `supabase-edge-functions` keeps restarting with "could not find an appropriate entrypoint" | `volumes/functions/main/index.ts` missing | Re-run `deploy/dockge/sync-volumes.sh` |
| `chill-migrator` exits with non-zero status, `chill-app` never starts | Migration SQL failed (bad migration file) or seed step failed (Auth API unreachable, bad OWNER_PASSWORD) | Check `docker logs chill-migrator` in Dockge. Common causes: (a) new migration has syntax error → fix and re-push image; (b) `kong` not healthy yet → wait/restart migrator only; (c) `OWNER_PASSWORD` < 8 chars → fix `.env` and recreate migrator |
| Migrator runs every restart and that's wasteful | Working as intended — but step is fast (~5s if no new migrations) and provides safety on every deploy | If you really want to skip it once, `docker compose up -d --no-deps app` (skips deps including migrator). NOT recommended. |
| Container name conflict like `Conflict. The container name "/supabase-db" is already in use` | Another Supabase stack on the same Docker daemon already uses these names | Set `STACK_NAMESPACE=quan2-` (note trailing hyphen) in `.env` to prefix all container names. Default is empty = keep original names. |
| `/api/kiotviet/sync` returns `Integration client không hợp lệ.` | Env `INGEST_CLIENT_SECRET` does not match the bcrypt hash in `public.integration_clients`. From v4.1.4+ the migrator verifies this at deploy and refuses to start the app if they drift, but rotated/restored databases predating v4.1.4 can still hit it. | Run `docker exec <stack>chill-app npm run kiotviet:check` for diagnostic + step-by-step remediation. Most often: `docker compose up -d --force-recreate migrator` re-seeds from the current `.env`. |
| App container won't start, migrator exits 1 with `integration_clients verify FAILED` | v4.1.4+ deploy-time guard caught a hash drift before the app saw it. `.env` and DB are out of sync. | Same fix: `npm run kiotviet:check` from the migrator container, or recreate migrator after fixing `.env`. |

### Container name reference (with STACK_NAMESPACE)

When `STACK_NAMESPACE=chill-erp-` is set in `.env`, every container name gains that prefix. Substitute as needed when copy-pasting diagnostic commands:

| Default name | With `STACK_NAMESPACE=chill-erp-` |
|---|---|
| `chill-app` | `chill-erp-chill-app` |
| `chill-migrator` | `chill-erp-chill-migrator` |
| `supabase-db` | `chill-erp-supabase-db` |
| `supabase-kong` | `chill-erp-supabase-kong` |
| ... | (same prefix on every container) |

Quick check: `docker ps --format '{{.Names}}' | grep -E 'chill|supabase'`.

## Migrating an existing installation (bind mount → named volume)

If you already have a stack running with PGDATA in `volumes/db/data/`, follow
this sequence to move the data into the new external named volume **without
losing anything**. Run from `/opt/stacks/chill-coffee-erp/` on the VPS. Stop
at any step that fails — do not push through errors.

```bash
cd /opt/stacks/chill-coffee-erp

# 0. Sanity-check you're in the right place and PGDATA looks healthy
ls -la volumes/db/data/PG_VERSION       # must exist, content "15"

# 1. App-level pg_dump backup FIRST (belt-and-suspenders).
#    If this fails, do not proceed — you have no rollback.
docker exec chill-app sh -c "curl -fsS -X POST \
  -H 'Authorization: Bearer $(grep ^CRON_SECRET= .env | cut -d= -f2)' \
  http://localhost:3000/api/backup/full" > ~/pre-migration-backup.sql
head -c 200 ~/pre-migration-backup.sql  # must begin with "-- PostgreSQL database dump"

# 2. Stop the stack cleanly (NEVER use -v here)
docker compose down

# 3. Create the external volumes
docker volume create chill-erp-db-data
docker volume create chill-erp-db-backups

# 4. Copy bind-mount → named volume, preserving UID 70 and xattrs
docker run --rm \
  -v "$(pwd)/volumes/db/data:/source:ro" \
  -v chill-erp-db-data:/dest \
  alpine:3 sh -c "cp -a /source/. /dest/ && ls -la /dest/PG_VERSION"

# 5. Sanity-check the new volume
docker run --rm -v chill-erp-db-data:/d alpine:3 \
  sh -c "stat -c '%U:%G %s' /d/PG_VERSION && du -sh /d"

# 6. Start the stack with the new compose
docker compose up -d

# 7. Verify data is present
docker logs chill-migrator --tail 50
docker exec supabase-db psql -U postgres -d postgres -c \
  "select count(*) from public.employees;"   # record this number

# 8. Archive the old bind-mount dir (don't delete yet)
sudo mv volumes/db/data "volumes/db/data.MIGRATED-$(date +%F)"

# 9. Prove the new defense works — recreate and re-verify
docker compose down
docker compose up -d
docker exec supabase-db psql -U postgres -d postgres -c \
  "select count(*) from public.employees;"   # must match step 7

# 10. Turn on the init-guard (production hardening)
grep -q '^CHILL_REQUIRE_EXISTING_DATA=' .env \
  && sed -i 's/^CHILL_REQUIRE_EXISTING_DATA=.*/CHILL_REQUIRE_EXISTING_DATA=1/' .env \
  || echo "CHILL_REQUIRE_EXISTING_DATA=1" >> .env
docker compose up -d --force-recreate db

# 11. After ~1 week of successful operation, delete the archive
sudo rm -rf volumes/db/data.MIGRATED-*
```

## Recovery runbook — empty PGDATA detected

Symptom: stack fails to start. `docker logs supabase-db --tail 30` shows:

```
================================================================================
FATAL: Postgres is about to initialize an EMPTY data directory, but
CHILL_REQUIRE_EXISTING_DATA=1 in .env means the operator expects EXISTING data.
...
```

This means the init-guard caught a silent re-init attempt. Your data is NOT
yet lost — Postgres refused to initialize. Investigate before bypassing.

### Step 1 — Diagnose what happened

```bash
docker volume inspect chill-erp-db-data
# Look at the Mountpoint and check if PG_VERSION exists:
docker run --rm -v chill-erp-db-data:/d alpine ls -la /d/
```

**If `PG_VERSION` and `base/` directories are present** → the volume has data
but Postgres still thinks it's empty (very rare — permission or corruption
issue). Run `docker compose down && docker volume inspect chill-erp-db-data`
and check ownership; the volume must be writable by UID 70.

**If the volume is empty or missing `PG_VERSION`** → continue to Step 2.

### Step 2 — Find the most recent backup

```bash
docker run --rm -v chill-erp-db-backups:/b alpine ls -lt /b/ | head
# OR if you also downloaded backups to your laptop:
ls -lt ~/chill-backups/
```

### Step 3 — Restore

You have two restore paths. Use the one that matches your backup format.

**Path A — pg_dump custom format (`.dump`) from backup-cron service:**

```bash
# Make sure the empty volume exists
docker volume create chill-erp-db-data 2>/dev/null || true

# Bring up only Postgres temporarily (with the guard turned off)
sed -i 's/^CHILL_REQUIRE_EXISTING_DATA=.*/CHILL_REQUIRE_EXISTING_DATA=0/' .env
docker compose up -d db
# wait for healthy
until docker exec supabase-db pg_isready -U postgres; do sleep 2; done

# Restore from the most recent .dump file
LATEST=$(docker run --rm -v chill-erp-db-backups:/b alpine sh -c \
  "ls -t /b/db-*.dump | head -1")
docker run --rm --network chill-coffee-erp_default \
  -v chill-erp-db-backups:/b \
  -e PGPASSWORD="$(grep ^POSTGRES_PASSWORD= .env | cut -d= -f2)" \
  postgres:15-alpine \
  pg_restore -h db -U postgres -d postgres --clean --if-exists "$LATEST"

# Re-arm the guard and bring up the whole stack
sed -i 's/^CHILL_REQUIRE_EXISTING_DATA=.*/CHILL_REQUIRE_EXISTING_DATA=1/' .env
docker compose up -d
```

**Path B — plain SQL (`.sql`) from in-app "Download now":**

```bash
# Start a fresh empty DB first (guard off)
sed -i 's/^CHILL_REQUIRE_EXISTING_DATA=.*/CHILL_REQUIRE_EXISTING_DATA=0/' .env
docker compose up -d

# Wait for chill-app to be healthy, then use the in-app restore endpoint
# (App → Settings → Backup → "Restore from file"), or:
curl -X POST \
  -H "Authorization: Bearer $(grep ^CRON_SECRET= .env | cut -d= -f2)" \
  --data-binary @~/your-backup.sql \
  http://localhost:${APP_PORT:-3009}/api/backup/restore

# Re-arm the guard
sed -i 's/^CHILL_REQUIRE_EXISTING_DATA=.*/CHILL_REQUIRE_EXISTING_DATA=1/' .env
docker compose up -d --force-recreate db
```

### Step 4 — Verify and post-mortem

```bash
docker exec supabase-db psql -U postgres -d postgres -c \
  "select count(*) from public.employees;"   # row counts present?

# Then figure out HOW the volume got wiped. Check the Dockge audit/event log,
# bash history for `docker volume rm`, and recent system logs for any
# `docker system prune` calls. The init-guard caught this one — close the
# operational gap that caused it.
```
