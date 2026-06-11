# Đơn giá tham chiếu tồn kho (owner-only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner đặt đơn giá tham chiếu cho từng nguyên liệu; tab Tồn kho + dashboard hiện giá trị tồn và tổng giá trị kho — chỉ owner thấy/sửa (RLS tầng DB).

**Architecture:** Bảng mới `ingredient_reference_prices` (PK = ingredient_id, RLS `app_role() = 'owner'` cho cả 4 thao tác — pattern safe_transactions). Client: query owner-only → `Map<ingredient_id, price>`, helper thuần tính giá trị, upsert trực tiếp qua RLS. UI: thêm props tùy chọn vào `StockBalanceList`/`DashboardStockList` (không truyền = giữ nguyên như cũ cho manager/staff).

**Tech Stack:** Postgres RLS + pgTAP · Supabase client · TanStack Query · Vitest · Next/React (Tailwind tokens hiện có).

**Spec:** `docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md`

**Quy ước phải nhớ:**
- Coverage gate CI: code trong `src/lib/**` cần test (≥80% lines) → Task 3 có test mock cho data wrapper.
- pgTAP chạy trên DB sạch theo quy trình CI (throwaway `pgtap_clean`): stub roles + 001→003 + migrations, KHÔNG seed. BOM: file SQL mới lưu UTF-8 không BOM.
- Dual-write: canonical 001/003 và migration phải khớp nội dung.

---

### Task 1: pgTAP test cho bảng + RLS (viết trước — RED)

**Files:**
- Create: `database/tests/280_ingredient_reference_prices.sql`

- [ ] **Step 1: Viết test**

```sql
-- 280 — ingredient_reference_prices: owner-only RLS (đọc + ghi), cascade.
BEGIN;
SELECT plan(8);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid)
RETURNS void AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
END;
$$ LANGUAGE plpgsql;

-- Fixtures (chuẩn 070): 3 user owner/manager/staff
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('22222222-2222-2222-2222-222222222222', 'manager@test.local', '', now(), '00000000-0000-0000-0000-000000000000'),
  ('33333333-3333-3333-3333-333333333333', 'staff@test.local', '', now(), '00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Owner'),
  ('22222222-2222-2222-2222-222222222222', 'Manager'),
  ('33333333-3333-3333-3333-333333333333', 'Staff');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner', 'active'),
  ('22222222-2222-2222-2222-222222222222', 'manager', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'staff_operator', 'active');

INSERT INTO public.ingredients (id, name, unit, last_unit_price)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Cà phê test', 'kg', 185000);

-- 1. Bảng tồn tại
SELECT has_table('public', 'ingredient_reference_prices', 'bảng ingredient_reference_prices tồn tại');

-- 2. Owner INSERT được
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 200000);
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  1, 'owner INSERT + SELECT thấy 1 row'
);

-- 3. Owner UPDATE được
UPDATE public.ingredient_reference_prices SET unit_price = 210000
WHERE ingredient_id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT unit_price::int FROM public.ingredient_reference_prices
   WHERE ingredient_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  210000, 'owner UPDATE được giá'
);

-- 4. Manager SELECT → 0 rows
RESET ROLE;
SELECT pg_temp.act_as('22222222-2222-2222-2222-222222222222');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  0, 'manager SELECT trả 0 rows (RLS chặn đọc)'
);

-- 5. Manager INSERT → policy violation
SELECT throws_ok(
  $$ INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price)
     VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 1) $$,
  '42501', NULL, 'manager INSERT bị chặn'
);

-- 6. Staff SELECT → 0 rows
RESET ROLE;
SELECT pg_temp.act_as('33333333-3333-3333-3333-333333333333');
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  0, 'staff SELECT trả 0 rows'
);

-- 7. check unit_price >= 0
RESET ROLE;
SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$ UPDATE public.ingredient_reference_prices SET unit_price = -1 $$,
  '23514', NULL, 'unit_price âm bị check constraint chặn'
);

-- 8. Cascade: xóa ingredient → row giá biến mất
RESET ROLE;
DELETE FROM public.ingredients WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  0, 'xóa ingredient cascade xóa giá'
);

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Chạy trên DB sạch để thấy RED**

Dựng `pgtap_clean` theo quy trình memory (stub roles + 001/002/003 + migrations, BOM-strip bằng `perl -pe 's/\xEF\xBB\xBF//g'`), rồi:

```bash
docker exec -i supabase-db bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d pgtap_clean -AtX -f -' < database/tests/280_ingredient_reference_prices.sql
```

Expected: FAIL ngay test 1 (`has_table` → bảng chưa tồn tại). Lưu ý file crash-kiểu-ERROR cũng tính là RED.

- [ ] **Step 3: Commit test (đánh dấu RED trong message)**

```bash
git add database/tests/280_ingredient_reference_prices.sql
git commit -m "test(db): pgTAP ingredient_reference_prices owner-only RLS (RED)"
```

### Task 2: Migration + canonical (GREEN)

**Files:**
- Create: `database/migrations/2026-06-12-ingredient-reference-prices.sql`
- Modify: `database/001_schema.sql` (sau block ingredients) — thêm bảng
- Modify: `database/003_rls.sql` (cạnh block safe_* owner-only) — RLS + grants

- [ ] **Step 1: Viết migration**

```sql
-- =============================================================================
-- Migration: ingredient_reference_prices — đơn giá tham chiếu tồn kho,
-- owner đặt tay, CHỈ owner đọc/ghi (RLS như safe_transactions).
-- Spec: docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md
-- =============================================================================

