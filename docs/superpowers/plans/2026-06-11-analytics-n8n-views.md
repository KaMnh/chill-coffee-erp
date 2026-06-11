# Analytics Data Surface for n8n — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schema `analytics` + 4 view đọc-only (`daily_pnl`, `daily_cashflow`, `cash_position`, `cash_variance`) cho n8n PULL qua PostgREST bằng service_role key.

**Architecture:** Thuần DB — view SQL trên bảng nghiệp vụ gốc, `security_invoker=true`, grant chỉ cho `service_role`. Dual-write: khối SQL nằm trong canonical `002_functions.sql`/`003_rls.sql` (đánh dấu marker) và migration `2026-06-11-analytics-views.sql` được **sinh ra từ chính khối đó** (byte-identical by construction). Thêm `analytics` vào `PGRST_DB_SCHEMAS`. Không đụng app UI; chỉ sửa 1 hằng TS (POST_RESTORE_GRANTS_SQL).

**Tech Stack:** PostgreSQL 15 (Supabase self-hosted), pgTAP, PostgREST/Kong, n8n (consumer).

**Quyết định đã chốt (user + validation + codex adversarial review):**
1. n8n đọc qua REST → thêm `analytics` vào `PGRST_DB_SCHEMAS` (cần **restart** container `rest`, notify không đủ).
2. `daily_pnl.expenses_total` lọc `safe_transaction_id is null` — tránh đếm đôi dòng expense mirror do `safe_withdraw_other` tự tạo (tiền lệ `2026-05-28-e-rpcs-hide-safe-expenses.sql`).
3. `daily_cashflow` tính từ bảng nghiệp vụ gốc, KHÔNG dùng `cash_drawer_events` (live data không có dòng outflow).
4. Cột thật: `transaction_type` / `reason_category` (không phải `type`/`category` như spec viết tắt).
5. `cash_position` cắt theo `created_at` (bất biến chuỗi số dư), `daily_pnl`/`daily_cashflow` bucket theo `occurred_at` → **cố ý lệch nhau khi back-date**; cột đặt tên `safe_*_recorded` + COMMENT + ghi rõ trong data contract.
6. `cash_variance` aggregate Σ + count per `count_type` (một ngày có thể nhiều lần đếm).
7. Doanh thu = Σ `net_amount` KHÔNG lọc status — khớp convention `cash_flow_overview` hiện có.
8. Grant tường minh lặp lại trong migration (không dựa default privileges đơn thuần).

---

### Task 1: Worktree + branch

**Files:** không (git setup)

- [ ] **Step 1.1:** Tạo worktree mới từ `origin/main` (worktree hiện tại `jovial-bassi-492330` base cũ `phase-6a` — KHÔNG dùng):

```bash
cd "/c/Users/RAZER 15/Documents/Claude/Projects/Chill Coffee ERP"
git fetch origin
git worktree add ".claude/worktrees/analytics-n8n" -b feat/analytics-n8n-views origin/main
```

Expected: worktree tại `.claude/worktrees/analytics-n8n`, branch `feat/analytics-n8n-views` @ main (d102357 hoặc mới hơn).

Mọi lệnh từ đây chạy trong `WT="/c/Users/RAZER 15/Documents/Claude/Projects/Chill Coffee ERP/.claude/worktrees/analytics-n8n"`.

### Task 2: Đem spec + plan vào branch

**Files:**
- Cherry-pick: `docs/superpowers/specs/2026-06-10-analytics-data-surface-n8n-design.md`, `docs/superpowers/2026-06-10-cluster-AB-handoff.md`, `docs/superpowers/2026-06-10-code-chat-kickoff-prompt.md` (từ commit `78e7ad1` trên branch `claude/magical-lalande-d19b85`)
- Modify: spec file (append Addendum)
- Create: `docs/superpowers/plans/2026-06-11-analytics-n8n-views.md` (copy file plan này từ main checkout)

- [ ] **Step 2.1:** `git cherry-pick 78e7ad1` (nếu conflict ở handoff: lấy bản 78e7ad1 — `git checkout --theirs`).
- [ ] **Step 2.2:** Append vào cuối spec `2026-06-10-analytics-data-surface-n8n-design.md`:

```markdown
## Addendum 2026-06-11 — hiệu chỉnh sau validation + adversarial review

1. Cột thật: `safe_transactions.transaction_type` / `reason_category` (spec viết tắt `type`/`category`).
2. **Chống đếm đôi:** `safe_withdraw_other` tự tạo 1 dòng `expenses` mirror (`safe_transaction_id` not null) → `expenses_total`/`expense_out` phải lọc `safe_transaction_id is null` (tiền lệ `2026-05-28-e-rpcs-hide-safe-expenses.sql`).
3. `daily_cashflow` tính từ bảng nghiệp vụ gốc (`sales_payments`, `expenses`, `shift_payroll_records`, `safe_transactions`) — KHÔNG dùng `cash_drawer_events` (live data không ghi outflow events). `deposit_close`/`withdraw_open`/`adjustment`/`initial_setup` loại khỏi cashflow (luân chuyển nội bộ / vốn / bù trừ void).
4. REST: thêm `analytics` vào `PGRST_DB_SCHEMAS` (supabase/.env, supabase/.env.example, deploy/dockge/.env.example + prod .env thủ công). Đổi env phải **restart container `rest`** — `notify pgrst` không đủ. n8n gọi với header `Accept-Profile: analytics`.
5. **Ngữ nghĩa ngày cố ý lệch:** `daily_pnl`/`daily_cashflow` bucket theo `occurred_at` (nhãn ngày user, back-date được); `cash_position` cắt theo `created_at` (chuỗi số dư as-recorded) → cột tên `safe_cash_recorded`/`safe_transfer_recorded`. Rút back-date sẽ vào P&L của ngày nhãn nhưng KHÔNG đổi position lịch sử.
6. `cash_variance`: một ngày có thể nhiều lần đếm cùng loại → Σ difference + count per `count_type`; sum để NULL khi không có lần đếm (0 ≠ không đếm).
7. Doanh thu = Σ `net_amount` không lọc status (khớp `cash_flow_overview`).
8. View `security_invoker=true`; grant chỉ `service_role`, lặp tường minh trong migration. Sau restore backup cần chạy lại migrator nếu dump không chứa schema analytics.
```

- [ ] **Step 2.3:** Copy file plan này vào `$WT/docs/superpowers/plans/2026-06-11-analytics-n8n-views.md`.
- [ ] **Step 2.4:** Commit:

```bash
git add docs/ && git commit -m "docs(analytics): spec n8n data surface + addendum hiệu chỉnh + plan"
```

### Task 3: pgTAP test 270 (RED trước)

**Files:**
- Create: `database/tests/270_analytics_views.sql`

- [ ] **Step 3.1:** Viết test đầy đủ (fixtures tự seed, BEGIN/ROLLBACK — chạy an toàn trên DB local sống):

