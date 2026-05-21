#!/usr/bin/env node
// scripts/pgtap-run.mjs — Run all database/tests/*.sql files through pgTAP
// inside the Supabase Postgres container, parse TAP output, exit 0 on
// success, 1 on first failure.
//
// Usage:
//   node scripts/pgtap-run.mjs              # run all files
//   node scripts/pgtap-run.mjs --setup-only # run 000_setup.sql only
//   node scripts/pgtap-run.mjs --file <path># run a single file
//
// Reads supabase/.env for POSTGRES_PASSWORD (same pattern as db-init.mjs).

import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const TESTS_DIR = "database/tests";

function readEnvValue(path, key) {
  const line = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(key + "="));
  if (!line) throw new Error(`Không tìm thấy ${key} trong ${path}`);
  return line.slice(key.length + 1).trim();
}

const POSTGRES_PASSWORD = readEnvValue("supabase/.env", "POSTGRES_PASSWORD");

function parseArgs(args) {
  const out = { setupOnly: false, file: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--setup-only") out.setupOnly = true;
    else if (a === "--file") out.file = args[++i];
  }
  return out;
}

function listTestFiles({ setupOnly, file }) {
  if (file) return [file];
  const all = readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(TESTS_DIR, f));
  if (setupOnly) return all.filter((f) => f.endsWith("000_setup.sql"));
  return all;
}

function psqlFile(sqlContent) {
  return execFileSync(
    "docker",
    [
      "compose", "exec", "-T",
      "-e", `PGPASSWORD=${POSTGRES_PASSWORD}`,
      "db",
      "psql", "-U", "postgres", "-d", "postgres", "-h", "127.0.0.1",
      "-v", "ON_ERROR_STOP=1",
      "-AtX",
      "-f", "-",
    ],
    { input: sqlContent, encoding: "utf8" }
  );
}

function parseTap(output) {
  const lines = output.split(/\r?\n/);
  let plan = null;
  const passes = [];
  const fails = [];
  for (const line of lines) {
    const planMatch = line.match(/^1\.\.(\d+)/);
    if (planMatch) plan = Number(planMatch[1]);
    const okMatch = line.match(/^ok (\d+)(?:\s+-\s+(.*))?/);
    if (okMatch) passes.push({ n: Number(okMatch[1]), desc: okMatch[2] ?? "" });
    const notOkMatch = line.match(/^not ok (\d+)(?:\s+-\s+(.*))?/);
    if (notOkMatch) fails.push({ n: Number(notOkMatch[1]), desc: notOkMatch[2] ?? "" });
  }
  return { plan, passes, fails };
}

const args = parseArgs(process.argv.slice(2));
const files = listTestFiles(args);

let totalPasses = 0;
let totalFails = 0;
let firstFailFile = null;

for (const file of files) {
  const sql = readFileSync(file, "utf8");
  process.stdout.write(`\n>>> ${file}\n`);
  let output;
  try {
    output = psqlFile(sql);
  } catch (err) {
    console.error(`  ✗ psql crashed: ${err.message}`);
    process.exit(1);
  }
  const { plan, passes, fails } = parseTap(output);
  totalPasses += passes.length;
  totalFails += fails.length;

  // Plan-vs-count mismatch is a TAP-spec failure (e.g. a file declared 1..6
  // but bailed out after 4 ok lines). Treat as a fail so the gate doesn't
  // silently pass partially-run suites.
  const planMismatch =
    plan !== null && fails.length === 0 && passes.length !== plan;

  if (fails.length > 0 || planMismatch) {
    if (!firstFailFile) firstFailFile = file;
    for (const f of fails) {
      console.error(`  ✗ not ok ${f.n} - ${f.desc}`);
    }
    if (planMismatch) {
      console.error(
        `  ✗ plan mismatch: declared 1..${plan} but found ${passes.length} ok lines`
      );
      totalFails += 1;
    }
    console.error(`  ${passes.length}/${plan ?? "?"} passed in this file`);
    break;
  } else if (plan !== null) {
    console.log(`  ${passes.length}/${plan} passed`);
  } else {
    console.log(`  ${passes.length} ok lines (no plan declared)`);
  }
}

console.log(`\n────────────────────────────────────────────────`);
console.log(`Files run: ${files.length}`);
console.log(`Total assertions passed: ${totalPasses}`);
if (totalFails > 0) {
  console.error(`Total assertions failed: ${totalFails}`);
  console.error(`First failure in: ${firstFailFile}`);
  process.exit(1);
}
console.log(`✓ All assertions passed.`);
process.exit(0);
