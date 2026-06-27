# Đồng bộ giá nguyên liệu khi nhập từ sổ quỹ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Khi owner nhập nguyên liệu từ sổ quỹ, tự đồng bộ `ingredient_reference_prices.unit_price` (giá định giá thật, drive "Giá trị kho") theo đơn giá nhập — per-line, mặc định BẬT, tắt được — cộng UX hiện giá cũ + cảnh báo lệch + affordance "sửa giá" rõ ràng + backfill 1 lần.

**Architecture:** Một cờ per-line `sync_price` (default true) đi từ modal → data layer → RPC `safe_purchase_inventory`. RPC (security-definer, owner-only) upsert `ingredient_reference_prices` atomic cùng giao dịch nhập, vẫn giữ nguyên `last_unit_price` + `stock_movements` + `safe_transactions`. Logic thuần (deviation, build line, default flag) tách ra helper module để test bằng Vitest `.test.ts` (dự án chưa có hạ tầng test component). Backfill là một migration idempotent (`INSERT … ON CONFLICT DO NOTHING`).

**Tech Stack:** Postgres/plpgsql (pgTAP), Next.js 15 / React 19 / TypeScript, TanStack Query, Radix Checkbox, Vitest (env `node`).

---

## Bối cảnh đã xác minh (đọc trước khi code)

- **Hai trường giá** (giữ riêng, KHÔNG gộp — out of scope):
  - `ingredients.last_unit_price numeric(14,2)` — gợi ý auto-fill, RPC luôn ghi đè (`database/002_functions.sql:2365`, mirror ở `database/migrations/2026-06-10-purchase-inventory-from-safe.sql:168`).
  - `ingredient_reference_prices.unit_price bigint` (PK = `ingredient_id`, check `>= 0`, `database/001_schema.sql:830-835`), **owner-only RLS** (`database/003_rls.sql:271-281`). Consumer DUY NHẤT: `src/features/inventory/stock-value.ts` → "Giá trị kho".
- **Quyền (đã chốt — concern owner-only của spec là moot):** Modal nhập chỉ render cho owner (`src/features/safe/safe-view.tsx:71` trả EmptyState nếu `role !== "owner"`, NAV cũng gate `safe` = owner). RPC cũng gate owner-only (`database/002_functions.sql:2272`: `if public.app_role() <> 'owner' then raise`). ⇒ Non-owner KHÔNG bao giờ tới path này; đọc `ingredient_reference_prices` trong modal là an toàn (owner đọc được). RPC là security-definer (owner = postgres, BYPASSRLS) nên upsert vào bảng owner-only chạy được.
- **Dual-write:** CI (`scripts/ci/apply-schema.mjs`) apply `001 → 002 → 003 → migrations/*` (alphabet = chronological). Function mới phải nằm ở CẢ `database/002_functions.sql` (canonical) LẪN một migration ngày `2026-06-27-*` (migration apply sau cùng, thắng). Body hai nơi PHẢI giống hệt.
- **⚠️ "verify:mirror" trong spec là nhầm:** `npm run verify:mirror` (`tools/verify-mirror.mjs`) là checker dashboard-vs-raw, cần app chạy + service key + DB mirror v3 — KHÔNG phải verifier dual-write. Cổng thật cho việc này là `npm run verify:phase` (= `test:run` + `pgtap`). Dual-write 002↔migration kiểm bằng mắt/diff. Plan này KHÔNG dùng verify:mirror.
- **Hạ tầng test:** `vitest.config.mts` → `environment: "node"`, `include: ["src/**/__tests__/**/*.test.ts"]` (CHỈ `.test.ts`, không `.tsx`); KHÔNG có `@testing-library/react`/jsdom. Pattern hiện hữu: helper thuần + `.test.ts` co-located (`purchase-math.ts`+`purchase-math.test.ts`, `fund-split.ts`+`fund-split.test.ts`, `stock-value.ts`+`stock-value.test.ts`). Plan này theo pattern đó, KHÔNG thêm testing-library.
- **pgTAP DB build:** không seed `ingredients` ở CI; backfill migration chạy lúc apply-schema = no-op (bảng rỗng). Test idempotent tự seed rồi chạy lại câu backfill.

---

## File Structure

| File | Trách nhiệm | Hành động |
|---|---|---|
| `src/features/safe/purchase-price-sync.ts` | Logic thuần: `DEFAULT_SYNC_PRICE`, `PRICE_DEVIATION_THRESHOLD`, `priceDeviation()`, `buildPurchaseLine()` | Create |
| `src/features/safe/__tests__/purchase-price-sync.test.ts` | Vitest cho helper trên | Create |
| `src/lib/data/safe.ts` | Thêm `sync_price` vào type `lines` của `safePurchaseInventory` | Modify |
| `src/hooks/mutations/use-safe-mutations.ts` | Thêm `sync_price` vào `SafePurchaseInventoryInput.lines` | Modify |
| `src/features/safe/purchase-inventory-modal.tsx` | Load giá cũ; per-row checkbox "Cập nhật giá định giá" (default BẬT) + giá cũ + cảnh báo lệch; truyền `sync_price` | Modify |
| `src/features/inventory/stock-balance-list.tsx` | Đổi pencil icon-only → nút có nhãn "Sửa giá"/"Đặt giá" (owner-only) | Modify |
| `database/002_functions.sql` | Cập nhật body `safe_purchase_inventory` (+`sync_price` upsert) — canonical | Modify |
| `database/migrations/2026-06-27-ingredient-price-sync-on-purchase.sql` | `create or replace` RPC (body giống 002) + backfill idempotent | Create |
| `database/tests/089_purchase_inventory_price_sync.sql` | pgTAP: sync true/false/omitted, round, vẫn ghi last_price+movements+safe_tx | Create |
| `database/tests/281_backfill_reference_prices.sql` | pgTAP: backfill idempotent (seed→set, có giá→không đè, chạy 2 lần ổn định) | Create |

---

## Task 1: Helper thuần `purchase-price-sync.ts` (TDD)

