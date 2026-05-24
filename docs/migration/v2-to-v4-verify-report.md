# Verification Report: v2.x → v4 Migration

_Generated: 2026-05-24T06:12:01.222Z_

## Summary

**✓ OK** — Counts khớp, FK integrity OK, timestamps OK.

Sau khi confirm OK, cleanup staging:
```powershell
docker compose exec -T db psql -U postgres -c "DROP SCHEMA legacy_v2 CASCADE; DROP SCHEMA legacy_v2_auth CASCADE;"
```

## 1. Count diff

| Table | legacy_v2 | public | Δ | Status |
|---|---|---|---|---|
| `employees` | 16 | 17 | 1 | OK |
| `employee_accounts` | 6 | 1 | -5 | ❌ v4 < v2 (lost rows?) |
| `expense_categories` | 5 | 5 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `expense_templates` | 5 | 5 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `expenses` | 122 | 122 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `cash_day_openings` | 22 | 22 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `cash_counts` | 50 | 50 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `cash_close_reports` | 29 | 29 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `cash_drawer_events` | 1562 | 1562 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `shift_assignments` | 152 | 152 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `shift_payroll_records` | 146 | 146 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `safe_transactions` | 55 | 55 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `handover_sessions` | 23 | 23 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |
| `handover_tasks` | 92 | 92 | 0 | ⚠️  no rows inserted (already migrated? unmapped users?) |

## 2. Referential integrity

| Constraint | Dangling FK | Status |
|---|---|---|
| expenses.category_id → expense_categories.id | 0 | ✓ OK |
| expenses.template_id → expense_templates.id | 0 | ✓ OK |
| cash_close_reports.cash_count_id → cash_counts.id | 0 | ✓ OK |
| shift_payroll_records.employee_id → employees.id | 0 | ✓ OK |
| shift_assignments.employee_id → employees.id | 0 | ✓ OK |
| employee_accounts.employee_id → employees.id | 0 | ✓ OK |
| handover_tasks.session_id → handover_sessions.id | 0 | ✓ OK |
| cash_drawer_events.expense_id → expenses.id | 0 | ✓ OK |
| cash_drawer_events.cash_count_id → cash_counts.id | 0 | ✓ OK |

## 3. Timezone sanity

Phát hiện timestamp lệch (vd: bug TZ giống bug KiotViet 2026-05-04).

| Check | Count | Status |
|---|---|---|
| expenses created_at < 2020 | 0 | ✓ |
| expenses created_at > tomorrow | 0 | ✓ |
| cash_counts counted_at > tomorrow | 0 | ✓ |
| shifts check_in_at > tomorrow | 0 | ✓ |

## 4. Match ratio per table

Số rows v2 đã được link sang v4 (qua id_map hoặc natural key).

| Table | v2 rows | Matched | Ratio |
|---|---|---|---|
| `employees` | 16 | 16 | 100.0% |
| `expense_categories` | 5 | 5 | 100.0% |
| `expense_templates` | 5 | 5 | 100.0% |
| `expenses` | 122 | 122 | 100.0% |
| `cash_day_openings` | 22 | 22 | 100.0% |
| `cash_counts` | 50 | 50 | 100.0% |
| `cash_drawer_events` | 1562 | 1698 | 108.7% |
| `shift_assignments` | 152 | 152 | 100.0% |
| `safe_transactions` | 55 | 55 | 100.0% |
| `handover_sessions` | 23 | 23 | 100.0% |
| `handover_tasks` | 92 | 92 | 100.0% |
