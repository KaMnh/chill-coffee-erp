# Kết toán kỳ (Period Close & Owner Draw) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chủ quán kết sổ ngày bất kỳ (kỳ = từ lần kết trước → nay), xem thu–chi từng ngày, để lại float, rút lợi nhuận qua `transaction_type='owner_draw'` — **KHÔNG tạo dòng `expenses`** nên lợi nhuận không bị trừ oan (sửa lỗi bản chất của nút F4).

**Architecture:** Dual-write SQL (canonical 001/002/003 + migration nguyên văn); bảng snapshot `period_closes` ghi qua 4 RPC security-definer owner-only; FE feature mới `src/features/period-close/` tái dùng `CashFlowChart`/`ExpenseBreakdownTable`/`LunarCalendarWidget` + UX tách quỹ của F4.

**Tech Stack:** Postgres (local Supabase) + pgTAP; Next.js 15 / React Query / Vitest.

## Context

- Spec: `docs/superpowers/specs/2026-06-12-period-close-settlement-design.md` — đang nằm ở commit `3903618` trên nhánh `claude/beautiful-bassi-bf23ba` (chưa merge). Task 0 cherry-pick vào nhánh feature.
- **Các delta đã chốt qua brainstorm + adversarial review (sửa so với spec):**
  1. **Profit kỳ TRỪ ĐỦ rút quỹ vận hành** (user chốt 2026-06-12): `expenses_total` = TOÀN BỘ `expenses` trong kỳ (gồm cả expense-mirror của `withdraw_other` — owner luôn thấy mirror trong `cash_flow_overview`). Spec §3.2 ghi `safe_transaction_id is null` là SAI — sẽ làm profit cao hơn màn Dòng tiền. `owner_draw` không có mirror → tự động không bị trừ (bất biến #1 giữ nguyên).
  2. **`safe_transactions_amount_sign_check` có `else false`** → thêm `owner_draw` mà không retrofit constraint này thì MỌI insert owner_draw FAIL. Phải drop/re-add cả 2 CHECK (transaction_type + amount_sign) bằng DO block idempotent (test `position('owner_draw' in pg_get_constraintdef)`).
  3. **`period_closes` thêm `void_reason/voided_by/voided_at`** (tiền lệ `cash_close_reports`).
  4. **`pg_advisory_xact_lock(hashtext('period_close'))`** đầu finalize/void — chống 2 finalize đồng thời; **chặn kết 2 lần cùng ngày** (`period_start > p_close_date` → raise; muốn kết lại phải void).
  5. **Ngày "hôm nay" theo VN** (`(now() at time zone 'Asia/Ho_Chi_Minh')::date`), KHÔNG dùng `current_date` (UTC) — F4 có bug nhỏ này: sau 0h VN bị chặn "tương lai". `business_date` toàn hệ là nhãn VN.
  6. RLS `period_closes`: select owner-only + insert `with check (false)`; update/delete không có policy → mặc định deny. Ghi chỉ qua RPC.
  7. Helper `period_close_period_start()` KHÔNG grant cho authenticated (chỉ definer-functions gọi nội bộ).
- **Codex adversarial review (verdict needs-attention) — disposition từng finding:**
  - **[high] FK-ordering trong spec §4.2** (tạo owner_draw gắn `period_close_id` TRƯỚC khi insert `period_closes` → FK immediate fail): ✅ plan này đã đảo đúng thứ tự — insert `period_closes` returning id TRƯỚC, owner_draw SAU (Task 2.4). Ghi vào spec amendment.
  - **[medium] Anchor kỳ đầu theo `initial_setup` bỏ sót dữ liệu import cũ hơn** (đúng với DB này: sales import từ tháng 5, sổ quỹ lập 06-10): ✅ đổi `period_close_period_start` → `least(min sales, min expenses, min payroll, min safe-tx)` (Postgres `least()` bỏ qua NULL). Task 2.4.
  - **[high] owner_draw vô hình trong `analytics.daily_cashflow`** (n8n đối soát cash_position vs cashflow lệch ngày kết kỳ): ✅ user chốt 2026-06-12 LÀM LUÔN PR này — thêm cột `safe_draw_owner`, tính vào `total_out`/`net_cashflow` (tiền rời doanh nghiệp) nhưng KHÔNG đụng `daily_pnl` (không phải chi phí). Task 2.4b.
  - **[critical] Snapshot có thể lệch nguồn khi sửa dữ liệu quá khứ (không khoá kỳ)**: ⚠️ CHẤP NHẬN — user đã đặt "khoá cứng kỳ" ngoài phạm vi (spec §8 + handoff "đừng làm"). Giảm nhẹ: ghi rõ giới hạn vào spec + 1 dòng note tĩnh trong card Lịch sử ("Snapshot chốt tại thời điểm kết; sửa dữ liệu quá khứ không tự cập nhật — muốn làm lại hãy huỷ kỳ gần nhất"). Task 7.
- Ngoài phạm vi (spec §8): khoá cứng kỳ, quý cố định, sửa kỳ giữa lịch sử, đa tiền tệ. `daily_pnl` giữ nguyên (owner_draw cố ý KHÔNG lọt — không phải chi phí); `cash_position` tự đúng (đọc balance_after); adjustment-refund khi void vẫn bị loại khỏi cashflow như mọi adjustment khác (nhất quán tiền lệ void chốt két).

## Môi trường & quy ước

- Worktree: `C:\Users\RAZER 15\Documents\Claude\Projects\Chill Coffee ERP\.claude\worktrees\jovial-bassi-492330`. Nhánh mới `claude/period-close` từ `origin/main`.
- DB local: `docker exec -i supabase-db psql -U postgres -d postgres`. pgTAP: `node scripts/pgtap-run.mjs [--file <path>]` (BEGIN/ROLLBACK per file — an toàn trên dev DB).
- ⚠️ KHÔNG `npm run build` khi dev server 3009 đang chạy.
- PS 5.1: PR body qua `--body-file`; KHÔNG dùng `"` trong commit message.
- PR vào `main`, 4 check (typecheck, vitest, pgtap, build); squash merge.

## File Structure

| File | Vai trò |
|---|---|
| `database/001_schema.sql` (sửa) | +`'owner_draw'` inline check; retrofit DO block 2 CHECK; bảng `period_closes`; cột `safe_transactions.period_close_id` |
| `database/002_functions.sql` (sửa) | 5 function mới (cuối file) + SỬA view `analytics.daily_cashflow` (+`safe_draw_owner`) |
| `docs/integrations/n8n-analytics-views.md` (sửa) | Bảng §2 thêm cột `safe_draw_owner` + ghi chú total_out |
| `database/003_rls.sql` (sửa) | RLS + grants `period_closes` |
| `database/migrations/2026-06-12-period-close-settlement.sql` (mới) | Trích nguyên văn toàn bộ phần trên |
| `database/tests/290_finalize_period_close.sql` (mới) | finalize + anchor + validations |
| `database/tests/291_period_close_pnl_regression.sql` (mới) | **owner_draw KHÔNG đổi cash_flow_overview / daily_pnl** |
| `database/tests/292_void_period_close.sql` (mới) | void latest-only + refund + re-anchor |
| `database/tests/293_period_close_rls.sql` (mới) | RLS read/write + non-owner RPC |
| `src/lib/types.ts` (sửa) | `owner_draw` vào union + labels; `period_close_id`; `PeriodClosePreview`, `PeriodCloseRecord` |
| `src/lib/data/period-close.ts` (mới) + `__tests__/period-close.test.ts` | RPC wrappers + mock tests |
| `src/features/period-close/float-split.ts` (mới) + `__tests__/float-split.test.ts` | float → draw split thuần (TDD) |
| `src/hooks/queries/keys.ts`, `use-period-close-queries.ts` (mới), `index.ts` | preview + list queries |
| `src/hooks/mutations/use-period-close-mutations.ts` (mới) | finalize + void |
| `src/features/period-close/period-close-modal.tsx` (mới) | modal kết kỳ (float, tách quỹ kiểu F4, note) |
| `src/features/period-close/period-close-view.tsx` (mới) | thẻ kỳ + chart/breakdown/lunar + lịch sử + void |
| `src/features/safe/safe-history-section.tsx`, `safe-transaction-detail-modal.tsx` (sửa) | label/badge "Rút lợi nhuận" + filter |
| `src/components/ui/icons.tsx`, `src/features/navigation/navigation.ts`, `src/app/page.tsx` (sửa) | icon `handCoins`, ViewKey `period-close` owner-only, wiring |
| `docs/superpowers/specs/...-design.md` (sửa) | amendment các delta đã chốt |

---

### Task 0: Nhánh + spec

**Files:** repo state; `docs/superpowers/specs/2026-06-12-period-close-settlement-design.md`; copy plan này → `docs/superpowers/plans/2026-06-12-period-close-settlement.md`

- [ ] **0.1** Tạo nhánh từ main mới nhất:
```powershell
git fetch origin; git checkout -b claude/period-close origin/main
```
- [ ] **0.2** Cherry-pick spec commit (chỉ 2 file docs, không đụng code — đã verify `git show --stat 3903618`):
```powershell
git cherry-pick 3903618
```
- [ ] **0.3** Sửa spec theo delta đã chốt (§Context trên): §3.2 ghi rõ `expenses_total` = toàn bộ expenses owner-visible (gồm mirror) + lý do; §3.2 thêm 3 cột void_*; §4.2 thêm advisory lock `period_close` + chặn `period_start > close_date`; §4 ghi chú ngày VN thay `current_date`. Copy plan file vào `docs/superpowers/plans/2026-06-12-period-close-settlement.md`. Commit:
```powershell
git add docs; git commit -m "docs(period-close): spec amendment sau adversarial review + plan"
```

### Task 1: pgTAP RED — viết 4 file test trước

**Files:** Create 4 file test dưới đây. Chạy phải FAIL (function/bảng chưa có).

Fixtures chung mỗi file (mẫu `200_cash_flow_overview.sql`): `begin; select plan(N);` + `pg_temp.act_as()` + auth.users/profiles/employee_accounts (owner `aaaaaaaa-…`, staff `bbbbbbbb-…` khi cần) + `select * from finish(); rollback;`. Quỹ khởi tạo qua `safe_setup_initial` được vì rollback — NHƯNG dev DB đã có safe_transactions → RPC này raise "đã có giao dịch". Vì vậy fixture quỹ dùng **insert trực tiếp** (trong transaction test, RLS bypass không có — phải `set local role` … KHÔNG: đơn giản nhất là gọi RPC `safe_adjust` (owner, set số dư tuyệt đối) cho từng quỹ — hoạt động trên cả DB sạch lẫn dev DB):
```sql
select public.safe_adjust('cash', 5000000, 'fixture period close test');
select public.safe_adjust('transfer', 2000000, 'fixture period close test');
```
(Nếu signature khác — `rg "safe_adjust" database/002_functions.sql` — chỉnh theo: tham số (p_fund text, p_new_balance numeric, p_note text).)

- [ ] **1.1** Create `database/tests/290_finalize_period_close.sql`:
```sql
-- =============================================================================
-- pgTAP — finalize_period_close + period_close_preview (spec 2026-06-12)
-- Chạy được trên CẢ dev DB có dữ liệu thật lẫn CI DB sạch: assert về tổng P&L
-- dùng DELTA trước/sau fixture; số dư quỹ deterministic nhờ safe_adjust (đặt
-- số dư TUYỆT ĐỐI). safe_adjust(p_fund text, p_new_balance numeric, p_note text)
-- — đã verify 002_functions.sql:2311.
-- ⚠️ Nếu dev DB đã có period_closes 'final' với close_date = hôm nay (do test
-- tay) thì PHẢI void trước khi chạy suite — xem Task 9.2.
-- 12 assertions:
--   1. anchor: period_start <= hôm nay khi chưa có kỳ
--   2. DELTA preview sau fixture: rev +100, expenses_total +50 (30 thường +
--      20 MIRROR rút quỹ vận hành — proof quyết định brainstorm), pay +50, profit +0
--   3. staff bị chặn finalize
--   4. chặn ngày tương lai
--   5. chặn draw âm
--   6. chặn draw không nguyên VND
--   7. chặn rút quá số dư TỪNG quỹ (transfer 2tr, đòi 3tr)
--   8. finalize OK: đúng 2 owner_draw âm gắn period_close_id
--   9. KHÔNG có dòng expenses mới (đếm trước/sau)
--  10. closing_total = (4.999.980 + 2.000.000) − 1.500.000 = 5.499.980
--  11. kết lần 2 cùng ngày bị chặn
--  12. preview sau kết: period_start = close_date + 1
-- =============================================================================
begin;
select plan(12);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner_pc@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'staff_pc@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'OwnerPC'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'StaffPC');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'owner', 'active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'staff_operator', 'active');

select pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- Quỹ: đặt số dư TUYỆT ĐỐI → deterministic trên mọi DB.
select public.safe_adjust('cash', 5000000, 'fixture PC 290');
select public.safe_adjust('transfer', 2000000, 'fixture PC 290');

-- 1. anchor
select ok(
  (public.period_close_preview() ->> 'period_start')::date
    <= (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  '1. preview anchor <= hôm nay');

-- Snapshot preview TRƯỚC fixture P&L (delta pattern — dev DB có dữ liệu thật)
create temp table _pv0 as select
  (public.period_close_preview() ->> 'revenue')::numeric        as rev,
  (public.period_close_preview() ->> 'expenses_total')::numeric as exp,
  (public.period_close_preview() ->> 'payroll_total')::numeric  as pay,
  (public.period_close_preview() ->> 'profit')::numeric         as pft;

-- Fixture P&L hôm nay: revenue 100, expense thường 30, payroll 50,
-- rút quỹ vận hành 20 (tạo mirror; cash 5.000.000 → 4.999.980).
insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount)
  values ('PC-INV-290', now(), (now() at time zone 'Asia/Ho_Chi_Minh')::date, 100);
insert into public.expenses (business_date, description, amount)
  values ((now() at time zone 'Asia/Ho_Chi_Minh')::date, 'PC expense 290', 30);
create temp table _pc_emp (id uuid);
with e as (insert into public.employees (name, hourly_rate) values ('PC Emp 290', 100000) returning id)
insert into _pc_emp select id from e;
insert into public.shift_payroll_records (employee_id, business_date, total_minutes, hourly_rate, base_pay, total_pay)
  values ((select id from _pc_emp), (now() at time zone 'Asia/Ho_Chi_Minh')::date, 60, 100000, 50, 50);
select public.safe_withdraw_other(20, 0, 'utilities', 'PC mirror 290');

-- 2. DELTA: expenses_total tăng đúng 50 (30 + mirror 20) — chốt brainstorm
select ok(
  ((public.period_close_preview() ->> 'revenue')::numeric        - (select rev from _pv0)) = 100 and
  ((public.period_close_preview() ->> 'expenses_total')::numeric - (select exp from _pv0)) = 50  and
  ((public.period_close_preview() ->> 'payroll_total')::numeric  - (select pay from _pv0)) = 50  and
  ((public.period_close_preview() ->> 'profit')::numeric         - (select pft from _pv0)) = 0,
  '2. delta preview: rev+100 / exp+50 (gồm mirror) / pay+50 / profit+0');

-- 3..7 validations
select pg_temp.act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select throws_ok(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 0) $q$,
  'Chỉ owner được kết toán kỳ.', '3. staff bị chặn finalize');
select pg_temp.act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select throws_like(
  $q$ select public.finalize_period_close(((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1), 0, 0) $q$,
  '%tương lai%', '4. chặn ngày tương lai');
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, -1, 0) $q$,
  '%không được âm%', '5. chặn draw âm');
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 1000.5, 0) $q$,
  '%số nguyên%', '6. chặn draw lẻ');
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 3000000) $q$,
  '%không đủ%', '7. chặn rút quá quỹ chuyển khoản');

-- 8..10 finalize thành công: rút 1tr mặt + 500k CK
create temp table _exp_cnt as select count(*) c from public.expenses;
create temp table _pc_result as
select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date, 1000000, 500000, 'kết thử 290') as r;

select is(
  (select count(*) from public.safe_transactions
    where transaction_type = 'owner_draw'
      and period_close_id = (((select r from _pc_result) ->> 'id')::uuid)
      and amount < 0),
  2::bigint, '8. tạo đúng 2 owner_draw âm gắn period_close_id');
select is(
  (select count(*) from public.expenses), (select c from _exp_cnt),
  '9. owner_draw KHÔNG tạo dòng expenses');
select is(
  (select (r ->> 'closing_total')::numeric from _pc_result),
  5499980::numeric,
  '10. closing_total = 4.999.980 + 2.000.000 − 1.500.000');

-- 11..12
select throws_like(
  $q$ select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 0) $q$,
  '%Đã có kỳ kết%', '11. không kết 2 lần cùng ngày');
select is(
  (public.period_close_preview() ->> 'period_start')::date,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date + 1,
  '12. period_start mới = close_date + 1');

select * from finish();
rollback;
```

- [ ] **1.2** Create `database/tests/291_period_close_pnl_regression.sql` — **BẤT BIẾN #1**:
```sql
-- =============================================================================
-- pgTAP — REGRESSION: owner_draw KHÔNG ảnh hưởng lợi nhuận/chi phí,
-- NHƯNG hiện đúng trong analytics.daily_cashflow.safe_draw_owner
-- 8 assertions:
--   1-3. cash_flow_overview in/out/net TRƯỚC = SAU khi có owner_draw
--   4.   expenses row-count không đổi
--   5.   analytics.daily_pnl expenses_total + net_profit_cash không đổi
--   6.   safe_fund_balance_now('cash') GIẢM đúng số rút (tiền thật đã ra)
--   7.   daily_cashflow.safe_draw_owner hôm nay TĂNG đúng 2tr
--   8.   daily_cashflow.expense_out hôm nay KHÔNG đổi
-- =============================================================================
begin;
select plan(8);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner_reg@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'OwnerReg');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'owner', 'active');
select pg_temp.act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');

select public.safe_adjust('cash', 3000000, 'fixture reg');
insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount)
  values ('REG-INV-1', now(), (now() at time zone 'Asia/Ho_Chi_Minh')::date, 500000);

create temp table _before as select
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'in')::numeric  as i,
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'out')::numeric as o,
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'net')::numeric as n,
  (select count(*) from public.expenses) as ec,
  (select coalesce(sum(expenses_total),0) + coalesce(sum(net_profit_cash),0)
     from analytics.daily_pnl where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) as pnl,
  (select coalesce(sum(safe_draw_owner),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) as dco,
  (select coalesce(sum(expense_out),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date) as deo,
  public.safe_fund_balance_now('cash') as bal;

select public.finalize_period_close((now() at time zone 'Asia/Ho_Chi_Minh')::date, 2000000, 0, 'reg test');

select is((select i from _before),
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'in')::numeric,
  '1. in không đổi sau owner_draw');
select is((select o from _before),
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'out')::numeric,
  '2. out không đổi sau owner_draw');
select is((select n from _before),
  (public.cash_flow_overview((now() at time zone 'Asia/Ho_Chi_Minh')::date, (now() at time zone 'Asia/Ho_Chi_Minh')::date) ->> 'net')::numeric,
  '3. net (lợi nhuận) KHÔNG bị trừ bởi owner_draw');
select is((select ec from _before), (select count(*) from public.expenses),
  '4. không có dòng expenses mới');
select is((select pnl from _before),
  (select coalesce(sum(expenses_total),0) + coalesce(sum(net_profit_cash),0)
     from analytics.daily_pnl where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  '5. analytics.daily_pnl không đổi');
select is(public.safe_fund_balance_now('cash'), (select bal from _before) - 2000000,
  '6. số dư quỹ mặt giảm đúng 2tr');
select is(
  (select coalesce(sum(safe_draw_owner),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  (select dco from _before) + 2000000,
  '7. daily_cashflow.safe_draw_owner tăng đúng 2tr');
select is(
  (select coalesce(sum(expense_out),0)
     from analytics.daily_cashflow where business_date = (now() at time zone 'Asia/Ho_Chi_Minh')::date),
  (select deo from _before),
  '8. daily_cashflow.expense_out KHÔNG đổi (owner_draw không phải chi phí)');

select * from finish();
rollback;
```

- [ ] **1.3** Create `database/tests/292_void_period_close.sql`:
```sql
-- =============================================================================
-- pgTAP — void_period_close: latest-only + refund + re-anchor
-- 7 assertions:
--   1. lý do < 5 ký tự bị chặn
--   2. void kỳ KHÔNG phải gần nhất bị chặn
--   3. void OK: status='voided' + void_reason/voided_by/voided_at set
--   4. refund: balance 2 quỹ về như trước khi kết kỳ 2
--   5. adjustment refund gắn period_close_id
--   6. void lần nữa bị chặn (đã voided)
--   7. preview re-anchor về sau kỳ 1 (kỳ 2 voided không còn neo)
-- =============================================================================
begin;
select plan(7);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner_void@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'OwnerVoid');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'owner', 'active');
select pg_temp.act_as('dddddddd-dddd-dddd-dddd-dddddddddddd');

select public.safe_adjust('cash', 4000000, 'fixture void');
select public.safe_adjust('transfer', 1000000, 'fixture void');
-- Neo hoạt động TRƯỚC ngày kết kỳ 1 — trên CI DB sạch anchor sẽ là ngày này
-- (nếu không, anchor = hôm nay (safe_adjust) > close_date hôm kia → finalize raise).
insert into public.sales_orders (kiotviet_invoice_id, purchase_at, business_date, net_amount)
  values ('PC-INV-292', now(), (now() at time zone 'Asia/Ho_Chi_Minh')::date - 3, 10);

-- Kỳ 1: hôm kia (backdate), không rút. Kỳ 2: hôm nay, rút 1tr mặt + 200k CK.
create temp table _k1 as select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date - 2, 0, 0, 'kỳ 1') as r;
create temp table _bal_before_k2 as select
  public.safe_fund_balance_now('cash') as c, public.safe_fund_balance_now('transfer') as t;
create temp table _k2 as select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date, 1000000, 200000, 'kỳ 2') as r;

select throws_like(
  $q$ select public.void_period_close((((select r from _k2) ->> 'id')::uuid), 'abc') $q$,
  '%5 ký tự%', '1. lý do ngắn bị chặn');
select throws_like(
  $q$ select public.void_period_close((((select r from _k1) ->> 'id')::uuid), 'huỷ kỳ cũ thử') $q$,
  '%gần nhất%', '2. chỉ huỷ được lần kết gần nhất');

select public.void_period_close((((select r from _k2) ->> 'id')::uuid), 'huỷ kỳ 2 để kết lại');

select ok(
  (select status = 'voided' and void_reason is not null and voided_by is not null and voided_at is not null
     from public.period_closes where id = (((select r from _k2) ->> 'id')::uuid)),
  '3. status + void metadata đầy đủ');
select ok(
  public.safe_fund_balance_now('cash') = (select c from _bal_before_k2)
  and public.safe_fund_balance_now('transfer') = (select t from _bal_before_k2),
  '4. refund đủ 2 quỹ về mức trước kỳ 2');
select is(
  (select count(*) from public.safe_transactions
    where transaction_type = 'adjustment' and amount > 0
      and period_close_id = (((select r from _k2) ->> 'id')::uuid)),
  2::bigint, '5. 2 adjustment refund gắn period_close_id');
select throws_like(
  $q$ select public.void_period_close((((select r from _k2) ->> 'id')::uuid), 'huỷ lần nữa thử') $q$,
  '%đã bị huỷ%', '6. không void 2 lần');
select is(
  (public.period_close_preview() ->> 'period_start')::date,
  (now() at time zone 'Asia/Ho_Chi_Minh')::date - 1,
  '7. re-anchor về close_date kỳ 1 + 1');

select * from finish();
rollback;
```

- [ ] **1.4** Create `database/tests/293_period_close_rls.sql`:
```sql
-- =============================================================================
-- pgTAP — RLS period_closes: owner-read, no-direct-write, non-owner RPC chặn
-- 5 assertions:
--   1. owner SELECT thấy kỳ vừa tạo
--   2. staff SELECT được 0 dòng (RLS)
--   3. owner INSERT trực tiếp bị chặn (with check false)
--   4. staff gọi list_period_closes bị raise
--   5. staff gọi void_period_close bị raise
-- =============================================================================
begin;
select plan(5);

create or replace function pg_temp.act_as(p_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end; $$ language plpgsql;

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner_rls@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'staff_rls@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'OwnerRls'), ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'StaffRls');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'owner', 'active'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'staff_operator', 'active');

select pg_temp.act_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select public.safe_adjust('cash', 1000000, 'fixture rls');
create temp table _rls_k as select public.finalize_period_close(
  (now() at time zone 'Asia/Ho_Chi_Minh')::date, 0, 0, 'rls fixture') as r;

-- 1+2: SELECT qua RLS phải đổi role thật (mẫu 070_rls_safe_tables.sql / 150_rls_inventory.sql:
--   set local role authenticated; — copy đúng khuôn file 070).
set local role authenticated;
select pg_temp.act_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select cmp_ok((select count(*) from public.period_closes), '>=', 1::bigint, '1. owner đọc được');
select pg_temp.act_as('ffffffff-ffff-ffff-ffff-ffffffffffff');
select is((select count(*) from public.period_closes), 0::bigint, '2. staff đọc 0 dòng');

select pg_temp.act_as('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee');
select throws_like(
  $q$ insert into public.period_closes (close_date, period_start, period_end) values (current_date, current_date, current_date) $q$,
  '%row-level security%', '3. insert trực tiếp bị chặn kể cả owner');

select pg_temp.act_as('ffffffff-ffff-ffff-ffff-ffffffffffff');
select throws_like($q$ select public.list_period_closes() $q$, '%owner%', '4. staff bị chặn list');
select throws_like(
  $q$ select public.void_period_close((((select r from _rls_k) ->> 'id')::uuid), 'staff thử huỷ kỳ') $q$,
  '%owner%', '5. staff bị chặn void');
reset role;

select * from finish();
rollback;
```
**Lưu ý:** trước khi viết, mở `database/tests/070_rls_safe_tables.sql` copy đúng khuôn `set local role authenticated` / `reset role` (tránh đoán sai cách file 070 làm).

- [ ] **1.5** Chạy để xác nhận RED:
```powershell
node scripts/pgtap-run.mjs --file database/tests/290_finalize_period_close.sql
```
Expected: FAIL (`function public.period_close_preview() does not exist`). Tương tự 291–293.
- [ ] **1.6** Commit:
```powershell
git add database/tests; git commit -m "test(period-close): pgTAP RED — finalize/regression/void/RLS"
```

### Task 2: SQL GREEN — canonical 001/002/003 + migration

**Files:**
- Modify `database/001_schema.sql`: dòng 434–440 (inline check) + 534–553 (sign check DO block) + chèn block mới sau dòng ~553
- Modify `database/002_functions.sql`: append cuối file (trước phần analytics nếu file kết thúc bằng views — đặt ngay sau `safe_list_transactions` cũng được, miễn sau `safe_fund_balance_now` + `cash_flow_overview` KHÔNG nằm trong 002 → preview gọi `public.cash_flow_overview` lúc RUNTIME nên không cần thứ tự định nghĩa)
- Modify `database/003_rls.sql`: sau block `safe_transactions`
- Create `database/migrations/2026-06-12-period-close-settlement.sql`

- [ ] **2.1** `001_schema.sql` — inline check thêm `'owner_draw'`:
```sql
  transaction_type text not null check (transaction_type in (
    'initial_setup',
    'deposit_close',
    'withdraw_open',
    'withdraw_other',
    'adjustment',
    'owner_draw'
  )),
```
- [ ] **2.2** `001_schema.sql` — THAY DO block sign-check (534–553) bằng bản retrofit-aware (giữ nguyên `balance_check` phía dưới):
```sql
-- CHECK constraints cho safe_transactions amount sign.
-- owner_draw (2026-06-12): CASE có `else false` nên DB cũ PHẢI drop/re-add cả
-- transaction_type check lẫn sign check — nếu không mọi insert owner_draw fail.
do $$
declare v_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'safe_transactions_transaction_type_check'
     and c.conrelid = 'public.safe_transactions'::regclass;
  if v_def is not null and position('owner_draw' in v_def) = 0 then
    alter table public.safe_transactions drop constraint safe_transactions_transaction_type_check;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'safe_transactions_transaction_type_check'
                    and conrelid = 'public.safe_transactions'::regclass) then
    alter table public.safe_transactions add constraint safe_transactions_transaction_type_check
      check (transaction_type in ('initial_setup','deposit_close','withdraw_open','withdraw_other','adjustment','owner_draw'));
  end if;

  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c
   where c.conname = 'safe_transactions_amount_sign_check'
     and c.conrelid = 'public.safe_transactions'::regclass;
  if v_def is not null and position('owner_draw' in v_def) = 0 then
    alter table public.safe_transactions drop constraint safe_transactions_amount_sign_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'safe_transactions_amount_sign_check') then
    alter table public.safe_transactions add constraint safe_transactions_amount_sign_check check (
      case transaction_type
        when 'initial_setup'  then amount >= 0
        when 'deposit_close'  then amount >= 0
        when 'withdraw_open'  then amount <= 0
        when 'withdraw_other' then amount <= 0
        when 'owner_draw'     then amount <= 0
        when 'adjustment'     then true
        else false
      end
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'safe_transactions_balance_check') then
    alter table public.safe_transactions add constraint safe_transactions_balance_check
      check (balance_after >= 0);
  end if;
end $$;
```
- [ ] **2.3** `001_schema.sql` — sau block trên, thêm bảng + cột link (period_closes phải tạo TRƯỚC alter):
```sql
-- -----------------------------------------------------------------------------
-- Kết toán kỳ (period close) — snapshot mỗi lần chủ kết sổ + rút lợi nhuận.
-- expenses_total = TOÀN BỘ expenses trong kỳ theo góc nhìn owner (gồm cả
-- expense-mirror của rút quỹ vận hành) — khớp cash_flow_overview owner.
-- owner_draw KHÔNG có mirror nên không bao giờ lọt vào đây.
-- Ghi qua RPC security-definer; RLS trong 003.
-- -----------------------------------------------------------------------------
create table if not exists public.period_closes (
  id              uuid primary key default gen_random_uuid(),
  close_date      date not null,
  period_start    date not null,
  period_end      date not null,
  revenue         numeric(14,2) not null default 0,
  expenses_total  numeric(14,2) not null default 0,
  payroll_total   numeric(14,2) not null default 0,
  profit          numeric(14,2) not null default 0,
  opening_total       numeric(14,2) not null default 0,
  balance_before_cash     numeric(14,2) not null default 0,
  balance_before_transfer numeric(14,2) not null default 0,
  draw_cash       numeric(14,2) not null default 0,
  draw_transfer   numeric(14,2) not null default 0,
  draw_total      numeric(14,2) not null default 0,
  closing_cash     numeric(14,2) not null default 0,
  closing_transfer numeric(14,2) not null default 0,
  closing_total    numeric(14,2) not null default 0,
  note            text,
  status          text not null default 'final' check (status in ('final','voided')),
  void_reason     text,
  voided_by       uuid references auth.users(id),
  voided_at       timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  constraint period_closes_range_check check (period_start <= period_end)
);
create index if not exists period_closes_date_idx on public.period_closes(close_date desc);

-- Link owner_draw / adjustment-refund → kỳ kết (mẫu cash_close_report_id).
alter table public.safe_transactions
  add column if not exists period_close_id uuid null
    references public.period_closes(id) on delete set null;
create index if not exists safe_transactions_period_close_id_idx
  on public.safe_transactions(period_close_id)
  where period_close_id is not null;
```
- [ ] **2.4** `002_functions.sql` — append 5 functions (đặt cuối file, sau các safe RPC). **Toàn văn:**
```sql
-- =============================================================================
-- Kết toán kỳ (Period Close & Owner Draw) — 2026-06-12
-- Spec: docs/superpowers/specs/2026-06-12-period-close-settlement-design.md
-- owner_draw KHÔNG tạo expenses (khác hẳn safe_withdraw_other) → lợi nhuận
-- không bị trừ. "Hôm nay" = ngày VN (KHÔNG current_date — UTC lệch sau 0h VN).
-- =============================================================================

-- Neo đầu kỳ: (kết final gần nhất + 1) → ngày HOẠT ĐỘNG KINH DOANH sớm nhất
-- (least qua sales/expenses/payroll/sổ quỹ). Adversarial review 2026-06-12:
-- KHÔNG neo riêng initial_setup — dữ liệu bán hàng import (KiotViet, tháng 5)
-- CŨ HƠN ngày lập sổ quỹ (06-10), neo theo setup sẽ bỏ sót P&L kỳ đầu.
-- least()/greatest() của Postgres bỏ qua NULL. KHÔNG grant authenticated (nội bộ).
create or replace function public.period_close_period_start(p_as_of date)
returns date
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(
    (select max(close_date) + 1 from public.period_closes where status = 'final'),
    least(
      (select min(business_date) from public.sales_orders),
      (select min(business_date) from public.expenses),
      (select min(business_date) from public.shift_payroll_records),
      (select min((occurred_at at time zone 'Asia/Ho_Chi_Minh')::date) from public.safe_transactions)
    ),
    p_as_of
  );
$$;
revoke all on function public.period_close_period_start(date) from public;

create or replace function public.period_close_preview(p_as_of date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_as_of date := coalesce(p_as_of, (now() at time zone 'Asia/Ho_Chi_Minh')::date);
  v_start date;
  v_revenue numeric; v_expenses numeric; v_payroll numeric;
  v_cash numeric; v_transfer numeric;
  v_overview jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được xem kết toán kỳ.';
  end if;
  if v_as_of > v_today then
    raise exception 'Ngày kết không được ở tương lai.';
  end if;
  v_start := public.period_close_period_start(v_as_of);

  select coalesce(sum(net_amount), 0) into v_revenue
    from public.sales_orders where business_date between v_start and v_as_of;
  -- Owner: TOÀN BỘ expenses (gồm mirror rút quỹ vận hành) — khớp cash_flow_overview.
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where business_date between v_start and v_as_of;
  select coalesce(sum(total_pay), 0) into v_payroll
    from public.shift_payroll_records where business_date between v_start and v_as_of;

  v_cash := public.safe_fund_balance_now('cash');
  v_transfer := public.safe_fund_balance_now('transfer');

  -- by_day + expense_breakdown tái dùng cash_flow_overview (owner đã pass check trên).
  if v_start <= v_as_of then
    v_overview := public.cash_flow_overview(v_start, v_as_of);
  else
    v_overview := jsonb_build_object('by_day', '[]'::jsonb, 'expense_breakdown', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'period_start', v_start,
    'period_end', v_as_of,
    'can_close', v_start <= v_as_of,
    'revenue', v_revenue,
    'expenses_total', v_expenses,
    'payroll_total', v_payroll,
    'profit', v_revenue - v_expenses - v_payroll,
    'balance_cash', v_cash,
    'balance_transfer', v_transfer,
    'balance_total', v_cash + v_transfer,
    'opening_total', (select closing_total from public.period_closes
                       where status = 'final'
                       order by close_date desc, created_at desc limit 1),
    'by_day', coalesce(v_overview -> 'by_day', '[]'::jsonb),
    'expense_breakdown', coalesce(v_overview -> 'expense_breakdown', '[]'::jsonb)
  );
end;
$$;
grant execute on function public.period_close_preview(date) to authenticated;

create or replace function public.finalize_period_close(
  p_close_date date,
  p_draw_cash numeric,
  p_draw_transfer numeric,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
  v_draw_cash numeric := coalesce(p_draw_cash, 0);
  v_draw_transfer numeric := coalesce(p_draw_transfer, 0);
  v_start date;
  v_revenue numeric; v_expenses numeric; v_payroll numeric;
  v_before_cash numeric; v_before_transfer numeric;
  v_opening numeric;
  v_close_id uuid; v_cash_tx uuid; v_transfer_tx uuid;
  v_desc text;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được kết toán kỳ.';
  end if;
  if p_close_date is null or p_close_date > v_today then
    raise exception 'Ngày kết không được ở tương lai.';
  end if;
  if v_draw_cash < 0 or v_draw_transfer < 0 then
    raise exception 'Số tiền rút mỗi quỹ không được âm.';
  end if;
  if v_draw_cash <> floor(v_draw_cash) or v_draw_transfer <> floor(v_draw_transfer) then
    raise exception 'Số tiền phải là số nguyên VND.';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception 'Ghi chú vượt 500 ký tự.';
  end if;

  -- Chống 2 finalize/void đồng thời (đọc anchor + insert snapshot là 1 đơn vị).
  perform pg_advisory_xact_lock(hashtext('period_close'));

  v_start := public.period_close_period_start(p_close_date);
  if v_start > p_close_date then
    if exists (select 1 from public.period_closes where status = 'final') then
      raise exception 'Đã có kỳ kết đến ngày %. Huỷ lần kết gần nhất nếu muốn kết lại.',
        to_char(v_start - 1, 'DD/MM/YYYY');
    else
      raise exception 'Chưa có hoạt động kinh doanh nào trước ngày kết (đầu kỳ tính được là %).',
        to_char(v_start, 'DD/MM/YYYY');
    end if;
  end if;

  select coalesce(sum(net_amount), 0) into v_revenue
    from public.sales_orders where business_date between v_start and p_close_date;
  select coalesce(sum(amount), 0) into v_expenses
    from public.expenses where business_date between v_start and p_close_date;
  select coalesce(sum(total_pay), 0) into v_payroll
    from public.shift_payroll_records where business_date between v_start and p_close_date;
  select closing_total into v_opening from public.period_closes
   where status = 'final' order by close_date desc, created_at desc limit 1;

  -- Số dư & chặn rút quá TỪNG quỹ — lock cả 2 quỹ theo thứ tự cố định (cash trước).
  perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
  perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
  v_before_cash := public.safe_fund_balance_now('cash');
  v_before_transfer := public.safe_fund_balance_now('transfer');
  if v_draw_cash > v_before_cash then
    raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, rút %.', v_before_cash, v_draw_cash;
  end if;
  if v_draw_transfer > v_before_transfer then
    raise exception 'Quỹ chuyển khoản không đủ. Số dư hiện tại %, rút %.', v_before_transfer, v_draw_transfer;
  end if;

  insert into public.period_closes (
    close_date, period_start, period_end,
    revenue, expenses_total, payroll_total, profit,
    opening_total, balance_before_cash, balance_before_transfer,
    draw_cash, draw_transfer, draw_total,
    closing_cash, closing_transfer, closing_total,
    note, created_by
  ) values (
    p_close_date, v_start, p_close_date,
    v_revenue, v_expenses, v_payroll, v_revenue - v_expenses - v_payroll,
    coalesce(v_opening, 0), v_before_cash, v_before_transfer,
    v_draw_cash, v_draw_transfer, v_draw_cash + v_draw_transfer,
    v_before_cash - v_draw_cash, v_before_transfer - v_draw_transfer,
    (v_before_cash - v_draw_cash) + (v_before_transfer - v_draw_transfer),
    nullif(trim(p_note), ''), auth.uid()
  ) returning id into v_close_id;

  v_desc := 'Rút lợi nhuận kỳ ' || to_char(v_start, 'DD/MM') || '–' || to_char(p_close_date, 'DD/MM/YYYY');
  if v_draw_cash > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      description, period_close_id, created_by
    ) values (
      'owner_draw', -v_draw_cash, v_before_cash - v_draw_cash, 'cash',
      p_close_date::timestamptz, v_desc, v_close_id, auth.uid()
    ) returning id into v_cash_tx;
  end if;
  if v_draw_transfer > 0 then
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      description, period_close_id, created_by
    ) values (
      'owner_draw', -v_draw_transfer, v_before_transfer - v_draw_transfer, 'transfer',
      p_close_date::timestamptz, v_desc, v_close_id, auth.uid()
    ) returning id into v_transfer_tx;
  end if;
  -- LƯU Ý: KHÔNG insert public.expenses — đây là điểm sống còn của thiết kế.

  return jsonb_build_object(
    'id', v_close_id,
    'period_start', v_start, 'period_end', p_close_date,
    'revenue', v_revenue, 'expenses_total', v_expenses,
    'payroll_total', v_payroll, 'profit', v_revenue - v_expenses - v_payroll,
    'draw_cash', v_draw_cash, 'draw_transfer', v_draw_transfer,
    'draw_total', v_draw_cash + v_draw_transfer,
    'closing_cash', v_before_cash - v_draw_cash,
    'closing_transfer', v_before_transfer - v_draw_transfer,
    'closing_total', (v_before_cash - v_draw_cash) + (v_before_transfer - v_draw_transfer),
    'cash_tx_id', v_cash_tx, 'transfer_tx_id', v_transfer_tx
  );
end;
$$;
grant execute on function public.finalize_period_close(date, numeric, numeric, text) to authenticated;

create or replace function public.list_period_closes()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner xem được lịch sử kết toán kỳ.';
  end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.close_date desc, p.created_at desc), '[]'::jsonb)
    into v_result
  from public.period_closes p;
  return v_result;
end;
$$;
grant execute on function public.list_period_closes() to authenticated;

create or replace function public.void_period_close(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_close public.period_closes%rowtype;
  v_latest uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được huỷ kết toán kỳ.';
  end if;
  if coalesce(length(trim(p_reason)), 0) < 5 then
    raise exception 'Lý do huỷ phải ≥ 5 ký tự.';
  end if;

  perform pg_advisory_xact_lock(hashtext('period_close'));

  select * into v_close from public.period_closes where id = p_id for update;
  if not found then
    raise exception 'Không tìm thấy kỳ kết để huỷ.';
  end if;
  if v_close.status <> 'final' then
    raise exception 'Kỳ kết này đã bị huỷ trước đó.';
  end if;
  select id into v_latest from public.period_closes
   where status = 'final' order by close_date desc, created_at desc limit 1;
  if v_latest <> p_id then
    raise exception 'Chỉ huỷ được lần kết gần nhất.';
  end if;

  update public.period_closes
     set status = 'voided', void_reason = p_reason, voided_by = auth.uid(), voided_at = now()
   where id = p_id;

  -- Hoàn từng quỹ qua adjustment dương (tiền lệ void_cash_close_report —
  -- KHÔNG xoá owner_draw gốc, giữ audit trail).
  if v_close.draw_cash > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, description, period_close_id, created_by
    ) values (
      'adjustment', v_close.draw_cash,
      public.safe_fund_balance_now('cash') + v_close.draw_cash, 'cash',
      'Hoàn rút lợi nhuận do huỷ kỳ kết ' || to_char(v_close.close_date, 'DD/MM/YYYY') || ': ' || left(p_reason, 80),
      p_id, auth.uid()
    );
  end if;
  if v_close.draw_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, description, period_close_id, created_by
    ) values (
      'adjustment', v_close.draw_transfer,
      public.safe_fund_balance_now('transfer') + v_close.draw_transfer, 'transfer',
      'Hoàn rút lợi nhuận do huỷ kỳ kết ' || to_char(v_close.close_date, 'DD/MM/YYYY') || ': ' || left(p_reason, 80),
      p_id, auth.uid()
    );
  end if;

  return jsonb_build_object(
    'id', p_id, 'status', 'voided',
    'refunded_cash', v_close.draw_cash, 'refunded_transfer', v_close.draw_transfer
  );
end;
$$;
grant execute on function public.void_period_close(uuid, text) to authenticated;
```
- [ ] **2.4b** `002_functions.sql` — SỬA TẠI CHỖ view `analytics.daily_cashflow` (dòng ~3970–4030; user chốt 2026-06-12 làm luôn theo codex finding). Thay nguyên block `drop view … comment on view analytics.daily_cashflow …` bằng:
```sql
drop view if exists analytics.daily_cashflow cascade;
create view analytics.daily_cashflow
with (security_invoker = true) as
with days as (
  select so.business_date
  from public.sales_payments sp join public.sales_orders so on so.id = sp.sales_order_id
  union
  select business_date from public.expenses where safe_transaction_id is null
  union
  select business_date from public.shift_payroll_records
  union
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.safe_transactions where transaction_type in ('withdraw_other', 'owner_draw')
),
pay as (
  select so.business_date,
         sum(sp.amount) filter (where sp.payment_method = 'cash')          as cash_in_pos,
         sum(sp.amount) filter (where sp.payment_method = 'bank_transfer') as transfer_in
  from public.sales_payments sp
  join public.sales_orders so on so.id = sp.sales_order_id
  group by 1
),
exp as (
  select business_date, sum(amount) as expense_out
  from public.expenses where safe_transaction_id is null group by 1
),
pr as (
  select business_date, sum(total_pay) as payroll_out
  from public.shift_payroll_records group by 1
),
saf as (
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date as business_date,
         -sum(amount) filter (where transaction_type = 'withdraw_other' and reason_category = 'inventory')                 as safe_withdraw_inventory,
         -sum(amount) filter (where transaction_type = 'withdraw_other' and reason_category is distinct from 'inventory') as safe_withdraw_other_ops,
         -sum(amount) filter (where transaction_type = 'owner_draw')                                                      as safe_draw_owner
  from public.safe_transactions
  where transaction_type in ('withdraw_other', 'owner_draw')
  group by 1
)
select d.business_date,
       coalesce(pay.cash_in_pos, 0)              as cash_in_pos,
       coalesce(pay.transfer_in, 0)              as transfer_in,
       coalesce(exp.expense_out, 0)              as expense_out,
       coalesce(pr.payroll_out, 0)               as payroll_out,
       coalesce(saf.safe_withdraw_inventory, 0)  as safe_withdraw_inventory,
       coalesce(saf.safe_withdraw_other_ops, 0)  as safe_withdraw_other_ops,
       coalesce(saf.safe_draw_owner, 0)          as safe_draw_owner,
       coalesce(pay.cash_in_pos, 0) + coalesce(pay.transfer_in, 0) as total_in,
       coalesce(exp.expense_out, 0) + coalesce(pr.payroll_out, 0)
         + coalesce(saf.safe_withdraw_inventory, 0) + coalesce(saf.safe_withdraw_other_ops, 0)
         + coalesce(saf.safe_draw_owner, 0) as total_out,
       coalesce(pay.cash_in_pos, 0) + coalesce(pay.transfer_in, 0)
         - (coalesce(exp.expense_out, 0) + coalesce(pr.payroll_out, 0)
            + coalesce(saf.safe_withdraw_inventory, 0) + coalesce(saf.safe_withdraw_other_ops, 0)
            + coalesce(saf.safe_draw_owner, 0)) as net_cashflow
from days d
left join pay using (business_date)
left join exp using (business_date)
left join pr  using (business_date)
left join saf using (business_date);

comment on view analytics.daily_cashflow is
  'Dòng tiền vào/ra theo ngày từ bảng nghiệp vụ gốc. Loại deposit_close/withdraw_open/'
  'adjustment/initial_setup (luân chuyển nội bộ, vốn, bù trừ void). Expense mirror của '
  'rút quỹ đã loại. safe_draw_owner = rút lợi nhuận (owner_draw) — TÍNH vào total_out '
  '(tiền rời doanh nghiệp) nhưng KHÔNG phải chi phí P&L. Bucket safe theo occurred_at.';
```
**Lưu ý:** `daily_pnl` GIỮ NGUYÊN (owner_draw không phải chi phí). Grant trên schema analytics đã có sẵn (`grant select on all tables in schema analytics to service_role` — kiểm tra block grant cuối phần analytics trong 002, nếu là grant-per-view thì view tái tạo cần re-grant; đối chiếu migration 2026-06-11-analytics-views.sql phần grant và lặp đúng).

- [ ] **2.5** `003_rls.sql` — sau block safe_transactions (mẫu y hệt):
```sql
-- Kết toán kỳ: owner-only read; mọi write qua RPC security definer.
alter table public.period_closes enable row level security;
drop policy if exists period_closes_owner_read on public.period_closes;
create policy period_closes_owner_read on public.period_closes
  for select to authenticated using (public.app_role() = 'owner');
drop policy if exists period_closes_no_direct_write on public.period_closes;
create policy period_closes_no_direct_write on public.period_closes
  for insert to authenticated with check (false);
grant select on public.period_closes to authenticated;
grant all on public.period_closes to service_role;
```
(Đối chiếu block grants của `safe_transactions` trong 003 — copy đúng format hiện có.)
- [ ] **2.6** Create `database/migrations/2026-06-12-period-close-settlement.sql` — header comment 3 dòng (mẫu 2026-06-12-ingredient-reference-prices.sql) + **trích nguyên văn**: block 2.2 + block 2.3 + toàn bộ 2.4 + block 2.4b (kèm re-grant analytics nếu cần) + block 2.5. (KHÔNG gồm 2.1 — inline create-table chỉ chạy trên DB mới qua 001.)
- [ ] **2.7** Áp lên dev DB theo đúng đường prod (migration trước — dev DB là "DB cũ"), rồi canonical để xác nhận idempotent:
```powershell
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < database/migrations/2026-06-12-period-close-settlement.sql
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < database/001_schema.sql
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < database/002_functions.sql
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < database/003_rls.sql
```
(Nếu psql `-f -` không ăn trên Windows pipe: dùng `Get-Content ... -Raw | docker exec -i supabase-db psql -U postgres -d postgres`.) Expected: không lỗi, chạy lại lần 2 cũng không lỗi (idempotent). Có BOM thì strip như tiền lệ (`perl -pe 's/\xEF\xBB\xBF//g'`).
- [ ] **2.8** Chạy pgTAP GREEN:
```powershell
node scripts/pgtap-run.mjs --file database/tests/290_finalize_period_close.sql
node scripts/pgtap-run.mjs --file database/tests/291_period_close_pnl_regression.sql
node scripts/pgtap-run.mjs --file database/tests/292_void_period_close.sql
node scripts/pgtap-run.mjs --file database/tests/293_period_close_rls.sql
node scripts/pgtap-run.mjs
```
Expected: PASS toàn bộ (kể cả suite cũ — đặc biệt 070/230/270 không vỡ).
- [ ] **2.9** Commit:
```powershell
git add database; git commit -m "feat(db): period_closes + owner_draw + 4 RPC ket toan ky (dual-write)"
```

### Task 3: Types + labels owner_draw (tsc-driven)

**Files:** Modify `src/lib/types.ts` (~dòng 156–231, 425+); `src/features/safe/safe-history-section.tsx` (dòng 33–49); `src/features/safe/safe-transaction-detail-modal.tsx` (dòng 23–37)

- [ ] **3.1** `types.ts`: union + label + field + 2 type mới:
```ts
export type SafeTransactionType =
  | "initial_setup" | "deposit_close" | "withdraw_open"
  | "withdraw_other" | "adjustment" | "owner_draw";
// SAFE_TRANSACTION_LABELS thêm:  owner_draw: "Rút lợi nhuận",
// SafeTransaction thêm:  period_close_id?: string | null;

export interface PeriodClosePreview {
  period_start: string;
  period_end: string;
  can_close: boolean;
  revenue: number;
  expenses_total: number;
  payroll_total: number;
  profit: number;
  balance_cash: number;
  balance_transfer: number;
  balance_total: number;
  opening_total: number | null;
  by_day: CashFlowDayPoint[];
  expense_breakdown: CashFlowExpenseCategory[];
}

export interface PeriodCloseRecord {
  id: string;
  close_date: string;
  period_start: string;
  period_end: string;
  revenue: number;
  expenses_total: number;
  payroll_total: number;
  profit: number;
  opening_total: number;
  balance_before_cash: number;
  balance_before_transfer: number;
  draw_cash: number;
  draw_transfer: number;
  draw_total: number;
  closing_cash: number;
  closing_transfer: number;
  closing_total: number;
  note: string | null;
  status: "final" | "voided";
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
}
```
- [ ] **3.2** Chạy `npx tsc --noEmit` → lỗi ở các map `Record<SafeTransactionType, …>`; sửa: `safe-history-section.tsx` `TYPE_LABELS += owner_draw: "Rút lợi nhuận"`, `TYPE_SEMANTICS += owner_draw: "warning"`, `TYPES` array += `"owner_draw"` (filter dropdown); `safe-transaction-detail-modal.tsx` map local tương tự. tsc sạch.
- [ ] **3.3** Commit: `git add src; git commit -m "feat(types): owner_draw + PeriodClose types + badge Rut loi nhuan"`

### Task 4: Data layer + float-split (TDD)

**Files:** Create `src/lib/data/period-close.ts`, `src/lib/data/__tests__/period-close.test.ts`, `src/features/period-close/float-split.ts`, `src/features/period-close/__tests__/float-split.test.ts`; Modify `src/lib/data/index.ts` (+`export * from "./period-close";`)

- [ ] **4.1** Test float-split TRƯỚC (`__tests__/float-split.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { drawFromFloat } from "../float-split";

const BAL = { cash: 5_000_000, transfer: 2_000_000, total: 7_000_000 };

describe("drawFromFloat — rút = số dư − float, ưu tiên ĐỂ LẠI tiền mặt", () => {
  it("float 0 → rút hết cả hai quỹ", () => {
    expect(drawFromFloat(BAL, 0)).toEqual({ cash: 5_000_000, transfer: 2_000_000 });
  });
  it("float nhỏ hơn transfer → rút hết transfer trước, phần float nằm ở cash", () => {
    // draw 6tr = transfer 2tr + cash 4tr → để lại 1tr toàn tiền mặt
    expect(drawFromFloat(BAL, 1_000_000)).toEqual({ cash: 4_000_000, transfer: 2_000_000 });
  });
  it("float lớn → chỉ rút từ transfer", () => {
    // draw 1tr, defaultFundSplit ưu tiên transfer → cash giữ nguyên
    expect(drawFromFloat(BAL, 6_000_000)).toEqual({ cash: 0, transfer: 1_000_000 });
  });
  it("float ≥ tổng → không rút gì", () => {
    expect(drawFromFloat(BAL, 7_000_000)).toEqual({ cash: 0, transfer: 0 });
    expect(drawFromFloat(BAL, 99_000_000)).toEqual({ cash: 0, transfer: 0 });
  });
  it("float âm/lẻ bị floor về hợp lệ", () => {
    expect(drawFromFloat(BAL, -5)).toEqual({ cash: 5_000_000, transfer: 2_000_000 });
  });
});
```
Run `npx vitest run src/features/period-close` → FAIL (module chưa có).
- [ ] **4.2** `float-split.ts`:
```ts
import { defaultFundSplit, type FundSplit } from "@/features/safe/fund-split";
import type { SafeBalances } from "@/lib/types";

/**
 * Kết toán kỳ: người dùng nhập "số vốn để lại" (float), phần rút = số dư − float.
 * Tách rút theo quỹ bằng defaultFundSplit (rút CHUYỂN KHOẢN trước → phần để
 * lại ưu tiên là TIỀN MẶT — đúng yêu cầu vận hành quán).
 */
export function drawFromFloat(balances: SafeBalances, floatTotal: number): FundSplit {
  const safeFloat = Math.max(0, Math.floor(floatTotal || 0));
  const drawTotal = Math.max(0, balances.total - safeFloat);
  return defaultFundSplit(drawTotal, balances.transfer);
}
```
Run lại → PASS. (Nếu case "float lớn → chỉ rút transfer" fail vì defaultFundSplit cap transfer = min(total, transferBalance): drawTotal 1tr < transfer 2tr → transfer 1tr, cash 0 ✓.)
- [ ] **4.3** `period-close.ts` data wrapper (mẫu `src/lib/data/safe.ts` + `toAppError`):
```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "@/lib/errors";
import type { PeriodClosePreview, PeriodCloseRecord } from "@/lib/types";

export async function loadPeriodClosePreview(supabase: SupabaseClient): Promise<PeriodClosePreview> {
  const { data, error } = await supabase.rpc("period_close_preview");
  if (error) throw toAppError(error, "Không tải được kỳ hiện tại.");
  return data as PeriodClosePreview;
}

export async function loadPeriodCloses(supabase: SupabaseClient): Promise<PeriodCloseRecord[]> {
  const { data, error } = await supabase.rpc("list_period_closes");
  if (error) throw toAppError(error, "Không tải được lịch sử kết toán kỳ.");
  return (data ?? []) as PeriodCloseRecord[];
}

export async function finalizePeriodClose(
  supabase: SupabaseClient,
  payload: { closeDate: string; drawCash: number; drawTransfer: number; note?: string }
) {
  const { data, error } = await supabase.rpc("finalize_period_close", {
    p_close_date: payload.closeDate,
    p_draw_cash: payload.drawCash,
    p_draw_transfer: payload.drawTransfer,
    p_note: payload.note ?? null,
  });
  if (error) throw toAppError(error, "Không kết toán được kỳ.");
  return data as { id: string; draw_total: number; closing_total: number };
}

export async function voidPeriodClose(
  supabase: SupabaseClient,
  payload: { id: string; reason: string }
) {
  const { data, error } = await supabase.rpc("void_period_close", {
    p_id: payload.id,
    p_reason: payload.reason,
  });
  if (error) throw toAppError(error, "Không huỷ được kỳ kết.");
  return data as { id: string; status: "voided" };
}
```
(Kiểm tra import `toAppError` đúng đường dẫn — xem đầu file `src/lib/data/safe.ts`, copy nguyên.)
- [ ] **4.4** Mock test `__tests__/period-close.test.ts` (mẫu rpc-mock — khác chain-mock của ingredient-prices):
```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPeriodClosePreview, finalizePeriodClose, voidPeriodClose } from "../period-close";

function mockRpc(result: { data?: unknown; error?: { message: string } | null }) {
  return {
    rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })),
  } as unknown as SupabaseClient;
}

describe("period-close data layer", () => {
  it("preview trả object + gọi đúng RPC", async () => {
    const sb = mockRpc({ data: { period_start: "2026-06-01", profit: 5 } });
    const out = await loadPeriodClosePreview(sb);
    expect(out.period_start).toBe("2026-06-01");
    expect((sb.rpc as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("period_close_preview");
  });
  it("finalize map đúng tham số p_*", async () => {
    const sb = mockRpc({ data: { id: "x", draw_total: 100 } });
    await finalizePeriodClose(sb, { closeDate: "2026-06-12", drawCash: 70, drawTransfer: 30 });
    expect(sb.rpc).toHaveBeenCalledWith("finalize_period_close", {
      p_close_date: "2026-06-12", p_draw_cash: 70, p_draw_transfer: 30, p_note: null,
    });
  });
  it("lỗi → throw AppError message fallback", async () => {
    const sb = mockRpc({ error: { message: "boom" } });
    await expect(voidPeriodClose(sb, { id: "x", reason: "huỷ thử nghiệm" })).rejects.toThrow();
  });
});
```
- [ ] **4.5** `npx vitest run` toàn bộ PASS; commit `git add src; git commit -m "feat(period-close): data layer + float-split (TDD)"`

### Task 5: Hooks (keys + queries + mutations)

**Files:** Modify `src/hooks/queries/keys.ts`, `src/hooks/queries/index.ts`; Create `src/hooks/queries/use-period-close-queries.ts`, `src/hooks/mutations/use-period-close-mutations.ts`

- [ ] **5.1** `keys.ts` thêm:
```ts
periodClosePreview: () => ["period-close", "preview"] as const,
periodCloses: () => ["period-close", "list"] as const,
```
- [ ] **5.2** `use-period-close-queries.ts` (mẫu `use-safe-queries.ts`):
```ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queryKeys } from "./keys";
import { loadPeriodClosePreview, loadPeriodCloses } from "@/lib/data";

export function usePeriodClosePreviewQuery(supabase: SupabaseClient | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.periodClosePreview(),
    queryFn: () => loadPeriodClosePreview(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 30_000,
  });
}

export function usePeriodClosesQuery(supabase: SupabaseClient | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.periodCloses(),
    queryFn: () => loadPeriodCloses(supabase!),
    enabled: enabled && !!supabase,
    staleTime: 60_000,
  });
}
```
Export thêm trong `src/hooks/queries/index.ts` (theo format file đó).
- [ ] **5.3** `use-period-close-mutations.ts` (mẫu `use-safe-mutations.ts` — null-guard + invalidate):
```ts
"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queryKeys } from "@/hooks/queries/keys";
import { finalizePeriodClose, voidPeriodClose } from "@/lib/data";

function useInvalidatePeriodClose() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.periodClosePreview() });
    qc.invalidateQueries({ queryKey: queryKeys.periodCloses() });
    qc.invalidateQueries({ queryKey: queryKeys.safeBalance() });
    qc.invalidateQueries({ queryKey: ["safe", "transactions"] });
    qc.invalidateQueries({ queryKey: ["cash-flow-overview"] });
  };
}

export function useFinalizePeriodClose(supabase: SupabaseClient | null) {
  const invalidate = useInvalidatePeriodClose();
  return useMutation({
    mutationFn: (p: { closeDate: string; drawCash: number; drawTransfer: number; note?: string }) => {
      if (!supabase) throw new Error("Chưa sẵn sàng.");
      return finalizePeriodClose(supabase, p);
    },
    onSuccess: invalidate,
  });
}

export function useVoidPeriodClose(supabase: SupabaseClient | null) {
  const invalidate = useInvalidatePeriodClose();
  return useMutation({
    mutationFn: (p: { id: string; reason: string }) => {
      if (!supabase) throw new Error("Chưa sẵn sàng.");
      return voidPeriodClose(supabase, p);
    },
    onSuccess: invalidate,
  });
}
```
- [ ] **5.4** `npx tsc --noEmit` sạch; commit `git commit -am "feat(period-close): hooks queries + mutations"`

### Task 6: Modal kết kỳ

**Files:** Create `src/features/period-close/period-close-modal.tsx`

Cấu trúc (mẫu `withdraw-safe-modal.tsx` — copy bố cục, đổi logic):
- Props `{ open, onOpenChange, preview: PeriodClosePreview }`.
- State: `floatStr` (mặc định `"0"` → rút hết), `cashStr`/`transferStr` (auto từ `drawFromFloat`), `note`.
- Khi sửa float → `drawFromFloat(balances, float)` set lại 2 ô; khi sửa 1 ô quỹ → ô kia bù = `max(0, drawTotal − v)` và float = `total − (cash+transfer)` (hiển thị readonly dòng "Để lại: X").
- Validate bằng `isFundSplitValid(split, drawTotal, preview.balance_cash, preview.balance_transfer)` + `drawTotal ≥ 0`. Cho phép rút 0 (chỉ chốt sổ) — hiện cảnh báo nhẹ "Không rút — chỉ ghi snapshot kỳ".
- Summary box: "Kỳ DD/MM–DD/MM · Lợi nhuận X · Rút Y (mặt A + CK B) · Để lại Z".
- TextField đều `inputMode="numeric"` h-12 text-base (mobile ≥16px); ModalActions: Huỷ + Button primary "Kết toán kỳ" loading theo mutation.
- Submit: `finalizeM.mutate({ closeDate: todayInVN(), drawCash, drawTransfer, note })` (import `todayInVN` từ `@/lib/datetime`); onSuccess → toast success + đóng; onError → toast `error.message`.

- [ ] **6.1** Viết file theo mô tả trên (đọc `withdraw-safe-modal.tsx` trước để giữ đúng idiom — MoneyInput/TextField/helper formatVND).
- [ ] **6.2** `npx tsc --noEmit` sạch; commit.

### Task 7: View + lịch sử + void

**Files:** Create `src/features/period-close/period-close-view.tsx`

- Hooks: `useSupabase`, `usePeriodClosePreviewQuery(supabase, role === "owner")`, `usePeriodClosesQuery`, `useVoidPeriodClose`, `useToast`.
- Layout (mẫu `cash-flow-view.tsx` — Card + grid):
  1. **Card "Kỳ hiện tại"**: dòng "Từ {dd/mm} đến nay ({n} ngày — `countDaysInclusive` từ `@/lib/period-math`)"; 4 KPI (Doanh thu / Chi phí / Lương / **Lợi nhuận** — formatVND, profit màu success/danger theo dấu); dòng "Số dư quỹ: mặt X · CK Y · **tổng Z**"; Button primary "Kết toán kỳ" mở modal (disabled khi `!preview.can_close` với note "Đã kết kỳ hôm nay — huỷ lần gần nhất nếu muốn kết lại").
  2. **Chi tiết kỳ**: `<CashFlowChart byDay={preview.by_day} selectedDate={sel} onSelectDate={setSel} />` + `<ExpenseBreakdownTable rows={preview.expense_breakdown} selectedDate={sel} onClearDate={() => setSel(null)} />` + `<LunarCalendarWidget start={preview.period_start} end={preview.period_end} />`.
  3. **Card "Lịch sử kết kỳ"**: map `closes` → dòng: khoảng kỳ, profit, draw_total, closing_total, Badge `voided` = "Đã huỷ" neutral / `final` = "Hoàn tất" success; dòng `final` đầu tiên (gần nhất) có IconButton "Huỷ" → modal nhỏ nhập lý do (TextField, validate ≥5 ký tự) → `voidM.mutate`. Empty state: "Chưa kết kỳ lần nào". Cuối card 1 dòng `text-xs text-muted` (codex [critical] — giới hạn đã chấp nhận): "Snapshot chốt tại thời điểm kết — sửa dữ liệu quá khứ không tự cập nhật; muốn làm lại, huỷ kỳ gần nhất rồi kết lại."
- Loading/error states theo mẫu các view khác (query.isPending → skeleton/Card "Đang tải", isError → AlertBanner).

- [ ] **7.1** Viết view; **7.2** tsc sạch; commit.

### Task 8: Nav + icon + wiring page.tsx

**Files:** Modify `src/components/ui/icons.tsx`, `src/features/navigation/navigation.ts`, `src/app/page.tsx`; kiểm tra `src/features/navigation/__tests__/navigation.test.ts`

- [ ] **8.1** `icons.tsx`: import `HandCoins` từ lucide-react, thêm `handCoins: HandCoins,` (comment `// Phase 7 — period close`).
- [ ] **8.2** `navigation.ts`:
  - `ViewKey` += `| "period-close"`.
  - `NAV_ITEMS` chèn sau dòng `safe`: `{ key: "period-close", label: "Kết toán kỳ", icon: "handCoins", roles: ["owner"], group: "cashflow" },`
  - `DEFAULT_SIDEBAR_BY_ROLE.owner`: chèn `"period-close"` sau `"safe"`.
  - `MOBILE_TAB_PREFERENCE.owner`: thêm `"period-close"` SAU `"cashflow"` (không lọt top-4 mặc định; vẫn chọn được qua Tuỳ chỉnh tab).
- [ ] **8.3** `page.tsx`: import `PeriodCloseView`; thêm `{view === "period-close" && <PeriodCloseView role={account.role} />}` cạnh block safe/cashflow.
- [ ] **8.4** `npx vitest run` — sửa navigation test nếu assert mảng đầy đủ (chỉ thêm phần tử mới vào expected, KHÔNG đổi thứ tự cũ); tsc sạch. Commit.

### Task 9: Verify tổng + PR

- [ ] **9.1** `npx tsc --noEmit` + `npx vitest run` + `node scripts/pgtap-run.mjs` (full suite) — tất cả PASS.
- [ ] **9.2** Browser (chrome-devtools, dev 3009 — KHÔNG build):
  - Đăng nhập owner@chill.local → sidebar có "Kết toán kỳ" (desktop 1280) + nằm trong drawer "Thêm" trên 375px; staff KHÔNG thấy.
  - Mở view: KPI khớp màn Dòng tiền cùng range; chart/breakdown/lunar render; 375px không tràn ngang (`document.scrollingElement.scrollWidth === 375`... thực tế đo `main`).
  - Kết thử trên dev DB: bấm Kết toán kỳ, float 500k → modal tách quỹ đúng (CK rút trước); submit → toast; Sổ quỹ có dòng badge "Rút lợi nhuận"; **màn Dòng tiền net KHÔNG đổi** (so trước/sau); dashboard không thêm chi phí; `analytics.daily_cashflow` hôm nay có `safe_draw_owner` đúng số (query psql).
  - **Huỷ kỳ test vừa tạo** (lý do ≥5 ký tự) → số dư quỹ hồi đủ, lịch sử hiện "Đã huỷ". ⚠️ BẮT BUỘC void xong mới chạy lại pgTAP (290/292 finalize theo ngày hôm nay sẽ bị "Đã có kỳ kết" nếu còn kỳ final của test tay) — và dev DB không bị dính sổ sách test.
  - Toast/console sạch lỗi.
- [ ] **9.3** Docs: `docs/integrations/n8n-analytics-views.md` — bảng §2 thêm dòng `safe_draw_owner` ("Rút lợi nhuận owner_draw — tính vào total_out, KHÔNG vào daily_pnl") + cập nhật mô tả `total_in/total_out`; `database/README.md` nếu liệt kê RPC/tests thì bổ sung (đối chiếu trước).
- [ ] **9.4** PR:
```powershell
git push -u origin claude/period-close
# PR body viết ra file tạm pr-body.md (PS 5.1 — không dùng chuỗi có dấu ngoặc kép inline)
gh pr create --base main --title "feat(period-close): ket toan ky + owner_draw khong tinh chi phi" --body-file pr-body.md
```
PR body: mục tiêu, bất biến #1 (owner_draw không expenses + regression test 291), schema/RPC mới, dual-write checklist (001/002/003 + migration), test count, screenshot view. Chờ CI 4/4 xanh (`gh pr checks <N> --watch` qua PowerShell). **KHÔNG merge** — chờ user "ok" theo flow phiên trước (sau merge: tag v4.3.0 + verify GHCR digest).

## Verification tổng thể (định nghĩa "xong")

1. pgTAP: 4 file mới PASS + toàn suite cũ PASS (CI pgtap = DB sạch chạy 001→003 + migrations → xác nhận đường "DB mới"; dev DB local = đường "DB cũ/retrofit").
2. Vitest: float-split 5 test + data layer 3 test + navigation cập nhật — PASS, coverage gate src/lib không tụt.
3. Regression sống còn: test 291 + kiểm tay trên dev (cash_flow_overview net trước/sau owner_draw bằng nhau).
4. tsc sạch; 375px không tràn; staff không thấy view/đọc được bảng.
5. CI 4/4 xanh trên PR.

## Rủi ro & lưu ý cho implementer

- **Thứ tự trong 001**: `period_closes` phải nằm SAU `cash_close_reports`/`safe_transactions` (FK + alter), TRƯỚC mọi tham chiếu `period_close_id`. Migration cũng giữ thứ tự đó.
- `cash_flow_overview` KHÔNG có trong `002_functions.sql` (chỉ ở migration 2026-05-28-e) — preview gọi runtime nên không sao trên DB mới? **CÓ SAO**: DB mới chạy 001/002/003 trước migrations → lúc CREATE `period_close_preview` thì `cash_flow_overview` chưa tồn tại — nhưng plpgsql chỉ resolve khi CHẠY, nên CREATE vẫn ok; đến lúc gọi thật thì migration 05-28 đã áp. An toàn. (pgTAP CI áp đủ migrations trước khi test — xác nhận trong ci.yml nếu nghi ngờ.)
- pgTAP fixture: nếu `safe_adjust` signature khác giả định → grep 002 và chỉnh; tính lại expected số học ở 290 assertion 10.
- Khi sửa expected trong test: LUÔN tính tay từ fixture, không "chạy rồi chép số".
- PS 5.1: heredoc commit không chứa `"`; PR body luôn `--body-file`.
- KHÔNG đụng `analytics` views trong PR này (owner_draw cố ý nằm ngoài daily_pnl/daily_cashflow; cash_position tự đúng).
