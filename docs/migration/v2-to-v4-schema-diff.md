# Schema Diff Report: Supabase v2.x → Chill Coffee ERP v4

_Generated: 2026-05-24T05:40:18.286Z_

## Tổng quan

- Bảng v2 (parsed): **27**
- Bảng v4 (parsed): **32**
- Bảng trong scope migration: **14**

**Status legend:**
- `OK` — cùng tên, type, nullable, default
- `TYPE_DIFF` — cùng tên, khác type (vd: `timestamp` vs `timestamptz`)
- `NEW_v4` — chỉ có ở v4 (sẽ null/default cho data v2)
- `DROPPED_v4` — chỉ có ở v2 (lost nếu không xử lý)
- `NULLABLE_DIFF` — khác NOT NULL constraint
- `DEFAULT_DIFF` — cùng tên/type nhưng default expression khác

---

## Bảng ở v2 dump nhưng NGOÀI scope migration

- `app_settings` (5 cột)
- `audit_log` (9 cột)
- `expense_history_permissions` (6 cột)
- `integration_clients` (7 cột)
- `pos_sync_attempts` (5 cột)
- `profiles` (7 cột)
- `safe_attachments` (10 cột)
- `safe_counts` (9 cột)
- `sales_order_items` (16 cột)
- `sales_orders` (27 cột)
- `sales_payments` (10 cột)
- `sales_sync_runs` (13 cột)
- `signup_requests` (10 cột)

_Sales/inventory/safe nằm ở đây là expected. Nếu thấy bảng quan trọng → review lại scope._

---

## Chi tiết per-table

## employees

_Summary: TYPE_DIFF=2, NULLABLE_DIFF=1, DEFAULT_DIFF=2, OK=3_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `hourly_rate` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `is_active` | bool, NOT NULL, default true | bool, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `code` | text | text | **OK** |  |
| `name` | text, NOT NULL | text, NOT NULL | **OK** |  |
| `position` | text | text | **OK** |  |

## employee_accounts

_Summary: TYPE_DIFF=1, NULLABLE_DIFF=1, DEFAULT_DIFF=1, OK=4_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `status` | text, NOT NULL, default 'active'::text | text, NOT NULL, default 'active' | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `auth_user_id` | uuid, NOT NULL | uuid, NOT NULL | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |
| `employee_id` | uuid | uuid | **OK** |  |
| `role` | text, NOT NULL | text, NOT NULL | **OK** |  |

## expense_categories

_Summary: TYPE_DIFF=2, NULLABLE_DIFF=1, DEFAULT_DIFF=3, OK=1_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `is_active` | bool, NOT NULL, default true | bool, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `sort_order` | int4, NOT NULL, default 100 | int4, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `type` | text, NOT NULL, default 'expense'::text | text, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `name` | text, NOT NULL | text, NOT NULL | **OK** |  |

## expense_templates

_Summary: TYPE_DIFF=3, NULLABLE_DIFF=1, DEFAULT_DIFF=3, OK=3_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `last_used_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `is_active` | bool, NOT NULL, default true | bool, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `last_unit_price` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `usage_count` | int4, NOT NULL, default 0 | int4, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `default_category_id` | uuid | uuid | **OK** |  |
| `default_unit` | text | text | **OK** |  |
| `label` | text, NOT NULL | text, NOT NULL | **OK** |  |

## expenses

_Summary: TYPE_DIFF=2, NULLABLE_DIFF=1, DEFAULT_DIFF=3, OK=8_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `payment_method` | text, NOT NULL, default 'cash'::text | text, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `quantity` | numeric, NOT NULL, default 1 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `unit_price` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `amount` | numeric, NOT NULL | numeric, NOT NULL | **OK** |  |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `category_id` | uuid | uuid | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |
| `description` | text, NOT NULL | text, NOT NULL | **OK** |  |
| `note` | text | text | **OK** |  |
| `template_id` | uuid | uuid | **OK** |  |
| `unit` | text | text | **OK** |  |

## cash_day_openings

_Summary: TYPE_DIFF=2, DROPPED_v4=1, NULLABLE_DIFF=1, DEFAULT_DIFF=4, OK=2_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `carried_amount` | numeric, NOT NULL, default 0 | — | **DROPPED_v4** | v4 không còn cột này. Data sẽ mất nếu không thêm logic. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `carried_from_previous_day` | bool, NOT NULL, default false | bool, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `denominations_json` | jsonb, NOT NULL, default '{}'::jsonb | jsonb, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `opening_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `safe_withdrawal_amount` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |

## cash_counts

_Summary: TYPE_DIFF=3, NULLABLE_DIFF=1, DEFAULT_DIFF=11, OK=4_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `counted_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `sales_snapshot_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `bank_transfer_confirmed` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `count_type` | text, NOT NULL, default 'spot_audit'::text | text, NOT NULL, default 'spot_audit' | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `denominations_json` | jsonb, NOT NULL, default '{}'::jsonb | jsonb, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `difference` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `opening_cash` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `pos_cash_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `pos_non_cash_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `pos_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `reconciliation_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `total_physical` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `total_theory` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `counted_by` | uuid | uuid | **OK** |  |
| `note` | text | text | **OK** |  |
| `sync_run_id` | uuid | uuid | **OK** |  |

## cash_close_reports

_Summary: TYPE_DIFF=5, DROPPED_v4=1, NULLABLE_DIFF=1, DEFAULT_DIFF=14, OK=6_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `closed_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `sync_snapshot_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `voided_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `leave_for_next_day` | numeric, NOT NULL, default 0 | — | **DROPPED_v4** | v4 không còn cột này. Data sẽ mất nếu không thêm logic. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `bank_transfer_confirmed` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `denominations_json` | jsonb, NOT NULL, default '{}'::jsonb | jsonb, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `difference` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `expense_cash_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `opening_cash` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `payroll_cash_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `physical_cash` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `pos_cash_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `pos_non_cash_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `pos_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `reconciliation_total` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `report_status` | text, NOT NULL, default 'final'::text | text, NOT NULL, default 'final' | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `safe_deposit_amount` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `theory_cash` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `cash_count_id` | uuid, NOT NULL | uuid, NOT NULL | **OK** |  |
| `closed_by` | uuid | uuid | **OK** |  |
| `note` | text | text | **OK** |  |
| `void_reason` | text | text | **OK** |  |
| `voided_by` | uuid | uuid | **OK** |  |

## cash_drawer_events

_Summary: TYPE_DIFF=2, NULLABLE_DIFF=1, DEFAULT_DIFF=2, OK=12_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `occurred_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `amount` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `source` | text, NOT NULL, default 'app_action'::text | text, NOT NULL, default 'app_action' | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `balance_after` | numeric | numeric | **OK** |  |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `cash_count_id` | uuid | uuid | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |
| `direction` | text, NOT NULL | text, NOT NULL | **OK** |  |
| `event_type` | text, NOT NULL | text, NOT NULL | **OK** |  |
| `expense_id` | uuid | uuid | **OK** |  |
| `note` | text | text | **OK** |  |
| `raw_json` | jsonb | jsonb | **OK** |  |
| `sales_order_id` | uuid | uuid | **OK** |  |
| `sales_payment_id` | uuid | uuid | **OK** |  |
| `shift_payroll_record_id` | uuid | uuid | **OK** |  |

## shift_assignments

_Summary: TYPE_DIFF=4, NULLABLE_DIFF=1, DEFAULT_DIFF=2, OK=5_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `check_in_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `check_out_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `confirmed_by_manager` | bool, NOT NULL, default true | bool, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `status` | text, NOT NULL, default 'checked_in'::text | text, NOT NULL, default 'checked_in' | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |
| `employee_id` | uuid, NOT NULL | uuid, NOT NULL | **OK** |  |
| `total_minutes` | int4 | int4 | **OK** |  |
| `updated_by` | uuid | uuid | **OK** |  |

## shift_payroll_records

_Summary: TYPE_DIFF=4, NULLABLE_DIFF=1, DEFAULT_DIFF=6, OK=6_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `check_in_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `check_out_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `edited_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `allowance_amount` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `base_pay` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `hourly_rate` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `payment_method` | text, NOT NULL, default 'cash'::text | text, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `total_minutes` | int4, NOT NULL, default 0 | int4, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `total_pay` | numeric, NOT NULL, default 0 | numeric, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |
| `edited_by` | uuid | uuid | **OK** |  |
| `employee_id` | uuid, NOT NULL | uuid, NOT NULL | **OK** |  |
| `note` | text | text | **OK** |  |
| `shift_assignment_id` | uuid | uuid | **OK** |  |

