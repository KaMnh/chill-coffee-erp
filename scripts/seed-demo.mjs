// scripts/seed-demo.mjs — Sample data cho test giao diện trên local dev.
// Idempotent: chỉ insert nếu chưa có dữ liệu demo (kiểm tra qua marker employee.code).
// Yêu cầu: npm run db:init + db:seed (tạo owner) đã chạy trước.
//
// Chạy: node scripts/seed-demo.mjs
//
// Phạm vi 14 ngày kết thúc hôm nay (2026-05-25):
//   - 4 nhân viên (ngoài owner) + thông tin lương
//   - 8 nguyên liệu, 10 món menu, 10 recipe + recipe_items
//   - ~50 expenses (chi phí) trải dài 14 ngày, đủ category
//   - ~280 sales_orders + items + payments (20 đơn/ngày)
//   - 1 sales_sync_run / ngày
//   - shift_assignments + shift_payroll_records (2-3 ca/ngày)
//   - cash_day_openings + cash_counts + cash_drawer_events + cash_close_reports
//   - safe_transactions (vài giao dịch)
//   - handover_sessions + handover_tasks (1/ngày)
//
// Không động vào: profiles của owner, integration_clients, app_settings.

import { readFileSync } from "node:fs";
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

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────
const DAYS_BACK = 14;
const TODAY = new Date("2026-05-25T07:00:00+07:00");

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function dateOffset(days) {
  // days=0 → hôm nay, days=-1 → hôm qua, …
  const d = new Date(TODAY);
  d.setDate(d.getDate() + days);
  return d;
}
function tsAt(date, hour, minute = 0) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function vnd(n) {
  return Math.round(n);
}
async function expect(label, { data, error }) {
  if (error) {
    console.error(`✗ ${label}:`, error.message);
    throw error;
  }
  console.log(`  ✓ ${label}: ${Array.isArray(data) ? data.length : 1} row(s)`);
  return data;
}

// Bail nếu đã seed rồi (kiểm tra qua employee.code prefix DEMO_)
{
  const { count } = await admin
    .from("employees")
    .select("*", { head: true, count: "exact" })
    .like("code", "DEMO_%");
  if (count && count > 0) {
    console.log(`Demo đã seed trước đó (${count} employees có code DEMO_*). Skip.`);
    process.exit(0);
  }
}

// Lấy owner để gán created_by
const { data: ownerAcc } = await admin
  .from("employee_accounts")
  .select("auth_user_id, employee_id")
  .eq("role", "owner")
  .limit(1)
  .single();
const OWNER_UID = ownerAcc.auth_user_id;
const OWNER_EMP_ID = ownerAcc.employee_id;

const { data: categories } = await admin
  .from("expense_categories")
  .select("id, name");
const catByName = Object.fromEntries(categories.map((c) => [c.name, c.id]));

// ─── 1) Employees + thông tin lương ──────────────────────────────────────
console.log("\n>>> 1) Employees");
const STAFF_DEFS = [
  { code: "DEMO_001", name: "Trần Mai", position: "Pha chế chính", hourly_rate: 50000 },
  { code: "DEMO_002", name: "Nguyễn Khoa", position: "Pha chế", hourly_rate: 42000 },
  { code: "DEMO_003", name: "Lê Phương", position: "Phục vụ", hourly_rate: 38000 },
  { code: "DEMO_004", name: "Hoàng An", position: "Quản lý ca", hourly_rate: 60000 },
];
const staff = await expect(
  "employees insert",
  await admin.from("employees").insert(STAFF_DEFS).select("id, code, name, position, hourly_rate")
);

