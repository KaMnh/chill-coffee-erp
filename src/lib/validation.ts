/**
 * Centralised validation helpers — mirror SQL CHECK constraints
 * defined in `database/001_schema.sql` and length guards in
 * `database/002_functions.sql`. Single source of truth = SQL.
 * Use these client-side for instant UX feedback only.
 */

export const limits = {
  description: 500,
  note: 1000,
  quantity: { min: 0, max: 99999 },
  amount: { min: 0, max: 1_000_000_000 },
  unitPrice: { min: 0, max: 1_000_000_000 },
  hourlyRate: { min: 0, max: 10_000_000 },
  basePay: { min: 0, max: 1_000_000_000 },
  totalPay: { min: 0, max: 1_000_000_000 },
  denomCount: { min: 0, max: 10000 },
  denominationKeys: ["1000", "2000", "5000", "10000", "20000", "50000", "100000", "200000", "500000"]
} as const;

export type ValidationResult = { ok: true } | { ok: false; field: string; message: string };

function ok(): ValidationResult {
  return { ok: true };
}

function fail(field: string, message: string): ValidationResult {
  return { ok: false, field, message };
}

function inRange(value: number, range: { min: number; max: number }) {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

// ---- Expense ----
export type ExpenseInput = {
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  note?: string;
};

export function validateExpense(input: ExpenseInput): ValidationResult {
  if (!input.description?.trim()) return fail("description", "Nội dung không được để trống.");
  if (input.description.length > limits.description)
    return fail("description", `Nội dung tối đa ${limits.description} ký tự.`);
  if (!inRange(input.quantity, limits.quantity))
    return fail("quantity", `Số lượng phải từ ${limits.quantity.min} đến ${limits.quantity.max}.`);
  if (!inRange(input.unit_price, limits.unitPrice))
    return fail("unit_price", `Đơn giá phải từ ${limits.unitPrice.min} đến ${limits.unitPrice.max}.`);
  if (!inRange(input.amount, limits.amount))
    return fail("amount", `Thành tiền phải từ ${limits.amount.min} đến ${limits.amount.max}.`);
  if ((input.note?.length ?? 0) > limits.note) return fail("note", `Ghi chú tối đa ${limits.note} ký tự.`);
  return ok();
}

// ---- Employee ----
export type EmployeeInput = {
  name: string;
  hourly_rate: number;
};

export function validateEmployee(input: EmployeeInput): ValidationResult {
  if (!input.name?.trim()) return fail("name", "Tên nhân viên không được để trống.");
  if (input.name.length > 200) return fail("name", "Tên nhân viên tối đa 200 ký tự.");
  if (!inRange(input.hourly_rate, limits.hourlyRate))
    return fail("hourly_rate", `Lương theo giờ phải từ ${limits.hourlyRate.min} đến ${limits.hourlyRate.max}.`);
  return ok();
}

// ---- Payroll edit ----
export type PayrollEditInput = {
  check_in_at: string | null;
  check_out_at: string | null;
  allowance_amount: number;
  note?: string;
};

export function validatePayrollEdit(input: PayrollEditInput): ValidationResult {
  if (!input.check_in_at) return fail("check_in_at", "Cần giờ vào.");
  if (!input.check_out_at) return fail("check_out_at", "Cần giờ ra.");
  if (new Date(input.check_out_at).getTime() < new Date(input.check_in_at).getTime())
    return fail("check_out_at", "Giờ ra không được nhỏ hơn giờ vào.");
  if (!inRange(input.allowance_amount, limits.amount))
    return fail("allowance_amount", `Bồi dưỡng phải từ ${limits.amount.min} đến ${limits.amount.max}.`);
  if ((input.note?.length ?? 0) > limits.note) return fail("note", `Ghi chú tối đa ${limits.note} ký tự.`);
  return ok();
}

// ---- Cash count denominations ----
export function validateDenominations(counts: Record<string | number, unknown>): ValidationResult {
  for (const [key, value] of Object.entries(counts ?? {})) {
    if (!limits.denominationKeys.includes(key as (typeof limits.denominationKeys)[number])) {
      return fail("denominations_json", `Mệnh giá ${key} không hợp lệ. Chỉ chấp nhận VND 1k-500k.`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < limits.denomCount.min || numeric > limits.denomCount.max) {
      return fail(
        "denominations_json",
        `Số tờ mệnh giá ${key} phải từ ${limits.denomCount.min} đến ${limits.denomCount.max}.`
      );
    }
  }
  return ok();
}

// ---- Cash count submit ----
export type CashCountInput = {
  total_physical: number;
  bank_transfer_confirmed: number;
  note?: string;
  denominations_json: Record<string | number, unknown>;
};

export function validateCashCount(input: CashCountInput): ValidationResult {
  const denomResult = validateDenominations(input.denominations_json);
  if (!denomResult.ok) return denomResult;
  if (!inRange(input.total_physical, limits.amount))
    return fail("total_physical", "Tiền thực đếm không hợp lệ.");
  if (!inRange(input.bank_transfer_confirmed, limits.amount))
    return fail("bank_transfer_confirmed", "Tiền chuyển khoản không hợp lệ.");
  if ((input.note?.length ?? 0) > limits.note) return fail("note", `Ghi chú tối đa ${limits.note} ký tự.`);
  return ok();
}

// ---- Handover note ----
export function validateHandoverNote(note: string): ValidationResult {
  if (note.length > limits.note) return fail("note", `Ghi chú tối đa ${limits.note} ký tự.`);
  return ok();
}

// ---- Safe ledger ----
export type SafeSetupInput = {
  cash: number;
  transfer: number;
  note?: string;
};

export function validateSafeSetup(input: SafeSetupInput): ValidationResult {
  if (!inRange(input.cash, { min: 0, max: limits.amount.max }))
    return fail("cash", `Quỹ tiền mặt phải từ 0 đến ${limits.amount.max}.`);
  if (!inRange(input.transfer, { min: 0, max: limits.amount.max }))
    return fail("transfer", `Quỹ chuyển khoản phải từ 0 đến ${limits.amount.max}.`);
  if (input.cash + input.transfer <= 0)
    return fail("cash", "Tổng số dư mở đầu phải lớn hơn 0.");
  if ((input.note?.length ?? 0) > limits.note)
    return fail("note", `Ghi chú tối đa ${limits.note} ký tự.`);
  return ok();
}

export type SafeWithdrawInput = {
  amount: number;
  category: string;
  description?: string;
};

const SAFE_WITHDRAW_CATEGORIES = ["utilities", "rent", "inventory", "maintenance", "other"] as const;

export function validateSafeWithdraw(
  input: SafeWithdrawInput,
  currentBalance: number
): ValidationResult {
  if (!inRange(input.amount, { min: 1, max: limits.amount.max }))
    return fail("amount", `Số tiền phải từ 1 đến ${limits.amount.max}.`);
  if (input.amount > currentBalance)
    return fail("amount", `Sổ quỹ không đủ. Số dư hiện tại: ${currentBalance}.`);
  if (!SAFE_WITHDRAW_CATEGORIES.includes(input.category as (typeof SAFE_WITHDRAW_CATEGORIES)[number]))
    return fail("category", "Hạng mục không hợp lệ.");
  if ((input.description?.length ?? 0) > limits.note)
    return fail("description", `Mô tả tối đa ${limits.note} ký tự.`);
  return ok();
}

export type SafeAdjustInput = {
  newBalance: number;
  note: string;
};

export function validateSafeAdjust(
  input: SafeAdjustInput,
  currentBalance: number
): ValidationResult {
  if (!inRange(input.newBalance, { min: 0, max: limits.amount.max }))
    return fail("newBalance", `Số dư mới phải từ 0 đến ${limits.amount.max}.`);
  if (input.newBalance === currentBalance)
    return fail("newBalance", "Số dư mới phải khác số dư hiện tại.");
  if ((input.note?.trim().length ?? 0) < 5)
    return fail("note", "Lý do điều chỉnh phải ≥ 5 ký tự.");
  if (input.note.length > limits.note)
    return fail("note", `Lý do tối đa ${limits.note} ký tự.`);
  return ok();
}
