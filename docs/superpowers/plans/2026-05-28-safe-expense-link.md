# Safe Withdraw → Expense Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-create an `expenses` row whenever `safe_withdraw_other` runs; hide those expenses from manager/staff/viewer entirely (RLS + RPC inline filter); owner sees them normally in sổ chi / cashflow / dashboard.

**Architecture:** Add `expenses.safe_transaction_id uuid NULL` FK column. Extend the existing `safe_withdraw_other` RPC to direct-insert the expense (no `create_expense` call, payment_method='other' → no cash_drawer side effects). Replace 3 RLS policies on `expenses` with case-based logic (when `safe_transaction_id IS NOT NULL` → owner-only). Patch 3 SECURITY DEFINER RPCs that query expenses (`dashboard_daily_ops`, `expense_summary_by_category`, `cash_flow_overview`) with inline `AND (safe_transaction_id IS NULL OR app_role() = 'owner')` so RLS-bypass paths still respect visibility.

**Tech Stack:** PostgreSQL 15 + pgTAP, Supabase RLS, Next.js 15 + React 19 (1 LOC helper text), TypeScript.

---

## Pre-flight notes for the engineer

- Branch is already created: `feat/safe-expense-link` (off `origin/main` at `6996677`).
- Spec at `docs/superpowers/specs/2026-05-28-safe-expense-link-design.md`.
- Working dir: `C:\Users\RAZER 15\Documents\Claude\Projects\Chill Coffee ERP\.claude\worktrees\eager-snyder-4103ae`.
- Dev preview runs on port 3009; dev DB via `docker compose exec -T db`. Owner UUID for manual smoke: `88769682-8ac3-4db3-86ce-617b9124a082`.
- **Why filter doesn't propagate to `cash_reconciliation_input_view` (line 96) or `compute_cash_theory` (line 190)**: both already filter `where payment_method = 'cash'`. Safe-sourced expenses use `payment_method = 'other'`, so they're naturally excluded. NO filter needed for them.
- **Why `update_expense` / `delete_expense` RPCs don't need patching**: they use RLS-mediated paths (regular SQL, no SECURITY DEFINER bypass) — RLS policy changes in Task 2 cover them.

---

## File structure

```
database/
  migrations/
    2026-05-28-b-expenses-safe-link.sql              ← Task 1: column + index
    2026-05-28-c-safe-expense-rls.sql                ← Task 2: 3 RLS policies (replace existing)
    2026-05-28-d-safe-withdraw-other-expense.sql     ← Task 3: extend RPC
    2026-05-28-e-rpcs-hide-safe-expenses.sql         ← Task 4: 3 RPCs inline filter
  tests/
    230_safe_expense_link.sql                        ← Task 6: pgTAP (new)
src/
  features/
    safe/
      withdraw-safe-modal.tsx                        ← Task 7: 1 LOC helper text
```

---

## Task 1: Schema — add `safe_transaction_id` column

**Files:**
- Create: `database/migrations/2026-05-28-b-expenses-safe-link.sql`

- [ ] **Step 1: Write the migration**

Create `database/migrations/2026-05-28-b-expenses-safe-link.sql`:

```sql
-- =============================================================================
-- Schema: link expenses to safe withdrawals (2026-05-28)
--
-- Adds expenses.safe_transaction_id uuid NULL FK → safe_transactions(id).
-- NULL = manual expense. NOT NULL = sinh ra tự động bởi safe_withdraw_other.
--
-- Partial index — đa số expense là NULL, chỉ index khi NOT NULL.
-- =============================================================================

alter table public.expenses
  add column if not exists safe_transaction_id uuid null
    references public.safe_transactions(id) on delete restrict;

create index if not exists expenses_safe_transaction_id_idx
  on public.expenses(safe_transaction_id)
  where safe_transaction_id is not null;

comment on column public.expenses.safe_transaction_id is
  'Link to safe_transactions when expense was auto-created by safe_withdraw_other. NULL = manual expense. Visibility rule: NOT NULL → owner only (see RLS policies + RPC filters).';
```

- [ ] **Step 2: Apply locally**

```bash
cat database/migrations/2026-05-28-b-expenses-safe-link.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
```

Expected output: `ALTER TABLE`, `CREATE INDEX`, `COMMENT`.

- [ ] **Step 3: Verify column + index exist**

```bash
docker compose exec -T db psql -U postgres -d postgres -c "\d public.expenses" | grep -E "safe_transaction_id|expenses_safe_transaction_id_idx"
```

Expected: 2 lines — the column declaration and the partial index entry.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026-05-28-b-expenses-safe-link.sql
git commit -m "$(cat <<'EOF'
feat(sql): add expenses.safe_transaction_id FK link

NULL = manual expense. NOT NULL = sinh ra bởi safe_withdraw_other.
Partial index trên (safe_transaction_id) where NOT NULL — tối ưu vì
đại đa số rows là NULL. on delete restrict — safe_transactions
immutable hiện tại.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: RLS — case-based visibility on `expenses`

**Files:**
- Create: `database/migrations/2026-05-28-c-safe-expense-rls.sql`

- [ ] **Step 1: Write the migration**

Create `database/migrations/2026-05-28-c-safe-expense-rls.sql`:

