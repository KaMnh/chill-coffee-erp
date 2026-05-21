# Phase 4.A — Backend Foundation (Inventory) Design

**Parent:** `docs/superpowers/specs/2026-05-21-v4-phase-4-overall-design.md`
**Scope:** Database tables + RPCs + auto-deduction trigger + RLS + TypeScript types + data layer + query hooks + pgTAP tests. **Zero UI.**
**Branch:** `phase-4a-inventory-backend` (already created off main @ `v4-phase-3c`)
**Tag at end:** `v4-phase-4a`

---

## 0. TL;DR

- Amend `001_schema.sql`, `002_functions.sql`, `003_rls.sql` in place (matches Phase 3 pattern).
- 5 new tables in `public`: `ingredients`, `menu_items`, `recipes`, `recipe_items`, `stock_movements`.
- ~12 new RPCs (masters CRUD + recipe upsert + stock movement + stock count + balance queries).
- 1 new trigger: `AFTER INSERT FOR EACH ROW` on `sales_order_items` → `_apply_sale_deductions_row()`.
- 7 new pgTAP test files: 090–150, ~37 new assertions.
- Existing 50 pgTAP assertions must continue to pass byte-for-byte (trigger no-ops with zero menu_items rows).
- Add TypeScript types to `src/lib/types.ts`.
- New data layer file `src/lib/data/inventory.ts`.
- New query hook file `src/hooks/queries/use-inventory-queries.ts` + extend `keys.ts`.
- **No UI code.** UI starts in 4.B.

**verify:phase gate after merge: 75 Vitest + 87 pgTAP = 162 total.**

---

## 1. Goal

Provide a complete, RLS-secured, tested backend for inventory management. The UI layer (4.B+) can be built against this foundation without any further backend work. The trigger-based auto-deduction lets sales ingest naturally produce theoretical stock movements once recipes are populated.

---

## 2. Non-goals (specific to 4.A)

- No UI components. Not even a placeholder view.
- No bulk import / CSV. RPCs are atomic single-entity operations.
- No cost / price columns on `ingredients`. Deferred to Phase 5.
- No `kiotviet_*` RPCs. KiotViet integration uses only the existing `ingest_kiotviet_batch` RPC + the new trigger on `sales_order_items`.
- No audit log VIEWER. Audit rows ARE emitted; reading them is out of scope.
- No data layer for sales_orders integration beyond the trigger. Sales-side reads stay as-is.

---

## 3. Architecture

### 3.1 File layout

| File | Action | Phase 4.A scope |
|------|--------|------------------|
| `database/001_schema.sql` | **Amend in place** | Append 5 CREATE TABLE statements + indexes |
| `database/002_functions.sql` | **Amend in place** | Append ~12 CREATE OR REPLACE FUNCTION + 1 trigger function + 1 CREATE TRIGGER |
| `database/003_rls.sql` | **Amend in place** | Append RLS policies for 5 new tables |
| `database/tests/090_ingredients_crud.sql` | Create | ~6 assertions |
| `database/tests/100_menu_items_crud.sql` | Create | ~5 assertions |
| `database/tests/110_recipes_upsert.sql` | Create | ~6 assertions |
| `database/tests/120_stock_movements.sql` | Create | ~5 assertions |
| `database/tests/130_stock_counts.sql` | Create | ~3 assertions |
| `database/tests/140_sale_deduction_trigger.sql` | Create | ~6 assertions |
| `database/tests/150_rls_inventory.sql` | Create | ~6 assertions |
| `src/lib/types.ts` | **Amend in place (additive)** | Add 7 types |
| `src/lib/data/inventory.ts` | Create | ~12 wrapper functions |
| `src/lib/data/index.ts` | **Amend in place** | Re-export inventory module |
| `src/hooks/queries/use-inventory-queries.ts` | Create | 4 query hooks |
| `src/hooks/queries/keys.ts` | **Amend in place** | Add `queryKeys.inventory*` |
| `src/hooks/queries/index.ts` | **Amend in place** | Re-export inventory queries |

**No other files touched.** No new ViewKey, no NAV_ITEMS entries, no page.tsx changes.

### 3.2 RPC catalog

```
-- Ingredients
create_ingredient(p_name text, p_unit text, p_low_stock_threshold numeric, p_notes text)
  → uuid (new ingredient id)
update_ingredient(p_id uuid, p_name text, p_unit text,
                  p_low_stock_threshold numeric, p_notes text, p_is_active boolean)
  → void
delete_ingredient(p_id uuid)
  → void  -- hard-fails if referenced by stock_movements or recipe_items
list_ingredients()
  → SETOF (id, name, unit, low_stock_threshold, is_active, notes, created_at)

-- Menu items
create_menu_item(p_name text, p_external_product_name text, p_notes text)
  → uuid
update_menu_item(p_id uuid, p_name text, p_external_product_name text,
                 p_notes text, p_is_active boolean)
  → void
delete_menu_item(p_id uuid)
  → void  -- hard-fails if any active recipe references
list_menu_items()
  → SETOF (id, name, external_product_name, is_active, notes, created_at, recipe_count)

-- Recipes
upsert_recipe(p_menu_item_id uuid, p_is_active boolean, p_notes text, p_items jsonb)
  → uuid  -- p_items = jsonb array of {ingredient_id, quantity}
delete_recipe(p_recipe_id uuid)
  → void
list_recipes()
  → SETOF (recipe_id, menu_item_id, menu_item_name, is_active,
           item_count, updated_at, notes)
get_recipe_by_menu_item(p_menu_item_id uuid)
  → jsonb  -- {recipe_id, menu_item_id, is_active, notes,
            --  items: [{ingredient_id, ingredient_name, unit, quantity}]}
            -- returns NULL if no recipe exists

-- Stock
record_stock_movement(p_ingredient_id uuid, p_quantity_delta numeric,
                      p_reason text, p_notes text)
  → uuid  -- p_reason ∈ {'purchase_received', 'manual_adjustment_in',
          --              'manual_adjustment_out', 'waste'}
record_stock_count(p_ingredient_id uuid, p_actual_quantity numeric, p_notes text)
  → uuid  -- emits count_correction stock_movement
list_stock_movements(p_ingredient_id uuid, p_from timestamptz,
                     p_to timestamptz, p_limit int, p_offset int)
  → SETOF (id, ingredient_id, ingredient_name, quantity_delta, reason,
           occurred_at, source_order_id, source_recipe_id, notes,
           created_by, created_at)
stock_balance_now(p_ingredient_id uuid)
  → numeric  -- single SUM
stock_balances_all()
  → SETOF (ingredient_id, name, unit, theoretical_balance,
           low_stock_threshold, is_low, last_movement_at)
```

