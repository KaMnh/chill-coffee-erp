/**
 * Mock data cho mobile preview — KHÔNG gọi DB/API.
 *
 * Hai kịch bản dữ liệu: "on" (ngày ổn) và "warn" (ngày có cảnh báo —
 * két lệch, POS sync lỗi, nguyên liệu sắp hết, nhân viên chưa check-out).
 * Hai chế độ render thêm ("loading" / "empty") do view tự xử lý bằng
 * Skeleton / EmptyState — không cần data ở đây.
 *
 * Số liệu lấy theo data shape thật của từng feature (xem khảo sát trong
 * docs/superpowers/specs/2026-06-11-mobile-uiux-design.md).
 */

export type PreviewRole = "staff" | "owner";
export type Scenario = "on" | "warn" | "loading" | "empty";

export const ROLE_LABEL: Record<PreviewRole, string> = {
  staff: "Nhân viên vận hành",
  owner: "Chủ quán",
};

export const ACCOUNT_BY_ROLE: Record<PreviewRole, { name: string; initials: string }> = {
  staff: { name: "Nguyễn Thu Trang", initials: "TT" },
  owner: { name: "Lê Hoàng Nam", initials: "HN" },
};

export const BUSINESS_DATE = "2026-06-11";

/* ===== Dashboard (Bảng vận hành) ===== */

export interface DashboardMock {
  totalSales: number;
  totalExpenses: number;
  payrollPaid: number;
  activeStaff: number;
  safeTotal: number; // đề xuất cho owner — thanh khoản
  drawerNow: number; // tiền két ước tính hiện tại
  syncOk: boolean;
  syncAt: string;
  peakHour: string;
  salesFeed: Array<{ code: string; method: string; seller: string; time: string; amount: number }>;
  expenseLog: Array<{ desc: string; category: string; time: string; amount: number }>;
  handoverDone: number;
  handoverTotal: number;
  stock: Array<{ name: string; qty: string; low?: boolean; negative?: boolean }>;
  cashDiff: number; // chênh lệch kiểm két gần nhất
  staffNotCheckedOut: number;
}

const DASHBOARD_ON: DashboardMock = {
  totalSales: 4_850_000,
  totalExpenses: 1_235_000,
  payrollPaid: 760_000,
  activeStaff: 3,
  safeTotal: 17_050_000,
  drawerNow: 2_340_000,
  syncOk: true,
  syncAt: "14:30",
  peakHour: "19:00–20:00",
  salesFeed: [
    { code: "HD00231", method: "Tiền mặt", seller: "Linh", time: "14:32", amount: 65_000 },
    { code: "HD00230", method: "Chuyển khoản", seller: "Trang", time: "14:18", amount: 118_000 },
    { code: "HD00229", method: "MoMo", seller: "Linh", time: "13:55", amount: 49_000 },
    { code: "HD00228", method: "Tiền mặt", seller: "Huy", time: "13:41", amount: 92_000 },
    { code: "HD00227", method: "ZaloPay", seller: "Trang", time: "13:22", amount: 57_000 },
  ],
  expenseLog: [
    { desc: "Sữa tươi Vinamilk 4 hộp", category: "Nguyên liệu", time: "08:15", amount: 152_000 },
    { desc: "Cà phê hạt Robusta 2kg", category: "Nguyên liệu", time: "09:40", amount: 380_000 },
    { desc: "Đá viên 5 bao", category: "Vận hành", time: "10:05", amount: 75_000 },
    { desc: "Ống hút giấy + ly nhựa", category: "Vật tư", time: "13:20", amount: 128_000 },
  ],
  handoverDone: 3,
  handoverTotal: 6,
  stock: [
    { name: "Cà phê hạt Robusta", qty: "3,2 kg", low: true },
    { name: "Sữa tươi Vinamilk", qty: "14 hộp" },
    { name: "Đường cát", qty: "8 kg" },
    { name: "Trân châu đen", qty: "2,5 kg", low: true },
  ],
  cashDiff: 0,
  staffNotCheckedOut: 0,
};