**Files:**
- Create: `src/features/safe/purchase-price-sync.ts`
- Test: `src/features/safe/__tests__/purchase-price-sync.test.ts`

- [ ] **Step 1: Viết test fail**

`src/features/safe/__tests__/purchase-price-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SYNC_PRICE,
  PRICE_DEVIATION_THRESHOLD,
  priceDeviation,
  buildPurchaseLine,
} from "../purchase-price-sync";

describe("DEFAULT_SYNC_PRICE", () => {
  it("mặc định BẬT đồng bộ giá", () => {
    expect(DEFAULT_SYNC_PRICE).toBe(true);
  });
});

describe("priceDeviation", () => {
  it("không có giá cũ (null) → ratio null, không cảnh báo", () => {
    expect(priceDeviation(null, 100000)).toEqual({ ratio: null, isLarge: false });
    expect(priceDeviation(undefined, 100000)).toEqual({ ratio: null, isLarge: false });
    expect(priceDeviation(0, 100000)).toEqual({ ratio: null, isLarge: false });
  });

  it("lệch trong ngưỡng (±<20%) → không cảnh báo", () => {
    expect(priceDeviation(100000, 110000).isLarge).toBe(false); // +10%
    expect(priceDeviation(100000, 90000).isLarge).toBe(false);  // -10%
    expect(priceDeviation(100000, 100000).ratio).toBe(0);
  });

  it("lệch >= ngưỡng (tăng) → cảnh báo", () => {
    expect(priceDeviation(100000, 120000).isLarge).toBe(true); // +20% biên
    expect(priceDeviation(100000, 150000).isLarge).toBe(true); // +50%
  });

  it("lệch >= ngưỡng (giảm) → cảnh báo", () => {
    expect(priceDeviation(100000, 80000).isLarge).toBe(true); // -20% biên
    expect(priceDeviation(100000, 0).isLarge).toBe(true);     // -100%
  });

  it("ngưỡng = 0.2", () => {
    expect(PRICE_DEVIATION_THRESHOLD).toBe(0.2);
  });
});

describe("buildPurchaseLine", () => {
  it("map đủ field + cờ sync_price=true", () => {
    expect(
      buildPurchaseLine({ ingredientId: "i1", quantity: 2, unitPrice: 100000, syncPrice: true })
    ).toEqual({ ingredient_id: "i1", quantity: 2, unit_price: 100000, sync_price: true });
  });

  it("giữ nguyên sync_price=false khi tắt", () => {
    expect(
      buildPurchaseLine({ ingredientId: "i2", quantity: 1, unitPrice: 5000, syncPrice: false }).sync_price
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test xác nhận fail**

Run: `npm run test:run -- purchase-price-sync`
Expected: FAIL — `Failed to resolve import "../purchase-price-sync"`.

- [ ] **Step 3: Viết implementation tối thiểu**

`src/features/safe/purchase-price-sync.ts`:

```ts
/**
 * Logic thuần cho "đồng bộ giá định giá khi nhập NL từ sổ quỹ" (spec
 * 2026-06-24-ingredient-price-sync-on-purchase). Tách khỏi
 * purchase-inventory-modal.tsx để test bằng Vitest `.test.ts` (env node) —
 * dự án CHƯA có hạ tầng test component (jsdom/testing-library).
 */

/** Mặc định BẬT đồng bộ giá định giá cho mỗi dòng nhập. */
export const DEFAULT_SYNC_PRICE = true;

/**
 * Ngưỡng "lệch nhiều" giữa đơn giá nhập và giá định giá cũ (±20%). Vượt →
 * tô cảnh báo (vẫn cho nhập). Tunable — đổi 1 chỗ ở đây.
 */
export const PRICE_DEVIATION_THRESHOLD = 0.2;

export interface PriceDeviation {
  /** (new − old) / old; null khi không có baseline (giá cũ null/≤0). */
  ratio: number | null;
  /** true khi |ratio| ≥ ngưỡng → cảnh báo. */
  isLarge: boolean;
}

/**
 * So đơn giá nhập mới với giá định giá cũ. Không có giá cũ hợp lệ (null/≤0)
 * → không cảnh báo (ratio null). new ≤ 0 vẫn tính (giảm tới −100%).
 */
export function priceDeviation(
  oldPrice: number | null | undefined,
  newPrice: number
): PriceDeviation {
  if (oldPrice == null || oldPrice <= 0) return { ratio: null, isLarge: false };
  const ratio = (newPrice - oldPrice) / oldPrice;
  return { ratio, isLarge: Math.abs(ratio) >= PRICE_DEVIATION_THRESHOLD };
}

export interface PurchaseLineInput {
  ingredientId: string;
  quantity: number;
  unitPrice: number;
  syncPrice: boolean;
}

export interface PurchaseLinePayload {
  ingredient_id: string;
  quantity: number;
  unit_price: number;
  sync_price: boolean;
}

/** Map 1 dòng form → payload RPC (gồm cờ sync_price per-line). */
export function buildPurchaseLine(input: PurchaseLineInput): PurchaseLinePayload {
  return {
    ingredient_id: input.ingredientId,
    quantity: input.quantity,
    unit_price: input.unitPrice,
    sync_price: input.syncPrice,
  };
}
```

- [ ] **Step 4: Chạy test xác nhận pass**

Run: `npm run test:run -- purchase-price-sync`
Expected: PASS (tất cả assertion).

- [ ] **Step 5: Commit**

```bash
git add src/features/safe/purchase-price-sync.ts src/features/safe/__tests__/purchase-price-sync.test.ts
git commit -m "feat(safe): helper thuần đồng bộ giá định giá khi nhập NL (deviation/flag)"
```

---

## Task 2: Mở rộng type data-layer + mutation cho `sync_price`

**Files:**
- Modify: `src/lib/data/safe.ts:271` (type `lines`)
- Modify: `src/hooks/mutations/use-safe-mutations.ts:98` (type `lines`) + `:112-118` (onSuccess invalidation)

- [ ] **Step 1: Sửa `safePurchaseInventory` lines type**

Trong `src/lib/data/safe.ts`, đổi dòng `lines` của tham số `payload`:

```ts
    lines: ReadonlyArray<{
      ingredient_id: string;
      quantity: number;
      unit_price: number;
      sync_price: boolean;
    }>;
