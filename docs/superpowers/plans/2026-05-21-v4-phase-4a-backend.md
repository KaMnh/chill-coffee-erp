# Phase 4.A — Inventory Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the entire inventory backend (5 tables, ~12 RPCs, 1 trigger, RLS, types, data layer, query hooks, 37 new pgTAP assertions) with no UI code. Existing 50 pgTAP assertions stay green byte-for-byte.

**Architecture:** Amend Phase 1 SQL files (`001_schema.sql`, `002_functions.sql`, `003_rls.sql`) in place — matches Phase 3 pattern. Auto-deduction lives in an `AFTER INSERT FOR EACH ROW` trigger on `sales_order_items` (the existing `ingest_kiotviet_batch` RPC is NOT modified). `EXCEPTION WHEN OTHERS` block in the trigger guarantees sales ingest never breaks. All write RPCs are SECURITY DEFINER, gate by role via `public.app_role()`, and emit audit_log entries.

**Tech Stack:** PostgreSQL 15 (Supabase) · pgTAP · TypeScript strict · TanStack Query 5 · Supabase JS

---

## Conventions (read before any task)

**Audit log columns.** Spec §6 used placeholder column names (`event_type`, `actor_id`, `payload`, `created_at`). The actual `audit_log` schema in `001_schema.sql:` uses `action`, `actor_user_id`, `diff_json`, `occurred_at` (default), plus required `entity_type` and optional `entity_id`. All audit inserts in this plan use the actual schema:

```sql
INSERT INTO public.audit_log (actor_user_id, actor_role, action, entity_type, entity_id, diff_json)
VALUES (auth.uid(), public.app_role(), '<event>', '<entity>', <id>, <jsonb>);
```

`public.app_role()` is an existing helper that returns the caller's role from JWT claims.

**Commit messages.** PowerShell here-strings break on Vietnamese diacritics. Use this pattern every time:

```powershell
$msg = @'
<commit subject>

<body...>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add <files>
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

**Schema reset / migration.** `npm run db:init` runs `000_reset.sql` through `005_storage.sql` in order. Idempotent — safe to re-run after each SQL change.

**pgTAP runner.** `npm run pgtap` iterates every file in `database/tests/*.sql` in lexicographic order, runs each in a transaction (`BEGIN; ... ROLLBACK;`), counts assertions. Single-file run not supported; full suite always.

**Existing baseline before T1:** 75 Vitest + 50 pgTAP = 125 green.
**Target after T11:** 75 Vitest + 87 pgTAP = 162 green.

---

## File Structure

| File | Action | Touched in task |
|------|--------|------------------|
| `database/001_schema.sql` | Append 5 tables + indexes + constraints | T1 |
| `database/002_functions.sql` | Append trigger function + ~12 RPCs | T2 (trigger), T3 (ingredients), T4 (menu_items), T5 (recipes), T6 (stock) |
| `database/003_rls.sql` | Append RLS for 5 tables | T8 |
| `database/tests/090_ingredients_crud.sql` | Create | T3 |
| `database/tests/100_menu_items_crud.sql` | Create | T4 |
| `database/tests/110_recipes_upsert.sql` | Create | T5 |
| `database/tests/120_stock_movements.sql` | Create | T6 |
| `database/tests/130_stock_counts.sql` | Create | T6 |
| `database/tests/140_sale_deduction_trigger.sql` | Create | T7 |
| `database/tests/150_rls_inventory.sql` | Create | T8 |
| `src/lib/types.ts` | Append 7 types | T9 |
| `src/lib/data/inventory.ts` | Create | T9 |
| `src/lib/data/index.ts` | Append re-export | T9 |
| `src/hooks/queries/keys.ts` | Append `queryKeys.inventory*` | T10 |
| `src/hooks/queries/use-inventory-queries.ts` | Create | T10 |
| `src/hooks/queries/index.ts` | Append re-exports | T10 |

---

### Task 1: Schema additions (5 tables + indexes)

**Files:**
- Modify: `database/001_schema.sql` (append)

- [ ] **Step 1: Locate insertion point in `database/001_schema.sql`**

Run: `tail -20 database/001_schema.sql`
Expected: the file ends with the last Phase 3 table or a permissions block. Append the new section AFTER the last existing CREATE TABLE / index / constraint but BEFORE any final `GRANT` block (if present).

- [ ] **Step 2: Append the 5 inventory tables**

Open `database/001_schema.sql` and append at end-of-file:

```sql

-- =====================================================================
-- Phase 4.A — Inventory module
-- =====================================================================

create table if not exists public.ingredients (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  unit                  text not null,
  low_stock_threshold   numeric(18, 4),
  is_active             boolean not null default true,
  notes                 text,
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id),
  constraint ingredients_name_not_empty check (length(trim(name)) > 0),
  constraint ingredients_unit_not_empty check (length(trim(unit)) > 0),
  constraint ingredients_threshold_non_negative check (
    low_stock_threshold is null or low_stock_threshold >= 0
  )
);

create index if not exists idx_ingredients_active
  on public.ingredients(is_active) where is_active = true;

create table if not exists public.menu_items (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null unique,
  external_product_name   text,
  is_active               boolean not null default true,
  notes                   text,
  created_at              timestamptz not null default now(),
  created_by              uuid references public.profiles(id),
  constraint menu_items_name_not_empty check (length(trim(name)) > 0),
  constraint menu_items_external_name_not_empty check (
    external_product_name is null or length(trim(external_product_name)) > 0
  )
);

create index if not exists idx_menu_items_ext_name_active
  on public.menu_items (lower(trim(external_product_name)))
  where external_product_name is not null and is_active = true;

create table if not exists public.recipes (
  id              uuid primary key default gen_random_uuid(),
  menu_item_id    uuid not null unique references public.menu_items(id),
  is_active       boolean not null default true,
  notes           text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_recipes_active
  on public.recipes(menu_item_id) where is_active = true;

create table if not exists public.recipe_items (
  recipe_id       uuid not null references public.recipes(id) on delete cascade,
  ingredient_id   uuid not null references public.ingredients(id),
  quantity        numeric(18, 4) not null,
  constraint recipe_items_quantity_positive check (quantity > 0),
  primary key (recipe_id, ingredient_id)
);

create table if not exists public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  ingredient_id     uuid not null references public.ingredients(id),
  quantity_delta    numeric(18, 4) not null,
  reason            text not null,
  occurred_at       timestamptz not null default now(),
  source_order_id   uuid references public.sales_orders(id),
  source_recipe_id  uuid references public.recipes(id),
  notes             text,
  created_by        uuid references public.profiles(id),
  created_at        timestamptz not null default now(),
  constraint stock_movements_reason_valid check (reason in (
    'purchase_received',
    'sale_theoretical',
    'manual_adjustment_in',
    'manual_adjustment_out',
    'count_correction',
    'waste'
  )),
  constraint stock_movements_delta_nonzero check (
    quantity_delta != 0 or reason = 'count_correction'
  ),
  constraint stock_movements_sign_matches_reason check (
    case
      when reason = 'purchase_received'     then quantity_delta > 0
      when reason = 'manual_adjustment_in'  then quantity_delta > 0
      when reason = 'manual_adjustment_out' then quantity_delta < 0
      when reason = 'waste'                 then quantity_delta < 0
      when reason = 'sale_theoretical'      then quantity_delta < 0
      when reason = 'count_correction'      then true
      else false
    end
  )
);

create index if not exists idx_stock_movements_ingredient_occurred
  on public.stock_movements (ingredient_id, occurred_at desc);
create index if not exists idx_stock_movements_reason
  on public.stock_movements (reason);
```

- [ ] **Step 3: Apply migrations**

Run: `npm run db:init`
Expected: clean output, no errors, all 5 tables created. If you see `relation "ingredients" already exists`, that's OK because of the `if not exists` clauses — re-run is idempotent. If you see a CHECK constraint error or syntax error, fix the DDL and re-run.

- [ ] **Step 4: Verify existing pgTAP suite still passes (regression check)**

Run: `npm run pgtap`
Expected: `Files run: 9` (existing test files) and `Total assertions passed: 50`. If any existing assertion fails, the schema change broke something — STOP and investigate.

- [ ] **Step 5: Commit**

```powershell
$msg = @'
feat(phase-4a): schema for inventory tables

5 new tables in public namespace (Phase 4.A backend foundation):
- ingredients (name unique, unit, optional low_stock_threshold, is_active)
- menu_items (name unique, optional external_product_name for KiotViet match)
- recipes (1:1 with menu_items via UNIQUE constraint; variants out of scope)
- recipe_items (junction with quantity > 0)
- stock_movements (signed ledger with 6-value reason CHECK + sign-vs-reason CHECK)

Functional partial index on menu_items.LOWER(TRIM(external_product_name))
supports the upcoming auto-deduction trigger's case-insensitive lookup.

Backward compat: all 50 existing pgTAP assertions still pass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/001_schema.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 2: Auto-deduction trigger function + trigger

**Files:**
- Modify: `database/002_functions.sql` (append trigger function + CREATE TRIGGER)

- [ ] **Step 1: Locate insertion point**

Run: `tail -20 database/002_functions.sql`
Expected: ends with the last Phase 3 RPC (probably `update_handover_session_tasks` or similar). Append after the last function.

- [ ] **Step 2: Append the trigger function and trigger**

Append at end-of-file:

```sql

-- =====================================================================
-- Phase 4.A — Inventory: auto-deduction trigger
-- =====================================================================

create or replace function public._apply_sale_deductions_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_item_id  uuid;
  v_recipe_id     uuid;
  v_item          record;
begin
  -- 1. Match menu_item by case-insensitive trimmed external_product_name
  select id into v_menu_item_id
  from public.menu_items
  where external_product_name is not null
    and lower(trim(external_product_name)) = lower(trim(new.product_name))
    and is_active = true
  limit 1;

  if v_menu_item_id is null then
    return new;
  end if;

  -- 2. Active recipe?
  select id into v_recipe_id
  from public.recipes
  where menu_item_id = v_menu_item_id and is_active = true
  limit 1;

  if v_recipe_id is null then
    return new;
  end if;

  -- 3. Emit one stock_movement per recipe_item, scaled by new.quantity
  for v_item in
    select ingredient_id, quantity from public.recipe_items where recipe_id = v_recipe_id
  loop
    insert into public.stock_movements (
      ingredient_id, quantity_delta, reason, occurred_at,
      source_order_id, source_recipe_id, created_by
    ) values (
      v_item.ingredient_id,
      -(v_item.quantity * new.quantity),
      'sale_theoretical',
      new.created_at,
      new.order_id,
      v_recipe_id,
      null
    );
  end loop;

  return new;

exception when others then
  -- Defense-in-depth: never break ingest. Log + return new.
  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    null, null, 'inventory_deduction_error', 'sales_order_item', new.id,
    jsonb_build_object(
      'order_id', new.order_id,
      'product_name', new.product_name,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_apply_sale_deductions on public.sales_order_items;

create trigger trg_apply_sale_deductions
after insert on public.sales_order_items
for each row
execute function public._apply_sale_deductions_row();
```

- [ ] **Step 3: Apply migrations**

Run: `npm run db:init`
Expected: clean migration, trigger created. If you see `function _apply_sale_deductions_row() does not exist` from a downstream user of the trigger, re-check the function syntax.

- [ ] **Step 4: Backward-compat regression check**

Run: `npm run pgtap`
Expected: `Files run: 9` and `Total assertions passed: 50`. Critical — if any existing assertion breaks, the trigger is interfering with `010-080` tests. Since none of those tests populate `menu_items`, the trigger should no-op and have zero side effects. If a test fails, inspect the failure carefully:
- If error message mentions `_apply_sale_deductions_row`, fix the function (likely a typo).
- If error message mentions `RAISE EXCEPTION`, the EXCEPTION block isn't catching properly.
- If a count assertion fails (more stock_movements than expected), check WHERE filters in the affected test.

- [ ] **Step 5: Commit**

```powershell
$msg = @'
feat(phase-4a): auto-deduction trigger on sales_order_items

_apply_sale_deductions_row() trigger function:
- Match menu_item by case-insensitive trimmed external_product_name
- Look up active recipe; if none, return early (no-op)
- Emit one stock_movements row per recipe_item, scaled by NEW.quantity
- quantity_delta = -(recipe_item.quantity * sold_quantity)
- reason = 'sale_theoretical'
- source_order_id + source_recipe_id set for audit trail
- created_by = NULL (system-generated)

EXCEPTION WHEN OTHERS block guarantees ingest never breaks:
errors logged to audit_log as 'inventory_deduction_error', then RETURN NEW.

trg_apply_sale_deductions: AFTER INSERT FOR EACH ROW on sales_order_items.

Backward compat verified: 50/50 existing pgTAP assertions still pass.
(Trigger no-ops because test data has zero menu_items rows.)

The Phase 1 ingest_kiotviet_batch RPC is NOT modified.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/002_functions.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 3: Ingredients RPCs + pgTAP

**Files:**
- Modify: `database/002_functions.sql` (append 4 RPCs)
- Create: `database/tests/090_ingredients_crud.sql`

- [ ] **Step 1: Write the failing pgTAP test first**

Create `database/tests/090_ingredients_crud.sql`:

```sql
-- Phase 4.A — Ingredients CRUD RPCs.
--
-- 6 assertions:
--   1. create_ingredient returns a uuid; row exists with trimmed name
--   2. Duplicate name throws unique violation
--   3. Blank name throws CHECK constraint violation
--   4. update_ingredient can soft-delete (is_active = false)
--   5. delete_ingredient succeeds when no references
--   6. delete_ingredient hard-fails when stock_movement references

begin;
select plan(6);

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

-- Fixtures: owner user
insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Test 1: create_ingredient returns a uuid; name trimmed
do $$
declare v_id uuid;
begin
  v_id := public.create_ingredient('  Sữa tươi  ', 'L', 5, 'Carton 1L');
  perform ok(v_id is not null, 'create_ingredient returns uuid');
  perform is(
    (select name from public.ingredients where id = v_id),
    'Sữa tươi',
    'name stored trimmed'
  );
end $$;

-- Test 2: Duplicate name throws
select throws_ok(
  $$ select public.create_ingredient('Sữa tươi', 'L', null, null) $$,
  '23505',  -- unique_violation
  null,
  'duplicate ingredient name rejected'
);

-- Test 3: Blank name throws CHECK
select throws_ok(
  $$ select public.create_ingredient('   ', 'L', null, null) $$,
  '23514',  -- check_violation
  null,
  'blank ingredient name rejected by CHECK'
);

-- Test 4: update_ingredient sets is_active=false
do $$
declare v_id uuid;
begin
  select id into v_id from public.ingredients where name = 'Sữa tươi';
  perform public.update_ingredient(v_id, 'Sữa tươi', 'L', 5, null, false);
  perform is(
    (select is_active from public.ingredients where id = v_id),
    false,
    'update_ingredient sets is_active=false'
  );
end $$;

-- Test 5: delete_ingredient succeeds when no references
do $$
declare v_id uuid;
begin
  v_id := public.create_ingredient('Đường', 'kg', null, null);
  perform public.delete_ingredient(v_id);
  perform ok(
    not exists (select 1 from public.ingredients where id = v_id),
    'delete_ingredient removes row when no references'
  );
end $$;

-- Test 6: delete_ingredient hard-fails when referenced by stock_movement
do $$
declare v_id uuid;
begin
  v_id := public.create_ingredient('Cà phê hạt', 'kg', null, null);
  perform public.record_stock_movement(v_id, 5, 'purchase_received', 'seed');
  perform throws_like(
    format('select public.delete_ingredient(%L::uuid)', v_id),
    '%giao dịch tồn kho%',
    'delete fails when stock_movements reference'
  );
end $$;

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test and confirm it FAILS**

Run: `npm run pgtap`
Expected: file `090_ingredients_crud.sql` fails because `public.create_ingredient` does not exist yet. Other 9 files still pass (50 assertions).

- [ ] **Step 3: Append RPCs to `database/002_functions.sql`**

Append at end-of-file:

```sql

-- =====================================================================
-- Phase 4.A — Ingredients CRUD
-- =====================================================================

create or replace function public.create_ingredient(
  p_name                text,
  p_unit                text,
  p_low_stock_threshold numeric default null,
  p_notes               text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền tạo nguyên liệu.';
  end if;

  insert into public.ingredients (name, unit, low_stock_threshold, notes, created_by)
  values (trim(p_name), trim(p_unit), p_low_stock_threshold, p_notes, auth.uid())
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'ingredient_created', 'ingredient', v_new_id,
    jsonb_build_object('name', trim(p_name), 'unit', trim(p_unit),
                       'low_stock_threshold', p_low_stock_threshold)
  );

  return v_new_id;
end;
$$;

create or replace function public.update_ingredient(
  p_id                  uuid,
  p_name                text,
  p_unit                text,
  p_low_stock_threshold numeric,
  p_notes               text,
  p_is_active           boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền chỉnh sửa nguyên liệu.';
  end if;

  update public.ingredients
     set name = trim(p_name),
         unit = trim(p_unit),
         low_stock_threshold = p_low_stock_threshold,
         notes = p_notes,
         is_active = p_is_active
   where id = p_id;

  if not found then
    raise exception 'Không tìm thấy nguyên liệu với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'ingredient_updated', 'ingredient', p_id,
    jsonb_build_object('name', trim(p_name), 'is_active', p_is_active)
  );
end;
$$;

create or replace function public.delete_ingredient(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền xóa nguyên liệu.';
  end if;

  if exists (select 1 from public.stock_movements where ingredient_id = p_id) then
    raise exception 'Không thể xóa: nguyên liệu đã có giao dịch tồn kho. Hãy đặt is_active = false để vô hiệu hóa.';
  end if;

  if exists (select 1 from public.recipe_items where ingredient_id = p_id) then
    raise exception 'Không thể xóa: nguyên liệu đang được dùng trong công thức. Hãy xóa khỏi công thức trước.';
  end if;

  delete from public.ingredients where id = p_id;

  if not found then
    raise exception 'Không tìm thấy nguyên liệu với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'ingredient_deleted', 'ingredient', p_id,
    jsonb_build_object()
  );
end;
$$;

create or replace function public.list_ingredients()
returns table (
  id                  uuid,
  name                text,
  unit                text,
  low_stock_threshold numeric,
  is_active           boolean,
  notes               text,
  created_at          timestamptz
)
language sql
stable
set search_path = public
as $$
  select i.id, i.name, i.unit, i.low_stock_threshold,
         i.is_active, i.notes, i.created_at
  from public.ingredients i
  order by i.name;
$$;
```

- [ ] **Step 4: Apply migrations**

Run: `npm run db:init`
Expected: clean. If you see `function record_stock_movement does not exist` from Test 6, that's expected — `record_stock_movement` is added in Task 6. We're testing this in isolation; Test 6 will fail until Task 6 lands. **Do not fix this by adding `record_stock_movement` here — Task 6 will handle it.** For now Test 6's `record_stock_movement` call inside the test will throw because the function doesn't exist. Continue.

**Important:** the pgTAP file uses `perform public.record_stock_movement(...)` inside a `do $$` block. This will throw at runtime, meaning Test 6 will fail. That's expected at this checkpoint. We'll re-run after Task 6 lands and confirm all 6 assertions pass.

- [ ] **Step 5: Run pgTAP suite**

Run: `npm run pgtap`
Expected: assertions 1–5 of `090_ingredients_crud.sql` pass. Test 6 may fail or throw at runtime (we tolerate this — Task 6 will fix). Total assertions passed: at least 50 (existing) + 5 (new) = 55.

If assertions 1–5 all pass and Test 6 throws cleanly (not breaking other tests), proceed. If assertions 1–5 fail, fix the RPC and re-run.

- [ ] **Step 6: Commit**

```powershell
$msg = @'
feat(phase-4a): ingredients CRUD RPCs + pgTAP 090

4 new RPCs in 002_functions.sql:
- create_ingredient (owner/manager, trims name+unit, validates)
- update_ingredient (owner/manager, supports soft-delete via is_active)
- delete_ingredient (owner/manager, hard-fails if referenced by
  stock_movements or recipe_items with Vietnamese error hints)
- list_ingredients (all roles can read, STABLE, ordered by name)

All write RPCs emit audit_log entries via the established
(actor_user_id, actor_role, action, entity_type, entity_id, diff_json)
schema. Role gating via public.app_role().

pgTAP 090_ingredients_crud.sql with 6 assertions:
1. create returns uuid; name trimmed on storage
2. duplicate name raises unique_violation
3. blank name raises check_violation
4. update can soft-delete via is_active=false
5. delete succeeds with no references
6. delete hard-fails when referenced by stock_movement
   (Test 6 will pass after Task 6 lands record_stock_movement.)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/002_functions.sql database/tests/090_ingredients_crud.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 4: Menu items RPCs + pgTAP

**Files:**
- Modify: `database/002_functions.sql` (append 4 RPCs)
- Create: `database/tests/100_menu_items_crud.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `database/tests/100_menu_items_crud.sql`:

```sql
-- Phase 4.A — Menu items CRUD RPCs.
--
-- 5 assertions:
--   1. create_menu_item returns uuid; external_product_name preserved
--   2. nullable external_product_name accepted
--   3. duplicate name raises unique_violation
--   4. update can soft-delete
--   5. delete hard-fails when referenced by active recipe

begin;
select plan(5);

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

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Test 1: create_menu_item with external_product_name
do $$
declare v_id uuid;
begin
  v_id := public.create_menu_item('Cà phê đen đá M', 'Cafe den da M', null);
  perform ok(v_id is not null, 'create_menu_item returns uuid');
  perform is(
    (select external_product_name from public.menu_items where id = v_id),
    'Cafe den da M',
    'external_product_name stored as-is'
  );
end $$;

-- Test 2: nullable external_product_name
do $$
declare v_id uuid;
begin
  v_id := public.create_menu_item('No matcher', null, null);
  perform ok(v_id is not null, 'nullable external_product_name accepted');
end $$;

-- Test 3: duplicate name
select throws_ok(
  $$ select public.create_menu_item('Cà phê đen đá M', null, null) $$,
  '23505',
  null,
  'duplicate menu_item name rejected'
);

-- Test 4: update soft-delete
do $$
declare v_id uuid;
begin
  select id into v_id from public.menu_items where name = 'Cà phê đen đá M';
  perform public.update_menu_item(v_id, 'Cà phê đen đá M', 'Cafe den da M', null, false);
  perform is(
    (select is_active from public.menu_items where id = v_id),
    false,
    'update_menu_item soft-deletes via is_active=false'
  );
end $$;

-- Test 5: delete hard-fails when active recipe references
do $$
declare
  v_menu_id uuid;
  v_ing_id  uuid;
begin
  v_menu_id := public.create_menu_item('With recipe', 'with_recipe', null);
  v_ing_id  := public.create_ingredient('Test Ing', 'g', null, null);
  perform public.upsert_recipe(
    v_menu_id, true, null,
    jsonb_build_array(jsonb_build_object('ingredient_id', v_ing_id, 'quantity', 10))
  );
  perform throws_like(
    format('select public.delete_menu_item(%L::uuid)', v_menu_id),
    '%đang có công thức%',
    'delete_menu_item fails when recipe exists'
  );
end $$;

select * from finish();
rollback;
```

- [ ] **Step 2: Run pgTAP and confirm Test 1-4 fail (Test 5 depends on Task 5)**

Run: `npm run pgtap`
Expected: file `100_menu_items_crud.sql` fails because `create_menu_item` doesn't exist. Existing 55 assertions (50 baseline + 5 from Task 3) still pass.

- [ ] **Step 3: Append RPCs to `database/002_functions.sql`**

Append:

```sql

-- =====================================================================
-- Phase 4.A — Menu items CRUD
-- =====================================================================

create or replace function public.create_menu_item(
  p_name                  text,
  p_external_product_name text default null,
  p_notes                 text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền tạo sản phẩm.';
  end if;

  insert into public.menu_items (name, external_product_name, notes, created_by)
  values (
    trim(p_name),
    case when p_external_product_name is null then null else trim(p_external_product_name) end,
    p_notes,
    auth.uid()
  )
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'menu_item_created', 'menu_item', v_new_id,
    jsonb_build_object('name', trim(p_name),
                       'external_product_name', p_external_product_name)
  );

  return v_new_id;
end;
$$;

create or replace function public.update_menu_item(
  p_id                    uuid,
  p_name                  text,
  p_external_product_name text,
  p_notes                 text,
  p_is_active             boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền chỉnh sửa sản phẩm.';
  end if;

  update public.menu_items
     set name = trim(p_name),
         external_product_name = case when p_external_product_name is null then null else trim(p_external_product_name) end,
         notes = p_notes,
         is_active = p_is_active
   where id = p_id;

  if not found then
    raise exception 'Không tìm thấy sản phẩm với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'menu_item_updated', 'menu_item', p_id,
    jsonb_build_object('name', trim(p_name), 'is_active', p_is_active)
  );
end;
$$;

create or replace function public.delete_menu_item(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền xóa sản phẩm.';
  end if;

  if exists (select 1 from public.recipes where menu_item_id = p_id) then
    raise exception 'Không thể xóa: sản phẩm đang có công thức. Hãy xóa công thức trước.';
  end if;

  delete from public.menu_items where id = p_id;

  if not found then
    raise exception 'Không tìm thấy sản phẩm với id %.', p_id;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'menu_item_deleted', 'menu_item', p_id,
    jsonb_build_object()
  );
end;
$$;

create or replace function public.list_menu_items()
returns table (
  id                    uuid,
  name                  text,
  external_product_name text,
  is_active             boolean,
  notes                 text,
  created_at            timestamptz,
  recipe_count          bigint
)
language sql
stable
set search_path = public
as $$
  select m.id, m.name, m.external_product_name, m.is_active, m.notes, m.created_at,
         (select count(*) from public.recipes r where r.menu_item_id = m.id)::bigint as recipe_count
  from public.menu_items m
  order by m.name;
$$;
```

- [ ] **Step 4: Apply migrations and run pgTAP**

Run: `npm run db:init && npm run pgtap`
Expected:
- Tests 1–4 in `100_menu_items_crud.sql` pass.
- Test 5 will throw because `upsert_recipe` doesn't exist yet (Task 5 adds it).
- Total assertions passed: at least 50 (baseline) + 5 (T3 ingredients) + 4 (T4 menu_items) = 59.

If Tests 1–4 fail, fix the RPCs and re-run. Test 5 throwing is expected at this point.

- [ ] **Step 5: Commit**

```powershell
$msg = @'
feat(phase-4a): menu_items CRUD RPCs + pgTAP 100

4 new RPCs:
- create_menu_item (owner/manager, accepts nullable external_product_name)
- update_menu_item
- delete_menu_item (hard-fails if any recipe references)
- list_menu_items (returns recipe_count via subquery)

pgTAP 100_menu_items_crud.sql with 5 assertions:
1. create returns uuid; external_product_name preserved
2. nullable external_product_name accepted
3. duplicate name raises unique_violation
4. update soft-deletes via is_active=false
5. delete hard-fails when recipe references
   (Test 5 will pass after Task 5 lands upsert_recipe.)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/002_functions.sql database/tests/100_menu_items_crud.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 5: Recipes RPCs + pgTAP

**Files:**
- Modify: `database/002_functions.sql` (append 4 RPCs)
- Create: `database/tests/110_recipes_upsert.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `database/tests/110_recipes_upsert.sql`:

```sql
-- Phase 4.A — Recipes upsert + delete + lookups.
--
-- 6 assertions:
--   1. upsert_recipe inserts when no recipe exists for menu_item
--   2. recipe_items row count matches input
--   3. upsert_recipe with same menu_item_id returns same recipe_id (update path)
--   4. upsert replaces recipe_items atomically (new count reflects new payload)
--   5. zero or negative quantity raises Vietnamese error
--   6. delete_recipe cascades recipe_items

begin;
select plan(6);

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

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- Setup: one menu_item, two ingredients
do $$
declare
  v_menu_id uuid;
  v_ing1    uuid;
  v_ing2    uuid;
  v_recipe1 uuid;
  v_recipe2 uuid;
begin
  v_menu_id := public.create_menu_item('Cà phê sữa đá', 'Cafe sua da', null);
  v_ing1 := public.create_ingredient('Cà phê hạt', 'g', null, null);
  v_ing2 := public.create_ingredient('Sữa đặc', 'ml', null, null);

  -- Test 1: insert path
  v_recipe1 := public.upsert_recipe(
    v_menu_id, true, 'v1',
    jsonb_build_array(jsonb_build_object('ingredient_id', v_ing1, 'quantity', 18))
  );
  perform ok(v_recipe1 is not null, 'upsert_recipe returns uuid on insert');

  -- Test 2: recipe_items count = 1
  perform is(
    (select count(*) from public.recipe_items where recipe_id = v_recipe1)::int,
    1,
    'recipe_items count = 1 after insert'
  );

  -- Test 3: same menu_item_id returns same recipe_id
  v_recipe2 := public.upsert_recipe(
    v_menu_id, true, 'v2',
    jsonb_build_array(
      jsonb_build_object('ingredient_id', v_ing1, 'quantity', 20),
      jsonb_build_object('ingredient_id', v_ing2, 'quantity', 25)
    )
  );
  perform is(v_recipe2, v_recipe1, 'second upsert returns same recipe id (update path)');

  -- Test 4: recipe_items replaced atomically
  perform is(
    (select count(*) from public.recipe_items where recipe_id = v_recipe1)::int,
    2,
    'recipe_items replaced atomically (count = 2)'
  );
end $$;

-- Test 5: negative quantity rejected
do $$
declare
  v_menu_id uuid;
  v_ing1    uuid;
begin
  v_menu_id := public.create_menu_item('Bad recipe target', null, null);
  v_ing1 := public.create_ingredient('Bad ing', 'g', null, null);

  perform throws_like(
    format(
      'select public.upsert_recipe(%L::uuid, true, null, %L::jsonb)',
      v_menu_id,
      jsonb_build_array(jsonb_build_object('ingredient_id', v_ing1, 'quantity', -5))::text
    ),
    '%lớn hơn 0%',
    'upsert with quantity <= 0 raises Vietnamese error'
  );
end $$;

-- Test 6: delete cascades
do $$
declare
  v_menu_id uuid;
  v_ing1    uuid;
  v_recipe  uuid;
begin
  v_menu_id := public.create_menu_item('To be deleted', null, null);
  v_ing1 := public.create_ingredient('Del ing', 'g', null, null);
  v_recipe := public.upsert_recipe(
    v_menu_id, true, null,
    jsonb_build_array(jsonb_build_object('ingredient_id', v_ing1, 'quantity', 5))
  );

  perform public.delete_recipe(v_recipe);
  perform ok(
    not exists (select 1 from public.recipe_items where recipe_id = v_recipe),
    'delete_recipe cascades recipe_items'
  );
end $$;

select * from finish();
rollback;
```

- [ ] **Step 2: Run pgTAP and confirm failure**

Run: `npm run pgtap`
Expected: `110_recipes_upsert.sql` fails because `upsert_recipe` doesn't exist.

- [ ] **Step 3: Append RPCs to `database/002_functions.sql`**

Append:

```sql

-- =====================================================================
-- Phase 4.A — Recipes
-- =====================================================================

create or replace function public.upsert_recipe(
  p_menu_item_id uuid,
  p_is_active    boolean,
  p_notes        text,
  p_items        jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_recipe_id   uuid;
  v_item        jsonb;
  v_qty         numeric;
  v_ing_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền chỉnh sửa công thức.';
  end if;

  select id into v_recipe_id from public.recipes where menu_item_id = p_menu_item_id;
  if v_recipe_id is null then
    insert into public.recipes (menu_item_id, is_active, notes, created_by)
    values (p_menu_item_id, p_is_active, p_notes, auth.uid())
    returning id into v_recipe_id;
  else
    update public.recipes
       set is_active = p_is_active, notes = p_notes, updated_at = now()
     where id = v_recipe_id;
  end if;

  delete from public.recipe_items where recipe_id = v_recipe_id;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0 then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_ing_id := (v_item->>'ingredient_id')::uuid;
      v_qty    := (v_item->>'quantity')::numeric;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Số lượng cho mỗi nguyên liệu phải lớn hơn 0.';
      end if;
      if v_ing_id is null then
        raise exception 'ingredient_id thiếu hoặc không hợp lệ.';
      end if;
      insert into public.recipe_items (recipe_id, ingredient_id, quantity)
      values (v_recipe_id, v_ing_id, v_qty);
    end loop;
  end if;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'recipe_upserted', 'recipe', v_recipe_id,
    jsonb_build_object('menu_item_id', p_menu_item_id,
                       'item_count', jsonb_array_length(coalesce(p_items, '[]'::jsonb)))
  );

  return v_recipe_id;
end;
$$;

create or replace function public.delete_recipe(p_recipe_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_menu_id     uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager') then
    raise exception 'Bạn không có quyền xóa công thức.';
  end if;

  select menu_item_id into v_menu_id from public.recipes where id = p_recipe_id;
  if v_menu_id is null then
    raise exception 'Không tìm thấy công thức với id %.', p_recipe_id;
  end if;

  delete from public.recipes where id = p_recipe_id;  -- cascades to recipe_items

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'recipe_deleted', 'recipe', p_recipe_id,
    jsonb_build_object('menu_item_id', v_menu_id)
  );
end;
$$;

create or replace function public.list_recipes()
returns table (
  recipe_id      uuid,
  menu_item_id   uuid,
  menu_item_name text,
  is_active      boolean,
  item_count     bigint,
  updated_at     timestamptz,
  notes          text
)
language sql
stable
set search_path = public
as $$
  select r.id as recipe_id,
         r.menu_item_id,
         m.name as menu_item_name,
         r.is_active,
         (select count(*) from public.recipe_items ri where ri.recipe_id = r.id)::bigint as item_count,
         r.updated_at,
         r.notes
  from public.recipes r
  join public.menu_items m on m.id = r.menu_item_id
  order by m.name;
$$;

create or replace function public.get_recipe_by_menu_item(p_menu_item_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select case
    when r.id is null then null
    else jsonb_build_object(
      'recipe_id', r.id,
      'menu_item_id', r.menu_item_id,
      'is_active', r.is_active,
      'notes', r.notes,
      'items', coalesce(
        (select jsonb_agg(jsonb_build_object(
            'ingredient_id', ri.ingredient_id,
            'ingredient_name', i.name,
            'unit', i.unit,
            'quantity', ri.quantity
          ) order by i.name)
         from public.recipe_items ri
         join public.ingredients i on i.id = ri.ingredient_id
         where ri.recipe_id = r.id),
        '[]'::jsonb
      )
    )
  end
  from public.recipes r
  where r.menu_item_id = p_menu_item_id
  limit 1;
$$;
```

Note on `get_recipe_by_menu_item`: returns `NULL` (not an error) when no recipe exists for the menu_item. The UI in 4.C uses this to decide between "create new recipe" vs "edit existing recipe" mode.

- [ ] **Step 4: Apply migrations and run pgTAP**

Run: `npm run db:init && npm run pgtap`
Expected:
- `110_recipes_upsert.sql`: all 6 assertions pass.
- `100_menu_items_crud.sql` Test 5 (delete_menu_item with active recipe) now passes too.
- Total: 50 (baseline) + 5 (T3) + 5 (T4 with Test 5 now green) + 6 (T5) = 66 assertions.

- [ ] **Step 5: Commit**

```powershell
$msg = @'
feat(phase-4a): recipes RPCs + pgTAP 110

4 new RPCs:
- upsert_recipe (atomic insert/update + replace recipe_items array)
- delete_recipe (cascade via FK ON DELETE CASCADE on recipe_items)
- list_recipes (joined with menu_items, returns item_count)
- get_recipe_by_menu_item (jsonb detail with ingredients joined;
  returns null if no recipe exists — UI uses this for create vs edit mode)

upsert_recipe behavior:
- Same menu_item_id returns same recipe id (idempotent)
- DELETE-then-INSERT pattern for recipe_items (atomic in single tx)
- Per-item validation: quantity > 0, ingredient_id not null
- Vietnamese error messages

pgTAP 110_recipes_upsert.sql: 6 assertions
1. insert path returns uuid
2. recipe_items count = 1 after insert
3. second upsert returns same recipe id
4. recipe_items replaced atomically (count = 2)
5. negative quantity raises Vietnamese error
6. delete cascades recipe_items

Bonus: Task 4 Test 5 (menu_item delete with recipe) now passes since
upsert_recipe exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/002_functions.sql database/tests/110_recipes_upsert.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 6: Stock RPCs + pgTAP (movements + counts + balances)

**Files:**
- Modify: `database/002_functions.sql` (append 5 RPCs)
- Create: `database/tests/120_stock_movements.sql`
- Create: `database/tests/130_stock_counts.sql`

- [ ] **Step 1: Write the failing pgTAP test for stock_movements**

Create `database/tests/120_stock_movements.sql`:

```sql
-- Phase 4.A — Stock movements RPC.
--
-- 5 assertions:
--   1. record_stock_movement returns uuid; stock_balance_now reflects delta
--   2. sign validation: purchase_received with negative qty raises Vi error
--   3. system-only reasons rejected ('sale_theoretical')
--   4. multiple movements sum correctly via stock_balance_now
--   5. audit_log entry written for each manual movement

begin;
select plan(5);

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

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_ing_id     uuid;
  v_mvmt_id    uuid;
begin
  v_ing_id := public.create_ingredient('Milk', 'L', null, null);

  -- Test 1: purchase_received +100, balance = 100
  v_mvmt_id := public.record_stock_movement(v_ing_id, 100, 'purchase_received', 'Initial stock');
  perform ok(v_mvmt_id is not null, 'record_stock_movement returns uuid');
  perform is(public.stock_balance_now(v_ing_id), 100::numeric, 'balance = 100 after purchase');

  -- Test 4: multiple movements sum correctly
  perform public.record_stock_movement(v_ing_id, 50, 'manual_adjustment_in', 'Found extra');
  perform public.record_stock_movement(v_ing_id, -20, 'waste', 'Spilled');
  perform is(public.stock_balance_now(v_ing_id), 130::numeric, 'balance = 130 after 100+50-20');

  -- Test 5: audit_log entry written
  perform is(
    (select count(*) from public.audit_log
     where action = 'stock_movement_recorded'
       and (diff_json->>'movement_id')::uuid = v_mvmt_id)::int,
    1,
    'audit_log row written for stock_movement'
  );
end $$;

-- Test 2: sign validation
do $$
declare v_ing_id uuid;
begin
  v_ing_id := public.create_ingredient('Sign test ing', 'g', null, null);
  perform throws_like(
    format('select public.record_stock_movement(%L::uuid, -5, ''purchase_received'', null)', v_ing_id),
    '%phải lớn hơn 0%',
    'negative qty with purchase_received raises'
  );
end $$;

-- Test 3: system-only reasons rejected
do $$
declare v_ing_id uuid;
begin
  v_ing_id := public.create_ingredient('System reason test', 'g', null, null);
  perform throws_like(
    format('select public.record_stock_movement(%L::uuid, -5, ''sale_theoretical'', null)', v_ing_id),
    '%Lý do không hợp lệ%',
    'sale_theoretical rejected from RPC'
  );
end $$;

select * from finish();
rollback;
```

- [ ] **Step 2: Write the failing pgTAP test for stock_counts**

Create `database/tests/130_stock_counts.sql`:

```sql
-- Phase 4.A — Stock counts RPC.
--
-- 3 assertions:
--   1. record_stock_count with actual > theoretical emits positive correction
--   2. Subsequent stock_balance_now reflects the count
--   3. record_stock_count when actual == theoretical emits row with delta=0

begin;
select plan(3);

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

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_ing_id   uuid;
  v_count_id uuid;
  v_delta    numeric;
begin
  v_ing_id := public.create_ingredient('Count test', 'kg', null, null);

  -- Seed +100, then record_stock_count(95) → delta should be -5
  perform public.record_stock_movement(v_ing_id, 100, 'purchase_received', null);
  v_count_id := public.record_stock_count(v_ing_id, 95, 'first count');
  v_delta := (select quantity_delta from public.stock_movements where id = v_count_id);

  -- Test 1: delta = -5
  perform is(v_delta, (-5)::numeric, 'count_correction delta = actual - theoretical');

  -- Test 2: balance now = 95
  perform is(public.stock_balance_now(v_ing_id), 95::numeric, 'balance reflects count');

  -- Test 3: count again with actual == theoretical (95 == 95) emits delta=0 row
  v_count_id := public.record_stock_count(v_ing_id, 95, 'second count, no change');
  v_delta := (select quantity_delta from public.stock_movements where id = v_count_id);
  perform is(v_delta, 0::numeric, 'count_correction emits delta=0 when no variance');
end $$;

select * from finish();
rollback;
```

- [ ] **Step 3: Run pgTAP and confirm failure**

Run: `npm run pgtap`
Expected: `120_stock_movements.sql` and `130_stock_counts.sql` both fail because `record_stock_movement`, `record_stock_count`, `stock_balance_now` don't exist. Note: this also fixes `090_ingredients_crud.sql` Test 6 once Step 4 lands.

- [ ] **Step 4: Append stock RPCs to `database/002_functions.sql`**

Append:

```sql

-- =====================================================================
-- Phase 4.A — Stock movements + counts + balances
-- =====================================================================

create or replace function public.record_stock_movement(
  p_ingredient_id  uuid,
  p_quantity_delta numeric,
  p_reason         text,
  p_notes          text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_new_id      uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager', 'staff_operator') then
    raise exception 'Bạn không có quyền nhập xuất kho.';
  end if;

  if p_reason not in ('purchase_received', 'manual_adjustment_in',
                      'manual_adjustment_out', 'waste') then
    raise exception 'Lý do không hợp lệ. Chỉ chấp nhận: purchase_received, manual_adjustment_in, manual_adjustment_out, waste.';
  end if;

  if p_reason in ('purchase_received', 'manual_adjustment_in') and p_quantity_delta <= 0 then
    raise exception 'Số lượng phải lớn hơn 0 cho lý do %.', p_reason;
  end if;
  if p_reason in ('manual_adjustment_out', 'waste') and p_quantity_delta >= 0 then
    raise exception 'Số lượng phải nhỏ hơn 0 cho lý do %.', p_reason;
  end if;

  insert into public.stock_movements (
    ingredient_id, quantity_delta, reason, notes, created_by
  ) values (p_ingredient_id, p_quantity_delta, p_reason, p_notes, auth.uid())
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'stock_movement_recorded', 'stock_movement', v_new_id,
    jsonb_build_object(
      'movement_id', v_new_id,
      'ingredient_id', p_ingredient_id,
      'delta', p_quantity_delta,
      'reason', p_reason
    )
  );

  return v_new_id;
end;
$$;

create or replace function public.record_stock_count(
  p_ingredient_id   uuid,
  p_actual_quantity numeric,
  p_notes           text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role         text;
  v_theoretical_before  numeric;
  v_delta               numeric;
  v_new_id              uuid;
begin
  v_caller_role := public.app_role();
  if v_caller_role not in ('owner', 'manager', 'staff_operator') then
    raise exception 'Bạn không có quyền kiểm kê.';
  end if;

  if p_actual_quantity < 0 then
    raise exception 'Số lượng thực tế không thể âm.';
  end if;

  select coalesce(sum(quantity_delta), 0) into v_theoretical_before
  from public.stock_movements
  where ingredient_id = p_ingredient_id;

  v_delta := p_actual_quantity - v_theoretical_before;

  insert into public.stock_movements (
    ingredient_id, quantity_delta, reason, notes, created_by
  ) values (p_ingredient_id, v_delta, 'count_correction', p_notes, auth.uid())
  returning id into v_new_id;

  insert into public.audit_log (
    actor_user_id, actor_role, action, entity_type, entity_id, diff_json
  ) values (
    auth.uid(), v_caller_role, 'stock_count_recorded', 'stock_movement', v_new_id,
    jsonb_build_object(
      'movement_id', v_new_id,
      'ingredient_id', p_ingredient_id,
      'theoretical_before', v_theoretical_before,
      'actual', p_actual_quantity,
      'delta', v_delta
    )
  );

  return v_new_id;
end;
$$;

create or replace function public.stock_balance_now(p_ingredient_id uuid)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(quantity_delta), 0)::numeric
  from public.stock_movements
  where ingredient_id = p_ingredient_id;
$$;

create or replace function public.stock_balances_all()
returns table (
  ingredient_id        uuid,
  name                 text,
  unit                 text,
  theoretical_balance  numeric,
  low_stock_threshold  numeric,
  is_low               boolean,
  last_movement_at     timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    i.id as ingredient_id,
    i.name,
    i.unit,
    coalesce(sum(sm.quantity_delta), 0)::numeric as theoretical_balance,
    i.low_stock_threshold,
    case
      when i.low_stock_threshold is null then false
      else coalesce(sum(sm.quantity_delta), 0) < i.low_stock_threshold
    end as is_low,
    max(sm.occurred_at) as last_movement_at
  from public.ingredients i
  left join public.stock_movements sm on sm.ingredient_id = i.id
  where i.is_active = true
  group by i.id, i.name, i.unit, i.low_stock_threshold
  order by i.name;
$$;

create or replace function public.list_stock_movements(
  p_ingredient_id uuid    default null,
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_limit         int     default 100,
  p_offset        int     default 0
) returns table (
  id               uuid,
  ingredient_id    uuid,
  ingredient_name  text,
  quantity_delta   numeric,
  reason           text,
  occurred_at      timestamptz,
  source_order_id  uuid,
  source_recipe_id uuid,
  notes            text,
  created_by       uuid,
  created_at       timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    sm.id, sm.ingredient_id, i.name as ingredient_name,
    sm.quantity_delta, sm.reason, sm.occurred_at,
    sm.source_order_id, sm.source_recipe_id,
    sm.notes, sm.created_by, sm.created_at
  from public.stock_movements sm
  join public.ingredients i on i.id = sm.ingredient_id
  where (p_ingredient_id is null or sm.ingredient_id = p_ingredient_id)
    and (p_from is null or sm.occurred_at >= p_from)
    and (p_to   is null or sm.occurred_at <= p_to)
  order by sm.occurred_at desc, sm.id desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
$$;
```

- [ ] **Step 5: Apply migrations and run pgTAP**

Run: `npm run db:init && npm run pgtap`
Expected:
- `120_stock_movements.sql` 5/5 pass.
- `130_stock_counts.sql` 3/3 pass.
- `090_ingredients_crud.sql` Test 6 now passes too (`record_stock_movement` exists).
- Total: 50 (baseline) + 6 (T3 ingredients all green) + 5 (T4 menu_items) + 6 (T5 recipes) + 5 (T6 stock_movements) + 3 (T6 stock_counts) = 75 assertions.

- [ ] **Step 6: Commit**

```powershell
$msg = @'
feat(phase-4a): stock movements + counts + balance RPCs + pgTAP 120/130

5 new RPCs in 002_functions.sql:
- record_stock_movement (staff+, validates reason and sign-vs-reason)
  Allowed reasons: purchase_received, manual_adjustment_in,
  manual_adjustment_out, waste
  Rejects sale_theoretical (trigger-only) and count_correction (count RPC)
- record_stock_count (staff+, computes theoretical_before, emits
  count_correction movement with delta = actual - theoretical_before;
  always emits a row even when delta=0 for audit trail)
- stock_balance_now (sum aggregate, STABLE)
- stock_balances_all (LEFT JOIN ingredients to movements; ALL active
  ingredients returned, even those with zero balance; computed is_low flag)
- list_stock_movements (paged, optional filters by ingredient/date,
  ORDER BY occurred_at DESC, id DESC for deterministic ordering)

pgTAP 120_stock_movements.sql (5 assertions):
1. record_stock_movement returns uuid; balance reflects delta
2. sign validation (purchase_received + negative qty raises Vi error)
3. system-only reasons rejected (sale_theoretical)
4. multiple movements sum correctly via stock_balance_now
5. audit_log entry written

pgTAP 130_stock_counts.sql (3 assertions):
1. count_correction delta = actual - theoretical
2. balance reflects count
3. count with zero variance still emits delta=0 row

Bonus: Task 3 Test 6 (ingredient delete with stock_movement) now passes
since record_stock_movement exists.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/002_functions.sql database/tests/120_stock_movements.sql database/tests/130_stock_counts.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 7: Sale deduction trigger pgTAP

**Files:**
- Create: `database/tests/140_sale_deduction_trigger.sql`

This task adds tests for the trigger from Task 2. No new SQL functions.

- [ ] **Step 1: Write the pgTAP test**

Create `database/tests/140_sale_deduction_trigger.sql`:

```sql
-- Phase 4.A — Auto-deduction trigger on sales_order_items.
--
-- 6 assertions:
--   1. Backward compat: insert sales_order_items without any menu_items → no movements
--   2. Match + active recipe: 1 sale × recipe = correct stock_movements
--   3. Case-insensitive trimmed match works
--   4. Inactive recipe: trigger no-ops (no movements)
--   5. Inactive menu_item: trigger no-ops
--   6. Multi-item recipe: multiple stock_movements emitted with scaled quantities

begin;
select plan(6);

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

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active');

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

-- ------------------------------------------------------------------
-- Test 1: Backward compat — no menu_items, insert sales_order_items
-- ------------------------------------------------------------------
do $$
declare
  v_order_id uuid;
begin
  -- Insert a sales_order directly (bypass ingest RPC, no menu_items exist)
  insert into public.sales_orders (id, kiotviet_invoice_id, status, total_amount, created_at)
  values (gen_random_uuid(), 999001, 'completed', 50000, now())
  returning id into v_order_id;

  insert into public.sales_order_items (id, order_id, product_name, quantity, unit_price, created_at)
  values (gen_random_uuid(), v_order_id, 'Cà phê sữa đá', 2, 25000, now());

  perform is(
    (select count(*)::int from public.stock_movements),
    0,
    'no menu_items → no stock_movements emitted (backward compat)'
  );
end $$;

-- ------------------------------------------------------------------
-- Test 2: Match + active recipe + 1 sale → correct movements
-- ------------------------------------------------------------------
do $$
declare
  v_menu_id    uuid;
  v_ing_coffee uuid;
  v_recipe_id  uuid;
  v_order_id   uuid;
begin
  v_menu_id    := public.create_menu_item('Espresso shot', 'Espresso', null);
  v_ing_coffee := public.create_ingredient('Cà phê hạt T2', 'g', null, null);
  v_recipe_id  := public.upsert_recipe(
    v_menu_id, true, null,
    jsonb_build_array(jsonb_build_object('ingredient_id', v_ing_coffee, 'quantity', 18))
  );

  insert into public.sales_orders (id, kiotviet_invoice_id, status, total_amount, created_at)
  values (gen_random_uuid(), 999002, 'completed', 50000, now())
  returning id into v_order_id;

  insert into public.sales_order_items (id, order_id, product_name, quantity, unit_price, created_at)
  values (gen_random_uuid(), v_order_id, 'Espresso', 2, 25000, now());

  perform is(
    (select quantity_delta from public.stock_movements
     where ingredient_id = v_ing_coffee
       and reason = 'sale_theoretical'
       and source_order_id = v_order_id),
    (-36)::numeric,
    'sale 2 × 18g coffee = -36g stock_movement'
  );
end $$;

-- ------------------------------------------------------------------
-- Test 3: Case-insensitive trimmed match
-- ------------------------------------------------------------------
do $$
declare
  v_order_id   uuid;
  v_ing_coffee uuid;
  v_count_before int;
  v_count_after  int;
begin
  -- Reuse the menu_item from Test 2 ('Espresso')
  select id into v_ing_coffee from public.ingredients where name = 'Cà phê hạt T2';

  v_count_before := (select count(*) from public.stock_movements where ingredient_id = v_ing_coffee);

  insert into public.sales_orders (id, kiotviet_invoice_id, status, total_amount, created_at)
  values (gen_random_uuid(), 999003, 'completed', 25000, now())
  returning id into v_order_id;

  insert into public.sales_order_items (id, order_id, product_name, quantity, unit_price, created_at)
  values (gen_random_uuid(), v_order_id, '  ESPRESSO  ', 1, 25000, now());

  v_count_after := (select count(*) from public.stock_movements where ingredient_id = v_ing_coffee);

  perform is(
    v_count_after - v_count_before,
    1,
    'case-insensitive trimmed match emits movement'
  );
end $$;

-- ------------------------------------------------------------------
-- Test 4: Inactive recipe → no movements
-- ------------------------------------------------------------------
do $$
declare
  v_menu_id    uuid;
  v_ing_id     uuid;
  v_order_id   uuid;
begin
  v_menu_id := public.create_menu_item('Inactive recipe test', 'inactive_test', null);
  v_ing_id  := public.create_ingredient('Inactive ing', 'g', null, null);
  perform public.upsert_recipe(
    v_menu_id, false, null,  -- is_active = false
    jsonb_build_array(jsonb_build_object('ingredient_id', v_ing_id, 'quantity', 10))
  );

  insert into public.sales_orders (id, kiotviet_invoice_id, status, total_amount, created_at)
  values (gen_random_uuid(), 999004, 'completed', 25000, now())
  returning id into v_order_id;

  insert into public.sales_order_items (id, order_id, product_name, quantity, unit_price, created_at)
  values (gen_random_uuid(), v_order_id, 'inactive_test', 1, 25000, now());

  perform is(
    (select count(*)::int from public.stock_movements where ingredient_id = v_ing_id),
    0,
    'inactive recipe → no stock_movements'
  );
end $$;

-- ------------------------------------------------------------------
-- Test 5: Inactive menu_item → no movements
-- ------------------------------------------------------------------
do $$
declare
  v_menu_id    uuid;
  v_ing_id     uuid;
  v_order_id   uuid;
begin
  v_menu_id := public.create_menu_item('Inactive menu test', 'inactive_menu', null);
  v_ing_id  := public.create_ingredient('Inactive menu ing', 'g', null, null);
  perform public.upsert_recipe(
    v_menu_id, true, null,
    jsonb_build_array(jsonb_build_object('ingredient_id', v_ing_id, 'quantity', 10))
  );
  perform public.update_menu_item(v_menu_id, 'Inactive menu test', 'inactive_menu', null, false);

  insert into public.sales_orders (id, kiotviet_invoice_id, status, total_amount, created_at)
  values (gen_random_uuid(), 999005, 'completed', 25000, now())
  returning id into v_order_id;

  insert into public.sales_order_items (id, order_id, product_name, quantity, unit_price, created_at)
  values (gen_random_uuid(), v_order_id, 'inactive_menu', 1, 25000, now());

  perform is(
    (select count(*)::int from public.stock_movements where ingredient_id = v_ing_id),
    0,
    'inactive menu_item → no stock_movements'
  );
end $$;

-- ------------------------------------------------------------------
-- Test 6: Multi-item recipe → multiple stock_movements emitted
-- ------------------------------------------------------------------
do $$
declare
  v_menu_id    uuid;
  v_ing_coffee uuid;
  v_ing_milk   uuid;
  v_order_id   uuid;
begin
  v_menu_id    := public.create_menu_item('Latte T6', 'Latte_T6', null);
  v_ing_coffee := public.create_ingredient('Coffee T6', 'g', null, null);
  v_ing_milk   := public.create_ingredient('Milk T6', 'ml', null, null);

  perform public.upsert_recipe(
    v_menu_id, true, null,
    jsonb_build_array(
      jsonb_build_object('ingredient_id', v_ing_coffee, 'quantity', 18),
      jsonb_build_object('ingredient_id', v_ing_milk,   'quantity', 200)
    )
  );

  insert into public.sales_orders (id, kiotviet_invoice_id, status, total_amount, created_at)
  values (gen_random_uuid(), 999006, 'completed', 35000, now())
  returning id into v_order_id;

  insert into public.sales_order_items (id, order_id, product_name, quantity, unit_price, created_at)
  values (gen_random_uuid(), v_order_id, 'Latte_T6', 3, 35000, now());

  perform is(
    (select count(*)::int from public.stock_movements where source_order_id = v_order_id),
    2,
    'multi-item recipe emits one row per ingredient'
  );
end $$;

select * from finish();
rollback;
```

**Note on `sales_orders` columns:** The test assumes columns `(id, kiotviet_invoice_id, status, total_amount, created_at)`. Before committing, verify the actual `sales_orders` schema in `001_schema.sql`. If columns differ, adjust the INSERT statements accordingly. Same for `sales_order_items` — likely has `(id, order_id, product_name, quantity, unit_price, created_at)`.

To verify, run:
```bash
grep -A 20 "create table.*sales_orders" database/001_schema.sql
grep -A 15 "create table.*sales_order_items" database/001_schema.sql
```
Edit the test to use the actual column names if they differ.

- [ ] **Step 2: Run pgTAP**

Run: `npm run pgtap`
Expected: All 6 assertions in `140_sale_deduction_trigger.sql` pass. Total now 75 + 6 = 81 new assertions.

If any test fails:
- Test 1 fail: trigger fires even with no menu_items → check the function's first SELECT.
- Test 2 fail: wrong sign or value on quantity_delta → check the `-(v_item.quantity * NEW.quantity)` expression.
- Test 3 fail: case-insensitive lookup not working → verify `LOWER(TRIM(...))` on both sides.
- Test 4 fail: trigger fires for inactive recipe → check `AND is_active = true` in recipe SELECT.
- Test 5 fail: similar for menu_item → check `AND is_active = true` in menu_items SELECT.
- Test 6 fail: wrong number of movements → check the FOR LOOP over recipe_items.

- [ ] **Step 3: Commit**

```powershell
$msg = @'
test(phase-4a): pgTAP 140 for auto-deduction trigger

6 assertions covering:
1. Backward compat: zero menu_items + sales_order_items insert → zero movements
2. Match + active recipe + 1 sale × recipe = correct delta (qty * sold)
3. Case-insensitive trimmed match works ("  ESPRESSO  " matches "Espresso")
4. Inactive recipe (is_active=false) → no movements
5. Inactive menu_item (is_active=false) → no movements
6. Multi-item recipe emits one row per ingredient with scaled quantities

Each test inserts sales_orders + sales_order_items directly (no ingest
RPC needed) so the trigger fires as intended.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/tests/140_sale_deduction_trigger.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 8: RLS policies + pgTAP

**Files:**
- Modify: `database/003_rls.sql` (append)
- Create: `database/tests/150_rls_inventory.sql`

- [ ] **Step 1: Write the failing pgTAP test**

Create `database/tests/150_rls_inventory.sql`:

```sql
-- Phase 4.A — Inventory RLS tests.
--
-- 6 assertions:
--   1. authenticated SELECT * FROM ingredients works (read all)
--   2. authenticated direct INSERT ingredients → policy violation
--   3. Same: direct INSERT stock_movements → policy violation
--   4. employee_viewer cannot call create_ingredient (role gate)
--   5. staff_operator CAN call record_stock_movement (role allows)
--   6. staff_operator CANNOT call upsert_recipe (role gate)

begin;
select plan(6);

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

insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) values
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local',  '', now(), '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'staff@test.local',  '', now(), '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'viewer@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
insert into public.profiles (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Owner'),
  ('22222222-2222-2222-2222-222222222222', 'Staff'),
  ('33333333-3333-3333-3333-333333333333', 'Viewer');
insert into public.employee_accounts (auth_user_id, role, status) values
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'staff_operator', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'employee_viewer', 'active');

-- Seed an ingredient as owner (bypasses RLS via SECURITY DEFINER RPC)
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
do $$ begin perform public.create_ingredient('Seed RLS', 'kg', null, null); end $$;

-- Test 1: authenticated can SELECT
reset role;
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;

select ok(
  (select count(*) from public.ingredients) >= 1,
  'authenticated can SELECT from ingredients'
);

-- Test 2: direct INSERT blocked
select throws_ok(
  $$ insert into public.ingredients (name, unit) values ('Direct insert', 'kg') $$,
  '42501',  -- insufficient_privilege (RLS)
  null,
  'direct INSERT into ingredients blocked by RLS'
);

-- Test 3: direct INSERT into stock_movements blocked
select throws_ok(
  $$ insert into public.stock_movements (ingredient_id, quantity_delta, reason)
     values ('00000000-0000-0000-0000-000000000000'::uuid, 1, 'purchase_received') $$,
  '42501',
  null,
  'direct INSERT into stock_movements blocked by RLS'
);

-- Test 4: employee_viewer can't call create_ingredient
reset role;
select pg_temp.act_as('33333333-3333-3333-3333-333333333333');
set local role authenticated;
select throws_like(
  $$ select public.create_ingredient('Should fail', 'g', null, null) $$,
  '%không có quyền%',
  'employee_viewer rejected from create_ingredient'
);

-- Test 5: staff_operator can call record_stock_movement
reset role;
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
set local role authenticated;
do $$
declare
  v_ing_id    uuid;
  v_mvmt_id   uuid;
begin
  select id into v_ing_id from public.ingredients where name = 'Seed RLS' limit 1;
  v_mvmt_id := public.record_stock_movement(v_ing_id, 10, 'purchase_received', 'staff stock');
  perform ok(v_mvmt_id is not null, 'staff_operator can record_stock_movement');
end $$;

-- Test 6: staff_operator cannot upsert_recipe
do $$
declare v_menu_id uuid;
begin
  -- Need a menu_item; create one as owner first
  reset role;
  perform pg_temp.act_as('11111111-1111-1111-1111-111111111111');
  set local role authenticated;
  v_menu_id := public.create_menu_item('Recipe target T8', null, null);

  -- Switch to staff and try upsert_recipe
  reset role;
  perform pg_temp.act_as('22222222-2222-2222-2222-222222222222');
  set local role authenticated;
  perform throws_like(
    format(
      'select public.upsert_recipe(%L::uuid, true, null, ''[]''::jsonb)',
      v_menu_id
    ),
    '%không có quyền%',
    'staff_operator cannot upsert_recipe'
  );
end $$;

select * from finish();
rollback;
```

- [ ] **Step 2: Run pgTAP and confirm Tests 2 and 3 fail (RLS not enabled yet)**

Run: `npm run pgtap`
Expected: assertions 1, 4, 5, 6 pass. Assertions 2 and 3 fail because direct INSERT currently succeeds (no RLS policies yet).

- [ ] **Step 3: Append RLS policies to `database/003_rls.sql`**

Append:

```sql

-- =====================================================================
-- Phase 4.A — Inventory RLS
-- =====================================================================

alter table public.ingredients     enable row level security;
alter table public.menu_items      enable row level security;
alter table public.recipes         enable row level security;
alter table public.recipe_items    enable row level security;
alter table public.stock_movements enable row level security;

-- SELECT: all authenticated users can read all 5 tables.
drop policy if exists ingredients_select_all     on public.ingredients;
drop policy if exists menu_items_select_all      on public.menu_items;
drop policy if exists recipes_select_all         on public.recipes;
drop policy if exists recipe_items_select_all    on public.recipe_items;
drop policy if exists stock_movements_select_all on public.stock_movements;

create policy ingredients_select_all on public.ingredients
  for select to authenticated using (true);
create policy menu_items_select_all on public.menu_items
  for select to authenticated using (true);
create policy recipes_select_all on public.recipes
  for select to authenticated using (true);
create policy recipe_items_select_all on public.recipe_items
  for select to authenticated using (true);
create policy stock_movements_select_all on public.stock_movements
  for select to authenticated using (true);

-- WRITE: deny direct INSERT/UPDATE/DELETE from authenticated clients.
-- All writes go through SECURITY DEFINER RPCs (or the trigger).
drop policy if exists ingredients_no_direct_write     on public.ingredients;
drop policy if exists menu_items_no_direct_write      on public.menu_items;
drop policy if exists recipes_no_direct_write         on public.recipes;
drop policy if exists recipe_items_no_direct_write    on public.recipe_items;
drop policy if exists stock_movements_no_direct_write on public.stock_movements;

create policy ingredients_no_direct_write on public.ingredients
  for all to authenticated using (false) with check (false);
create policy menu_items_no_direct_write on public.menu_items
  for all to authenticated using (false) with check (false);
create policy recipes_no_direct_write on public.recipes
  for all to authenticated using (false) with check (false);
create policy recipe_items_no_direct_write on public.recipe_items
  for all to authenticated using (false) with check (false);
create policy stock_movements_no_direct_write on public.stock_movements
  for all to authenticated using (false) with check (false);
```

- [ ] **Step 4: Apply migrations and run pgTAP**

Run: `npm run db:init && npm run pgtap`
Expected: all 6 assertions in `150_rls_inventory.sql` pass. Existing tests still pass. Total: 75 (after T7) + 6 (T8) = 81 + 6 = 87 new assertions + 50 baseline = 137. Wait — let me recount.

Tally:
- 50 baseline (existing 010-080)
- 6 from T3 (`090_ingredients_crud.sql`)
- 5 from T4 (`100_menu_items_crud.sql`)
- 6 from T5 (`110_recipes_upsert.sql`)
- 5 from T6 (`120_stock_movements.sql`)
- 3 from T6 (`130_stock_counts.sql`)
- 6 from T7 (`140_sale_deduction_trigger.sql`)
- 6 from T8 (`150_rls_inventory.sql`)
- = 50 + 37 = **87 pgTAP assertions total**

This matches the spec's success criteria.

- [ ] **Step 5: Commit**

```powershell
$msg = @'
feat(phase-4a): RLS policies for inventory tables + pgTAP 150

Two-policy pattern per table (5 tables: ingredients, menu_items,
recipes, recipe_items, stock_movements):
- SELECT: authenticated can read everything
- ALL (incl INSERT/UPDATE/DELETE): deny direct writes from clients
  (USING false WITH CHECK false)

All writes go through SECURITY DEFINER RPCs which bypass RLS:
- create/update/delete_ingredient
- create/update/delete_menu_item
- upsert/delete_recipe
- record_stock_movement (staff+)
- record_stock_count (staff+)

The auto-deduction trigger _apply_sale_deductions_row() is also
SECURITY DEFINER, so its INSERTs into stock_movements bypass RLS
as expected.

pgTAP 150_rls_inventory.sql: 6 assertions
1. authenticated can SELECT from ingredients
2. direct INSERT into ingredients blocked (42501)
3. direct INSERT into stock_movements blocked
4. employee_viewer rejected by role gate in create_ingredient
5. staff_operator can call record_stock_movement (staff+ allowed)
6. staff_operator cannot upsert_recipe (owner+manager only)

Total pgTAP after this commit: 87 assertions (50 baseline + 37 new).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add database/003_rls.sql database/tests/150_rls_inventory.sql
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 9: TypeScript types + data layer

**Files:**
- Modify: `src/lib/types.ts` (append types)
- Create: `src/lib/data/inventory.ts`
- Modify: `src/lib/data/index.ts` (append re-export)

- [ ] **Step 1: Append types to `src/lib/types.ts`**

Open `src/lib/types.ts`. At end of file, append:

```ts

// =====================================================================
// Phase 4.A — Inventory types
// =====================================================================

export type StockMovementReason =
  | "purchase_received"
  | "sale_theoretical"
  | "manual_adjustment_in"
  | "manual_adjustment_out"
  | "count_correction"
  | "waste";

export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  low_stock_threshold: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

export interface MenuItem {
  id: string;
  name: string;
  external_product_name: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  /** Returned by list_menu_items RPC */
  recipe_count?: number;
}