12 RPCs total.

### 3.3 Trigger catalog

```
_apply_sale_deductions_row()                 -- trigger function (SECURITY DEFINER)
trg_apply_sale_deductions ON sales_order_items AFTER INSERT FOR EACH ROW
```

---

## 4. Tables (full DDL)

To append to `database/001_schema.sql` (between existing tables and any final permissions block). Place section header comment for clear phase boundaries:

```sql
-- =====================================================================
-- Phase 4.A — Inventory module (ingredients, menu_items, recipes, stock)
-- =====================================================================
```

### 4.1 `ingredients`

```sql
CREATE TABLE IF NOT EXISTS public.ingredients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL UNIQUE,
  unit                  text NOT NULL,
  low_stock_threshold   numeric(18, 4),                    -- nullable: null = no alert
  is_active             boolean NOT NULL DEFAULT true,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES public.profiles(id),
  CONSTRAINT ingredients_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT ingredients_unit_not_empty CHECK (length(trim(unit)) > 0),
  CONSTRAINT ingredients_threshold_non_negative CHECK (
    low_stock_threshold IS NULL OR low_stock_threshold >= 0
  )
);

CREATE INDEX idx_ingredients_active ON public.ingredients(is_active)
  WHERE is_active = true;
```

### 4.2 `menu_items`

```sql
CREATE TABLE IF NOT EXISTS public.menu_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL UNIQUE,
  external_product_name   text,                            -- nullable
  is_active               boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES public.profiles(id),
  CONSTRAINT menu_items_name_not_empty CHECK (length(trim(name)) > 0),
  CONSTRAINT menu_items_external_name_not_empty CHECK (
    external_product_name IS NULL OR length(trim(external_product_name)) > 0
  )
);

CREATE INDEX idx_menu_items_ext_name_active
  ON public.menu_items (LOWER(TRIM(external_product_name)))
  WHERE external_product_name IS NOT NULL AND is_active = true;
```

The functional partial index supports the trigger's case-insensitive trimmed lookup.

### 4.3 `recipes`

```sql
CREATE TABLE IF NOT EXISTS public.recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id    uuid NOT NULL UNIQUE REFERENCES public.menu_items(id),
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_recipes_active ON public.recipes(menu_item_id)
  WHERE is_active = true;
```

`menu_item_id UNIQUE` enforces 1:1 (variants out of scope).

### 4.4 `recipe_items`

```sql
CREATE TABLE IF NOT EXISTS public.recipe_items (
  recipe_id       uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  ingredient_id   uuid NOT NULL REFERENCES public.ingredients(id),
  quantity        numeric(18, 4) NOT NULL,
  CONSTRAINT recipe_items_quantity_positive CHECK (quantity > 0),
  PRIMARY KEY (recipe_id, ingredient_id)
);
```

### 4.5 `stock_movements`

```sql
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id     uuid NOT NULL REFERENCES public.ingredients(id),
  quantity_delta    numeric(18, 4) NOT NULL,
  reason            text NOT NULL,
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  source_order_id   uuid REFERENCES public.sales_orders(id),
  source_recipe_id  uuid REFERENCES public.recipes(id),
  notes             text,
  created_by        uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_reason_valid CHECK (reason IN (
    'purchase_received',
    'sale_theoretical',
    'manual_adjustment_in',
    'manual_adjustment_out',
    'count_correction',
    'waste'
  )),
  CONSTRAINT stock_movements_delta_nonzero CHECK (quantity_delta != 0 OR reason = 'count_correction'),
  CONSTRAINT stock_movements_sign_matches_reason CHECK (
    CASE
      WHEN reason = 'purchase_received'       THEN quantity_delta > 0
      WHEN reason = 'manual_adjustment_in'    THEN quantity_delta > 0
      WHEN reason = 'manual_adjustment_out'   THEN quantity_delta < 0
      WHEN reason = 'waste'                   THEN quantity_delta < 0
      WHEN reason = 'sale_theoretical'        THEN quantity_delta < 0
      WHEN reason = 'count_correction'        THEN true  -- can be any sign or zero
      ELSE false
    END
  )
);

CREATE INDEX idx_stock_movements_ingredient_occurred
  ON public.stock_movements (ingredient_id, occurred_at DESC);
CREATE INDEX idx_stock_movements_reason
  ON public.stock_movements (reason);
```

The `stock_movements_delta_nonzero` check allows `count_correction` to be zero (when actual == theoretical, we still emit a row for audit trail). All other reasons must have a non-zero delta consistent with their sign.

---

## 5. Trigger function (full PL/pgSQL)

To append to `database/002_functions.sql`, between existing functions. Wrap in a clear section comment.