// ─── 2) Ingredients + Menu + Recipes ─────────────────────────────────────
console.log("\n>>> 2) Inventory");
const ING_DEFS = [
  { name: "Cà phê hạt Arabica", unit: "kg", low_stock_threshold: 2 },
  { name: "Cà phê hạt Robusta", unit: "kg", low_stock_threshold: 3 },
  { name: "Sữa tươi không đường", unit: "lit", low_stock_threshold: 5 },
  { name: "Sữa đặc", unit: "hộp", low_stock_threshold: 3 },
  { name: "Đường nâu", unit: "kg", low_stock_threshold: 2 },
  { name: "Trà ô long", unit: "g", low_stock_threshold: 200 },
  { name: "Đào ngâm", unit: "hộp", low_stock_threshold: 5 },
  { name: "Đá viên", unit: "kg", low_stock_threshold: 10 },
];
const ingredients = await expect(
  "ingredients insert",
  await admin
    .from("ingredients")
    .insert(ING_DEFS.map((i) => ({ ...i, created_by: OWNER_UID })))
    .select("id, name")
);

const MENU_DEFS = [
  "Espresso",
  "Cà phê đen đá",
  "Cà phê sữa đá",
  "Bạc xỉu",
  "Latte",
  "Cappuccino",
  "Trà đào ô long",
  "Trà sữa nâu",
  "Matcha latte",
  "Cocoa nóng",
];
const menuItems = await expect(
  "menu_items insert",
  await admin
    .from("menu_items")
    .insert(MENU_DEFS.map((name) => ({ name, external_product_name: name, created_by: OWNER_UID })))
    .select("id, name")
);

const recipes = await expect(
  "recipes insert",
  await admin
    .from("recipes")
    .insert(menuItems.map((m) => ({ menu_item_id: m.id, created_by: OWNER_UID })))
    .select("id, menu_item_id")
);

// recipe_items: mỗi recipe có 2-3 nguyên liệu (lượng nhỏ)
const recipeItemRows = [];
for (const r of recipes) {
  const used = new Set();
  const count = rand(2, 3);
  for (let i = 0; i < count; i++) {
    const ing = pick(ingredients);
    if (used.has(ing.id)) continue;
    used.add(ing.id);
    recipeItemRows.push({
      recipe_id: r.id,
      ingredient_id: ing.id,
      quantity: rand(5, 50) / 100, // 0.05 - 0.5
    });
  }
}
await expect("recipe_items insert", await admin.from("recipe_items").insert(recipeItemRows));

// Stock movements (initial purchase)
const stockRows = ingredients.map((i) => ({
  ingredient_id: i.id,
  quantity_delta: rand(20, 80),
  reason: "purchase_received",
  notes: "Demo initial stock",
  created_by: OWNER_UID,
  occurred_at: tsAt(dateOffset(-DAYS_BACK), 8),
}));
await expect("stock_movements insert", await admin.from("stock_movements").insert(stockRows));

// ─── 3) Expense templates + Expenses ────────────────────────────────────
console.log("\n>>> 3) Expenses");
const TEMPLATE_DEFS = [
  { label: "Mua đá viên", default_category_id: catByName["Nguyên liệu"], default_unit: "kg", last_unit_price: 8000 },
  { label: "Tiền điện hàng tháng", default_category_id: catByName["Vận hành"], default_unit: "tháng", last_unit_price: 2500000 },
  { label: "Phụ cấp ca tối", default_category_id: catByName["Lương"], default_unit: "lần", last_unit_price: 50000 },
  { label: "Mua giấy in bill", default_category_id: catByName["Vận hành"], default_unit: "cuộn", last_unit_price: 12000 },
  { label: "Sữa tươi bổ sung", default_category_id: catByName["Nguyên liệu"], default_unit: "thùng", last_unit_price: 380000 },
  { label: "Phí giao hàng linh tinh", default_category_id: catByName["Khác"], default_unit: "lần", last_unit_price: 30000 },
];
const templates = await expect(
  "expense_templates insert",
  await admin.from("expense_templates").insert(TEMPLATE_DEFS).select("id, label, default_category_id, default_unit, last_unit_price")
);