```

(Body hàm KHÔNG đổi — đã `p_lines: payload.lines`, server tự đọc `sync_price`.)

- [ ] **Step 2: Sửa `SafePurchaseInventoryInput`**

Trong `src/hooks/mutations/use-safe-mutations.ts`, đổi dòng `lines` của interface `SafePurchaseInventoryInput`:

```ts
  lines: ReadonlyArray<{
    ingredient_id: string;
    quantity: number;
    unit_price: number;
    sync_price: boolean;
  }>;
```

- [ ] **Step 3: Invalidate `ingredientPrices` sau khi nhập (BẮT BUỘC — nếu thiếu, "Giá trị kho" KHÔNG cập nhật ngay → vỡ tiêu chí hoàn thành)**

`useIngredientPricesQuery` dùng key riêng `queryKeys.ingredientPrices()` (`["inventory","ingredient_prices"]`, stale 60s); `stock-value.ts`/`stock-balance-list` đọc từ đó. RPC giờ ghi bảng này nên mutation phải invalidate nó. Trong `useSafePurchaseInventory.onSuccess` (`src/hooks/mutations/use-safe-mutations.ts:112-118`), thêm vào cuối khối `onSuccess`:

```ts
      queryClient.invalidateQueries({ queryKey: queryKeys.ingredientPrices() });
```

(Khối onSuccess hiện đã invalidate `safeBalance`, `["safe","transactions"]`, `ingredients`, `stockBalances`, `["inventory","stock_movements"]` — chỉ thiếu `ingredientPrices`. `queryKeys` đã import sẵn trong file.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: FAIL tại `purchase-inventory-modal.tsx` (chưa truyền `sync_price`) — đúng dự kiến; sẽ vá ở Task 3. Không có lỗi khác ngoài file đó.

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/safe.ts src/hooks/mutations/use-safe-mutations.ts
git commit -m "feat(safe): thêm sync_price + invalidate ingredientPrices khi nhập NL"
```

---

## Task 3: Modal nhập — giá cũ + checkbox đồng bộ + cảnh báo lệch

**Files:**
- Modify: `src/features/safe/purchase-inventory-modal.tsx`

- [ ] **Step 1: Thêm import**

Sau các import hiện có, thêm:

```ts
import { Checkbox } from "@/components/ui/checkbox";
import { useIngredientPricesQuery } from "@/hooks/queries/use-inventory-queries";
import {
  DEFAULT_SYNC_PRICE,
  priceDeviation,
  buildPurchaseLine,
} from "./purchase-price-sync";
```

- [ ] **Step 2: Thêm `syncPrice` vào `PurchaseRow` + `emptyRow`**

Đổi interface `PurchaseRow`:

```ts
interface PurchaseRow {
  key: number;
  ingredientId: string;
  qtyStr: string;
  priceStr: string;
  amountStr: string;
  syncPrice: boolean;
}
```

Đổi `emptyRow()`:

```ts
function emptyRow(): PurchaseRow {
  return { key: rowSeq++, ingredientId: "", qtyStr: "", priceStr: "", amountStr: "", syncPrice: DEFAULT_SYNC_PRICE };
}
```

- [ ] **Step 3: Load giá định giá (owner-only, an toàn vì modal owner-only)**

Sau dòng `const ingredientsQuery = useIngredientsQuery(supabase, open);` thêm:

```ts
  const pricesQuery = useIngredientPricesQuery(supabase, open);
  const prices = pricesQuery.data;
```

- [ ] **Step 4: Truyền `sync_price` khi submit**

Trong `handleSubmit`, đổi `lines: rows.map(...)`:

```ts
        lines: rows.map((r) =>
          buildPurchaseLine({
            ingredientId: r.ingredientId,
            quantity: Number(r.qtyStr) || 0,
            unitPrice: moneyFromInput(r.priceStr),
            syncPrice: r.syncPrice,
          })
        ),
```

- [ ] **Step 5: Render giá cũ + cảnh báo + checkbox trong mỗi dòng**

Trong khối `rows.map((row) => { ... })`, ngay sau `<div className="grid grid-cols-3 gap-2"> … </div>` (đóng grid SL/đơn giá/thành tiền) và TRƯỚC khi đóng `</div>` của card dòng, chèn:

```tsx
                  {(() => {
                    const oldPrice = prices?.get(row.ingredientId)?.unit_price ?? null;
                    const dev = priceDeviation(oldPrice, moneyFromInput(row.priceStr));
                    return (
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className="text-xs tabular-nums">
                          {oldPrice == null ? (
                            <span className="text-muted">Chưa có giá định giá</span>
                          ) : (
                            <>
                              <span className="text-muted">Giá cũ: </span>
                              <strong className={dev.isLarge ? "text-warning" : "text-ink-2"}>
                                {formatVND(oldPrice)}
                              </strong>
                              {dev.isLarge && dev.ratio != null && (
                                <span className="text-warning">
                                  {" "}· lệch {dev.ratio > 0 ? "+" : ""}
                                  {Math.round(dev.ratio * 100)}%
                                </span>
                              )}
                            </>
                          )}
                        </span>
                        <Checkbox
                          label="Cập nhật giá định giá"
                          checked={row.syncPrice}
                          onCheckedChange={(c) => updateRow(row.key, { syncPrice: c === true })}
                          disabled={isBusy}
                        />
                      </div>
                    );
                  })()}
```

> Lưu ý token màu: dùng `text-warning` (đồng bộ với `Badge semantic="warning"`). Khi implement, xác nhận token `text-warning` tồn tại trong theme (grep `--color-warning`/`text-warning` ở `src/app/globals.css` hoặc tailwind config). Nếu KHÔNG có, thay bằng `text-danger`. Không để class màu không tồn tại.