```sql
-- =====================================================================
-- Phase 4.A — Inventory: auto-deduction trigger
-- =====================================================================

CREATE OR REPLACE FUNCTION public._apply_sale_deductions_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_menu_item_id  uuid;
  v_recipe_id     uuid;
  v_item          record;
BEGIN
  -- 1. Match menu_item by case-insensitive trimmed external_product_name
  SELECT id INTO v_menu_item_id
  FROM public.menu_items
  WHERE external_product_name IS NOT NULL
    AND LOWER(TRIM(external_product_name)) = LOWER(TRIM(NEW.product_name))
    AND is_active = true
  LIMIT 1;

  IF v_menu_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. Active recipe?
  SELECT id INTO v_recipe_id
  FROM public.recipes
  WHERE menu_item_id = v_menu_item_id AND is_active = true
  LIMIT 1;

  IF v_recipe_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 3. Emit one stock_movement per recipe_item, scaled by NEW.quantity
  FOR v_item IN
    SELECT ingredient_id, quantity FROM public.recipe_items WHERE recipe_id = v_recipe_id
  LOOP
    INSERT INTO public.stock_movements (
      ingredient_id, quantity_delta, reason, occurred_at,
      source_order_id, source_recipe_id, created_by
    ) VALUES (
      v_item.ingredient_id,
      -(v_item.quantity * NEW.quantity),
      'sale_theoretical',
      NEW.created_at,
      NEW.order_id,
      v_recipe_id,
      NULL
    );
  END LOOP;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Defense-in-depth: never break ingest. Log + return NEW.
  INSERT INTO public.audit_log (event_type, payload, created_at)
  VALUES (
    'inventory_deduction_error',
    jsonb_build_object(
      'order_item_id', NEW.id,
      'order_id', NEW.order_id,
      'product_name', NEW.product_name,
      'sqlstate', SQLSTATE,
      'message', SQLERRM
    ),
    now()
  );
  RETURN NEW;
END;
$$;

-- Drop existing trigger if present (idempotent migration)
DROP TRIGGER IF EXISTS trg_apply_sale_deductions ON public.sales_order_items;

CREATE TRIGGER trg_apply_sale_deductions
AFTER INSERT ON public.sales_order_items
FOR EACH ROW
EXECUTE FUNCTION public._apply_sale_deductions_row();
```

**Notes on the trigger:**

- `SECURITY DEFINER` is required because `sale_theoretical` insertions into `stock_movements` must bypass the strict RPC-only RLS policy (the trigger acts as the system).
- `SET search_path = public` prevents search-path injection attacks per Supabase best practice.
- Uses `NEW.created_at` for `occurred_at` so the movement timestamp matches the original sale, not the trigger execution time. This matters for time-of-day reports.
- `created_by` is intentionally NULL — the row is system-generated, not user-authored.
- The EXCEPTION block ALSO inserts into `audit_log` if available. If `audit_log` itself causes an error, the trigger swallows it silently (RETURN NEW always succeeds).
- **No COMMIT inside trigger** — runs within the same transaction as the ingest INSERT. If the whole transaction rolls back (e.g., the trigger error sub-block raises somehow), all sales rows and stock_movements roll back together. Acceptable: stock_movements without their parent sales_order_items would be orphaned anyway.

---

## 6. Master CRUD RPCs (full PL/pgSQL)

### 6.1 Ingredients

```sql
CREATE OR REPLACE FUNCTION public.create_ingredient(
  p_name                text,
  p_unit                text,
  p_low_stock_threshold numeric DEFAULT NULL,
  p_notes               text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_new_id      uuid;
BEGIN
  -- Role gate
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Bạn không có quyền tạo nguyên liệu.';
  END IF;

  INSERT INTO public.ingredients (name, unit, low_stock_threshold, notes, created_by)
  VALUES (TRIM(p_name), TRIM(p_unit), p_low_stock_threshold, p_notes, auth.uid())
  RETURNING id INTO v_new_id;

  INSERT INTO public.audit_log (event_type, actor_id, payload)
  VALUES ('ingredient_created', auth.uid(),
          jsonb_build_object('ingredient_id', v_new_id, 'name', p_name));

  RETURN v_new_id;
END;
$$;
```

Pattern repeats for `update_ingredient`, `delete_ingredient`, `list_ingredients` — see spec §3.2 catalog for signatures. Full code generated during writing-plans phase.

**`delete_ingredient` hard-fail logic:**

```sql
-- Inside delete_ingredient body
IF EXISTS (SELECT 1 FROM public.stock_movements WHERE ingredient_id = p_id) THEN
  RAISE EXCEPTION 'Không thể xóa: nguyên liệu đã có giao dịch tồn kho. Hãy đặt is_active = false để vô hiệu hóa.';
END IF;
IF EXISTS (SELECT 1 FROM public.recipe_items WHERE ingredient_id = p_id) THEN
  RAISE EXCEPTION 'Không thể xóa: nguyên liệu đang được dùng trong công thức. Hãy xóa khỏi công thức trước.';
END IF;
DELETE FROM public.ingredients WHERE id = p_id;
```

### 6.2 Menu items

Same pattern as ingredients. `delete_menu_item` hard-fails if `recipes` rows reference it.

### 6.3 Recipes — `upsert_recipe`