// Daily expenses: only small templates (< 500k). Large ones (điện, sữa thùng) -> bank, once a week.
const smallTemplates = templates.filter((t) => t.last_unit_price < 500_000);
const largeTemplates = templates.filter((t) => t.last_unit_price >= 500_000);
const expenseRows = [];
for (let d = -DAYS_BACK + 1; d <= 0; d++) {
  const date = isoDate(dateOffset(d));
  const num = rand(2, 4);
  for (let i = 0; i < num; i++) {
    const tpl = pick(smallTemplates);
    const qty = pick([1, 1, 1, 2, 0.5]);
    const unitPrice = tpl.last_unit_price * (0.9 + Math.random() * 0.2);
    expenseRows.push({
      business_date: date,
      category_id: tpl.default_category_id,
      template_id: tpl.id,
      description: tpl.label,
      quantity: qty,
      unit: tpl.default_unit,
      unit_price: vnd(unitPrice),
      amount: vnd(unitPrice * qty),
      payment_method: pick(["cash", "cash", "cash", "bank_transfer"]),
      created_by: OWNER_UID,
    });
  }
  // Large expense once per ~7 days, always bank
  if (d % 7 === 0 && largeTemplates.length) {
    const tpl = pick(largeTemplates);
    expenseRows.push({
      business_date: date,
      category_id: tpl.default_category_id,
      template_id: tpl.id,
      description: tpl.label,
      quantity: 1,
      unit: tpl.default_unit,
      unit_price: tpl.last_unit_price,
      amount: tpl.last_unit_price,
      payment_method: "bank_transfer",
      created_by: OWNER_UID,
    });
  }
}
await expect("expenses insert", await admin.from("expenses").insert(expenseRows));

// ─── 4) Sales orders + items + payments + sync_runs ──────────────────────
console.log("\n>>> 4) Sales (POS sync simulation)");
const PRODUCTS = MENU_DEFS.map((name, idx) => ({
  product_id: `KV-${1000 + idx}`,
  product_code: `KV${1000 + idx}`,
  product_name: name,
  category_name: idx < 6 ? "Cà phê" : "Trà & khác",
  price: [25000, 25000, 29000, 32000, 45000, 45000, 38000, 42000, 48000, 35000][idx],
}));

const syncRunRows = [];
const orderRows = [];
const itemRows = [];
const paymentRows = [];

for (let d = -DAYS_BACK + 1; d <= 0; d++) {
  const date = isoDate(dateOffset(d));
  const runId = crypto.randomUUID();
  syncRunRows.push({
    id: runId,
    batch_id: `demo-${date}`,
    source: "kiotviet",
    status: "success",
    started_at: tsAt(dateOffset(d), 22, 30),
    finished_at: tsAt(dateOffset(d), 22, 31),
    business_date_from: date,
    business_date_to: date,
    order_count: 20,
    item_count: 0,
    payment_count: 0,
  });

  const ordersToday = d === 0 ? 14 : rand(15, 25); // hôm nay vừa sync → ít hơn
  let itemTotal = 0;
  let payTotal = 0;
  for (let o = 0; o < ordersToday; o++) {
    const orderId = crypto.randomUUID();
    const hour = 7 + Math.floor(o * (14 / ordersToday)); // 7h-21h
    const purchaseAt = tsAt(dateOffset(d), hour, rand(0, 59));
    const numItems = rand(1, 3);
    let gross = 0;
    for (let li = 0; li < numItems; li++) {
      const p = pick(PRODUCTS);
      const qty = rand(1, 2);
      const lineTotal = p.price * qty;
      gross += lineTotal;
      itemRows.push({
        sales_order_id: orderId,
        line_index: li,
        item_key: `${orderId}-${li}`,
        product_id: p.product_id,
        product_code: p.product_code,
        product_name: p.product_name,
        quantity: qty,
        unit_price: p.price,
        line_total: lineTotal,
        category_name: p.category_name,
      });
      itemTotal++;
    }
    const net = gross;
    orderRows.push({
      id: orderId,
      kiotviet_invoice_id: `INV-${date.replace(/-/g, "")}-${String(o + 1).padStart(3, "0")}`,
      invoice_code: `HD${date.replace(/-/g, "").slice(-6)}${String(o + 1).padStart(3, "0")}`,
      purchase_at: purchaseAt,
      business_date: date,
      branch_name: "Chill Coffee Garden",
      sold_by_name: pick(["Trần Mai", "Nguyễn Khoa", "Lê Phương"]),
      gross_amount: gross,
      net_amount: net,
      total_payment: net,
      status_code: "completed",
      status_value: "Hoàn thành",
      sync_run_id: runId,
    });

    // Payments: 60% cash, 30% bank, 10% mixed
    const r = Math.random();
    if (r < 0.6) {
      paymentRows.push({
        sales_order_id: orderId,
        payment_method: "cash",
        amount: net,
        payment_time: purchaseAt,
      });
      payTotal++;
    } else if (r < 0.9) {
      paymentRows.push({
        sales_order_id: orderId,
        payment_method: "bank_transfer",
        amount: net,
        payment_time: purchaseAt,
      });
      payTotal++;
    } else {
      const cashPart = Math.round(net / 2 / 1000) * 1000;
      paymentRows.push({
        sales_order_id: orderId,
        payment_method: "cash",
        amount: cashPart,
        payment_time: purchaseAt,
      });
      paymentRows.push({
        sales_order_id: orderId,
        payment_method: "bank_transfer",
        amount: net - cashPart,
        payment_time: purchaseAt,
      });
      payTotal += 2;
    }
  }
  // Patch counts in last run
  syncRunRows[syncRunRows.length - 1].item_count = itemTotal;
  syncRunRows[syncRunRows.length - 1].payment_count = payTotal;
}

