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

echo "PASS: basic placeholder replacement"

# ---------------------------------------------------------------------------
# Test 2: pristine-reset behavior.
#
# Simulate the "wrong env on first deploy" scenario:
#   1. /app/.next-pristine has original placeholders (set up below)
#   2. /app/.next has ALREADY-REPLACED wrong values (from a previous bad run)
#   3. Entrypoint must reset .next from pristine, then sed with NEW env
#
# Expected: bundle ends with NEW env values, not the wrong ones.
# This is the fix for the writable-layer-stuck bug where `docker compose
# restart` couldn't replace a previously-replaced URL.
# ---------------------------------------------------------------------------

WORK2=$(mktemp -d)
trap 'rm -rf "$WORK" "$WORK2"' EXIT

# Pristine: original placeholders
mkdir -p "$WORK2/.next/standalone/.next-pristine/static/chunks"
cat > "$WORK2/.next/standalone/.next-pristine/static/chunks/main.js" <<EOF
const url = "__SUPABASE_URL_PLACEHOLDER__";
EOF

# Live .next: already replaced with WRONG url (simulates previous bad sed run)
mkdir -p "$WORK2/.next/standalone/.next/static/chunks"
cat > "$WORK2/.next/standalone/.next/static/chunks/main.js" <<EOF
const url = "https://wrong-url-from-previous-deploy.example.com";
EOF

cd "$WORK2"
NEXT_PUBLIC_SUPABASE_URL="https://correct-url.test.local" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJcorrect" \
NEXT_PUBLIC_APP_URL="https://app.correct.test.local" \
ENTRYPOINT_DRY_RUN=1 \
  bash "$ENTRYPOINT"

# Verify .next now contains the CORRECT url, NOT the wrong one
grep -q "https://correct-url.test.local" .next/standalone/.next/static/chunks/main.js \
  || { echo "FAIL: pristine-reset didn't apply new URL"; exit 1; }

if grep -q "wrong-url-from-previous-deploy" .next/standalone/.next/static/chunks/main.js 2>/dev/null; then
  echo "FAIL: wrong URL still present — pristine reset didn't happen"
  exit 1
fi

echo "PASS: pristine-reset replaces previously-baked wrong URL"
