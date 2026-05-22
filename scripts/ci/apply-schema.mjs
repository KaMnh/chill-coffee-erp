#!/usr/bin/env node
// scripts/ci/apply-schema.mjs — Apply database/{001,002,003}.sql to a vanilla
// Postgres 15 instance pointed at by PGTAP_DB_URL.
//
// Local dev uses `scripts/db-init.mjs` which targets the Supabase docker
// container (and gets the auth schema for free from Supabase's bootstrap).
// This script is the CI equivalent: targets a bare Postgres + seeds the
// minimal auth schema mock that our pgTAP test fixtures need.
//
// Uses psql shell-out (same pattern as scripts/pgtap-run.mjs) to avoid
// adding a node-postgres dependency.
//
// Usage (in CI workflow):
//   PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/postgres \
//     node scripts/ci/apply-schema.mjs
//
// Idempotent — the schema files use CREATE OR REPLACE / CREATE IF NOT
// EXISTS throughout, so this can be run repeatedly against a fresh DB.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

const DB_URL = process.env.PGTAP_DB_URL;
if (!DB_URL) {
  console.error("PGTAP_DB_URL env var required");
  process.exit(1);
}

// Minimal Supabase auth schema mock. pgTAP test fixtures insert into
// auth.users (id, email, encrypted_password, email_confirmed_at,
// instance_id) and rely on auth.uid() / auth.role() in RLS policies.
const AUTH_SCHEMA_MOCK = `
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  instance_id uuid
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '')::text;
$$;
`;

function psqlExec(sql, label) {
  process.stdout.write(`>>> ${label}... `);
  try {
    execFileSync(
      "psql",
      [DB_URL, "-v", "ON_ERROR_STOP=1", "-AtX", "-f", "-"],
      { input: sql, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] }
    );
  } catch (err) {
    console.error(`FAIL applying ${label}: ${err.message}`);
    process.exit(1);
  }
  console.log("OK");
}

function applyFile(relativePath, label) {
  const absPath = resolve(REPO_ROOT, relativePath);
  const sql = readFileSync(absPath, "utf8");
  psqlExec(sql, label);
}

psqlExec(AUTH_SCHEMA_MOCK, "auth schema mock");
applyFile("database/001_schema.sql", "001_schema.sql");
applyFile("database/002_functions.sql", "002_functions.sql");
applyFile("database/003_rls.sql", "003_rls.sql");

console.log(">>> apply-schema.mjs DONE");