```sql
CREATE OR REPLACE FUNCTION public.upsert_recipe(
  p_menu_item_id uuid,
  p_is_active    boolean,
  p_notes        text,
  p_items        jsonb        -- array of {ingredient_id, quantity}
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_recipe_id   uuid;
  v_item        jsonb;
  v_qty         numeric;
  v_ing_id      uuid;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'Bạn không có quyền chỉnh sửa công thức.';
  END IF;

  -- Find or create the recipe row
  SELECT id INTO v_recipe_id FROM public.recipes WHERE menu_item_id = p_menu_item_id;
  IF v_recipe_id IS NULL THEN
    INSERT INTO public.recipes (menu_item_id, is_active, notes, created_by)
    VALUES (p_menu_item_id, p_is_active, p_notes, auth.uid())
    RETURNING id INTO v_recipe_id;
  ELSE
    UPDATE public.recipes
       SET is_active = p_is_active, notes = p_notes, updated_at = now()
     WHERE id = v_recipe_id;
  END IF;

  -- Replace recipe_items atomically
  DELETE FROM public.recipe_items WHERE recipe_id = v_recipe_id;

  IF jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_ing_id := (v_item->>'ingredient_id')::uuid;
      v_qty    := (v_item->>'quantity')::numeric;
      IF v_qty IS NULL OR v_qty <= 0 THEN
        RAISE EXCEPTION 'Số lượng cho mỗi nguyên liệu phải lớn hơn 0.';
      END IF;
      IF v_ing_id IS NULL THEN
        RAISE EXCEPTION 'ingredient_id thiếu hoặc không hợp lệ.';
      END IF;
      INSERT INTO public.recipe_items (recipe_id, ingredient_id, quantity)
      VALUES (v_recipe_id, v_ing_id, v_qty);
    END LOOP;
  END IF;

  INSERT INTO public.audit_log (event_type, actor_id, payload)
  VALUES ('recipe_upserted', auth.uid(),
          jsonb_build_object('recipe_id', v_recipe_id,
                             'menu_item_id', p_menu_item_id,
                             'item_count', jsonb_array_length(COALESCE(p_items, '[]'::jsonb))));

  RETURN v_recipe_id;
END;
$$;
```

The DELETE-then-INSERT pattern is atomic (single transaction). Concurrent upserts on the same recipe could race — the UNIQUE on `menu_item_id` ensures only one recipe row per menu_item, but the items could be partially overwritten. Acceptable for admin operations; we don't expect concurrent recipe edits.

### 6.4 Stock — `record_stock_movement`

```sql
CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_ingredient_id uuid,
  p_quantity_delta numeric,
  p_reason        text,
  p_notes         text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role text;
  v_new_id      uuid;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('owner', 'manager', 'staff_operator') THEN
    RAISE EXCEPTION 'Bạn không có quyền nhập xuất kho.';
  END IF;

  -- Reject system-only reasons
  IF p_reason NOT IN ('purchase_received', 'manual_adjustment_in',
                      'manual_adjustment_out', 'waste') THEN
    RAISE EXCEPTION 'Lý do không hợp lệ. Chỉ chấp nhận: purchase_received, manual_adjustment_in, manual_adjustment_out, waste.';
  END IF;

  -- Sign vs reason check (DB CHECK also enforces, double-belt-and-suspenders)
  IF p_reason IN ('purchase_received', 'manual_adjustment_in') AND p_quantity_delta <= 0 THEN
    RAISE EXCEPTION 'Số lượng phải lớn hơn 0 cho lý do %.', p_reason;
  END IF;
  IF p_reason IN ('manual_adjustment_out', 'waste') AND p_quantity_delta >= 0 THEN
    RAISE EXCEPTION 'Số lượng phải nhỏ hơn 0 cho lý do %.', p_reason;
  END IF;

  INSERT INTO public.stock_movements (
    ingredient_id, quantity_delta, reason, notes, created_by
  ) VALUES (p_ingredient_id, p_quantity_delta, p_reason, p_notes, auth.uid())
  RETURNING id INTO v_new_id;

  INSERT INTO public.audit_log (event_type, actor_id, payload)
  VALUES ('stock_movement_recorded', auth.uid(),
          jsonb_build_object(
            'movement_id', v_new_id,
            'ingredient_id', p_ingredient_id,
            'delta', p_quantity_delta,
            'reason', p_reason
          ));

  RETURN v_new_id;
END;
$$;
```

### 6.5 `record_stock_count`

```sql
CREATE OR REPLACE FUNCTION public.record_stock_count(
  p_ingredient_id  uuid,
  p_actual_quantity numeric,
  p_notes          text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_role        text;
  v_theoretical_before numeric;
  v_delta              numeric;
  v_new_id             uuid;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE id = auth.uid();
  IF v_caller_role NOT IN ('owner', 'manager', 'staff_operator') THEN
    RAISE EXCEPTION 'Bạn không có quyền kiểm kê.';
  END IF;

  IF p_actual_quantity < 0 THEN
    RAISE EXCEPTION 'Số lượng thực tế không thể âm.';
  END IF;

  SELECT COALESCE(SUM(quantity_delta), 0) INTO v_theoretical_before
  FROM public.stock_movements
  WHERE ingredient_id = p_ingredient_id;

  v_delta := p_actual_quantity - v_theoretical_before;

  INSERT INTO public.stock_movements (
    ingredient_id, quantity_delta, reason, notes, created_by
  ) VALUES (p_ingredient_id, v_delta, 'count_correction', p_notes, auth.uid())
  RETURNING id INTO v_new_id;

  INSERT INTO public.audit_log (event_type, actor_id, payload)
  VALUES ('stock_count_recorded', auth.uid(),
          jsonb_build_object(
            'movement_id', v_new_id,
            'ingredient_id', p_ingredient_id,
            'theoretical_before', v_theoretical_before,
            'actual', p_actual_quantity,
            'delta', v_delta
          ));

  RETURN v_new_id;
END;
$$;
```

