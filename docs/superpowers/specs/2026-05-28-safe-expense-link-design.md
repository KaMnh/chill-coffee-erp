# Safe Withdraw → Expense Link (owner-only visibility) — Design Spec

**Date:** 2026-05-28
**Branch (to be created):** `feat/safe-expense-link`
**Base:** `main` (post-v4.1.15)
**Tag at end:** `v4.1.16`

---

## 0. TL;DR

Khi owner gọi `safe_withdraw_other(amount, category, description)`, server tự động
insert thêm 1 row vào `public.expenses` để khoản chi xuất hiện trong sổ chi cùng
expense thường. **Chỉ owner thấy** các expense này — manager, staff_operator,
employee_viewer đều bị ẩn HOÀN TOÀN (không thấy row, không vào KPI total, không
vào breakdown). Cơ chế hide bằng **1 RLS policy duy nhất** trên `public.expenses`
→ mọi RPC + direct SELECT đều respect tự động, không phải sửa từng query.

Schema change: thêm `expenses.safe_transaction_id uuid NULL` (FK → safe_transactions).

---

## 1. Goal

Owner thường rút tiền mặt từ sổ quỹ (`safe_withdraw_other`) để chi cho việc cá nhân
hoặc khoản chi nhạy cảm. Hiện tại các khoản này chỉ xuất hiện trong sổ quỹ (safe
ledger), không có dấu vết trong sổ chi → khi chốt sổ tháng, owner không thấy chúng
trong tổng chi.

Mục tiêu:

1. Tự động tạo expense row tương ứng → khoản chi xuất hiện trong sổ chi (cashflow
   breakdown, dashboard expense log, reports — đối với owner).
2. Giữ kín nội dung với staff/manager — chỉ owner thấy. Manager nhìn vào tổng
   chi cả ngày không bao gồm các khoản này, và không thấy chúng xuất hiện trong
   bất kỳ list nào.

**Acceptance criteria**

- Owner gọi `safe_withdraw_other(100000, 'rent', 'Tiền thuê tháng 5')` → ngay sau
  RPC return, có 1 row trong `expenses` với `amount=100000`, `description='Tiền
  thuê tháng 5'`, `safe_transaction_id` = vừa tạo, `payment_method='other'`.
- Login owner → mở /expenses, /cash-flow, dashboard expense log: **thấy** expense
  này như mọi expense khác.
- Login manager / staff_operator / employee_viewer → 3 màn trên: **không thấy**
  expense này. KPI "Tổng chi" và cashflow `out` / `expense_breakdown` không bao
  gồm. Direct SELECT từ supabase-js (qua RLS) trả 0 rows.
- pgTAP regression: assert owner select trả thấy row, manager select trả không
  thấy.
- `npm run verify` pass.

---

## 2. Non-Goals (deferred)

| Item | Reason / defer-to |
|---|---|
| Edit safe withdraw → cascade update expense | RPC edit cho withdraw_other hiện không tồn tại. Defer khi có. |
| Void safe withdraw → soft-delete expense | Hiện withdraw_other dùng adjustment để reverse, không có void. Adjustment KHÔNG tạo expense ngược (out of scope). |
| UI thay đổi `WithdrawSafeModal` | Hint nhỏ "Tự ghi vào sổ chi" là nice-to-have nhưng KHÔNG bắt buộc; user request rõ về DB behavior, không nói UI. Đề xuất 1 dòng helper text dưới description (1 LOC). |
| Mapping `reason_category` → `expense_category_id` | YAGNI v1. `expenses.category_id = NULL` (rơi vào "(chưa phân loại)" trong cashflow breakdown). User có thể categorize sau qua sổ chi UI nếu cần. |
| Hide reason_category (safe ledger) cho manager | Manager đã không có quyền vào sổ quỹ (`safe_list_transactions` là owner-only). Không cần đụng. |
| Audit log riêng cho "expense ẩn được tạo" | Existing `cash_drawer_events` không apply (xem §3.3). Defer riêng audit nếu cần. |
| Khoản rút_open (`withdraw_open`) cũng auto-tạo expense | Đó là tiền MỞ KÉT đầu ngày — không phải chi tiêu. Không apply. |

---

## 3. Architecture

### 3.1 Schema change

Migration `database/migrations/2026-05-28-b-expenses-safe-link.sql`:

```sql
alter table public.expenses
  add column if not exists safe_transaction_id uuid null
    references public.safe_transactions(id) on delete restrict;

create index if not exists expenses_safe_transaction_id_idx
  on public.expenses(safe_transaction_id)
  where safe_transaction_id is not null;
```

- `on delete restrict` — `safe_transactions` immutable hiện tại; restrict an toàn.
- Partial index — đa số expense là NULL, chỉ index khi NOT NULL để tối ưu.

### 3.2 RPC extension — `safe_withdraw_other`

Hiện tại (database/002_functions.sql:~1700) insert vào `safe_transactions` xong
return. Extend: thêm 1 INSERT vào `expenses` sau khi safe_transaction tạo thành công.

