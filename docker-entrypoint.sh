#!/bin/sh
# Runtime injection of NEXT_PUBLIC_* env values into the Next.js standalone build.
#
# Next.js inlines NEXT_PUBLIC_* values into the JS bundle at build time. To make
# one image work for many deployments, we build with stable placeholder strings
# and replace them at container start with the current env values.
#
# Placeholders (must match values used in Dockerfile build-args):
#   __SUPABASE_URL_PLACEHOLDER__       <- $NEXT_PUBLIC_SUPABASE_URL
#   __SUPABASE_ANON_KEY_PLACEHOLDER__  <- $NEXT_PUBLIC_SUPABASE_ANON_KEY
#   __APP_URL_PLACEHOLDER__            <- $NEXT_PUBLIC_APP_URL

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
