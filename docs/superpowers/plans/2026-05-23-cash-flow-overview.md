# Cash Flow Overview Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new top-level sidebar module "Dòng tiền" that gives owner/manager a period-aggregated view of cash flow (IN vs OUT), daily chart, top-5 expense categories, and a Vietnamese lunar+solar calendar widget.

**Architecture:** One new RPC `cash_flow_overview(start, end, [compare_start, compare_end])` returns the entire payload (KPIs + by_day series + top categories + optional previous-period delta) as JSONB. Pure helpers (`period-math.ts`, `lunar.ts`) handle calendar logic in `src/lib/`. Six new components in `src/features/cashflow/` compose the view. Navigation gets one new entry. Lunar uses the inlined Hồ Ngọc Đức algorithm (no new dependency).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript 5.8, TanStack Query 5, Supabase JS 2, Recharts 3.8, Tailwind v4, Vitest 2.1, pgTAP.

**Testing policy:** TDD applies to pure helpers (`period-math`, `lunar`) and the SQL RPC (pgTAP). UI components have no automated tests per project policy (Vitest config restricts to `**/__tests__/**/*.test.ts` in node env — see `vitest.config.mts`); manual smoke at the end covers UI verification.

**Spec reference:** [docs/superpowers/specs/2026-05-23-cash-flow-overview-design.md](../specs/2026-05-23-cash-flow-overview-design.md)

---

## Pre-flight

- [ ] **Step 0.1: Verify baseline tests pass**

Run: `npm run test:run`
Expected: PASS (75 tests passing from the user-management branch baseline).

- [ ] **Step 0.2: Verify TypeScript compiles**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 0.3: Verify Supabase + pgTAP runner are up**

Run: `npm run pgtap`
Expected: PASS (existing pgTAP scenarios green). If this fails because Supabase isn't running, start it first: `cd supabase && docker compose up -d`.

---

## Task 1: Add types + queryKey

**Files:**
- Modify: `src/lib/types.ts` (append at end)
- Modify: `src/hooks/queries/keys.ts`

- [ ] **Step 1: Append CashFlow types to `src/lib/types.ts`**

Append at the end of the file (after the last existing export):

```ts
// =====================================================================
// Cash Flow Overview (2026-05-23)
// =====================================================================

export type PeriodPreset = "week" | "month" | "custom";

export interface PeriodState {
  preset: PeriodPreset;
  /** Inclusive start date in YYYY-MM-DD (local). */
  start: string;
  /** Inclusive end date in YYYY-MM-DD (local). */
  end: string;
}

export interface CashFlowDayPoint {
  /** YYYY-MM-DD */
  date: string;
  in: number;
  out: number;
}

export interface CashFlowTopCategory {
  category_name: string;
  amount: number;
  /** 0..1 (fraction of total out). */
  pct: number;
}

export interface CashFlowOverview {
  in: number;
  out: number;
  net: number;
  by_day: CashFlowDayPoint[];
  top_categories: CashFlowTopCategory[];
  /** Only present when caller supplied a comparison range. */
  prev_in?: number;
  prev_out?: number;
  prev_net?: number;
}
```

- [ ] **Step 2: Add `cashFlowOverview` to queryKeys**

In `src/hooks/queries/keys.ts`, find the closing `};` of the `queryKeys` object. Insert just above:

```ts
  // Cash flow overview (2026-05-23)
  cashFlowOverview: (start: string, end: string) =>
    ["cash-flow-overview", start, end] as const,
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts src/hooks/queries/keys.ts
git commit -m "types: add CashFlowOverview + PeriodState + queryKey

Prep for cash-flow overview module (spec 2026-05-23).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Period math helpers (TDD)

**Files:**
- Create: `src/lib/period-math.ts`
- Create: `src/lib/__tests__/period-math.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `src/lib/__tests__/period-math.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  getCurrentWeekRange,
  getCurrentMonthRange,
  getPreviousPeriod,
  countDaysInclusive
} from "../period-math";

/**
 * period-math — pure helpers for cash-flow period selection.
 *
 * Vitest is set to TZ="Asia/Ho_Chi_Minh" via vitest.config.mts, so all
 * Date math here is interpreted in VN time. Mocking the clock to a fixed
 * "today" lets us assert exact boundary dates without flake.
 */

beforeAll(() => {
  // Fix "today" to Saturday 23/5/2026 (matches the brainstorm date).
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-23T10:00:00+07:00"));
});

afterAll(() => {
  vi.useRealTimers();
});

describe("getCurrentWeekRange", () => {
  it("returns Monday→Sunday of the week containing today", () => {
    // 23/5/2026 is a Saturday. Week is Mon 18/5 → Sun 24/5.
    const r = getCurrentWeekRange();
    expect(r.start).toBe("2026-05-18");
    expect(r.end).toBe("2026-05-24");
  });
});

describe("getCurrentMonthRange", () => {
  it("returns the 1st through last day of the current month", () => {
    const r = getCurrentMonthRange();
    expect(r.start).toBe("2026-05-01");
    expect(r.end).toBe("2026-05-31");
  });
});

describe("getPreviousPeriod", () => {
  it("week preset → previous Mon-Sun", () => {
    const prev = getPreviousPeriod("2026-05-18", "2026-05-24", "week");
    expect(prev.start).toBe("2026-05-11");
    expect(prev.end).toBe("2026-05-17");
  });

  it("month preset → previous calendar month", () => {
    const prev = getPreviousPeriod("2026-05-01", "2026-05-31", "month");
    expect(prev.start).toBe("2026-04-01");
    expect(prev.end).toBe("2026-04-30");
  });

  it("month preset preserves shorter previous-month day-count (Mar→Feb)", () => {
    const prev = getPreviousPeriod("2026-03-01", "2026-03-31", "month");
    expect(prev.start).toBe("2026-02-01");
    expect(prev.end).toBe("2026-02-28");
  });

  it("custom preset → N days immediately before start", () => {
    const prev = getPreviousPeriod("2026-05-10", "2026-05-12", "custom");
    // 3-day window (10,11,12) → prev = 7,8,9
    expect(prev.start).toBe("2026-05-07");
    expect(prev.end).toBe("2026-05-09");
  });

  it("custom preset preserves N-day length across month boundary", () => {
    const prev = getPreviousPeriod("2026-05-01", "2026-05-31", "custom");
    // 31-day window → prev = 31 days ending 30/4 = 31/3..30/4
    expect(prev.start).toBe("2026-03-31");
    expect(prev.end).toBe("2026-04-30");
  });
});

describe("countDaysInclusive", () => {
  it("counts both endpoints", () => {
    expect(countDaysInclusive("2026-05-01", "2026-05-31")).toBe(31);
    expect(countDaysInclusive("2026-05-01", "2026-05-01")).toBe(1);
    expect(countDaysInclusive("2026-05-01", "2026-05-02")).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/__tests__/period-math.test.ts`
Expected: FAIL with "Cannot find module '../period-math'" or similar.

- [ ] **Step 3: Implement the helpers**

Create `src/lib/period-math.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/__tests__/period-math.test.ts`
Expected: PASS, 6 tests in 1 file.

