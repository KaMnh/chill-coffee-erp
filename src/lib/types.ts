export type UserRole = "owner" | "manager" | "staff_operator" | "employee_viewer";

export type Account = {
  id: string;
  auth_user_id: string;
  employee_id: string | null;
  role: UserRole;
  status: string;
  employee?: {
    name: string;
    position: string | null;
  } | null;
  sidebar_config?: string[] | null;
};

export type AppSettings = {
  sidebar_defaults: Partial<Record<UserRole, string[]>>;
  handover_default_tasks: Array<{ key: string; label: string }>;
  denominations?: number[];
  cash_diff_threshold?: Record<string, number>;
};

export type SettingsAccount = {
  id: string;
  auth_user_id: string;
  role: UserRole;
  status: string;
  employee_name: string | null;
  employee_position: string | null;
  sidebar_config: string[] | null;
};

export type DashboardData = {
  business_date: string;
  total_sales: number;
  cash_sales: number;
  non_cash_sales?: number;
  opening_cash?: number;
  total_expenses: number;
  payroll_paid: number;
  active_staff: number;
  latest_cash_count?: CashCount | null;
  latest_sync?: SalesSyncRun | null;
  expenses: Expense[];
  sales_orders: SalesOrder[];
};

export type ExpenseCategory = {
  id: string;
  name: string;
  type?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
};

export type Expense = {
  id: string;
  business_date: string;
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  note: string | null;
  created_at: string;
  category_id?: string | null;
  category_name?: string | null;
};

export type Employee = {
  id: string;
  code: string | null;
  name: string;
  position: string | null;
  hourly_rate: number;
  is_active: boolean;
};

export type ShiftAssignment = {
  id: string;
  employee_id: string;
  business_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  total_minutes: number | null;
  status: string;
  employee_name?: string | null;
  position?: string | null;
};

export type PayrollRecord = {
  id: string;
  shift_assignment_id: string | null;
  employee_id: string;
  business_date: string;
  check_in_at: string | null;
  check_out_at: string | null;
  total_minutes: number;
  hourly_rate: number;
  base_pay: number;
  allowance_amount: number;
  total_pay: number;
  note: string | null;
  created_at: string;
  edited_at?: string | null;
  employee_name?: string | null;
};

export type SalesOrder = {
  id: string;
  invoice_code: string | null;
  order_code?: string | null;
  sold_by_name: string | null;
  payment_method?: string | null;
  net_amount: number | null;
  total_payment?: number | null;
  purchase_at: string;
};

export type SalesSyncRun = {
  id: string;
  source: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
};

export type CashCount = {
  id: string;
  business_date: string;
  count_type: string;
  counted_at: string;
  total_physical: number;
  total_theory: number;
  difference: number;
  pos_total?: number | null;
  pos_cash_total?: number | null;
  pos_non_cash_total?: number | null;
  opening_cash?: number | null;
  bank_transfer_confirmed?: number | null;
  reconciliation_total?: number | null;
  denominations_json?: Record<string, number> | null;
  note?: string | null;
  report_id?: string | null;
  report_status?: string | null;
};

export type SafeTransactionType =
  | "initial_setup"
  | "deposit_close"
  | "withdraw_open"
  | "withdraw_other"
  | "adjustment";

export type SafeWithdrawCategory =
  | "utilities"
  | "rent"
  | "inventory"
  | "maintenance"
  | "other";

export type SafeTransaction = {
  id: string;
  occurred_at: string;
  transaction_type: SafeTransactionType;
  amount: number;
  balance_after: number;
  reason_category: SafeWithdrawCategory | null;
  description: string | null;
  cash_close_report_id: string | null;
  cash_day_opening_id: string | null;
  created_by: string | null;
  created_at: string;
  /** Số ảnh hóa đơn đã attach (Phase 1). Đến từ safe_list_transactions. */
  attachment_count?: number;
};

export type SafeAttachment = {
  id: string;
  transaction_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_at: string;
  /** Phase 2: n8n set khi OCR xong. Phase 1 luôn null. */
  processed_at: string | null;
};

export type SafeCount = {
  id: string;
  counted_at: string;
  denominations_json: Record<string, number>;
  total_physical: number;
  expected_balance: number;
  difference: number;
  note: string | null;
  counted_by: string | null;
  created_at: string;
};