create table if not exists public.ingredient_reference_prices (
  ingredient_id uuid primary key
    references public.ingredients(id) on delete cascade,
  unit_price bigint not null check (unit_price >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ingredient_reference_prices enable row level security;

drop policy if exists ingredient_ref_prices_owner_all on public.ingredient_reference_prices;
create policy ingredient_ref_prices_owner_all on public.ingredient_reference_prices
  for all to authenticated
  using (public.app_role() = 'owner')
  with check (public.app_role() = 'owner');

grant select, insert, update, delete
  on public.ingredient_reference_prices to authenticated;
grant all on public.ingredient_reference_prices to service_role;
```

- [ ] **Step 2: Dual-write canonical**

- `001_schema.sql`: chèn `create table if not exists public.ingredient_reference_prices (...)` (đúng nguyên văn block create table ở trên) ngay SAU block `create table ... ingredients`.
- `003_rls.sql`: chèn block `alter table ... enable row level security; drop policy...; create policy...; grant ...` (nguyên văn) vào khu safe_*/owner-only.

- [ ] **Step 3: Dựng lại pgtap_clean từ đầu (001→003 + toàn bộ migrations) rồi chạy lại test 280**

Expected: `1..8` + 8 ok. Chạy thêm TOÀN BỘ suite tests trên pgtap_clean (loop crash-aware) — không file nào fail/crash.

- [ ] **Step 4: Apply migration vào DB dev (`-d postgres`) để UI test sau này có bảng**

```bash
docker exec -i supabase-db bash -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -' < database/migrations/2026-06-12-ingredient-reference-prices.sql
```

Expected: CREATE TABLE / ALTER / CREATE POLICY / GRANT, exit 0. Chạy lần 2 → idempotent (if not exists / drop policy if exists).

- [ ] **Step 5: Commit**

```bash
git add database/migrations/2026-06-12-ingredient-reference-prices.sql database/001_schema.sql database/003_rls.sql
git commit -m "feat(db): bang ingredient_reference_prices owner-only (GREEN 8/8)"
```

### Task 3: Types + data layer (kèm test vì coverage gate src/lib)

**Files:**
- Modify: `src/lib/types.ts` (sau interface Ingredient)
- Create: `src/lib/data/ingredient-prices.ts`
- Modify: `src/lib/data/index.ts` (re-export — xem file để biết format barrel)
- Create: `src/lib/data/__tests__/ingredient-prices.test.ts`

- [ ] **Step 1: Thêm type**

```ts
export interface IngredientReferencePrice {
  ingredient_id: string;
  /** VND/đơn vị của ingredient — owner đặt tay (spec 2026-06-12). */
  unit_price: number;
  updated_at: string;
}
```

- [ ] **Step 2: Viết test mock (RED)** — `ingredient-prices.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadIngredientReferencePrices,
  upsertIngredientReferencePrice,
  deleteIngredientReferencePrice,
} from "../ingredient-prices";

function mockSupabase(result: { data?: unknown; error?: { message: string } | null }) {
  const terminal = Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "upsert", "delete", "eq", "order"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.then = terminal.then.bind(terminal);
  chain.catch = terminal.catch.bind(terminal);
  return chain as unknown as SupabaseClient;
}

describe("ingredient-prices data layer", () => {
  it("load trả Map ingredient_id → row", async () => {
    const sb = mockSupabase({
      data: [{ ingredient_id: "i1", unit_price: 200000, updated_at: "2026-06-12T00:00:00Z" }],
    });
    const map = await loadIngredientReferencePrices(sb);
    expect(map.get("i1")?.unit_price).toBe(200000);
    expect(map.size).toBe(1);
  });

  it("load lỗi → throw AppError message tiếng Việt", async () => {
    const sb = mockSupabase({ error: { message: "boom" } });
    await expect(loadIngredientReferencePrices(sb)).rejects.toThrow();
  });

  it("upsert gọi from().upsert() và resolve khi không lỗi", async () => {
    const sb = mockSupabase({ data: null });
    await expect(upsertIngredientReferencePrice(sb, "i1", 150000)).resolves.toBeUndefined();
  });

  it("upsert lỗi → throw", async () => {
    const sb = mockSupabase({ error: { message: "denied" } });
    await expect(upsertIngredientReferencePrice(sb, "i1", 150000)).rejects.toThrow();
  });

  it("delete lỗi → throw", async () => {
    const sb = mockSupabase({ error: { message: "denied" } });
    await expect(deleteIngredientReferencePrice(sb, "i1")).rejects.toThrow();
  });
});
```

Run: `npx vitest run src/lib/data/__tests__/ingredient-prices.test.ts` → FAIL (module chưa tồn tại).

- [ ] **Step 3: Implement** — `src/lib/data/ingredient-prices.ts` (theo style `profiles.ts`: dùng `toAppError` từ `./_common`)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "./_common";
import type { IngredientReferencePrice } from "@/lib/types";

/** Owner-only (RLS) — non-owner nhận 0 rows, không lỗi. */
export async function loadIngredientReferencePrices(
  supabase: SupabaseClient
): Promise<Map<string, IngredientReferencePrice>> {
  const { data, error } = await supabase
    .from("ingredient_reference_prices")
    .select("ingredient_id, unit_price, updated_at");
  if (error) throw toAppError(error, "Không tải được đơn giá tồn kho.");
  const rows = (data ?? []) as IngredientReferencePrice[];
  return new Map(rows.map((r) => [r.ingredient_id, r]));
}

export async function upsertIngredientReferencePrice(
  supabase: SupabaseClient,
  ingredientId: string,
  unitPrice: number
): Promise<void> {
  const { error } = await supabase
    .from("ingredient_reference_prices")
    .upsert({ ingredient_id: ingredientId, unit_price: unitPrice, updated_at: new Date().toISOString() });
  if (error) throw toAppError(error, "Không lưu được đơn giá.");
}

export async function deleteIngredientReferencePrice(
  supabase: SupabaseClient,
  ingredientId: string
): Promise<void> {
  const { error } = await supabase
    .from("ingredient_reference_prices")
    .delete()
    .eq("ingredient_id", ingredientId);
  if (error) throw toAppError(error, "Không xóa được đơn giá.");
}
```

Thêm re-export vào `src/lib/data/index.ts` theo format barrel hiện có.

- [ ] **Step 4: Run test → PASS**, rồi commit

```bash
git add src/lib/types.ts src/lib/data/ingredient-prices.ts src/lib/data/index.ts src/lib/data/__tests__/ingredient-prices.test.ts
git commit -m "feat(data): ingredient reference prices wrappers + mock tests"
```

### Task 4: Helper tính giá trị tồn (TDD)

**Files:**
- Create: `src/features/inventory/stock-value.ts`
- Create: `src/features/inventory/__tests__/stock-value.test.ts`

- [ ] **Step 1: Test (RED)**

```ts
import { describe, it, expect } from "vitest";
import { rowValue, stockTotals } from "../stock-value";
import type { StockBalance, IngredientReferencePrice } from "@/lib/types";

const bal = (id: string, qty: number): StockBalance => ({
  ingredient_id: id, name: id, unit: "kg",
  theoretical_balance: qty, low_stock_threshold: null, is_low: false, last_movement_at: null,
});
const price = (id: string, p: number): [string, IngredientReferencePrice] =>
  [id, { ingredient_id: id, unit_price: p, updated_at: "" }];

describe("rowValue", () => {
  it("làm tròn VND nguyên: 3.2 kg × 185000 = 592000", () => {
    expect(rowValue(3.2, 185000)).toBe(592000);
  });
  it("tồn âm → giá trị âm", () => {
    expect(rowValue(-2, 50000)).toBe(-100000);
  });
  it("giá null/undefined → null", () => {
    expect(rowValue(5, null)).toBeNull();
    expect(rowValue(5, undefined)).toBeNull();
  });
  it("làm tròn nửa lên: 0.5 đơn vị × 33333 = 16667", () => {
    expect(rowValue(0.5, 33333)).toBe(16667);
  });
});

describe("stockTotals", () => {
  it("tổng = Σ rowValue dòng có giá (kể cả âm); missingCount = dòng thiếu giá", () => {
    const balances = [bal("a", 3.2), bal("b", -2), bal("c", 10)];
    const prices = new Map([price("a", 185000), price("b", 50000)]);
    expect(stockTotals(balances, prices)).toEqual({ total: 492000, missingCount: 1 });
  });
  it("không giá nào → total 0, missing = tất cả", () => {
    expect(stockTotals([bal("a", 1)], new Map())).toEqual({ total: 0, missingCount: 1 });
  });
  it("rỗng → 0/0", () => {
    expect(stockTotals([], new Map())).toEqual({ total: 0, missingCount: 0 });
  });
});
```

Run: `npx vitest run src/features/inventory/__tests__/stock-value.test.ts` → FAIL.

- [ ] **Step 2: Implement (GREEN)**

```ts
import type { StockBalance, IngredientReferencePrice } from "@/lib/types";

/** Giá trị tồn 1 dòng = round(tồn × giá) về VND nguyên; null nếu chưa có giá. */
export function rowValue(balance: number, unitPrice: number | null | undefined): number | null {
  if (unitPrice == null) return null;
  return Math.round(balance * unitPrice);
}

/** Tổng giá trị kho (chỉ dòng CÓ giá, gồm cả giá trị âm) + số NL chưa đặt giá. */
export function stockTotals(
  balances: ReadonlyArray<StockBalance>,
  prices: ReadonlyMap<string, IngredientReferencePrice>
): { total: number; missingCount: number } {
  let total = 0;
  let missingCount = 0;
  for (const b of balances) {
    const v = rowValue(b.theoretical_balance, prices.get(b.ingredient_id)?.unit_price);
    if (v == null) missingCount += 1;
    else total += v;
  }
  return { total, missingCount };
}
```

- [ ] **Step 3: Run → PASS; commit**

```bash
git add src/features/inventory/stock-value.ts src/features/inventory/__tests__/stock-value.test.ts
git commit -m "feat(inventory): stock-value helpers (TDD)"
```

### Task 5: Query key + query hook + mutation hook

**Files:**
- Modify: `src/hooks/queries/keys.ts` (khu Inventory)
- Modify: `src/hooks/queries/use-inventory-queries.ts` (cuối file)
- Create: `src/hooks/mutations/use-ingredient-price-mutations.ts`

- [ ] **Step 1: Key**

```ts
  ingredientPrices: () => ["inventory", "ingredient_prices"] as const,
```

- [ ] **Step 2: Query hook** (style `useStockBalancesQuery`; enabled chỉ khi owner)

```ts
export function useIngredientPricesQuery(
  supabase: SupabaseClient | null,
  enabled = true
) {
  return useQuery({
    queryKey: queryKeys.ingredientPrices(),
    queryFn: () => loadIngredientReferencePrices(supabase!),
    enabled: !!supabase && enabled,
    staleTime: 60_000,
  });
}
```

(import `loadIngredientReferencePrices` từ `@/lib/data`.)

- [ ] **Step 3: Mutation hook** (style `use-profile-mutations.ts`)

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  upsertIngredientReferencePrice,
  deleteIngredientReferencePrice,
} from "@/lib/data";
import { queryKeys } from "@/hooks/queries/keys";