- [ ] **Step 5: Run full test suite to confirm no regression**

Run: `npm run test:run`
Expected: PASS, 81 tests (75 baseline + 6 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/period-math.ts src/lib/__tests__/period-math.test.ts
git commit -m "feat(lib): period-math helpers for cash-flow module

Pure functions for week/month boundary calc and previous-period
derivation. Presets anchor to calendar units; custom uses
\"N days immediately before\" — divergence is intentional and
documented in spec §10.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Lunar conversion helper (TDD)

**Files:**
- Create: `src/lib/lunar.ts`
- Create: `src/lib/__tests__/lunar.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `src/lib/__tests__/lunar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { solarToLunar, getCanChi } from "../lunar";

/**
 * Lunar conversion — reference dates verified against published Vietnamese
 * lunar almanacs (lichngaytot, lichvn). The HND algorithm is well-known
 * public-domain; we test 10 anchor points covering Tết, mid-autumn, and
 * boundary edge cases.
 */

describe("solarToLunar — Tết (new year) anchors", () => {
  it("Tết 2024 = Saturday 10/2/2024 → 1/1 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 1, 10)); // months 0-indexed
    expect(l.day).toBe(1);
    expect(l.month).toBe(1);
    expect(l.year).toBe(2024);
    expect(l.canChi).toBe("Giáp Thìn");
    expect(l.holiday).toBe("Tết Nguyên Đán");
    expect(l.isFirstOfMonth).toBe(true);
  });

  it("Tết 2025 = Wednesday 29/1/2025 → 1/1 Ất Tỵ", () => {
    const l = solarToLunar(new Date(2025, 0, 29));
    expect(l.day).toBe(1);
    expect(l.month).toBe(1);
    expect(l.year).toBe(2025);
    expect(l.canChi).toBe("Ất Tỵ");
  });

  it("Tết 2026 = Tuesday 17/2/2026 → 1/1 Bính Ngọ", () => {
    const l = solarToLunar(new Date(2026, 1, 17));
    expect(l.day).toBe(1);
    expect(l.month).toBe(1);
    expect(l.year).toBe(2026);
    expect(l.canChi).toBe("Bính Ngọ");
  });
});

describe("solarToLunar — lunar holidays", () => {
  it("Tết Đoan Ngọ 2024 = 10/6/2024 → 5/5 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 5, 10));
    expect(l.day).toBe(5);
    expect(l.month).toBe(5);
    expect(l.holiday).toBe("Tết Đoan Ngọ");
  });

  it("Trung Thu 2024 = 17/9/2024 → 15/8 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 8, 17));
    expect(l.day).toBe(15);
    expect(l.month).toBe(8);
    expect(l.holiday).toBe("Tết Trung Thu");
    expect(l.isFullMoon).toBe(true);
  });

  it("Vu Lan 2024 = 18/8/2024 → 15/7 Giáp Thìn", () => {
    const l = solarToLunar(new Date(2024, 7, 18));
    expect(l.day).toBe(15);
    expect(l.month).toBe(7);
    expect(l.holiday).toBe("Vu Lan");
  });
});

describe("solarToLunar — non-holiday sanity", () => {
  it("23/5/2026 lands in lunar month 4 of Bính Ngọ year", () => {
    const l = solarToLunar(new Date(2026, 4, 23));
    expect(l.year).toBe(2026);
    expect(l.month).toBe(4);
    // day depends on exact algorithm — assert range, not exact value
    expect(l.day).toBeGreaterThanOrEqual(1);
    expect(l.day).toBeLessThanOrEqual(30);
    expect(l.holiday).toBeUndefined();
  });

  it("1/1/2024 (before Tết 2024) → lunar year still 2023 (Quý Mão)", () => {
    const l = solarToLunar(new Date(2024, 0, 1));
    expect(l.year).toBe(2023);
    expect(l.canChi).toBe("Quý Mão");
  });
});

