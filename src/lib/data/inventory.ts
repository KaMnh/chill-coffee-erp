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