/** Upsert đơn giá tham chiếu; unitPrice = null nghĩa là XÓA giá. */
export function useSetIngredientPrice(supabase: SupabaseClient | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ingredientId: string; unitPrice: number | null }) => {
      if (!supabase) throw new Error("Thiếu cấu hình Supabase.");
      if (input.unitPrice == null) {
        await deleteIngredientReferencePrice(supabase, input.ingredientId);
      } else {
        await upsertIngredientReferencePrice(supabase, input.ingredientId, input.unitPrice);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredientPrices() });
    },
  });
}
```

- [ ] **Step 4: `npx tsc --noEmit` sạch; commit**

```bash
git add src/hooks/queries/keys.ts src/hooks/queries/use-inventory-queries.ts src/hooks/mutations/use-ingredient-price-mutations.ts
git commit -m "feat(hooks): ingredient price query + mutation"
```

### Task 6: Modal sửa giá nhanh

**Files:**
- Create: `src/features/inventory/ingredient-price-modal.tsx`

- [ ] **Step 1: Component** (Modal hiện có; input numeric ≥16px chấm nghìn — theo MoneyField của preview nhưng inline tại đây, không import từ (preview))

```tsx
"use client";

import { useEffect, useState } from "react";
import { Modal, ModalContent, ModalTitle, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { formatNumber, formatVND } from "@/lib/format";

interface IngredientPriceModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  ingredientName: string;
  /** Giá tham chiếu hiện tại (null = chưa đặt). */
  currentPrice: number | null;
  /** Giá nhập gần nhất (gợi ý). */
  lastUnitPrice: number;
  saving: boolean;
  onSave(price: number): void;
  onClear(): void;
}