describe("getCanChi — known anchor years", () => {
  it("returns Giáp Thìn for lunar 2024", () => {
    expect(getCanChi(2024)).toBe("Giáp Thìn");
  });
  it("returns Bính Ngọ for lunar 2026", () => {
    expect(getCanChi(2026)).toBe("Bính Ngọ");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/__tests__/lunar.test.ts`
Expected: FAIL with "Cannot find module '../lunar'".

- [ ] **Step 3: Implement the lunar helper**

Create `src/lib/lunar.ts` with the inlined Hồ Ngọc Đức algorithm:

```ts
/**
 * Vietnamese lunar calendar conversion — Hồ Ngọc Đức algorithm.
 *
 * Public-domain reference: http://www.informatik.uni-leipzig.de/~duc/amlich/
 * Covers years 1900-2199 with timezone offset (default Asia/Ho_Chi_Minh
 * = +7). Returns lunar day/month/year + Vietnamese can-chi label + lunar
 * holiday tag if the date matches one of six hard-coded major holidays.
 *
 * No external dep; pure functions; ~200 LOC.
 */

const PI = Math.PI;

function INT(d: number): number {
  return Math.floor(d);
}

function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd =
    dd +
    INT((153 * m + 2) / 5) +
    365 * y +
    INT(y / 4) -
    INT(y / 100) +
    INT(y / 400) -
    32045;
  if (jd < 2299161) {
    jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  }
  return jd;
}

function NewMoon(k: number): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let Jd1 =
    2415020.75933 +
    29.53058868 * k +
    0.0001178 * T2 -
    0.000000155 * T3;
  Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat;
  if (T < -11) {
    deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  return Jd1 + C1 - deltat;
}

function SunLongitude(jdn: number): number {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = L0 + DL;
  L = L * dr;
  L = L - PI * 2 * INT(L / (PI * 2));
  return L;
}

function getSunLongitude(dayNumber: number, timeZone: number): number {
  return INT((SunLongitude(dayNumber - 0.5 - timeZone / 24) / PI) * 6);
}

function getNewMoonDay(k: number, timeZone: number): number {
  return INT(NewMoon(k) + 0.5 + timeZone / 24);
}

function getLunarMonth11(yy: number, timeZone: number): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

function getLeapMonthOffset(a11: number, timeZone: number): number {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

interface LunarRaw {
  lunarDay: number;
  lunarMonth: number;
  lunarYear: number;
  lunarLeap: 0 | 1;
}

function convertSolar2Lunar(
  dd: number,
  mm: number,
  yy: number,
  timeZone = 7,
): LunarRaw {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let lunarLeap: 0 | 1 = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) {
        lunarLeap = 1;
      }
    }
  }
  if (lunarMonth > 12) {
    lunarMonth = lunarMonth - 12;
  }
  if (lunarMonth >= 11 && diff < 4) {
    lunarYear -= 1;
  }
  return { lunarDay, lunarMonth, lunarYear, lunarLeap };
}

// Can-Chi (Heavenly Stems + Earthly Branches) for the lunar year.
const CAN = ["Giáp", "Ất", "Bính", "Đinh", "Mậu", "Kỷ", "Canh", "Tân", "Nhâm", "Quý"];
const CHI = ["Tý", "Sửu", "Dần", "Mão", "Thìn", "Tỵ", "Ngọ", "Mùi", "Thân", "Dậu", "Tuất", "Hợi"];

export function getCanChi(lunarYear: number): string {
  const can = CAN[(lunarYear + 6) % 10];
  const chi = CHI[(lunarYear + 8) % 12];
  return `${can} ${chi}`;
}

// Six hard-coded major lunar holidays — keyed by `${month}-${day}`.
const LUNAR_HOLIDAYS: Record<string, string> = {
  "1-1": "Tết Nguyên Đán",
  "1-15": "Rằm tháng Giêng",
  "3-10": "Giỗ tổ Hùng Vương",
  "5-5": "Tết Đoan Ngọ",
  "7-15": "Vu Lan",
  "8-15": "Tết Trung Thu",
};

export interface LunarInfo {
  day: number;
  month: number;
  year: number;
  isLeapMonth: boolean;
  canChi: string;
  holiday?: string;
  isFirstOfMonth: boolean;
  isFullMoon: boolean;
}

export function solarToLunar(date: Date | string): LunarInfo {
  const d = typeof date === "string" ? new Date(date) : date;
  const { lunarDay, lunarMonth, lunarYear, lunarLeap } = convertSolar2Lunar(
    d.getDate(),
    d.getMonth() + 1,
    d.getFullYear(),
  );
  const key = `${lunarMonth}-${lunarDay}`;
  return {
    day: lunarDay,
    month: lunarMonth,
    year: lunarYear,
    isLeapMonth: lunarLeap === 1,
    canChi: getCanChi(lunarYear),
    holiday: LUNAR_HOLIDAYS[key],
    isFirstOfMonth: lunarDay === 1,
    isFullMoon: lunarDay === 15,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/__tests__/lunar.test.ts`
Expected: PASS, 10 tests.

If any reference date fails: re-check the test reference value against a published almanac (e.g. https://lichvietnam.com or https://lichngaytot.com). The HND algorithm is well-tested; failures are almost always due to an incorrect reference value in the test, not a bug in the algorithm.

- [ ] **Step 5: Run full test suite**

Run: `npm run test:run`
Expected: PASS, 91 tests (75 baseline + 6 period-math + 10 lunar).

- [ ] **Step 6: Commit**

```bash
git add src/lib/lunar.ts src/lib/__tests__/lunar.test.ts
git commit -m "feat(lib): Vietnamese lunar calendar conversion (HND algorithm)

Inlined Hồ Ngọc Đức algorithm — public-domain, ~200 LOC, zero deps.
solarToLunar() returns lunar day/month/year + can-chi + holiday tag.
Six hard-coded major holidays (Tết, Rằm tháng Giêng, Giỗ tổ Hùng
Vương, Đoan Ngọ, Vu Lan, Trung Thu).

Tests anchor against published Vietnamese almanacs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Migration — RPC `cash_flow_overview`

**Files:**
- Create: `database/migrations/2026-05-23-cash-flow-overview.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- =============================================================================
-- Cash Flow Overview RPC (2026-05-23)
--
-- Returns the entire dashboard payload as JSONB:
--   { in, out, net, by_day[], top_categories[], prev_in?, prev_out?, prev_net? }
--
-- Auth: SECURITY DEFINER; first line raises if caller is not owner/manager.
-- Idempotent: CREATE OR REPLACE FUNCTION.
-- =============================================================================

create or replace function public.cash_flow_overview(
  p_start date,
  p_end date,
  p_compare_start date default null,
  p_compare_end date default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in numeric;
  v_out numeric;
  v_prev_in numeric;
  v_prev_out numeric;
  v_by_day jsonb;
  v_top jsonb;
  v_result jsonb;
begin
  if not public.app_is_owner_manager() then
    raise exception 'forbidden: cash_flow_overview requires owner/manager';
  end if;

  -- IN / OUT for the current period
  select coalesce(sum(net_amount), 0)
    into v_in
    from public.sales_orders
   where purchase_at::date between p_start and p_end;

  select coalesce((select sum(amount) from public.expenses
                    where business_date between p_start and p_end), 0)
       + coalesce((select sum(total_pay) from public.shift_payroll_records
                    where business_date between p_start and p_end), 0)
    into v_out;

  -- by_day: every day in the range, even those with zero activity
  with d as (
    select dd::date as day
      from generate_series(p_start, p_end, interval '1 day') dd
  ),
  ins as (
    select purchase_at::date as day, sum(net_amount) as amt
      from public.sales_orders
     where purchase_at::date between p_start and p_end
     group by 1
  ),
  outs as (
    select day, sum(amt) as amt from (
      select business_date as day, sum(amount) as amt
        from public.expenses
       where business_date between p_start and p_end
       group by 1
      union all
      select business_date as day, sum(total_pay) as amt
        from public.shift_payroll_records
       where business_date between p_start and p_end
       group by 1
    ) u group by day
  )
  select jsonb_agg(jsonb_build_object(
           'date', to_char(d.day, 'YYYY-MM-DD'),
           'in', coalesce(ins.amt, 0),
           'out', coalesce(outs.amt, 0)
         ) order by d.day)
    into v_by_day
    from d
    left join ins on ins.day = d.day
    left join outs on outs.day = d.day;

  -- top_categories: top-5 expense categories (payroll excluded)
  with totals as (
    select coalesce(ec.name, '(chưa phân loại)') as name, sum(e.amount) as amt
      from public.expenses e
      left join public.expense_categories ec on ec.id = e.category_id
     where e.business_date between p_start and p_end
     group by 1
     order by amt desc
     limit 5
  )
  select jsonb_agg(jsonb_build_object(
           'category_name', name,
           'amount', amt,
           'pct', case when v_out = 0 then 0 else amt / v_out end
         ) order by amt desc)
    into v_top
    from totals;

  v_result := jsonb_build_object(
    'in', v_in,
    'out', v_out,
    'net', v_in - v_out,
    'by_day', coalesce(v_by_day, '[]'::jsonb),
    'top_categories', coalesce(v_top, '[]'::jsonb)
  );

  if p_compare_start is not null and p_compare_end is not null then
    select coalesce(sum(net_amount), 0)
      into v_prev_in
      from public.sales_orders
     where purchase_at::date between p_compare_start and p_compare_end;
    select coalesce((select sum(amount) from public.expenses
                      where business_date between p_compare_start and p_compare_end), 0)
         + coalesce((select sum(total_pay) from public.shift_payroll_records
                      where business_date between p_compare_start and p_compare_end), 0)
      into v_prev_out;
    v_result := v_result || jsonb_build_object(
      'prev_in', v_prev_in,
      'prev_out', v_prev_out,
      'prev_net', v_prev_in - v_prev_out
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.cash_flow_overview(date, date, date, date) from public;
grant execute on function public.cash_flow_overview(date, date, date, date) to authenticated;

comment on function public.cash_flow_overview(date, date, date, date) is
  'Cash-flow overview JSONB for owner/manager. Spec: docs/superpowers/specs/2026-05-23-cash-flow-overview-design.md';
```

- [ ] **Step 2: Apply the migration to the local DB**

Run the SQL file against the dev database:

```bash
docker exec -i supabase-db psql -U postgres -d postgres < database/migrations/2026-05-23-cash-flow-overview.sql
```

Expected: `CREATE FUNCTION`, `REVOKE`, `GRANT`, `COMMENT` — no error.

If the container name differs, list containers: `docker ps --format '{{.Names}}' | grep -i postgres`.

- [ ] **Step 3: Smoke-call the function via psql**

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c "select public.cash_flow_overview('2026-05-01', '2026-05-23');"
```

Expected: a JSONB blob with keys `in`, `out`, `net`, `by_day`, `top_categories`. Values may be zero if no seed data in the range — that's fine; pgTAP tests in Task 5 will exercise the data paths.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026-05-23-cash-flow-overview.sql
git commit -m "feat(db): cash_flow_overview RPC

Returns KPI + by_day series + top_categories + optional previous-
period delta as JSONB. SECURITY DEFINER with owner/manager guard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: pgTAP tests for the RPC

**Files:**
- Create: `database/tests/cash_flow_overview.pgtap.sql`

- [ ] **Step 1: Look up the existing pgTAP test pattern**

Read one existing pgTAP file to mirror the project's style and setup/teardown idiom. E.g. `database/tests/` should contain prior `*.pgtap.sql` files — open one (any one) and confirm the test-file template:

```bash
ls database/tests/*.pgtap.sql | head -3
```

Then read the first one to confirm the `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;` shape and how it seeds test data. The new file must match this shape exactly. (If the project uses `pgtap-run.mjs` to wrap files differently, mirror that too.)

- [ ] **Step 2: Create the pgTAP file**

```sql
-- =============================================================================
-- pgTAP — cash_flow_overview RPC (2026-05-23)
--
-- Three scenarios:
--   1. Empty period returns zeros + all-zero by_day entries
--   2. Sums correctly across sales_orders + expenses + shift_payroll_records
--   3. top_categories: ordered by amount desc, limit 5, percentage computed
-- =============================================================================

begin;

select plan(7);

-- Set the active role to "owner" so app_is_owner_manager() passes.
-- (Mirror the seed/role-impersonation idiom used by the other pgTAP files
-- in this directory. If those files use a different mechanism — e.g.
-- inserting into employee_accounts directly + set local request.jwt.claims
-- — match it verbatim.)
set local role to postgres;  -- adjust to match the existing pgTAP role pattern

-- ---------------------------------------------------------------------------
-- Scenario 1: empty period → in=0, out=0, net=0, by_day has 1 entry per day
-- all-zero, top_categories empty
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
begin
  v := public.cash_flow_overview('2099-01-01', '2099-01-03');
  perform ok((v->>'in')::numeric = 0, 'empty: in is 0');
  perform ok((v->>'out')::numeric = 0, 'empty: out is 0');
  perform ok(jsonb_array_length(v->'by_day') = 3, 'empty: by_day has 3 days');
  perform ok(jsonb_array_length(v->'top_categories') = 0, 'empty: top_categories empty');
end$$;

-- ---------------------------------------------------------------------------
-- Scenario 2: sums correctly across all three sources
-- Insert: 1 sales_order (net 100), 1 expense (amount 30), 1 payroll (50)
-- on the same date → in=100, out=80, net=20
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_emp uuid;
  v_cat uuid;
begin
  -- minimal seed
  insert into public.employees(id, code, name, hourly_rate, is_active)
    values (gen_random_uuid(), 'TEST_E1', 'Test', 100000, true)
    returning id into v_emp;
  insert into public.expense_categories(id, name)
    values (gen_random_uuid(), 'Test cat')
    returning id into v_cat;
  insert into public.sales_orders(id, sold_by_name, net_amount, purchase_at)
    values (gen_random_uuid(), 'tester', 100, '2099-02-01 10:00+07');
  insert into public.expenses(id, business_date, description, amount, category_id)
    values (gen_random_uuid(), '2099-02-01', 'test', 30, v_cat);
  insert into public.shift_payroll_records(id, employee_id, business_date,
    total_minutes, hourly_rate, base_pay, total_pay)
    values (gen_random_uuid(), v_emp, '2099-02-01', 60, 100000, 50, 50);

  v := public.cash_flow_overview('2099-02-01', '2099-02-01');
  perform ok((v->>'in')::numeric = 100, 'sums: in=100');
  perform ok((v->>'out')::numeric = 80, 'sums: out=30+50=80');
  perform ok((v->>'net')::numeric = 20, 'sums: net=20');
end$$;

-- ---------------------------------------------------------------------------
-- Scenario 3: top_categories ordering & limit. (Re-uses category from
-- Scenario 2 plus inserts more.)
-- ---------------------------------------------------------------------------
do $$
declare
  v jsonb;
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
begin
  insert into public.expense_categories(id, name) values
    (gen_random_uuid(), 'A'),
    (gen_random_uuid(), 'B'),
    (gen_random_uuid(), 'C')
    returning id into v_c1;  -- last insert returns into v_c1
  -- Re-fetch the three by name
  select id into v_c1 from public.expense_categories where name='A' limit 1;
  select id into v_c2 from public.expense_categories where name='B' limit 1;
  select id into v_c3 from public.expense_categories where name='C' limit 1;

  insert into public.expenses(id, business_date, description, amount, category_id) values
    (gen_random_uuid(), '2099-03-01', 'A1', 100, v_c1),
    (gen_random_uuid(), '2099-03-01', 'B1', 50,  v_c2),
    (gen_random_uuid(), '2099-03-01', 'C1', 25,  v_c3);

  v := public.cash_flow_overview('2099-03-01', '2099-03-01');
  perform ok(
    (v->'top_categories'->0->>'category_name') = 'A',
    'top_categories: A first (100)'
  );
end$$;

select * from finish();

rollback;
```

**IMPORTANT:** The exact `set role` / impersonation idiom must match the project's existing pgTAP files. If the existing files use a different mechanism (e.g. setting `request.jwt.claims` JSON via `set local request.jwt.claims`), update Scenario 2/3 accordingly. The auth bypass for `app_is_owner_manager()` is the trickiest piece of this test file — read one of the other auth-gated pgTAP tests (if any) and copy its pattern verbatim.

- [ ] **Step 3: Run pgTAP**

Run: `npm run pgtap`
Expected: PASS — 7 new assertions (3 in scenario 1, 3 in scenario 2, 1 in scenario 3) on top of the existing pgTAP count.

If the auth-bypass mechanism is wrong, expect an error like "forbidden: cash_flow_overview requires owner/manager". Fix by mirroring whatever existing tests do for owner-only RPCs.

- [ ] **Step 4: Commit**

```bash
git add database/tests/cash_flow_overview.pgtap.sql
git commit -m "test(db): pgTAP for cash_flow_overview RPC

3 scenarios: empty period (zeros + zero day-entries), correct summing
across sales+expenses+payroll, top_categories ordering.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Data layer wrapper

**Files:**
- Create: `src/lib/data/cash-flow.ts`
- Modify: `src/lib/data/index.ts` (barrel re-export)

- [ ] **Step 1: Create the data helper**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashFlowOverview } from "@/lib/types";
import { toAppError } from "./_common";

export interface LoadCashFlowParams {
  start: string;
  end: string;
  compareStart?: string;
  compareEnd?: string;
}

/**
 * Call the SECURITY DEFINER RPC. Server-side guard inside the function
 * checks owner/manager; the user's JWT is forwarded automatically by
 * Supabase JS.
 */
export async function loadCashFlowOverview(
  supabase: SupabaseClient,
  params: LoadCashFlowParams,
): Promise<CashFlowOverview> {
  const { data, error } = await supabase.rpc("cash_flow_overview", {
    p_start: params.start,
    p_end: params.end,
    p_compare_start: params.compareStart ?? null,
    p_compare_end: params.compareEnd ?? null,
  });
  if (error) throw toAppError(error, "Không tải được tổng quan dòng tiền.");
  return data as CashFlowOverview;
}
```

- [ ] **Step 2: Add to barrel**

Open `src/lib/data/index.ts`. Append:

```ts
export * from "./cash-flow";
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/data/cash-flow.ts src/lib/data/index.ts
git commit -m "feat(data): loadCashFlowOverview RPC wrapper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Query hook

**Files:**
- Create: `src/hooks/queries/use-cash-flow-overview-query.ts`
- Modify: `src/hooks/queries/index.ts`

- [ ] **Step 1: Create the query hook**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCashFlowOverview, type LoadCashFlowParams } from "@/lib/data";
import { queryKeys } from "./keys";

export function useCashFlowOverviewQuery(
  supabase: SupabaseClient | null,
  params: LoadCashFlowParams,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.cashFlowOverview(params.start, params.end),
    queryFn: () => loadCashFlowOverview(supabase!, params),
    enabled: enabled && !!supabase,
    staleTime: 2 * 60_000,
  });
}
```

- [ ] **Step 2: Re-export from `src/hooks/queries/index.ts`**

Append:

```ts
export { useCashFlowOverviewQuery } from "./use-cash-flow-overview-query";
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/queries/use-cash-flow-overview-query.ts src/hooks/queries/index.ts
git commit -m "feat(hooks): useCashFlowOverviewQuery

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: PeriodSelector component

