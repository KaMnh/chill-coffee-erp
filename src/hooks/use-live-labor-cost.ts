"use client";

import { useEffect, useMemo, useState } from "react";
import { computeLiveLaborCost } from "@/lib/labor-cost";
import type { DashboardData } from "@/lib/types";

/** Tick mỗi 60s là đủ — mỗi phút chỉ thêm ~rate/60; không cần tick từng giây. */
const TICK_MS = 60_000;

type LiveLaborInput = Pick<
  DashboardData,
  "payroll_total_all" | "active_shifts" | "shift_bonus_config"
>;

/**
 * Chi phí lương "tạm tính" hôm nay = đã chốt (mọi method) + đang phát sinh.
 * Gom (1)(2)(3) từ payload dashboard (đã fetch sẵn) và chạy timer 60s cập nhật
 * `now` để con số tự tăng khi còn người trong ca. Dọn timer khi unmount.
 */
export function useLiveLaborCost(data: LiveLaborInput): number {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return useMemo(
    () =>
      computeLiveLaborCost({
        finalizedTotal: data.payroll_total_all,
        activeShifts: data.active_shifts,
        now,
        bonusConfig: data.shift_bonus_config,
      }),
    [data.payroll_total_all, data.active_shifts, data.shift_bonus_config, now]
  );
}
