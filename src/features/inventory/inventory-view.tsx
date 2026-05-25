"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { IngredientsTab } from "./ingredients-tab";
import { MenuItemsTab } from "./menu-items-tab";
import { RecipesTab } from "./recipes-tab";
import { StockTab } from "./stock-tab";
import { InventoryDashboardTab } from "./inventory-dashboard-tab";
import type { UserRole } from "@/lib/types";

interface InventoryViewProps {
  role: UserRole;
}

/**
 * Phase 4.B — Top-level inventory container.
 *
 * Defense-in-depth role gate: NAV_ITEMS already filters at the sidebar
 * level (employee_viewer doesn't see "Kho"). If URL-navigated directly,
 * we render a lock EmptyState.
 *
 * Structure: 5-tab Radix Tabs. 4.B fills tabs 1 + 2; tabs 3, 4, 5 are
 * EmptyState placeholders awaiting Phase 4.C / 4.D / 4.E content.
 *
 * Role-based UI within each tab:
 *   - owner / manager: full CRUD
 *   - staff_operator: read-only Masters (write controls hidden)
 */
export function InventoryView({ role }: InventoryViewProps) {
  if (role === "employee_viewer") {
    return (
      <EmptyState
        icon="lock"
        title="Kho dành cho staff trở lên"
        subtitle="Module này dành cho nhân viên vận hành, manager và owner."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock">Tồn kho</TabsTrigger>
          <TabsTrigger value="ingredients">Nguyên liệu</TabsTrigger>
          <TabsTrigger value="menu_items">Sản phẩm</TabsTrigger>
          <TabsTrigger value="recipes">Công thức</TabsTrigger>
          <TabsTrigger value="dashboard">Tổng quan</TabsTrigger>
        </TabsList>

        <TabsContent value="stock">
          <StockTab role={role} />
        </TabsContent>

        <TabsContent value="ingredients">
          <IngredientsTab role={role} />
        </TabsContent>

        <TabsContent value="menu_items">
          <MenuItemsTab role={role} />
        </TabsContent>

        <TabsContent value="recipes">
          <RecipesTab role={role} />
        </TabsContent>

        <TabsContent value="dashboard">
          <InventoryDashboardTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