**Files:**
- Create: `src/features/cashflow/period-selector.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { solarToLunar } from "@/lib/lunar";
import {
  getCurrentWeekRange,
  getCurrentMonthRange,
} from "@/lib/period-math";
import type { PeriodPreset, PeriodState } from "@/lib/types";

interface PeriodSelectorProps {
  value: PeriodState;
  onChange(next: PeriodState): void;
}

const PRESET_LABELS: Record<PeriodPreset, string> = {
  week: "Tuần này",
  month: "Tháng này",
  custom: "Tuỳ chỉnh",
};

function formatRangeSolar(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-");
  const [ey, em, ed] = end.split("-");
  return `${sd}/${sm}/${sy} — ${ed}/${em}/${ey}`;
}

function formatRangeLunar(start: string, end: string): string {
  const startL = solarToLunar(start);
  const endL = solarToLunar(end);
  return `Âm: ${startL.day}/${startL.month} — ${endL.day}/${endL.month} năm ${endL.canChi}`;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  const lunarLabel = useMemo(
    () => formatRangeLunar(value.start, value.end),
    [value.start, value.end],
  );

  function selectPreset(preset: PeriodPreset) {
    if (preset === "week") {
      const r = getCurrentWeekRange();
      onChange({ preset, start: r.start, end: r.end });
      return;
    }
    if (preset === "month") {
      const r = getCurrentMonthRange();
      onChange({ preset, start: r.start, end: r.end });
      return;
    }
    // custom: keep current dates
    onChange({ ...value, preset: "custom" });
  }

  function setCustomStart(start: string) {
    onChange({ ...value, preset: "custom", start });
  }
  function setCustomEnd(end: string) {
    onChange({ ...value, preset: "custom", end });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["week", "month", "custom"] as const).map((p) => (
          <Button
            key={p}
            type="button"
            size="sm"
            variant={value.preset === p ? "primary" : "secondary"}
            onClick={() => selectPreset(p)}
          >
            {PRESET_LABELS[p]}
          </Button>
        ))}
        {value.preset === "custom" && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="date"
              value={value.start}
              onChange={(e) => setCustomStart(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
              aria-label="Từ ngày"
            />
            <span className="text-muted">—</span>
            <input
              type="date"
              value={value.end}
              onChange={(e) => setCustomEnd(e.target.value)}
              min={value.start}
              className="h-9 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
              aria-label="Đến ngày"
            />
          </div>
        )}
      </div>
      <div>
        <p className="text-sm text-ink">{formatRangeSolar(value.start, value.end)}</p>
        <p className="text-xs text-muted mt-0.5">{lunarLabel}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/cashflow/period-selector.tsx
git commit -m "feat(cashflow): PeriodSelector — week/month/custom chips + lunar label

Controlled component; parent owns PeriodState. Custom mode reveals
native date inputs. Header text shows solar range + lunar equivalent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: CashFlowKpiBar component

**Files:**
- Create: `src/features/cashflow/cash-flow-kpi-bar.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { formatVND } from "@/lib/format";
import type { CashFlowOverview, PeriodPreset } from "@/lib/types";

