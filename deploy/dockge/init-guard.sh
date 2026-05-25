#!/bin/bash
# Mounted at /docker-entrypoint-initdb.d/00-guard.sh by deploy/dockge/compose.yaml.
# Postgres runs files in docker-entrypoint-initdb.d/ ONLY during first-time bootstrap
# (when PG_VERSION is missing). So if this script executes, we are about to create
# a fresh empty database.
#
# When CHILL_REQUIRE_EXISTING_DATA=1, the operator has declared that this stack
# should always have existing data. An empty PGDATA at this point means something
# wiped it (volume removed, pruned, version mismatch, wrong CWD). We refuse to
# proceed so the operator gets a loud, recoverable failure instead of a silent
# fresh DB.

set -e

if [ "${CHILL_REQUIRE_EXISTING_DATA:-0}" = "1" ]; then
  cat >&2 <<'EOF'
================================================================================
FATAL: Postgres is about to initialize an EMPTY data directory, but
CHILL_REQUIRE_EXISTING_DATA=1 in .env means the operator expects EXISTING data.

This usually means:
  - The 'chill-erp-db-data' named volume is missing or empty.
  - Someone ran 'docker volume rm chill-erp-db-data' or 'docker system prune --volumes'.
  - The major Postgres version changed and PG_VERSION mismatches.
  - The compose file was edited and the volume reference no longer matches.

DO NOT proceed — that would create an empty database and lose all existing data.

Recovery: see deploy/dockge/README.md section
          "Recovery runbook — empty PGDATA detected"
================================================================================
EOF
  exit 1
fi

echo "[init-guard] CHILL_REQUIRE_EXISTING_DATA=0 — allowing fresh init to proceed."
