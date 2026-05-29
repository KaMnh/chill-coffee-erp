# KiotViet Configurable Sync Date Range — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let owners/managers set a persistent default sync window (1–31 days) and run one-off date-range backfills for KiotViet sync, from the Settings → "Kết nối KiotViet" card.

**Architecture:** A pure `computeSyncRange` helper resolves the date range; `runSync` calls it with the owner-only `sync_window_days` setting (so the window value never leaves the server). The dashboard sync button + stale auto-load send `applyWindow:true`; the 2-min background interval + tab-resume send `applyWindow:false` (stay single-day). A separate range-backfill action sends explicit `fromDate/toDate`. Pagination truncation is now surfaced instead of silently dropped.

**Tech Stack:** Next.js 15 API routes (nodejs runtime), TypeScript strict, TanStack Query, Vitest, self-hosted Supabase (no schema change — setting lives in the `kiotviet_credentials` app_settings JSON blob; ingest reuses `ingest_kiotviet_batch`).

**Spec:** [docs/superpowers/specs/2026-05-29-kiotviet-sync-date-range-design.md](../specs/2026-05-29-kiotviet-sync-date-range-design.md)

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/lib/kiotviet/sync-range.ts` | Pure date-range resolver (range/window/single) | Create |
| `src/lib/kiotviet/__tests__/sync-range.test.ts` | Vitest for the resolver | Create |
| `src/lib/kiotviet/types.ts` | `sync_window_days` on `KvCredentials` + default | Modify |
| `src/app/api/kiotviet/config/route.ts` | Whitelist `sync_window_days` on save | Modify |
| `src/lib/data/kiotviet-config.ts` | `sync_window_days` on `KvConfigDto` | Modify |
| `src/lib/kiotviet/sync.ts` | Use resolver; `truncated` flag; maxPages-by-mode | Modify |
| `src/app/api/kiotviet/sync/route.ts` | Parse `anchorDate`/`applyWindow`; forward | Modify |
| `src/lib/data/pos-sync.ts` | New request shape + `triggerPosRangeSync` | Modify |
| `src/hooks/use-pos-sync.ts` | `applyWindow` in vars; manual+stale = true | Modify |
| `src/hooks/use-background-pos-sync.ts` | Pass `applyWindow:false` | Modify |
| `src/app/page.tsx` | Manual handler passes `applyWindow:true` | Modify |
| `src/features/settings/kiotviet-config-form.tsx` | Window field + range backfill section | Modify |

**Testing note:** Only the pure helper (Task 1) is unit-tested (TDD), matching the repo pattern (`excel-import.ts`/`transform.ts` have Vitest; I/O routes/hooks are verified by `npm run build` + manual E2E). Tasks 2–7 are gated by `npm run build`; Task 8 is the manual E2E + full verification.

---

### Task 1: Pure date-range resolver `computeSyncRange`

**Files:**
- Create: `src/lib/kiotviet/sync-range.ts`
- Test: `src/lib/kiotviet/__tests__/sync-range.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/kiotviet/__tests__/sync-range.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { computeSyncRange, subtractDays, clampWindowDays } from "../sync-range";

describe("subtractDays", () => {
  it("subtracts across month/year boundaries (tz-independent)", () => {
    expect(subtractDays("2026-05-01", 1)).toBe("2026-04-30");
    expect(subtractDays("2026-03-01", 1)).toBe("2026-02-28");
    expect(subtractDays("2026-01-01", 1)).toBe("2025-12-31");
    expect(subtractDays("2026-05-29", 6)).toBe("2026-05-23");
    expect(subtractDays("2026-05-29", 0)).toBe("2026-05-29");
  });
});

describe("clampWindowDays", () => {
  it("clamps to 1..31 and floors fractionals", () => {
    expect(clampWindowDays(0)).toBe(1);
    expect(clampWindowDays(1)).toBe(1);
    expect(clampWindowDays(7)).toBe(7);
    expect(clampWindowDays(31)).toBe(31);
    expect(clampWindowDays(99)).toBe(31);
    expect(clampWindowDays(3.9)).toBe(3);
    expect(clampWindowDays(undefined)).toBe(1);
    expect(clampWindowDays(Number.NaN)).toBe(1);
  });
});

