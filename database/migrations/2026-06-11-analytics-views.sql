-- =============================================================================
-- Migration: analytics schema + 4 view cho n8n + grants service_role
-- Sinh từ khối marker trong 002_functions.sql + 003_rls.sql (dual-write).
-- Idempotent: drop view if exists + create; chạy lại an toàn.
-- =============================================================================
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
-- ============================================================== ANALYTICS-GRANTS-BEGIN
-- Schema analytics: CHỈ service_role (n8n). KHÔNG grant anon/authenticated.
-- Mirror trong src/app/api/backup/restore/route.ts POST_RESTORE_GRANTS_SQL.
-- Khối này được trích nguyên văn vào migration 2026-06-11-analytics-views.sql.
grant usage on schema analytics to service_role;
grant select on all tables in schema analytics to service_role;
alter default privileges in schema analytics
  grant select on tables to service_role;
-- ============================================================== ANALYTICS-GRANTS-END