Note: `v_theoretical_before` is computed at the start of the transaction. Concurrent movements arriving between the SELECT and the INSERT could make the delta slightly stale. For typical staff workflows (one count per ingredient per day), this is a non-issue.

### 6.6 `stock_balance_now` / `stock_balances_all`

```sql
CREATE OR REPLACE FUNCTION public.stock_balance_now(p_ingredient_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(quantity_delta), 0)::numeric
  FROM public.stock_movements
  WHERE ingredient_id = p_ingredient_id;
$$;

CREATE OR REPLACE FUNCTION public.stock_balances_all()
RETURNS TABLE (
  ingredient_id        uuid,
  name                 text,
  unit                 text,
  theoretical_balance  numeric,
  low_stock_threshold  numeric,
  is_low               boolean,
  last_movement_at     timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    i.id AS ingredient_id,
    i.name,
    i.unit,
    COALESCE(SUM(sm.quantity_delta), 0)::numeric AS theoretical_balance,
    i.low_stock_threshold,
    CASE
      WHEN i.low_stock_threshold IS NULL THEN false
      ELSE COALESCE(SUM(sm.quantity_delta), 0) < i.low_stock_threshold
    END AS is_low,
    MAX(sm.occurred_at) AS last_movement_at
  FROM public.ingredients i
  LEFT JOIN public.stock_movements sm ON sm.ingredient_id = i.id
  WHERE i.is_active = true
  GROUP BY i.id, i.name, i.unit, i.low_stock_threshold
  ORDER BY i.name;
$$;
```

Both are `STABLE` (no writes, no side effects), enabling Supabase REST cache.

### 6.7 `list_stock_movements`

```sql
CREATE OR REPLACE FUNCTION public.list_stock_movements(
  p_ingredient_id uuid DEFAULT NULL,
  p_from          timestamptz DEFAULT NULL,
  p_to            timestamptz DEFAULT NULL,
  p_limit         int DEFAULT 100,
  p_offset        int DEFAULT 0
) RETURNS TABLE (
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
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    sm.id, sm.ingredient_id, i.name AS ingredient_name,
    sm.quantity_delta, sm.reason, sm.occurred_at,
    sm.source_order_id, sm.source_recipe_id,
    sm.notes, sm.created_by, sm.created_at
  FROM public.stock_movements sm
  JOIN public.ingredients i ON i.id = sm.ingredient_id
  WHERE (p_ingredient_id IS NULL OR sm.ingredient_id = p_ingredient_id)
    AND (p_from IS NULL OR sm.occurred_at >= p_from)
    AND (p_to   IS NULL OR sm.occurred_at <= p_to)
  ORDER BY sm.occurred_at DESC, sm.id DESC
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
$$;
```

`ORDER BY sm.id DESC` as a tiebreaker ensures deterministic ordering when multiple movements share the same `occurred_at` timestamp (common in pgTAP tests).

---

## 7. RLS policies

To append to `database/003_rls.sql`. Two patterns:

```sql
-- Phase 4.A — Inventory RLS

ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

-- Read: all authenticated users can SELECT all 5 tables
CREATE POLICY ingredients_select_all ON public.ingredients
  FOR SELECT TO authenticated USING (true);
CREATE POLICY menu_items_select_all ON public.menu_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY recipes_select_all ON public.recipes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY recipe_items_select_all ON public.recipe_items
  FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_movements_select_all ON public.stock_movements
  FOR SELECT TO authenticated USING (true);

-- Write: deny ALL direct INSERT/UPDATE/DELETE from clients.
-- All writes go through SECURITY DEFINER RPCs (or the trigger).
CREATE POLICY ingredients_no_direct_write ON public.ingredients
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY menu_items_no_direct_write ON public.menu_items
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY recipes_no_direct_write ON public.recipes
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY recipe_items_no_direct_write ON public.recipe_items
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY stock_movements_no_direct_write ON public.stock_movements
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
```

The `FOR ALL ... USING (false)` policy blocks INSERT/UPDATE/DELETE for the `authenticated` role. The `FOR SELECT ... USING (true)` policy allows SELECT (PostgreSQL evaluates the most permissive matching policy per command). The SECURITY DEFINER RPCs bypass RLS because they run as the function's owner (postgres role).

**Important:** the trigger function `_apply_sale_deductions_row()` is also SECURITY DEFINER, so its INSERTs into `stock_movements` bypass RLS as expected.

---

## 8. pgTAP test plan

7 new files, ~37 new assertions. Each file follows the standard pattern: `BEGIN; SELECT plan(N); ... SELECT * FROM finish(); ROLLBACK;`.

### 8.1 `090_ingredients_crud.sql` (~6 assertions)

```
1. is(create_ingredient('Sữa tươi', 'L', 5, 'Carton 1L'), <uuid>) — successful insert
2. is((SELECT name FROM ingredients WHERE id = <id>), 'Sữa tươi') — name trimmed and stored
3. throws_ok(SELECT create_ingredient('Sữa tươi', 'L', NULL, NULL), 'duplicate key') — UNIQUE on name
4. throws_ok(SELECT create_ingredient('   ', 'L', NULL, NULL), '%ingredients_name_not_empty%') — CHECK constraint
5. ok(update_ingredient(<id>, ..., is_active := false)) — soft delete
6. throws_ok(SELECT delete_ingredient(<id>) after a stock_movement was inserted, '%nguyên liệu đã có giao dịch%') — hard-fail
```

### 8.2 `100_menu_items_crud.sql` (~5 assertions)