- [ ] **Step 6: Type-check + lint pass**

Run: `npx tsc --noEmit`
Expected: PASS (không lỗi). `moneyFromInput`, `formatVND`, `updateRow` đã có sẵn trong file.

- [ ] **Step 7: Commit**

```bash
git add src/features/safe/purchase-inventory-modal.tsx
git commit -m "feat(safe): modal nhập hiện giá cũ + checkbox đồng bộ giá (default bật) + cảnh báo lệch"
```

---

## Task 4: Discoverability — nút "Sửa giá"/"Đặt giá" có nhãn ở tab Tồn kho

**Bối cảnh:** `stock-balance-list.tsx:141-152` đã có `IconButton` pencil (icon-only, `aria-label`) khi `onEditPrice` có mặt. Spec muốn affordance RÕ hơn (không bấm-ngầm) → đổi sang nút CÓ NHÃN, và đặc biệt khi "Chưa có giá" thì nhãn "Đặt giá".

**Files:**
- Modify: `src/features/inventory/stock-balance-list.tsx`

- [ ] **Step 1: Thêm import `Button`**

Đổi dòng `import { IconButton } from "@/components/ui/icon-button";` thành (giữ IconButton nếu còn dùng nơi khác — grep; trong file này chỉ pencil dùng IconButton nên thay hẳn):

```ts
import { Button } from "@/components/ui/button";
```

(Xóa import `IconButton` nếu sau khi đổi không còn tham chiếu nào trong file.)

- [ ] **Step 2: Thay pencil icon-only bằng nút có nhãn**

Đổi khối `{onEditPrice && ( <IconButton .../> )}` (dòng 141-152) thành:

```tsx
                  {onEditPrice && (
                    <Button
                      type="button"
                      variant="ghost"
                      leadingIcon={<Icon name="pencil" size={16} />}
                      aria-label={`Sửa đơn giá ${b.name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditPrice(b.ingredient_id);
                      }}
                    >
                      {prices?.get(b.ingredient_id)?.unit_price == null ? "Đặt giá" : "Sửa giá"}
                    </Button>
                  )}
```

> Xác nhận `Button` nhận prop `leadingIcon` (đã dùng ở `purchase-inventory-modal.tsx:257`) và `variant="ghost"`. `Icon` đã import sẵn.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: (Tùy chọn) chạy app xác minh affordance**

Dev server đang chạy ở port 3009 (đừng `npm run build`). Mở tab Tồn kho dưới owner → mỗi dòng có nút "Sửa giá" (hoặc "Đặt giá" khi chưa có giá), bấm mở `IngredientPriceModal`. Không bắt buộc cho gate test.

- [ ] **Step 5: Commit**

```bash
git add src/features/inventory/stock-balance-list.tsx
git commit -m "feat(inventory): nút Sửa giá/Đặt giá có nhãn ở tab Tồn kho (owner-only)"
```

---

## Task 5: RPC `safe_purchase_inventory` + backfill (dual-write 002 + migration)

**Files:**
- Create: `database/migrations/2026-06-27-ingredient-price-sync-on-purchase.sql`
- Modify: `database/002_functions.sql:2242-2377` (thay body function — KHÔNG động backfill ở đây)

**Thay đổi logic so với bản hiện tại (cả hai nơi giống hệt phần function):**
1. Trong vòng lặp validate (vòng 1), không cần đổi (sync_price không validate số tiền).
2. Trong vòng lặp đẩy kho (vòng 2), đọc cờ `v_sync := coalesce((v_line->>'sync_price')::boolean, true);` — thiếu field ⇒ true.
3. Sau `update ingredients set last_unit_price`, nếu `v_sync` → upsert `ingredient_reference_prices` với `round(v_price)::bigint`.

- [ ] **Step 1: Viết migration (function + backfill)**

`database/migrations/2026-06-27-ingredient-price-sync-on-purchase.sql`:

```sql
-- 2026-06-27-ingredient-price-sync-on-purchase.sql
-- Đồng bộ giá định giá khi nhập NL từ sổ quỹ (spec 2026-06-24):
--   safe_purchase_inventory: thêm cờ per-line p_lines[].sync_price (default
--     true). Dòng bật → upsert ingredient_reference_prices.unit_price =
--     round(unit_price)::bigint (atomic cùng giao dịch nhập). Vẫn ghi
--     last_unit_price + stock_movements + safe_transactions như cũ.
--   Backfill 1 lần (idempotent): seed ingredient_reference_prices từ
--     last_unit_price cho NL chưa có giá định giá mà last_unit_price > 0.
-- Thân function trích NGUYÊN VĂN từ canonical database/002_functions.sql
-- (dual-write — giữ hai nơi giống hệt).

