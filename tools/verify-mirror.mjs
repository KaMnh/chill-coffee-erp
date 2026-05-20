#!/usr/bin/env node
// Verify v4 dashboard numbers against the v3 production mirror.
//
// Prereq:
//   1. pg_dump v3 production (when shop is closed) into mirrors/v3-YYYY-MM-DD.sql
//   2. Restore into v4 dev: docker compose exec -T db psql -U postgres < mirrors/v3-YYYY-MM-DD.sql
//   3. docker compose up chill-app
//
// Then run: node tools/verify-mirror.mjs --date 2026-05-XX --base http://localhost:3009 --service-key <key>
//
// Compares:
//   - DashboardData fields totaled by Phase 1 RPC (loadDashboard)
//   - Compared against fields aggregated from raw tables (same SQL the RPC uses)
//
// Exit 0 on match; exit 1 with diff per field.

import { createClient } from "@supabase/supabase-js";
import { argv, exit } from "node:process";

function parseArgs(args) {
  const out = { date: "", url: "http://localhost:8000", serviceKey: "" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--date") out.date = args[++i];
    else if (a === "--url") out.url = args[++i];
    else if (a === "--service-key") out.serviceKey = args[++i];
  }
  return out;
}

const { date, url, serviceKey } = parseArgs(argv.slice(2));

if (!date) {
  console.error("Usage: node tools/verify-mirror.mjs --date YYYY-MM-DD [--url http://localhost:8000] [--service-key <key>]");
  console.error("  --service-key required; pass SUPABASE_SERVICE_ROLE_KEY value (from .env)");
  exit(2);
}

if (!serviceKey) {
  console.error("Missing --service-key. Get value from `.env` SUPABASE_SERVICE_ROLE_KEY.");
  exit(2);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function viaRpc() {
  const { data, error } = await supabase.rpc("dashboard_daily_ops", {
    p_business_date: date,
  });
  if (error) throw new Error(`RPC failed: ${error.message}`);
  return data;
}

async function viaRawAggregates() {
  // The "raw" baseline strategy: query individual tables directly via PostgREST
  // and sum, then compare. This is the strict mirror check.
  const [{ data: salesOrders, error: e1 }] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("net_amount, payment_method, total_payment")
      .eq("business_date", date),
  ]);
  if (e1) throw new Error(`sales_orders read failed: ${e1.message}`);

  const total_sales = (salesOrders ?? []).reduce(
    (acc, o) => acc + Number(o.net_amount ?? o.total_payment ?? 0),
    0
  );
  const cash_sales = (salesOrders ?? []).reduce(
    (acc, o) =>
      acc +
      (o.payment_method === "cash"
        ? Number(o.net_amount ?? o.total_payment ?? 0)
        : 0),
    0
  );

  const [{ data: expenses, error: e2 }] = await Promise.all([
    supabase.from("expenses").select("amount").eq("business_date", date),
  ]);
  if (e2) throw new Error(`expenses read failed: ${e2.message}`);

  const total_expenses = (expenses ?? []).reduce(
    (acc, e) => acc + Number(e.amount ?? 0),
    0
  );

  const [{ data: payrollRecords, error: e3 }] = await Promise.all([
    supabase
      .from("shift_payroll_records")
      .select("total_pay")
      .eq("business_date", date),
  ]);
  if (e3) throw new Error(`shift_payroll_records read failed: ${e3.message}`);

  const payroll_paid = (payrollRecords ?? []).reduce(
    (acc, p) => acc + Number(p.total_pay ?? 0),
    0
  );

  const [{ data: shifts, error: e4 }] = await Promise.all([
    supabase
      .from("shift_assignments")
      .select("status")
      .eq("business_date", date),
  ]);
  if (e4) throw new Error(`shift_assignments read failed: ${e4.message}`);

  const active_staff = (shifts ?? []).filter(
    (s) => s.status === "checked_in"
  ).length;

  return {
    total_sales,
    cash_sales,
    total_expenses,
    payroll_paid,
    active_staff,
    sales_orders_count: (salesOrders ?? []).length,
    expenses_count: (expenses ?? []).length,
  };
}

function fmt(n) {
  return new Intl.NumberFormat("vi-VN").format(n);
}

async function main() {
  console.log(`Verifying business_date = ${date}\n`);
  console.log("Loading via RPC (the path the app uses)...");
  const rpc = await viaRpc();
  console.log("Loading via raw aggregates (the ground truth)...");
  const raw = await viaRawAggregates();

  const checks = [
    { name: "total_sales",        rpc: Number(rpc.total_sales ?? 0),     raw: raw.total_sales },
    { name: "cash_sales",         rpc: Number(rpc.cash_sales ?? 0),      raw: raw.cash_sales },
    { name: "total_expenses",     rpc: Number(rpc.total_expenses ?? 0),  raw: raw.total_expenses },
    { name: "payroll_paid",       rpc: Number(rpc.payroll_paid ?? 0),    raw: raw.payroll_paid },
    { name: "active_staff",       rpc: Number(rpc.active_staff ?? 0),    raw: raw.active_staff },
    { name: "sales_orders_count", rpc: (rpc.sales_orders ?? []).length,  raw: raw.sales_orders_count },
    { name: "expenses_count",     rpc: (rpc.expenses ?? []).length,      raw: raw.expenses_count },
  ];

  let failed = 0;
  console.log("\nField              | RPC              | Raw              | Match");
  console.log("---");
  for (const c of checks) {
    const match = c.rpc === c.raw;
    if (!match) failed++;
    const tick = match ? "✓" : "✗";
    console.log(
      `${c.name.padEnd(18)} | ${String(fmt(c.rpc)).padStart(16)} | ${String(fmt(c.raw)).padStart(16)} | ${tick}`
    );
  }

  if (failed === 0) {
    console.log(`\n✓ All ${checks.length} checks passed. v4 RPC matches raw aggregates on ${date}.`);
    exit(0);
  } else {
    console.error(`\n✗ ${failed} of ${checks.length} checks failed.`);
    exit(1);
  }
}

main().catch((err) => {
  console.error(`\n✗ verify-mirror crashed: ${err.message}`);
  exit(1);
});
