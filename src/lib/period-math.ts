/**
 * Pure period-math helpers for the cash-flow overview module.
 *
 * Vietnamese business week starts Monday. Dates are local YYYY-MM-DD
 * strings; we deliberately avoid Date.toISOString() (UTC drift) and use
 * a fixed-format formatter instead.
 */

import type { PeriodPreset } from "./types";

export interface DateRange {
  start: string;
  end: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fromLocalISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

/** Inclusive day-count between two YYYY-MM-DD strings. */
export function countDaysInclusive(start: string, end: string): number {
  const a = fromLocalISO(start).getTime();
  const b = fromLocalISO(end).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

/**
 * Mon (start) → Sun (end) of the calendar week containing `today`.
 * JS `getDay()` returns 0=Sun..6=Sat; we convert to a Mon-indexed offset.
 */
export function getCurrentWeekRange(today: Date = new Date()): DateRange {
  const dow = today.getDay(); // 0..6 (Sun..Sat)
  const offsetToMon = dow === 0 ? -6 : 1 - dow; // Sun → -6, Mon → 0, …, Sat → -5
  const mon = addDays(today, offsetToMon);
  const sun = addDays(mon, 6);
  return { start: toLocalISO(mon), end: toLocalISO(sun) };
}

/** 1st → last day of the current calendar month. */
export function getCurrentMonthRange(today: Date = new Date()): DateRange {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return { start: toLocalISO(first), end: toLocalISO(last) };
}

/**
 * Derive the comparable previous period.
 *
 * Presets anchor to calendar units (week → previous Mon-Sun; month → previous
 * calendar month — day-count may differ). Custom uses "N days immediately
 * before start" — fixed window length, may not align to calendar boundaries.
 */
export function getPreviousPeriod(
  start: string,
  end: string,
  preset: PeriodPreset
): DateRange {
  if (preset === "week") {
    const startD = fromLocalISO(start);
    const prevMon = addDays(startD, -7);
    const prevSun = addDays(prevMon, 6);
    return { start: toLocalISO(prevMon), end: toLocalISO(prevSun) };
  }
  if (preset === "month") {
    const startD = fromLocalISO(start);
    const prevFirst = new Date(startD.getFullYear(), startD.getMonth() - 1, 1);
    const prevLast = new Date(startD.getFullYear(), startD.getMonth(), 0);
    return { start: toLocalISO(prevFirst), end: toLocalISO(prevLast) };
  }
  // custom: N days immediately before `start`
  const n = countDaysInclusive(start, end);
  const startD = fromLocalISO(start);
  const prevEnd = addDays(startD, -1);
  const prevStart = addDays(prevEnd, -(n - 1));
  return { start: toLocalISO(prevStart), end: toLocalISO(prevEnd) };
}