create or replace function public.safe_purchase_inventory(
  p_cash_amount numeric,
  p_transfer_amount numeric,
  p_lines jsonb,
  p_description text default null,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_cash numeric := coalesce(p_cash_amount, 0);
  v_transfer numeric := coalesce(p_transfer_amount, 0);
  v_occurred timestamptz := coalesce(p_occurred_at, now());
  v_total numeric := 0;
  v_line jsonb;
  v_ing_id uuid;
  v_qty numeric;
  v_price numeric;
  v_sync boolean;
  v_balance numeric;
  v_cash_id uuid;
  v_transfer_id uuid;
  v_cash_after numeric;
  v_transfer_after numeric;
  v_movement_ids uuid[] := '{}';
  v_mid uuid;
  v_note text;
begin
  if public.app_role() <> 'owner' then
    raise exception 'Chỉ owner được nhập nguyên liệu từ sổ quỹ.';
  end if;
  if v_cash < 0 or v_transfer < 0 then
    raise exception 'Số tiền mỗi quỹ không được âm.';
  end if;
  if v_cash <> floor(v_cash) or v_transfer <> floor(v_transfer) then
    raise exception 'Số tiền phải là số nguyên VND.';
  end if;
  if v_occurred::date > current_date then
    raise exception 'Ngày nhập không được ở tương lai.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Cần ít nhất 1 dòng nguyên liệu.';
  end if;
  if length(coalesce(p_description, '')) > 500 then
    raise exception 'Mô tả vượt 500 ký tự.';
  end if;

  -- Validate từng dòng + tính tổng server-side.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    if v_ing_id is null then
      raise exception 'Dòng thiếu ingredient_id.';
    end if;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Số lượng phải > 0.';
    end if;
    if v_price is null or v_price < 0 then
      raise exception 'Đơn giá không được âm.';
    end if;
    if not exists (select 1 from public.ingredients where id = v_ing_id and is_active) then
      raise exception 'Nguyên liệu % không tồn tại hoặc đã ẩn.', v_ing_id;
    end if;
    v_total := v_total + v_qty * v_price;
  end loop;

  v_total := round(v_total, 2);
  if v_total <= 0 or v_total > 1000000000 then
    raise exception 'Tổng tiền nhập phải 1–1.000.000.000 (hiện %).', v_total;
  end if;
  if v_cash + v_transfer <> v_total then
    raise exception 'Tách quỹ (%) không khớp tổng các dòng (%).', v_cash + v_transfer, v_total;
  end if;

  v_note := coalesce(nullif(trim(p_description), ''), 'Nhập nguyên liệu — rút sổ quỹ ' || v_occurred::date);

  -- Trừ quỹ per-fund (advisory lock, skip phần 0) — giống safe_withdraw_other v4.
  if v_cash > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:cash'));
    v_balance := public.safe_fund_balance_now('cash');
    if v_balance < v_cash then
      raise exception 'Quỹ tiền mặt không đủ. Số dư hiện tại %, cần %.', v_balance, v_cash;
    end if;
    v_cash_after := v_balance - v_cash;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_cash, v_cash_after, 'cash', v_occurred,
      'inventory', v_note, auth.uid()
    ) returning id into v_cash_id;
  end if;

  if v_transfer > 0 then
    perform pg_advisory_xact_lock(hashtext('safe_fund:transfer'));
    v_balance := public.safe_fund_balance_now('transfer');
    if v_balance < v_transfer then
      raise exception 'Quỹ chuyển khoản không đủ. Số dư hiện tại %, cần %.', v_balance, v_transfer;
    end if;
    v_transfer_after := v_balance - v_transfer;
    insert into public.safe_transactions (
      transaction_type, amount, balance_after, fund, occurred_at,
      reason_category, description, created_by
    ) values (
      'withdraw_other', -v_transfer, v_transfer_after, 'transfer', v_occurred,
      'inventory', v_note, auth.uid()
    ) returning id into v_transfer_id;
  end if;

  -- Đẩy kho + nhớ đơn giá + (tùy cờ) đồng bộ giá định giá cho từng dòng.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ing_id := (v_line->>'ingredient_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_price := (v_line->>'unit_price')::numeric;
    v_sync := coalesce((v_line->>'sync_price')::boolean, true);
    insert into public.stock_movements (
      ingredient_id, quantity_delta, reason, occurred_at, notes, created_by
    ) values (
      v_ing_id, v_qty, 'purchase_received', v_occurred, v_note, auth.uid()
    ) returning id into v_mid;
    v_movement_ids := v_movement_ids || v_mid;
    update public.ingredients set last_unit_price = v_price where id = v_ing_id;
    if v_sync then
      insert into public.ingredient_reference_prices (ingredient_id, unit_price, updated_at)
      values (v_ing_id, round(v_price)::bigint, now())
      on conflict (ingredient_id) do update
        set unit_price = excluded.unit_price,
            updated_at = excluded.updated_at;
    end if;
  end loop;

  return jsonb_build_object(
    'cash_id', v_cash_id,
    'transfer_id', v_transfer_id,
    'cash_balance_after', v_cash_after,
    'transfer_balance_after', v_transfer_after,
    'total', v_total,
    'movement_ids', to_jsonb(v_movement_ids)
  );
end;
$$;

grant execute on function public.safe_purchase_inventory(numeric, numeric, jsonb, text, timestamptz) to authenticated;

-- ===== Backfill 1 lần (idempotent) =====
-- Seed giá định giá từ last_unit_price cho NL CHƯA có giá mà last_unit_price>0.
-- ON CONFLICT DO NOTHING ⇒ chạy lại không nhân đôi, không đè giá owner đã đặt.
-- (Đồng bộ với database/tests/281_backfill_reference_prices.sql.)
insert into public.ingredient_reference_prices (ingredient_id, unit_price, updated_at)
select i.id, round(i.last_unit_price)::bigint, now()
from public.ingredients i
where i.last_unit_price > 0
on conflict (ingredient_id) do nothing;
```

- [ ] **Step 2: Dual-write vào `database/002_functions.sql`**

Thay TOÀN BỘ định nghĩa `safe_purchase_inventory` hiện tại (`database/002_functions.sql:2242` → trước dòng `grant execute … to authenticated;` ở 2379, gồm cả grant) bằng phần FUNCTION + GRANT y hệt ở Step 1 (KHÔNG copy phần backfill — backfill chỉ ở migration; 002 là canonical functions, không chứa data backfill). Cụ thể: thêm khai báo `v_sync boolean;`, dòng `v_sync := coalesce(...)`, và khối `if v_sync then insert … on conflict … end if;` đúng như trên.

- [ ] **Step 3: Xác minh hai bản giống hệt (phần function)**

Run (Git Bash):
```bash
cd "<repo-root>"
# Trích function từ migration (tới dấu ; của grant đầu tiên) và từ 002, so sánh.
diff <(awk '/create or replace function public.safe_purchase_inventory/,/to authenticated;/' database/migrations/2026-06-27-ingredient-price-sync-on-purchase.sql) \
     <(awk '/create or replace function public.safe_purchase_inventory/,/to authenticated;/' database/002_functions.sql)
```
Expected: KHÔNG có dòng khác (diff rỗng) → dual-write khớp.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/2026-06-27-ingredient-price-sync-on-purchase.sql database/002_functions.sql
git commit -m "feat(db): safe_purchase_inventory đồng bộ ingredient_reference_prices (sync_price) + backfill idempotent"
```

---

## Task 6: pgTAP — RPC sync_price (`089`)

**Files:**
- Create: `database/tests/089_purchase_inventory_price_sync.sql`

**Thiết kế fixture:** theo `088` — 1 owner, seed 2 NL (một CÓ giá định giá sẵn để test ghi đè, một CHƯA có để test set mới), seed quỹ rộng. RPC security-definer chạy upsert bất kể role; đọc bảng owner-only bằng superuser (không SET ROLE) thấy mọi row.

- [ ] **Step 1: Viết test file**

`database/tests/089_purchase_inventory_price_sync.sql`:

```sql
-- 089 — safe_purchase_inventory: cờ per-line sync_price đồng bộ
-- ingredient_reference_prices (spec 2026-06-24). true→set/ghi đè/round;
-- false→giữ nguyên; thiếu field→mặc định true. Vẫn ghi last_unit_price +
-- stock_movements + safe_transactions.
BEGIN;
SELECT plan(9);

CREATE OR REPLACE FUNCTION pg_temp.act_as(p_user_id uuid) RETURNS void AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role','authenticated')::text, true);
END;
$$ LANGUAGE plpgsql;

INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, instance_id) VALUES
  ('11111111-1111-1111-1111-111111111111','owner@test.local','',now(),'00000000-0000-0000-0000-000000000000');
INSERT INTO public.profiles (id, display_name) VALUES
  ('11111111-1111-1111-1111-111111111111','Owner');
INSERT INTO public.employee_accounts (auth_user_id, role, status) VALUES
  ('11111111-1111-1111-1111-111111111111','owner','active');

-- NL #1: chưa có giá định giá (test SET mới + round). NL #2: đã có giá 50000
-- (test GHI ĐÈ khi sync=true / GIỮ khi sync=false).
INSERT INTO public.ingredients (id, name, unit, last_unit_price) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'NL set 089', 'kg', 0),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'NL giữ 089', 'kg', 0);
INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', 50000);

SELECT pg_temp.act_as('11111111-1111-1111-1111-111111111111');
SELECT public.safe_setup_initial(5000000, 0, 'seed 089');
UPDATE public.safe_transactions SET created_at = now() - interval '4 hours';

-- ⚠️ Tổng MỖI call phải là số nguyên: RPC check `v_cash + v_transfer <> round(v_total,2)`.
-- ⚠️ Stagger created_at THEO ID dòng vừa tạo (không theo reason_category) để balance
--    chain (created_at desc, id desc) xác định qua nhiều call (giống 088:70).
-- Call 1: NL#1 sync=true, qty 5 × 100000.4 = 500002 (nguyên) → round(100000.4)=100000;
--         NL#2 sync=false, 1 × 999999 = 999999 → KHÔNG đổi (giữ 50000).
--         Tổng = 1.500.001, trả hết cash.
CREATE TEMP TABLE _p1 AS
SELECT public.safe_purchase_inventory(
  1500001, 0,
  jsonb_build_array(
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',5,'unit_price',100000.4,'sync_price',true),
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000002','quantity',1,'unit_price',999999,'sync_price',false)
  ),
  'sync test 089', now() - interval '1 day'
) AS r;
UPDATE public.safe_transactions SET created_at = now() - interval '3 hours'
  WHERE id = (SELECT (r->>'cash_id')::uuid FROM _p1);

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000001'),
  100000::bigint, 'sync=true: SET giá mới + round(100000.4)=100000');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000002'),
  50000::bigint, 'sync=false: GIỮ nguyên giá cũ 50000 (không đè 999999)');
SELECT is(
  (SELECT last_unit_price FROM public.ingredients WHERE id='aaaaaaaa-0000-0000-0000-000000000002'),
  999999::numeric, 'last_unit_price VẪN ghi đè kể cả khi sync=false');
SELECT is(
  (SELECT count(*)::int FROM public.stock_movements WHERE reason='purchase_received'),
  2, 'vẫn ghi 2 stock_movements');
SELECT is(
  (SELECT count(*)::int FROM public.safe_transactions WHERE reason_category='inventory'),
  1, 'vẫn ghi safe_transactions (1 cash row)');

-- Call 2: NL#1 sync=true, 1 × 120000 → GHI ĐÈ 100000→120000.
CREATE TEMP TABLE _p2 AS
SELECT public.safe_purchase_inventory(
  120000, 0,
  jsonb_build_array(
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',1,'unit_price',120000,'sync_price',true)
  ),
  'overwrite 089', now() - interval '1 day'
) AS r;
UPDATE public.safe_transactions SET created_at = now() - interval '2 hours'
  WHERE id = (SELECT (r->>'cash_id')::uuid FROM _p2);

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000001'),
  120000::bigint, 'sync=true: GHI ĐÈ giá đã có 100000→120000');

-- Call 3: THIẾU field sync_price → mặc định true → set giá cho NL#1 = 130000.
CREATE TEMP TABLE _p3 AS
SELECT public.safe_purchase_inventory(
  130000, 0,
  jsonb_build_array(
    jsonb_build_object('ingredient_id','aaaaaaaa-0000-0000-0000-000000000001','quantity',1,'unit_price',130000)
  ),
  'default sync 089', now() - interval '1 day'
) AS r;
UPDATE public.safe_transactions SET created_at = now() - interval '1 hour'
  WHERE id = (SELECT (r->>'cash_id')::uuid FROM _p3);

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='aaaaaaaa-0000-0000-0000-000000000001'),
  130000::bigint, 'thiếu sync_price → mặc định true → đồng bộ 130000');

-- Số dòng giá định giá vẫn = 2 (không tạo thừa).
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices),
  2, 'không tạo row giá thừa (vẫn 2 NL có giá)');

-- last_unit_price NL#1 = 130000 (lần cuối).
SELECT is(
  (SELECT last_unit_price FROM public.ingredients WHERE id='aaaaaaaa-0000-0000-0000-000000000001'),
  130000::numeric, 'last_unit_price NL#1 = 130000 (lần nhập cuối)');

SELECT * FROM finish();
ROLLBACK;
```

> Lưu ý tie-break `created_at`: mỗi call stagger `created_at` của ĐÚNG dòng vừa tạo (theo `cash_id`) để chain `safe_fund_balance_now` xác định qua nhiều call (giống `088:70`, nhưng theo id thay vì reason_category). `safe_setup_initial(5_000_000, 0, …)` nạp đủ quỹ cash cho 3 call (1.500.001 + 120.000 + 130.000 = 1.750.001 < 5.000.000). Half-up của `round` được test riêng ở `281` (case `.5`).

- [ ] **Step 2: Chạy test (DB throwaway sạch — KHÔNG dùng supabase-db dev)**

> Theo memory `pgtap-run-on-clean-db`: chạy full/suite trên DB dev cho fail GIẢ do seed đụng. Verify đúng = DB throwaway nhân bản CI (auth-mock + 001/002/003 + migrations). Nếu môi trường có sẵn `chill_pgtap`, dùng nó; nếu không, chạy CI-mode:
```bash
# Ưu tiên: nhân bản CI trên DB throwaway
PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/chill_pgtap node scripts/ci/apply-schema.mjs
PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/chill_pgtap node scripts/pgtap-run.mjs --file database/tests/089_purchase_inventory_price_sync.sql
```
Expected: `9/9 passed`.

- [ ] **Step 3: Commit**

```bash
git add database/tests/089_purchase_inventory_price_sync.sql
git commit -m "test(pgtap): 089 safe_purchase_inventory sync_price upsert ingredient_reference_prices"
```

---

## Task 7: pgTAP — backfill idempotent (`281`)

**Files:**
- Create: `database/tests/281_backfill_reference_prices.sql`

- [ ] **Step 1: Viết test file**

`database/tests/281_backfill_reference_prices.sql`:

```sql
-- 281 — backfill ingredient_reference_prices từ last_unit_price (spec
-- 2026-06-24). Idempotent: NL chưa có giá & last_unit_price>0 → set (round);
-- NL đã có giá → KHÔNG đè; last_unit_price=0 → bỏ qua; chạy 2 lần ổn định.
-- Câu backfill PHẢI khớp database/migrations/2026-06-27-ingredient-price-sync-on-purchase.sql.
BEGIN;
SELECT plan(7);

-- 4 NL: A chưa có giá last=185000.6 (set, round→185001); B đã có giá 50000
-- nhưng last=999999 (giữ 50000); C last=0 (bỏ qua, không tạo row);
-- D last=100000.5 (test half-up: round(100000.5)=100001, away-from-zero).
INSERT INTO public.ingredients (id, name, unit, last_unit_price) VALUES
  ('cccccccc-0000-0000-0000-00000000000a', 'A 281', 'kg', 185000.6),
  ('cccccccc-0000-0000-0000-00000000000b', 'B 281', 'kg', 999999),
  ('cccccccc-0000-0000-0000-00000000000c', 'C 281', 'kg', 0),
  ('cccccccc-0000-0000-0000-00000000000d', 'D 281', 'kg', 100000.5);
INSERT INTO public.ingredient_reference_prices (ingredient_id, unit_price) VALUES
  ('cccccccc-0000-0000-0000-00000000000b', 50000);

CREATE OR REPLACE FUNCTION pg_temp.run_backfill() RETURNS void AS $$
  insert into public.ingredient_reference_prices (ingredient_id, unit_price, updated_at)
  select i.id, round(i.last_unit_price)::bigint, now()
  from public.ingredients i
  where i.last_unit_price > 0
  on conflict (ingredient_id) do nothing;
$$ LANGUAGE sql;

-- Lần 1
SELECT pg_temp.run_backfill();

SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000a'),
  185001::bigint, 'A: set từ last_unit_price 185000.6 → round 185001');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000b'),
  50000::bigint, 'B: GIỮ giá đã có 50000 (không đè 999999)');
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000c'),
  0, 'C: last_unit_price=0 → KHÔNG tạo row');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000d'),
  100001::bigint, 'D: half-up round(100000.5)=100001 (away-from-zero)');

-- Lần 2 (idempotent): không thay đổi gì.
SELECT pg_temp.run_backfill();
SELECT is(
  (SELECT count(*)::int FROM public.ingredient_reference_prices
   WHERE ingredient_id IN (
     'cccccccc-0000-0000-0000-00000000000a',
     'cccccccc-0000-0000-0000-00000000000b',
     'cccccccc-0000-0000-0000-00000000000c',
     'cccccccc-0000-0000-0000-00000000000d')),
  3, 'chạy lần 2: vẫn đúng 3 row (A + B + D), không nhân đôi');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000a'),
  185001::bigint, 'A: giá không đổi sau lần 2');
SELECT is(
  (SELECT unit_price FROM public.ingredient_reference_prices WHERE ingredient_id='cccccccc-0000-0000-0000-00000000000d'),
  100001::bigint, 'D: giá half-up không đổi sau lần 2');

SELECT * FROM finish();
ROLLBACK;
```

> Test nhúng lại câu backfill (qua `pg_temp.run_backfill`) vì migration đã chạy lúc apply-schema trên `ingredients` rỗng (no-op ở CI). Giữ câu SQL khớp migration; có comment chéo ở cả hai file.

- [ ] **Step 2: Chạy test trên DB throwaway**

```bash
PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/chill_pgtap node scripts/pgtap-run.mjs --file database/tests/281_backfill_reference_prices.sql
```
Expected: `5/5 passed`.

- [ ] **Step 3: Commit**

```bash
git add database/tests/281_backfill_reference_prices.sql
git commit -m "test(pgtap): 281 backfill ingredient_reference_prices idempotent"
```

---

## Task 8: Verify toàn phase + dual-write

- [ ] **Step 1: Vitest đầy đủ**

Run: `npm run test:run`
Expected: tất cả pass (gồm `purchase-price-sync.test.ts`).

- [ ] **Step 2: pgTAP đầy đủ trên DB throwaway nhân bản CI**

```bash
# rebuild schema sạch rồi chạy toàn bộ suite
PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/chill_pgtap node scripts/ci/apply-schema.mjs
PGTAP_DB_URL=postgres://postgres:postgres@localhost:5432/chill_pgtap node scripts/pgtap-run.mjs
```
Expected: `✓ All assertions passed.` (gồm 088 cũ vẫn xanh, 089, 280 cũ, 281).

- [ ] **Step 3: Type-check toàn repo**

Run: `npx tsc --noEmit`
Expected: PASS, không lỗi.

- [ ] **Step 4: Xác minh dual-write lần cuối** (lệnh diff ở Task 5 Step 3) → rỗng.

- [ ] **Step 5: finishing-a-development-branch** — mở PR vào `origin/main` (base = main, KHÔNG phải phase-6a-ci-foundation).

---

## Coverage checklist (đối chiếu spec — để Codex tick không sót)

- [ ] **Đồng bộ khi nhập:** cờ per-line `sync_price` default true vào RPC → Task 5 (migration + 002), Task 6 (test default-true khi thiếu field).
- [ ] **Upsert round bigint:** `round(v_price)::bigint`, on conflict do update → Task 5; test trống→set/có→ghi đè/round → Task 6.
- [ ] **sync=false giữ giá định giá:** Task 6 (NL#2 giữ 50000).
- [ ] **Vẫn ghi last_unit_price + stock_movements + safe_transactions:** Task 6 (3 assertion).
- [ ] **Dual-write 002 + migration, body khớp:** Task 5 Step 2-3 (diff rỗng). *(Ghi chú: spec nhắc "verify:mirror" nhưng đó là tool dashboard; cổng đúng là verify:phase — đã nêu ở phần Bối cảnh.)*
- [ ] **Quyền:** xác nhận owner-only kép (UI + RPC); non-owner không tới path; security-definer upsert được → phần Bối cảnh + Task 6 (088 đã test non-owner bị chặn).
- [ ] **Modal: giá cũ / "chưa có giá":** Task 3 Step 5.
- [ ] **Modal: checkbox default BẬT, tắt được:** Task 1 (`DEFAULT_SYNC_PRICE`), Task 3 (Checkbox state).
- [ ] **Modal: cảnh báo lệch (±20% tunable):** Task 1 (`priceDeviation`/`PRICE_DEVIATION_THRESHOLD` + test), Task 3 (tô màu).
- [ ] **Modal: truyền cờ xuống RPC:** Task 1 (`buildPurchaseLine` + test), Task 3 Step 4.
- [ ] **Discoverability "sửa giá" rõ ràng (owner-only):** Task 4.
- [ ] **Backfill migration idempotent:** Task 5 (INSERT … ON CONFLICT DO NOTHING), Task 7 (test 2 lần).
- [ ] **Test xanh (Vitest + pgTAP):** Task 8.
- [ ] **Ngoài phạm vi (không làm):** COGS/giá vốn theo món, lịch sử giá per-purchase, moving-average, gộp 2 trường — KHÔNG đụng.

## Codex plan-review — đã giải quyết (gate bắt buộc)

Codex review (2026-06-27) trả về 2 Critical + 2 Should-fix; đã vá vào plan:
- **[C1 — đã sửa]** Test 089 call 1 truyền cash nguyên nhưng tổng dòng lẻ (1099999 vs 1099999.4) → RPC `v_cash+v_transfer <> round(v_total,2)` raise trước khi tới assertion. Sửa: qty 5 × 100000.4 = 502002 (tổng nguyên 1.502.001).
- **[C2 — đã sửa]** `useSafePurchaseInventory.onSuccess` thiếu invalidate `queryKeys.ingredientPrices()` → "Giá trị kho" không cập nhật ngay (vỡ tiêu chí). Thêm ở Task 2 Step 3.
- **[S1 — đã sửa]** Stagger `created_at` theo `reason_category` (đụng nhiều row) → balance chain nondeterministic. Sửa: stagger theo `cash_id` của đúng call (Task 6).
- **[S3 — đã sửa]** Thiếu case half `.5`. Thêm NL D (`100000.5→100001`) ở Task 7 (281).
- **[N3 — đã sửa]** `vitest.config.ts` → đúng là `vitest.config.mts`.
- **[N1/N2 — xác nhận đúng]** Owner-only kép + RLS, và dual-write/apply-order + "verify:mirror là tool dashboard" → Codex confirm plan đúng.

## Quyết định đã chốt

1. **[S2 — user chốt] Dùng helper thuần + `.test.ts`** (không dựng RTL/jsdom). Hành vi render modal (giá cũ / checkbox default-on / tô cảnh báo) verify qua `tsc --noEmit` + chạy app thật ở 3009 (Task 3 Step 6 + Task 4 Step 4). → Điều chỉnh tiêu chí spec "Component/Vitest cho modal": logic test bằng helper; UI test thủ công. Phù hợp định hướng dự án (component test hoãn "Phase 6.B").
2. **Discoverability:** pencil icon-only ĐÃ tồn tại → đổi sang nút có nhãn "Sửa giá"/"Đặt giá" (Task 4). Nếu reviewer muốn affordance mạnh hơn, mở rộng sau.
3. **`sync_price=false` vẫn ghi đè `last_unit_price`** (giữ hành vi cũ) — `last_unit_price` là gợi ý auto-fill, không phải định giá; tắt cờ chỉ chặn đồng bộ `ingredient_reference_prices`. Đã test ở 089.
4. **Token màu `text-warning`** — xác nhận tồn tại lúc implement (Task 3 Step 5); nếu không có, dùng `text-danger`.