const DASHBOARD_WARN: DashboardMock = {
  ...DASHBOARD_ON,
  syncOk: false,
  syncAt: "11:02",
  cashDiff: -50_000,
  staffNotCheckedOut: 2,
  stock: [
    { name: "Sữa đặc Ông Thọ", qty: "−1 lon", negative: true },
    { name: "Cà phê hạt Robusta", qty: "3,2 kg", low: true },
    { name: "Trân châu đen", qty: "2,5 kg", low: true },
    { name: "Sữa tươi Vinamilk", qty: "14 hộp" },
  ],
};

/* ===== Chốt két ===== */

export const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];

export interface CashMock {
  opening: number;
  counts: Record<string, number>;
  posTotal: number;
  posCash: number;
  posNonCash: number;
  bankTransfer: number;
  expenseCash: number;
  payrollCash: number;
  history: Array<{ type: "spot" | "close"; time: string; physical: number; diff: number; note: string }>;
}

const CASH_ON: CashMock = {
  opening: 1_500_000,
  // Tổng = 4.520.000 ₫ — khớp công thức đối soát để kịch bản "ngày ổn" lệch 0 ₫:
  // physical = posTotal + opening − bankTransfer − expenseCash − payrollCash.
  counts: { "500000": 2, "200000": 3, "100000": 10, "50000": 24, "20000": 20, "10000": 25, "5000": 10, "2000": 5, "1000": 10 },
  posTotal: 8_250_000,
  posCash: 3_150_000,
  posNonCash: 5_100_000,
  bankTransfer: 5_100_000,
  expenseCash: 95_000,
  payrollCash: 35_000,
  history: [
    { type: "spot", time: "11:30", physical: 2_340_000, diff: 0, note: "Kiểm giữa ca sáng" },
    { type: "spot", time: "15:45", physical: 3_180_000, diff: -20_000, note: "Thiếu 20k, nghi thối nhầm bàn 7" },
  ],
};

// Kịch bản cảnh báo: chuyển khoản xác nhận thiếu 50k → lệch −50.000 ₫.
const CASH_WARN: CashMock = { ...CASH_ON, bankTransfer: 5_050_000 };

/* ===== Chi phí ===== */

export const EXPENSE_CATEGORIES = ["Nguyên liệu", "Vận hành", "Nhân sự", "Sửa chữa", "Khác"];

export const EXPENSE_TEMPLATES = [
  { label: "Bánh mì", price: 25_000, unit: "ổ" },
  { label: "Đá viên", price: 35_000, unit: "bao" },
  { label: "Sữa đặc Ông Thọ", price: 32_000, unit: "lon" },
  { label: "Cà phê hạt Robusta", price: 120_000, unit: "kg" },
  { label: "Gas đổi bình", price: 420_000, unit: "bình" },
];

export interface ExpenseRow {
  desc: string;
  category: string;
  time: string;
  amount: number;
}

const EXPENSES_ON: ExpenseRow[] = [
  { desc: "Gas đổi bình", category: "Vận hành", time: "16:20", amount: 420_000 },
  { desc: "Ship nước rửa ly", category: "Vận hành", time: "14:05", amount: 18_000 },
  { desc: "Sửa máy xay", category: "Sửa chữa", time: "11:40", amount: 350_000 },
  { desc: "Sữa đặc 5 lon", category: "Nguyên liệu", time: "09:15", amount: 160_000 },
  { desc: "Bánh mì 10 ổ", category: "Nguyên liệu", time: "07:30", amount: 25_000 },
  { desc: "Đá viên 3 bao", category: "Nguyên liệu", time: "07:10", amount: 105_000 },
  { desc: "Cà phê hạt Robusta 2kg", category: "Nguyên liệu", time: "06:45", amount: 240_000 },
];

/* ===== Bàn giao ===== */

export interface HandoverMock {
  tasks: Array<{ id: string; label: string; done: boolean; at?: string }>;
  note: string;
  staffInShift: number;
}

