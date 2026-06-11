"use client";

import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import type { ViewKey } from "@/features/navigation/navigation";
import { TABS_BY_ROLE } from "./mobile-nav";
import type { PreviewRole } from "../_mock/data";

interface BottomTabBarProps {
  role: PreviewRole;
  active: ViewKey;
  /** View đang mở nằm trong drawer (không thuộc 4 tab) → highlight tab "Thêm". */
  onSelect(view: ViewKey): void;
  onMore(): void;
  moreOpen: boolean;
  /** Chấm cảnh báo trên tab (vd Bàn giao còn việc) — key của view. */
  alertOn?: ViewKey | null;
}

/**
 * Bottom tab bar — 4 đích role-aware + tab "Thêm" mở drawer.
 * Touch target ≥44px (cả hàng cao 56px + safe-area). Active = pill tối
 * theo design system (nav active = dark pill).
 */
export function BottomTabBar({ role, active, onSelect, onMore, moreOpen, alertOn }: BottomTabBarProps) {
  const tabs = TABS_BY_ROLE[role];
  const rootRef = useRef<HTMLElement>(null);
  const inTabs = tabs.some((t) => t.key === active);
  // View có cảnh báo nằm trong drawer → chấm đỏ dồn lên tab "Thêm".
  const alertOnMore = alertOn != null && !tabs.some((t) => t.key === alertOn);

  // Pop nhẹ pill active khi đổi tab.
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
      className="shrink-0 z-30 bg-surface border-t border-border"
      style={{ paddingBottom: "var(--pv-safe-bottom)" }}
    >
      <div className="grid grid-cols-5 h-14">
        {tabs.map((tab) => {
          const isActive = !moreOpen && tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onSelect(tab.key)}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-col items-center justify-center gap-0.5"
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
              <span className={cn("text-[10px] leading-none", isActive ? "font-semibold text-ink" : "text-muted")}>
                {tab.short}
              </span>
              {alertOn === tab.key && (
                <span className="absolute top-1.5 right-[calc(50%-1.4rem)] w-2 h-2 rounded-full bg-danger" aria-hidden />
              )}
            </button>
          );
        })}

        {/* Tab "Thêm" — mở drawer; active khi đang ở view ngoài 4 tab */}
        <button
          type="button"
          onClick={onMore}
          aria-expanded={moreOpen}
          aria-label="Mở menu Thêm"
          className="relative flex flex-col items-center justify-center gap-0.5"
        >
          <span
            data-active-pill={moreOpen || !inTabs ? "" : undefined}
            className={cn(
              "w-12 h-7 rounded-full flex items-center justify-center transition-colors",
              moreOpen || !inTabs ? "bg-ink text-white" : "text-muted"
            )}
          >
            <Icon name="menu" size={20} />
          </span>
          <span className={cn("text-[10px] leading-none", moreOpen || !inTabs ? "font-semibold text-ink" : "text-muted")}>
            Thêm
          </span>
          {alertOnMore && (
            <span className="absolute top-1.5 right-[calc(50%-1.4rem)] w-2 h-2 rounded-full bg-danger" aria-hidden />
          )}
        </button>
      </div>
    </nav>
  );
}