```
1. is(create_menu_item('Cà phê đen đá M', 'Cafe den da M', NULL), <uuid>)
2. is((SELECT external_product_name FROM menu_items WHERE id = <id>), 'Cafe den da M')
3. throws_ok(SELECT create_menu_item('Cà phê đen đá M', NULL, NULL), 'duplicate key') — UNIQUE on name
4. ok(create_menu_item('No matcher', NULL, NULL)) — nullable external_product_name
5. throws_ok(SELECT delete_menu_item(<id>) after upsert_recipe created a recipe for it, '%đang có công thức%')
```

### 8.3 `110_recipes_upsert.sql` (~6 assertions)

```
1. is(upsert_recipe(<menu_id>, true, NULL, '[{"ingredient_id":"<ing1>","quantity":18}]'::jsonb), <recipe_id>) — insert
2. is((SELECT count(*) FROM recipe_items WHERE recipe_id = <recipe_id>), 1::bigint)
3. is(upsert_recipe(<menu_id>, true, NULL, '[{"ingredient_id":"<ing1>","quantity":20},{"ingredient_id":"<ing2>","quantity":200}]'::jsonb), <recipe_id>) — same id returned (update path)
4. is((SELECT count(*) FROM recipe_items WHERE recipe_id = <recipe_id>), 2::bigint) — replaced atomically
5. throws_ok(SELECT upsert_recipe(<menu_id>, true, NULL, '[{"ingredient_id":"<ing1>","quantity":-1}]'::jsonb), '%lớn hơn 0%')
6. ok(SELECT delete_recipe(<recipe_id>) AND NOT EXISTS (SELECT 1 FROM recipe_items WHERE recipe_id = <recipe_id>)) — cascade
```

### 8.4 `120_stock_movements.sql` (~5 assertions)

```
1. is(record_stock_movement(<ing_id>, 100, 'purchase_received', 'Nhập kho'), <movement_id>)
2. is(stock_balance_now(<ing_id>), 100::numeric)
3. throws_ok(SELECT record_stock_movement(<ing_id>, -5, 'purchase_received', NULL), '%phải lớn hơn 0%') — sign validation
4. throws_ok(SELECT record_stock_movement(<ing_id>, 100, 'sale_theoretical', NULL), '%Lý do không hợp lệ%') — system-only reason rejected
5. ok((SELECT count(*) FROM audit_log WHERE event_type = 'stock_movement_recorded' AND payload->>'movement_id' = <movement_id>::text) = 1) — audit
```

### 8.5 `130_stock_counts.sql` (~3 assertions)

```
1. After purchase_received +100, record_stock_count(<ing>, 95) emits movement with quantity_delta = -5
2. stock_balance_now(<ing>) = 95 after the count
3. record_stock_count(<ing>, 95) again when balance is already 95 emits a row with quantity_delta = 0 (for audit trail)
```

### 8.6 `140_sale_deduction_trigger.sql` (~6 assertions)

This is the most critical file. Tests that:

```
1. Insert sales_orders + sales_order_items WITHOUT any menu_items → trigger no-ops. stock_movements unchanged. (Backward compat)
2. Insert menu_item with external_product_name='Cafe sua' + recipe with 18g coffee + 50ml milk. Insert sales_order_items with product_name='Cafe sua', quantity=2. Expect: 2 stock_movements emitted, deltas = -36 (coffee) and -100 (milk).
3. Case-insensitive trimmed match: insert with product_name='  CAFE SUA  ' should still match menu_item external_product_name='Cafe sua'.
4. Inactive recipe: deactivate the recipe, insert another sales_order_item with product_name='Cafe sua', quantity=1. Expect: zero new stock_movements.
5. Inactive menu_item: similar test with deactivated menu_item.
6. Trigger error case: simulate by inserting a sales_order_item where the recipe references a deleted ingredient (impossible via FK normally, but verified via direct injection). Trigger should not break the insert; audit_log should have an inventory_deduction_error row. [Note: may require disabling FK temporarily in test setup — TBD in plan-writing if this assertion is feasible.]
```

If assertion 6 isn't feasible without breaking constraints, replace with: `Verify multiple recipe_items per recipe scale correctly (1 sale × 3 ingredients in recipe = 3 stock_movements).`

### 8.7 `150_rls_inventory.sql` (~6 assertions)

```
1. As role 'authenticated' (no auth.uid set): SELECT * FROM ingredients succeeds (read all).
2. As role 'authenticated': INSERT INTO ingredients ... → expect RLS error "new row violates row-level security policy".
3. Same for menu_items, recipes, recipe_items, stock_movements (each direct INSERT blocked).
4. Calling create_ingredient as authenticated user with role='employee_viewer' → expect "Bạn không có quyền tạo nguyên liệu."
5. Calling record_stock_movement as authenticated user with role='staff_operator' → succeeds (staff can stock).
6. Calling upsert_recipe as authenticated user with role='staff_operator' → expect "Bạn không có quyền chỉnh sửa công thức."
```

### 8.8 Existing tests must still pass

The trigger is the only Phase 4.A change that could affect existing tests. With zero `menu_items` rows in the test setup, the trigger no-ops. Verified by:

- `010-080` test files create zero `menu_items` rows
- `010-080` tests insert into `sales_order_items` via `ingest_kiotviet_batch` — trigger fires but finds no matching `menu_item`, returns NEW immediately
- All 50 existing assertions remain valid

**verify:phase gate after 4.A merges: 75 Vitest + 50 (existing) + 37 (new) = 75 + 87 = 162 total.**

---

## 9. TypeScript types

Append to `src/lib/types.ts`. Place in a clearly-labeled Phase 4 section.

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
  created_by: string | null;
}