await expect("sales_sync_runs insert", await admin.from("sales_sync_runs").insert(syncRunRows));
// Chunk orders / items / payments to avoid huge single request
async function insertChunked(table, rows, size = 200) {
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const { error } = await admin.from(table).insert(chunk);
    if (error) throw new Error(`${table} chunk ${i}: ${error.message}`);
  }
  console.log(`  ✓ ${table} insert: ${rows.length} row(s)`);
}
await insertChunked("sales_orders", orderRows);
await insertChunked("sales_order_items", itemRows);
await insertChunked("sales_payments", paymentRows);

// ─── 5) Shifts + Payroll ────────────────────────────────────────────────
console.log("\n>>> 5) Shifts & payroll");
const shiftRows = [];
const payrollRows = [];
for (let d = -DAYS_BACK + 1; d < 0; d++) { // ngày trước hôm nay đã chốt
  const date = isoDate(dateOffset(d));
  // 2-3 ca / ngày
  const shifts = pick([
    [{ in: 7, out: 13 }, { in: 13, out: 21 }],
    [{ in: 7, out: 14 }, { in: 14, out: 21 }, { in: 17, out: 22 }],
  ]);
  for (const sh of shifts) {
    const emp = pick(staff);
    const checkIn = tsAt(dateOffset(d), sh.in);
    const checkOut = tsAt(dateOffset(d), sh.out);
    const minutes = (sh.out - sh.in) * 60;
    const basePay = (minutes / 60) * emp.hourly_rate;
    const shiftId = crypto.randomUUID();
    shiftRows.push({
      id: shiftId,
      employee_id: emp.id,
      business_date: date,
      check_in_at: checkIn,
      check_out_at: checkOut,
      total_minutes: minutes,
      status: "checked_out",
      created_by: OWNER_UID,
    });
    payrollRows.push({
      shift_assignment_id: shiftId,
      employee_id: emp.id,
      business_date: date,
      check_in_at: checkIn,
      check_out_at: checkOut,
      total_minutes: minutes,
      hourly_rate: emp.hourly_rate,
      base_pay: vnd(basePay),
      allowance_amount: 0,
      total_pay: vnd(basePay),
      // Phần lớn trả qua bank để cash flow ngày-trong-ngày dương.
      payment_method: Math.random() < 0.2 ? "cash" : "bank_transfer",
      created_by: OWNER_UID,
    });
  }
}
// Hôm nay: 2 ca, 1 đang in-progress
{
  const date = isoDate(TODAY);
  const e1 = staff[0];
  shiftRows.push({
    id: crypto.randomUUID(),
    employee_id: e1.id,
    business_date: date,
    check_in_at: tsAt(TODAY, 7),
    check_out_at: tsAt(TODAY, 13),
    total_minutes: 360,
    status: "checked_out",
    created_by: OWNER_UID,
  });
  const e2 = staff[1];
  shiftRows.push({
    id: crypto.randomUUID(),
    employee_id: e2.id,
    business_date: date,
    check_in_at: tsAt(TODAY, 13),
    check_out_at: null,
    total_minutes: null,
    status: "checked_in",
    created_by: OWNER_UID,
  });
}
await expect("shift_assignments insert", await admin.from("shift_assignments").insert(shiftRows));
await expect("shift_payroll_records insert", await admin.from("shift_payroll_records").insert(payrollRows));