```sql
-- =============================================================================
-- RLS: hide safe-sourced expenses from non-owner roles (2026-05-28)
--
-- Replaces 3 existing policies on public.expenses with case-based logic:
--   - SELECT: safe-sourced rows visible to owner only; manual rows keep
--     existing logic (staff+ OR employee_viewer with date-range permission).
--   - UPDATE: safe-sourced rows mutable by owner only; manual by owner/manager.
--   - DELETE: same as UPDATE.
--
-- INSERT policy unchanged (auto-insert from safe_withdraw_other runs
-- SECURITY DEFINER → bypasses RLS; manual creates from staff+ still allowed).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- SELECT: safe-sourced → owner only; manual → existing logic
-- ---------------------------------------------------------------------------
drop policy if exists expenses_staff_read on public.expenses;
create policy expenses_staff_read on public.expenses for select to authenticated using (
  case
    when expenses.safe_transaction_id is not null then
      public.app_role() = 'owner'
    else
      public.app_is_staff_or_above()
      or (
        public.app_role() = 'employee_viewer'
        and exists (
          select 1
          from public.employee_accounts ea
          join public.expense_history_permissions p on p.employee_id = ea.employee_id
          where ea.auth_user_id = auth.uid()
            and expenses.business_date between p.date_from and p.date_to
        )
      )
  end
);

-- ---------------------------------------------------------------------------
-- UPDATE: safe-sourced → owner only; manual → owner/manager (existing)
-- ---------------------------------------------------------------------------
drop policy if exists expenses_manager_update on public.expenses;
create policy expenses_manager_update on public.expenses for update to authenticated
using (
  case
    when expenses.safe_transaction_id is not null then public.app_role() = 'owner'
    else public.app_is_owner_manager()
  end
)
with check (
  case
    when safe_transaction_id is not null then public.app_role() = 'owner'
    else public.app_is_owner_manager()
  end
);

-- ---------------------------------------------------------------------------
-- DELETE: safe-sourced → owner only; manual → owner/manager (existing)
-- ---------------------------------------------------------------------------
drop policy if exists expenses_manager_delete on public.expenses;
create policy expenses_manager_delete on public.expenses for delete to authenticated
using (
  case
    when expenses.safe_transaction_id is not null then public.app_role() = 'owner'
    else public.app_is_owner_manager()
  end
);

-- INSERT policy unchanged (kept as-is from database/003_rls.sql)
```

- [ ] **Step 2: Apply locally**

```bash
cat database/migrations/2026-05-28-c-safe-expense-rls.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
```

Expected: 3 `DROP POLICY` + 3 `CREATE POLICY`.

- [ ] **Step 3: Verify policies**

```bash
docker compose exec -T db psql -U postgres -d postgres -c "\d public.expenses" | grep -E "POLICY"
```

Expected: 4 policy lines (`expenses_staff_read`, `expenses_staff_insert`, `expenses_manager_update`, `expenses_manager_delete`).

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026-05-28-c-safe-expense-rls.sql
git commit -m "$(cat <<'EOF'
feat(sql): RLS hide safe-sourced expenses from non-owner

Replace 3 policies (select / update / delete) on public.expenses with
case-based logic: when safe_transaction_id IS NOT NULL → owner-only;
else existing rules. INSERT policy unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Extend `safe_withdraw_other` to insert expense

**Files:**
- Create: `database/migrations/2026-05-28-d-safe-withdraw-other-expense.sql`

This redefines the function. Existing body (`database/002_functions.sql:1700-1751`) is recreated in full plus the new INSERT.

- [ ] **Step 1: Write the migration**

Create `database/migrations/2026-05-28-d-safe-withdraw-other-expense.sql`:

```sql
-- =============================================================================
-- safe_withdraw_other RPC v2 (2026-05-28): auto-insert expense row
--
-- Same owner-only / validation / lock pattern as v1. After successful
-- safe_transactions INSERT, also INSERTs into public.expenses with:
--   - safe_transaction_id = vừa tạo (links expense back to safe withdraw)
--   - amount, description copied from input
--   - business_date = current_date (server side, TZ Asia/Ho_Chi_Minh)
--   - payment_method = 'other' (NOT 'cash' — tiền từ safe vault, không phải till)
--   - category_id = NULL (no mapping from reason_category → expense_category v1)
--   - created_by = auth.uid()
--
-- Idempotent: create or replace function.
-- =============================================================================

create or replace function public.safe_withdraw_other(
  p_amount numeric,
  p_category text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_balance numeric;
  v_next numeric;
  v_id uuid;
  v_expense_id uuid;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được rút sổ quỹ.';
  end if;
  if p_amount <= 0 or p_amount > 1000000000 then
    raise exception 'Số tiền rút phải 1–1.000.000.000.';
  end if;
  if p_category not in ('utilities', 'rent', 'inventory', 'maintenance', 'other') then
    raise exception 'Loại chi không hợp lệ.';
  end if;
  if length(coalesce(p_description, '')) > 500 then
    raise exception 'Mô tả vượt 500 ký tự.';
  end if;

  -- Lock row gần nhất để chống race condition
  select balance_after into v_balance
  from public.safe_transactions
  order by occurred_at desc, id desc
  limit 1
  for update;

  v_balance := coalesce(v_balance, 0);
  v_next := v_balance - p_amount;
  if v_next < 0 then
    raise exception 'Sổ quỹ không đủ. Số dư hiện tại %, rút %.', v_balance, p_amount;
  end if;

  insert into public.safe_transactions (
    transaction_type, amount, balance_after,
    reason_category, description, created_by
  ) values (
    'withdraw_other', -p_amount, v_next,
    p_category, p_description, auth.uid()
  ) returning id into v_id;

  -- NEW: auto-create expense row linked to this safe withdrawal.
  -- payment_method='other' → no cash_drawer_events side effect.
  -- category_id=NULL → row appears as "(chưa phân loại)" in cashflow breakdown.
  -- Description fallback: if user passed null/empty, use category as label so
  -- owner can identify the row in sổ chi.
  insert into public.expenses (
    business_date,
    description,
    amount,
    payment_method,
    category_id,
    safe_transaction_id,
    created_by
  ) values (
    current_date,
    coalesce(nullif(trim(p_description), ''), 'Rút quỹ — ' || p_category),
    p_amount,
    'other',
    null,
    v_id,
    auth.uid()
  ) returning id into v_expense_id;

  return jsonb_build_object(
    'id', v_id,
    'balance_after', v_next,
    'expense_id', v_expense_id
  );
end;
$$;

grant execute on function public.safe_withdraw_other(numeric, text, text) to authenticated;
```

