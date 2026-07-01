import { describe, it, expect } from "vitest";
import { computeLiveLaborCost, type ShiftBonusConfig } from "../labor-cost";

const NOW = new Date("2026-06-24T15:00:00+07:00");
const BONUS: ShiftBonusConfig = { threshold_hours: 7, bonus_amount: 10_000 };

/** ISO timestamp `minutes` phút trước NOW (test độc lập timezone vì so bằng getTime()). */
function checkInMinutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

describe("computeLiveLaborCost", () => {
  it("không ca mở → trả đúng finalizedTotal", () => {
    expect(
      computeLiveLaborCost({ finalizedTotal: 250_000, activeShifts: [], now: NOW, bonusConfig: BONUS })
    ).toBe(250_000);
  });

  it("1 ca mở: base làm tròn 1.000đ, cộng finalized", () => {
    // 90 phút = 1,5h × 25.000 = 37.500 → round 38.000; dưới 7h ⇒ không phụ cấp
    const result = computeLiveLaborCost({
      finalizedTotal: 100_000,
      activeShifts: [{ check_in_at: checkInMinutesAgo(90), hourly_rate: 25_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(result).toBe(138_000);
  });

  it("clamp ≥ 0 phút khi check-in ở tương lai (không âm)", () => {
    const future = new Date(NOW.getTime() + 30 * 60_000).toISOString();
    const result = computeLiveLaborCost({
      finalizedTotal: 50_000,
      activeShifts: [{ check_in_at: future, hourly_rate: 30_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(result).toBe(50_000);
  });

  it("phụ cấp: dưới ngưỡng không cộng, đạt ngưỡng cộng bonus_amount", () => {
    // 6h59m = 419 phút × 20.000 = 139.666,7 → /1000 = 139,67 → round 140 → 140.000; chưa đạt 7h
    const below = computeLiveLaborCost({
      finalizedTotal: 0,
      activeShifts: [{ check_in_at: checkInMinutesAgo(6 * 60 + 59), hourly_rate: 20_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(below).toBe(140_000);

    // đúng 7h = 420 phút × 20.000 = 140.000; đạt ngưỡng ⇒ + 10.000
    const atThreshold = computeLiveLaborCost({
      finalizedTotal: 0,
      activeShifts: [{ check_in_at: checkInMinutesAgo(7 * 60), hourly_rate: 20_000 }],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(atThreshold).toBe(150_000);
  });

  it("activeShifts nullish (payload RPC cũ thiếu field) → trả finalizedTotal, không crash", () => {
    // Mô phỏng payload thiếu active_shifts (deploy FE trước khi apply migration).
    const result = computeLiveLaborCost({
      finalizedTotal: 80_000,
      activeShifts: undefined as unknown as [],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(result).toBe(80_000);
  });

  it("nhiều ca mở: cộng dồn + finalized", () => {
    const result = computeLiveLaborCost({
      finalizedTotal: 100_000,
      activeShifts: [
        { check_in_at: checkInMinutesAgo(60), hourly_rate: 30_000 }, // 1h → 30.000
        { check_in_at: checkInMinutesAgo(90), hourly_rate: 25_000 }, // 1,5h → 38.000
      ],
      now: NOW,
      bonusConfig: BONUS,
    });
    expect(result).toBe(168_000); // 100.000 + 30.000 + 38.000
  });

  it("fixed NV (pay_type='fixed') → KHÔNG accrual khi ca đang mở", () => {
    expect(
      computeLiveLaborCost({
        finalizedTotal: 100_000,
        activeShifts: [
          { check_in_at: checkInMinutesAgo(180), hourly_rate: 30_000, pay_type: "fixed" },
          { check_in_at: checkInMinutesAgo(60), hourly_rate: 25_000, pay_type: "hourly" },
        ],
        now: NOW,
        bonusConfig: BONUS,
      })
    ).toBe(100_000 + Math.round((1 * 25_000) / 1000) * 1000); // chỉ hourly NV accrue
  });
});
