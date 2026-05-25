#!/bin/sh
#
# supabase/reset.sh — DESTRUCTIVELY reset the local Supabase dev stack.
#
# This script removes ALL Postgres data and storage uploads. It is intended
# for DEV machines only. It must NEVER be run against production data.
#
# Safety net:
#   - The original `-y` flag bypassed every prompt, including the data-
#     deletion ones. That was the root cause of accidental wipes. It is
#     REMOVED. There is no way to skip the destructive confirms now.
#   - Before deleting volumes/db/data we do a `pg_dump` to
#     volumes/backups/pre-reset-YYYYMMDDTHHMMSSZ.sql (best-effort — if the
#     DB is down we warn loudly and still require explicit confirmation
#     before proceeding). The dump path is printed so the operator can
#     recover with `psql < <path>`.
#   - The final confirm requires typing the literal database name (default
#     "postgres") instead of just y/N. Muscle memory cannot delete data.

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

# Database name expected by typed-confirmation. Override via POSTGRES_DB env
# or .env if your stack uses a different name.
EXPECTED_DB_NAME="${POSTGRES_DB:-postgres}"
BACKUP_DIR="./volumes/backups"
TIMESTAMP="$(date -u +%FT%H%M%SZ)"
PRE_RESET_DUMP="$BACKUP_DIR/pre-reset-$TIMESTAMP.sql"

echo ""
echo "================================================================================"
echo "  *** SUPABASE LOCAL DEV RESET — DESTRUCTIVE ***"
echo "================================================================================"
echo "  This will:"
echo "    1. Take a pre-reset pg_dump → $PRE_RESET_DUMP"
echo "    2. Stop and REMOVE all containers + ALL volumes (docker compose down -v)"
echo "    3. DELETE ./volumes/db/data and ./volumes/storage on the host"
echo "    4. Replace .env with .env.example (current .env saved as .env.old)"
echo ""
echo "  THIS SCRIPT IS FOR DEV MACHINES ONLY. Running against production data"
echo "  causes irrecoverable loss. DO NOT proceed if this is a production host."
echo "================================================================================"
echo ""

prompt_typed_confirm () {
    msg="$1"
    expected="$2"
    printf '%s\nType exactly "%s" to confirm: ' "$msg" "$expected"
    read -r REPLY
    if [ "$REPLY" != "$expected" ]; then
        echo "Confirmation did not match. Aborting — nothing was deleted."
        exit 1
    fi
}

prompt_yes_no () {
    printf '%s (y/N) ' "$1"
    read -r REPLY
    case "$REPLY" in
        [Yy]) ;;
        *)
            echo "Aborting — nothing was deleted."
            exit 1
            ;;
    esac
}

# ----------------------------------------------------------------------------
# Step 1: Pre-reset pg_dump (best-effort)
# ----------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"

DB_CONTAINER="$(docker ps --filter "name=supabase-db" --format '{{.Names}}' | head -n1)"
if [ -n "$DB_CONTAINER" ]; then
    echo "===> Taking pre-reset pg_dump from $DB_CONTAINER..."
    if docker exec -e PGPASSWORD="${POSTGRES_PASSWORD:-postgres}" \
        "$DB_CONTAINER" \
        pg_dump --schema=public --no-owner --no-privileges \
        -U postgres -d "$EXPECTED_DB_NAME" \
        > "$PRE_RESET_DUMP"; then
        size="$(wc -c < "$PRE_RESET_DUMP" | tr -d ' ')"
        echo "    ✓ Pre-reset dump saved ($size bytes): $PRE_RESET_DUMP"
    else
        rm -f "$PRE_RESET_DUMP"
        echo "    ✗ pg_dump FAILED. The DB may be unreachable or corrupted."
        echo ""
        prompt_yes_no "Continue WITHOUT a backup? Existing data will be UNRECOVERABLE."
    fi
else
    echo "===> No supabase-db container running; skipping pg_dump."
    echo "     If volumes/db/data/ contains data from a previous run, it will be lost."
    echo ""
    prompt_yes_no "Continue WITHOUT a backup?"
fi

echo ""

# ----------------------------------------------------------------------------
# Step 2: docker compose down -v
# ----------------------------------------------------------------------------
prompt_typed_confirm \
    "About to run 'docker compose down -v' (removes containers AND named volumes)." \
    "$EXPECTED_DB_NAME"

echo "===> Stopping and removing all containers + named volumes..."

if [ -f ".env" ]; then
    docker compose -f docker-compose.yml -f ./dev/docker-compose.dev.yml down -v --remove-orphans
elif [ -f ".env.example" ]; then
    echo "No .env found, using .env.example for docker compose down..."
    docker compose --env-file .env.example -f docker-compose.yml -f ./dev/docker-compose.dev.yml down -v --remove-orphans
else
    echo "Skipping 'docker compose down' because there's no env-file."
fi

echo ""

# ----------------------------------------------------------------------------
# Step 3: rm -rf bind mounts
# ----------------------------------------------------------------------------
BIND_MOUNTS="./volumes/db/data ./volumes/storage"

for dir in $BIND_MOUNTS; do
    if [ -d "$dir" ]; then
        prompt_typed_confirm \
            "About to 'rm -rf $dir' (DELETES all data inside)." \
            "$EXPECTED_DB_NAME"
        echo "    Removing $dir..."
        rm -rf "$dir"
    else
        echo "$dir not found, skipping."
    fi
done

echo ""

# ----------------------------------------------------------------------------
# Step 4: Reset .env
# ----------------------------------------------------------------------------
prompt_yes_no "Replace .env with .env.example? (current .env -> .env.old)"

if [ -f ".env" ] || [ -L ".env" ]; then
    echo "===> Renaming existing .env -> .env.old"
    mv .env .env.old
else
    echo "===> No existing .env file."
fi

if [ -f ".env.example" ]; then
    echo "===> Copying .env.example -> .env"
    cp .env.example .env
else
    echo "===> No .env.example found, can't restore .env to defaults."
fi

echo ""
echo "================================================================================"
echo "Cleanup complete."
if [ -f "$PRE_RESET_DUMP" ]; then
    echo "Pre-reset backup:  $PRE_RESET_DUMP"
    echo "Restore command:   psql -h localhost -U postgres -d postgres < $PRE_RESET_DUMP"
fi
echo "Re-run 'docker compose pull' to update images, then 'docker compose up -d'."
echo "================================================================================"
