import type { SupabaseClient } from "@supabase/supabase-js";
import { toAppError } from "./_common";
import type { IngredientReferencePrice } from "@/lib/types";

/**
 * Đơn giá tham chiếu tồn kho — bảng owner-only (RLS `app_role() = 'owner'`
 * cả đọc lẫn ghi). Non-owner SELECT nhận 0 rows (không lỗi); ghi bị 42501.
 * Spec: docs/superpowers/specs/2026-06-12-inventory-reference-price-design.md
 */
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
  const { error } = await supabase.from("ingredient_reference_prices").upsert({
    ingredient_id: ingredientId,
    unit_price: unitPrice,
    updated_at: new Date().toISOString(),
  });
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