```sql
-- Inside safe_withdraw_other (after safe_transactions insert):
insert into public.expenses (
  business_date,
  description,
  amount,
  payment_method,
  category_id,
  safe_transaction_id,
  created_by
)
values (
  current_date,              -- hoặc lấy từ safe_transactions.occurred_at::date
  v_description,             -- copy từ p_description
  v_amount,                  -- copy từ p_amount
  'other',                   -- KHÔNG 'cash' (xem §3.3)
  null,                      -- category_id NULL — không map từ reason_category
  v_safe_txn_id,             -- link FK
  auth.uid()
);
```

**Lưu ý**: `payment_method='other'` để KHÔNG trigger logic auto-insert
`cash_drawer_events` mà `create_expense` (RPC) đang làm. Tránh double-count tiền
mặt (tiền đã rời safe vault chứ không phải till). RPC `safe_withdraw_other`
KHÔNG gọi `create_expense` — chỉ direct insert.

### 3.3 RLS policy — hide safe-sourced rows from non-owner

Sửa policy `expenses_staff_read` (đã có trong `database/003_rls.sql:113-125`):

```sql
drop policy if exists expenses_staff_read on public.expenses;
create policy expenses_staff_read on public.expenses for select to authenticated using (
  case
    when expenses.safe_transaction_id is not null then
      -- Safe-sourced expense: owner only
      public.app_role() = 'owner'
    else
      -- Manual expense: existing logic (staff+ or viewer with date-range)
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
```

**Defense in depth**: update + delete policies (`expenses_manager_update`,
`expenses_manager_delete`) cũng siết — manager không update/delete được
safe-sourced row:

```sql
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

drop policy if exists expenses_manager_delete on public.expenses;
create policy expenses_manager_delete on public.expenses for delete to authenticated
using (
  case
    when expenses.safe_transaction_id is not null then public.app_role() = 'owner'
    else public.app_is_owner_manager()
  end
);
```

INSERT policy không cần đụng — `safe_withdraw_other` chạy `security definer` bypass
RLS; client code không bao giờ direct-insert với `safe_transaction_id`.

### 3.4 RPC quirk — `dashboard_daily_ops` + `cash_flow_overview`

Cả 2 RPCs này là `security definer` → BYPASS RLS. Để RLS apply, ta phải hoặc:

- **A. Đổi chúng thành `security invoker`**: tốn effort, có thể vỡ logic khác.
- **B. Inline filter trong RPC**: `WHERE safe_transaction_id IS NULL OR app_role() = 'owner'`.

**Chọn B** — surgical, chỉ thêm 1 dòng WHERE vào mỗi RPC query đụng `expenses`:

- `dashboard_daily_ops` — query expenses cho today + filter cũ; thêm AND.
- `cash_flow_overview` — 2 query: `outs` CTE (line ~57-67) + `cat_totals` CTE
  (line ~96-115). Thêm AND vào cả 2.
- `expense_summary_by_category` (Phase 5C) — 1 query, thêm AND.
- Bất kỳ RPC nào select từ `expenses` (grep `from public.expenses` trong
  002_functions.sql + migrations) — đụng hết.

Wrapper helper pattern:

```sql
-- new inline predicate (or could be a function for DRY)
where ... 
  and (e.safe_transaction_id is null or public.app_role() = 'owner')
```

Có thể wrap thành 1 helper inline view nếu muốn DRY, nhưng v1 đơn giản nhất là
inline trong từng query. Có ~3-4 RPCs cần đụng.

### 3.5 Frontend

**Không đổi UI** trong sổ chi / cashflow / dashboard — server-side filter (RLS +
RPC inline) tự xử lý.

**WithdrawSafeModal** thêm 1 dòng helper text dưới description field (1 LOC):
> "Khoản này sẽ được ghi vào sổ chi (chỉ owner xem được)."

Helps owner hiểu side effect. Không bắt buộc.

---

## 4. Validation rules

| Rule | Where checked |
|---|---|
| `expenses.amount >= 0 AND <= 1000000000` (existing CHECK) | Schema |
| `expenses.safe_transaction_id` FK valid hoặc NULL | Schema (FK constraint) |
| safe_withdraw_other vẫn owner-only (`app_role() = 'owner'`) | RPC line 1 |
| Manager direct supabase-js SELECT trả 0 rows cho safe-sourced | RLS |
| Manager cashflow page total chi không bao gồm safe-sourced | RPC inline WHERE |

---

## 5. Verification

### Local

1. **Apply migration**:
   ```bash
   cat database/migrations/2026-05-28-b-expenses-safe-link.sql \
     | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -
   ```

2. **Verify column + index**:
   ```bash
   docker compose exec -T db psql -U postgres -d postgres -c "\d public.expenses"
   ```
   Expect: `safe_transaction_id uuid` + `expenses_safe_transaction_id_idx`.

