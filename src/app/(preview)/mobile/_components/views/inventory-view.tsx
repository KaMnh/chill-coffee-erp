"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Reveal } from "@/components/ui/reveal";
import { formatVND } from "@/lib/format";
import { SectionLabel, SuggestNote } from "../bits";
import {
  INVENTORY_TABS,
  INVENTORY_STOCK,
  INVENTORY_INGREDIENTS,
  INVENTORY_PRODUCTS,
  INVENTORY_RECIPES,
} from "../../_mock/data";

/**
 * Kho — Tier B: 5 tab cuộn ngang (segmented pill), bảng → card list,
 * recipe builder để full-screen flow khi build thật (chú thích đề xuất).
 */
export function MobileInventoryView() {
  const [tab, setTab] = useState(0);

  return (
    <div className="flex flex-col min-h-full">
      {/* Tab cuộn ngang — sticky dưới top bar */}
      <div className="sticky top-0 z-20 bg-bg-app-from/95 backdrop-blur px-4 pt-3 pb-2 -mb-1">
        <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]" role="tablist" aria-label="Tab kho">
          {INVENTORY_TABS.map((label, i) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={tab === i}
              onClick={() => setTab(i)}
              className={cn(
                "h-11 px-4 shrink-0 rounded-full text-sm font-medium transition-colors",
                tab === i ? "bg-ink text-white" : "bg-surface text-muted border border-border"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Reveal key={tab} stagger className="p-4 space-y-2">
        {tab === 0 && (
          <>
            {INVENTORY_STOCK.map((s) => (
              <article key={s.name} className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{s.name}</div>
                  <div className={cn("text-xs mt-0.5 tabular-nums", s.qty < 0 ? "text-danger font-semibold" : "text-muted")}>
                    Tồn: {s.qty.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} {s.unit}
                  </div>
                </div>
                {s.qty < 0 && <Badge variant="soft" semantic="danger">Âm</Badge>}
                {s.low && <Badge variant="soft" semantic="warning">Sắp hết</Badge>}
              </article>
            ))}
          </>
        )}

        {tab === 1 && (
          <>
            {INVENTORY_INGREDIENTS.map((ing) => (
              <article key={ing.name} className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{ing.name}</div>
                  <div className="text-xs text-muted mt-0.5">Đơn vị: {ing.unit}</div>
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatVND(ing.price)}</span>
              </article>
            ))}
          </>
        )}

        {tab === 2 && (
          <>
            {INVENTORY_PRODUCTS.map((p) => (
              <article key={p.name} className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{p.name}</div>
                  <div className="text-xs text-muted mt-0.5">{p.category}</div>
                </div>
                <span className="text-sm font-semibold text-ink tabular-nums">{formatVND(p.price)}</span>
              </article>
            ))}
          </>
        )}

        {tab === 3 && (
          <>
            <SuggestNote className="mb-1">Recipe builder mở full-screen flow khi build thật</SuggestNote>
            {INVENTORY_RECIPES.map((r) => (
              <article key={r.product} className="rounded-lg bg-surface shadow-raised px-4 py-3">
                <div className="text-sm font-medium text-ink">{r.product}</div>
                <div className="text-xs text-muted mt-0.5">{r.lines}</div>
              </article>
            ))}
          </>
        )}

        {tab === 4 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-mint p-4">
                <div className="text-xs font-medium text-mint-ink">Nguyên liệu</div>
                <div className="font-display text-2xl font-bold text-mint-ink mt-1">
                  {INVENTORY_INGREDIENTS.length}
                </div>
              </div>
              <div className="rounded-2xl bg-blue p-4">
                <div className="text-xs font-medium text-blue-ink">Sắp hết / âm</div>
                <div className="font-display text-2xl font-bold text-blue-ink mt-1">
                  {INVENTORY_STOCK.filter((s) => s.low || s.qty < 0).length}
                </div>
              </div>
            </div>
            <div className="pt-2">
              <SectionLabel className="mb-2">Cần nhập sớm</SectionLabel>
              {INVENTORY_STOCK.filter((s) => s.low || s.qty < 0).map((s) => (
                <article key={s.name} className="rounded-lg bg-surface shadow-raised px-4 py-3 flex items-center gap-3 mb-2">
                  <span className="flex-1 text-sm text-ink truncate">{s.name}</span>
                  <span className="text-xs text-muted tabular-nums">
                    {s.qty.toLocaleString("vi-VN", { maximumFractionDigits: 1 })} {s.unit}
                  </span>
                </article>
              ))}
            </div>
          </>
        )}

        {tab !== 0 && tab !== 1 && tab !== 2 && tab !== 3 && tab !== 4 && (
          <EmptyState title="Chưa có dữ liệu" dashedBorder />
        )}
      </Reveal>
    </div>
  );
}
