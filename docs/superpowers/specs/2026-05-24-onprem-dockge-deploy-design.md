# On-prem Deploy via Dockge — Design

**Status:** Draft
**Date:** 2026-05-24
**Author:** brainstorming session with user
**Target:** Chill Coffee ERP v4 deployment to on-premise mini-PC managed by Dockge

---

## 1. Goal & Scope

Stand up a production deployment of Chill Coffee ERP v4 (Next.js 15 app + self-hosted Supabase stack) on a single on-premise mini-PC at a coffee shop, managed via the [Dockge](https://dockge.kuma.pet/) UI.

### In scope
- GitHub Actions workflow that builds the app Docker image and pushes to GHCR on tag push
- Production Docker Compose stack (`deploy/dockge/compose.yaml`) that pulls the pre-built image and runs the full Supabase stack alongside
- Single consolidated `.env` template for the production stack
- Runtime env injection for `NEXT_PUBLIC_*` so one image works for many deployments
- Step-by-step deploy + verify + rollback documentation

### Out of scope
- Reverse proxy / TLS termination (user handles externally — Caddy, Nginx, Cloudflare Tunnel, etc.)
- Port forwarding / NAT configuration on the router (user handles)
- Automated DB backup (cron sidecar) — user uses the existing in-app Settings → Backup UI manually
- Data migration from a v2.x instance — server starts fresh with `db:init` + `db:seed`
- Monitoring / alerting (Grafana, Uptime Kuma)
- Multi-tenant support — one stack instance per shop

---

## 2. Architecture

### Two independent flows

**Flow 1 — Release** (runs on GitHub Actions, triggered by tag push)

```
git tag v4.0.1 ──► git push --tags
      │
      ▼
.github/workflows/release.yml
      │
      ▼
docker buildx build (multi-stage Dockerfile, amd64)
      │
      ▼
push ghcr.io/<owner>/chill-coffee-erp:v4.0.1
push ghcr.io/<owner>/chill-coffee-erp:4.0
push ghcr.io/<owner>/chill-coffee-erp:latest
```

**Flow 2 — Deploy** (runs on mini-PC via Dockge UI)

```
/opt/stacks/chill-coffee-erp/
├── compose.yaml          ◄── Dockge reads this
├── .env                  ◄── secrets (Postgres, JWT, app)
├── volumes/
│   ├── api/kong.yml      ◄── Kong route config (static)
│   ├── api/kong-entrypoint.sh
│   ├── db/               ◄── Postgres init SQLs (committed)
│   │   ├── realtime.sql
│   │   ├── webhooks.sql
│   │   └── ... (copied from supabase/volumes/db/)
│   ├── db/data/          ◄── Postgres data (runtime, gitignored)
│   ├── storage/          ◄── file uploads (runtime, gitignored)
│   ├── backups/          ◄── pg_dump output from in-app Settings (runtime)
│   ├── snippets/         ◄── Studio SQL snippets (runtime)
│   └── functions/        ◄── Edge functions (runtime)

Dockge UI → "Pull & Deploy"
       │
       ▼
docker compose pull       ◄── kéo app image mới từ GHCR
docker compose up -d      ◄── recreate containers
       │
       ▼
Exposed host ports (configurable via .env):
├── ${APP_PORT}        (default 3009) → Next.js app
├── ${KONG_HTTP_PORT}  (default 8000) → Supabase API gateway
└── ${KONG_HTTPS_PORT} (default 8443) → Kong HTTPS (usually unused)
```

### Why separate `deploy/dockge/` directory instead of editing root compose

The root `docker-compose.yml` uses `build: .` for the app and `include: supabase/...` for the Supabase stack. It targets local development where source code is present.

The Dockge deploy uses `image: ghcr.io/...` instead of `build:`, and benefits from a single self-contained folder (Dockge convention: one stack = one folder, with compose + .env + volumes side by side).

Rather than overload the root compose with conditional logic, we add `deploy/dockge/compose.yaml` as a parallel artifact. The user clones the repo on the dev machine, copies the `deploy/dockge/` folder to `/opt/stacks/chill-coffee-erp/` on the server, and only ships what production needs.

**Trade-off accepted:** Some static config files (`kong.yml`, init SQLs) are duplicated between `supabase/volumes/` and `deploy/dockge/volumes/`. Justified because:
- These files change rarely
- The implementation plan will include a `deploy/dockge/sync-volumes.sh` helper to rsync when they do change
- The UX gain (clean Dockge stack folder, no clone needed on server) outweighs the duplication cost

---

## 3. Components

### 3.1 New files

| File | Purpose |
|---|---|
| `.github/workflows/release.yml` | Build app image on `v*` tag push, push to GHCR with semver + `latest` tags |
| `docker-entrypoint.sh` | Runtime sed replacement of `NEXT_PUBLIC_*` placeholders in `.next/standalone/` before starting server |
| `deploy/dockge/compose.yaml` | Production Docker Compose — app uses `image:` from GHCR, Supabase stack inlined |
| `deploy/dockge/.env.example` | Consolidated env template: App section + Supabase section, with inline comments |
| `deploy/dockge/.gitignore` | Ignore `volumes/db/data/`, `volumes/storage/`, `volumes/backups/`, `.env` |
| `deploy/dockge/README.md` | 8-step deploy guide, port table, verify checklist, rollback procedure |
| `deploy/dockge/sync-volumes.sh` | Helper to rsync `supabase/volumes/{api,db}` static configs into `deploy/dockge/volumes/` when source changes |
| `deploy/dockge/volumes/api/kong.yml` | Copy of `supabase/volumes/api/kong.yml` (committed) |
| `deploy/dockge/volumes/api/kong-entrypoint.sh` | Copy of `supabase/volumes/api/kong-entrypoint.sh` (committed) |
| `deploy/dockge/volumes/db/*.sql` | Copy of Postgres init scripts from `supabase/volumes/db/` (committed) |

### 3.2 Files modified

| File | Change |
|---|---|
| `Dockerfile` | Add `COPY docker-entrypoint.sh /app/docker-entrypoint.sh` + `RUN chmod +x` + change `CMD` to `ENTRYPOINT ["/app/docker-entrypoint.sh"]` with `CMD ["node", "server.js"]` |

### 3.3 Files explicitly NOT modified

- `next.config.mjs` — already has `output: 'standalone'`, no change needed
- `docker-compose.yml` (root) — remains the dev/local-build flow, unchanged
- `supabase/docker-compose.yml` and `supabase/volumes/**` — remain the source of truth; `deploy/dockge/volumes/` is a tracked copy

---

## 4. Key Design Decisions

### 4.1 Registry: GHCR (GitHub Container Registry)

- Repo is already on GitHub → no extra account/auth setup
- Free for public images, generous free tier for private
- Built-in `GITHUB_TOKEN` in Actions has `packages:write` scope
- Server can pull public images without authentication; private requires a Personal Access Token with `read:packages`

### 4.2 `NEXT_PUBLIC_*` runtime injection via placeholder + sed

**Problem:** Next.js inlines `NEXT_PUBLIC_*` env values into the JS bundle at `npm run build` time. Setting real values at build time locks the image to one Supabase instance / one domain.

**Solution:**
1. Build image with build-args set to stable placeholder strings:
   - `NEXT_PUBLIC_SUPABASE_URL=__SUPABASE_URL_PLACEHOLDER__`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY=__SUPABASE_ANON_KEY_PLACEHOLDER__`
   - `NEXT_PUBLIC_APP_URL=__APP_URL_PLACEHOLDER__`
2. At container start, `docker-entrypoint.sh` walks `.next/standalone/.next/{static,server}` and runs `sed` to replace each placeholder with the current `$NEXT_PUBLIC_*` env value.
3. Then `exec node server.js`.

This is the pattern used by self-hosted Next.js projects like Cal.com, BoxyHQ, Plane.

**Alternatives rejected:**
- Hardcode at build → must rebuild for every domain change
- Server Actions / API route proxy → adds latency, more code
- `runtimeConfig` from `next.config.mjs` → deprecated since Next 13, doesn't work with App Router

### 4.3 Semver tag-driven releases

- Trigger: `git push --tags` for any tag matching `v*` (e.g. `v4.0.1`, `v4.1.0-beta.1`)
- `package.json` `version` field stays synchronized with git tags
- `docker/metadata-action` derives three pushed tags from one git tag: full semver, major.minor, `latest`
- Manual `workflow_dispatch` is also enabled for re-building the same tag if needed

### 4.4 Configurable host ports

The user's mini-PC may have port conflicts. All host ports are env-driven, never hardcoded in `compose.yaml`:

| Env var | Default | Compose mapping | Notes |
|---|---|---|---|
| `APP_PORT` | `3009` | `${APP_PORT}:3000` | Next.js app |
| `KONG_HTTP_PORT` | `8000` | `${KONG_HTTP_PORT}:8000` | Supabase API gateway |
| `KONG_HTTPS_PORT` | `8443` | commented out by default | TLS happens at user's reverse proxy; uncomment only if proxying Supabase directly without TLS termination upstream |

The user can change any of these in `.env`, run "Recreate" in Dockge, done. `NEXT_PUBLIC_SUPABASE_URL` (public URL after reverse proxy) is independent of `KONG_HTTP_PORT` (internal host port) — the .env.example documents this clearly.

### 4.5 Single consolidated `.env` instead of two

Current dev setup has `.env` (app) and `supabase/.env` (Supabase stack). Dockge has one env editor per stack — two files would be confusing.

The production `.env` merges both, with clear section headers:
```
# ──────────────────────────────────────────────
# Section 1: App (Next.js)
# ──────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_APP_URL=...
INGEST_CLIENT_SECRET=...
CRON_SECRET=...
POSTGRES_BACKUP_URL=...

# ──────────────────────────────────────────────
# Section 2: Supabase stack
# ──────────────────────────────────────────────
POSTGRES_PASSWORD=...
JWT_SECRET=...
ANON_KEY=...
SERVICE_ROLE_KEY=...
DASHBOARD_USERNAME=...
DASHBOARD_PASSWORD=...
... (~30 more Supabase vars)
```

### 4.6 Port exposure — only what the reverse proxy needs

| Service | Internal port | Host port | Exposed publicly? |
|---|---|---|---|
| App (Next.js) | `3000` | `${APP_PORT}` | Yes — user reverse-proxies |
| Kong (Supabase API gateway) | `8000` | `${KONG_HTTP_PORT}` | Yes — user reverse-proxies |
| Kong HTTPS | `8443` | `${KONG_HTTPS_PORT}` (commented out by default) | Optional — only if user opts in |
| Studio (dashboard) | via Kong | — | Reached via Kong path `/project/default` (Kong basic auth) |
| Postgres | `5432` | not mapped | No — internal Docker network only |
| All other Supabase services | various | not mapped | No — internal only |

By default two host ports reach the network (`APP_PORT`, `KONG_HTTP_PORT`). Everything else stays inside the Docker `chill-coffee-erp_default` bridge.

---

## 5. Deploy Flow (first-time setup)

Assumes Dockge is already installed on the mini-PC, server has Docker + Docker Compose v2.23+, and the user has cloned the repo locally on their dev machine.

```
On dev machine:
1. bash supabase/utils/generate-keys.sh
   → outputs POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY,
     SECRET_KEY_BASE, VAULT_ENC_KEY, LOGFLARE_PUBLIC_ACCESS_TOKEN,
     LOGFLARE_PRIVATE_ACCESS_TOKEN, DASHBOARD_PASSWORD

2. cd deploy/dockge
   cp .env.example .env.production
   # fill .env.production with the generated keys + domain values

3. scp -r deploy/dockge/ user@mini-pc:/opt/stacks/chill-coffee-erp/
   scp .env.production user@mini-pc:/opt/stacks/chill-coffee-erp/.env

On mini-PC:
4. (If image is private) docker login ghcr.io -u <github-user>
   # use a PAT with read:packages scope

5. Open Dockge UI → "Add Stack" → name: chill-coffee-erp
   → Dockge detects /opt/stacks/chill-coffee-erp/compose.yaml
   → click "Deploy"
   → wait ~2 min for healthchecks to pass on all containers

6. Initialize schema + seed (one-time):
   docker exec -it chill-app sh -c "npm run db:init && npm run db:seed"

7. Smoke test:
   curl -fsS http://localhost:${APP_PORT}/        → 200
   curl -fsS http://localhost:${KONG_HTTP_PORT}/  → Kong response
   Open http://<server-ip>:${APP_PORT} in a LAN browser
     → Chill ERP login screen renders

8. Configure your reverse proxy (out of scope of this stack):
     app.example.com      → 127.0.0.1:${APP_PORT}
     supabase.example.com → 127.0.0.1:${KONG_HTTP_PORT}
```

## 6. Update Flow

```
On dev machine:
1. Make changes, bump package.json version, commit
2. git tag v4.0.2 && git push --tags
3. Watch GitHub Actions: release.yml runs ~5 min, pushes
   ghcr.io/<owner>/chill-coffee-erp:v4.0.2 and :latest

On mini-PC:
4. Dockge UI → chill-coffee-erp stack → "Pull" → "Recreate"
   → kéo image mới, recreate app container only
   → Supabase containers untouched (no version drift)
5. Verify: docker logs chill-app  +  open the app
```

## 7. Rollback Procedure

If the new release breaks production:

```
Option A — Roll back image only (no DB schema change):
1. Dockge UI → Edit compose.yaml
2. Change app service image tag from :latest to :v4.0.1 (previous good tag)
3. Save → "Pull & Recreate"

Option B — Roll back image + DB (if migration was incompatible):
1. Roll back image as in Option A
2. App Settings → Backup → "Restore from file" → upload pre-update .sql backup
   (relies on user having pulled a backup before the update — documented in README)
```

---

## 8. Verification

### 8.1 Post-deploy checklist

- [ ] `docker ps` shows all stack containers with status `(healthy)` (13 Supabase services + 1 app = 14 containers)
- [ ] `curl -fsS http://localhost:${APP_PORT}/` returns 200
- [ ] Login with seeded admin account succeeds, Dashboard renders
- [ ] Create a test inventory item → appears in list
- [ ] Settings → Backup → "Download now" → `.sql` file downloads, opens with `psql --dry-run`
- [ ] `docker compose restart` → app and DB come back up, data persists
- [ ] Stop the stack via Dockge → restart → all containers healthy within 90s

### 8.2 Release workflow verification (one-time)

- [ ] Push test tag `v4.0.0-rc.1` → workflow runs without errors
- [ ] Image appears at `https://github.com/<owner>/chill-coffee-erp/pkgs/container/chill-coffee-erp`
- [ ] On a clean test server: `docker pull ghcr.io/<owner>/chill-coffee-erp:v4.0.0-rc.1` succeeds
- [ ] `docker run` the image with `NEXT_PUBLIC_*` env vars → app starts, placeholders are replaced
- [ ] `docker exec chill-app grep __SUPABASE_URL_PLACEHOLDER__ /app/.next` returns nothing (verification that sed worked)

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| sed placeholder replacement misses a chunk file → app breaks | Low | High | Entrypoint script logs replacement counts; verify in 8.2 above. If detected, regenerate placeholder with a longer unique prefix. |
| GHCR rate-limit on free tier blocks Dockge pull | Low | Med | Switch image to public, or supply PAT to Dockge's registry config. |
| Static config files (kong.yml, init SQLs) drift between `supabase/volumes/` and `deploy/dockge/volumes/` | Med | Med | `sync-volumes.sh` helper + CI lint job (future) that fails if checksums differ. |
| Postgres data volume permissions wrong → first start fails on bind-mounted dir | Med | High | README explicitly: `chown -R 70:70 volumes/db/data` before first deploy (Supabase Postgres image runs as UID 70). |
| User loses `.env` → impossible to decrypt existing backups | Med | High | README instructs: back up `.env` separately (1Password, password manager) before first deploy. |
| Tag pushed to a branch other than main accidentally triggers release | Low | Med | Workflow checks `github.ref` starts with `refs/tags/v` — tags are namespaced, branches don't fire it. |

---

## 10. Open Questions

None. All decisions resolved during brainstorming (see decision points 4.1–4.6).

---

## 11. Next Step

Hand off to the `writing-plans` skill to produce a detailed implementation plan covering:
- Exact `release.yml` YAML
- Exact `compose.yaml` content (with all 13 Supabase services inlined: studio, kong, auth, rest, realtime, storage, imgproxy, meta, functions, analytics, db, vector, supavisor — image tags pinned to current `supabase/docker-compose.yml` versions)
- `docker-entrypoint.sh` script with sed paths
- `.env.example` with every variable + comment
- `README.md` with copy-paste-ready commands
- File-by-file checklist for the implementer
