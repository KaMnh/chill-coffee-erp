// scripts/migrate/_lib/psql.mjs — wrapper psql qua `docker compose exec`.
// Reuse pattern từ scripts/db-init.mjs:25-37, thêm 2 mode: pipe-stdin + execute-and-capture.
import { execFileSync } from "node:child_process";
import { readEnvValue } from "./env.mjs";

const POSTGRES_PASSWORD = readEnvValue("supabase/.env", "POSTGRES_PASSWORD");

/** Pre-flight: confirm Docker Desktop đang chạy + container db online.
 *  Throw error rõ ràng nếu không, để user không phải parse stack trace dài. */
let _dockerChecked = false;
function ensureDocker() {
  if (_dockerChecked) return;
  try {
    execFileSync("docker", ["info"], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    throw new Error(
      "Docker Desktop không chạy.\n" +
      "  → Mở Docker Desktop, đợi icon ngừng animate (~30s).\n" +
      "  → Verify: docker compose ps db  (phải thấy STATUS=running healthy).\n" +
      "  → Sau đó rerun script."
    );
  }
  try {
    const out = execFileSync("docker", ["compose", "ps", "-q", "db"],
      { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (!out) {
      throw new Error(
        "Container `db` chưa chạy trong stack chill-coffee-erp.\n" +
        "  → Chạy: docker compose up -d  rồi rerun."
      );
    }
  } catch (e) {
    if (e.message.startsWith("Container")) throw e;
    throw new Error(`Không kiểm tra được docker compose: ${e.message}`);
  }
  _dockerChecked = true;
}

/** Pipe SQL string vào psql, hiển thị output thẳng terminal. ON_ERROR_STOP=1. */
export function psqlExec(sql) {
  ensureDocker();
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

/** Chạy SQL command đơn ngắn (-c), trả raw stdout. Dùng cho SELECT count/aggregate. */
export function psqlQuery(sql, opts = {}) {
  ensureDocker();
  const args = [
    "compose", "exec", "-T",
    "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`,
    "db",
    "psql", "-U", "postgres", "-d", "postgres", "-h", "127.0.0.1",
    "-v", "ON_ERROR_STOP=1",
  ];
  if (opts.tuplesOnly) args.push("-t");
  if (opts.noAlign) args.push("-A");
  if (opts.fieldSep) args.push("-F", opts.fieldSep);
  args.push("-c", sql);
  return execFileSync("docker", args, { stdio: ["ignore", "pipe", "inherit"] }).toString();
}

/** Parse output của psql -t -A -F'|' thành array of row arrays. */
export function parseTabular(stdout) {
  return stdout
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split("|"));
}
