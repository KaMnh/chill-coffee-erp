// scripts/db-init.mjs — áp schema SQL của Chill vào Postgres của stack Supabase đã chạy,
// rồi ép quy ước timezone Asia/Ho_Chi_Minh.
// Chạy SAU `docker compose up -d`:  node scripts/db-init.mjs
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SQL_FILES = [
  "database/001_schema.sql",
  "database/002_functions.sql",
  "database/003_rls.sql",
  "database/004_seed.sql",
  "database/005_storage.sql",
];

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const POSTGRES_PASSWORD = readEnvValue("supabase/.env", "POSTGRES_PASSWORD");

function psql(sql) {
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

for (const file of SQL_FILES) {
  console.log(`\n>>> Áp ${file}`);
  psql(readFileSync(file, "utf8"));
}

console.log("\n>>> Ép timezone Asia/Ho_Chi_Minh");
psql("ALTER DATABASE postgres SET timezone TO 'Asia/Ho_Chi_Minh';");

console.log("\nXong. Restart để connection pool nhận timezone mới:");
console.log("  docker compose restart db rest realtime");
