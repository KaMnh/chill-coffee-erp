# Sổ quỹ 2 quỹ (tiền mặt + chuyển khoản) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Thực thi **phân pha**, verify hết pha mới sang pha kế.

**Goal:** Tách sổ quỹ thành 2 quỹ chạy số dư riêng (cash + transfer) + tổng quỹ; chốt két route CK vào quỹ CK (đếm két tiền mặt không lệch); chi (rút/nhập) tách quỹ; gộp F4 (rút chỉnh ngày).

**Architecture:** Thêm cột `safe_transactions.fund`. Số dư mỗi quỹ = `balance_after` của row **ghi gần nhất** (`created_at desc, id desc`) của quỹ đó (đổi từ `occurred_at` — invariant F4, áp per-fund). RPC ghi-sổ thêm `pg_advisory_xact_lock` per-fund để chống race. Frontend hiển thị 3 số.

**Tech Stack:** Postgres 15 (Supabase self-hosted), plpgsql SECURITY DEFINER RPC, pgTAP; Next.js 15 + TanStack Query; Vitest. Dual-write DB: sửa canonical `database/001_schema.sql`/`002_functions.sql` **và** thêm `database/migrations/2026-06-10-*.sql` (db-init áp base 001..005 → migrations/*.sql alphabetical).

## Quyết định & Reconciliation (chốt 2026-06-10)
- **KHÔNG** làm chuyển nội bộ cash↔CK đợt này (YAGNI; workaround = Điều chỉnh per-fund). Thêm sau khi có nền.
- Line-number origin/main (đã re-verify): `safe_balance_now` [:1904], `safe_setup_initial` [:1921], `safe_withdraw_other` [:1955], `safe_adjust` [:2012], `safe_count` [:2062], `void_cash_close_report` [:897], `edit_cash_close_report` [:970], `save_cash_day_opening` **double-def** → bản hiệu lực [:2258], `finalize_cash_close_report` **1 bản hiệu lực 3-arg** [:2417] (bản 1-arg đã drop [:2411] — KHÔNG còn double-def trap).
- Codex findings đã gộp: void per-fund (không dùng scalar `safe_deposit_amount`), `save_cash_day_opening`→`fund='cash'`, clear void-metadata khi re-finalize, index có `id desc`, integer VND, skip row amount=0, `max(0,transferBal)` trong split helper, advisory lock per-fund.
- F1 (nhập nguyên liệu) là spec #4 **riêng** — KHÔNG trong branch này.

## File Structure
| Tầng | File | Pha |
|------|------|-----|
| Migration | `database/migrations/2026-06-10-safe-two-funds-foundation.sql` (P1), `...-inflow.sql` (P2), `...-outflow-f4.sql` (P3) | mỗi pha |
| Schema canonical | `database/001_schema.sql` (cột `fund` + index) | P1 |
| RPC canonical | `database/002_functions.sql` | P1–P3 |
| RLS | `database/003_rls.sql` (grant chữ ký mới) | P2–P3 |
| Type | `src/lib/types.ts` (`SafeTransaction.fund`, `SafeBalances`) | P1 |
| Data | `src/lib/data/safe.ts` | P1–P3 |
| Query | `src/hooks/queries/use-safe-queries.ts`, `keys.ts` | P1 |
| Mutation | `src/hooks/mutations/use-safe-mutations.ts` | P2–P3 |
| Helper | `src/features/safe/fund-split.ts` (+ Vitest) | P3 |
| UI | `safe-balance-card` (P1), `safe-view`/`safe-history-section`/`safe-transaction-detail-modal` (P1 badge), `setup-safe-modal` (P2), `withdraw-safe-modal`/`adjust-safe-modal`/`count-safe-modal` (P3) | |
| pgTAP | `database/tests/07x/08x_*` + mới | mỗi pha |

---

## PHASE 1 — Nền (foundation)

**Mục tiêu:** cột `fund` + helper số dư per-fund (basis `created_at`) + `safe_balances_now()` + type + query + card 3 số. Mọi giao dịch cũ = cash, transfer = 0. KHÔNG đổi writer (finalize/withdraw/...) ở pha này — chúng vẫn dùng `safe_balance_now()` cũ; vì transfer=0 nên nhất quán.

### Task 1.1 — Migration + canonical: cột `fund` + index

**Files:** Create `database/migrations/2026-06-10-safe-two-funds-foundation.sql`; Modify `database/001_schema.sql` (`safe_transactions` create table + index block)

- [ ] **Step 1:** Viết migration:
```sql
-- 2026-06-10-safe-two-funds-foundation.sql
-- Sổ quỹ 2 quỹ — nền: cột fund + index + helper số dư per-fund.
alter table public.safe_transactions
  add column if not exists fund text not null default 'cash';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'safe_transactions_fund_check') then
    alter table public.safe_transactions
      add constraint safe_transactions_fund_check check (fund in ('cash','transfer'));
  end if;
end $$;
create index if not exists safe_transactions_fund_created_idx
  on public.safe_transactions (fund, created_at desc, id desc) include (balance_after);
```
- [ ] **Step 2:** Mirror canonical vào `001_schema.sql`: thêm `fund text not null default 'cash' check (fund in ('cash','transfer'))` vào create table `safe_transactions` (sau `transaction_type` block) + thêm index cạnh các index safe hiện có.
- [ ] **Step 3:** Apply lên local DB (clean check ở Task verify). Commit.

### Task 1.2 — RPC: `safe_fund_balance_now` + `safe_balances_now` (TDD pgTAP)

**Files:** Append migration (cùng file 1.1) + `database/002_functions.sql`; Test `database/tests/075_safe_fund_balances.sql`

- [ ] **Step 1 (RED):** Viết pgTAP `075_safe_fund_balances.sql` (mirror harness `070_rls_safe_tables.sql`: `BEGIN; select plan(N); ... select * from finish(); ROLLBACK;`, helper JWT `pg_temp.act_as`):
  - seed: `act_as(owner)`; insert 2 row cash (balance_after 100k, rồi 150k) + 1 row transfer (balance_after 80k) với `created_at` tăng dần.
  - `is(public.safe_fund_balance_now('cash'), 150000)`, `is(public.safe_fund_balance_now('transfer'), 80000)`.
  - `is((public.safe_balances_now()->>'total')::numeric, 230000)`.
  - tie-break: 2 row cash cùng `created_at`, id khác → lấy id lớn hơn.
- [ ] **Step 2:** Run → FAIL (function chưa tồn tại).
- [ ] **Step 3 (GREEN):** Thêm vào migration + `002_functions.sql`:
```sql
create or replace function public.safe_fund_balance_now(p_fund text)
returns numeric language sql stable security definer set search_path = public, auth as $$
  select coalesce((select balance_after from public.safe_transactions
    where fund = p_fund order by created_at desc, id desc limit 1), 0);
$$;
grant execute on function public.safe_fund_balance_now(text) to authenticated;

create or replace function public.safe_balances_now()
returns jsonb language sql stable security definer set search_path = public, auth as $$
  select jsonb_build_object(
    'cash', public.safe_fund_balance_now('cash'),
    'transfer', public.safe_fund_balance_now('transfer'),
    'total', public.safe_fund_balance_now('cash') + public.safe_fund_balance_now('transfer'));
$$;
grant execute on function public.safe_balances_now() to authenticated;
```
- [ ] **Step 4:** Run pgTAP → PASS. Commit.

> Note advisory-lock: primitive serialization per-fund sẽ áp ở **writer** P2/P3 (`perform pg_advisory_xact_lock(hashtext('safe_fund:'||p_fund))` trước read-then-write). Helper đọc (stable) không cần lock.

### Task 1.3 — Type + data + query

**Files:** Modify `src/lib/types.ts`, `src/lib/data/safe.ts`, `src/hooks/queries/use-safe-queries.ts`

- [ ] **Step 1:** `types.ts` — thêm `fund: "cash" | "transfer"` vào `SafeTransaction` (sau `transaction_type`); thêm `export type SafeBalances = { cash: number; transfer: number; total: number };`.
- [ ] **Step 2:** `data/safe.ts` — thêm:
```ts
export async function loadSafeBalances(supabase: SupabaseClient): Promise<SafeBalances> {
  const { data, error } = await supabase.rpc("safe_balances_now");
  if (error) throw toAppError(error, "Không tải được số dư sổ quỹ.");
  const o = (data ?? {}) as Partial<SafeBalances>;
  return { cash: Number(o.cash ?? 0), transfer: Number(o.transfer ?? 0), total: Number(o.total ?? 0) };
}
```
(giữ `loadSafeBalance` cho consumer khác nếu còn dùng — kiểm tra grep; nếu chỉ query hook dùng thì thay luôn).
- [ ] **Step 3:** `use-safe-queries.ts` — `useSafeBalanceQuery` đổi `queryFn: () => loadSafeBalances(supabase!)`; import `loadSafeBalances`. Kiểu trả về giờ là `SafeBalances`.
- [ ] **Step 4:** `npx tsc --noEmit` → sẽ báo lỗi ở consumer dùng `.data` như number (count-safe-modal, opening-cash-modal, use-safe-mutations, safe-view). Sửa từng nơi: dùng `.data?.total` (hoặc `.cash` tuỳ ngữ nghĩa — opening rút từ cash → `.cash`; nhưng P1 transfer=0 nên `.total` an toàn, tinh chỉnh ở P2/P3). Ghi chú rõ chỗ nào cần `.cash` ở P3.
- [ ] **Step 5:** `tsc` sạch. Commit.

### Task 1.4 — UI: SafeBalanceCard 3 số + badge quỹ

**Files:** Modify `src/features/safe/safe-balance-card.tsx`, `src/features/safe/safe-view.tsx`; (badge) `safe-history-section.tsx` + `safe-transaction-detail-modal.tsx`

- [ ] **Step 1:** `SafeBalanceCard` — props `{ cash, transfer, total, txnCount, isLoading, onSetup, onWithdraw, onAdjust, onCount }`. `isFirstTime = txnCount === 0 && total === 0`. Hiển thị 3 số: **Tổng quỹ** (lớn, `total`) + 2 dòng phụ Quỹ tiền mặt (`cash`) · Quỹ chuyển khoản (`transfer`). Giữ 3 nút action.
- [ ] **Step 2:** `safe-view.tsx` — `const balances = balanceQuery.data; <SafeBalanceCard cash={balances?.cash ?? 0} transfer={balances?.transfer ?? 0} total={balances?.total ?? 0} .../>`.
- [ ] **Step 3:** Badge quỹ ở `safe-history-section` + `safe-transaction-detail-modal`: hiển thị `tx.fund === 'transfer' ? 'Chuyển khoản' : 'Tiền mặt'` (mọi row cũ = Tiền mặt).
- [ ] **Step 4:** `tsc` sạch.

### Phase 1 — Verify gate
- [ ] `npx tsc --noEmit` sạch · `npm run test:run` xanh (không regression).
- [ ] Clean-DB pgTAP: tạo DB throwaway, apply base + migrations (gồm migration P1), run `database/tests/` → xanh.
- [ ] Manual: card hiện 3 số (transfer = 0); lịch sử badge "Tiền mặt"; setup/đếm/rút cũ vẫn chạy (transfer=0 nên total=cash).
- [ ] Commit pha. ⚠️ KHÔNG `npm run build` khi `next dev` (3009) chạy.

---

## PHASE 2 — Nguồn vào CK (finalize / void / edit / setup / opening)

**Mục tiêu:** CK vào quỹ CK khi chốt két; void hoàn cả 2 quỹ; setup nhập 2 số dư; `save_cash_day_opening` chỉ rút quỹ cash. Đây là pha "writer" đầu tiên → bắt đầu áp advisory-lock per-fund.

### Task 2.1 — `finalize_cash_close_report` tách deposit ([:2417], bản hiệu lực)
- [ ] **RED pgTAP:** chốt két có `bank_transfer_confirmed > 0` → tạo **2** row deposit (`fund='cash'` amount=safe_deposit, `fund='transfer'` amount=bank_transfer); `safe_fund_balance_now('cash')` += safe_deposit, `('transfer')` += bank_transfer. CK=0 → chỉ 1 row cash. Chỉ insert row khi amount>0 (codex #7).
- [ ] **GREEN:** trong body [:2417], chỗ insert `deposit_close`: đọc cash balance + transfer balance per-fund (advisory lock mỗi fund), insert 1–2 row với `fund` + `balance_after` per-fund. Lấy `v_bank_transfer := v_count.bank_transfer_confirmed`.
- [ ] Verify finalize idempotent + re-finalize (xem 2.3).

### Task 2.2 — `void_cash_close_report` hoàn **per-fund** ([:897] — codex #1)
- [ ] **RED:** void báo cáo có 2 deposit → 2 row `adjustment` ngược (cash + transfer), mỗi quỹ về số dư trước deposit; KHÔNG dùng scalar `safe_deposit_amount`.
- [ ] **GREEN:** thay logic [:968–998]: query `safe_transactions where cash_close_report_id = p_report_id and transaction_type='deposit_close'`, group theo `fund`; mỗi fund insert 1 `adjustment` `-amount` với `balance_after = safe_fund_balance_now(fund) - amount` (advisory lock). Validate đủ số dư mỗi quỹ trước khi reverse.

### Task 2.3 — Clear void-metadata khi re-finalize (codex #4)
- [ ] **RED:** finalize lại `cash_count_id` đã void → report `report_status='final'` **và** `void_reason/voided_by/voided_at` = NULL.
- [ ] **GREEN:** ở nhánh `on conflict (cash_count_id)` trong finalize, set `void_reason=null, voided_by=null, voided_at=null`.

### Task 2.4 — `safe_setup_initial` 2 số dư ([:1921])
- [ ] **RED:** `safe_setup_initial(p_cash, p_transfer, p_note)` → ≤2 row `initial_setup` (mỗi quỹ >0 1 row, `fund` + `balance_after` tương ứng). `drop function public.safe_setup_initial(numeric, text)` trước (đổi chữ ký). Data layer + setup-modal nhận 2 ô. Grant chữ ký mới (003_rls).
- [ ] **GREEN + UI:** `setup-safe-modal` 2 input (Quỹ tiền mặt / Quỹ chuyển khoản).

### Task 2.5 — `save_cash_day_opening` rút từ quỹ cash ([:2258] bản hiệu lực — codex #2, SPEC GAP)
- [ ] **RED:** mở két rút từ sổ quỹ → row `withdraw_open` có `fund='cash'`; validate chống `safe_fund_balance_now('cash')` (KHÔNG phải total).
- [ ] **GREEN:** ở [:2258], chỗ `v_safe_balance := safe_balance_now()` + insert `withdraw_open`: đổi sang cash fund + `fund='cash'` + advisory lock. (Nhớ bản [:210] là def cũ — KHÔNG sửa, bản 2258 đè.)

### Task 2.6 — `edit_cash_close_report` leave→chỉ cash ([:970])
- [ ] **Verify (non-issue confirmed):** edit chỉ nhận `p_report_id/p_note/p_leave_for_next_day` → đổi safe_deposit cash; transfer giữ nguyên. Chỉ cần đảm bảo adjustment do leave-change gắn `fund='cash'`.

### Phase 2 — Verify gate
- [ ] pgTAP toàn bộ (chốt CK 2 row · void 2 quỹ · re-finalize sạch metadata · setup 2 số · opening rút cash) xanh trên clean-DB.
- [ ] `tsc` + `test:run` xanh. Manual: chốt két có CK → quỹ CK tăng, đếm két tiền mặt không lệch; void hoàn cả 2.

---

## PHASE 3 — Chi tách quỹ + F4 (rút chỉnh ngày)

**Mục tiêu:** rút/điều chỉnh/đếm theo quỹ; F4 ô ngày + đổi cơ sở số dư sang `created_at`; helper tách quỹ + UI.

### Task 3.1 — Helper `fund-split.ts` (TDD Vitest)
- [ ] **RED `purchase`... →** `src/features/safe/__tests__/fund-split.test.ts`:
  - `defaultFundSplit(500_000, 300_000) → {cash:200_000, transfer:300_000}` (CK trước).
  - `defaultFundSplit(500_000, 0) → {cash:500_000, transfer:0}`; `defaultFundSplit(500_000, -10) → {cash:500_000, transfer:0}` (max(0,bal) — codex #8).
  - `isFundSplitValid({cash,transfer}, total, cashBal, transferBal)`: sum=total & per-fund ≤ bal & ≥0 & integer.
- [ ] **GREEN:** `fund-split.ts`:
```ts
export function defaultFundSplit(total: number, transferBalance: number): { cash: number; transfer: number } {
  const avail = Math.max(0, Math.floor(transferBalance));
  const transfer = Math.min(Math.floor(total), avail);
  return { cash: Math.floor(total) - transfer, transfer };
}
export function isFundSplitValid(
  s: { cash: number; transfer: number }, total: number, cashBal: number, transferBal: number
): boolean {
  return Number.isInteger(s.cash) && Number.isInteger(s.transfer) &&
    s.cash >= 0 && s.transfer >= 0 && s.cash + s.transfer === Math.floor(total) &&
    s.cash <= cashBal && s.transfer <= transferBal;
}
```

### Task 3.2 — `safe_withdraw_other` + F4 + split ([:1955])
- [ ] **RED pgTAP:** `safe_withdraw_other(p_cash_amount, p_transfer_amount, p_category, p_description, p_occurred_at)` (drop chữ ký cũ `(numeric,text,text)` trước): rút 300k CK + 200k cash → 2 row (fund tương ứng, amount âm); mỗi quỹ giảm đúng; tổng giảm 500k. Back-date (`p_occurred_at` = hôm qua) → số dư **vẫn giảm ngay** (basis `created_at`). Vượt 1 quỹ → raise, rollback. Row amount=0 → skip.
- [ ] **GREEN:** đổi balance lookup per-fund sang `created_at desc, id desc` (+ advisory lock); insert 1–2 row; `occurred_at = coalesce(p_occurred_at, now())`. Grant chữ ký mới.

### Task 3.3 — Đổi cơ sở số dư các reader cũ sang `created_at` (F4)
- [ ] `safe_balance_now` [:1904], `safe_adjust` lookup [:2036], (và bất kỳ reader "số dư mới nhất" nào) đổi `occurred_at desc` → `created_at desc, id desc`. (finalize/void/opening đã chuyển sang per-fund helper ở P2 → tự hưởng.) Behavior-neutral cho row cũ (occurred_at==created_at).

### Task 3.4 — `safe_adjust(p_fund,...)` + `safe_count` (cash)
- [ ] `safe_adjust` [:2012] thêm `p_fund` (drop chữ ký cũ); điều chỉnh đúng quỹ (advisory lock). `safe_count` [:2062] đổi `v_balance := safe_fund_balance_now('cash')`. adjust-modal thêm chọn quỹ; count so quỹ cash.

### Task 3.5 — UI: withdraw-safe-modal (ngày + tách quỹ)
- [ ] Thêm ô ngày (default hôm nay, gửi ngày+giờ-hiện-tại ISO). 2 ô "Trả từ CK" + "Trả từ tiền mặt" (default `defaultFundSplit(total, transferBal)`, sửa được); chặn submit nếu `!isFundSplitValid`. Mutation + data layer truyền `occurredAt` + split. (Tùy) `validateSafeWithdraw` chặn ngày tương lai.

### Phase 3 — Verify gate
- [ ] pgTAP (split 2 nguồn · back-date giảm ngay · vượt quỹ rollback · count cash · adjust per-fund) + Vitest fund-split xanh trên clean-DB. `tsc`+`test:run` xanh. Manual theo spec.

---

## Self-review hooks
- Mọi đổi chữ ký RPC → `drop function` bản cũ trước (PostgREST ambiguity). 
- Dual-write: migration **và** canonical 00x byte-khớp thân hàm.
- Clean-DB verify mỗi pha (DB throwaway trong `supabase-db`, apply base+migrations, no seed).
- KHÔNG đụng F1 (spec #4 riêng).
