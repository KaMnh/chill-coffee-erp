# Báo cáo chốt két "theo ngày" đa ngày + nạp két mỗi ngày — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trong Báo cáo → tab "Chốt két", mục "Báo cáo theo ngày" hiển thị nhiều ngày (mặc định 7 ngày gần nhất, mới nhất trên đầu, chọn được khoảng khác), và mỗi dòng hiện "nạp két" của riêng ngày đó (Tiền mặt + Chuyển khoản).

**Architecture:** Thêm RPC `get_cash_close_reports_by_period(p_from, p_to)` (dual-write migration + 002_functions.sql) cùng shape với RPC theo-ngày để `ReportList` tái dùng. Frontend thêm data loader + TanStack hook theo khoảng, đổi `CashCloseTab` sang state khoảng ngày (mẫu `safe-view.tsx`), và `ReportList` hiển thị nạp két per-day qua một pure helper được unit-test. Logic chốt/sửa/hủy thêm invalidate prefix mới để tự refresh.

**Tech Stack:** Postgres/pgTAP, Supabase RPC (jsonb), Next.js App Router + React 19, TanStack Query v5, Radix UI, Vitest (node env, pure-function tests).

---

## ⚠️ Findings từ khảo sát code (lệch so với spec/prompt — đã chốt cách xử lý)

Đây là các điểm prompt/spec mô tả KHÔNG khớp code hiện tại. Plan đã điều chỉnh; nêu rõ để Codex review.

1. **Spec nằm ở branch khác.** File `docs/superpowers/specs/2026-06-24-cash-close-daily-reports-design.md` được tạo ở commit `572ad6d` trên branch `claude/interesting-hofstadter-ee189c`, KHÔNG có trong branch hiện tại `claude/epic-mccarthy-43d60c`. Đã copy bản đọc-tham-khảo vào worktree (untracked). Base để làm việc vẫn là branch hiện tại.

2. **[QUAN TRỌNG] Prefix invalidation prompt/spec nói SAI.** Prompt nói "mutation chốt/sửa/hủy đang invalidate theo prefix `cash-close-reports`". Thực tế `src/hooks/mutations/use-cash-mutations.ts` invalidate `queryKeys.reports(businessDate)` = `["reports", businessDate]` (key CỤ THỂ, không phải prefix trống `["reports"]`), và prefix là `reports` chứ không phải `cash-close-reports`. `useReportsQuery` dùng key `["reports", businessDate]`.
   - ⇒ Nếu hook mới dùng key `["cash-close-reports","period",from,to]` như prompt yêu cầu thì finalize/edit/void sẽ KHÔNG invalidate nó → vỡ tiêu chí "tự refresh".
   - **Xử lý:** Giữ đúng tên key prompt yêu cầu (`["cash-close-reports","period",from,to]`) NHƯNG bổ sung `queryClient.invalidateQueries({ queryKey: ["cash-close-reports"] })` vào 3 mutation finalize/edit/void (Task 6). Giữ nguyên invalidate `reports` cũ.

3. **`useReportsQuery` (1 ngày) sẽ thành dead code.** Consumer duy nhất là `reports-view.tsx`. Spec nói "giữ nếu nơi khác còn dùng" — không nơi nào khác dùng. **Xử lý:** Vẫn GIỮ (theo spec; vô hại, vẫn export) nhưng `CashCloseTab` chuyển sang hook khoảng.

4. **[QUAN TRỌNG] Không chạy được React-render test trong harness hiện tại.** `vitest.config.mts` dùng `environment: "node"`, `include: ["src/**/__tests__/**/*.test.ts"]` (chỉ `.test.ts`, KHÔNG `.tsx`), và `@testing-library/react` KHÔNG có trong `package.json`. File `backup-restore-section.test.tsx` hiện có là placeholder `@ts-nocheck` cho Phase 6.B, KHÔNG được include glob bắt.
   - **Xử lý:** Tách logic "nạp két per-day" thành **pure helper** `src/features/reports/deposit-summary.ts` (voided → 0) và unit-test bằng `.test.ts` (đúng mẫu `src/features/cash/__tests__/cash-math.test.ts`). `ReportList` tiêu thụ helper. Đây là cách thỏa yêu cầu "test logic dòng nạp két" mà CHẠY ĐƯỢC + xanh, không cần thêm jsdom/testing-library.

5. **Dual-write không có tool tự verify.** Là convention thủ công: ghi function block byte-identical vào CẢ `database/migrations/2026-06-24-*.sql` lẫn `database/002_functions.sql`. RPC theo-ngày hiện chỉ sống ở 002 (migration `2026-05-26-c` chỉ alter view). Grant: `003_rls.sql:57` có blanket `grant execute on all functions ... to authenticated` (chạy khi fresh init), nhưng prod cũ đã chạy 003 từ trước nên migration mới PHẢI tự kèm `grant execute`.

---

## File Structure