## safe_transactions

_Summary: TYPE_DIFF=2, NULLABLE_DIFF=1, OK=8_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `occurred_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `amount` | numeric, NOT NULL | numeric, NOT NULL | **OK** |  |
| `balance_after` | numeric, NOT NULL | numeric, NOT NULL | **OK** |  |
| `cash_close_report_id` | uuid | uuid | **OK** |  |
| `cash_day_opening_id` | uuid | uuid | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |
| `description` | text | text | **OK** |  |
| `reason_category` | text | text | **OK** |  |
| `transaction_type` | text, NOT NULL | text, NOT NULL | **OK** |  |

## handover_sessions

_Summary: TYPE_DIFF=3, NULLABLE_DIFF=1, DEFAULT_DIFF=1, OK=3_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `completed_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `updated_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `status` | text, NOT NULL, default 'draft'::text | text, NOT NULL, default 'draft' | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `business_date` | date, NOT NULL | date, NOT NULL | **OK** |  |
| `created_by` | uuid | uuid | **OK** |  |
| `note` | text | text | **OK** |  |

## handover_tasks

_Summary: TYPE_DIFF=2, NULLABLE_DIFF=1, DEFAULT_DIFF=2, OK=4_

| Column | v2 | v4 | Status | Notes |
|---|---|---|---|---|
| `checked_at` | timestamp | timestamptz | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `created_at` | timestamp, NOT NULL, default now() | timestamptz, NOT NULL | **TYPE_DIFF** | v2 naive timestamp → v4 timestamptz. CẦN explicit `AT TIME ZONE 'Asia/Ho_Chi_Minh'` khi INSERT. |
| `id` | uuid, NOT NULL, default gen_random_uuid() | uuid | **NULLABLE_DIFF** | Constraint khác — kiểm tra row có NULL không. |
| `is_done` | bool, NOT NULL, default false | bool, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `sort_order` | int4, NOT NULL, default 100 | int4, NOT NULL | **DEFAULT_DIFF** | Default expression khác — kiểm tra nếu rely on default. |
| `checked_by` | uuid | uuid | **OK** |  |
| `label` | text, NOT NULL | text, NOT NULL | **OK** |  |
| `session_id` | uuid, NOT NULL | uuid, NOT NULL | **OK** |  |
| `task_key` | text, NOT NULL | text, NOT NULL | **OK** |  |

---

## Bước tiếp theo

1. Review từng table section bên trên.
2. Nếu có nhiều `TYPE_DIFF` hoặc `DROPPED_v4` quan trọng → tạo `migration/mapping-rules.json` (xem `scripts/migrate/README.md`).
3. Nếu mọi thứ là `OK` hoặc `NEW_v4` (default OK) → có thể chạy thẳng Stage 2.
4. Lưu ý đặc biệt: cảnh báo `timestamp` vs `timestamptz` ở các cột thời gian → migration scripts đã xử lý nhưng cần verify ở Stage 4.
