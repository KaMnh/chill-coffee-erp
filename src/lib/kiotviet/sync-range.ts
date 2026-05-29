/**
 * Pure date-range resolver for KiotViet sync. No I/O — unit-tested.
 *
 * Modes:
 *   - range:  explicit fromDate + toDate (manual backfill) → passed through.
 *   - window: anchor + applyWindow with N>1 → [anchor-(N-1) … anchor].
 *   - single: anchor only, or N<=1 → [anchor … anchor].
 *
 * Dates are naive 'YYYY-MM-DD' strings; arithmetic uses UTC ms so the host
 * timezone can't shift the calendar day (mirrors excel-import.ts).
 */
export type SyncRangeMode = "range" | "window" | "single";

export interface ComputeSyncRangeInput {
  fromDate?: string;
  toDate?: string;
  anchorDate?: string;
  applyWindow?: boolean;
  windowDays?: number;
  /** 'YYYY-MM-DD', timezone-resolved by the caller (VN). */
  today: string;
}

export interface SyncRange {
  from: string;
  to: string;
  mode: SyncRangeMode;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Clamp to the supported 1..31 window; non-finite / out-of-range → nearest bound. */
export function clampWindowDays(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : 1;
  if (v < 1) return 1;
  if (v > 31) return 31;
  return v;
}

/** Subtract `days` from a 'YYYY-MM-DD' date, returning 'YYYY-MM-DD'. */
export function subtractDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function computeSyncRange(input: ComputeSyncRangeInput): SyncRange {
  const { fromDate, toDate, anchorDate, applyWindow, windowDays, today } = input;

  // Range mode: both explicit + valid → pass through (normalize order).
  if (fromDate && toDate && DATE_RE.test(fromDate) && DATE_RE.test(toDate)) {
    const [from, to] = fromDate <= toDate ? [fromDate, toDate] : [toDate, fromDate];
    return { from, to, mode: "range" };
  }

  const anchor = anchorDate && DATE_RE.test(anchorDate) ? anchorDate : today;
  const n = applyWindow ? clampWindowDays(windowDays) : 1;
  if (n <= 1) return { from: anchor, to: anchor, mode: "single" };
  return { from: subtractDays(anchor, n - 1), to: anchor, mode: "window" };
}