3. **End-to-end smoke (owner)**:
   ```sql
   SET LOCAL request.jwt.claims TO '{"sub":"<owner_uuid>","role":"authenticated"}';
   SET LOCAL role TO 'authenticated';
   SELECT public.safe_withdraw_other(100000, 'rent', 'Test withdraw');
   SELECT id, amount, description, safe_transaction_id
     FROM public.expenses
    WHERE safe_transaction_id IS NOT NULL
    ORDER BY created_at DESC LIMIT 1;
   ```
   Expect: 1 row với amount 100000, description 'Test withdraw', safe_transaction_id non-null.

4. **Manager hidden check**:
   ```sql
   -- Switch to manager JWT
   SET LOCAL request.jwt.claims TO '{"sub":"<manager_uuid>","role":"authenticated"}';
   SET LOCAL role TO 'authenticated';
   SELECT count(*) FROM public.expenses WHERE safe_transaction_id IS NOT NULL;
   -- Expect: 0
   SELECT (public.dashboard_daily_ops(current_date) -> 'kpi' ->> 'total_expenses')::numeric;
   -- Expect: does NOT include the 100000 withdraw amount
   SELECT (public.cash_flow_overview(current_date - 7, current_date) ->> 'out')::numeric;
   -- Expect: total OUT does NOT include 100000
   ```

5. **pgTAP** — thêm tests vào `database/tests/` (e.g., `230_safe_expense_link.sql`):
   - Owner select sees safe-sourced row
   - Manager select returns 0
   - `cash_flow_overview` for manager omits safe-sourced amount in `out`
   - `dashboard_daily_ops` for manager omits in `total_expenses`

### App smoke

6. Login owner → /safe → "Rút khác" → nhập 50k, category=rent, mô tả "Test owner"
   → Submit → Login owner → /expenses → thấy row mới + amount 50k.
7. Logout, login manager → /expenses → KHÔNG thấy row đó. Dashboard "Tổng chi"
   không bao gồm 50k. Cashflow `/cash-flow` breakdown không bao gồm.

### CI

8. `npx tsc --noEmit` clean.
9. `npx vitest run` pass.
10. `npm run verify:phase` pass (pgTAP green including new 230_*.sql).

---

## 6. Execution order

1. Branch `feat/safe-expense-link` off origin/main (post-v4.1.15 = `6996677`).
2. SQL migration `2026-05-28-b-expenses-safe-link.sql`: add column + index.
3. SQL migration `2026-05-28-c-safe-expense-rls.sql` (separate for clarity): drop+create
   3 RLS policies với case-based logic. KHÔNG patch `database/003_rls.sql` (latter is
   bootstrap, RLS changes propagate via migrations).
4. Patch `safe_withdraw_other` trong `002_functions.sql` (full RPC redefine theo
   convention — đây là core function, KHÁC `cash_flow_overview` không nằm trong 002).
   Hoặc tạo migration `2026-05-28-d-safe-withdraw-other-expense.sql` redefine function.
5. Patch các RPC đụng expenses query — inline AND clause:
   - `dashboard_daily_ops`
   - `cash_flow_overview` (qua migration `2026-05-28-e-cashflow-hide-safe-expenses.sql`)
   - `expense_summary_by_category` (Phase 5C)
   - Bất kỳ RPC khác phát hiện qua `grep "from public.expenses" database/`.
6. Apply migrations local + manual smoke (steps 1-4 §5).
7. Frontend: thêm helper text 1 LOC vào WithdrawSafeModal.
8. pgTAP 230_safe_expense_link.sql.
9. Local verify (tsc + vitest + npm verify:phase).
10. Commit + push + PR → CI → merge → tag v4.1.16.

---

## 7. Open assumptions / risks

- **payment_method='other'** chọn để tránh `create_expense` style cash_drawer
  side effect, nhưng `safe_withdraw_other` direct-insert KHÔNG đi qua `create_expense`
  nên technically cash_drawer không bị đụng. Vẫn dùng 'other' cho rõ ngữ nghĩa
  (tiền không phải từ till).
- **business_date**: dùng `current_date` (server side, tz Asia/Ho_Chi_Minh) — nếu
  user rút ban đêm sau midnight, expense vẫn vào ngày-kế-tiếp. Có thể đổi sang
  `safe_transactions.occurred_at::date` nếu cần khớp với business_date của safe.
  Defer quyết định, mặc định = current_date.
- **RLS case-based**: kiểm tra rằng `case when ... then ... else ... end` không
  bị PostgreSQL coerce sai trong RLS context. Pattern này được dùng trong các
  Phase trước (ví dụ permissions table).
- **RPC `security definer` bypass RLS**: nếu QUÊN inline filter trong 1 RPC nào
  đó đụng expenses, manager có thể leak. Mitigation: §6 step 5 grep tất cả `from
  public.expenses` và đụng hết. Liệt kê + verify trong PR.
- **Karpathy surgical**: 1 column add + 1 RPC extend + 3 RLS policies replace +
  ~3-4 RPC inline filter + 1 line frontend. Surface assumptions ở §7. Verifiable
  via pgTAP + manual smoke.
- **i18n**: Tiếng Việt.
