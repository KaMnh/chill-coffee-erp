// scripts/migrate/_lib/env.mjs — đọc env vars từ file .env theo cùng convention với db-init.mjs.
// Không dùng dotenv để khỏi thêm dep cho one-time tooling.
import { readFileSync } from "node:fs";

/** Đọc 1 key từ file .env. Throw nếu không tồn tại. */
export function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

/** Đọc nhiều key cùng lúc, trả object. */
export function readEnvValues(path, keys) {
  const result = {};
  for (const key of keys) result[key] = readEnvValue(path, key);
  return result;
}
