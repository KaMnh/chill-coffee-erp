"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useSupabase } from "@/hooks/use-supabase";
import { useAuthSession } from "@/hooks/use-auth-session";
import { useBusinessDate } from "@/hooks/use-business-date";
import { useRoleGate } from "@/hooks/use-role-gate";
import { useAppSettingsQuery, useDashboardQuery } from "@/hooks/queries";
import { usePosSync } from "@/hooks/use-pos-sync";
import { useRealtimeInvalidate } from "@/hooks/use-realtime-invalidate";
import { useAuthCookieSync } from "@/hooks/use-auth-cookie-sync";
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
import { EmptyState } from "@/components/ui/empty-state";
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
  useRealtimeInvalidate(supabase, businessDate);
  useAuthCookieSync(supabase);

  const [view, setView] = useState<ViewKey>("dashboard");
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
                className="h-10 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
                aria-label="Ngày kinh doanh"
              />
              <IconButton
                icon="refreshCw"
                size={40}
                variant="secondary"
                aria-label={posSync.isPending ? "Đang sync POS" : "Đồng bộ POS"}
                onClick={handlePosSync}
                disabled={posSync.isPending}
              />
              <Avatar
                size="md"
                initials={employeeName.slice(0, 2).toUpperCase()}
                alt={`${employeeName} (${ROLE_LABELS[account.role]})`}
              />
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
            onGoReports={() => setView("reports")}
          />
        )}
        {view === "reports" && <ReportsView businessDate={businessDate} />}
        {view === "pivot" && <PivotView businessDate={businessDate} />}
        {/* 3B/3C views — expenses now live; shifts + cash still locked. */}
        {view === "expenses" && (
          <ExpensesView businessDate={businessDate} role={account.role} />
        )}
        {(view === "shifts" || view === "cash") && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3B.2"
            subtitle="Ca & lương / Chốt két sẽ port ở phase tới."
          />
        )}
        {(view === "safe" || view === "settings") && (
          <EmptyState
            icon="lock"
            title="Module này sẵn sàng ở Phase 3C"
            subtitle="Sổ quỹ / Thiết lập là module owner-only, sẽ vào Phase 3C."
          />
        )}
      </div>
    </AppShell>
  );
}