**Tạo mới:**
- `database/migrations/2026-06-24-cash-close-reports-by-period.sql` — migration thêm RPC (function block + grant).
- `database/tests/300_cash_close_reports_by_period.sql` — pgTAP cho RPC mới.
- `src/features/reports/deposit-summary.ts` — pure helper tính nạp két per-day (voided → 0).
- `src/features/reports/__tests__/deposit-summary.test.ts` — Vitest cho helper.

**Sửa:**
- `database/002_functions.sql` — thêm function block byte-identical (sau `get_cash_close_reports_by_date`, ~line 1152) + cập nhật comment cascade (~line 136).
- `src/lib/datetime.ts` — thêm `subtractDays` (UTC-safe) + test trong `src/lib/__tests__/datetime.test.ts` (fix Codex #2).
- `src/lib/data/reports.ts` — thêm `loadCashCloseReportsByPeriod`.
- `src/hooks/queries/keys.ts` — thêm factory `reportsByPeriod`.
- `src/hooks/queries/use-cash-queries.ts` — thêm `useReportsByPeriodQuery`.
- `src/hooks/queries/index.ts` — export hook mới.
- `src/hooks/mutations/use-cash-mutations.ts` — thêm invalidate `["cash-close-reports"]` ở finalize/edit/void.
- `src/features/reports/report-list.tsx` — đổi mỗi dòng: business_date + nạp két per-day.
- `src/features/reports/reports-view.tsx` — `CashCloseTab` thêm state khoảng + filter UI + auto-select + dùng hook khoảng.

**KHÔNG đụng:** `src/app/(preview)/mobile/.../reports-view.tsx`, `PrintableReport`, export JPEG, các tab khác.

---

## Tham chiếu pattern (đọc khi cần)

- RPC theo-ngày hiện có: `database/002_functions.sql:1142-1152` (`get_cash_close_reports_by_date`) + view `daily_cash_close_report_view` (`002_functions.sql:140-148`).
- RPC date-range mẫu (migration + grant): `database/migrations/2026-05-23-cash-flow-overview.sql`.
- Bảng: `cash_close_reports` (`database/001_schema.sql:345-372`), `cash_counts` (`database/001_schema.sql:296-318`), cột `safe_deposit_amount`/`leave_for_next_day` thêm ở `001_schema.sql:628-629`.
- pgTAP fixture/auth mẫu: `database/tests/040_finalize_cash_close_report.sql` (helper `pg_temp.act_as`, insert owner).
- Date-range state UI mẫu: `src/features/safe/safe-view.tsx:23-27,42-100` (`subtractDays`, state from/to, reset) + `src/features/safe/safe-history-section.tsx:179-211` (2 `TextField type=date` + nút Xóa lọc).
- Pure-helper test mẫu: `src/features/cash/__tests__/cash-math.test.ts`.
- `formatVND` (`src/lib/format.ts:5-7`), `formatDateTime` (`:46-53`), `todayInVN` (`src/lib/datetime.ts:43-45`).

---

## Task 1: pgTAP cho RPC mới (test trước — RED)

**Files:**
- Test: `database/tests/300_cash_close_reports_by_period.sql`

Fixture insert TRỰC TIẾP vào `cash_counts` + `cash_close_reports` với `closed_at` lệch nhau để tie-break xác định (KHÔNG dựa `created_at`; xem ghi chú dự án về created_at tie-break trong cùng transaction).

- [ ] **Step 1: Viết test file**

```sql
-- get_cash_close_reports_by_period RPC tests.
--
-- 10 assertions:
--   1. Đúng khoảng: loại ngày ngoài [from,to] (4/5 report trả về)
--   2. Sort business_date DESC: phần tử [0] = ngày mới nhất
--   3. Cùng ngày sort closed_at DESC: 03-02 final (closed muộn hơn) đứng trước voided
--   4. Cùng ngày: phần tử kế là voided (closed sớm hơn)
--   5. Phần tử cuối = ngày cũ nhất trong khoảng
--   6. Gồm cả voided (đúng 1 voided trong kết quả)
--   7. Ngày ngoài khoảng bị loại (không có business_date 2026-02-25)
--   8. Nạp két per-day đọc đúng safe_deposit_amount
--   9. Nạp két per-day đọc đúng bank_transfer_confirmed
--  10. Khoảng rỗng → '[]'::jsonb

BEGIN;
SELECT plan(10);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
END;
$$ LANGUAGE plpgsql;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES ('11111111-1111-1111-1111-111111111111', 'Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- cash_counts (1 per report; chỉ business_date là bắt buộc)
INSERT INTO public.cash_counts (id, business_date) VALUES
  ('aaaaaaa1-0000-0000-0000-000000000001', '2026-03-01'),
  ('aaaaaaa1-0000-0000-0000-000000000002', '2026-03-02'),
  ('aaaaaaa1-0000-0000-0000-000000000003', '2026-03-02'),
  ('aaaaaaa1-0000-0000-0000-000000000004', '2026-03-05'),
  ('aaaaaaa1-0000-0000-0000-000000000005', '2026-02-25');

-- cash_close_reports — closed_at LỆCH NHAU để tie-break xác định
INSERT INTO public.cash_close_reports
  (id, business_date, cash_count_id, closed_at, report_status, safe_deposit_amount, bank_transfer_confirmed, difference)
VALUES
  ('bbbbbbb1-0000-0000-0000-000000000001', '2026-03-01', 'aaaaaaa1-0000-0000-0000-000000000001', '2026-03-01 20:00:00+07', 'final',  100000, 50000, 0),
  ('bbbbbbb1-0000-0000-0000-000000000002', '2026-03-02', 'aaaaaaa1-0000-0000-0000-000000000002', '2026-03-02 21:00:00+07', 'voided', 0,      0,     0),
  ('bbbbbbb1-0000-0000-0000-000000000003', '2026-03-02', 'aaaaaaa1-0000-0000-0000-000000000003', '2026-03-02 22:00:00+07', 'final',  200000, 0,     0),
  ('bbbbbbb1-0000-0000-0000-000000000004', '2026-03-05', 'aaaaaaa1-0000-0000-0000-000000000004', '2026-03-05 20:00:00+07', 'final',  300000, 0,     0),
  ('bbbbbbb1-0000-0000-0000-000000000005', '2026-02-25', 'aaaaaaa1-0000-0000-0000-000000000005', '2026-02-25 20:00:00+07', 'final',  999999, 0,     0);

-- ACT
CREATE TEMP TABLE _res AS
SELECT public.get_cash_close_reports_by_period('2026-03-01', '2026-03-05') AS j;

CREATE TEMP TABLE _empty AS
SELECT public.get_cash_close_reports_by_period('2026-01-01', '2026-01-02') AS j;

-- 1: đúng khoảng → 4 phần tử (loại 2026-02-25)
SELECT is(
  (SELECT jsonb_array_length(j) FROM _res),
  4,
  'returns 4 reports inside [from,to], excludes out-of-range'
);

-- 2: business_date DESC → [0] = 2026-03-05
SELECT is(
  (SELECT j->0->>'business_date' FROM _res),
  '2026-03-05',
  'sorted business_date DESC: newest first'
);

-- 3: cùng 2026-03-02, closed_at DESC → final (22:00) đứng trước
SELECT is(
  (SELECT j->1->>'report_status' FROM _res),
  'final',
  'same business_date: later closed_at (final) comes first'
);

-- 4: kế tiếp là voided (21:00)
SELECT is(
  (SELECT j->2->>'report_status' FROM _res),
  'voided',
  'same business_date: earlier closed_at (voided) comes second'
);

-- 5: phần tử cuối = ngày cũ nhất trong khoảng
SELECT is(
  (SELECT j->3->>'business_date' FROM _res),
  '2026-03-01',
  'oldest in-range date is last'
);

-- 6: gồm cả voided — đúng 1 voided
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'report_status' = 'voided'),
  1,
  'voided reports are included'
);

-- 7: out-of-range bị loại
SELECT is(
  (SELECT count(*)::int FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'business_date' = '2026-02-25'),
  0,
  'out-of-range date excluded'
);

-- 8: nạp két per-day đọc đúng (report 2026-03-01)
SELECT is(
  (SELECT (e->>'safe_deposit_amount')::numeric
   FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'id' = 'bbbbbbb1-0000-0000-0000-000000000001'),
  100000::numeric,
  'safe_deposit_amount surfaced per report'
);
SELECT is(
  (SELECT (e->>'bank_transfer_confirmed')::numeric
   FROM jsonb_array_elements((SELECT j FROM _res)) e
   WHERE e->>'id' = 'bbbbbbb1-0000-0000-0000-000000000001'),
  50000::numeric,
  'bank_transfer_confirmed surfaced per report'
);

-- 9: khoảng rỗng → '[]'
SELECT is(
  (SELECT jsonb_array_length(j) FROM _empty),
  0,
  'empty range returns []'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Chạy test → xác nhận FAIL (function chưa tồn tại)**

Từ **repo root chính** (nơi stack supabase chạy):
```bash
npm run pgtap -- --file database/tests/300_cash_close_reports_by_period.sql
```
Fallback nếu `docker compose` không nhận project từ worktree (pipe trực tiếp file vào container `supabase-db`):
```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -AtX -f - < database/tests/300_cash_close_reports_by_period.sql
```
Expected: FAIL — `function public.get_cash_close_reports_by_period(date, date) does not exist`.

---

## Task 2: RPC `get_cash_close_reports_by_period` (dual-write) — GREEN

**Files:**
- Create: `database/migrations/2026-06-24-cash-close-reports-by-period.sql`
- Modify: `database/002_functions.sql` (thêm sau `get_cash_close_reports_by_date`, ~line 1152; cập nhật comment ~line 136)

⚠️ **Function block phải byte-identical ở cả 2 file.** Khối dưới đây là canonical — copy y nguyên.

- [ ] **Step 1: Tạo file migration**

```sql
-- =============================================================================
-- get_cash_close_reports_by_period RPC (2026-06-24)
--
-- Trả báo cáo chốt két (final + voided) có business_date trong [p_from, p_to].
-- Sort business_date DESC, cùng ngày closed_at DESC (ổn định, tránh tráo
-- final/voided). Cùng shape với get_cash_close_reports_by_date để ReportList
-- tái dùng. Auth: staff trở lên (bám get_cash_close_reports_by_date).
--
-- DUAL-WRITE: function block byte-identical với database/002_functions.sql.
-- Spec: docs/superpowers/specs/2026-06-24-cash-close-daily-reports-design.md
-- =============================================================================

create or replace function public.get_cash_close_reports_by_period(p_from date, p_to date)
returns jsonb
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.business_date desc, r.closed_at desc), '[]'::jsonb)
  from public.daily_cash_close_report_view r
  where r.business_date between p_from and p_to and (public.app_is_owner_manager() or public.app_role() = 'staff_operator');