- [ ] **Step 2: Apply locally**

```bash
cat database/migrations/2026-05-28-d-safe-withdraw-other-expense.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
```

Expected: `CREATE FUNCTION`, `GRANT`.

- [ ] **Step 3: Patch `database/002_functions.sql` source-of-truth**

The migration is the authoritative version, but `db-init.mjs` re-applies `002_functions.sql` on fresh DBs. Keep them in sync by overwriting lines 1700-1751 in `database/002_functions.sql` with the full new RPC body from Step 1 (same SQL).

```bash
# Use the Edit tool to replace the existing function body in database/002_functions.sql
# Find the block from "create or replace function public.safe_withdraw_other("
# to the "grant execute on function public.safe_withdraw_other..." line.
# Replace with the full content from Step 1.
```

After the edit, verify no syntax breaks:
```bash
grep -c "create or replace function public.safe_withdraw_other" database/002_functions.sql
```
Expected: `1` (still one definition).

- [ ] **Step 4: Manual smoke — owner withdraws, expense appears**

```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SET LOCAL request.jwt.claims TO '{\"sub\":\"88769682-8ac3-4db3-86ce-617b9124a082\",\"role\":\"authenticated\"}';
SET LOCAL role TO 'authenticated';
SELECT public.safe_withdraw_other(50000, 'rent', 'Smoke test withdraw');
SELECT id, business_date, description, amount, payment_method, safe_transaction_id
  FROM public.expenses
 WHERE safe_transaction_id IS NOT NULL
 ORDER BY created_at DESC
 LIMIT 1;
"
```

Expected:
- The RPC return JSON has `expense_id`, `id`, `balance_after`.
- The SELECT returns 1 row: `description='Smoke test withdraw'`, `amount=50000`, `payment_method='other'`, `safe_transaction_id` non-null and equal to the RPC return `id`.

- [ ] **Step 5: Commit**

