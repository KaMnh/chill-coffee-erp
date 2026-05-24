// scripts/db-init.mjs — Apply Chill schema + migrations to a Supabase Postgres.
//
// Two modes (auto-detected via POSTGRES_HOST env var):
//
// 1. CONTAINER mode (POSTGRES_HOST set): runs inside a container on the stack
//    network, talks to `db` service via direct `psql`. Reads everything from
//    process.env. Used by the migrator service in deploy/dockge/compose.yaml.
//
// 2. HOST mode (POSTGRES_HOST not set): runs on the dev machine, talks to the
//    db container via `docker compose exec`. Reads POSTGRES_PASSWORD from
//    supabase/.env (legacy dev workflow). Backward-compatible with existing
//    `npm run db:init`.
//
// Apply order: 001..005 (initial schema) → migrations/*.sql (alphabetical =
// chronological because filenames are date-prefixed). 000_reset.sql is
// EXPLICITLY SKIPPED — that file drops tables and must never run in prod.
//
// Idempotent: all SQL files use CREATE OR REPLACE / IF NOT EXISTS, so re-runs
// are safe (this is what makes the migrator container's restart-on-deploy work).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

const isContainer = !!process.env.POSTGRES_HOST;

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const POSTGRES_PASSWORD = isContainer
  ? process.env.POSTGRES_PASSWORD
  : readEnvValue(resolve(REPO_ROOT, "supabase/.env"), "POSTGRES_PASSWORD");

if (!POSTGRES_PASSWORD) {
  console.error("POSTGRES_PASSWORD missing (container mode: set env; host mode: check supabase/.env)");
  process.exit(1);
}

function psql(sql) {
  if (isContainer) {
    execFileSync(
      "psql",
      [
        "-h", process.env.POSTGRES_HOST,
        "-p", process.env.POSTGRES_PORT || "5432",
        "-U", "postgres",
        "-d", "postgres",
        "-v", "ON_ERROR_STOP=1",
        "-f", "-",
      ],
      {
        input: sql,
        stdio: ["pipe", "inherit", "inherit"],
        env: { ...process.env, PGPASSWORD: POSTGRES_PASSWORD },
      }
    );
  } else {
    execFileSync(
      "docker",
      [
        "compose", "exec", "-T",
        "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`,
        "db",
        "psql", "-U", "postgres", "-d", "postgres", "-h", "127.0.0.1",
        "-v", "ON_ERROR_STOP=1", "-f", "-",
      ],
      { input: sql, stdio: ["pipe", "inherit", "inherit"] }
    );
  }
}

// Initial schema (NEVER include 000_reset.sql — that file drops tables).
const BASE_FILES = [
  "database/001_schema.sql",
  "database/002_functions.sql",
  "database/003_rls.sql",
  "database/004_seed.sql",
  "database/005_storage.sql",
];

// Migrations applied alphabetically (filenames are date-prefixed).
const migrationsDir = resolve(REPO_ROOT, "database/migrations");
const migrationFiles = existsSync(migrationsDir)
  ? readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => `database/migrations/${f}`)
  : [];

const ALL_FILES = [...BASE_FILES, ...migrationFiles];

console.log(`Mode: ${isContainer ? "container" : "host (docker compose exec)"}`);
console.log(`Applying ${ALL_FILES.length} SQL file(s): ${BASE_FILES.length} base + ${migrationFiles.length} migrations`);

for (const file of ALL_FILES) {
  console.log(`\n>>> Apply ${file}`);
  psql(readFileSync(resolve(REPO_ROOT, file), "utf8"));
}

console.log("\n>>> Set timezone Asia/Ho_Chi_Minh");
psql("ALTER DATABASE postgres SET timezone TO 'Asia/Ho_Chi_Minh';");

console.log("\nDone. Schema + migrations applied.");
if (!isContainer) {
  console.log("Restart connection pool to pick up timezone:");
  console.log("  docker compose restart db rest realtime");
}
