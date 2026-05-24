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
- `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `SITE_URL` — usually same as the URLs above (interpolated from `NEXT_PUBLIC_*` by default)
- All Section 3 secrets (paste from step 1)
- `CRON_SECRET` — `openssl rand -hex 32` (or leave empty to disable cron)
- `INGEST_CLIENT_SECRET` — `openssl rand -hex 32`. The `migrator` container will hash + insert this into `integration_clients` automatically during seed.
- `CHILL_ERP_IMAGE` — replace `REPLACE_WITH_GITHUB_OWNER` with your GitHub username/org; pin to a release tag like `:v4.0.0`
- **Section 12 — `OWNER_EMAIL` + `OWNER_PASSWORD`**: the first owner account the migrator will auto-create. Password >= 8 chars. After first successful deploy you can clear these (migrator will skip seed once an owner exists).

Note: `POSTGRES_BACKUP_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are constructed automatically inside `compose.yaml` from the values you paste into Section 3 — do not set them in `.env`.

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

- **Manual**: App → Settings → Backup → "Download now". Saves a `.sql` to
  `volumes/backups/` on the server AND triggers a browser download.
- **Recommended cadence**: nightly via cron job on the mini-PC OS (NOT a
  stack container — out of scope of this stack). **Important:** cron does
  not source `.env`, so paste the literal `CRON_SECRET` value from your
  `.env` into the line below (replace `<your-cron-secret>`):

```cron
0 2 * * * docker exec chill-app sh -c "curl -fsS -X POST -H 'Authorization: Bearer <your-cron-secret>' http://localhost:3000/api/backup/full" >> /var/log/chill-backup.log 2>&1
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `chill-app` keeps restarting | Placeholders not replaced — image was built without placeholder build-args | Re-pull the latest release tag; confirm release.yml ran |
| Browser shows "Failed to fetch" on Supabase calls | `NEXT_PUBLIC_SUPABASE_URL` mismatch with reverse proxy | Check `.env`, recreate `app` container |
| `chill-db` exits with `Permission denied on /var/lib/postgresql/data` | Postgres UID 70 can't write to bind-mount | `sudo chown -R 70:70 volumes/db/data` |
| Kong healthcheck never passes | `volumes/api/kong.yml` missing or stale | Re-run `deploy/dockge/sync-volumes.sh` from dev machine and re-rsync |
| Dockge "Pull" doesn't find image | GHCR package is private + no docker login | Step 6 of first-time setup |
| `docker compose config` errors with `ANON_KEY is missing` | Section 3 secrets not pasted into `.env` | Edit `.env`, paste values from `generate-keys.sh` |
| `supabase-vector` keeps restarting with "Configuration error" | `volumes/logs/vector.yml` missing or invalid | Re-run `deploy/dockge/sync-volumes.sh` from dev machine; if the stub doesn't work for your needs, copy the official `vector.yml` from https://github.com/supabase/supabase/tree/master/docker/volumes/logs |
| `supabase-pooler` keeps restarting with "cat: pooler.exs: Is a directory" | `volumes/pooler/pooler.exs` missing | Same as above; copy official `pooler.exs` if needed |
| `supabase-edge-functions` keeps restarting with "could not find an appropriate entrypoint" | `volumes/functions/main/index.ts` missing | Re-run `deploy/dockge/sync-volumes.sh` |
| `chill-migrator` exits with non-zero status, `chill-app` never starts | Migration SQL failed (bad migration file) or seed step failed (Auth API unreachable, bad OWNER_PASSWORD) | Check `docker logs chill-migrator` in Dockge. Common causes: (a) new migration has syntax error → fix and re-push image; (b) `kong` not healthy yet → wait/restart migrator only; (c) `OWNER_PASSWORD` < 8 chars → fix `.env` and recreate migrator |
| Migrator runs every restart and that's wasteful | Working as intended — but step is fast (~5s if no new migrations) and provides safety on every deploy | If you really want to skip it once, `docker compose up -d --no-deps app` (skips deps including migrator). NOT recommended. |
| Container name conflict like `Conflict. The container name "/supabase-db" is already in use` | Another Supabase stack on the same Docker daemon already uses these names | Set `STACK_NAMESPACE=quan2-` (note trailing hyphen) in `.env` to prefix all container names. Default is empty = keep original names. |