```sql
-- =============================================================================
-- pgTAP: analytics schema — 4 view cho n8n (daily_pnl / daily_cashflow /
-- cash_position / cash_variance) + grants service_role-only + security_invoker
-- =============================================================================
begin;
select plan(20);

-- ---------- fixtures (rollback ở cuối) ----------
insert into public.employees (id, name)
values ('00000000-0000-4000-8000-00000000e001', 'NV Test Analytics');

insert into public.sales_orders (id, kiotviet_invoice_id, purchase_at, business_date, net_amount)
values ('00000000-0000-4000-8000-0000000000o1', 'TEST-ANL-1',
        timestamptz '2026-06-01 09:30+07', date '2026-06-01', 100000);

insert into public.sales_payments (sales_order_id, payment_method, amount) values
  ('00000000-0000-4000-8000-0000000000o1', 'cash', 60000),
  ('00000000-0000-4000-8000-0000000000o1', 'bank_transfer', 40000);

-- safe ledger: 2 quỹ, chuỗi balance_after theo created_at; S4 là rút BACK-DATE
insert into public.safe_transactions
  (id, transaction_type, amount, balance_after, fund, reason_category, occurred_at, created_at) values
  ('00000000-0000-4000-8000-0000000000s1', 'initial_setup',  500000, 500000, 'cash',     null,
     timestamptz '2026-06-01 08:00+07', timestamptz '2026-06-01 08:00+07'),
  ('00000000-0000-4000-8000-0000000000s2', 'initial_setup',  300000, 300000, 'transfer', null,
     timestamptz '2026-06-01 08:00:01+07', timestamptz '2026-06-01 08:00:01+07'),
  ('00000000-0000-4000-8000-0000000000s3', 'withdraw_other', -20000, 480000, 'cash',     'utilities',
     timestamptz '2026-06-01 10:00+07', timestamptz '2026-06-01 10:00+07'),
  ('00000000-0000-4000-8000-0000000000s4', 'withdraw_other', -50000, 250000, 'transfer', 'inventory',
     timestamptz '2026-06-01 11:00+07', timestamptz '2026-06-01 11:00+07'),
  ('00000000-0000-4000-8000-0000000000s5', 'withdraw_other', -30000, 450000, 'cash',     'rent',
     timestamptz '2026-06-01 09:00+07', timestamptz '2026-06-02 09:00+07'); -- occurred 1/6, created 2/6

insert into public.expenses (business_date, description, amount, safe_transaction_id) values
  (date '2026-06-01', 'chi két quầy (đếm)', 10000, null),
  (date '2026-06-01', 'mirror rút quỹ (KHÔNG được đếm)', 20000, '00000000-0000-4000-8000-0000000000s3');

insert into public.shift_payroll_records (employee_id, business_date, total_pay)
values ('00000000-0000-4000-8000-00000000e001', date '2026-06-01', 30000);

insert into public.cash_counts (id, business_date, count_type, difference, counted_at) values
  ('00000000-0000-4000-8000-0000000000c1', date '2026-06-01', 'shift_close', -5000, timestamptz '2026-06-01 14:00+07'),
  ('00000000-0000-4000-8000-0000000000c2', date '2026-06-01', 'shift_close', -5000, timestamptz '2026-06-01 18:00+07'),
  ('00000000-0000-4000-8000-0000000000c3', date '2026-06-01', 'day_close',       0, timestamptz '2026-06-01 22:00+07'),
  ('00000000-0000-4000-8000-0000000000c4', date '2026-06-01', 'day_close',       0, timestamptz '2026-06-01 21:00+07');

insert into public.cash_close_reports (business_date, cash_count_id, report_status, leave_for_next_day) values
  (date '2026-06-01', '00000000-0000-4000-8000-0000000000c3', 'final',  200000),
  (date '2026-06-01', '00000000-0000-4000-8000-0000000000c4', 'voided', 999999); -- phải bị loại

insert into public.safe_counts (total_physical, expected_balance, difference, counted_at)
values (480000, 481000, -1000, timestamptz '2026-06-01 20:00+07');

-- ---------- 1-9: tồn tại + security_invoker ----------
select has_schema('analytics', 'schema analytics tồn tại');
select has_view('analytics', 'daily_pnl',       'view daily_pnl tồn tại');
select has_view('analytics', 'daily_cashflow',  'view daily_cashflow tồn tại');
select has_view('analytics', 'cash_position',   'view cash_position tồn tại');
select has_view('analytics', 'cash_variance',   'view cash_variance tồn tại');

create or replace function pg_temp.has_security_invoker(p_view text) returns boolean
language sql stable as $fn$
  select coalesce(
    array_to_string(reloptions, ',') like '%security_invoker=on%' or
    array_to_string(reloptions, ',') like '%security_invoker=true%',
    false
  )
  from pg_class
  where relname = p_view
    and relnamespace = 'analytics'::regnamespace
    and relkind = 'v';
$fn$;

select ok(pg_temp.has_security_invoker('daily_pnl'),      'daily_pnl: security_invoker=on');
select ok(pg_temp.has_security_invoker('daily_cashflow'), 'daily_cashflow: security_invoker=on');
select ok(pg_temp.has_security_invoker('cash_position'),  'cash_position: security_invoker=on');
select ok(pg_temp.has_security_invoker('cash_variance'),  'cash_variance: security_invoker=on');

-- ---------- 10-12: grants ----------
select ok(has_schema_privilege('service_role', 'analytics', 'USAGE'),
          'service_role có USAGE trên analytics');
select ok(not has_schema_privilege('anon', 'analytics', 'USAGE'),
          'anon KHÔNG có USAGE trên analytics');
select ok(not has_schema_privilege('authenticated', 'analytics', 'USAGE'),
          'authenticated KHÔNG có USAGE trên analytics');

-- ---------- 13-14: daily_pnl ----------
-- revenue 100k; cash/transfer 60/40; expenses 10k (mirror bị loại);
-- safe_outflow 100k (20k+50k+30k — gồm cả back-date theo occurred_at); payroll 30k
-- net = 100k − 10k − 100k − 30k = −40k
select results_eq(
  $$select revenue, revenue_cash, revenue_transfer, expenses_total,
           safe_outflow_operating, payroll_total, net_profit_cash
      from analytics.daily_pnl where business_date = date '2026-06-01'$$,
  $$values (100000::numeric, 60000::numeric, 40000::numeric, 10000::numeric,
            100000::numeric, 30000::numeric, -40000::numeric)$$,
  'daily_pnl 2026-06-01 đúng (mirror expense bị loại, back-date tính theo occurred_at)');

select is((select count(*)::int from analytics.daily_pnl where business_date = date '2026-06-02'),
          0, 'daily_pnl KHÔNG có dòng 2026-06-02 (back-date thuộc về ngày nhãn)');

-- ---------- 15-16: daily_cashflow ----------
select results_eq(
  $$select cash_in_pos, transfer_in, expense_out, payroll_out,
           safe_withdraw_inventory, safe_withdraw_other_ops, total_in, total_out, net_cashflow
      from analytics.daily_cashflow where business_date = date '2026-06-01'$$,
  $$values (60000::numeric, 40000::numeric, 10000::numeric, 30000::numeric,
            50000::numeric, 50000::numeric, 100000::numeric, 140000::numeric, -40000::numeric)$$,
  'daily_cashflow 2026-06-01 đúng');

select is(
  (select net_profit_cash from analytics.daily_pnl where business_date = date '2026-06-01'),
  (select net_cashflow from analytics.daily_cashflow where business_date = date '2026-06-01'),
  'net P&L = net cashflow trên fixture này (cross-check)');

-- ---------- 17-18: cash_position ----------
-- 1/6: cắt created_at < 2/6 00:00 VN → cash 480k (S5 back-date created 2/6 bị loại), transfer 250k,
--      drawer_leave 200k (chỉ final, KHÔNG lấy 999999 của voided) → total 930k
select results_eq(
  $$select drawer_leave, safe_cash_recorded, safe_transfer_recorded, total_position
      from analytics.cash_position where business_date = date '2026-06-01'$$,
  $$values (200000::numeric, 480000::numeric, 250000::numeric, 930000::numeric)$$,
  'cash_position 2026-06-01: as-recorded, voided report bị loại');

-- 2/6: dòng sinh từ created_at của S5 → cash 450k, transfer 250k, drawer 0 → 700k
select results_eq(
  $$select drawer_leave, safe_cash_recorded, safe_transfer_recorded, total_position
      from analytics.cash_position where business_date = date '2026-06-02'$$,
  $$values (0::numeric, 450000::numeric, 250000::numeric, 700000::numeric)$$,
  'cash_position 2026-06-02: rút back-date hiện ở ngày GHI SỔ (created_at)');

-- ---------- 19: cash_variance ----------
select results_eq(
  $$select drawer_shift_diff, drawer_shift_counts::int, drawer_dayclose_diff, drawer_dayclose_counts::int,
           drawer_spot_diff, drawer_spot_counts::int, safe_diff, safe_counts_n::int
      from analytics.cash_variance where business_date = date '2026-06-01'$$,
  $$values (-10000::numeric, 2, 0::numeric, 2, null::numeric, 0, -1000::numeric, 1)$$,
  'cash_variance 2026-06-01: Σ + count per loại; spot không đếm → NULL/0');

-- ---------- 20: service_role đọc được thật ----------
set local role service_role;
select is((select count(*)::int from analytics.daily_pnl where business_date = date '2026-06-01'),
          1, 'service_role SELECT được daily_pnl (BYPASSRLS + grants)');
reset role;

select * from finish();
rollback;
```

