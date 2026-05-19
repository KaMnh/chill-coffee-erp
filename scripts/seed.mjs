// scripts/seed.mjs — tạo tài khoản owner đầu tiên + integration client cho KiotViet ingest.
// Chạy SAU db-init:  node scripts/seed.mjs
// Biến môi trường yêu cầu: OWNER_EMAIL, OWNER_PASSWORD (>= 8 ký tự).
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const SUPABASE_URL = readEnvValue(".env", "NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = readEnvValue(".env", "SUPABASE_SERVICE_ROLE_KEY");
const INGEST_CLIENT_ID = readEnvValue(".env", "INGEST_CLIENT_ID");
const INGEST_CLIENT_SECRET = readEnvValue(".env", "INGEST_CLIENT_SECRET");
const POSTGRES_PASSWORD = readEnvValue("supabase/.env", "POSTGRES_PASSWORD");

const ownerEmail = process.env.OWNER_EMAIL;
const ownerPassword = process.env.OWNER_PASSWORD;
if (!ownerEmail || !ownerPassword || ownerPassword.length < 8) {
  throw new Error("Cần OWNER_EMAIL và OWNER_PASSWORD (>= 8 ký tự).");
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1) Tạo auth user (auto-confirm email)
const { data: authData, error: authErr } = await admin.auth.admin.createUser({
  email: ownerEmail,
  password: ownerPassword,
  email_confirm: true,
});
if (authErr || !authData.user) throw new Error(`Tạo auth user lỗi: ${authErr?.message}`);
const authUserId = authData.user.id;
console.log("✓ Auth user:", authUserId);

// 2) employees
const { data: emp, error: empErr } = await admin
  .from("employees")
  .insert({ name: "Owner", position: "Chủ quán", hourly_rate: 0, is_active: true })
  .select("id")
  .single();
if (empErr || !emp) throw new Error(`Tạo employee lỗi: ${empErr?.message}`);
console.log("✓ Employee:", emp.id);

// 3) employee_accounts (role owner)
const { error: accErr } = await admin.from("employee_accounts").insert({
  employee_id: emp.id,
  auth_user_id: authUserId,
  role: "owner",
  status: "active",
});
if (accErr) throw new Error(`Tạo employee_account lỗi: ${accErr.message}`);
console.log("✓ employee_account: owner/active");

// 4) profiles
await admin.from("profiles").upsert(
  { id: authUserId, display_name: "Owner" },
  { onConflict: "id" }
);

// 5) integration_clients — dùng crypt() nên insert qua psql
const sql =
  `insert into public.integration_clients (client_id, client_secret_hash, name, is_active) ` +
  `values ('${INGEST_CLIENT_ID}', crypt('${INGEST_CLIENT_SECRET}', gen_salt('bf')), 'Chill ERP Next.js', true) ` +
  `on conflict (client_id) do nothing;`;
execFileSync(
  "docker",
  ["compose", "exec", "-T", "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`, "db",
   "psql", "-U", "postgres", "-d", "postgres", "-h", "127.0.0.1", "-v", "ON_ERROR_STOP=1", "-c", sql],
  { stdio: ["pipe", "inherit", "inherit"] }
);
console.log("✓ integration_clients:", INGEST_CLIENT_ID);
console.log("\nSeed xong.");