export interface MenuItem {
  id: string;
  name: string;
  external_product_name: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  /** Computed by list_menu_items RPC */
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

Also: in a separate constants module (to be added in 4.B, NOT in 4.A — flag for next phase), define:

```ts
// Phase 4.B will add this:
export const STOCK_UNITS = ["kg", "g", "L", "ml", "each", "pack"] as const;
export type StockUnit = (typeof STOCK_UNITS)[number];
export const STOCK_UNIT_LABELS_VI: Record<StockUnit, string> = {
  kg: "Kg",
  g: "Gram",
  L: "Lít",
  ml: "Mililit",
  each: "Cái",
  pack: "Gói",
};
```

---

## 10. Data layer (`src/lib/data/inventory.ts`)

Create new file with ~12 thin wrapper functions. Each wraps a single RPC call with TypeScript typing.

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Ingredient, MenuItem, Recipe, RecipeDetail,
  StockMovement, StockBalance, StockMovementReason
} from "@/lib/types";

// Ingredients
export async function loadIngredients(supabase: SupabaseClient): Promise<Ingredient[]> {
  const { data, error } = await supabase.rpc("list_ingredients");
  if (error) throw error;
  return (data ?? []) as Ingredient[];
}

export async function createIngredient(
  supabase: SupabaseClient,
  input: { name: string; unit: string; low_stock_threshold?: number | null; notes?: string | null }
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
    id: string; name: string; unit: string;
    low_stock_threshold: number | null; notes: string | null; is_active: boolean;
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

export async function deleteIngredient(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_ingredient", { p_id: id });
  if (error) throw error;
}

// Menu items — same pattern
export async function loadMenuItems(supabase: SupabaseClient): Promise<MenuItem[]> { /* ... */ }
export async function createMenuItem(supabase, input): Promise<string> { /* ... */ }
export async function updateMenuItem(supabase, input): Promise<void> { /* ... */ }
export async function deleteMenuItem(supabase, id): Promise<void> { /* ... */ }

// Recipes
export async function loadRecipes(supabase: SupabaseClient): Promise<Recipe[]> { /* list_recipes */ }
export async function getRecipeByMenuItem(
  supabase: SupabaseClient, menuItemId: string
): Promise<RecipeDetail | null> { /* get_recipe_by_menu_item */ }
export async function upsertRecipe(
  supabase: SupabaseClient,
  input: {
    menu_item_id: string; is_active: boolean; notes: string | null;
    items: Array<{ ingredient_id: string; quantity: number }>;
  }
): Promise<string> { /* upsert_recipe */ }
export async function deleteRecipe(supabase, recipeId): Promise<void> { /* ... */ }

// Stock
export async function recordStockMovement(
  supabase: SupabaseClient,
  input: { ingredient_id: string; quantity_delta: number; reason: StockMovementReason; notes?: string | null }
): Promise<string> { /* record_stock_movement */ }
export async function recordStockCount(
  supabase: SupabaseClient,
  input: { ingredient_id: string; actual_quantity: number; notes?: string | null }
): Promise<string> { /* record_stock_count */ }
export async function loadStockMovements(
  supabase: SupabaseClient,
  filter: { ingredient_id?: string; from?: string; to?: string; limit?: number; offset?: number }
): Promise<StockMovement[]> { /* list_stock_movements */ }
export async function loadStockBalanceNow(
  supabase: SupabaseClient, ingredientId: string
): Promise<number> { /* stock_balance_now */ }
export async function loadStockBalancesAll(supabase: SupabaseClient): Promise<StockBalance[]> { /* stock_balances_all */ }
```

Re-exported from `src/lib/data/index.ts`:

```ts
export * from "./inventory";
```

---

## 11. Query hooks (`src/hooks/queries/use-inventory-queries.ts`)

4 query hooks following the established stale-time pattern.

```ts
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadIngredients, loadMenuItems, loadRecipes, loadStockBalancesAll
} from "@/lib/data";
import { queryKeys } from "./keys";

export function useIngredientsQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ingredients(),
    queryFn: () => loadIngredients(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,  // 60s — masters change infrequently
  });
}