$$;

grant execute on function public.get_cash_close_reports_by_period(date, date) to authenticated;
```

- [ ] **Step 2: Thêm cùng function block vào `database/002_functions.sql`**

Chèn NGAY SAU function `get_cash_close_reports_by_date` (sau dòng `$$;` ở ~line 1152, trước `create or replace function public.ingest_kiotviet_batch`). Dán đúng khối canonical từ Step 1 (cả `create or replace function ...` lẫn dòng `grant execute ...`).

- [ ] **Step 3: Cập nhật comment cascade (~line 136) cho chính xác**

Tìm:
```
-- drop cả get_cash_close_report + get_cash_close_reports_by_date (SQL funcs),
```
Đổi thành:
```
-- drop cả get_cash_close_report + get_cash_close_reports_by_date +
-- get_cash_close_reports_by_period (SQL funcs),
```

- [ ] **Step 4: Áp function vào DB local**

```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < database/migrations/2026-06-24-cash-close-reports-by-period.sql
docker exec -i supabase-db psql -U postgres -d postgres -c "notify pgrst, 'reload schema';"
```

- [ ] **Step 5: Chạy lại pgTAP → PASS**

```bash
npm run pgtap -- --file database/tests/300_cash_close_reports_by_period.sql
```
Expected: `10/10 passed`.

- [ ] **Step 6: Chạy TOÀN BỘ pgTAP (không regress)**

```bash
npm run pgtap
```
Expected: tất cả file pass.

- [ ] **Step 7: Commit**

```bash
git add database/migrations/2026-06-24-cash-close-reports-by-period.sql database/002_functions.sql database/tests/300_cash_close_reports_by_period.sql
git commit -m "feat(reports): get_cash_close_reports_by_period RPC + pgTAP"
```

---

## Task 3: Data loader `loadCashCloseReportsByPeriod`

**Files:**
- Modify: `src/lib/data/reports.ts` (thêm sau `loadCashCloseReportsByDate`, ~line 36)

Thin wrapper — đồng bộ pattern `loadCashCloseReportsByDate`. (Data layer cần live DB; không unit-test, khớp các loader hiện có không có test.)

- [ ] **Step 1: Thêm function**

```ts
export async function loadCashCloseReportsByPeriod(
  supabase: SupabaseClient,
  from: string,
  to: string
) {
  const { data, error } = await supabase.rpc("get_cash_close_reports_by_period", {
    p_from: from,
    p_to: to
  });
  if (error) throw toAppError(error, "Không tải được danh sách báo cáo.");
  return unwrapJson<CashCloseReport[]>(data, []);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

## Task 4: Query key factory + hook `useReportsByPeriodQuery`

**Files:**
- Modify: `src/hooks/queries/keys.ts` (thêm vào object `queryKeys`)
- Modify: `src/hooks/queries/use-cash-queries.ts`
- Modify: `src/hooks/queries/index.ts`

- [ ] **Step 1: Thêm key factory** vào `src/hooks/queries/keys.ts` (cạnh `reports`, sau dòng `reports: (businessDate: string) => ["reports", businessDate] as const,`)

```ts
  reportsByPeriod: (from: string, to: string) =>
    ["cash-close-reports", "period", from, to] as const,
```

- [ ] **Step 2: Thêm hook** vào `src/hooks/queries/use-cash-queries.ts`

Đổi import data layer (dòng 5) để thêm `loadCashCloseReportsByPeriod`:
```ts
import {
  loadCashCloseReportsByDate,
  loadCashCloseReportsByPeriod,
  loadCashCountsByDate,
  loadCashDayOpening
} from "@/lib/data";
```

Thêm hook (sau `useReportsQuery`, giữ `useReportsQuery` nguyên vẹn):
```ts
/**
 * Báo cáo chốt két theo KHOẢNG ngày (final + voided), business_date DESC.
 * Prefix "cash-close-reports" để finalize/edit/void invalidate tự refresh
 * (xem use-cash-mutations.ts). staleTime 60s như useReportsQuery.
 */
export function useReportsByPeriodQuery(
  supabase: SupabaseClient | null,
  from: string,
  to: string,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.reportsByPeriod(from, to),
    queryFn: () => loadCashCloseReportsByPeriod(supabase!, from, to),
    enabled: enabled && !!supabase,
    staleTime: 60_000
  });
}
```

- [ ] **Step 3: Export hook** trong `src/hooks/queries/index.ts` (dòng 8)

```ts
export { useCashCountsQuery, useCashOpeningQuery, useReportsQuery, useReportsByPeriodQuery } from "./use-cash-queries";
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

## Task 5: Mutation invalidate prefix mới (fix tự refresh)

**Files:**
- Modify: `src/hooks/mutations/use-cash-mutations.ts` (3 chỗ: finalize ~line 72, edit ~line 155, void ~line 179)

Thêm invalidate prefix `["cash-close-reports"]` (khớp mọi key `reportsByPeriod`). Giữ nguyên invalidate `queryKeys.reports(businessDate)` cũ.

- [ ] **Step 1: `useFinalizeCashClose`** — sau dòng `queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });` (line 72) thêm:

```ts
      queryClient.invalidateQueries({ queryKey: ["cash-close-reports"] });
