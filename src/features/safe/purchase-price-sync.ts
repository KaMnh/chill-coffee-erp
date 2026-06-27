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
