"use client";

import { useCallback, useState } from "react";
import { todayInVN } from "@/lib/datetime";

export interface UseBusinessDateResult {
  /** YYYY-MM-DD in Vietnam wall-clock. */
  businessDate: string;
  setBusinessDate(date: string): void;
  resetToToday(): void;
}

/**
 * Single source of truth for the `business_date` filter that drives every
 * query in dashboard / reports / pivot. Default is today() in
 * Asia/Ho_Chi_Minh — using lib/datetime.todayInVN to avoid the UTC-rollover
 * bug (`new Date().toISOString().slice(0,10)` returns yesterday after 17:00 UTC).
 *
 * State is intentionally local (no URL sync, no localStorage). Callers that
 * need persistence can wrap this hook later — YAGNI for Phase 3A.
 */
export function useBusinessDate(): UseBusinessDateResult {
  const [businessDate, setBusinessDate] = useState<string>(() => todayInVN());

  const resetToToday = useCallback(() => {
    setBusinessDate(todayInVN());
  }, []);

  return { businessDate, setBusinessDate, resetToToday };
}
