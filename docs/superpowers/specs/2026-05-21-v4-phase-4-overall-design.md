# Phase 4 — Inventory Module (Overall Design)

**Status:** Approved 2026-05-21. Covers Phase 4 strategy, sub-phase manifest, data model, key RPCs, auto-deduction mechanics, Vietnamese terminology, and risk register. Each sub-phase (4.A–4.E) gets its own focused spec + plan + execute cycle.

---

## 0. TL;DR

Phase 4 builds the **inventory module from scratch** (greenfield — v3 has no inventory). Hybrid stock model:

- **Theoretical balance** tracked via signed ledger (`stock_movements`).
- **Auto-deduction on sale** via `AFTER INSERT` trigger on `sales_order_items` — looks up menu_item by `external_product_name` → active recipe → emits one `stock_movements` row per `recipe_items` row, scaled by sold quantity. Existing `ingest_kiotviet_batch` RPC stays byte-for-byte unchanged.
- **Manual reconciliation** via `record_stock_count` RPC — bridges theoretical → actual via `count_correction` movement.
- **No suppliers, no purchase orders** — ingredient purchases continue as expense entries.
- **Manual `menu_items` table** in v4 — loose coupling to KiotViet via `external_product_name` string (case-insensitive trimmed match).
- **1:1 menu_item ↔ recipe** — variants out of scope.

Decomposed into 5 sub-phases:
- **4.A** Backend foundation (DB + RPCs + types + data layer + query hooks + pgTAP). No UI.
- **4.B** Masters UI (`IngredientsView` + `MenuItemsView` CRUD).
- **4.C** Recipe builder UI.
- **4.D** Stock counting + ledger UI.
- **4.E** Inventory dashboard + variance reports.

Estimated **~30–40 tasks total** across all 5 sub-phases.

---

## 1. Goal

Enable the coffee shop to track theoretical ingredient consumption from KiotViet sales, reconcile against periodic manual counts, and surface low-stock + waste signals. The hybrid model means:

- The system can **propose** how much stock should be left (theoretical, recipe-derived).
- The owner can **verify** that with periodic counts (actual).
- The **gap** (variance) becomes the signal — waste, theft, recipe drift, KiotViet rename, or other anomalies.

This is the v4 module that finally answers: "where did the milk go?"

---

## 2. Non-goals (out of scope for entire Phase 4)

| Item | Why deferred | Possible future phase |
|------|--------------|------------------------|
| Supplier management + purchase orders | Purchases live in expenses module (3B.1); adding suppliers doubles scope without clear daily-ops payoff | Phase 4.+ or never |
| KiotViet product catalog API sync | User chose loose `external_product_name` string match over authoritative catalog sync; KiotViet webhook `product.update` events still ignored (Phase 1 behavior preserved) | Phase 4.+ |
| Multi-variant recipes (S/M/L sizing, modifiers) | 1:1 menu_item ↔ recipe locked. Each variant = separate menu_item + separate recipe. | Phase 4.+ |
| Ingredient cost / price tracking | No cost-of-goods reporting yet. `ingredients` has no price column. | Phase 5 (analytics) |
| Inventory alerts via email/SMS | UI banner only. No notification infra yet (also a Phase 3C.3 deferral). | Phase 4.+ or Phase 6 |
| Bulk import (CSV) of ingredients/recipes | Manual entry only in 4.B/4.C. | Phase 4.+ |
| Recipe yield (1 batch = N drinks) | Recipe quantities are per-unit-sold, not per-batch. | Phase 4.+ |
| Audit log UI for inventory operations | Audit rows ARE emitted in 4.A; viewer is Phase 6 cross-cutting. | Phase 6 |

---

## 3. Scope decisions locked during brainstorming

| Decision | Choice | Implication |
|----------|--------|-------------|
| **Stock model** | Hybrid: theoretical via ledger + manual reconciliation via counts | Need recipes + stock_movements + count_correction reason |
| **Menu item source** | Manual `menu_items` table in v4 (loose coupling) | No KiotViet API for catalog; user types matching `external_product_name` string |
| **Suppliers / POs** | NOT in scope | Purchases remain in expenses module |
| **Auto-deduction trigger** | YES — but as AFTER INSERT trigger on `sales_order_items`, NOT as modification to `ingest_kiotviet_batch` RPC | RPC unchanged; trigger is additive. All existing 50 pgTAP assertions still pass. |
| **Sub-phase count** | 5 (matches 3B/3C cadence) | 4.A through 4.E, each ~5–12 tasks, strict dependency order |

