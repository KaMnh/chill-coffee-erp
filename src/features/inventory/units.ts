/**
 * Phase 4.B — Stock units used by ingredients.
 *
 * Stored value in DB matches the constant string. The Vietnamese label
 * is used only for UI display (Select dropdown, row badge).
 */

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

/**
 * Look up the Vietnamese label for a stored unit. Falls back to the raw
 * value when the unit is unknown (e.g., legacy data with a custom unit).
 */
export function formatUnit(unit: string): string {
  return (STOCK_UNIT_LABELS_VI as Record<string, string>)[unit] ?? unit;
}