const HANDOVER_ON: HandoverMock = {
  tasks: [
    { id: "t1", label: "Vệ sinh máy pha espresso", done: true, at: "21:15" },
    { id: "t2", label: "Kiểm đếm két tiền mặt", done: true, at: "21:32" },
    { id: "t3", label: "Đổ rác & lau sàn khu pha chế", done: true, at: "21:40" },
    { id: "t4", label: "Tắt máy lạnh & đèn bảng hiệu", done: false },
    { id: "t5", label: "Kiểm kê sữa tươi & topping", done: false },
    { id: "t6", label: "Khóa cửa kho", done: false },
  ],
  note: "Máy xay #2 kêu to khi xay đá — gọi thợ sáng mai. Sữa tươi còn 4 hộp, nhớ nhập thêm.",
  staffInShift: 0,
};

const HANDOVER_WARN: HandoverMock = { ...HANDOVER_ON, staffInShift: 2 };

/* ===== Ca & lương ===== */

export interface ShiftEmployee {
  name: string;
  position: string;
  rate: number;
  status: "in" | "out" | "none";
  since?: string;
}

const SHIFT_EMPLOYEES: ShiftEmployee[] = [
  { name: "Nguyễn Thị Lan", position: "Thu ngân", rate: 26_000, status: "in", since: "07:30" },
  { name: "Trần Văn Minh", position: "Pha chế", rate: 30_000, status: "in", since: "08:00" },
  { name: "Lê Hoàng Nam", position: "Pha chế", rate: 28_000, status: "out", since: "06:00–14:15" },
  { name: "Phạm Thu Hà", position: "Phục vụ", rate: 24_000, status: "none" },
];

export const PAYROLL_ROWS = [
  { name: "Lê Hoàng Nam", duration: "8:15 giờ", bonus: 10_000, total: 241_000, edited: false },
  { name: "Phạm Thu Hà", duration: "5:30 giờ", bonus: 0, total: 132_000, edited: true },
];

/* ===== Sổ quỹ (owner) ===== */

export interface SafeMock {
  cash: number;
  transfer: number;
  txnCount: number;
  history: Array<{
    time: string;
    type: string;
    fund: "Tiền mặt" | "Chuyển khoản";
    amount: number;
    balanceAfter: number;
    desc: string;
  }>;
}

const SAFE_ON: SafeMock = {
  cash: 4_250_000,
  transfer: 12_800_000,
  txnCount: 23,
  history: [
    { time: "10/06 21:45", type: "Nạp từ chốt két", fund: "Tiền mặt", amount: 1_850_000, balanceAfter: 4_250_000, desc: "Chốt két ca tối 10/06" },
    { time: "10/06 07:05", type: "Rút mở két", fund: "Tiền mặt", amount: -500_000, balanceAfter: 2_400_000, desc: "Tiền lẻ mở ca sáng" },
    { time: "09/06 14:20", type: "Rút khác", fund: "Chuyển khoản", amount: -1_350_000, balanceAfter: 12_800_000, desc: "Tiền điện tháng 5 — EVN" },
    { time: "08/06 10:00", type: "Rút khác", fund: "Chuyển khoản", amount: -4_000_000, balanceAfter: 14_150_000, desc: "Thuê mặt bằng tháng 6" },
    { time: "07/06 09:30", type: "Nhập nguyên liệu", fund: "Tiền mặt", amount: -820_000, balanceAfter: 2_900_000, desc: "Nhập cà phê + sữa đầu tuần" },
    { time: "05/06 18:00", type: "Điều chỉnh", fund: "Tiền mặt", amount: -50_000, balanceAfter: 3_720_000, desc: "Đếm két phát hiện lệch 50k" },
  ],
};

/* ===== Kho ===== */

export const INVENTORY_TABS = ["Tồn kho", "Nguyên liệu", "Sản phẩm", "Công thức", "Tổng quan"];