- [ ] **Step 3.2:** Chạy RED trên DB local (BOM-strip pipe):

```bash
perl -pe 's/\xEF\xBB\xBF//g' "$WT/database/tests/270_analytics_views.sql" | docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=0 -At
```

Expected: FAIL — `has_schema('analytics')` not ok / lỗi `schema "analytics" does not exist` ở các results_eq.

- [ ] **Step 3.3:** Commit: `git add database/tests/270_analytics_views.sql && git commit -m "test(analytics): pgTAP 270 cho 4 view n8n (RED)"`

### Task 4: Canonical — khối views trong 002, grants trong 003, mirror restore route

**Files:**
- Modify: `database/002_functions.sql` (append cuối file)
- Modify: `database/003_rls.sql` (append cuối file)
- Modify: `src/app/api/backup/restore/route.ts` (hằng POST_RESTORE_GRANTS_SQL)

- [ ] **Step 4.1:** Append vào CUỐI `database/002_functions.sql` (marker bắt buộc — dùng để sinh migration):

```sql
-- ============================================================== ANALYTICS-VIEWS-BEGIN
-- Analytics cho n8n (PULL qua PostgREST service_role, header Accept-Profile: analytics).
-- Spec: docs/superpowers/specs/2026-06-10-analytics-data-surface-n8n-design.md (+ Addendum).
-- Khối này được trích nguyên văn vào database/migrations/2026-06-11-analytics-views.sql
-- (dual-write byte-identical) — sửa ở đây thì PHẢI tái sinh migration.
-- Lưu ý ngữ nghĩa: daily_pnl/daily_cashflow bucket theo occurred_at (nhãn ngày user,
-- back-date được); cash_position cắt theo created_at (chuỗi số dư as-recorded).

create schema if not exists analytics;

drop view if exists analytics.daily_pnl cascade;
create view analytics.daily_pnl
with (security_invoker = true) as
with days as (
  select business_date from public.sales_orders
  union
  select business_date from public.expenses where safe_transaction_id is null
  union
  select business_date from public.shift_payroll_records
  union
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date
    from public.safe_transactions where transaction_type = 'withdraw_other'
),
rev as (
  select business_date, sum(net_amount) as revenue
  from public.sales_orders group by 1
),
pay as (
  select so.business_date,
         sum(sp.amount) filter (where sp.payment_method = 'cash')          as revenue_cash,
         sum(sp.amount) filter (where sp.payment_method = 'bank_transfer') as revenue_transfer
  from public.sales_payments sp
  join public.sales_orders so on so.id = sp.sales_order_id
  group by 1
),
exp as (
  select business_date, sum(amount) as expenses_total
  from public.expenses where safe_transaction_id is null group by 1
),
saf as (
  select (occurred_at at time zone 'Asia/Ho_Chi_Minh')::date as business_date,
         -sum(amount) as safe_outflow_operating
  from public.safe_transactions
  where transaction_type = 'withdraw_other'
  group by 1
),
pr as (
  select business_date, sum(total_pay) as payroll_total
  from public.shift_payroll_records group by 1
)
select d.business_date,
       coalesce(rev.revenue, 0)                as revenue,
       coalesce(pay.revenue_cash, 0)           as revenue_cash,
       coalesce(pay.revenue_transfer, 0)       as revenue_transfer,
       coalesce(exp.expenses_total, 0)         as expenses_total,
       coalesce(saf.safe_outflow_operating, 0) as safe_outflow_operating,
       coalesce(pr.payroll_total, 0)           as payroll_total,
       coalesce(rev.revenue, 0) - coalesce(exp.expenses_total, 0)
         - coalesce(saf.safe_outflow_operating, 0) - coalesce(pr.payroll_total, 0) as net_profit_cash
from days d
left join rev using (business_date)
left join pay using (business_date)
left join exp using (business_date)
left join saf using (business_date)
left join pr  using (business_date);

comment on view analytics.daily_pnl is
  'P&L cash-basis theo ngày cho n8n. expenses_total đã loại expense mirror của rút quỹ '
  '(safe_transaction_id is null). safe_outflow_operating = withdraw_other (gồm mua NL), '
  'bucket theo occurred_at (nhãn ngày, back-date được).';

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
    from public.safe_transactions where transaction_type = 'withdraw_other'
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
         -sum(amount) filter (where reason_category = 'inventory')                as safe_withdraw_inventory,
         -sum(amount) filter (where reason_category is distinct from 'inventory') as safe_withdraw_other_ops
  from public.safe_transactions
  where transaction_type = 'withdraw_other'
  group by 1
)
select d.business_date,
       coalesce(pay.cash_in_pos, 0)              as cash_in_pos,
       coalesce(pay.transfer_in, 0)              as transfer_in,
       coalesce(exp.expense_out, 0)              as expense_out,
       coalesce(pr.payroll_out, 0)               as payroll_out,
       coalesce(saf.safe_withdraw_inventory, 0)  as safe_withdraw_inventory,
       coalesce(saf.safe_withdraw_other_ops, 0)  as safe_withdraw_other_ops,
       coalesce(pay.cash_in_pos, 0) + coalesce(pay.transfer_in, 0) as total_in,
       coalesce(exp.expense_out, 0) + coalesce(pr.payroll_out, 0)
         + coalesce(saf.safe_withdraw_inventory, 0) + coalesce(saf.safe_withdraw_other_ops, 0) as total_out,
       coalesce(pay.cash_in_pos, 0) + coalesce(pay.transfer_in, 0)
         - (coalesce(exp.expense_out, 0) + coalesce(pr.payroll_out, 0)
            + coalesce(saf.safe_withdraw_inventory, 0) + coalesce(saf.safe_withdraw_other_ops, 0)) as net_cashflow
from days d
left join pay using (business_date)
left join exp using (business_date)
left join pr  using (business_date)
left join saf using (business_date);

comment on view analytics.daily_cashflow is
  'Dòng tiền vào/ra theo ngày từ bảng nghiệp vụ gốc. Loại deposit_close/withdraw_open/'
  'adjustment/initial_setup (luân chuyển nội bộ, vốn, bù trừ void). Expense mirror của '
  'rút quỹ đã loại. Bucket safe theo occurred_at.';

drop view if exists analytics.cash_position cascade;
create view analytics.cash_position
with (security_invoker = true) as
with days as (
  select business_date from public.cash_close_reports where report_status = 'final'
  union
  select (created_at at time zone 'Asia/Ho_Chi_Minh')::date from public.safe_transactions
),
drawer as (
  select business_date, leave_for_next_day
  from public.cash_close_reports
  where report_status = 'final'
)
select d.business_date,
       coalesce(drawer.leave_for_next_day, 0) as drawer_leave,
       coalesce(sc.balance_after, 0)          as safe_cash_recorded,
       coalesce(st.balance_after, 0)          as safe_transfer_recorded,
       coalesce(drawer.leave_for_next_day, 0) + coalesce(sc.balance_after, 0)
         + coalesce(st.balance_after, 0)      as total_position
from days d
left join drawer using (business_date)
left join lateral (
  select balance_after from public.safe_transactions
  where fund = 'cash'
    and created_at < ((d.business_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  order by created_at desc, id desc limit 1
) sc on true
left join lateral (
  select balance_after from public.safe_transactions
  where fund = 'transfer'
    and created_at < ((d.business_date + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh')
  order by created_at desc, id desc limit 1
) st on true;

comment on view analytics.cash_position is
  'Vị thế tiền cuối ngày. safe_*_recorded cắt theo created_at (số dư sổ cái như đã ghi) '
  '— CỐ Ý khác daily_pnl (bucket occurred_at): rút back-date vào P&L ngày nhãn nhưng '
  'không sửa position lịch sử. drawer_leave chỉ lấy report final.';

drop view if exists analytics.cash_variance cascade;
create view analytics.cash_variance
with (security_invoker = true) as
with days as (
  select business_date from public.cash_counts
  union
  select (counted_at at time zone 'Asia/Ho_Chi_Minh')::date from public.safe_counts
),
drawer as (
  select business_date,
         sum(difference) filter (where count_type = 'shift_close') as drawer_shift_diff,
         count(*)        filter (where count_type = 'shift_close') as drawer_shift_counts,
         sum(difference) filter (where count_type = 'day_close')   as drawer_dayclose_diff,
         count(*)        filter (where count_type = 'day_close')   as drawer_dayclose_counts,
         sum(difference) filter (where count_type = 'spot_audit')  as drawer_spot_diff,
         count(*)        filter (where count_type = 'spot_audit')  as drawer_spot_counts
  from public.cash_counts
  group by 1
),
safe as (
  select (counted_at at time zone 'Asia/Ho_Chi_Minh')::date as business_date,
         sum(difference) as safe_diff,
         count(*)        as safe_counts_n
  from public.safe_counts
  group by 1
)
select d.business_date,
       drawer.drawer_shift_diff,
       coalesce(drawer.drawer_shift_counts, 0)    as drawer_shift_counts,
       drawer.drawer_dayclose_diff,
       coalesce(drawer.drawer_dayclose_counts, 0) as drawer_dayclose_counts,
       drawer.drawer_spot_diff,
       coalesce(drawer.drawer_spot_counts, 0)     as drawer_spot_counts,
       safe.safe_diff,
       coalesce(safe.safe_counts_n, 0)            as safe_counts_n
from days d
left join drawer using (business_date)
left join safe   using (business_date);

comment on view analytics.cash_variance is
  'Lệch đếm két/quỹ theo ngày (tín hiệu rò rỉ). Σ + count per loại; sum NULL khi '
  'không có lần đếm (0 ≠ không đếm).';
-- ============================================================== ANALYTICS-VIEWS-END
```