interface CashFlowKpiBarProps {
  data?: CashFlowOverview;
  preset: PeriodPreset;
}

function formatDeltaPct(current: number, previous: number | undefined): string {
  if (previous === undefined || previous === 0) return "—";
  const pct = ((current - previous) / previous) * 100;
  const sign = pct >= 0 ? "↑" : "↓";
  return `${sign}${Math.abs(pct).toFixed(0)}%`;
}

function previousLabel(preset: PeriodPreset): string {
  if (preset === "week") return "vs tuần trước";
  if (preset === "month") return "vs tháng trước";
  return "vs cùng kỳ trước";
}

interface KpiCardProps {
  label: string;
  amount: number;
  deltaLabel: string;
  delta: string;
  /** "good" = positive direction green; "bad" = positive direction red (OUT). */
  semantic: "good" | "bad" | "neutral";
}

function KpiCard({ label, amount, deltaLabel, delta, semantic }: KpiCardProps) {
  const isPositive = delta.startsWith("↑");
  const isNegative = delta.startsWith("↓");
  const goodIfUp = semantic === "good";
  const goodIfDown = semantic === "bad";
  const tone =
    semantic === "neutral"
      ? "text-muted"
      : (isPositive && goodIfUp) || (isNegative && goodIfDown)
        ? "text-success"
        : (isPositive && goodIfDown) || (isNegative && goodIfUp)
          ? "text-danger"
          : "text-muted";

  return (
    <Card>
      <CardBody>
        <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
        <p className="mt-2 text-2xl font-bold text-ink tabular-nums">
          {formatVND(amount)}
        </p>
        <p className={`mt-1 text-xs ${tone} tabular-nums`}>
          {delta} {deltaLabel}
        </p>
      </CardBody>
    </Card>
  );
}