---

## 4. Data model (5 new tables)

### 4.1 `ingredients`

```sql
CREATE TABLE inventory.ingredients (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL UNIQUE,
  unit                  text NOT NULL,             -- 'kg', 'g', 'L', 'ml', 'each', 'pack'
  low_stock_threshold   numeric(18, 4),            -- nullable; null = no alert
  is_active             boolean NOT NULL DEFAULT true,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES public.profiles(id)
);
CREATE INDEX idx_ingredients_active ON inventory.ingredients(is_active) WHERE is_active = true;
```

Notes:
- Schema namespace `inventory` (mirrors how cash/safe use top-level public — but keeping namespace to avoid bloating `public`). To revisit during 4.A brainstorm if user prefers `public.*`.
- `unit` is free-form text, validated client-side against a fixed enum. Future ALTER if we want a real CHECK constraint.

### 4.2 `menu_items`

```sql
CREATE TABLE inventory.menu_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL UNIQUE,    -- v4 internal label, e.g., "Cà phê đen đá M"
  external_product_name   text,                    -- nullable, KiotViet product_name to match
  is_active               boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid REFERENCES public.profiles(id)
);
CREATE INDEX idx_menu_items_ext_name ON inventory.menu_items (LOWER(TRIM(external_product_name)))
  WHERE external_product_name IS NOT NULL AND is_active = true;
```

The functional index supports the trigger's case-insensitive trimmed lookup.

### 4.3 `recipes`

```sql
CREATE TABLE inventory.recipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id    uuid NOT NULL UNIQUE REFERENCES inventory.menu_items(id),
  is_active       boolean NOT NULL DEFAULT true,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES public.profiles(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

`menu_item_id UNIQUE` enforces 1:1. Dropping that constraint later enables multi-variant recipes without other schema changes.

### 4.4 `recipe_items`

```sql
CREATE TABLE inventory.recipe_items (
  recipe_id       uuid NOT NULL REFERENCES inventory.recipes(id) ON DELETE CASCADE,
  ingredient_id   uuid NOT NULL REFERENCES inventory.ingredients(id),
  quantity        numeric(18, 4) NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (recipe_id, ingredient_id)
);
```

Junction table. Quantity is in the ingredient's own `unit` (no unit conversion in v4).

### 4.5 `stock_movements`

```sql
CREATE TABLE inventory.stock_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id     uuid NOT NULL REFERENCES inventory.ingredients(id),
  quantity_delta    numeric(18, 4) NOT NULL,           -- signed: + IN, − OUT
  reason            text NOT NULL CHECK (reason IN (
                      'purchase_received',
                      'sale_theoretical',
                      'manual_adjustment_in',
                      'manual_adjustment_out',
                      'count_correction',
                      'waste'
                    )),
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  source_order_id   uuid REFERENCES public.sales_orders(id),    -- if reason='sale_theoretical'
  source_recipe_id  uuid REFERENCES inventory.recipes(id),       -- denormalized for audit trail
  notes             text,
  created_by        uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_stock_movements_ingredient_occurred
  ON inventory.stock_movements (ingredient_id, occurred_at DESC);
CREATE INDEX idx_stock_movements_reason ON inventory.stock_movements (reason);
```

**Theoretical balance** = `SUM(quantity_delta) WHERE ingredient_id = X`. Computed via `stock_balance_now(p_ingredient_id)` RPC.

### 4.6 Reason enum semantics

| Reason | Sign | Source | Created by RPC |
|--------|------|--------|----------------|
| `purchase_received` | + | Manual entry | `record_stock_movement` (staff+) |
| `sale_theoretical` | − | Auto via trigger | none (trigger inserts directly, SECURITY DEFINER) |
| `manual_adjustment_in` | + | Manual | `record_stock_movement` |
| `manual_adjustment_out` | − | Manual | `record_stock_movement` |
| `count_correction` | ± (signed) | Auto via count RPC | `record_stock_count` |
| `waste` | − | Manual | `record_stock_movement` |

RPC-level CHECK enforces sign-vs-reason consistency (e.g., `purchase_received` must have positive `quantity_delta`).

---

## 5. RPCs (added in 4.A)

### 5.1 Masters CRUD

```
create_ingredient(p_name, p_unit, p_low_stock_threshold, p_notes) → uuid
update_ingredient(p_id, p_name, p_unit, p_low_stock_threshold, p_notes, p_is_active)
delete_ingredient(p_id)
  -- HARD FAIL if any stock_movements or recipe_items reference; throw with hint to deactivate
