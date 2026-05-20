# Verify-Mirror Procedure (Phase 3A acceptance gate)

This procedure proves v4 dashboard / reports / pivot numbers match a
production-mirror dump of v3 data. Run it once at end of Phase 3A.

## When to run

- After Task 10 is committed.
- After v3 is closed for the day (no active writes — typically 23:00+).
- On a dev machine. Never on prod v3 host directly.

## Step 1 — Snapshot v3 (one-time)

On the host running v3 production:

```bash
# Replace v3-postgres with your actual v3 Postgres container name.
docker exec v3-postgres pg_dump \
  -U postgres -d postgres \
  --schema=public --schema=auth --schema=storage \
  --inserts --no-owner --no-privileges \
  -f /tmp/v3-mirror-$(date +%F).sql

docker cp v3-postgres:/tmp/v3-mirror-$(date +%F).sql \
  /path/to/Chill\ Coffee\ ERP/mirrors/

# Quick safety check — file must contain INSERT lines, not DROP DATABASE.
head -20 mirrors/v3-mirror-*.sql
grep -c '^INSERT' mirrors/v3-mirror-*.sql   # expect > 0
grep -i 'drop database' mirrors/v3-mirror-*.sql && echo "ABORT: DROP DATABASE present" && exit 1
```

## Step 2 — Restore into v4 dev

```bash
# Stop app so it can't write during restore.
docker compose stop chill-app

# Wipe + reapply schema.
docker compose exec db psql -U postgres -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Apply v4 migrations first (Phase 1 SQL).
npm run db:init

# Now load v3 data on top.
docker compose exec -T db psql -U postgres -d postgres \
  < mirrors/v3-mirror-$(date +%F).sql

# Bring app back.
docker compose start chill-app
```

## Step 3 — Verify

Pick a `business_date` that you know had real activity in v3 (e.g. yesterday).

```bash
# Get the service-role key from .env (root, gitignored).
SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY .env | cut -d= -f2)

node tools/verify-mirror.mjs --date 2026-05-19 --service-key "$SERVICE_KEY"
```

Expected: all 7 checks ✓.

If any check fails: investigate before tagging Phase 3A. Most likely
causes:
1. Timezone bug (a `business_date` filter compared a UTC date)
2. Ported RPC drifted from v3 — `diff database/002_functions.sql` between
   v3 and v4
3. Restore didn't include a needed table (check pg_dump scope)

## Step 4 — Smoke UI

After script passes, open `/login` → owner → switch business-date to the
verified date. Confirm:
- KpiBar numbers match script output.
- ReportsView shows real reports.
- PivotView shows real KiotViet orders.

## Step 5 — Tag and clean up

```bash
git tag v4-phase-3a
# Optionally delete the dump — it has real data.
rm mirrors/v3-mirror-$(date +%F).sql
```
