"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import type { NavItem, ViewKey } from "@/features/navigation/navigation";

/** Label ngắn cho tab bar (label gốc như "Báo cáo chốt két" quá dài cho 5 cột). */
const SHORT_LABELS: Partial<Record<ViewKey, string>> = {
  dashboard: "Trang chủ",
  reports: "Báo cáo",
};

interface BottomTabBarProps {
  tabs: ReadonlyArray<NavItem>;
  active: ViewKey;
  onSelect(view: ViewKey): void;
  onMore(): void;
  moreOpen: boolean;
}

/**
 * Bottom tab bar mobile (<md) — 4 đích role-aware (getMobileTabs) + tab
 * "Thêm" mở drawer. Active = dark pill (convention nav active của design
 * system). Touch target ≥44px; chừa env(safe-area-inset-bottom) cho máy
 * tai thỏ. Desktop/tablet không render (AppShell gate bằng md:hidden).
 */
export function BottomTabBar({ tabs, active, onSelect, onMore, moreOpen }: BottomTabBarProps) {
  const rootRef = useRef<HTMLElement>(null);
  const inTabs = tabs.some((t) => t.key === active);
  const moreActive = moreOpen || !inTabs;

  // Pop nhẹ pill active khi đổi tab — transform only, tôn trọng reduced-motion.
  useGSAP(
    () => {
      if (prefersReducedMotion() || !rootRef.current) return;
      const pill = rootRef.current.querySelector("[data-active-pill]");
      if (pill) {
        gsap.fromTo(pill, { scale: 0.8 }, { scale: 1, duration: DUR.fast, ease: "back.out(2)" });
      }
    },
    { dependencies: [active, moreOpen], scope: rootRef }
  );

  return (
    <nav
      ref={rootRef}
      aria-label="Điều hướng chính"
      className="bg-surface border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div
        className="grid h-14"
        style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => {
          const isActive = !moreOpen && tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelect(tab.key)}
              aria-current={isActive ? "page" : undefined}
              className="flex flex-col items-center justify-center gap-0.5 min-w-0"
            >
              <span
                data-active-pill={isActive ? "" : undefined}
                className={cn(
                  "w-12 h-7 rounded-full flex items-center justify-center transition-colors",
                  isActive ? "bg-ink text-white" : "text-muted"
                )}
              >
                <Icon name={tab.icon} size={20} />
              </span>
              <span
                className={cn(
                  "text-[10px] leading-none truncate max-w-full px-0.5",
                  isActive ? "font-semibold text-ink" : "text-muted"
                )}
              >
                {SHORT_LABELS[tab.key] ?? tab.label}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={onMore}
          aria-expanded={moreOpen}
          aria-label="Mở menu Thêm"
          className="flex flex-col items-center justify-center gap-0.5 min-w-0"
        >
          <span
            data-active-pill={moreActive ? "" : undefined}
            className={cn(
              "w-12 h-7 rounded-full flex items-center justify-center transition-colors",
              moreActive ? "bg-ink text-white" : "text-muted"
            )}
          >
            <Icon name="menu" size={20} />
          </span>
          <span className={cn("text-[10px] leading-none", moreActive ? "font-semibold text-ink" : "text-muted")}>
            Thêm
          </span>
        </button>
      </div>
    </nav>
  );
}