export const INVENTORY_STOCK = [
  { name: "Cà phê hạt Robusta", qty: 3.2, unit: "kg", low: true },
  { name: "Sữa tươi Vinamilk", qty: 14, unit: "hộp", low: false },
  { name: "Sữa đặc Ông Thọ", qty: -1, unit: "lon", low: false },
  { name: "Đường cát", qty: 8, unit: "kg", low: false },
  { name: "Trân châu đen", qty: 2.5, unit: "kg", low: true },
  { name: "Trà ô long", qty: 4, unit: "gói", low: false },
];

export const INVENTORY_INGREDIENTS = [
  { name: "Cà phê hạt Robusta", unit: "kg", price: 185_000 },
  { name: "Sữa đặc Ông Thọ", unit: "lon", price: 28_000 },
  { name: "Sữa tươi Vinamilk", unit: "hộp", price: 38_000 },
  { name: "Đường cát", unit: "kg", price: 21_000 },
  { name: "Trân châu đen", unit: "kg", price: 65_000 },
];

export const INVENTORY_PRODUCTS = [
  { name: "Cà phê sữa đá", category: "Cà phê", price: 29_000 },
  { name: "Bạc xỉu", category: "Cà phê", price: 35_000 },
  { name: "Trà đào cam sả", category: "Trà trái cây", price: 45_000 },
  { name: "Trà sữa trân châu", category: "Trà sữa", price: 39_000 },
];

export const INVENTORY_RECIPES = [
  { product: "Cà phê sữa đá", lines: "25 g cà phê · 30 ml sữa đặc · đá" },
  { product: "Bạc xỉu", lines: "15 g cà phê · 40 ml sữa đặc · 60 ml sữa tươi" },
  { product: "Trà đào cam sả", lines: "8 g trà · 40 ml syrup đào · cam + sả" },
];

/* ===== Báo cáo ===== */

export const REPORT_TABS = ["Chốt két", "Tồn kho", "Doanh số", "Chi phí + lương", "Theo giờ"];

export const CASH_CLOSE_REPORT = {
  date: BUSINESS_DATE,
  closedAt: "21:35 · 11/06/2026",
  status: "Đã chốt",
  rows: [
    ["Tổng POS", 4_850_000],
    ["POS tiền mặt", 3_120_000],
    ["POS không tiền mặt", 1_730_000],
    ["Tiền đầu ngày", 500_000],
    ["Thực đếm trong két", 3_578_000],
    ["Chuyển khoản đã nhận", 1_730_000],
    ["Chi phí cash", 185_000],
    ["Lương đã phát", 420_000],
    ["Tổng đối soát", 3_580_000],
  ] as Array<[string, number]>,
  difference: -2_000,
  leaveNextDay: 500_000,
  safeDeposit: 3_078_000,
  note: "Thiếu 2k tiền lẻ thối khách",
};

export const REPORT_DATES = [
  { label: "11/06", diff: -2_000, status: "Đã chốt" },
  { label: "10/06", diff: 0, status: "Đã chốt" },
  { label: "09/06", diff: 15_000, status: "Nháp" },
];

export const PRODUCT_SUMMARY = [
  { name: "Cà phê sữa đá", category: "Cà phê", qty: 86, revenue: 2_150_000 },
  { name: "Bạc xỉu", category: "Cà phê", qty: 54, revenue: 1_485_000 },
  { name: "Trà đào cam sả", category: "Trà trái cây", qty: 41, revenue: 1_353_000 },
  { name: "Cà phê đen đá", category: "Cà phê", qty: 47, revenue: 940_000 },
  { name: "Trà sữa trân châu", category: "Trà sữa", qty: 28, revenue: 980_000 },
];

export const EXPENSE_BY_CATEGORY = [
  { name: "Nguyên liệu", amount: 1_250_000, count: 4 },
  { name: "Điện nước", amount: 680_000, count: 2 },
  { name: "Sửa chữa", amount: 320_000, count: 1 },
  { name: "Vận chuyển", amount: 145_000, count: 3 },
];

export const PAYROLL_SUMMARY = [
  { name: "Nguyễn Thị Hoa", total: 1_260_000, shifts: 6, hours: "48 giờ" },
  { name: "Trần Văn Minh", total: 1_050_000, shifts: 5, hours: "42:30 giờ" },
  { name: "Lê Thu Trang", total: 840_000, shifts: 4, hours: "33:15 giờ" },
];

