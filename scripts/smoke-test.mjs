// scripts/smoke-test.mjs — kiểm tra chuỗi anon-key + Auth (GoTrue) + RLS hoạt động.
// Chạy khi stack đang up:  OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/smoke-test.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const url = readEnvValue(".env", "NEXT_PUBLIC_SUPABASE_URL");
const anonKey = readEnvValue(".env", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
const supabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const email = process.env.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD;
if (!email || !password) throw new Error("Thiếu OWNER_EMAIL hoặc OWNER_PASSWORD.");

const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (authErr || !auth.user) throw new Error(`Đăng nhập owner lỗi: ${authErr?.message ?? "user null (chưa confirm email?)"}`);
console.log("✓ Owner đăng nhập OK:", auth.user.email);

const { data, error } = await supabase
  .from("employee_accounts")
  .select("role,status")
  .limit(1);
if (error) throw new Error(`Đọc có RLS lỗi: ${error.message}`);
if (!data || data.length === 0) throw new Error("Không đọc được employee_accounts (RLS chặn?)");
console.log("✓ Đọc có RLS OK:", data[0]);

console.log("\nSmoke test PASS.");