export function CashFlowKpiBar({ data, preset }: CashFlowKpiBarProps) {
  const in_ = data?.in ?? 0;
  const out = data?.out ?? 0;
  const net = data?.net ?? 0;
  const prevIn = data?.prev_in;
  const prevOut = data?.prev_out;
  const prevNet = data?.prev_net;
  const label = previousLabel(preset);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCard
        label="Tổng vào"
        amount={in_}
        deltaLabel={label}
        delta={formatDeltaPct(in_, prevIn)}
        semantic="good"
      />
      <KpiCard
        label="Tổng ra"
        amount={out}
        deltaLabel={label}
        delta={formatDeltaPct(out, prevOut)}
        semantic="bad"
      />
      <KpiCard
        label="Chênh lệch"
        amount={net}
        deltaLabel={label}
        delta={formatDeltaPct(net, prevNet)}
        semantic="good"
      />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

If `formatVND` doesn't exist at `@/lib/format`, check the file: search the export and use the correct name (`formatVND` is the convention based on `hourly-bar-chart.tsx`'s import — verify it exists, else use `formatCurrency`).

- [ ] **Step 3: Commit**

```bash
git add src/features/cashflow/cash-flow-kpi-bar.tsx
git commit -m "feat(cashflow): CashFlowKpiBar — IN / OUT / NET with delta vs previous

Three KPI cards in a responsive grid. Delta colour-coding:
green when desirable (IN/NET up, OUT down), red when undesirable.
'—' shown when previous period is missing or zero.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: CashFlowChart component

**Files:**
- Create: `src/features/cashflow/cash-flow-chart.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import {
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardBody } from "@/components/ui/card";
import { formatVND } from "@/lib/format";
import type { CashFlowDayPoint } from "@/lib/types";

interface CashFlowChartProps {
  byDay: CashFlowDayPoint[];
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function abbreviateVND(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm bg-ink text-white text-xs px-2 py-1.5 shadow-popover space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="tabular-nums">
          <span style={{ color: entry.color }}>●</span> {entry.name}: {formatVND(entry.value)}
        </p>
      ))}
    </div>
  );
}

export function CashFlowChart({ byDay }: CashFlowChartProps) {
  const data = byDay.map((d) => ({
    date_label: shortDate(d.date),
    in: d.in,
    out: d.out,
  }));

  return (
    <Card>
      <CardBody>
        <h3 className="text-sm font-medium text-ink mb-3">
          Thu / Chi theo ngày
        </h3>
        <div className="w-full" style={{ height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <RechartsBarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 8 }}>
              <XAxis
                dataKey="date_label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted)" }}
              />
              <YAxis
                tickFormatter={abbreviateVND}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--color-muted)" }}
                width={40}
              />
              <RechartsTooltip
                cursor={{ fill: "var(--color-border)", opacity: 0.2 }}
                content={<ChartTooltip />}
              />
              <Legend
                wrapperStyle={{ fontSize: 12 }}
                formatter={(value) => (value === "in" ? "Thu" : "Chi")}
              />
              <Bar dataKey="in" fill="var(--color-success)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="out" fill="var(--color-danger)" radius={[6, 6, 0, 0]} />
            </RechartsBarChart>
          </ResponsiveContainer>
        </div>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

If `--color-success` / `--color-danger` aren't defined in the design tokens, fall back to literal hex values (e.g. `#16a34a` and `#dc2626`) — keep them inline since this is the only consumer.

- [ ] **Step 3: Commit**

```bash
git add src/features/cashflow/cash-flow-chart.tsx
git commit -m "feat(cashflow): CashFlowChart — grouped IN/OUT bar chart

Recharts directly (not the BarChart primitive — that one is single-
series). Tooltip shows both series with formatVND.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: TopCategoriesTable component

**Files:**
- Create: `src/features/cashflow/top-categories-table.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatVND } from "@/lib/format";
import type { CashFlowTopCategory } from "@/lib/types";

interface TopCategoriesTableProps {
  rows: CashFlowTopCategory[];
}