/**
 * Modal "Đơn giá — {tên NL}" (owner-only, mở từ dòng Tồn kho).
 * Nâng thành bottom sheet khi làm phase Modal→Sheet của spec mobile.
 */
export function IngredientPriceModal({
  open,
  onOpenChange,
  ingredientName,
  currentPrice,
  lastUnitPrice,
  saving,
  onSave,
  onClear,
}: IngredientPriceModalProps) {
  const [value, setValue] = useState<number>(currentPrice ?? 0);

  useEffect(() => {
    if (open) setValue(currentPrice ?? 0);
  }, [open, currentPrice]);

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent className="w-[min(95vw,24rem)]">
        <ModalTitle>Đơn giá — {ingredientName}</ModalTitle>
        <div className="mt-4 space-y-3">
          <div className="relative">
            <input
              inputMode="numeric"
              autoFocus
              value={value === 0 ? "" : formatNumber(value)}
              placeholder="0"
              onChange={(e) => {
                const digits = e.target.value.replace(/[^0-9]/g, "");
                setValue(digits ? Number(digits) : 0);
              }}
              aria-label="Đơn giá tham chiếu (VND)"
              className="w-full h-14 pl-4 pr-10 rounded-md bg-surface border border-border font-display text-2xl font-bold text-ink tabular-nums placeholder:text-muted/50 focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">₫</span>
          </div>
          {lastUnitPrice > 0 && (
            <button
              type="button"
              onClick={() => setValue(lastUnitPrice)}
              className="text-sm text-ink underline-offset-4 hover:underline"
            >
              Giá nhập gần nhất: {formatVND(lastUnitPrice)} — Dùng giá này
            </button>
          )}
        </div>
        <ModalActions>
          {currentPrice != null && (
            <Button variant="ghost" onClick={onClear} disabled={saving}>
              Xóa giá
            </Button>
          )}
          <Button onClick={() => onSave(value)} loading={saving} disabled={value === 0}>
            Lưu
          </Button>
        </ModalActions>
      </ModalContent>
    </Modal>
  );
}
```

- [ ] **Step 2: `npx tsc --noEmit`; commit**

```bash
git add src/features/inventory/ingredient-price-modal.tsx
git commit -m "feat(inventory): modal sua nhanh don gia tham chieu"
```

### Task 7: StockBalanceList + StockTab (owner thấy giá + tổng + nút sửa)

**Files:**
- Modify: `src/features/inventory/stock-balance-list.tsx`
- Modify: `src/features/inventory/stock-tab.tsx`

- [ ] **Step 1: StockBalanceList — props tùy chọn (không truyền = UI cũ y nguyên)**

Thêm vào interface:

```ts
  /** Owner-only: map giá tham chiếu — có mặt thì hiện dòng giá trị + nút sửa. */
  prices?: ReadonlyMap<string, IngredientReferencePrice>;
  onEditPrice?(ingredientId: string): void;
