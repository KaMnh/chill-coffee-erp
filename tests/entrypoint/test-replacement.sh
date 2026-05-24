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