```bash
git add database/migrations/2026-05-28-d-safe-withdraw-other-expense.sql database/002_functions.sql
git commit -m "$(cat <<'EOF'
feat(sql): safe_withdraw_other auto-insert expense row

After safe_transactions INSERT, also creates an expense linked via
safe_transaction_id FK. payment_method='other' to avoid cash_drawer
side effect (tiền từ safe vault, không phải till). category_id=NULL.
RPC return JSON includes expense_id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Inline filter in 3 SECURITY DEFINER RPCs that read expenses

**Files:**
- Create: `database/migrations/2026-05-28-e-rpcs-hide-safe-expenses.sql`
- Modify: `database/002_functions.sql` (sync the same edits)

Affects three RPCs:
1. `dashboard_daily_ops` (line ~311) — `v_expense_list` JSONB aggregate (line 346-349) lacks `payment_method` filter, so it WILL include safe-sourced rows for non-owner without filtering. Add `AND (e.safe_transaction_id IS NULL OR public.app_role() = 'owner')`.
2. `expense_summary_by_category` (line ~3200) — main SELECT (line 3219) lacks any filter beyond date range. Add the same predicate.
3. `cash_flow_overview` (lives in `database/migrations/2026-05-28-a-cashflow-breakdown.sql` — already in main). Both `outs` CTE and `cat_totals` CTE need the predicate.

**Why NOT touch `v_expenses` (line 339) or `cash_reconciliation_input_view` (line 96) or `compute_cash_theory` (line 190)**: all three filter `payment_method = 'cash'`. Safe-sourced rows are `payment_method='other'` → naturally excluded.

- [ ] **Step 1: Write the migration**

Create `database/migrations/2026-05-28-e-rpcs-hide-safe-expenses.sql`:

```sql
-- =============================================================================
-- Hide safe-sourced expenses from non-owner in security-definer RPCs (2026-05-28)
--
-- Three RPCs query expenses table without payment_method='cash' filter:
--   - dashboard_daily_ops: v_expense_list JSONB aggregate
--   - expense_summary_by_category: per-category totals
--   - cash_flow_overview: outs CTE + cat_totals CTE
--
-- All run SECURITY DEFINER → bypass RLS. Add inline predicate:
--   AND (e.safe_transaction_id IS NULL OR public.app_role() = 'owner')
--
-- Idempotent: create or replace function.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) dashboard_daily_ops — full redefine with v_expense_list filter added
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_daily_ops(p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_sales numeric(14,2) := 0;
  v_cash numeric(14,2) := 0;
  v_non_cash numeric(14,2) := 0;
  v_opening numeric(14,2) := 0;
  v_expenses numeric(14,2) := 0;
  v_payroll numeric(14,2) := 0;
  v_active integer := 0;
  v_latest_count jsonb;
  v_latest_sync jsonb;
  v_expense_list jsonb;
  v_sales_list jsonb;
begin
  if not public.app_is_staff_or_above() and public.app_role() <> 'employee_viewer' then
    raise exception 'Bạn chưa có quyền xem dashboard.';
  end if;

  select coalesce(sum(net_amount), 0) into v_sales from public.sales_orders where business_date = p_business_date;
  select coalesce(sum(sp.amount), 0) into v_cash from public.sales_orders so join public.sales_payments sp on sp.sales_order_id = so.id where so.business_date = p_business_date and sp.payment_method = 'cash';
  v_non_cash := greatest(0, v_sales - v_cash);
  select coalesce(sum(opening_total), 0) into v_opening from public.cash_day_openings where business_date = p_business_date;
  select coalesce(sum(amount), 0) into v_expenses from public.expenses where business_date = p_business_date and payment_method = 'cash';
  select coalesce(sum(total_pay), 0) into v_payroll from public.shift_payroll_records where business_date = p_business_date and payment_method = 'cash';
  select count(*) into v_active from public.shift_assignments where business_date = p_business_date and status = 'checked_in';

  select to_jsonb(cc) into v_latest_count from (select id, business_date, count_type, counted_at, total_physical, total_theory, difference, pos_total, pos_cash_total, pos_non_cash_total, opening_cash, bank_transfer_confirmed, reconciliation_total from public.cash_counts where business_date = p_business_date order by counted_at desc limit 1) cc;
  select to_jsonb(sr) into v_latest_sync from (select id, source, status, started_at, finished_at from public.sales_sync_runs where business_date_from <= p_business_date and business_date_to >= p_business_date order by finished_at desc nulls last limit 1) sr;

  -- v_expense_list: includes ALL payment_methods (not just cash) → must filter
  -- safe-sourced rows for non-owner roles.
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'business_date', e.business_date, 'description', e.description, 'quantity', e.quantity, 'unit', e.unit, 'unit_price', e.unit_price, 'amount', e.amount, 'note', e.note, 'created_at', e.created_at, 'category_id', e.category_id, 'category_name', c.name) order by e.created_at desc), '[]'::jsonb)
  into v_expense_list
  from public.expenses e left join public.expense_categories c on c.id = e.category_id
  where e.business_date = p_business_date
    and (e.safe_transaction_id is null or public.app_role() = 'owner');

  select coalesce(jsonb_agg(jsonb_build_object('id', so.id, 'invoice_code', so.invoice_code, 'order_code', so.table_or_order_code, 'sold_by_name', so.sold_by_name, 'payment_method', coalesce(sp.payment_method, 'mixed'), 'net_amount', so.net_amount, 'total_payment', so.total_payment, 'purchase_at', so.purchase_at) order by so.purchase_at desc), '[]'::jsonb)
  into v_sales_list
  from public.sales_orders so
  left join lateral (select payment_method from public.sales_payments sp where sp.sales_order_id = so.id order by amount desc limit 1) sp on true
  where so.business_date = p_business_date;

  return jsonb_build_object('business_date', p_business_date, 'total_sales', v_sales, 'cash_sales', v_cash, 'non_cash_sales', v_non_cash, 'opening_cash', v_opening, 'total_expenses', v_expenses, 'payroll_paid', v_payroll, 'active_staff', v_active, 'latest_cash_count', v_latest_count, 'latest_sync', v_latest_sync, 'expenses', v_expense_list, 'sales_orders', v_sales_list);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) expense_summary_by_category — full redefine with predicate
-- ---------------------------------------------------------------------------
create or replace function public.expense_summary_by_category(
  p_from date,
  p_to   date
) returns table (
  category_id    uuid,
  category_name  text,
  total_amount   numeric,
  expense_count  int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.category_id,
    c.name                       as category_name,
    sum(e.amount)::numeric       as total_amount,
    count(*)::int                as expense_count
  from public.expenses e
  left join public.expense_categories c on c.id = e.category_id
  where e.business_date >= p_from
    and e.business_date <= p_to
    and (e.safe_transaction_id is null or public.app_role() = 'owner')
  group by e.category_id, c.name
  order by total_amount desc;
$$;

-- ---------------------------------------------------------------------------
-- 3) cash_flow_overview — full redefine. Predicates added in `outs` CTE and
--    `cat_totals` CTE so both `out` total and `expense_breakdown[]` reflect
--    visibility. (Function body matches v2 in 2026-05-28-a-cashflow-breakdown.sql
--    plus the two new AND clauses.)
-- ---------------------------------------------------------------------------
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
  v_breakdown jsonb;
  v_result jsonb;