export interface Recipe {
  recipe_id: string;
  menu_item_id: string;
  menu_item_name: string;
  is_active: boolean;
  item_count: number;
  notes: string | null;
  updated_at: string;
}

export interface RecipeItem {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  quantity: number;
}

export interface RecipeDetail {
  recipe_id: string;
  menu_item_id: string;
  is_active: boolean;
  notes: string | null;
  items: RecipeItem[];
}

export interface StockMovement {
  id: string;
  ingredient_id: string;
  ingredient_name: string;
  quantity_delta: number;
  reason: StockMovementReason;
  occurred_at: string;
  source_order_id: string | null;
  source_recipe_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface StockBalance {
  ingredient_id: string;
  name: string;
  unit: string;
  theoretical_balance: number;
  low_stock_threshold: number | null;
  is_low: boolean;
  last_movement_at: string | null;
}
```

- [ ] **Step 2: Create `src/lib/data/inventory.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Ingredient,
  MenuItem,
  Recipe,
  RecipeDetail,
  StockMovement,
  StockBalance,
  StockMovementReason,
} from "@/lib/types";

// ----------------------- Ingredients -----------------------------------

export async function loadIngredients(
  supabase: SupabaseClient
): Promise<Ingredient[]> {
  const { data, error } = await supabase.rpc("list_ingredients");
  if (error) throw error;
  return (data ?? []) as Ingredient[];
}