- [ ] **Step 4.2:** Append vào CUỐI `database/003_rls.sql`:

```sql
-- ============================================================== ANALYTICS-GRANTS-BEGIN
-- Schema analytics: CHỈ service_role (n8n). KHÔNG grant anon/authenticated.
-- Mirror trong src/app/api/backup/restore/route.ts POST_RESTORE_GRANTS_SQL.
-- Khối này được trích nguyên văn vào migration 2026-06-11-analytics-views.sql.
grant usage on schema analytics to service_role;
grant select on all tables in schema analytics to service_role;
alter default privileges in schema analytics
  grant select on tables to service_role;
-- ============================================================== ANALYTICS-GRANTS-END
```

- [ ] **Step 4.3:** Mirror vào `src/app/api/backup/restore/route.ts`: đọc file, tìm hằng `POST_RESTORE_GRANTS_SQL`, append vào CUỐI chuỗi SQL (trước dấu đóng template literal):

```sql
create schema if not exists analytics;
grant usage on schema analytics to service_role;
grant select on all tables in schema analytics to service_role;
alter default privileges in schema analytics
  grant select on tables to service_role;
```

(Giữ nguyên format/indent của hằng hiện có. `create schema if not exists` để khối không nổ khi restore dump cũ chưa có schema.)

- [ ] **Step 4.4:** Kiểm tra backup scope: `grep -n "pg_dump\|--schema\|-n " src/app/api/backup/*/route.ts`. Nếu dump chỉ `-n public` → analytics views KHÔNG nằm trong backup → ghi chú "sau restore chạy lại db-init/migrator để tái tạo views" vào docs Task 6. Nếu dump full → grants ở 4.3 là đủ.