list_ingredients() → SETOF (id, name, unit, low_stock_threshold, is_active, notes, created_at)

create_menu_item(p_name, p_external_product_name, p_notes) → uuid
update_menu_item(p_id, p_name, p_external_product_name, p_notes, p_is_active)
delete_menu_item(p_id)
  -- HARD FAIL if any active recipe references; throw with hint
list_menu_items() → SETOF (id, name, external_product_name, is_active, recipe_count)
```

### 5.2 Recipes

```
upsert_recipe(p_menu_item_id, p_is_active, p_notes, p_items_json) → uuid
  -- p_items_json = jsonb array of {ingredient_id, quantity}
  -- atomic: insert/update recipes row, DELETE all recipe_items for this recipe, INSERT new set
  -- transactional, validates each item exists + quantity > 0
delete_recipe(p_recipe_id)
  -- cascades to recipe_items via FK ON DELETE CASCADE
list_recipes() → SETOF (recipe_id, menu_item_id, menu_item_name, is_active, item_count, updated_at)
get_recipe_by_menu_item(p_menu_item_id) → jsonb
  -- returns full detail: {recipe_id, is_active, notes, items: [{ingredient_id, ingredient_name, unit, quantity}, ...]}
```

### 5.3 Stock

```
record_stock_movement(p_ingredient_id, p_quantity_delta, p_reason, p_notes) → uuid
  -- p_reason ∈ {'purchase_received', 'manual_adjustment_in', 'manual_adjustment_out', 'waste'}
  -- rejects 'sale_theoretical' (trigger-only) and 'count_correction' (record_stock_count RPC only)
  -- enforces sign consistency: _in/purchase_received must be +, _out/waste must be −
  -- emits audit_log entry

record_stock_count(p_ingredient_id, p_actual_quantity, p_notes) → uuid
  -- computes v_theoretical_before = stock_balance_now(p_ingredient_id)
  -- inserts ONE row reason='count_correction', quantity_delta = p_actual_quantity − v_theoretical_before
  -- returns inserted movement id (UI uses it to show "Đã ghi nhận kiểm kê, chênh lệch = X")
  -- emits audit_log

list_stock_movements(p_ingredient_id?, p_from?, p_to?, p_limit?, p_offset?)
  → SETOF (id, ingredient_id, ingredient_name, quantity_delta, reason, occurred_at,
           source_order_id, source_recipe_id, notes, created_by, created_at)

stock_balance_now(p_ingredient_id) → numeric
  -- single SUM aggregate

stock_balances_all() → SETOF (
    ingredient_id, name, unit, theoretical_balance, low_stock_threshold, is_low,
    last_movement_at
  )
  -- single query joining ingredients with grouped stock_movements sum; used by dashboard
```

All RPCs `SECURITY DEFINER` with role check `is_owner_or_manager()` or `is_staff_or_above()` per the matrix in §6 RLS.

---

## 6. RLS

| Table | SELECT | INSERT/UPDATE/DELETE |
|-------|--------|----------------------|
| `ingredients` | authenticated | owner + manager (via RPC) |
| `menu_items` | authenticated | owner + manager (via RPC) |
| `recipes` | authenticated | owner + manager (via RPC) |
| `recipe_items` | authenticated | owner + manager (cascade-only) |
| `stock_movements` | authenticated | RPC-only — direct writes blocked. `record_stock_movement` & `record_stock_count` gate by role staff_or_above (purchases/counts). `sale_theoretical` insertions happen via the AFTER INSERT trigger which runs SECURITY DEFINER. |

Audit log entries emitted for all RPC writes per Phase 1 pattern.

---

## 7. Auto-deduction trigger (the heart of the hybrid model)

```sql
CREATE OR REPLACE FUNCTION inventory._apply_sale_deductions_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = inventory, public
AS $$
DECLARE
  v_menu_item_id  uuid;
  v_recipe_id     uuid;
  v_item          record;