```

(import `IngredientReferencePrice` từ `@/lib/types`, `rowValue` từ `./stock-value`, `formatVND` từ `@/lib/format`, `IconButton` từ `@/components/ui/icon-button`.)

Trong map row, sau khối `<p>` tên + last_movement (trong div min-w-0), thêm:

```tsx
{prices && (
  <p className="text-xs mt-0.5 tabular-nums">
    {(() => {
      const p = prices.get(b.ingredient_id)?.unit_price;
      const v = rowValue(b.theoretical_balance, p);
      if (v == null) return <span className="text-muted/60">Chưa có giá</span>;
      return (
        <span className={v < 0 ? "text-danger" : "text-ink-2"}>
          {formatVND(p!)} × {b.theoretical_balance} = <strong>{formatVND(v)}</strong>
        </span>
      );
    })()}
  </p>
)}
```

Trong cụm phải (`flex items-center gap-2 flex-wrap justify-end`), thêm TRƯỚC badge:

```tsx
{onEditPrice && (
  <IconButton
    icon="pencil"
    size={40}
    variant="ghost"
    aria-label={`Sửa đơn giá ${b.name}`}
    onClick={(e) => {
      e.stopPropagation();
      onEditPrice(b.ingredient_id);
    }}
  />
)}
```

(`stopPropagation` vì row có thể clickable mở StockEntryModal.)

- [ ] **Step 2: StockTab — wire owner**

Thêm vào StockTab (đã có `role`, `supabase`, `ingredients`):

```tsx
const isOwner = role === "owner";
const pricesQuery = useIngredientPricesQuery(supabase, isOwner);
const prices = pricesQuery.data;
const setPrice = useSetIngredientPrice(supabase);
const { toast } = useToast();
const [priceModalId, setPriceModalId] = useState<string | null>(null);