### Task 5: Sinh migration từ canonical (byte-identical) + áp DB local + GREEN

**Files:**
- Create: `database/migrations/2026-06-11-analytics-views.sql`

- [ ] **Step 5.1:** Sinh migration bằng trích xuất marker (KHÔNG gõ tay lại):

```bash
cd "$WT"
{
  echo "-- ============================================================================="
  echo "-- Migration: analytics schema + 4 view cho n8n + grants service_role"
  echo "-- Sinh từ khối marker trong 002_functions.sql + 003_rls.sql (dual-write)."
  echo "-- Idempotent: drop view if exists + create; chạy lại an toàn."
  echo "-- ============================================================================="
  sed -n '/ANALYTICS-VIEWS-BEGIN/,/ANALYTICS-VIEWS-END/p'   database/002_functions.sql
  sed -n '/ANALYTICS-GRANTS-BEGIN/,/ANALYTICS-GRANTS-END/p' database/003_rls.sql
} > database/migrations/2026-06-11-analytics-views.sql
```

- [ ] **Step 5.2:** Verify byte-identical: trích lại 2 khối từ migration và md5 so với khối canonical — 2 cặp md5 phải trùng:

```bash
sed -n '/ANALYTICS-VIEWS-BEGIN/,/ANALYTICS-VIEWS-END/p' database/migrations/2026-06-11-analytics-views.sql | md5sum
sed -n '/ANALYTICS-VIEWS-BEGIN/,/ANALYTICS-VIEWS-END/p' database/002_functions.sql | md5sum
sed -n '/ANALYTICS-GRANTS-BEGIN/,/ANALYTICS-GRANTS-END/p' database/migrations/2026-06-11-analytics-views.sql | md5sum
sed -n '/ANALYTICS-GRANTS-BEGIN/,/ANALYTICS-GRANTS-END/p' database/003_rls.sql | md5sum
```