```

- [ ] **Step 2: `useEditCashCloseReport`** — sau dòng `queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });` (line 155) thêm cùng dòng:

```ts
      queryClient.invalidateQueries({ queryKey: ["cash-close-reports"] });
```

- [ ] **Step 3: `useVoidCashCloseReport`** — sau dòng `queryClient.invalidateQueries({ queryKey: queryKeys.reports(businessDate) });` (line 179) thêm cùng dòng:

```ts
      queryClient.invalidateQueries({ queryKey: ["cash-close-reports"] });
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

---

## Task 6: Pure helper nạp két per-day + test (TDD)

**Files:**
- Create: `src/features/reports/deposit-summary.ts`
- Test: `src/features/reports/__tests__/deposit-summary.test.ts`

- [ ] **Step 1: Viết test (RED)** — `src/features/reports/__tests__/deposit-summary.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { depositForDay } from "../deposit-summary";
import type { CashCloseReport } from "@/lib/types";

function makeReport(overrides: Partial<CashCloseReport>): CashCloseReport {
  return {
    id: "r1",
    business_date: "2026-03-01",
    cash_count_id: "c1",
    closed_at: "2026-03-01T13:00:00.000Z",
    closed_by: null,
    opening_cash: 0,
    pos_cash_total: 0,
    expense_cash_total: 0,
    payroll_cash_total: 0,
    theory_cash: 0,
    physical_cash: 0,
    difference: 0,
    denominations_json: {},
    sync_snapshot_at: null,
    note: null,
    report_status: "final",
    safe_deposit_amount: 0,
    leave_for_next_day: 0,
    ...overrides
  };
}

describe("depositForDay", () => {
  it("final: trả cash = safe_deposit_amount, transfer = bank_transfer_confirmed", () => {
    const r = makeReport({
      report_status: "final",
      safe_deposit_amount: 900000,
      bank_transfer_confirmed: 250000
    });
    expect(depositForDay(r)).toEqual({ cash: 900000, transfer: 250000 });
  });

  it("voided: cả hai = 0 (khoản nạp đã bị đảo qua adjustment)", () => {
    const r = makeReport({
      report_status: "voided",
      safe_deposit_amount: 900000,
      bank_transfer_confirmed: 250000
    });
    expect(depositForDay(r)).toEqual({ cash: 0, transfer: 0 });
  });

  it("bank_transfer_confirmed thiếu → transfer = 0", () => {
    const r = makeReport({
      report_status: "final",
      safe_deposit_amount: 100000,
      bank_transfer_confirmed: undefined
    });
    expect(depositForDay(r)).toEqual({ cash: 100000, transfer: 0 });
  });
});
```