const totals = useMemo(
  () => (isOwner && prices ? stockTotals(filteredSortedBalances, prices) : null),
  [isOwner, prices, filteredSortedBalances]
);
const priceIngredient = ingredients.find((i) => i.id === priceModalId) ?? null;
```

Header section "Tồn hiện tại": ngay dưới heading (xem JSX hiện có trong file), khi `totals` ≠ null thêm:

```tsx
<p className="text-sm text-ink-2 tabular-nums">
  Giá trị kho: <strong className="font-display text-ink">{formatVND(totals.total)}</strong>
  {totals.missingCount > 0 && (
    <span className="text-xs text-muted"> ({totals.missingCount} NL chưa có giá)</span>
  )}
</p>
```

Truyền props vào `<StockBalanceList ... prices={isOwner ? prices : undefined} onEditPrice={isOwner ? setPriceModalId : undefined} />`.

Render modal cuối JSX:

```tsx
{priceIngredient && (
  <IngredientPriceModal
    open={priceModalId !== null}
    onOpenChange={(o) => !o && setPriceModalId(null)}
    ingredientName={priceIngredient.name}
    currentPrice={prices?.get(priceIngredient.id)?.unit_price ?? null}
    lastUnitPrice={priceIngredient.last_unit_price}
    saving={setPrice.isPending}
    onSave={async (p) => {
      try {
        await setPrice.mutateAsync({ ingredientId: priceIngredient.id, unitPrice: p });
        setPriceModalId(null);
        toast({ semantic: "success", message: "Đã lưu đơn giá." });
      } catch (err) {
        toast({ semantic: "danger", message: err instanceof Error ? err.message : "Không lưu được đơn giá." });
      }
    }}
    onClear={async () => {
      try {
        await setPrice.mutateAsync({ ingredientId: priceIngredient.id, unitPrice: null });
        setPriceModalId(null);
        toast({ semantic: "success", message: "Đã xóa đơn giá." });
      } catch (err) {
        toast({ semantic: "danger", message: err instanceof Error ? err.message : "Không xóa được đơn giá." });
      }
    }}
  />
)}
```

- [ ] **Step 3: `npx tsc --noEmit`; verify nhanh dev (owner thấy giá + sửa được; xem bằng tài khoản owner@chill.local); commit**

```bash
git add src/features/inventory/stock-balance-list.tsx src/features/inventory/stock-tab.tsx
git commit -m "feat(inventory): tab Ton kho hien gia tri ton + tong kho + sua nhanh (owner)"
```

### Task 8: Dashboard (owner)

**Files:**
- Modify: `src/features/dashboard/dashboard-view.tsx`
- Modify: `src/features/dashboard/dashboard-stock-list.tsx`

- [ ] **Step 1: dashboard-view** — thêm query (role từ `account.role`):

```tsx
const isOwner = account.role === "owner";
const pricesQuery = useIngredientPricesQuery(supabase, isOwner);
```

Truyền `prices={isOwner ? pricesQuery.data : undefined}` vào `<DashboardStockList ...>`; trong CardHeader của card "Tồn kho hiện tại", khi owner và có data:

```tsx
{isOwner && pricesQuery.data && (
  <span className="text-sm text-ink-2 tabular-nums">
    Giá trị: <strong className="font-display text-ink">
      {formatVND(stockTotals(stockQuery.data ?? [], pricesQuery.data).total)}
    </strong>
  </span>
)}
```

(import `stockTotals` từ `@/features/inventory/stock-value`, `formatVND` từ `@/lib/format`; tên biến query tồn kho xem trong file — survey gọi là stock balances query của dashboard.)

- [ ] **Step 2: dashboard-stock-list** — prop tùy chọn:

```ts
  prices?: ReadonlyMap<string, IngredientReferencePrice>;
