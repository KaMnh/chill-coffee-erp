"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useSupabase } from "@/hooks/use-supabase";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useBusinessDate } from "@/hooks/use-business-date";
import { useRoleGate } from "@/hooks/use-role-gate";
import { useAppSettingsQuery, useDashboardQuery } from "@/hooks/queries";
import { usePosSync } from "@/hooks/use-pos-sync";
import { useBackgroundPosSync } from "@/hooks/use-background-pos-sync";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useAuthCookieSync } from "@/hooks/use-auth-cookie-sync";
import { prefetchNav } from "@/lib/prefetch-nav";
import { AppShell } from "@/components/layout/app-shell";
import { Sidebar, SidebarSection, SidebarLogo } from "@/components/layout/sidebar";
import { NavItem } from "@/components/layout/nav-item";
import { TopBar } from "@/components/layout/top-bar";
import { IconButton } from "@/components/ui/icon-button";
import { Avatar } from "@/components/ui/avatar";
import { Spinner } from "@/components/ui/spinner";
import { DashboardView } from "@/features/dashboard/dashboard-view";
import { ExpensesView } from "@/features/expenses/expenses-view";
import { ReportsView } from "@/features/reports/reports-view";
import { PivotView } from "@/features/pivot/pivot-view";
import { CashFlowView } from "@/features/cashflow/cash-flow-view";
import { CashView } from "@/features/cash/cash-view";
import { SafeView } from "@/features/safe/safe-view";
import { HandoverView } from "@/features/handover/handover-view";
import { InventoryView } from "@/features/inventory/inventory-view";
import { SettingsView } from "@/features/settings/settings-view";
import { ShiftsView } from "@/features/shifts/shifts-view";
import { Card, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import type { ViewKey } from "@/features/navigation/navigation";
import { ROLE_LABELS } from "@/features/navigation/navigation";

export default function HomePage() {
  const router = useRouter();
  const supabase = useSupabase();
  const { toast } = useToast();
  const { status, account, isLoadingAccount, signOut } = useAuthSession();
  const { businessDate, setBusinessDate } = useBusinessDate();
  const appSettingsQuery = useAppSettingsQuery(supabase, status === "authed");
  const { visibleNav, defaultView, canSee } = useRoleGate(account, appSettingsQuery.data);
  const dashboardQuery = useDashboardQuery(supabase, businessDate, status === "authed");
  const posSync = usePosSync(supabase, businessDate, account, dashboardQuery.data?.latest_sync);
  useBackgroundPosSync(posSync, account?.role);
  useRealtimeInvalidate(supabase, businessDate);
  useAuthCookieSync(supabase);

  // Nav-hover prefetch: 200ms debounce per nav item; the timer is cancelled
  // if the cursor leaves before it fires (transient pass-through doesn't
  // trigger an RPC). prefetchNav internally defers to TanStack's per-query
  // staleTime — already-fresh data is a no-op.
  const queryClient = useQueryClient();
  const hoverTimersRef = useRef<Map<ViewKey, ReturnType<typeof setTimeout>>>(new Map());
  const HOVER_DEBOUNCE_MS = 200;

  const handleNavHover = useCallback(
    (key: ViewKey) => {
      const map = hoverTimersRef.current;
      const prev = map.get(key);
      if (prev) clearTimeout(prev);
      const id = setTimeout(() => {
        prefetchNav(key, queryClient, supabase, businessDate);
        map.delete(key);
      }, HOVER_DEBOUNCE_MS);
      map.set(key, id);
    },
    [queryClient, supabase, businessDate],
  );

  const handleNavHoverLeave = useCallback((key: ViewKey) => {
    const map = hoverTimersRef.current;
    const prev = map.get(key);
    if (prev) {
      clearTimeout(prev);
      map.delete(key);
    }
  }, []);

  // Cleanup hover timers on unmount so no late prefetch fires after navigation.
  useEffect(() => {
    const map = hoverTimersRef.current;
    return () => {
      map.forEach((id) => clearTimeout(id));
      map.clear();
    };
  }, []);

  const [view, setView] = useState<ViewKey>("dashboard");
  const [authHeader, setAuthHeader] = useState<string | null>(null);

  // Keep authHeader in sync with Supabase session for BackupRestoreSection.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setAuthHeader(data.session ? `Bearer ${data.session.access_token}` : null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthHeader(session ? `Bearer ${session.access_token}` : null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);
  // If role change hides current view, snap to first visible.
  useEffect(() => {
    if (status === "authed" && account && !canSee(view)) {
      setView(defaultView);
    }
  }, [account, canSee, defaultView, status, view]);

  // Redirect to login if no session after auth resolves.
  useEffect(() => {
    if (status === "unauthed") router.replace("/login");
  }, [router, status]);

  // Auth still resolving → spinner.
  if (status === "loading" || isLoadingAccount) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Spinner size={32} />
      </main>
    );
  }

  // Already redirecting; render nothing.
  if (status === "unauthed") return null;

  // Account exists but not active (pending_approval / disabled).
  if (!account || account.status !== "active") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardBody className="space-y-4 text-center">
            <Image
              src="/chill-logo.png"
              alt="Chill Coffee Garden"
              width={56}
              height={56}
              className="mx-auto rounded-2xl shadow-raised"
            />
            <h1 className="font-display text-xl text-ink">Tài khoản chờ duyệt</h1>
            <p className="text-sm text-muted">
              Bạn đã đăng nhập thành công, nhưng owner/manager chưa kích hoạt
              employee_accounts. Liên hệ quản lý quán.
            </p>
            <button
              type="button"
              className="text-sm text-ink underline-offset-4 hover:underline"
              onClick={signOut}
            >
              Đăng xuất
            </button>
          </CardBody>
        </Card>
      </main>
    );
  }

  function handleNavClick(next: ViewKey) {
    setView(next);
  }

  async function handlePosSync() {
    if (account?.role === "employee_viewer") {
      toast({ semantic: "info", message: "Viewer không sync POS." });
      return;
    }
    try {
      await posSync.mutateAsync({ force: true, reason: "manual_refresh" });
      toast({ semantic: "success", message: "Đã yêu cầu sync POS từ KiotViet." });
    } catch (err) {
      toast({
        semantic: "danger",
        message: err instanceof Error ? err.message : "Không gọi được sync.",
      });
    }
  }

  const employeeName = account.employee?.name ?? "Người dùng";

  return (
    <AppShell
      sidebar={
        <Sidebar>
          <SidebarLogo>Chill Coffee Garden</SidebarLogo>
          <SidebarSection label="Vận hành">
            {visibleNav.map((item) => (
              <NavItem
                key={item.key}
                icon={item.icon}
                label={item.label}
                active={view === item.key}
                onClick={() => handleNavClick(item.key)}
                onPointerEnter={() => handleNavHover(item.key)}
                onPointerLeave={() => handleNavHoverLeave(item.key)}
              />
            ))}
          </SidebarSection>
        </Sidebar>
      }
      topBar={
        <TopBar
          actions={
            <>
              <input
                type="date"
                value={businessDate}
                onChange={(e) => setBusinessDate(e.target.value)}
                className="h-10 rounded-md border border-border bg-surface px-2 sm:px-3 text-xs sm:text-sm text-ink w-[120px] sm:w-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                aria-label="Ngày kinh doanh"
              />
              <IconButton
                icon="refreshCw"
                size={40}
                variant="secondary"
                aria-label={posSync.isPending ? "Đang sync POS" : "Đồng bộ POS"}
                onClick={handlePosSync}
                disabled={posSync.isPending}
                className="hidden sm:inline-flex"
              />
              <span className="hidden sm:inline-flex">
                <Avatar
                  size="md"
                  initials={employeeName.slice(0, 2).toUpperCase()}
                  alt={`${employeeName} (${ROLE_LABELS[account.role]})`}
                />
              </span>
              <IconButton
                icon="logOut"
                size={40}
                variant="ghost"
                aria-label="Đăng xuất"
                onClick={signOut}
              />
            </>
          }
        />
      }
    >
      <div className="space-y-6">
        {view === "dashboard" && (
          <DashboardView
            businessDate={businessDate}
            onNavigate={setView}
            account={account}
          />
        )}
        {view === "reports" && <ReportsView businessDate={businessDate} />}
        {view === "pivot" && <PivotView businessDate={businessDate} />}
        {view === "cashflow" && <CashFlowView role={account.role} />}
        {/* 3B/3C views — expenses now live; shifts + cash still locked. */}
        {view === "expenses" && (
          <ExpensesView businessDate={businessDate} role={account.role} />
        )}
        {view === "shifts" && (
          <ShiftsView businessDate={businessDate} role={account.role} />
        )}
        {view === "cash" && (
          <CashView businessDate={businessDate} role={account.role} />
        )}
        {view === "safe" && (
          <SafeView businessDate={businessDate} role={account.role} />
        )}
        {view === "handover" && (
          <HandoverView businessDate={businessDate} role={account.role} />
        )}
        {view === "inventory" && <InventoryView role={account.role} />}
        {view === "settings" && <SettingsView role={account.role} authHeader={authHeader} />}
      </div>
    </AppShell>
  );
}