- [ ] **Step 2: Chạy test → FAIL** (module chưa tồn tại)

Run: `npx vitest run src/features/reports/__tests__/deposit-summary.test.ts`
Expected: FAIL — cannot find module `../deposit-summary`.

- [ ] **Step 3: Viết helper (GREEN)** — `src/features/reports/deposit-summary.ts`

```ts
import type { CashCloseReport } from "@/lib/types";

export interface DayDeposit {
  /** Tiền mặt nạp quỹ khi chốt (= safe_deposit_amount). */
  cash: number;
  /** Chuyển khoản nạp quỹ khi chốt (= bank_transfer_confirmed). */
  transfer: number;
}

/**
 * Nạp két của RIÊNG một ngày từ báo cáo chốt két.
 * voided → 0/0 vì khoản nạp đã bị đảo ngược qua adjustment (xem void RPC).
 */
export function depositForDay(report: CashCloseReport): DayDeposit {
  if (report.report_status === "voided") {
    return { cash: 0, transfer: 0 };
  }
  return {
    cash: report.safe_deposit_amount ?? 0,
    transfer: report.bank_transfer_confirmed ?? 0
  };
}
```

- [ ] **Step 4: Chạy test → PASS**

Run: `npx vitest run src/features/reports/__tests__/deposit-summary.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/deposit-summary.ts src/features/reports/__tests__/deposit-summary.test.ts
git commit -m "feat(reports): depositForDay helper + tests"
```