// ─── 6) Cash openings / counts / drawer events / close reports ──────────
console.log("\n>>> 6) Cash flow");
const cashOpeningRows = [];
const cashCountRows = [];
const cashEventRows = [];
const cashCloseRows = [];
const safeTxRows = [];
let runningSafeBalance = 5_000_000;

for (let d = -DAYS_BACK + 1; d < 0; d++) {
  const date = isoDate(dateOffset(d));
  const openingId = crypto.randomUUID();
  const openingTotal = 500_000;
  const denoms = { "500000": 0, "200000": 1, "100000": 2, "50000": 1, "20000": 1, "10000": 1, "5000": 0, "2000": 0, "1000": 0 };
  cashOpeningRows.push({
    id: openingId,
    business_date: date,
    denominations_json: denoms,
    opening_total: openingTotal,
    carried_from_previous_day: true,
    carried_amount: openingTotal,
    safe_withdrawal_amount: 0,
    created_by: OWNER_UID,
  });

  // Drawer events: tổng cash sale của ngày + một vài expense cash + payroll cash
  const dayOrders = orderRows.filter((o) => o.business_date === date);
  const cashOrders = paymentRows
    .filter((p) => p.payment_method === "cash" && dayOrders.find((o) => o.id === p.sales_order_id));
  const cashSales = cashOrders.reduce((s, p) => s + Number(p.amount), 0);
  const dayExpenses = expenseRows.filter((e) => e.business_date === date && e.payment_method === "cash");
  const cashExpenses = dayExpenses.reduce((s, e) => s + e.amount, 0);
  const dayPayroll = payrollRows.filter((p) => p.business_date === date && p.payment_method === "cash");
  const cashPayroll = dayPayroll.reduce((s, p) => s + p.total_pay, 0);

  const posTotal = dayOrders.reduce((s, o) => s + Number(o.net_amount), 0);
  const posNonCash = posTotal - cashSales;

  const countId = crypto.randomUUID();
  const physicalCash = openingTotal + cashSales - cashExpenses - cashPayroll;
  const safeDeposit = Math.max(0, Math.floor((physicalCash - 500_000) / 100_000) * 100_000);
  const leaveForNext = physicalCash - safeDeposit;

  // count_type='close'
  const countDenoms = (() => {
    const remaining = leaveForNext;
    return { "500000": 0, "200000": Math.floor(remaining / 200_000), "100000": Math.floor((remaining % 200_000) / 100_000), "50000": 0, "20000": 0, "10000": 0, "5000": 0, "2000": 0, "1000": 0 };
  })();

  cashCountRows.push({
    id: countId,
    business_date: date,
    counted_at: tsAt(dateOffset(d), 22),
    count_type: "day_close",
    denominations_json: countDenoms,
    total_physical: physicalCash,
    total_theory: physicalCash,
    difference: 0,
    pos_total: posTotal,
    pos_cash_total: cashSales,
    pos_non_cash_total: posNonCash,
    opening_cash: openingTotal,
    bank_transfer_confirmed: posNonCash,
    reconciliation_total: physicalCash,
    counted_by: OWNER_UID,
  });

  // Close report
  cashCloseRows.push({
    business_date: date,
    cash_count_id: countId,
    closed_at: tsAt(dateOffset(d), 22, 30),
    closed_by: OWNER_UID,
    pos_total: posTotal,
    opening_cash: openingTotal,
    pos_cash_total: cashSales,
    pos_non_cash_total: posNonCash,
    bank_transfer_confirmed: posNonCash,
    expense_cash_total: cashExpenses,
    payroll_cash_total: cashPayroll,
    theory_cash: physicalCash,
    reconciliation_total: physicalCash,
    physical_cash: physicalCash,
    difference: 0,
    denominations_json: countDenoms,
    report_status: "final",
    safe_deposit_amount: safeDeposit,
    leave_for_next_day: leaveForNext,
  });

  // Safe transaction (deposit to safe)
  if (safeDeposit > 0) {
    runningSafeBalance += safeDeposit;
    safeTxRows.push({
      occurred_at: tsAt(dateOffset(d), 22, 45),
      transaction_type: "deposit_close",
      amount: safeDeposit,
      balance_after: runningSafeBalance,
      reason_category: "end_of_day_deposit",
      description: `Nộp két cuối ngày ${date}`,
      created_by: OWNER_UID,
    });
  }
}