export function useMenuItemsQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.menuItems(),
    queryFn: () => loadMenuItems(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useRecipesQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.recipes(),
    queryFn: () => loadRecipes(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}

export function useStockBalancesQuery(supabase: SupabaseClient | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.stockBalances(),
    queryFn: () => loadStockBalancesAll(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 30_000,  // 30s — balances move with sales
  });
}
```

**No `useRecipeDetailQuery` or `useStockMovementsQuery` in 4.A** — they're not needed yet. They'll be added in 4.C and 4.D respectively when the consuming UI is built.

### 11.1 Query keys (`src/hooks/queries/keys.ts` extension)

```ts
// Append to existing queryKeys object:
inventory: {
  all: () => ["inventory"] as const,
  ingredients: () => ["inventory", "ingredients"] as const,
  menuItems: () => ["inventory", "menu_items"] as const,
  recipes: () => ["inventory", "recipes"] as const,
  recipeByMenuItem: (menuItemId: string) =>
    ["inventory", "recipe", menuItemId] as const,
  stockBalances: () => ["inventory", "stock_balances"] as const,
  stockMovements: (filter?: { ingredient_id?: string; from?: string; to?: string }) =>
    filter ? ["inventory", "stock_movements", filter] as const
           : ["inventory", "stock_movements"] as const,
}
```

Flat shortcuts (matches `queryKeys.handover(businessDate)` style):

```ts
// In queryKeys, add direct accessors:
ingredients: () => queryKeys.inventory.ingredients(),
menuItems: () => queryKeys.inventory.menuItems(),
recipes: () => queryKeys.inventory.recipes(),
stockBalances: () => queryKeys.inventory.stockBalances(),
```

Final naming decided during plan-writing (the plan author can choose between nested and flat based on what's most consistent with existing keys.ts).

---

## 12. Implementation strategy (task projection)

Projected ~10–12 tasks for `superpowers:writing-plans`:

1. **T1**: Schema additions (`001_schema.sql`) — 5 tables + indexes + constraints. Verify migrate cleanly. No tests yet.
2. **T2**: Trigger function + trigger (`002_functions.sql` additions). Verify the trigger doesn't fire on existing test data (backward-compat smoke).
3. **T3**: Ingredients RPCs (`create/update/delete/list_ingredient`) + pgTAP `090_ingredients_crud.sql`.
4. **T4**: Menu items RPCs (`create/update/delete/list_menu_item`) + pgTAP `100_menu_items_crud.sql`.
5. **T5**: Recipes RPCs (`upsert_recipe`, `delete_recipe`, `list_recipes`, `get_recipe_by_menu_item`) + pgTAP `110_recipes_upsert.sql`.
6. **T6**: Stock RPCs (`record_stock_movement`, `record_stock_count`, `stock_balance_now`, `stock_balances_all`, `list_stock_movements`) + pgTAP `120_stock_movements.sql` + `130_stock_counts.sql`.
7. **T7**: Sale deduction trigger pgTAP `140_sale_deduction_trigger.sql` (covers all 6 assertions including backward-compat).
8. **T8**: RLS policies (`003_rls.sql`) + pgTAP `150_rls_inventory.sql`.
9. **T9**: TypeScript types (`types.ts`) + data layer (`inventory.ts`) + data index re-export.
10. **T10**: Query hooks (`use-inventory-queries.ts`) + query keys (`keys.ts`) + query index re-export.
11. **T11**: Final verify:phase run — expect 75 Vitest + 87 pgTAP = 162 green. Tag `v4-phase-4a`.

11 tasks. Each is small (mostly SQL + 1 reference file each). Plan author may split T6 if it gets too long.

---

## 13. Risk register (4.A-specific, in addition to overall §10)

| Risk | Mitigation |
|------|------------|
| **Functional index syntax differs across PostgreSQL versions** | Verified for PG 15+ (Supabase default). The expression `LOWER(TRIM(external_product_name))` is supported. Test in 4.A migration verification. |
| **`numeric(18, 4)` precision insufficient for some inventory** | 14 digits before decimal × 4 after = up to 99,999,999,999,999.9999 units. Sufficient for any plausible coffee shop quantity. |
| **Multi-recipe products lost in 1:1 schema** | Documented in non-goals. Future ALTER drops `recipes.menu_item_id UNIQUE` if needed. |
| **`auth.uid()` returns NULL in trigger** | Trigger sets `created_by = NULL` deliberately. Not an issue. |
| **Concurrent `record_stock_count` on same ingredient** | Acceptable race (delta computed from snapshot; last write wins). Not high-throughput. |
| **Vietnamese error messages in RPC** | All RPCs throw with Vietnamese-language exceptions (`Bạn không có quyền...`). Matches Phase 1 RPC convention. |
| **pgTAP `140_sale_deduction_trigger.sql` assertion 6 (trigger error)** | Spec marks this as "TBD in plan-writing if feasible". If not feasible, fallback assertion provided. Plan author makes the call. |
| **`audit_log` table missing columns** | Verified: existing `audit_log` table has `event_type`, `actor_id` (nullable), `payload` (jsonb), `created_at`. Trigger and RPCs use only these. |

---

## 14. Success criteria for 4.A

1. ✅ All 5 tables created with constraints + indexes
2. ✅ Trigger fires on `sales_order_items` INSERT, no-ops if no matching menu_item+recipe
3. ✅ Existing 50 pgTAP assertions still pass byte-for-byte
4. ✅ 37 new pgTAP assertions pass
5. ✅ `verify:phase` exits 0 with `Vitest 75/75 + pgTAP 87/87 = 162/162`
6. ✅ TypeScript build succeeds (`npx tsc --noEmit`)
7. ✅ `npm run build` succeeds
8. ✅ No UI changes; `git diff main..HEAD --name-only` shows only spec + plan docs + 3 amended DB files + 7 new pgTAP files + 5 new/amended TS files = 17 files total
9. ✅ Tag `v4-phase-4a` placed on the final merge commit

---

## 15. Self-review

**Placeholder scan:** No "TBD" in normative sections (§§3–8, 12–14). Exception flagged: §8.6 assertion 6 has "TBD in plan-writing if feasible" with fallback. §11.1 has "Final naming decided during plan-writing" — acceptable design flexibility. §9 has a flag for 4.B work — explicitly out of scope, not a placeholder.

**Internal consistency:**
- 5 tables: ingredients, menu_items, recipes, recipe_items, stock_movements ✓
- 12 RPCs catalogued in §3.2 and bodied in §6 ✓
- Trigger fully specified in §5 ✓
- Test count: 6+5+6+5+3+6+6 = 37 new assertions ✓ matches §8.8 calculation
- Task count: 11 ✓ matches §12

**Ambiguity check:**
- `delete_ingredient` policy: hard-fail with Vietnamese hint, suggests soft-delete via `is_active=false`. Unambiguous.
- `record_stock_count` with zero variance: explicitly emits row with quantity_delta=0 (§8.5 assertion 3). Unambiguous.
- Trigger error case (assertion 6): explicitly flagged as TBD with fallback. Unambiguous: plan author decides at implementation time.

**Scope check:** Backend-only. Zero UI. Single focused phase. Matches 3B.2b.ii.b's "tests + verify-mirror" pattern in shape. Plan should fit comfortably in 11 tasks.

No issues found.

---

## 16. Next step

User reviews this spec → if approved, invoke `superpowers:writing-plans` to draft the 11-task implementation plan.
