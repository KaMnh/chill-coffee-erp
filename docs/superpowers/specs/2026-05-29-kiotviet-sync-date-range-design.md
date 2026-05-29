# KiotViet sync — configurable date range

**Date:** 2026-05-29
**Status:** Approved (brainstorm) → ready for implementation plan
**Branch base:** `main` (after v4.1.19)

## Problem

The KiotViet sync only ever pulls **one day** — the business date selected in the
dashboard date picker (defaults to VN today), `fromDate = toDate = businessDate`.
There is no way to:

1. **Backfill a custom past range** (e.g. re-pull May 1–10 after the API drifted
   dates — complements the manual Excel import shipped in v4.1.19), or
2. **Widen routine sync** so invoices edited/arriving late (e.g. an invoice changed
   yesterday) get re-pulled, instead of only "today".

The backend route `/api/kiotviet/sync` already accepts `{ fromDate, toDate }`; the
gap is UI + a persistent default-window setting + the client never sending a range.

## Current behavior (as-found)

- `triggerPosSync` ([src/lib/data/pos-sync.ts](../../../src/lib/data/pos-sync.ts)) sends
  `fromDate = toDate = businessDate`.
- `runSync` ([src/lib/kiotviet/sync.ts](../../../src/lib/kiotviet/sync.ts)) defaults
  `fromDate = todayIso()`, `toDate = fromDate`; pages KV `/invoices?fromPurchaseDate&toPurchaseDate`
  with `pageSize=100`, `maxPages=50` (→ 5000-invoice cap), **breaks silently** at the cap.
- Four triggers all sync a single day via the shared `usePosSync` mutation:
  manual "Đồng bộ POS" button, stale auto-load (>30 min), 2-min background interval,
  tab-visibility resume.

## Decisions (confirmed with user)

1. **Both** a one-off range backfill *and* a persistent default window.
2. **All controls live in Settings → "Kết nối KiotViet" card** (owner/manager).
3. The default window applies to **manual sync + stale auto-load only**. The 2-min
   background interval and tab-resume stay single-day (avoid frequent heavy API calls).
4. Default window = **1** (no behavior change until the user sets it). Bounds **1–31**.

## Design

### Data model

Add `sync_window_days: number` to `KvCredentials`
([src/lib/kiotviet/types.ts](../../../src/lib/kiotviet/types.ts)), default `1` in
`DEFAULT_KV_CREDENTIALS`. Stored in the existing `app_settings` row
`key='kiotviet_credentials'` (is_public=false, owner-only). **No DB schema change** —
`loadKvCredentials` merges DEFAULT over stored, so old rows read back as `1`.

### Range computation — pure helper (testable)

New pure module `src/lib/kiotviet/sync-range.ts` (no I/O imports, Vitest-friendly):

```ts
export function computeSyncRange(input: {
  fromDate?: string; toDate?: string;     // explicit range (backfill)
  anchorDate?: string; applyWindow?: boolean; windowDays?: number;
  today: string;                          // injected (tz-resolved by caller)
}): { from: string; to: string; mode: "range" | "window" | "single" }
```

Rules:
- `fromDate && toDate` present → `mode:"range"`, pass through.
- else: `anchor = anchorDate ?? today`; `N = applyWindow ? clamp(windowDays,1,31) : 1`;
  `from = anchor − (N−1) days`, `to = anchor`. `mode = N>1 ? "window" : "single"`.

Date math is naive `YYYY-MM-DD` arithmetic (no Date tz pitfalls), mirroring
`excel-import.ts`'s approach.

### Trigger → request → computed range

| Trigger | Client sends | Server computes |
|---|---|---|
| Manual "Đồng bộ POS" | `{anchorDate, applyWindow:true}` | `from=anchor−(N−1)`, `to=anchor` |
| Stale auto-load (>30m) | `{anchorDate, applyWindow:true}` | windowed (same) |
| Background 2-min / resume | `{anchorDate, applyWindow:false}` | `from=to=anchor` |
| Range backfill (Settings) | `{fromDate, toDate}` | pass-through |

### Server

- `runSync` already loads `creds`, so it owns the window: accept options
  `{ fromDate?, toDate?, anchorDate?, applyWindow?, pageSize?, maxPages? }`, call
  `computeSyncRange({ ...opts, windowDays: creds.sync_window_days, today: todayIso() })`,
  use the returned `{from,to}`.
- **Truncation surfaced:** after the page loop, `truncated = pagesScanned >= maxPages
  && allInvoices.length < total`; add `truncated: boolean` to `SyncResult`.