// Hôm nay: chỉ có opening, chưa close
{
  const date = isoDate(TODAY);
  cashOpeningRows.push({
    id: crypto.randomUUID(),
    business_date: date,
    denominations_json: { "200000": 1, "100000": 2, "50000": 1, "20000": 1, "10000": 1 },
    opening_total: 500_000,
    carried_from_previous_day: true,
    carried_amount: 500_000,
    safe_withdrawal_amount: 0,
    created_by: OWNER_UID,
  });
}

await expect("cash_day_openings insert", await admin.from("cash_day_openings").insert(cashOpeningRows));
await expect("cash_counts insert", await admin.from("cash_counts").insert(cashCountRows));
await expect("cash_close_reports insert", await admin.from("cash_close_reports").insert(cashCloseRows));
await expect("safe_transactions insert", await admin.from("safe_transactions").insert(safeTxRows));

// ─── 7) Handover sessions + tasks ────────────────────────────────────────
console.log("\n>>> 7) Handover");
const handoverSessionRows = [];
const handoverTaskRows = [];
const DEFAULT_TASKS = [
  "Đã vệ sinh quầy và máy pha",
  "Đã kiểm tra nguyên liệu cần bổ sung",
  "Đã chuẩn bị tiền lẻ/két cho ca sau",
  "Đã ghi chú bàn giao cho ca sau",
];
for (let d = -DAYS_BACK + 1; d <= 0; d++) {
  const date = isoDate(dateOffset(d));
  const sessionId = crypto.randomUUID();
  const isToday = d === 0;
  handoverSessionRows.push({
    id: sessionId,
    business_date: date,
    status: isToday ? "draft" : "completed",
    note: isToday ? "Chuyển ca chiều" : `Bàn giao ${date}`,
    created_by: OWNER_UID,
    completed_at: isToday ? null : tsAt(dateOffset(d), 22, 50),
  });
  DEFAULT_TASKS.forEach((label, i) => {
    handoverTaskRows.push({
      session_id: sessionId,
      task_key: `task_${i + 1}`,
      label,
      is_done: isToday ? i < 2 : true,
      checked_by: isToday && i < 2 ? OWNER_UID : !isToday ? OWNER_UID : null,
      checked_at: isToday && i < 2 ? tsAt(TODAY, 14) : !isToday ? tsAt(dateOffset(d), 22, 50) : null,
      sort_order: (i + 1) * 100,
    });
  });
}
await expect("handover_sessions insert", await admin.from("handover_sessions").insert(handoverSessionRows));
await expect("handover_tasks insert", await admin.from("handover_tasks").insert(handoverTaskRows));

console.log("\n✓ Seed-demo hoàn tất.");
console.log(`  Sales orders: ${orderRows.length}`);
console.log(`  Sales items: ${itemRows.length}`);
console.log(`  Sales payments: ${paymentRows.length}`);
console.log(`  Expenses: ${expenseRows.length}`);
console.log(`  Shifts: ${shiftRows.length}`);
console.log(`  Payroll records: ${payrollRows.length}`);
console.log(`  Cash close reports: ${cashCloseRows.length}`);
console.log(`  Handover sessions: ${handoverSessionRows.length}`);