- [ ] **Step 5.3:** Áp lên DB local 2 LẦN (idempotency):

```bash
for i in 1 2; do
  perl -pe 's/\xEF\xBB\xBF//g' database/migrations/2026-06-11-analytics-views.sql |
    docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q || echo "FAIL lần $i"
done
```

Expected: 2 lần đều sạch, không ERROR.

- [ ] **Step 5.4:** Chạy lại 270 → GREEN (lệnh như Step 3.2, ON_ERROR_STOP=1). Expected: `1..20`, 20 ok, 0 not-ok.
- [ ] **Step 5.5:** Chạy TOÀN BỘ suite pgTAP trên DB sạch (kỹ thuật pgtap_clean + vòng lặp crash-aware đã dùng ở PR #26/#28 — đếm cả `ERROR:` lẫn lệch plan/ok). Expected: 36/36 file pass (35 cũ + 270), 0 crash.
- [ ] **Step 5.6:** Prod-sim (bài học PR #28): seed DB throwaway từ `git archive v4.1.27 database`, rồi chạy đúng trình tự migrator bản mới (001→002→003 + toàn bộ migrations alphabetical). Expected: 0 error; sau đó `select count(*) from pg_views where schemaname='analytics'` = 4.
- [ ] **Step 5.7:** Commit:

```bash
git add database/ src/app/api/backup/restore/route.ts
git commit -m "feat(analytics): schema + 4 view n8n (dual-write 002/003 + migration) — pgTAP 270 GREEN"
```

### Task 6: PGRST_DB_SCHEMAS + REST smoke + docs

**Files:**
- Modify: `supabase/.env` (local sống), `supabase/.env.example`, `deploy/dockge/.env.example` — dòng `PGRST_DB_SCHEMAS`
- Create: `docs/integrations/n8n-analytics-views.md`

- [ ] **Step 6.1:** Sửa cả 3 file: `PGRST_DB_SCHEMAS=public,storage,graphql_public` → `public,storage,graphql_public,analytics`.
- [ ] **Step 6.2:** ⚠️ TRƯỚC khi recreate container rest: đối chiếu env đang chạy với file (.env local từng DRIFT — bài học key Kong):

```bash
docker exec $(docker ps --format '{{.Names}}' | grep -E 'supabase.*rest|rest.*supabase' | head -1) env | grep -E 'PGRST_(DB_SCHEMAS|JWT_SECRET)' 
grep -E 'PGRST_(DB_SCHEMAS|JWT_SECRET)' supabase/.env
```

Nếu JWT_SECRET trong file ≠ container → sync giá trị container vào file TRƯỚC, rồi mới tiếp.

- [ ] **Step 6.3:** Recreate rest: `cd supabase && docker compose up -d rest` (đợi healthy). 
- [ ] **Step 6.4:** REST smoke qua Kong (key service_role lấy từ `docker exec supabase-kong env | grep SERVICE`):

```bash
curl -s "http://localhost:8000/rest/v1/daily_pnl?limit=3" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Accept-Profile: analytics"
```

Expected: HTTP 200, JSON array (dữ liệu thật local). Thêm negative check: cùng call với ANON key → 401/permission denied.

- [ ] **Step 6.5:** Viết `docs/integrations/n8n-analytics-views.md` — Hợp đồng dữ liệu: 4 view + từng cột + ngữ nghĩa (đặc biệt: occurred_at vs created_at khi back-date; mirror-expense đã loại; sum NULL vs 0 ở variance; các transaction_type bị loại khỏi cashflow); ví dụ call REST (header `Accept-Profile: analytics`, filter `business_date=gte.2026-06-01&business_date=lte.2026-06-30`, order, limit); **Ops note prod**: sửa `PGRST_DB_SCHEMAS` trong `.env` prod (Dockge) thêm `,analytics` rồi `docker compose up -d rest` (restart bắt buộc — notify không đủ); note restore backup (kết quả Step 4.4).
- [ ] **Step 6.6:** Commit: `git add supabase/.env.example deploy/dockge/.env.example docs/integrations/ && git commit -m "feat(analytics): expose schema qua PGRST + data contract n8n"` (KHÔNG commit `supabase/.env` — kiểm tra nó có bị git track không; nếu tracked thì xem diff cẩn thận chỉ commit dòng PGRST nếu repo vốn track file này).

### Task 7: Verify chuẩn repo + PR

- [ ] **Step 7.1:** `npm test` (Vitest) — Expected: pass, coverage gate không đổi (không đụng src/lib).
- [ ] **Step 7.2:** `npx tsc --noEmit` — Expected: 0 error (restore route chỉ đổi string).
- [ ] **Step 7.3:** ⚠️ KHÔNG chạy `npm run build` khi dev server 3009 đang chạy.
- [ ] **Step 7.4:** Push + tạo PR vào `main`: tiêu đề `feat(analytics): mặt dữ liệu phân tích cho n8n — schema analytics + 4 view (P&L cash-basis, cashflow, position, variance)`. Body: tóm tắt + bảng evidence (pgTAP 20/20, suite 36 file, idempotent ×2, prod-sim PASS, REST smoke 200/401, vitest+tsc sạch) + ops note prod.
- [ ] **Step 7.5:** Đợi CI verify xanh (typecheck → vitest+pgtap → build). Báo user kết quả + chờ quyết định merge/tag (pattern: merge xong tag v4.1.28 + :latest).

## Self-review đã chạy

- Spec coverage: 4 view ✓, grants ✓, PGRST ✓ (Addendum 4), pgTAP ✓ (270), data contract doc ✓ (6.5), COGS hoãn ✓ (không làm), n8n pull-only ✓ (không push/webhook).
- Codex findings: F1/F3 = chính là Task 4-5/Task 3; F2 = Task 6 (+restart); F4 = naming `_recorded` + COMMENT + test 17-18 + doc; F5 = Σ+count + test 19; F6 = grants lặp trong migration ✓.
- Type consistency: tên cột view trong test 270 khớp từng cột với SQL Task 4 (đã đối chiếu thủ công).
- Placeholder: không còn TBD; 2 nhánh điều kiện (4.4 backup scope, 6.2 env drift) có lệnh kiểm tra cụ thể.