describe("computeSyncRange", () => {
  const today = "2026-05-29";

  it("single day when window not applied (even if N=7)", () => {
    expect(computeSyncRange({ anchorDate: "2026-05-15", applyWindow: false, windowDays: 7, today }))
      .toEqual({ from: "2026-05-15", to: "2026-05-15", mode: "single" });
  });

  it("single day when applyWindow but N=1", () => {
    expect(computeSyncRange({ anchorDate: "2026-05-15", applyWindow: true, windowDays: 1, today }))
      .toEqual({ from: "2026-05-15", to: "2026-05-15", mode: "single" });
  });

  it("windowed N=7 ends at anchor, extends back N-1", () => {
    expect(computeSyncRange({ anchorDate: "2026-05-29", applyWindow: true, windowDays: 7, today }))
      .toEqual({ from: "2026-05-23", to: "2026-05-29", mode: "window" });
  });

  it("falls back to today when no anchor", () => {
    expect(computeSyncRange({ applyWindow: false, today }))
      .toEqual({ from: "2026-05-29", to: "2026-05-29", mode: "single" });
  });

  it("range mode passes explicit from/to through", () => {
    expect(computeSyncRange({ fromDate: "2026-05-01", toDate: "2026-05-10", today }))
      .toEqual({ from: "2026-05-01", to: "2026-05-10", mode: "range" });
  });

  it("range mode normalizes inverted from/to", () => {
    expect(computeSyncRange({ fromDate: "2026-05-10", toDate: "2026-05-01", today }))
      .toEqual({ from: "2026-05-01", to: "2026-05-10", mode: "range" });
  });

  it("ignores a partial range (only fromDate) → window/single path", () => {
    expect(computeSyncRange({ fromDate: "2026-05-01", anchorDate: "2026-05-29", applyWindow: false, today }))
      .toEqual({ from: "2026-05-29", to: "2026-05-29", mode: "single" });
  });

  it("clamps oversized window", () => {
    const r = computeSyncRange({ anchorDate: "2026-05-29", applyWindow: true, windowDays: 999, today });
    expect(r).toEqual({ from: subtractDays("2026-05-29", 30), to: "2026-05-29", mode: "window" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/kiotviet/__tests__/sync-range.test.ts`
Expected: FAIL — `Failed to resolve import "../sync-range"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/kiotviet/sync-range.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/kiotviet/__tests__/sync-range.test.ts`
Expected: PASS (3 describe blocks, all green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/kiotviet/sync-range.ts src/lib/kiotviet/__tests__/sync-range.test.ts
git commit -m "feat(kiotviet): pure computeSyncRange resolver + tests"
```

---

### Task 2: Persist `sync_window_days` (type, default, route, DTO)

**Files:**
- Modify: `src/lib/kiotviet/types.ts`
- Modify: `src/app/api/kiotviet/config/route.ts`
- Modify: `src/lib/data/kiotviet-config.ts`

- [ ] **Step 1: Add the field to `KvCredentials`**

In `src/lib/kiotviet/types.ts`, inside `KvCredentials` (after `webhook_secret`):

```ts
  webhook_secret: string;
  /** Default sync window in days (1..31). Applies to manual sync + stale
   *  auto-load: a windowed sync pulls [anchor-(N-1) … anchor]. Default 1
   *  (single day = legacy behavior). */
  sync_window_days: number;
```

And in `DEFAULT_KV_CREDENTIALS` (after `webhook_secret: ""`):

```ts
  webhook_secret: "",
  sync_window_days: 1
```

(`loadKvCredentials` spreads DEFAULT over the stored blob, so existing rows read back as `1`. `maskCredentials` spreads `...creds`, so the GET response already includes it — no change there.)

- [ ] **Step 2: Whitelist it in the config save route**

In `src/app/api/kiotviet/config/route.ts`, inside `POST`, after the `rate_limit_per_sec` block (around line 53) and before the `webhook_secret` block:

```ts
    if (
      typeof body.sync_window_days === "number" &&
      Number.isInteger(body.sync_window_days) &&
      body.sync_window_days >= 1 &&
      body.sync_window_days <= 31
    ) {
      patch.sync_window_days = body.sync_window_days;
    }
```

- [ ] **Step 3: Add it to the client DTO**

In `src/lib/data/kiotviet-config.ts`, inside `KvConfigDto` (after `webhook_secret: string;`):

```ts
  webhook_secret: string;
  /** Default sync window in days (1..31). */
  sync_window_days?: number;
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/kiotviet/types.ts src/app/api/kiotviet/config/route.ts src/lib/data/kiotviet-config.ts
git commit -m "feat(kiotviet): persist sync_window_days setting (1-31)"
```

---

### Task 3: Wire the window into `runSync` + surface truncation

**Files:**
- Modify: `src/lib/kiotviet/sync.ts`

- [ ] **Step 1: Import the resolver**

In `src/lib/kiotviet/sync.ts`, after the existing import of `buildIngestPayload` (line 17):

```ts
import { computeSyncRange } from "./sync-range";
```

- [ ] **Step 2: Extend `SyncOptions` and `SyncResult`**

Replace the `SyncOptions` type (lines 21–30) with:

```ts
export type SyncOptions = {
  /** Explicit range (manual backfill). When both set → range mode. Format 'YYYY-MM-DD'. */
  fromDate?: string;
  toDate?: string;
  /** Anchor for window/single mode (default: VN today). */
  anchorDate?: string;
  /** Apply the configured sync_window_days window around anchorDate. */
  applyWindow?: boolean;
  /** Default: 100; max page size from KV API. */
  pageSize?: number;
  /** Hard cap on pages. Default: 50 (single/window) or 300 (range backfill). */
  maxPages?: number;
};
```

In `SyncResult` (lines 32–39), add `truncated`:

```ts
export type SyncResult = {
  status: "success" | "skipped" | "error";
  message: string;
  fetched: number;
  ingested: { orders: number; items: number; payments: number } | null;
  run_id?: string;
  pages_scanned: number;
  /** True if the page cap was hit before all matching invoices were fetched. */
  truncated: boolean;
};
```

- [ ] **Step 3: Replace the date defaults with the resolver**

In `runSync`, replace lines 131–134:

```ts
  const fromDate = options.fromDate ?? todayIso();
  const toDate = options.toDate ?? fromDate;
  const pageSize = options.pageSize ?? 100;
  const maxPages = options.maxPages ?? 50;
```

with:

```ts
  const range = computeSyncRange({
    fromDate: options.fromDate,
    toDate: options.toDate,
    anchorDate: options.anchorDate,
    applyWindow: options.applyWindow,
    windowDays: creds.sync_window_days,
    today: todayIso()
  });
  const fromDate = range.from;
  const toDate = range.to;
  const pageSize = options.pageSize ?? 100;
  // Range backfill is deliberate → allow far more pages than the routine cap.
  const maxPages = options.maxPages ?? (range.mode === "range" ? 300 : 50);
```

- [ ] **Step 4: Add `truncated: false` to the two skip returns and the empty return**

The `is_active` skip return (was lines 113–119), the missing-creds skip return (was lines 122–129), and the empty-invoices return (was lines 160–166) each need `truncated: false` added as the last property. Example — the empty-invoices return becomes:

```ts
  if (allInvoices.length === 0) {
    return {
      status: "success",
      message: "Không có hóa đơn nào trong khoảng thời gian.",
      fetched: 0,
      ingested: { orders: 0, items: 0, payments: 0 },
      pages_scanned: pagesScanned,
      truncated: false
    };
  }
```

Do the same (`truncated: false`) for the two earlier `status: "skipped"` returns.

- [ ] **Step 5: Compute and return `truncated` in the success path**

Immediately after the pagination `for` loop closes (after the line `  }` that ends the loop, before the `if (allInvoices.length === 0)` block), add:

```ts
  const truncated = pagesScanned >= maxPages && allInvoices.length < total;
```

Then in the final success return (was lines 191–202), add `truncated` as the last property:

```ts
  return {
    status: "success",
    message: `Đã sync ${result.inserted_or_updated_orders ?? 0} hóa đơn (${result.items ?? 0} items, ${result.payments ?? 0} payments).`,
    fetched: allInvoices.length,
    ingested: {
      orders: result.inserted_or_updated_orders ?? 0,
      items: result.items ?? 0,
      payments: result.payments ?? 0
    },
    run_id: result.run_id,
    pages_scanned: pagesScanned,
    truncated
  };
```

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: compiles (TS forces every `SyncResult` return to include `truncated`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/kiotviet/sync.ts
git commit -m "feat(kiotviet): runSync uses computeSyncRange + surfaces truncation"
```

---

### Task 4: Route — parse `anchorDate`/`applyWindow`, forward to runSync

**Files:**
- Modify: `src/app/api/kiotviet/sync/route.ts`

- [ ] **Step 1: Extend the parsed body type**

Replace the body declaration (line 60):

```ts
  let body: { fromDate?: string; toDate?: string; force?: boolean; reason?: string };
```

with:

```ts
  let body: {
    fromDate?: string;
    toDate?: string;
    anchorDate?: string;
    applyWindow?: boolean;
    force?: boolean;
    reason?: string;
  };
```

- [ ] **Step 2: Forward the new options to runSync**

Replace the `runSync` call (lines 123–127):

```ts
    const result = await runSync(supabase, ingestClientId, ingestClientSecret, {
      fromDate: body.fromDate,
      toDate: body.toDate
    });
```

with:

```ts
    const result = await runSync(supabase, ingestClientId, ingestClientSecret, {
      fromDate: body.fromDate,
      toDate: body.toDate,
      anchorDate: body.anchorDate,
      applyWindow: body.applyWindow
    });
```

(The route already returns the whole `result` via `NextResponse.json(result)`, so `truncated` is included automatically.)

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: compiles, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/kiotviet/sync/route.ts
git commit -m "feat(kiotviet): sync route accepts anchorDate + applyWindow"
```

---

### Task 5: Client data layer — new request shape + `triggerPosRangeSync`

**Files:**
- Modify: `src/lib/data/pos-sync.ts`

- [ ] **Step 1: Replace `triggerPosSync` and add `triggerPosRangeSync`**

Replace the entire body of `triggerPosSync` (lines 12–51) with the two functions below (the file already imports `SupabaseClient`). The data barrel uses `export * from "./pos-sync"`, so `triggerPosRangeSync` is auto-exported — no index change.

```ts
export async function triggerPosSync(
  supabase: SupabaseClient,
  payload: { businessDate: string; applyWindow?: boolean; force?: boolean; reason?: string }
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Chưa đăng nhập.");

  const res = await fetch("/api/kiotviet/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      // Server resolves the actual range from the owner-only window setting.
      anchorDate: payload.businessDate,
      applyWindow: payload.applyWindow ?? false,
      force: Boolean(payload.force),
      reason: payload.reason ?? "manual_refresh"
    })
  });

  const json = (await res.json().catch(() => ({}))) as {
    status?: "success" | "skipped" | "error";
    message?: string;
    error?: string;
    ingested?: { orders: number; items: number; payments: number };
  };

  if (!res.ok || json.status === "error") {
    throw new Error(json.error ?? json.message ?? `Sync POS thất bại (HTTP ${res.status}).`);
  }

  return {
    status: (json.status === "skipped" ? "skipped" : "triggered") as "triggered" | "skipped",
    message: json.message,
    ingested: json.ingested
  };
}

/**
 * Owner/manager manual backfill of an explicit date range. Always force
 * (bypass the 30s cooldown). Returns fetched/ingested counts + truncated flag.
 */
export async function triggerPosRangeSync(
  supabase: SupabaseClient,
  payload: { fromDate: string; toDate: string; reason?: string }
) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Chưa đăng nhập.");

  const res = await fetch("/api/kiotviet/sync", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      fromDate: payload.fromDate,
      toDate: payload.toDate,
      force: true,
      reason: payload.reason ?? "manual_range"
    })
  });

  const json = (await res.json().catch(() => ({}))) as {
    status?: "success" | "skipped" | "error";
    message?: string;
    error?: string;
    fetched?: number;
    ingested?: { orders: number; items: number; payments: number };
    truncated?: boolean;
  };

  if (!res.ok || json.status === "error") {
    throw new Error(json.error ?? json.message ?? `Sync khoảng ngày thất bại (HTTP ${res.status}).`);
  }

  return {
    status: (json.status ?? "success") as "success" | "skipped",
    message: json.message,
    fetched: json.fetched ?? 0,
    ingested: json.ingested,
    truncated: Boolean(json.truncated)
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: FAILS — `usePosSync` / `page.tsx` still call `triggerPosSync` with the old `{ businessDate }`-only shape via vars that lack `applyWindow`. This is expected; Task 6 fixes the callers. (If you prefer a green build per task, do Tasks 5 and 6 back-to-back before building.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/data/pos-sync.ts
git commit -m "feat(kiotviet): triggerPosSync sends anchorDate+applyWindow; add triggerPosRangeSync"
```

---

### Task 6: Hooks + dashboard — thread `applyWindow` through all triggers

**Files:**
- Modify: `src/hooks/use-pos-sync.ts`
- Modify: `src/hooks/use-background-pos-sync.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: `usePosSync` — add `applyWindow` to vars; stale auto-load = true**

In `src/hooks/use-pos-sync.ts`, replace the `mutationFn` (lines 28–30):

```ts
  const mutation = useMutation({
    mutationFn: (vars: { force: boolean; reason: string }) =>
      triggerPosSync(supabase!, { businessDate, force: vars.force, reason: vars.reason }),
```

with:

```ts
  const mutation = useMutation({
    mutationFn: (vars: { force: boolean; reason: string; applyWindow: boolean }) =>
      triggerPosSync(supabase!, {
        businessDate,
        force: vars.force,
        reason: vars.reason,
        applyWindow: vars.applyWindow
      }),
```

And in the stale auto-load effect, replace the `mutate` call (line 45):

```ts
    mutation.mutate({ force: false, reason: "auto_load" });
```

with:

```ts
    mutation.mutate({ force: false, reason: "auto_load", applyWindow: true });
```

- [ ] **Step 2: `use-background-pos-sync` — frequent triggers stay single-day**

In `src/hooks/use-background-pos-sync.ts`, replace the `SyncVars` type (line 10):

```ts
type SyncVars = { force: boolean; reason: string };
```

with:

```ts
type SyncVars = { force: boolean; reason: string; applyWindow: boolean };
```

Replace the interval mutate call (line 61):

```ts
        mutateRef.current({ force: false, reason: "background_interval" });
```

with:

```ts
        mutateRef.current({ force: false, reason: "background_interval", applyWindow: false });
```

Replace the visibility-resume mutate call (line 85):

```ts
        mutateRef.current({ force: false, reason: "visibility_resume" });
```

with:

```ts
        mutateRef.current({ force: false, reason: "visibility_resume", applyWindow: false });
```

- [ ] **Step 3: `page.tsx` — manual button applies the window**

In `src/app/page.tsx`, replace the manual sync call (line 174):

```ts
      await posSync.mutateAsync({ force: true, reason: "manual_refresh" });
```

with:

```ts
      await posSync.mutateAsync({ force: true, reason: "manual_refresh", applyWindow: true });
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: compiles (every `mutate`/`mutateAsync` caller now supplies `applyWindow`; TS confirms none was missed).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-pos-sync.ts src/hooks/use-background-pos-sync.ts src/app/page.tsx
git commit -m "feat(kiotviet): manual+stale syncs apply window; background stays single-day"
```

---

### Task 7: Settings UI — window field + range backfill section

**Files:**
- Modify: `src/features/settings/kiotviet-config-form.tsx`

- [ ] **Step 1: Add imports + query client**

In `src/features/settings/kiotviet-config-form.tsx`, update the data import (lines 13–17) to add `triggerPosRangeSync`:

```ts
import {
  loadKiotvietConfig,
  saveKiotvietConfig,
  triggerPosRangeSync,
  type KvConfigDto,
} from "@/lib/data";
```

Add a TanStack import at the top of the import block (after the `"use client";` line and existing react import):

```ts
import { useQueryClient } from "@tanstack/react-query";
```

Inside the component, after `const { toast } = useToast();` (line 37):

```ts
  const queryClient = useQueryClient();
```

- [ ] **Step 2: Add state for the window field + range backfill**

After the `clientIdError` state (line 56), add:

```ts
  const [syncWindowDays, setSyncWindowDays] = useState(1);
  const [windowError, setWindowError] = useState<string | undefined>(undefined);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [isRangeBusy, setIsRangeBusy] = useState(false);
```

- [ ] **Step 3: Load the window value in `applyConfig`**

In `applyConfig` (after `setRateLimit(cfg.rate_limit_per_sec ?? 4);`, line 66):

```ts
    setSyncWindowDays(cfg.sync_window_days ?? 1);
```

And in the same function's error resets (after `setRateLimitError(undefined);`, line 71):

```ts
    setWindowError(undefined);
```

- [ ] **Step 4: Validate + include the window in `handleSave`**

In `handleSave`, after the `rate_limit` validation block (line 121, before `if (blocked) return;`):

```ts
    if (!Number.isInteger(syncWindowDays) || syncWindowDays < 1 || syncWindowDays > 31) {
      setWindowError("Phải là số nguyên 1–31.");
      blocked = true;
    } else {
      setWindowError(undefined);
    }
```

And add the field to the save `patch` object (after `is_active: isActive,`, line 131):

```ts
      is_active: isActive,
      sync_window_days: syncWindowDays,
```

- [ ] **Step 5: Add the range-sync handler**

After `handleSave` closes (after line 151), add:

```ts
  async function handleRangeSync() {
    if (!supabase || isRangeBusy) return;
    if (!rangeFrom || !rangeTo) {
      toast({ semantic: "danger", message: "Chọn cả Từ ngày và Đến ngày." });
      return;
    }
    if (rangeFrom > rangeTo) {
      toast({ semantic: "danger", message: "Từ ngày phải ≤ Đến ngày." });
      return;
    }
    const days = Math.round((Date.parse(rangeTo) - Date.parse(rangeFrom)) / 86_400_000) + 1;
    if (days > 31 && !confirm(`Khoảng ${days} ngày có thể chậm hoặc timeout. Tiếp tục?`)) {
      return;
    }
    setIsRangeBusy(true);
    try {
      const r = await triggerPosRangeSync(supabase, { fromDate: rangeFrom, toDate: rangeTo });
      if (r.status === "skipped") {
        toast({ semantic: "info", message: r.message ?? "Đã bỏ qua (kết nối tắt?)." });
      } else if (r.truncated) {
        toast({
          semantic: "warning",
          message: `Đã lấy ${r.ingested?.orders ?? 0} hóa đơn nhưng bị cắt bớt (chạm trần). Hãy thu hẹp khoảng ngày rồi chạy lại.`,
        });
      } else {
        toast({
          semantic: "success",
          message: `Đã đồng bộ ${r.ingested?.orders ?? 0} hóa đơn (${r.fetched} fetched).`,
        });
      }
      void queryClient.invalidateQueries();
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Sync khoảng ngày lỗi.",
      });
    } finally {
      setIsRangeBusy(false);
    }
  }
```

- [ ] **Step 6: Render the window field**

In the JSX, inside the "Cơ bản" `<section>`, after the `is_active` Switch block (the closing `</div>` at line 281, before `</section>`):

```tsx
            <TextField
              label="Cửa sổ đồng bộ mặc định (số ngày gần nhất)"
              type="number"
              inputMode="numeric"
              min={1}
              max={31}
              step={1}
              value={String(syncWindowDays)}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSyncWindowDays(Number.isFinite(n) ? n : 0);
              }}
              disabled={isSaving}
              error={windowError}
              helper="Áp dụng cho nút Đồng bộ POS và lần tự tải khi dữ liệu cũ. Sync nền 2 phút/lần vẫn chỉ lấy ngày đang xem. Mặc định 1."
            />
```

- [ ] **Step 7: Render the range-backfill section**

In the JSX, after the "Webhook" `<section>` closes (`</section>` at line 355) and before the "Nâng cao" `<details>` (line 358), add a new section:

```tsx
          {/* ── Đồng bộ theo khoảng ngày (backfill) ── */}
          <section className="space-y-3 pt-2 border-t border-border">
            <h3 className="text-sm font-medium text-ink">Đồng bộ theo khoảng ngày</h3>
            <p className="text-xs text-muted">
              Kéo lại hóa đơn KiotViet cho một khoảng ngày cụ thể (vd: backfill dữ liệu cũ
              bị thiếu/lệch). Bỏ qua cooldown. Khoảng dài có thể chậm — nên chia nhỏ.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[140px]">
                <TextField
                  label="Từ ngày"
                  type="date"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  disabled={isRangeBusy}
                />
              </div>
              <div className="flex-1 min-w-[140px]">
                <TextField
                  label="Đến ngày"
                  type="date"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  disabled={isRangeBusy}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={handleRangeSync}
                loading={isRangeBusy}
                disabled={isRangeBusy || !rangeFrom || !rangeTo}
              >
                Đồng bộ khoảng này
              </Button>
            </div>
          </section>
```

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: compiles, no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/features/settings/kiotviet-config-form.tsx
git commit -m "feat(settings): KiotViet sync window field + date-range backfill"
```

---

### Task 8: Final verification + manual E2E

**Files:** none (verification only).

- [ ] **Step 1: Full unit + build gate**

Run: `npm run test:run`
Expected: all suites pass, including `sync-range.test.ts` (and the prior 154).

Run: `npm run build`
Expected: clean compile.

- [ ] **Step 2: Manual E2E (Chrome DevTools, owner@chill.local on local stack)**

Note: the local stack's KiotViet integration is **off** (no live creds), so an actual fetch returns `skipped`. This E2E verifies the UI, persistence, validation, and request shape — not a live KiotViet pull (that needs real creds on staging/prod).

1. Settings → "Kết nối KiotViet": set **Cửa sổ đồng bộ mặc định = 7**, click **Lưu thay đổi** → success toast. Reload → field still shows **7** (persisted).
2. Network: press dashboard **Đồng bộ POS** → inspect the `POST /api/kiotviet/sync` body → confirm `{ anchorDate: <businessDate>, applyWindow: true, ... }`.
3. Range backfill: enter `Từ ngày`/`Đến ngày` (e.g. 2026-05-01 → 2026-05-10), click **Đồng bộ khoảng này** → confirm `POST` body `{ fromDate:"2026-05-01", toDate:"2026-05-10", force:true, reason:"manual_range" }`; toast shows result (likely "skipped — kết nối tắt" locally). Enter a >31-day range → confirm the "có thể chậm" confirm() dialog appears.
4. Validation: set window field to 0 or 99 → Save shows "Phải là số nguyên 1–31".

- [ ] **Step 3: Confirm no regression in single-day default**

With **Cửa sổ = 1** (default), the dashboard sync request still resolves to a single day server-side (anchorDate = to = from). Verify via the same network inspection (request sends applyWindow:true but N=1 → single day).

---

## Self-Review

**Spec coverage:**
- `sync_window_days` setting (1–31, default 1) → Task 2. ✓
- Server-side window computation → Task 1 (helper) + Task 3 (runSync). ✓
- Window applies to manual + stale auto-load; background/resume single-day → Task 6. ✓
- One-off range backfill in KiotViet card → Task 5 (`triggerPosRangeSync`) + Task 7 (UI). ✓
- Truncation surfaced → Task 3 (`truncated` flag) + Task 7 (warning toast). ✓
- maxPages-by-mode (range=300) → Task 3. ✓
- >31-day warning + from≤to validation → Task 7. ✓
- No DB change → confirmed (setting in JSON blob; reuses `ingest_kiotviet_batch`). ✓
- Testing: Vitest for helper (Task 1) + build + manual E2E (Task 8). ✓

**Placeholder scan:** No TBD/TODO; all code steps contain full code; all commands have expected output. ✓

**Type consistency:** `computeSyncRange`/`SyncRange`/`ComputeSyncRangeInput` (Task 1) match usage in Task 3. `SyncOptions.{anchorDate,applyWindow}` (Task 3) match the route (Task 4) and `triggerPosSync` body (Task 5). `SyncVars` gains `applyWindow` in Task 6 across all three callers. `KvConfigDto.sync_window_days` (Task 2) matches form usage (Task 7). `triggerPosRangeSync` return shape (Task 5) matches `handleRangeSync` usage (Task 7). ✓

**Note on Task 5 build:** Task 5's build intentionally fails until Task 6 updates the callers (documented in Task 5 Step 2). Execute Tasks 5→6 back-to-back; the suite is green again after Task 6 Step 4.