export const SAFE_TRANSACTION_LABELS: Record<SafeTransactionType, string> = {
  initial_setup: "Khởi tạo",
  deposit_close: "Nạp từ chốt két",
  withdraw_open: "Rút mở két",
  withdraw_other: "Rút mục đích khác",
  adjustment: "Điều chỉnh"
};

export const SAFE_WITHDRAW_CATEGORY_LABELS: Record<SafeWithdrawCategory, string> = {
  utilities: "Tiền điện / nước / mạng",
  rent: "Tiền thuê / dịch vụ",
  inventory: "Mua nguyên liệu lớn",
  maintenance: "Sửa chữa / bảo trì",
  other: "Khác"
};

export type CashDayOpening = {
  id: string;
  business_date: string;
  denominations_json: Record<string, number>;
  opening_total: number;
  carried_from_previous_day: boolean;
  /** Phần đến từ carry-over ngày cũ (= opening_total - safe_withdrawal_amount) */
  carried_amount?: number;
  /** Phần rút từ sổ quỹ (≥ 0). Insert vào safe_transactions tự động. */
  safe_withdrawal_amount?: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CashCloseReport = {
  id: string;
  business_date: string;
  cash_count_id: string;
  closed_at: string;
  closed_by: string | null;
  pos_total?: number;
  opening_cash: number;
  pos_cash_total: number;
  pos_non_cash_total?: number;
  bank_transfer_confirmed?: number;
  expense_cash_total: number;
  payroll_cash_total: number;
  theory_cash: number;
  reconciliation_total?: number;
  physical_cash: number;
  difference: number;
  denominations_json: Record<string, number>;
  sync_snapshot_at: string | null;
  note: string | null;
  report_status: "draft" | "final" | "voided";
  void_reason?: string | null;
  /** v2.2: số tiền nạp vào sổ quỹ khi finalize (= physical_cash - leave_for_next_day) */
  safe_deposit_amount: number;
  /** v2.2: tiền giữ lại trong két cho ngày mai (không nạp sổ quỹ). */
  leave_for_next_day: number;
};


export type ExpenseTemplate = {
  id: string;
  label: string;
  default_category_id: string | null;
  default_unit: string | null;
  last_unit_price: number;
  usage_count: number;
  is_active: boolean | null;
};

export type HandoverTask = {
  id: string;
  task_key: string;
  label: string;
  is_done: boolean;
  checked_by: string | null;
  checked_at: string | null;
  sort_order: number;
};

export type HandoverSession = {
  id: string;
  business_date: string;
  status: "draft" | "completed";
  note: string | null;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  tasks: HandoverTask[];
};

// =====================================================================
// Phase 4.A — Inventory types
// =====================================================================

export type StockMovementReason =
  | "purchase_received"
  | "sale_theoretical"
  | "manual_adjustment_in"
  | "manual_adjustment_out"
  | "count_correction"
  | "waste";

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  low_stock_threshold: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface MenuItem {
  id: string;
  name: string;
  external_product_name: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  /** Returned by list_menu_items RPC */
  recipe_count?: number;
}

export interface Recipe {
  recipe_id: string;
  menu_item_id: string;
  menu_item_name: string;
  is_active: boolean;
  item_count: number;
  notes: string | null;
  updated_at: string;
}

export interface RecipeItem {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  quantity: number;
}

export interface RecipeDetail {
  recipe_id: string;
  menu_item_id: string;
  is_active: boolean;
  notes: string | null;
  items: RecipeItem[];
}

export interface StockMovement {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity_delta: number;
  reason: StockMovementReason;
  occurred_at: string;
  source_order_id: string | null;
  source_recipe_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StockBalance {
  ingredient_id: string;
  name: string;
  unit: string;
  theoretical_balance: number;
  low_stock_threshold: number | null;
  is_low: boolean;
  last_movement_at: string | null;
}

// =====================================================================
// Backup/Restore (Phase 1)
// =====================================================================
export type BackupRunKind = "backup" | "restore";
export type BackupRunStatus = "running" | "success" | "failed";

export interface BackupRun {
  id: string;
  kind: BackupRunKind;
  status: BackupRunStatus;
  started_at: string;       // ISO timestamp
  finished_at: string | null;
  byte_size: number | null;
  error_message: string | null;
  filename: string | null;
  created_by: string | null;
}

// Detail variant with log_text (returned only from GET /runs/:id/log)
export interface BackupRunWithLog extends BackupRun {
  log_text: string;
}
