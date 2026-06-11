"use client";

import { useEffect, useRef, useState } from "react";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import type { ViewKey } from "@/features/navigation/navigation";
import { MobileTopBar } from "./mobile-top-bar";
import { BottomTabBar } from "./bottom-tab-bar";
import { MoreDrawer } from "./more-drawer";
import { VIEW_TITLES, TABS_BY_ROLE, visibleViews } from "./mobile-nav";
import { usePreview } from "./bits";
import { MobileLoginView } from "./views/login-view";
import { MobileHomeView } from "./views/home-view";
import { MobileCashView } from "./views/cash-view";
import { MobileExpensesView } from "./views/expenses-view";
import { MobileHandoverView } from "./views/handover-view";
import { MobileShiftsView } from "./views/shifts-view";
import { MobileSafeView } from "./views/safe-view";
import { MobileInventoryView } from "./views/inventory-view";
import { MobileReportsView } from "./views/reports-view";
import { MobilePivotView } from "./views/pivot-view";
import { MobileCashflowView } from "./views/cashflow-view";
import { MobileSettingsView } from "./views/settings-view";

/**
 * "App" chạy trong PhoneFrame: login ↔ app, top bar ngữ cảnh,
 * vùng cuộn chính, bottom tab bar + drawer "Thêm".
 * View-switcher đúng mô hình SPA của src/app/page.tsx (không route thật).
 */
export function MobileApp() {
  const { role, scenario } = usePreview();
  const [screen, setScreen] = useState<"login" | "app">("app");
  const [view, setView] = useState<ViewKey>("dashboard");
  const [moreOpen, setMoreOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Đổi role → nếu view hiện tại không thuộc role thì snap về dashboard
  // (mirror hành vi useRoleGate của app thật).
  useEffect(() => {
    if (!visibleViews(role).includes(view)) setView("dashboard");
  }, [role, view]);

  // Đổi view → cuộn về đầu + fade-rise nhẹ vùng nội dung.
  useGSAP(
    () => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: 0 });
      if (prefersReducedMotion()) return;
      gsap.fromTo(el, { autoAlpha: 0.4, y: 10 }, { autoAlpha: 1, y: 0, duration: DUR.fast });
    },
    { dependencies: [view, screen], scope: scrollRef }
  );

  function go(next: ViewKey) {
    setMoreOpen(false);
    setView(next);
  }

  if (screen === "login") {
    return <MobileLoginView onLogin={() => { setScreen("app"); setView("dashboard"); }} />;
  }

  const warnHandover = scenario === "warn" && TABS_BY_ROLE[role].some((t) => t.key === "handover");

  return (
    <div className="flex flex-col h-full">
      <MobileTopBar title={VIEW_TITLES[view]} role={role} onLogout={() => setScreen("login")} />

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain min-h-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {view === "dashboard" && <MobileHomeView onNavigate={go} />}
        {view === "cash" && <MobileCashView />}
        {view === "expenses" && <MobileExpensesView />}
        {view === "handover" && <MobileHandoverView />}
        {view === "shifts" && <MobileShiftsView />}
        {view === "safe" && <MobileSafeView />}
        {view === "inventory" && <MobileInventoryView />}
        {view === "reports" && <MobileReportsView />}
        {view === "pivot" && <MobilePivotView />}
        {view === "cashflow" && <MobileCashflowView />}
        {view === "settings" && <MobileSettingsView />}
      </div>

      <BottomTabBar
        role={role}
        active={view}
        onSelect={go}
        onMore={() => setMoreOpen(true)}
        moreOpen={moreOpen}
        alertOn={warnHandover ? "handover" : null}
      />

      <MoreDrawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        role={role}
        active={view}
        onSelect={go}
        onLogout={() => setScreen("login")}
      />
    </div>
  );
}
