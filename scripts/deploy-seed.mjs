// scripts/deploy-seed.mjs — Idempotent owner-account seed for the migrator
// container. Reads everything from process.env (no file I/O for secrets).
//
// Behavior:
// - If OWNER_EMAIL or OWNER_PASSWORD is empty → log + exit 0 (no seed).
// - If an active owner account already exists → log + exit 0 (no-op).
// - Otherwise creates: auth.users row + employees + employee_accounts + profiles.
// - Optionally seeds integration_clients if INGEST_CLIENT_SECRET is set.
//
// Required env (when seeding is requested):
//   OWNER_EMAIL, OWNER_PASSWORD (>= 8 chars)
//   SUPABASE_INTERNAL_URL  (e.g. http://kong:8000)
//   SUPABASE_SERVICE_ROLE_KEY
//
// Optional:
//   INGEST_CLIENT_ID (default: chill-erp), INGEST_CLIENT_SECRET, POSTGRES_HOST, POSTGRES_PASSWORD

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";

const OWNER_EMAIL = process.env.OWNER_EMAIL?.trim();
const OWNER_PASSWORD = process.env.OWNER_PASSWORD?.trim();

if (!OWNER_EMAIL || !OWNER_PASSWORD) {
  console.log("deploy-seed: OWNER_EMAIL/OWNER_PASSWORD not set, skipping seed.");
  process.exit(0);
}

if (OWNER_PASSWORD.length < 8) {
  console.error("deploy-seed: OWNER_PASSWORD must be >= 8 characters.");
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_INTERNAL_URL || "http://kong:8000";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error("deploy-seed: SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1) Skip if an active owner already exists.
const { data: existing, error: listErr } = await admin
  .from("employee_accounts")
  .select("id")
  .eq("role", "owner")
  .eq("status", "active")
  .limit(1);

if (listErr) {
  console.error("deploy-seed: failed to check existing owner:", listErr.message);
  process.exit(1);
}

if (existing && existing.length > 0) {
  console.log("deploy-seed: active owner already exists, skipping.");
  process.exit(0);
}

console.log(`deploy-seed: creating owner ${OWNER_EMAIL}`);

// 2) auth user (auto-confirm email).
const { data: authData, error: authErr } = await admin.auth.admin.createUser({
  email: OWNER_EMAIL,
  password: OWNER_PASSWORD,
  email_confirm: true,
});

if (authErr || !authData?.user) {
  console.error("deploy-seed: createUser failed:", authErr?.message);
  process.exit(1);
}

const authUserId = authData.user.id;
console.log("  auth user:", authUserId);

// 3) employees row.
const { data: emp, error: empErr } = await admin
  .from("employees")
  .insert({ name: "Owner", position: "Chủ quán", hourly_rate: 0, is_active: true })
  .select("id")
  .single();

if (empErr || !emp) {
  console.error("deploy-seed: failed to create employee:", empErr?.message);
  process.exit(1);
}
console.log("  employee:", emp.id);

// 4) employee_accounts link (role: owner, status: active).
const { error: accErr } = await admin.from("employee_accounts").insert({
  employee_id: emp.id,
  auth_user_id: authUserId,
  role: "owner",
  status: "active",
});

if (accErr) {
  console.error("deploy-seed: failed to link account:", accErr.message);
  process.exit(1);
}

// 5) profiles upsert.
const { error: profErr } = await admin
  .from("profiles")
  .upsert({ id: authUserId, display_name: "Owner" }, { onConflict: "id" });

if (profErr) {
  console.error("deploy-seed: failed to create profile:", profErr.message);
  process.exit(1);
}

console.log("deploy-seed: owner account created.");

// 6) integration_clients (optional — only if INGEST_CLIENT_SECRET set).
const INGEST_CLIENT_ID = process.env.INGEST_CLIENT_ID || "chill-erp";
const INGEST_CLIENT_SECRET = process.env.INGEST_CLIENT_SECRET?.trim();
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
const POSTGRES_HOST = process.env.POSTGRES_HOST || "db";
const POSTGRES_PORT = process.env.POSTGRES_PORT || "5432";

if (INGEST_CLIENT_SECRET && POSTGRES_PASSWORD) {
  // Use direct psql (uses crypt() + gen_salt() which need pgcrypto, not REST API).
  const safeId = INGEST_CLIENT_ID.replace(/'/g, "''");
  const safeSecret = INGEST_CLIENT_SECRET.replace(/'/g, "''");
  // ON CONFLICT DO UPDATE (not DO NOTHING) so changing INGEST_CLIENT_SECRET
  // in .env actually rotates the hash. Previously, DO NOTHING meant any
  // re-deploy after the first seed (rotation, restored backup, fresh re-key)
  // silently kept the stale hash and /api/kiotviet/sync returned
  // "Integration client không hợp lệ.".
  // `excluded.client_secret_hash` refers to the newly-bcrypted value from
  // the VALUES clause above, so each apply re-hashes with a fresh salt.
  const sql =
    `insert into public.integration_clients (client_id, client_secret_hash, name, is_active) ` +
    `values ('${safeId}', crypt('${safeSecret}', gen_salt('bf')), 'Chill ERP Next.js', true) ` +
    `on conflict (client_id) do update set ` +
    `  client_secret_hash = excluded.client_secret_hash, ` +
    `  is_active = true;`;

  execFileSync(
    "psql",
    [
      "-h", POSTGRES_HOST,
      "-p", POSTGRES_PORT,
      "-U", "postgres",
      "-d", "postgres",
      "-v", "ON_ERROR_STOP=1",
      "-c", sql,
    ],
    {
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, PGPASSWORD: POSTGRES_PASSWORD },
    }
  );
  console.log("deploy-seed: integration_clients seeded:", INGEST_CLIENT_ID);
} else {
  console.log("deploy-seed: skipping integration_clients (INGEST_CLIENT_SECRET or POSTGRES_PASSWORD not set).");
}

console.log("deploy-seed: done.");