/** Doanh thu theo giờ (06:00–22:00), đơn vị nghìn ₫ — đủ cho bar chart nhỏ. */
export const HOURLY_REVENUE = [
  { hour: "06", value: 120 }, { hour: "07", value: 380 }, { hour: "08", value: 460 },
  { hour: "09", value: 350 }, { hour: "10", value: 280 }, { hour: "11", value: 310 },
  { hour: "12", value: 240 }, { hour: "13", value: 220 }, { hour: "14", value: 260 },
  { hour: "15", value: 330 }, { hour: "16", value: 300 }, { hour: "17", value: 290 },
  { hour: "18", value: 420 }, { hour: "19", value: 540 }, { hour: "20", value: 510 },
  { hour: "21", value: 260 }, { hour: "22", value: 90 },
];

/* ===== Pivot ===== */

export const PIVOT_ORDERS = [
  { code: "HD003426", seller: "Quốc Bảo", method: "Tiền mặt", amount: 156_000, time: "13:20" },
  { code: "HD003425", seller: "Ngọc Anh", method: "ZaloPay", amount: 92_000, time: "11:47" },
  { code: "HD003424", seller: "POS", method: "Thẻ", amount: 215_000, time: "10:30" },
  { code: "HD003423", seller: "Thu Hà", method: "Chuyển khoản", amount: 64_000, time: "09:03" },
  { code: "HD003422", seller: "Minh Khoa", method: "MoMo", amount: 125_000, time: "08:15" },
  { code: "HD003421", seller: "Ngọc Anh", method: "Tiền mặt", amount: 78_000, time: "07:42" },
  { code: "DH000877", seller: "POS", method: "—", amount: 47_000, time: "07:12" },
];

export const PIVOT_TOTAL = { amount: 4_385_000, orders: 23 };

/* ===== Dòng tiền ===== */

export const CASHFLOW = {
  period: "01/06 — 30/06/2026",
  lunar: "Âm: 17/4 — 16/5 năm Bính Ngọ",
  in: 86_450_000,
  out: 31_780_000,
  net: 54_670_000,
  deltaIn: "+12%",
  deltaOut: "−5%",
  deltaNet: "+25%",
  byDay: [
    { d: "05/06", in: 2_650_000, out: 900_000 },
    { d: "06/06", in: 3_100_000, out: 1_400_000 },
    { d: "07/06", in: 4_400_000, out: 600_000 },
    { d: "08/06", in: 2_950_000, out: 1_120_000 },
    { d: "09/06", in: 3_420_000, out: 680_000 },
    { d: "10/06", in: 4_150_000, out: 2_310_000 },
    { d: "11/06", in: 4_850_000, out: 1_235_000 },
  ],
  breakdown: [
    { name: "Nguyên liệu", amount: 14_500_000, pct: 46 },
    { name: "Nhân sự", amount: 9_800_000, pct: 31 },
    { name: "Điện nước", amount: 3_280_000, pct: 10 },
    { name: "Marketing", amount: 2_400_000, pct: 8 },
    { name: "(chưa phân loại)", amount: 1_800_000, pct: 6 },
  ],
};

/* ===== Truy xuất theo kịch bản ===== */

export interface PreviewData {
  dashboard: DashboardMock;
  cash: CashMock;
  expenses: ExpenseRow[];
  handover: HandoverMock;
  shiftEmployees: ShiftEmployee[];
  safe: SafeMock;
}

export function getPreviewData(scenario: Scenario): PreviewData {
  const warn = scenario === "warn";
  return {
    dashboard: warn ? DASHBOARD_WARN : DASHBOARD_ON,
    cash: warn ? CASH_WARN : CASH_ON,
    expenses: EXPENSES_ON,
    handover: warn ? HANDOVER_WARN : HANDOVER_ON,
    shiftEmployees: SHIFT_EMPLOYEES,
    safe: SAFE_ON,
  };
}