BEGIN
  -- 1. Match menu_item (case-insensitive, trimmed) — uses functional index
  SELECT id INTO v_menu_item_id
  FROM menu_items
  WHERE LOWER(TRIM(external_product_name)) = LOWER(TRIM(NEW.product_name))
    AND is_active = true
  LIMIT 1;

  IF v_menu_item_id IS NULL THEN RETURN NEW; END IF;

  -- 2. Active recipe?
  SELECT id INTO v_recipe_id
  FROM recipes
  WHERE menu_item_id = v_menu_item_id AND is_active = true
  LIMIT 1;

  IF v_recipe_id IS NULL THEN RETURN NEW; END IF;

  -- 3. Emit one stock_movement per recipe_item, scaled by NEW.quantity
  FOR v_item IN SELECT * FROM recipe_items WHERE recipe_id = v_recipe_id LOOP
    INSERT INTO stock_movements (
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
  -- defense-in-depth: never break ingest
  INSERT INTO public.audit_log (event_type, payload, created_at)
  VALUES ('inventory_deduction_error',
          jsonb_build_object(
            'order_item_id', NEW.id,
            'order_id', NEW.order_id,
            'product_name', NEW.product_name,
            'error', SQLERRM,
            'sqlstate', SQLSTATE
          ),
          now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_sale_deductions
AFTER INSERT ON public.sales_order_items
FOR EACH ROW
EXECUTE FUNCTION inventory._apply_sale_deductions_row();
```

**Backward compatibility:**
- Existing `ingest_kiotviet_batch` RPC is **not modified** at all.
- Trigger fires automatically on any row insert into `sales_order_items` (via ingest or otherwise).
- With zero `menu_items` rows (current production state), the first SELECT returns NULL on every fire → early return → zero side effects.
- The 50 existing pgTAP assertions remain valid. Phase 4.A adds new tests that populate menu_items+recipes and verify deduction; existing tests intentionally avoid populating these tables, so trigger no-ops.

---

## 8. Sub-phase manifest

### 8.1 Phase 4.A — Backend foundation

**Goal:** All inventory schema + RPCs + types + data layer + query hooks + pgTAP tests. Zero UI.

**New files:**
- `database/006_inventory_schema.sql` — namespace + 5 tables + indexes
- `database/007_inventory_functions.sql` — RPCs + auto-deduction trigger
- `database/008_inventory_rls.sql` — RLS policies
- `database/tests/090_ingredients_crud.sql` (~6 assertions)
- `database/tests/100_menu_items_crud.sql` (~5)
- `database/tests/110_recipes_upsert.sql` (~6)
- `database/tests/120_stock_movements.sql` (~5)
- `database/tests/130_stock_counts.sql` (~3)
- `database/tests/140_sale_deduction_trigger.sql` (~6)
- `database/tests/150_rls_inventory.sql` (~6)
- `src/lib/data/inventory.ts` — wrapper functions
- `src/lib/types.ts` — add `Ingredient`, `MenuItem`, `Recipe`, `RecipeItem`, `StockMovement`, `StockBalance`, `StockMovementReason` types (additive — Phase 1 already merged)
- `src/hooks/queries/use-inventory-queries.ts` — query hooks
- `src/hooks/queries/keys.ts` — add `queryKeys.inventory*` (additive)

**verify:phase gate after 4.A merges:** 75 Vitest + 87 pgTAP = **162 total**.

**Estimated tasks:** ~10–12.

### 8.2 Phase 4.B — Masters UI

**Goal:** Owner/manager CRUD for ingredients and menu_items. No recipes yet.

**New files:**
- `src/features/inventory/ingredients-view.tsx`
- `src/features/inventory/ingredient-form-modal.tsx`
- `src/features/inventory/menu-items-view.tsx`
- `src/features/inventory/menu-item-form-modal.tsx`
- `src/features/inventory/inventory-view.tsx` — top-level container with tabs (Ingredients | Menu Items | Recipes | Stock)
- `src/hooks/mutations/use-inventory-mutations.ts` — mutation hooks for masters
- `src/components/ui/icons.tsx` — add `package`, `flask` (or similar) icons
- `src/features/navigation/navigation.ts` — add `inventory` ViewKey + NAV_ITEMS entry + DEFAULT_SIDEBAR_BY_ROLE
- `src/app/page.tsx` — wire `view === "inventory"` → `<InventoryView />`

**Estimated tasks:** ~5–7.

### 8.3 Phase 4.C — Recipe builder UI

**Goal:** UI to build/edit recipes. Composite form: select menu_item → add ingredient rows with quantity → save atomically via upsert_recipe.

**New files:**
- `src/features/inventory/recipes-tab.tsx` — list of recipes + missing-recipe gap report
- `src/features/inventory/recipe-builder-modal.tsx` — menu_item select + dynamic ingredient row list + qty inputs
- `src/features/inventory/recipe-row.tsx` — per-ingredient row inside the modal

**Estimated tasks:** ~5–7.

### 8.4 Phase 4.D — Stock counting + ledger UI

**Goal:** Daily-ops UI. Staff can record stock counts; staff/owner can record manual movements; all roles can view the ledger.

**New files:**
- `src/features/inventory/stock-tab.tsx` — current theoretical balances grid + filter by ingredient
- `src/features/inventory/stock-count-modal.tsx` — pick ingredient, enter actual qty, system shows theoretical + computed variance + confirm
- `src/features/inventory/stock-movement-modal.tsx` — manual +/- entry with reason select (purchase_received / manual_adjustment_in / manual_adjustment_out / waste)
- `src/features/inventory/stock-ledger-section.tsx` — paged ledger list with filters (date range, reason, ingredient)

**Estimated tasks:** ~6–8.

### 8.5 Phase 4.E — Inventory dashboard + variance

**Goal:** At-a-glance health view. Low-stock alerts, biggest variance items, consumption trends.

**New files:**
- `src/features/inventory/dashboard-tab.tsx` — variance summary + low-stock badge list + top-consumption chart (simple aggregations, no Recharts required initially)
- `src/features/inventory/low-stock-widget.tsx` — embeddable widget for the main Dashboard view (cross-feature integration in Phase 5+, optional in 4.E)

**Estimated tasks:** ~3–5.

---

## 9. Vietnamese terminology (locked for all of Phase 4)

| English | Vietnamese |
|---------|------------|
| Inventory | Kho |
| Ingredient | Nguyên liệu |
| Menu item | Sản phẩm |
| Recipe | Công thức |
| Recipe item | Thành phần |
| Stock ledger | Nhập xuất tồn |
| Stock count | Kiểm kê |
| Stock movement | Phiếu nhập xuất |
| Theoretical balance | Tồn lý thuyết |
| Actual balance | Tồn thực tế |
| Variance | Chênh lệch |
| Low stock | Sắp hết |
| Purchase received | Nhập mua |
| Sale (theoretical) | Bán (lý thuyết) |
| Manual adjustment | Điều chỉnh tay |
| Count correction | Điều chỉnh kiểm kê |
| Waste / spoilage | Hao hụt |
| Active | Đang dùng |
| Inactive | Ngưng dùng |

UI labels in 4.B–4.E must use these terms verbatim. Toast messages and modal copy must match this glossary.

---

## 10. Risk register

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Trigger error breaks sales ingest** | Critical: sales sync fails for entire shop | `EXCEPTION WHEN OTHERS` block in trigger function logs error to `audit_log` and returns NEW. Sales row insert always succeeds even if deduction fails. Test in 4.A pgTAP. |
| **product_name fuzzy match misses** | High: silent zero-deduction for renamed KiotViet products | "Sản phẩm chưa khớp recipe" gap report in 4.C surfaces all `sales_order_items.product_name` values that didn't match any menu_item. Owner sees the gap and fixes the `external_product_name`. |
| **Negative theoretical balance** | Medium: visually confusing | Allowed (system says "Tồn lý thuyết: −5 ml" — owner sees ghost overdraft and investigates). No DB constraint blocking negatives. UI shows red badge. |
| **Count correction emits no row when actual == theoretical** | Low | Always emit, even with `quantity_delta = 0`, so the ledger preserves the count event. Required for audit trail. |
| **Concurrent counts on same ingredient** | Low | Last write wins. Each count is independent — they don't conflict like a balance update. |
| **Frozen Phase 1 backend touched** | Low | Trigger is added to a Phase 1 table (`sales_order_items`) but does NOT alter the table schema or the ingest RPC. All Phase 1 pgTAP tests remain unmodified and must still pass byte-for-byte. Verified by 4.A's `verify:phase` run. |
| **Schema namespace `inventory` collides with anything in Supabase** | Low | Standard namespace; default search_path includes `public` only. RPCs explicitly `SET search_path = inventory, public`. |
| **Large `list_stock_movements` queries get slow** | Low | Indexed on `(ingredient_id, occurred_at DESC)`. Paged with `LIMIT/OFFSET`. Phase 4.+ can add cursor pagination if needed. |

---

## 11. Phase 4 success criteria

After all 5 sub-phases merge:

1. **Backend:** All inventory RPCs + auto-deduction trigger working. `verify:phase` gate ≥ 75 Vitest + 87 pgTAP.
2. **Owner workflow:** Owner can create ingredients (`Nguyên liệu`) and menu items (`Sản phẩm`), build recipes linking them with quantities, see current theoretical balances.
3. **Staff workflow:** Staff can record manual stock movements (purchases, waste, adjustments) and stock counts.
4. **Automation:** When KiotViet ingests a new sale, the trigger emits `stock_movements` rows for every recipe ingredient × sold quantity (if menu_item + recipe match).
5. **Variance visible:** Dashboard shows current theoretical balance + variance from last count + low-stock alerts.
6. **Audit:** Every write RPC emits `audit_log` row. Trigger errors are logged.
7. **Defense:** RLS enforces owner/manager-only writes; staff_or_above can record counts and manual movements.

---

## 12. Process for each sub-phase

Each sub-phase 4.A–4.E follows the established cadence:

1. `superpowers:brainstorming` to refine sub-phase scope (one focused brainstorm per sub-phase)
2. Spec written + committed to `docs/superpowers/specs/<date>-v4-phase-4X-<topic>-design.md`
3. User reviews spec
4. `superpowers:writing-plans` to draft implementation plan (full code per task)
5. Plan written + committed to `docs/superpowers/plans/<date>-v4-phase-4X-<topic>.md`
6. User chooses execution mode (subagent-driven recommended)
7. `superpowers:subagent-driven-development` executes task-by-task with per-task spec + code quality reviews
8. Final overall opus review
9. `superpowers:finishing-a-development-branch` to merge + tag (`v4-phase-4a`, etc.)
10. Repeat for next sub-phase

After 4.E merges, place umbrella tag `v4-phase-4` on the final merge commit (mirrors the `v4-phase-3c` umbrella tag).

---

## 13. Open decisions for Phase 4.A brainstorming

These are deferred to the focused 4.A brainstorm (not part of this overall design):

- Schema namespace: keep `inventory` schema vs flatten into `public` (TBD)
- Exact RPC parameter order (matches existing conventions — TBD)
- Whether `stock_balances_all` returns ALL ingredients (including those with zero movements) or only ingredients that have ever moved (default: all active ingredients, even with zero balance)
- Whether the trigger should use `STATEMENT` or `ROW` level (current design says ROW — TBD if performance becomes a concern with batched ingest)
- Naming: `ingredient` vs `nguyen_lieu` (Vietnamese in identifiers) — default to English in DB, Vietnamese in UI

---

## 14. Self-review

**Placeholder scan:** No "TBD", "TODO", "implement later" in normative sections (§§1–11). Section 13 explicitly labels Open decisions for the next brainstorm — appropriate.

**Internal consistency:**
- Trigger fires on `sales_order_items` (per §7, §10), not `sales_orders`. Consistent.
- 5 tables across all sections (§3, §4, §6, §7). Consistent.
- 5 sub-phases (§3, §8). Consistent.
- pgTAP files numbered 090–150, total ~37 assertions (§5 in earlier conversation, §8.1 here). Consistent.

**Ambiguity check:**
- "Hybrid model" defined explicitly in §0 + §1 + §3. No ambiguity.
- "Auto-deduction" mechanism fully specified in §7 with full PL/pgSQL code. No ambiguity.
- Vietnamese terminology locked in §9. UI labels in later phases must match.

**Scope check:** Single focused module (inventory). 5 sub-phases is a manageable decomposition that mirrors 3C. Each sub-phase has clear boundaries and a single-page spec/plan cycle.

No issues found.

---

## 15. Next step

Spec approved → invoke `superpowers:brainstorming` for **Phase 4.A** (Backend foundation only) to lock SQL-level details before writing the 4.A spec. The overall Phase 4 strategy in this document is the parent contract; each sub-phase brainstorm refines one section of §8.