export function TopCategoriesTable({ rows }: TopCategoriesTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 5 hạng mục chi</CardTitle>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <EmptyState
            icon="wallet"
            title="Chưa có chi phí trong kỳ"
            subtitle="Khi có expense thì top hạng mục sẽ hiện ra đây."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 pr-2 text-xs font-medium uppercase tracking-wider text-muted w-10">
                  #
                </th>
                <th className="text-left py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Hạng mục
                </th>
                <th className="text-right py-2 px-2 text-xs font-medium uppercase tracking-wider text-muted">
                  Số tiền
                </th>
                <th className="text-right py-2 pl-2 text-xs font-medium uppercase tracking-wider text-muted w-16">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.category_name} className="border-b border-border last:border-0">
                  <td className="py-3 pr-2 text-muted">{i + 1}</td>
                  <td className="py-3 px-2 text-ink">{row.category_name}</td>
                  <td className="py-3 px-2 text-right tabular-nums text-ink">
                    {formatVND(row.amount)}
                  </td>
                  <td className="py-3 pl-2 text-right tabular-nums text-muted">
                    {(row.pct * 100).toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/cashflow/top-categories-table.tsx
git commit -m "feat(cashflow): TopCategoriesTable — top-5 expense categories

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: LunarCalendarWidget component

**Files:**
- Create: `src/features/cashflow/lunar-calendar-widget.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useMemo } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { solarToLunar } from "@/lib/lunar";

interface LunarCalendarWidgetProps {
  start: string; // YYYY-MM-DD
  end: string;
}

interface DayCell {
  iso: string;
  solarDay: number;
  lunarDay: number;
  lunarMonth: number;
  inRange: boolean;
  isToday: boolean;
  holiday?: string;
  isFirstOfMonth: boolean;
  isFullMoon: boolean;
}

function fromLocalISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function buildGrid(start: string, end: string): DayCell[][] {
  const startD = fromLocalISO(start);
  const endD = fromLocalISO(end);

  // Find the Monday of the week containing `start`.
  const startDow = startD.getDay(); // 0..6
  const offsetToMon = startDow === 0 ? -6 : 1 - startDow;
  const gridStart = new Date(startD);
  gridStart.setDate(startD.getDate() + offsetToMon);

  // Find the Sunday of the week containing `end`.
  const endDow = endD.getDay();
  const offsetToSun = endDow === 0 ? 0 : 7 - endDow;
  const gridEnd = new Date(endD);
  gridEnd.setDate(endD.getDate() + offsetToSun);

  const todayISO = toLocalISO(new Date());
  const startISO = start;
  const endISO = end;

  const grid: DayCell[][] = [];
  let week: DayCell[] = [];
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const iso = toLocalISO(cursor);
    const lunar = solarToLunar(cursor);
    week.push({
      iso,
      solarDay: cursor.getDate(),
      lunarDay: lunar.day,
      lunarMonth: lunar.month,
      inRange: iso >= startISO && iso <= endISO,
      isToday: iso === todayISO,
      holiday: lunar.holiday,
      isFirstOfMonth: lunar.isFirstOfMonth,
      isFullMoon: lunar.isFullMoon,
    });
    if (week.length === 7) {
      grid.push(week);
      week = [];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  if (week.length) grid.push(week);
  return grid;
}

const DOW_LABELS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

export function LunarCalendarWidget({ start, end }: LunarCalendarWidgetProps) {
  const grid = useMemo(() => buildGrid(start, end), [start, end]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lịch âm dương của kỳ</CardTitle>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-7 gap-1 text-center">
          {DOW_LABELS.map((d) => (
            <div key={d} className="text-xs font-medium text-muted py-1">
              {d}
            </div>
          ))}
          {grid.flat().map((cell) => {
            const dim = !cell.inRange;
            const ring = cell.isToday;
            const badge = cell.holiday
              ? cell.holiday
              : cell.isFirstOfMonth
                ? "Mùng 1"
                : cell.isFullMoon
                  ? "Rằm"
                  : null;
            return (
              <div
                key={cell.iso}
                className={[
                  "aspect-square rounded-md border p-1 text-left",
                  dim ? "bg-surface-muted text-muted border-transparent" : "bg-surface text-ink border-border",
                  ring ? "ring-2 ring-ink" : "",
                ].join(" ")}
              >
                <div className="text-sm font-medium leading-tight">{cell.solarDay}</div>
                <div className="text-[10px] text-muted tabular-nums leading-tight">
                  {cell.lunarDay}/{cell.lunarMonth}
                </div>
                {badge && (
                  <div className="mt-0.5 text-[9px] leading-tight text-warning font-medium truncate" title={badge}>
                    {badge}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

If `bg-surface-muted` / `text-warning` aren't in the Tailwind theme, substitute with `bg-muted/30` and `text-amber-600` (or whatever the project uses). The visual polish can be refined during manual smoke.

- [ ] **Step 3: Commit**

```bash
git add src/features/cashflow/lunar-calendar-widget.tsx
git commit -m "feat(cashflow): LunarCalendarWidget — solar + lunar calendar grid

Mon-Sun grid covering the full weeks that contain the period.
Out-of-range days dimmed. Today gets a ring. Mùng 1, rằm, and
the six major lunar holidays get badges.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: CashFlowView container

**Files:**
- Create: `src/features/cashflow/cash-flow-view.tsx`

- [ ] **Step 1: Create the container**

```tsx
"use client";

import { useMemo, useState } from "react";
import { AlertBanner } from "@/components/ui/alert-banner";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { useSupabase } from "@/hooks/use-supabase";
import { useCashFlowOverviewQuery } from "@/hooks/queries";
import {
  getCurrentMonthRange,
  getPreviousPeriod,
} from "@/lib/period-math";
import type { PeriodState, UserRole } from "@/lib/types";
import { PeriodSelector } from "./period-selector";
import { CashFlowKpiBar } from "./cash-flow-kpi-bar";
import { CashFlowChart } from "./cash-flow-chart";
import { TopCategoriesTable } from "./top-categories-table";
import { LunarCalendarWidget } from "./lunar-calendar-widget";

interface CashFlowViewProps {
  role: UserRole;
}

function defaultPeriod(): PeriodState {
  const r = getCurrentMonthRange();
  return { preset: "month", start: r.start, end: r.end };
}

export function CashFlowView({ role }: CashFlowViewProps) {
  const supabase = useSupabase();
  const [period, setPeriod] = useState<PeriodState>(defaultPeriod);

  const compare = useMemo(
    () => getPreviousPeriod(period.start, period.end, period.preset),
    [period.start, period.end, period.preset],
  );

  const query = useCashFlowOverviewQuery(
    supabase,
    {
      start: period.start,
      end: period.end,
      compareStart: compare.start,
      compareEnd: compare.end,
    },
    role === "owner" || role === "manager",
  );

  if (role !== "owner" && role !== "manager") {
    return (
      <EmptyState
        icon="lock"
        title="Module dành cho owner/manager"
        subtitle="Bạn chưa có quyền vào trang này."
      />
    );
  }

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={32} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <AlertBanner variant="danger" title="Không tải được dòng tiền">
        {query.error instanceof Error ? query.error.message : String(query.error)}
      </AlertBanner>
    );
  }

  return (
    <div className="space-y-6">
      <PeriodSelector value={period} onChange={setPeriod} />
      <CashFlowKpiBar data={query.data} preset={period.preset} />
      <CashFlowChart byDay={query.data?.by_day ?? []} />
      <div className="grid gap-6 lg:grid-cols-2">
        <TopCategoriesTable rows={query.data?.top_categories ?? []} />
        <LunarCalendarWidget start={period.start} end={period.end} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/cashflow/cash-flow-view.tsx
git commit -m "feat(cashflow): CashFlowView — compose all sub-components

Period state owned at the container; query fires on every change.
Role gate at the top; previous-period derivation uses period-math.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Navigation wiring

**Files:**
- Modify: `src/features/navigation/navigation.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add "cashflow" to ViewKey + NAV_ITEMS + DEFAULT_SIDEBAR_BY_ROLE**

In `src/features/navigation/navigation.ts`:

Find `export type ViewKey =` and add `"cashflow"`:

```ts
export type ViewKey =
  | "dashboard" | "expenses" | "shifts" | "cash" | "safe"
  | "handover" | "inventory"
  | "reports" | "pivot" | "cashflow" | "settings";
```

Find `NAV_ITEMS` array and insert after the existing `pivot` entry (before `settings`):

```ts
  { key: "cashflow", label: "Dòng tiền", icon: "trendingUp", roles: ["owner", "manager"] },
```

Find `DEFAULT_SIDEBAR_BY_ROLE` and update owner + manager defaults to include `"cashflow"` (insert after `"pivot"`):

```ts
export const DEFAULT_SIDEBAR_BY_ROLE: Record<UserRole, ReadonlyArray<ViewKey>> = {
  owner:           ["dashboard", "expenses", "shifts", "cash", "safe", "handover", "inventory", "reports", "pivot", "cashflow", "settings"],
  manager:         ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports", "pivot", "cashflow", "settings"],
  staff_operator:  ["dashboard", "expenses", "shifts", "cash", "handover", "inventory", "reports"],
  employee_viewer: ["dashboard"],
};
```

Verify that the `IconName` type at `src/components/ui/icons.ts` actually has `"trendingUp"`. If not, pick a similar icon that exists (e.g. `"barChart3"`, `"piggyBank"`, `"banknote"`). Read the icons file briefly:

```bash
grep -E '"(trendingUp|trending-up|trending_up)"' src/components/ui/icons.tsx
```

If the icon name is different, update both the NAV_ITEMS entry and this check. If no trending icon exists at all, default to `"barChart3"`.

- [ ] **Step 2: Add the dispatcher line in `src/app/page.tsx`**

Find the existing `<DashboardView />` / `<ReportsView />` / `<PivotView />` block (around line 228-254 in the version after the user-mgmt branch). Insert a new line between `<PivotView />` and `<ExpensesView />` (or wherever logical), matching the existing pattern:

```tsx
{view === "cashflow" && <CashFlowView role={account.role} />}
```

Also add the import at the top of `page.tsx`:

```tsx
import { CashFlowView } from "@/features/cashflow/cash-flow-view";
```

- [ ] **Step 3: Type-check + run tests**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: exit code 0.

Run: `npm run test:run`
Expected: PASS, 91 tests (75 baseline + 6 period-math + 10 lunar).

- [ ] **Step 4: Commit**

```bash
git add src/features/navigation/navigation.ts src/app/page.tsx
git commit -m "feat(navigation): wire 'Dòng tiền' nav item for owner/manager

CashFlowView slotted into page.tsx dispatcher between Pivot and
Settings. Added to default sidebar for owner + manager.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Final verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Run the full verify suite**

Run: `npm run verify:phase`
Expected: PASS — Vitest (91 tests) + pgTAP (existing + 7 new assertions).

- [ ] **Step 2: Start the app (if not already up)**

```bash
# In one terminal: Supabase if not running
cd supabase && docker compose up -d
```

```bash
# In another: Next.js dev
npm run dev
```

Visit http://localhost:3009.

- [ ] **Step 3: Manual smoke — 5 scenarios**

Run these scenarios in order; all must pass:

1. **Owner login + nav item visible** — Log in as the seeded owner. Sidebar shows "Dòng tiền" between Pivot and Thiết lập. Click → CashFlowView renders. Default period = current month (1/5–31/5/2026 for the brainstorm date). Header shows solar range + lunar range with năm Bính Ngọ.

2. **KPI + chart populated** — Expect three KPI cards (Tổng vào / Tổng ra / Chênh lệch) showing seed values + delta vs previous month. Chart below shows daily IN/OUT bars (xanh / đỏ).

3. **Toggle Tuần này** — Click chip → range narrows to Mon-Sun of current week (18/5–24/5/2026). All sections re-render. Calendar widget shrinks to one or two rows.

4. **Toggle Tuỳ chỉnh + pick a 3-day range** — Click "Tuỳ chỉnh", set from=20/5/2026, to=22/5/2026. KPI updates, chart shows 3 bars, calendar widget highlights those 3 days inside the relevant Mon-Sun week (other days dimmed).

5. **Role gate** — Log out, log in as a staff_operator (or any non-owner/manager). "Dòng tiền" NOT in sidebar. Direct API to `view=cashflow` (if URL-routable) → EmptyState lock shows. RPC call directly via DevTools console with staff JWT → 403/error from `forbidden: cash_flow_overview requires owner/manager`.

6. **Lunar widget accuracy spot-check** — On the calendar widget for May 2026, locate solar 17/5/2026 → lunar should be `1/4` (Mùng 1 tháng 4 năm Bính Ngọ) with a "Mùng 1" badge. If a known holiday date is in range, check its badge text matches expected (Tết Đoan Ngọ = 19/6/2026 → 5/5 lunar).

- [ ] **Step 4: Final commit (only if smoke surfaced any fix)**

If smoke is clean: skip this step.

If a fix was needed:

```bash
git add -A
git commit -m "fix(cashflow): <describe what surfaced during smoke>"
```

---

## Self-Review (controller's own check after writing the plan)

### Spec coverage

| Spec section | Task(s) | Notes |
|---|---|---|
| §1 Goal — nav item visible to owner/manager | Task 14 | NAV_ITEMS + DEFAULT_SIDEBAR_BY_ROLE updated |
| §1 — KPI bar (IN/OUT/NET + delta) | Task 9 | CashFlowKpiBar |
| §1 — Daily IN/OUT chart | Task 10 | CashFlowChart (Recharts direct) |
| §1 — Top-5 expense categories | Tasks 4, 11 | RPC SQL + table component |
| §1 — Lunar calendar widget | Tasks 3, 12 | lunar.ts + LunarCalendarWidget |
| §1 — Period selector (week/month/custom) | Tasks 2, 8 | period-math + PeriodSelector |
| §1 — Previous-period delta | Tasks 2, 4, 9 | period-math + RPC params + KPI display |
| §1 — `verify:phase` green | Task 15 | full suite run |
| §3.1 Module layout | Tasks 2/3/4/5/6/7/8/9/10/11/12/13 | each file from §3.1 has its own task |
| §3.3 Navigation wiring | Task 14 | ViewKey + NAV_ITEMS + DEFAULT_SIDEBAR_BY_ROLE + page.tsx |
| §4 Period selector behaviour | Tasks 2, 8 | preset semantics + custom inputs |
| §5 RPC contract | Tasks 4, 5 | migration + pgTAP |
| §6 UI components (6 files) | Tasks 8–13 | one per file |
| §7 Lunar lib decision | Task 3 | inlined HND (matches §7.1 decision rule "≤ 5 KB / zero dep") |
| §8 Migration + pgTAP | Tasks 4, 5 | |
| §9 Testing strategy | Tasks 2 (Vitest), 3 (Vitest), 5 (pgTAP), 15 (manual) | |
| §10 Open questions | Documented in spec; no code change | preset/custom divergence, payroll edits, can-chi localisation, frontend-design timing, sidebar default |
| §11 Implementation order | Tasks 1–15 ordered to match spec §11 | |

### Placeholder scan

Scanned for "TBD", "TODO", "implement later", "fill in details", "Add appropriate error handling", "Similar to Task N". None present. Every code step includes the complete code or the exact command.

Known soft-decisions documented inline with explicit fallbacks:
- Task 5 Step 1 — pgTAP auth-bypass idiom may differ; explicit instruction to read an existing pgTAP test and mirror it
- Task 9 Step 2 — `formatVND` import name may need a fallback to `formatCurrency`
- Task 10 Step 2 — CSS custom-property names may not exist; hex fallback given
- Task 12 Step 2 — Tailwind utility classes may differ; substitution rule given
- Task 14 Step 1 — icon name `"trendingUp"` may not be in the registry; fallback to `"barChart3"`

Each carries an exact "if not, do X" instruction — never a vague "figure it out".

### Type consistency

- `PeriodState` (Task 1) → consumed in Tasks 2, 8, 9, 13. Properties: `preset, start, end`. Matches.
- `PeriodPreset` (Task 1) → consumed in Tasks 2, 8, 9. Values: `"week"|"month"|"custom"`. Matches.
- `CashFlowOverview` (Task 1) → consumed in Tasks 6, 7, 9, 13. Properties: `in, out, net, by_day, top_categories, prev_in?, prev_out?, prev_net?`. Matches the RPC return shape in Task 4 exactly.
- `CashFlowDayPoint` (Task 1) → consumed in Task 10. Properties: `date, in, out`. Matches.
- `CashFlowTopCategory` (Task 1) → consumed in Task 11. Properties: `category_name, amount, pct`. Matches.
- `LoadCashFlowParams` (Task 6) → consumed in Task 7. Properties: `start, end, compareStart?, compareEnd?`. Matches.
- `LunarInfo` (Task 3) → consumed in Tasks 8, 12 via `solarToLunar()`. Properties: `day, month, year, isLeapMonth, canChi, holiday?, isFirstOfMonth, isFullMoon`. Matches.
- `cashFlowOverview` queryKey (Task 1) → consumed in Task 7. Signature `(start, end)`. Matches.

All types and function signatures are consistent between definition and use sites. No drift detected.