```

Khi `prices` có mặt: thêm header `<th>` "Giá trị" (align right, sau "Tồn hiện tại") và cell tương ứng mỗi row:

```tsx
{prices && (
  <td className="py-2 px-3 text-right tabular-nums">
    {(() => {
      const v = rowValue(b.theoretical_balance, prices.get(b.ingredient_id)?.unit_price);
      return v == null
        ? <span className="text-muted/60">—</span>
        : <span className={v < 0 ? "text-danger" : "text-ink"}>{formatVND(v)}</span>;
    })()}
  </td>
)}
```

(Cột "Giá trị" KHÔNG sortable — giữ logic sort hiện có nguyên vẹn. Khớp số cột header/body kể cả cột lock icon nếu có.)

- [ ] **Step 3: `npx tsc --noEmit`; commit**

```bash
git add src/features/dashboard/dashboard-view.tsx src/features/dashboard/dashboard-stock-list.tsx
git commit -m "feat(dashboard): gia tri ton kho cho owner"
```

### Task 9: Verify tổng + PR

- [ ] **Step 1:** `npx tsc --noEmit` → 0 lỗi; `npx vitest run` → toàn bộ pass (221 cũ + ~16 mới).
- [ ] **Step 2:** pgTAP: chạy lại FULL suite trên pgtap_clean dựng từ đầu (catch double-apply + thứ tự file) → 0 fail/0 crash.
- [ ] **Step 3:** UI smoke (dev 3009, 375px + desktop):
  - owner: tab Tồn kho thấy tổng + giá trị dòng + sửa giá (lưu → toast → tổng đổi), dashboard thấy cột Giá trị; KHÔNG tràn ngang 375px.
  - Đổi role giả lập: đăng nhập manager/staff (nếu có account test) hoặc kiểm bằng pgTAP đã chặn + ẩn UI theo role (gate `isOwner` đã che).
- [ ] **Step 4:** PR lên main, CI 4/4, chờ user duyệt merge + tag.