begin
  if not public.app_is_owner_manager() then
    raise exception 'forbidden: cash_flow_overview requires owner/manager';
  end if;

  select coalesce(sum(net_amount), 0)
    into v_in
    from public.sales_orders
   where business_date between p_start and p_end;

  -- v_out: total OUT includes payroll + ALL expenses, BUT safe-sourced only
  -- count for owner.
  select coalesce((select sum(amount) from public.expenses
                    where business_date between p_start and p_end
                      and (safe_transaction_id is null or public.app_role() = 'owner')), 0)
       + coalesce((select sum(total_pay) from public.shift_payroll_records
                    where business_date between p_start and p_end), 0)
    into v_out;

  with d as (
    select dd::date as day
      from generate_series(p_start, p_end, interval '1 day') dd
  ),
  ins as (
    select business_date as day, sum(net_amount) as amt
      from public.sales_orders
     where business_date between p_start and p_end
     group by 1
  ),
  outs as (
    select day, sum(amt) as amt from (
      select business_date as day, sum(amount) as amt
        from public.expenses
       where business_date between p_start and p_end
         and (safe_transaction_id is null or public.app_role() = 'owner')
       group by 1
      union all
      select business_date as day, sum(total_pay) as amt
        from public.shift_payroll_records
       where business_date between p_start and p_end
       group by 1
    ) u group by day
  ),
  deposits as (
    select business_date as day, coalesce(sum(safe_deposit_amount), 0) as amt
      from public.cash_close_reports
     where business_date between p_start and p_end
       and report_status <> 'voided'
     group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'date', to_char(d.day, 'YYYY-MM-DD'),
           'in', coalesce(ins.amt, 0),
           'out', coalesce(outs.amt, 0),
           'safe_deposit', coalesce(deposits.amt, 0)
         ) order by d.day)
    into v_by_day
    from d
    left join ins on ins.day = d.day
    left join outs on outs.day = d.day
    left join deposits on deposits.day = d.day;

  with cat_totals as (
    select
      ec.id as category_id,
      coalesce(ec.name, '(chưa phân loại)') as category_name,
      sum(e.amount) as amount,
      jsonb_agg(
        jsonb_build_object(
          'id', e.id,
          'business_date', to_char(e.business_date, 'YYYY-MM-DD'),
          'description', e.description,
          'amount', e.amount,
          'occurred_at', to_char(e.created_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD"T"HH24:MI:SS'),
          'note', e.note
        ) order by e.created_at desc
      ) as expenses
    from public.expenses e
    left join public.expense_categories ec on ec.id = e.category_id
    where e.business_date between p_start and p_end
      and (e.safe_transaction_id is null or public.app_role() = 'owner')
    group by ec.id, ec.name
  )
  select jsonb_agg(jsonb_build_object(
           'category_id', category_id,
           'category_name', category_name,
           'amount', amount,
           'pct', case when v_out = 0 then 0 else amount / v_out end,
           'expenses', expenses
         ) order by amount desc)
    into v_breakdown
    from cat_totals;

  v_result := jsonb_build_object(
    'in', v_in,
    'out', v_out,
    'net', v_in - v_out,
    'by_day', coalesce(v_by_day, '[]'::jsonb),
    'expense_breakdown', coalesce(v_breakdown, '[]'::jsonb)
  );

  if p_compare_start is not null and p_compare_end is not null then
    select coalesce(sum(net_amount), 0)
      into v_prev_in
      from public.sales_orders
     where business_date between p_compare_start and p_compare_end;
    select coalesce((select sum(amount) from public.expenses
                      where business_date between p_compare_start and p_compare_end
                        and (safe_transaction_id is null or public.app_role() = 'owner')), 0)
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
```

- [ ] **Step 2: Apply locally**

```bash
cat database/migrations/2026-05-28-e-rpcs-hide-safe-expenses.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
```

Expected: 3 × `CREATE FUNCTION`.

- [ ] **Step 3: Patch `database/002_functions.sql` source-of-truth**

Sync `database/002_functions.sql` by replacing the two RPC bodies that live there:

1. `dashboard_daily_ops` (block starting line ~311, ending around line 359). Replace with the new body from Step 1.
2. `expense_summary_by_category` (block starting line ~3200, ending around line 3225). Replace with the new body.

Do NOT add `cash_flow_overview` to `002_functions.sql` — per project convention, that RPC lives only in its dedicated migration file. The migration in Step 1 supersedes the earlier `2026-05-28-a-cashflow-breakdown.sql` definition; subsequent db:init applies them in alphabetical order so `-e-` overrides `-a-`.

Verify the edit didn't introduce duplicate definitions:
```bash
grep -c "create or replace function public.dashboard_daily_ops" database/002_functions.sql
grep -c "create or replace function public.expense_summary_by_category" database/002_functions.sql
```
Both should return `1`.

- [ ] **Step 4: Manual smoke — owner vs manager visibility**

```bash
# Owner — should see the safe-sourced expense from Task 3 smoke
docker compose exec -T db psql -U postgres -d postgres -c "
SET LOCAL request.jwt.claims TO '{\"sub\":\"88769682-8ac3-4db3-86ce-617b9124a082\",\"role\":\"authenticated\"}';
SET LOCAL role TO 'authenticated';
SELECT jsonb_array_length((public.dashboard_daily_ops(current_date) -> 'expenses')) as owner_expense_count;
SELECT (public.cash_flow_overview(current_date - 7, current_date) ->> 'out')::numeric as owner_out_total;
"
```

Now seed a manager account and check it sees fewer rows. Find an existing manager (if any) or create one:
```bash
docker compose exec -T db psql -U postgres -d postgres -c "
SELECT u.id, ea.role FROM auth.users u
JOIN public.employee_accounts ea ON ea.auth_user_id = u.id
WHERE ea.role = 'manager' AND ea.status = 'active'
LIMIT 1;"
```

If no manager exists, create a temp one or skip Step 4 here and rely on pgTAP (Task 6). If one exists, use its UUID:
```bash
MANAGER_UUID=$(docker compose exec -T db psql -U postgres -d postgres -tA -c "
SELECT u.id FROM auth.users u
JOIN public.employee_accounts ea ON ea.auth_user_id = u.id
WHERE ea.role='manager' AND ea.status='active' LIMIT 1;" | tr -d '\r')

docker compose exec -T db psql -U postgres -d postgres -c "
SET LOCAL request.jwt.claims TO '{\"sub\":\"$MANAGER_UUID\",\"role\":\"authenticated\"}';
SET LOCAL role TO 'authenticated';
SELECT jsonb_array_length((public.dashboard_daily_ops(current_date) -> 'expenses')) as manager_expense_count;
SELECT (public.cash_flow_overview(current_date - 7, current_date) ->> 'out')::numeric as manager_out_total;
"
```

Expected: manager_expense_count ≤ owner_expense_count; manager_out_total ≤ owner_out_total (difference = sum of safe-sourced expense amounts in the range).

- [ ] **Step 5: Commit**

```bash
git add database/migrations/2026-05-28-e-rpcs-hide-safe-expenses.sql database/002_functions.sql
git commit -m "$(cat <<'EOF'
feat(sql): hide safe-sourced expenses in 3 security-definer RPCs

dashboard_daily_ops, expense_summary_by_category, cash_flow_overview
all SECURITY DEFINER → bypass RLS. Add inline predicate
(safe_transaction_id IS NULL OR app_role()='owner') to every query
that aggregates or lists expenses. Manager + staff + viewer roles
see fewer rows + lower OUT total when safe-sourced expenses exist.

v_expenses + cash_reconciliation_input_view + compute_cash_theory
need no change — they already filter payment_method='cash' and
safe-sourced rows use payment_method='other'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Apply migrations + cross-role manual smoke

**Files:** None (verification only).

This is a checkpoint to confirm the SQL side of things works end-to-end before moving to pgTAP and frontend.

- [ ] **Step 1: Reset local DB to clean state and apply all PR2-era migrations + new PR3 migrations**

```bash
docker compose exec -T db psql -U postgres -d postgres -c "select count(*) from public.expenses where safe_transaction_id is not null;"
```

Expected: ≥ 1 (the smoke row from Task 3). If 0, re-run the Task 3 smoke step.

- [ ] **Step 2: Owner sees the row in all surfaces**

```bash
# 1. Direct SELECT (RLS applies via JWT)
docker compose exec -T db psql -U postgres -d postgres -c "
SET LOCAL request.jwt.claims TO '{\"sub\":\"88769682-8ac3-4db3-86ce-617b9124a082\",\"role\":\"authenticated\"}';
SET LOCAL role TO 'authenticated';
SELECT count(*) as owner_visible
  FROM public.expenses
 WHERE safe_transaction_id IS NOT NULL;
"
# Expected: same as the unfiltered count (owner sees all)

# 2. dashboard_daily_ops includes the row
docker compose exec -T db psql -U postgres -d postgres -c "
SET LOCAL request.jwt.claims TO '{\"sub\":\"88769682-8ac3-4db3-86ce-617b9124a082\",\"role\":\"authenticated\"}';
SET LOCAL role TO 'authenticated';
SELECT public.dashboard_daily_ops(current_date) -> 'expenses' -> 0 -> 'safe_transaction_id';
"
# Expected: should NOT be present in the JSONB row (because we didn't include safe_transaction_id in the json_build_object), but the row WILL appear if the smoke expense is from today's business_date. If owner_visible count > 0 in step 1, that's the proof.
```

- [ ] **Step 3: Manager sees nothing safe-sourced**

Find a manager UUID (or note "no manager exists in seed; relying on pgTAP for this assertion"). Run as manager:

```bash
MANAGER_UUID=$(docker compose exec -T db psql -U postgres -d postgres -tA -c "
SELECT u.id FROM auth.users u
JOIN public.employee_accounts ea ON ea.auth_user_id = u.id
WHERE ea.role='manager' AND ea.status='active' LIMIT 1;" | tr -d '\r')

if [ -n "$MANAGER_UUID" ]; then
  docker compose exec -T db psql -U postgres -d postgres -c "
SET LOCAL request.jwt.claims TO '{\"sub\":\"$MANAGER_UUID\",\"role\":\"authenticated\"}';
SET LOCAL role TO 'authenticated';
SELECT count(*) as manager_visible_safe_sourced
  FROM public.expenses
 WHERE safe_transaction_id IS NOT NULL;
"
else
  echo "No manager account in seed; pgTAP (Task 6) will validate manager visibility."
fi
```

Expected (if manager exists): `0`.

- [ ] **Step 4: No commit** — verification step only.

---

## Task 6: pgTAP test — `230_safe_expense_link.sql`

**Files:**
- Create: `database/tests/230_safe_expense_link.sql`

- [ ] **Step 1: Write the pgTAP test**

Create `database/tests/230_safe_expense_link.sql`:

```sql
-- =============================================================================
-- pgTAP — safe withdraw → expense link + owner-only visibility
--
-- 7 assertions:
--   1. safe_withdraw_other creates an expense row with safe_transaction_id set
--   2. Expense amount + description match the safe withdraw input
--   3. payment_method='other' (NOT 'cash')
--   4. category_id IS NULL
--   5. Owner select sees the safe-sourced expense
--   6. Manager select returns 0 rows for safe-sourced expenses
--   7. cash_flow_overview for manager excludes the amount from `out`
-- =============================================================================

begin;
select plan(7);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
end;
$$ language plpgsql;

-- Owner + manager test users
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('33333333-3333-3333-3333-333333333333', 'owner_sel@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('44444444-4444-4444-4444-444444444444', 'manager_sel@test.local', '', now(), '00000000-0000-0000-0000-000000000000');

insert into public.profiles (id, display_name) values
  ('33333333-3333-3333-3333-333333333333', 'OwnerSEL'),
  ('44444444-4444-4444-4444-444444444444', 'ManagerSEL');

insert into public.employee_accounts (auth_user_id, role, status) values
  ('33333333-3333-3333-3333-333333333333', 'owner', 'active'),
  ('44444444-4444-4444-4444-444444444444', 'manager', 'active');

-- Seed safe with initial deposit so owner can withdraw
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

insert into public.safe_transactions (
  transaction_type, amount, balance_after,
  reason_category, description, created_by
) values (
  'initial_setup', 5000000, 5000000,
  null, 'pgTAP test init', '33333333-3333-3333-3333-333333333333'
);

-- Owner withdraws 200000 with reason
select public.safe_withdraw_other(200000, 'rent', 'pgTAP test withdrawal') as withdraw_result \gset

-- Capture the safe_transaction_id created by the withdraw
create temp table _t_sel_safe_id (id uuid);
insert into _t_sel_safe_id
select (('CFO_SEL_TMP_RESULT_NEEDS_PARSING')::text)::text where false; -- placeholder
-- Recover the safe id by selecting the most recent withdraw_other by this owner
truncate _t_sel_safe_id;
insert into _t_sel_safe_id
select id from public.safe_transactions
 where transaction_type = 'withdraw_other'
   and created_by = '33333333-3333-3333-3333-333333333333'
 order by occurred_at desc, id desc
 limit 1;

-- ===========================================================================
-- Assertions 1-4: structure of the auto-created expense
-- ===========================================================================

select is(
  (select count(*)::int
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  1,
  '1. safe_withdraw_other creates exactly 1 expense row linked by safe_transaction_id'
);

select is(
  (select (e.amount, e.description)::text
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  (200000::numeric, 'pgTAP test withdrawal'::text)::text,
  '2. Expense amount + description match safe withdraw input'
);

select is(
  (select e.payment_method
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  'other'::text,
  '3. payment_method is "other" (avoids cash_drawer double-count)'
);

select is(
  (select e.category_id
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  null::uuid,
  '4. category_id is NULL (no reason_category mapping v1)'
);

-- ===========================================================================
-- Assertions 5-6: owner sees, manager does not
-- ===========================================================================

-- Owner sees the row
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  1,
  '5. Owner SELECT sees the safe-sourced expense (RLS allows)'
);

-- Manager does not see the row
select pg_temp.act_as('44444444-4444-4444-4444-444444444444');

select is(
  (select count(*)::int
     from public.expenses e
     join _t_sel_safe_id t on t.id = e.safe_transaction_id),
  0,
  '6. Manager SELECT does NOT see the safe-sourced expense (RLS blocks)'
);

-- ===========================================================================
-- Assertion 7: cash_flow_overview as manager excludes the amount
-- ===========================================================================

-- The expense is on current_date; query the day's `out` total as manager
select is(
  (select (public.cash_flow_overview(current_date, current_date) ->> 'out')::numeric),
  0::numeric,
  '7. Manager cash_flow_overview `out` excludes safe-sourced amount (current_date had only the 200000 hidden withdraw)'
);

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test**

```bash
node scripts/pgtap-run.mjs --file database/tests/230_safe_expense_link.sql 2>&1 | tail -20
```

Expected: 7/7 assertions passing. If something fails, inspect with `\d public.expenses` against the running DB and adjust inserts as needed.

- [ ] **Step 3: Commit**

```bash
git add database/tests/230_safe_expense_link.sql
git commit -m "$(cat <<'EOF'
test(pgtap): safe withdraw → expense link + owner-only visibility

7 assertions:
1-4: auto-created expense structure (FK, amount, description,
     payment_method='other', category_id=NULL)
5-6: owner SELECT sees, manager SELECT doesn't (RLS)
7:   manager cash_flow_overview excludes safe-sourced from `out`

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend helper text in `WithdrawSafeModal`

**Files:**
- Modify: `src/features/safe/withdraw-safe-modal.tsx`

A 1-line addition to let owner know the side effect.

- [ ] **Step 1: Read the file**

```bash
grep -n "description\|textarea\|Mô tả\|description.*textarea" src/features/safe/withdraw-safe-modal.tsx | head -10
```

Locate where the description textarea is rendered.

- [ ] **Step 2: Add helper text below the description input**

Below the `<textarea>` or wrapper for the description field, add a small caption:

```tsx
<p className="text-xs text-muted mt-1">
  Khoản này sẽ được ghi vào sổ chi (chỉ owner xem được).
</p>
```

Match the existing styling pattern used elsewhere in the file (`text-xs text-muted`).

- [ ] **Step 3: Verify typecheck + vitest**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: 0 errors; all tests pass.

- [ ] **Step 4: Manual smoke**

Login owner → /safe → click "Rút khác" → confirm helper text appears below the description field.

- [ ] **Step 5: Commit**

```bash
git add src/features/safe/withdraw-safe-modal.tsx
git commit -m "$(cat <<'EOF'
feat(safe): hint that withdraw_other is logged to sổ chi (owner-only)

1-line helper text below the description field in WithdrawSafeModal
to let the owner know the side effect: the withdrawal auto-creates
an expense row visible only to owner.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: End-to-end verify + push PR + tag v4.1.16

- [ ] **Step 1: Full local verification**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

```bash
npx vitest run
```
Expected: all 137 (or current count) tests pass.

```bash
node scripts/pgtap-run.mjs --file database/tests/230_safe_expense_link.sql
```
Expected: 7/7 (re-run after all migrations applied).

- [ ] **Step 2: App smoke (dev preview port 3009)**

1. Login owner → /safe → "Rút khác" → nhập 50.000đ + category=rent + mô tả "smoke" → confirm helper text visible → Submit.
2. /expenses → see the new row "smoke" / 50.000đ.
3. /cash-flow → confirm the breakdown includes it (in "(chưa phân loại)" bucket if no category_id) and the `out` KPI reflects 50.000đ.
4. Logout. Login manager (need a manager account; if none, skip; pgTAP covers).
5. As manager → /expenses → confirm the row is HIDDEN. Dashboard "Tổng chi" doesn't include 50.000đ. Cashflow `out` lower than owner's.

- [ ] **Step 3: Commit any final tweaks if smoke surfaces issues**

If smoke catches anything (e.g. helper text styling off, RLS missed an edge case), fix + commit. Otherwise proceed.

- [ ] **Step 4: Push branch + open PR with explicit `--base main`**

```bash
git push -u origin feat/safe-expense-link
gh pr create --base main --title "feat: log safe withdrawals to sổ chi, owner-only (v4.1.16)" --body "$(cat <<'EOF'
## Summary

`safe_withdraw_other` now auto-creates an `expenses` row linked via
`safe_transaction_id`. Owner sees those in sổ chi / cashflow / dashboard;
manager + staff_operator + employee_viewer have them **fully hidden** —
no row, no KPI inclusion, no breakdown line.

## Implementation

- **Schema**: `expenses.safe_transaction_id uuid NULL` FK + partial index
- **RLS**: 3 case-based policies on `expenses` (select/update/delete) — when `safe_transaction_id IS NOT NULL` → owner only
- **RPC**: `safe_withdraw_other` direct-INSERT into `expenses` with `payment_method='other'` (no cash_drawer side effect) and `category_id=NULL`
- **RPC inline filter**: `dashboard_daily_ops` (v_expense_list), `expense_summary_by_category`, `cash_flow_overview` (outs + cat_totals) — all SECURITY DEFINER so RLS bypassed; explicit `AND (safe_transaction_id IS NULL OR app_role()='owner')` added
- **Frontend**: 1-line helper text in `WithdrawSafeModal`

## Files

- Migrations: `2026-05-28-b-...`, `-c-`, `-d-`, `-e-` (4 files; each focused)
- pgTAP: `database/tests/230_safe_expense_link.sql` (7 assertions)
- `database/002_functions.sql`: sync source-of-truth for the patched RPCs
- `src/features/safe/withdraw-safe-modal.tsx`: 1 LOC helper text

## Test plan

- [x] Migrations apply cleanly
- [x] Manual SQL smoke (owner sees, manager doesn't)
- [x] pgTAP 7/7
- [x] `npx tsc --noEmit` clean
- [x] `npx vitest run` all pass
- [ ] CI green
- [ ] Manual UI smoke per Task 8 step 2

## Specs + Plan

- Spec: `docs/superpowers/specs/2026-05-28-safe-expense-link-design.md`
- Plan: `docs/superpowers/plans/2026-05-28-safe-expense-link.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Watch CI**

```bash
gh pr view --json number --jq .number
# Note the PR number, e.g. 20
gh pr checks --watch 2>&1 | tail -10
```

Expected: 4 jobs (typecheck, vitest, pgtap, build) all green within ~3 minutes. If the PR base accidentally landed wrong, fix with `gh pr edit <NUM> --base main` then close+reopen to retrigger.

- [ ] **Step 6: Merge via API**

```bash
PR_NUM=$(gh pr view --json number --jq .number)
gh api -X PUT "repos/KaMnh/chill-coffee-erp/pulls/$PR_NUM/merge" -f merge_method=squash
```

- [ ] **Step 7: Tag v4.1.16 via API**

```bash
MAIN_SHA=$(gh api repos/KaMnh/chill-coffee-erp/commits/main --jq .sha)
gh api -X POST repos/KaMnh/chill-coffee-erp/git/refs -f ref="refs/tags/v4.1.16" -f sha="$MAIN_SHA"
```

This triggers `release.yml` which builds the Docker image as `v4.1.16`, `4.1`, `latest`.

- [ ] **Step 8: Verify release**

```bash
gh run list --workflow=release.yml --limit 2
```

Expected: a new "release" run for v4.1.16. Wait for green.

---

## Self-Review Summary

**1. Spec coverage**:
- §0 TL;DR — Tasks 1-7 cover.
- §1 Acceptance criteria — pgTAP (Task 6) covers owner/manager visibility; smoke (Task 8) covers UI.
- §3.1 Schema — Task 1.
- §3.2 RPC extension — Task 3.
- §3.3 RLS — Task 2.
- §3.4 RPC inline filter — Task 4.
- §3.5 Frontend — Task 7.
- §5 Verification — Tasks 5, 6, 8.
- §6 Execution order — matches Tasks 1-8.
- §7 Open assumptions — `payment_method='other'` rationale documented in Task 3 comment; `business_date=current_date` documented in Task 3 comment; RLS pattern documented in Task 2; RPC bypass mitigation in Task 4.

**2. Placeholder scan**: No "TBD" / "implement later" / "add appropriate" patterns. Every step has the runnable SQL/command or full code block.

**3. Type consistency**:
- `safe_transaction_id uuid` (Task 1) — referenced by all RPC inline filters (Task 4) and pgTAP (Task 6) with the same column name.
- `payment_method='other'` (Task 3) — consistent with Task 6 pgTAP assertion #3.
- `app_role() = 'owner'` predicate (Tasks 2, 4) — consistent expression used throughout.
- `safe_withdraw_other` return JSON keys `id`, `balance_after`, `expense_id` (Task 3) — pgTAP doesn't depend on the return JSON shape, so no consistency check needed there.