---

## Task 7: `ReportList` — mỗi dòng hiện business_date + nạp két per-day

**Files:**
- Modify: `src/features/reports/report-list.tsx`

Giữ tiêu đề "Báo cáo theo ngày". Dòng trên: business_date (đậm) + badge. Dòng giữa: "Nạp tiền mặt: X · CK xác nhận: Y" (voided → 0, gạch mờ). Dòng dưới: giữ "Chênh: ..." với tone.

> **[Codex finding #1 — user chốt: đổi nhãn]** Phần CK dùng nhãn "CK xác nhận" (KHÔNG gọi là "nạp quỹ") vì với báo cáo cũ (pre-2026-06-10) khoản CK chưa từng vào sổ quỹ transfer. Vẫn đọc field có sẵn (`bank_transfer_confirmed`), KHÔNG đổi backend (giữ scope spec §5).

- [ ] **Step 1: Thêm import helper + formatVND đã có**

Sửa import (dòng 6-8) thành:
```ts
import { formatVND } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { CashCloseReport } from "@/lib/types";
import { depositForDay } from "./deposit-summary";
```
(`formatDateTime` không còn cần ở đây — business_date hiển thị dạng ngày; xem Step 2.)

- [ ] **Step 2: Thêm helper format business_date (date-only, tránh tz pitfall)**

Thêm trước `export function ReportList`:
```ts
/** "2026-03-05" → "05/03/2026" (parse thủ công, không qua Date để tránh lệch tz). */
function formatBusinessDate(value: string): string {
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}
```

- [ ] **Step 3: Đổi nội dung mỗi `<button>`** (thay block `<div className="min-w-0">...</div>` hiện tại, dòng 64-71)

```tsx
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">
                        {formatBusinessDate(r.business_date)}
                      </span>
                      {(() => {
                        const { cash, transfer } = depositForDay(r);
                        const voided = r.report_status === "voided";
                        return (
                          <span
                            className={cn(
                              "block text-xs",
                              voided ? "text-muted line-through" : "text-ink-soft"
                            )}
                          >
                            Nạp tiền mặt: {formatVND(cash)} · CK xác nhận: {formatVND(transfer)}
                          </span>
                        );
                      })()}
                      <span className={cn("text-xs", differenceTone(r.difference))}>
                        Chênh: {formatVND(r.difference)}
                      </span>
                    </div>
```

> Lưu ý token màu: dùng `text-ink-soft` nếu design system có; nếu không, đổi sang `text-muted`. Kiểm tra `tailwind`/`globals.css` cho token hợp lệ trước khi chốt (Step 4).

- [ ] **Step 4: Verify typecheck + token màu**

Run: `npx tsc --noEmit`
Expected: no new errors.
Grep token: `rg "ink-soft|text-muted" src/app/globals.css src/components` — nếu `ink-soft` không tồn tại, thay bằng `text-muted` ở Step 3.

- [ ] **Step 5: Commit**

```bash
git add src/features/reports/report-list.tsx
git commit -m "feat(reports): ReportList hien nap ket per-day theo ngay"
```

---

## Task 8: Date helper (UTC-safe) + `CashCloseTab` state khoảng + filter

**Files:**
- Modify: `src/lib/datetime.ts` (thêm `subtractDays`)
- Test: `src/lib/__tests__/datetime.test.ts` (thêm describe block)
- Modify: `src/features/reports/reports-view.tsx`

⚠️ **[Codex finding #2] KHÔNG copy `subtractDays` từ `safe-view.tsx`** — bản đó `new Date("…T00:00:00")` parse theo LOCAL time rồi `toISOString()`; ở TZ Asia/Ho_Chi_Minh bị lệch −1 ngày (24−6 ra 2026-06-17 thay vì 18 → trả **8 ngày**, vi phạm tiêu chí 7 ngày). Đã verify bằng `node` với `TZ=Asia/Ho_Chi_Minh`. Dùng UTC-component math (đồng idiom `src/lib/kiotviet/sync-range.ts:41-45`).

### 8a. Helper có test (TDD)

- [ ] **Step 1: Thêm test (RED)** vào `src/lib/__tests__/datetime.test.ts` (gộp vào import sẵn có, đừng nhân đôi `import { describe, it, expect } from "vitest"`):

```ts
import { subtractDays } from "@/lib/datetime";

describe("subtractDays", () => {
  it("trừ ngày bằng UTC-component, không lệch tz (vitest chạy TZ=Asia/Ho_Chi_Minh)", () => {
    expect(subtractDays("2026-06-24", 6)).toBe("2026-06-18"); // 7 ngày inclusive
    expect(subtractDays("2026-06-24", 0)).toBe("2026-06-24");
  });
  it("vượt ranh giới tháng/năm", () => {
    expect(subtractDays("2026-03-02", 5)).toBe("2026-02-25");
    expect(subtractDays("2026-01-03", 5)).toBe("2025-12-29");
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/lib/__tests__/datetime.test.ts` → fail (`subtractDays` chưa export).

- [ ] **Step 3: Implement (GREEN)** — thêm vào cuối `src/lib/datetime.ts`:

```ts
/**
 * Trừ `days` khỏi một ngày 'YYYY-MM-DD', trả 'YYYY-MM-DD'.
 * UTC-component math để host timezone không làm lệch ngày lịch (bản
 * local-parse như safe-view.tsx bị off-by-1 ở VN). Mirror sync-range.ts.
 */
export function subtractDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86400 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run src/lib/__tests__/datetime.test.ts` → all pass.

### 8b. CashCloseTab — state khoảng + filter (LUÔN hiển thị) + guard `enabled`

Mặc định 7 ngày gần nhất (to=hôm nay, from=subtractDays(to,6)). Query CHỈ enable khi cả 2 ngày hợp lệ và from≤to (**[Codex finding #3]** tránh RPC lỗi khi xóa ô ngày / from>to). Filter LUÔN hiển thị kể cả khi loading/error/invalid — KHÔNG early-return giấu filter. Auto-chọn báo cáo mới nhất khi đổi khoảng.

- [ ] **Step 5: Đổi imports** trong `src/features/reports/reports-view.tsx`

Dòng 5 `useReportsQuery` → `useReportsByPeriodQuery`:
```ts
import { useReportsByPeriodQuery } from "@/hooks/queries";
```
Thêm:
```ts
import { TextField } from "@/components/ui/text-field";
import { todayInVN, subtractDays } from "@/lib/datetime";
```
(Giữ `Spinner`, `AlertBanner`, `Button`, `Card*`, `EmptyState`, `Icon`, v.v.)

- [ ] **Step 6: Thay thân đầu `CashCloseTab`** (state + guard + query)

Thay:
```ts
  const supabase = useSupabase();
  const reportsQuery = useReportsQuery(supabase, businessDate, true);
  const { toast } = useToast();
```
bằng:
```ts
  const supabase = useSupabase();
  const today = businessDate || todayInVN();
  const [fromDate, setFromDate] = useState(() => subtractDays(today, 6));
  const [toDate, setToDate] = useState(today);
  const rangeValid = !!fromDate && !!toDate && fromDate <= toDate;
  const reportsQuery = useReportsByPeriodQuery(supabase, fromDate, toDate, rangeValid);
  const { toast } = useToast();
```

- [ ] **Step 7: Sửa auto-select** — đổi `useEffect` (dòng 92-94):

```ts
  useEffect(() => {
    const list = reportsQuery.data ?? [];
    setSelected((current) => {
      if (current && list.some((r) => r.id === current.id)) return current;
      return list[0] ?? null;
    });
  }, [reportsQuery.data]);
```

- [ ] **Step 8: Thêm handler reset:**

```ts
  function handleResetRange() {
    setFromDate(subtractDays(today, 6));
    setToDate(today);
  }
```

- [ ] **Step 9: BỎ early-return ở đầu render** — xóa 2 block `if (reportsQuery.isLoading) { return …Spinner… }` và `if (reportsQuery.isError) { return …AlertBanner… }` (dòng ~128-144). Loading/error/empty sẽ render TRONG cột trái ở Step 10. GIỮ lại `const reports = reportsQuery.data ?? [];`.

- [ ] **Step 10: Render — filter LUÔN hiển thị + body theo state.** Thay đối số `<ReportList .../>` (cột trái của grid) bằng:

```tsx
      <div className="space-y-3">
        <Card>
          <CardBody className="flex flex-wrap items-end gap-3">
            <TextField
              label="Từ ngày"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="min-w-[9rem]"
            />
            <TextField
              label="Đến ngày"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="min-w-[9rem]"
            />
            <Button variant="ghost" onClick={handleResetRange}>
              7 ngày gần nhất
            </Button>
          </CardBody>
        </Card>

        {!rangeValid ? (
          <AlertBanner variant="warning" title="Khoảng ngày không hợp lệ">
            Chọn cả “Từ ngày” và “Đến ngày”, với Từ ≤ Đến.
          </AlertBanner>
        ) : reportsQuery.isLoading ? (
          <div className="flex justify-center py-12"><Spinner size={32} /></div>
        ) : reportsQuery.isError ? (
          <AlertBanner variant="danger" title="Không tải được danh sách báo cáo">
            {reportsQuery.error instanceof Error
              ? reportsQuery.error.message
              : String(reportsQuery.error)}
          </AlertBanner>
        ) : (
          <ReportList
            reports={reports}
            selectedId={selected?.id ?? null}
            onSelect={handleSelect}
          />
        )}
      </div>
```

> `CardBody`, `Spinner`, `AlertBanner`, `Button`, `Card` đã import sẵn; `TextField` thêm ở Step 5.

- [ ] **Step 11: Verify typecheck** — `npx tsc --noEmit` → no new errors. (`useReportsQuery` không còn import ở reports-view — đảm bảo đã đổi ở Step 5.)

- [ ] **Step 12: Commit**

```bash
git add src/lib/datetime.ts src/lib/__tests__/datetime.test.ts src/features/reports/reports-view.tsx src/lib/data/reports.ts src/hooks/queries/keys.ts src/hooks/queries/use-cash-queries.ts src/hooks/queries/index.ts src/hooks/mutations/use-cash-mutations.ts
git commit -m "feat(reports): chot ket xem nhieu ngay + loc khoang (UTC-safe, guard date range)"
```

---

## Task 9: Verification toàn diện (trước khi báo hoàn thành)

- [ ] **Step 1: Typecheck** — `npx tsc --noEmit` → no errors.
- [ ] **Step 2: Vitest** — `npm run test:run` → all pass (gồm `deposit-summary.test.ts`).
- [ ] **Step 3: pgTAP toàn bộ** — `npm run pgtap` → all pass.
- [ ] **Step 4: Lint (nếu repo có)** — `npx next lint` (nếu cấu hình) → no new errors.
- [ ] **Step 5: Smoke thủ công** (dev server 3009 ĐANG chạy ở repo chính — KHÔNG `npm run build`):
  - Vào Báo cáo → tab Chốt két: thấy ≥1 ngày (mặc định 7 ngày gần nhất), mới nhất trên đầu.
  - Mỗi dòng: business_date đậm + "Nạp tiền mặt … · CK xác nhận …"; dòng voided gạch mờ 0.
  - Đổi từ/đến → list đổi, auto-chọn dòng mới nhất; nút "7 ngày gần nhất" reset.
  - Bấm dòng → phiếu hiện bên phải, nút In/Tải ảnh hoạt động.
  - Chốt/sửa/hủy 1 báo cáo trong khoảng → list tự refresh (nhờ invalidate prefix mới).
- [ ] **Step 6: Báo cáo kết quả** kèm output các lệnh verify (evidence trước khi tuyên bố xong).

---

## Self-Review (checklist tác giả)

**Spec coverage:**
- §3.1 RPC by_period + dual-write + grant + loader → Task 1,2,3 ✅
- §3.2 hook + query key + invalidation prefix → Task 4,5 ✅ (đã sửa finding #2)
- §3.3 state khoảng + filter + reset + auto-select → Task 8 ✅
- §3.4 ReportList per-day deposit + voided→0 + giữ chênh lệch + bấm xem phiếu → Task 7 ✅
- §4 pgTAP (khoảng/DESC/voided/tie-break) + test logic nạp két → Task 1, Task 6 ✅
- §5 không đụng mobile/PrintableReport/backend write → tôn trọng ✅
- §6 tiêu chí hoàn thành → Task 9 smoke + verify ✅

**Type consistency:** `depositForDay` trả `DayDeposit {cash,transfer}` dùng nhất quán ở Task 6/7. RPC param `p_from`/`p_to`, loader `from`/`to`, hook `from`/`to`, key `reportsByPeriod(from,to)` đồng bộ. Function name `get_cash_close_reports_by_period` đồng bộ giữa migration/002/loader/test.

**Placeholder scan:** không có TBD/“add error handling” chung chung — mọi step có code thật.

**Rủi ro đã xử lý (findings khảo sát của tác giả):** invalidation prefix, test infra → pure helper, tie-break (closed_at lệch trong pgTAP), tz business_date (format thủ công), token màu (verify trước).

---

## Codex Adversarial Review log (2026-06-24)

Verdict: **needs-attention** → đã xử lý 3/4, 1 chờ user quyết.

| Codex # | Mức | Trạng thái | Xử lý |
|---|---|---|---|
| 2 — `subtractDays` ra 8 ngày ở TZ VN | medium | ✅ Fixed | Task 8 8a: helper UTC-safe trong `datetime.ts` + test (đã verify off-by-one bằng `node TZ=Asia/Ho_Chi_Minh`) |
| 3 — ngày rỗng/đảo chiều làm tab kẹt | medium | ✅ Fixed | Task 8 Step 6+9+10: guard `rangeValid` cho `enabled`, bỏ early-return, filter luôn hiển thị + AlertBanner trong cột |
| 4 — `plan(9)` nhưng 10 assertion | medium | ✅ Fixed | Task 1: đổi `plan(10)`, expected `10/10` |
| 1 — CK lịch sử (pre-2026-06-10) hiện như đã nạp quỹ | high | ✅ Resolved (user chốt: đổi nhãn) | Verify DB local: 16/16 report đều tháng 5 (pre-two-funds), 14 có `bank_transfer_confirmed>0`, ledger **0** giao dịch `transfer\|deposit_close`. **Quyết định:** đổi nhãn → "Nạp tiền mặt: X · CK xác nhận: Y" (Task 7). Vẫn đọc field có sẵn, KHÔNG đổi backend → giữ scope spec §5. |

> Lưu ý smoke (Task 9 Step 5): dữ liệu local toàn tháng 5 nên khoảng mặc định "7 ngày gần nhất" (quanh 2026-06-24) sẽ RỖNG — test bằng cách chọn khoảng 2026-05-10 → 2026-05-31.