export async function createIngredient(
  supabase: SupabaseClient,
  input: {
    name: string;
    unit: string;
    low_stock_threshold?: number | null;
    notes?: string | null;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("create_ingredient", {
    p_name: input.name,
    p_unit: input.unit,
    p_low_stock_threshold: input.low_stock_threshold ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateIngredient(
  supabase: SupabaseClient,
  input: {
    id: string;
    name: string;
    unit: string;
    low_stock_threshold: number | null;
    notes: string | null;
    is_active: boolean;
  }
): Promise<void> {
  const { error } = await supabase.rpc("update_ingredient", {
    p_id: input.id,
    p_name: input.name,
    p_unit: input.unit,
    p_low_stock_threshold: input.low_stock_threshold,
    p_notes: input.notes,
    p_is_active: input.is_active,
  });
  if (error) throw error;
}

export async function deleteIngredient(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.rpc("delete_ingredient", { p_id: id });
  if (error) throw error;
}

// ----------------------- Menu items ------------------------------------

export async function loadMenuItems(
  supabase: SupabaseClient
): Promise<MenuItem[]> {
  const { data, error } = await supabase.rpc("list_menu_items");
  if (error) throw error;
  return (data ?? []) as MenuItem[];
}

export async function createMenuItem(
  supabase: SupabaseClient,
  input: {
    name: string;
    external_product_name?: string | null;
    notes?: string | null;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("create_menu_item", {
    p_name: input.name,
    p_external_product_name: input.external_product_name ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateMenuItem(
  supabase: SupabaseClient,
  input: {
    id: string;
    name: string;
    external_product_name: string | null;
    notes: string | null;
    is_active: boolean;
  }
): Promise<void> {
  const { error } = await supabase.rpc("update_menu_item", {
    p_id: input.id,
    p_name: input.name,
    p_external_product_name: input.external_product_name,
    p_notes: input.notes,
    p_is_active: input.is_active,
  });
  if (error) throw error;
}

export async function deleteMenuItem(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.rpc("delete_menu_item", { p_id: id });
  if (error) throw error;
}

// ----------------------- Recipes ---------------------------------------

export async function loadRecipes(
  supabase: SupabaseClient
): Promise<Recipe[]> {
  const { data, error } = await supabase.rpc("list_recipes");
  if (error) throw error;
  return (data ?? []) as Recipe[];
}

export async function getRecipeByMenuItem(
  supabase: SupabaseClient,
  menuItemId: string
): Promise<RecipeDetail | null> {
  const { data, error } = await supabase.rpc("get_recipe_by_menu_item", {
    p_menu_item_id: menuItemId,
  });
  if (error) throw error;
  return (data as RecipeDetail | null) ?? null;
}

export async function upsertRecipe(
  supabase: SupabaseClient,
  input: {
    menu_item_id: string;
    is_active: boolean;
    notes: string | null;
    items: Array<{ ingredient_id: string; quantity: number }>;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("upsert_recipe", {
    p_menu_item_id: input.menu_item_id,
    p_is_active: input.is_active,
    p_notes: input.notes,
    p_items: input.items,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteRecipe(
  supabase: SupabaseClient,
  recipeId: string
): Promise<void> {
  const { error } = await supabase.rpc("delete_recipe", {
    p_recipe_id: recipeId,
  });
  if (error) throw error;
}

// ----------------------- Stock -----------------------------------------

export async function recordStockMovement(
  supabase: SupabaseClient,
  input: {
    ingredient_id: string;
    quantity_delta: number;
    reason: StockMovementReason;
    notes?: string | null;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("record_stock_movement", {
    p_ingredient_id: input.ingredient_id,
    p_quantity_delta: input.quantity_delta,
    p_reason: input.reason,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function recordStockCount(
  supabase: SupabaseClient,
  input: {
    ingredient_id: string;
    actual_quantity: number;
    notes?: string | null;
  }
): Promise<string> {
  const { data, error } = await supabase.rpc("record_stock_count", {
    p_ingredient_id: input.ingredient_id,
    p_actual_quantity: input.actual_quantity,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function loadStockMovements(
  supabase: SupabaseClient,
  filter: {
    ingredient_id?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<StockMovement[]> {
  const { data, error } = await supabase.rpc("list_stock_movements", {
    p_ingredient_id: filter.ingredient_id ?? null,
    p_from: filter.from ?? null,
    p_to: filter.to ?? null,
    p_limit: filter.limit ?? 100,
    p_offset: filter.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as StockMovement[];
}

export async function loadStockBalanceNow(
  supabase: SupabaseClient,
  ingredientId: string
): Promise<number> {
  const { data, error } = await supabase.rpc("stock_balance_now", {
    p_ingredient_id: ingredientId,
  });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function loadStockBalancesAll(
  supabase: SupabaseClient
): Promise<StockBalance[]> {
  const { data, error } = await supabase.rpc("stock_balances_all");
  if (error) throw error;
  return (data ?? []) as StockBalance[];
}
```

- [ ] **Step 3: Re-export from `src/lib/data/index.ts`**

Open `src/lib/data/index.ts`. At end of file, append:

```ts
export * from "./inventory";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. If you see errors like "cannot find module '@/lib/types'" or duplicate export, ensure all 7 types in `types.ts` are exported (each line starts with `export`) and `data/index.ts` doesn't conflict with another export.

- [ ] **Step 5: Commit**

```powershell
$msg = @'
feat(phase-4a): TypeScript types + data layer for inventory

Types added to src/lib/types.ts (additive):
- StockMovementReason union (6 reasons matching DB CHECK)
- Ingredient, MenuItem, Recipe, RecipeItem, RecipeDetail
- StockMovement, StockBalance

Data layer src/lib/data/inventory.ts: 13 wrapper functions
- loadIngredients / createIngredient / updateIngredient / deleteIngredient
- loadMenuItems / createMenuItem / updateMenuItem / deleteMenuItem
- loadRecipes / getRecipeByMenuItem / upsertRecipe / deleteRecipe
- recordStockMovement / recordStockCount / loadStockMovements
- loadStockBalanceNow / loadStockBalancesAll

Re-exported from src/lib/data/index.ts barrel.

All functions: thin async wrappers around supabase.rpc(), throw on
error, return typed responses. No business logic in the data layer.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/lib/types.ts src/lib/data/inventory.ts src/lib/data/index.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 10: Query hooks + query keys

**Files:**
- Modify: `src/hooks/queries/keys.ts` (append inventory keys)
- Create: `src/hooks/queries/use-inventory-queries.ts`
- Modify: `src/hooks/queries/index.ts` (append re-exports)

- [ ] **Step 1: Append query keys to `src/hooks/queries/keys.ts`**

Open `src/hooks/queries/keys.ts`. Find the existing `queryKeys` object. Inside it, add new top-level keys (nested under the existing object). The exact placement depends on the file's structure — look for the last key entry and add after it. Example structure (adapt to actual `keys.ts`):

```ts
export const queryKeys = {
  // ... existing keys ...

  // Phase 4.A — Inventory
  ingredients: () => ["inventory", "ingredients"] as const,
  menuItems: () => ["inventory", "menu_items"] as const,
  recipes: () => ["inventory", "recipes"] as const,
  stockBalances: () => ["inventory", "stock_balances"] as const,
  stockMovements: (filter?: {
    ingredient_id?: string;
    from?: string;
    to?: string;
  }) =>
    filter
      ? (["inventory", "stock_movements", filter] as const)
      : (["inventory", "stock_movements"] as const),
  recipeByMenuItem: (menuItemId: string) =>
    ["inventory", "recipe", menuItemId] as const,
};
```

If the existing file uses a different naming convention (e.g., nested `inventory: { ingredients: () => ... }`), follow the dominant convention in the file. Read the file first to determine.

- [ ] **Step 2: Create `src/hooks/queries/use-inventory-queries.ts`**

```ts
"use client";

import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadIngredients,
  loadMenuItems,
  loadRecipes,
  loadStockBalancesAll,
} from "@/lib/data";
import { queryKeys } from "./keys";

/**
 * Phase 4.A — Inventory query hooks (read-only).
 * Mutation hooks live in `use-inventory-mutations.ts` (added in 4.B).
 *
 * Stale-time strategy:
 *   - Masters (ingredients, menu_items, recipes): 60s — change infrequently
 *   - Stock balances: 30s — move with sales ingest + manual entries
 */

export function useIngredientsQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.ingredients(),
    queryFn: () => loadIngredients(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useMenuItemsQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.menuItems(),
    queryFn: () => loadMenuItems(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useRecipesQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.recipes(),
    queryFn: () => loadRecipes(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useStockBalancesQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.stockBalances(),
    queryFn: () => loadStockBalancesAll(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 3: Re-export from `src/hooks/queries/index.ts`**

Open `src/hooks/queries/index.ts`. At end of file, append:

```ts
export * from "./use-inventory-queries";
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors. If you see "Property 'ingredients' does not exist on type 'queryKeys'", the keys.ts additions weren't applied or were misplaced — re-check Step 1.

- [ ] **Step 5: Build**

Run: `npm run build 2>&1 | Select-Object -Last 30`
Expected: build succeeds. No errors.

- [ ] **Step 6: Commit**

```powershell
$msg = @'
feat(phase-4a): query hooks for inventory

src/hooks/queries/use-inventory-queries.ts: 4 read-only hooks
- useIngredientsQuery (60s stale)
- useMenuItemsQuery (60s stale)
- useRecipesQuery (60s stale)
- useStockBalancesQuery (30s stale — moves with sales ingest)

Query keys added to keys.ts:
- queryKeys.ingredients()
- queryKeys.menuItems()
- queryKeys.recipes()
- queryKeys.stockBalances()
- queryKeys.stockMovements(filter?)
- queryKeys.recipeByMenuItem(id)

Mutation hooks deferred to use-inventory-mutations.ts in Phase 4.B
when UI consumers exist.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
'@
$msg | Out-File -FilePath ".git/COMMIT_MSG_TMP" -Encoding utf8
git add src/hooks/queries/keys.ts src/hooks/queries/use-inventory-queries.ts src/hooks/queries/index.ts
git commit -F .git/COMMIT_MSG_TMP
Remove-Item .git/COMMIT_MSG_TMP -Force
```

---

### Task 11: Final verify + tag v4-phase-4a

**Files:** none (verification + tagging only)

- [ ] **Step 1: Run final verify:phase**

Run: `npm run verify:phase`
Expected: full output ending with:
```
Vitest:  75 passed
pgTAP:   87 passed (Files run: 16, Total assertions passed: 87)
```

Exit code 0.

If anything fails, identify the regression:
- Vitest failure: TypeScript error or test break in earlier task. Re-check T9/T10 typecheck.
- pgTAP failure: SQL regression. Re-run each test file individually if possible (or read the runner output for the specific file).

- [ ] **Step 2: Verify file manifest**

Run: `git diff main..HEAD --name-only`
Expected exactly these 17 files:
```
database/001_schema.sql
database/002_functions.sql
database/003_rls.sql
database/tests/090_ingredients_crud.sql
database/tests/100_menu_items_crud.sql
database/tests/110_recipes_upsert.sql
database/tests/120_stock_movements.sql
database/tests/130_stock_counts.sql
database/tests/140_sale_deduction_trigger.sql
database/tests/150_rls_inventory.sql
docs/superpowers/plans/2026-05-21-v4-phase-4a-backend.md
docs/superpowers/specs/2026-05-21-v4-phase-4-overall-design.md
docs/superpowers/specs/2026-05-21-v4-phase-4a-backend-design.md
src/hooks/queries/index.ts
src/hooks/queries/keys.ts
src/hooks/queries/use-inventory-queries.ts
src/lib/data/index.ts
src/lib/data/inventory.ts
src/lib/types.ts
```

(19 files including the 2 spec docs + 1 plan doc already committed earlier. The 17-file count in the spec excluded the docs; final actual count is 19 files for the diff. Either is acceptable — verify no off-limits files appear.)

If any off-limits file appears (no other src/features/*, no database/004_seed.sql, etc.), STOP and revert.

- [ ] **Step 3: Place the tag**

Run:
```bash
git tag v4-phase-4a
```

- [ ] **Step 4: Verify tag and commit history**

Run:
```bash
git log --oneline main..HEAD
git show v4-phase-4a --stat --no-patch | Select-Object -First 5
```

Expected: ~11 commits visible (1 overall Phase 4 spec doc + 1 Phase 4.A spec doc + 1 plan doc + T1 schema + T2 trigger + T3 ingredients + T4 menu_items + T5 recipes + T6 stock + T7 trigger tests + T8 RLS + T9 types/data + T10 queries = 13 commits actually). Tag points to T10 commit (the final commit on the branch).

- [ ] **Step 5: Re-tag to HEAD (3C.1 lesson — guarantee tag is on the final commit)**

```bash
git tag -f v4-phase-4a HEAD
git show v4-phase-4a --stat --no-patch | Select-Object -First 5
```

Confirm the tag points to the T10 commit. This step is a safety net — no operation should have moved HEAD since Step 3, but in case of any branch divergence, this forces the tag to current HEAD.

Phase 4.A is now ready for `superpowers:finishing-a-development-branch` to merge to main.

---

## Self-Review

**1. Spec coverage check:**

- §3.1 File layout: ✓ all 14 files touched across tasks T1–T10 (3 amended SQL + 7 pgTAP + 1 types + 1 data + 1 data index + 1 keys + 1 query hook + 1 query index). The 17-file count in spec §13 includes the spec doc itself; plan adds 2 more docs (overall + this plan) = 19 files in diff.
- §3.2 RPC catalog (12 RPCs): ✓
  - ingredients: create/update/delete/list — T3
  - menu_items: create/update/delete/list — T4
  - recipes: upsert/delete/list/get_by_menu_item — T5
  - stock: record_movement/record_count/balance_now/balances_all/list_movements — T6
- §3.3 Trigger: ✓ T2
- §4 Tables: ✓ T1 (all 5 tables with all CHECK constraints + functional partial index)
- §5 Trigger PL/pgSQL: ✓ T2 (full body)
- §6 Master CRUD bodies: ✓ T3, T4 (every RPC has full body)
- §7 RLS: ✓ T8 (5 tables × 2 policies = 10 policy statements)
- §8 pgTAP plan: ✓
  - 090 ingredients: 6 assertions T3 ✓
  - 100 menu_items: 5 assertions T4 ✓
  - 110 recipes: 6 assertions T5 ✓
  - 120 stock_movements: 5 assertions T6 ✓
  - 130 stock_counts: 3 assertions T6 ✓
  - 140 trigger: 6 assertions T7 (Note: spec §8.6 assertion 6 about "trigger error" was flagged as TBD-or-fallback. This plan uses the multi-item recipe fallback assertion which is robust and testable.) ✓
  - 150 RLS: 6 assertions T8 ✓
  - Total: 37 new + 50 existing = 87 ✓
- §9 Types: ✓ T9 (all 7 types)
- §10 Data layer: ✓ T9 (all 13 wrappers — note: stock_balance_now is also included, plus the 12 originally catalogued)
- §11 Query hooks: ✓ T10 (4 hooks)
- §12 Task projection (11 tasks): ✓ this plan has exactly 11 tasks (T1–T11)
- §13 Risk register: addressed in task notes (e.g., T2 backward-compat smoke, T7 column name verification)
- §14 Success criteria: ✓ T11 verification step

**2. Placeholder scan:**
- "TBD": searched — only in spec back-references ("§8.6 was flagged as TBD") which the plan resolves by choosing the fallback. ✓
- "TODO": none ✓
- "implement later": none ✓
- "Similar to Task N": none — every code block is full ✓
- Every code step has full code ✓

**3. Type consistency:**
- `Ingredient`, `MenuItem`, `Recipe`, `RecipeDetail`, `RecipeItem`, `StockMovement`, `StockBalance`, `StockMovementReason` all defined in T9 and used identically in T9 data layer and T10 query hooks ✓
- RPC names match between SQL (T1–T6) and data layer wrappers (T9) ✓
- Property names (`recipe_id`, `menu_item_id`, `quantity_delta`, `is_low`, etc.) consistent across SQL → types → data layer ✓
- `queryKeys.ingredients/menuItems/recipes/stockBalances` defined in T10 step 1 and used immediately in T10 step 2 ✓
- `stock_balance_now` RPC defined in T6 step 4, no client wrapper or query hook needed in 4.A (used internally by record_stock_count and by 4.D/E later)

**4. Bite-sized granularity check:**
- Each task has 4–6 steps, each step is a single action ✓
- All commit blocks use the PowerShell Out-File pattern (Vietnamese diacritics safe) ✓
- All commit messages end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` ✓

**5. Cross-task dependency check:**
- T3 Test 6 depends on T6's `record_stock_movement` — explicitly called out in T3 Step 4 note and T6 expected output ✓
- T4 Test 5 depends on T5's `upsert_recipe` — explicitly called out ✓
- T7 needs T5 (`upsert_recipe`) and T6 (none — just inserts directly) — Test 4/5/6 require T5 ✓
- T8 needs all prior RPCs for the role-gate assertions ✓
- T10 needs T9's data layer ✓

**No issues found. Plan ready to execute.**

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-21-v4-phase-4a-backend.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh implementer subagent per task, two-stage review (spec compliance + code quality), final opus overall review. Same pattern that successfully shipped 3B.2b.i, 3B.2b.ii.a, 3B.2b.ii.b, 3C.1, 3C.2, and 3C.3.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, with batch checkpoints for your review. Uses more of this session's context, but you can intervene between tasks.

Which approach?
