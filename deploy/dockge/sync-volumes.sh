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
