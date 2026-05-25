#!/usr/bin/env node
/**
 * scripts/check-kiotviet-creds.mjs — diagnose INGEST_CLIENT_SECRET vs DB.
 *
 * Reads INGEST_CLIENT_ID / INGEST_CLIENT_SECRET / POSTGRES_PASSWORD from env,
 * compares the env secret against the stored bcrypt hash in
 * public.integration_clients, and prints actionable diagnostics.
 *
 * Run inside the app container:
 *   docker exec <stack>chill-app npm run kiotviet:check
 * Or directly via psql exec (when called from migrator container, same env).
 *
 * Exits 0 if everything matches, 1 otherwise.
 */
import { execFileSync } from "node:child_process";

const INGEST_CLIENT_ID = process.env.INGEST_CLIENT_ID || "chill-erp";
const INGEST_CLIENT_SECRET = process.env.INGEST_CLIENT_SECRET?.trim() ?? "";
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
const POSTGRES_HOST = process.env.POSTGRES_HOST || "db";
const POSTGRES_PORT = process.env.POSTGRES_PORT || "5432";

const log = (m) => console.log(`[kiotviet:check] ${m}`);
const fail = (m) => {
  console.error(`[kiotviet:check] ❌ ${m}`);
  process.exit(1);
};

log(`INGEST_CLIENT_ID = '${INGEST_CLIENT_ID}'`);
log(`INGEST_CLIENT_SECRET length = ${INGEST_CLIENT_SECRET.length}`);

if (!INGEST_CLIENT_SECRET) fail("INGEST_CLIENT_SECRET is empty. Set it in .env and redeploy.");
if (!POSTGRES_PASSWORD) fail("POSTGRES_PASSWORD is empty. Cannot query DB.");

const safeId = INGEST_CLIENT_ID.replace(/'/g, "''");
const safeSecret = INGEST_CLIENT_SECRET.replace(/'/g, "''");

function psql(sql) {
  return execFileSync(
    "psql",
    [
      "-h", POSTGRES_HOST,
      "-p", POSTGRES_PORT,
      "-U", "postgres",
      "-d", "postgres",
      "-AtX",
      "-v", "ON_ERROR_STOP=1",
      "-c", sql,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: POSTGRES_PASSWORD },
    }
  ).trim();
}

// Existence + active state
const rowInfo = psql(
  `select format('count=%s active=%s id=%s', ` +
    `  count(*) filter (where client_id = '${safeId}'), ` +
    `  count(*) filter (where client_id = '${safeId}' and is_active = true), ` +
    `  coalesce(min(client_id) filter (where client_id != '${safeId}'), '(none)') ` +
    `) from public.integration_clients;`
);
log(`row state: ${rowInfo}`);

// Hash match
const verify = psql(
  `select case when exists (` +
    `  select 1 from public.integration_clients ` +
    `  where client_id = '${safeId}' ` +
    `    and is_active = true ` +
    `    and client_secret_hash = crypt('${safeSecret}', client_secret_hash) ` +
    `) then 'ok' else 'mismatch' end;`
);

if (verify === "ok") {
  log("✓ env secret matches stored hash. /api/kiotviet/sync should work.");
  process.exit(0);
}

// Mismatch — give actionable advice based on what we found
console.error("");
console.error("[kiotviet:check] ❌ env INGEST_CLIENT_SECRET does NOT match the stored bcrypt hash.");
console.error("");
console.error("Try in order:");
console.error("  1. Verify .env value (no trailing spaces, no quotes around the value):");
console.error("       grep ^INGEST_CLIENT_SECRET= /opt/stacks/chill-coffee-erp/.env");
console.error("");
console.error("  2. Recreate the migrator container (re-runs the seed with the current env):");
console.error("       cd /opt/stacks/chill-coffee-erp && docker compose up -d --force-recreate migrator");
console.error("");
console.error("  3. Or update the hash manually from the running app container's env:");
console.error("       docker exec <stack>chill-app sh -c 'printf %s \"$INGEST_CLIENT_SECRET\"' > /tmp/.s");
console.error("       docker cp /tmp/.s <stack>supabase-db:/tmp/.s");
console.error("       docker exec -i <stack>supabase-db psql -U postgres -d postgres <<'SQL'");
console.error("         \\set s `cat /tmp/.s`");
console.error("         update public.integration_clients");
console.error("         set client_secret_hash = crypt(:'s', gen_salt('bf')), is_active = true");
console.error(`         where client_id = '${INGEST_CLIENT_ID}';`);
console.error("       SQL");
console.error("       (replace <stack> with your STACK_NAMESPACE prefix, e.g. 'chill-erp-')");
process.exit(1);
