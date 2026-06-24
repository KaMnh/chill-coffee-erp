/**
 * Phép tính chi phí lương "tạm tính" real-time cho KPI Dashboard.
 *
 * Thuần + tất định → test được không cần clock/DB. Khớp công thức ra ca
 * (database/002_functions.sql check_out_employee): base làm tròn 1.000đ gần
 * nhất, phụ cấp là khoản cố định khi ca đạt ngưỡng giờ. Số chỉ để HIỂN THỊ —
 * không ghi gì xuống DB.
 */

export interface ActiveShiftInput {
  /** ISO timestamp lúc vào ca. */
  check_in_at: string;
  /** Đơn giá giờ của nhân viên (VND). */
  hourly_rate: number;
}

export interface ShiftBonusConfig {
  /** Số giờ làm đạt/vượt thì áp phụ cấp cố định. */
  threshold_hours: number;
  /** Phụ cấp cố định (VND) cộng khi đạt ngưỡng. */
  bonus_amount: number;
}

/**
 * Mặc định phụ cấp ca — khớp seed `app_settings.shift_bonus_config`
 * (database/migrations/2026-05-26-a-shift-bonus-config.sql). Dùng làm fallback
 * khi payload/app_settings chưa có config.
 */
export const DEFAULT_SHIFT_BONUS_CONFIG: ShiftBonusConfig = {
  threshold_hours: 7,
  bonus_amount: 10000,
};

export interface LiveLaborCostInput {
  /** Σ total_pay các ca đã chốt hôm nay, MỌI payment_method (VND). */
  finalizedTotal: number;
  /** Ca đang mở hôm nay (đã vào, chưa ra). */
  activeShifts: ActiveShiftInput[];
  /** Thời điểm hiện tại — caller tick để số lớn dần. */
  now: Date;
  bonusConfig: ShiftBonusConfig;
}

/**
 * Lương đã chốt + phần đang phát sinh của mọi người còn trong ca.
 * Trả về số VND; không bao giờ ghi DB.
 */
export function computeLiveLaborCost({
  finalizedTotal,
  activeShifts,
  now,
  bonusConfig,
}: LiveLaborCostInput): number {
  const nowMs = now.getTime();
  let accrued = 0;

  // `?? []` phòng payload RPC thiếu active_shifts (deploy FE trước migration) —
  // tránh "activeShifts is not iterable" làm vỡ DashboardView.
  for (const shift of activeShifts ?? []) {
    const checkInMs = new Date(shift.check_in_at).getTime();
    // clamp ≥ 0 để check-in tương lai không tạo accrual âm
    const minutes = Math.max(0, Math.floor((nowMs - checkInMs) / 60_000));
    const hours = minutes / 60;
    // làm tròn 1.000đ gần nhất — khớp RPC ra ca
    const base = Math.round((hours * shift.hourly_rate) / 1000) * 1000;
    const allowance = hours >= bonusConfig.threshold_hours ? bonusConfig.bonus_amount : 0;
    accrued += base + allowance;
  }

  return finalizedTotal + accrued;
}