- **maxPages by mode:** range backfill uses a higher cap (300 → 30k invoices) since
  it's deliberate; windowed/single keeps 50.
- `/api/kiotviet/sync` route: parse new optional body fields `anchorDate`,
  `applyWindow`; forward to `runSync`; return `truncated` in the JSON.

### Client

- `triggerPosSync(supabase, { businessDate, applyWindow, force, reason })` → POST
  `{ anchorDate: businessDate, applyWindow, force, reason }` (no longer fromDate/toDate).
- New `triggerPosRangeSync(supabase, { fromDate, toDate, reason })` → POST
  `{ fromDate, toDate, force:true, reason:"manual_range" }`, returns
  `{ status, message, fetched, ingested, truncated }`.
- `usePosSync` `SyncVars` gains `applyWindow: boolean`. Callers:
  manual button + stale auto-load → `applyWindow:true`; background interval + resume
  (in `use-background-pos-sync.ts`) → `applyWindow:false`.

### UI — inside "Kết nối KiotViet" card

[src/features/settings/kiotviet-config-form.tsx](../../../src/features/settings/kiotviet-config-form.tsx):

1. **Default window field** — number input "Cửa sổ đồng bộ mặc định (số ngày gần nhất)"
   (1–31), part of `applyConfig` + the Save `patch`. Helper: *"Áp dụng cho nút Đồng bộ
   POS và lần tự tải khi dữ liệu cũ; sync nền 2 phút/lần vẫn chỉ lấy ngày đang xem."*
2. **Range backfill sub-section** (separated by a border, same card): `Từ ngày` /
   `Đến ngày` (date inputs) + `type="button"` **"Đồng bộ khoảng này"** → `triggerPosRangeSync`
   → success/skip toast with `fetched`/`ingested`; **warns when `truncated`** (*"chỉ lấy
   X/total — thu hẹp khoảng ngày"*); warns when range > 31 days (*"khoảng dài có thể chậm
   — nên chia nhỏ"*). After success, `useQueryClient().invalidateQueries()` to refresh
   dashboard.

DTO/route plumbing: add `sync_window_days?: number` to `KvConfigDto`
([src/lib/data/kiotviet-config.ts](../../../src/lib/data/kiotviet-config.ts)); whitelist
it in the config route POST (`Number.isInteger`, 1–31). `maskCredentials` already spreads
`...creds`, so GET returns it.

### Edge cases & constraints

- **Validation:** `fromDate ≤ toDate`, valid `YYYY-MM-DD`; backfill uses `force:true`
  (bypass 30s cooldown). Per-user rate limit (6/min, owner 12) unchanged.
- **Timeout:** `maxDuration=60s`. UI warns on >31-day ranges; no auto-chunking (YAGNI).
- **Roles:** window field + backfill are in the owner/manager card. The windowed dashboard
  button benefits any sync-capable role (server reads the configured N regardless of clicker).

## Files

**New:** `src/lib/kiotviet/sync-range.ts`, `src/lib/kiotviet/__tests__/sync-range.test.ts`.
**Changed:** `types.ts` (+field/default), `sync.ts` (window via helper, truncation,
maxPages-by-mode), `api/kiotviet/sync/route.ts` (parse anchorDate/applyWindow, return
truncated), `lib/data/pos-sync.ts` (new request shape + `triggerPosRangeSync`),
`api/kiotviet/config/route.ts` (whitelist), `lib/data/kiotviet-config.ts` (DTO),
`hooks/use-pos-sync.ts` (`applyWindow` in vars; manual+stale = true), `hooks/use-background-pos-sync.ts`
(pass `applyWindow:false`), `app/page.tsx` (manual handler passes `applyWindow:true`),
`features/settings/kiotviet-config-form.tsx` (window field + backfill section).

## Testing

- **Vitest** `sync-range.test.ts`: N=1 → single day; N=7 → anchor−6…anchor; range
  pass-through; clamp (<1, >31); `applyWindow:false` → single day even if N=7.
- **Manual/E2E:** set window=7 → "Đồng bộ POS" pulls 7 days; range backfill May 1–10
  ingests; truncation warning path (small maxPages or large range).
- **No pgTAP** — reuses `ingest_kiotviet_batch`; no schema/RPC change.
- Gate before ship: `npm run build` + `npm run test:run`.

## Risks / notes

- Changing `triggerPosSync`'s request shape touches all four sync triggers — must update
  every caller's `applyWindow` in lockstep (background = false is the easy-to-miss one).
- KiotViet API rate (`rate_limit_per_sec`, default 4) bounds how fast a big backfill pages;
  large ranges are slow by nature — the >31-day warning sets expectations.
