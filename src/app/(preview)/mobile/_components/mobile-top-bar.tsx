"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import { ACCOUNT_BY_ROLE, ROLE_LABEL, type PreviewRole } from "../_mock/data";

interface MobileTopBarProps {
  title: string;
  role: PreviewRole;
  onLogout(): void;
}

/**
 * Top app bar gọn cho mobile: tiêu đề ngữ cảnh + chọn ngày + sync + avatar.
 * Logout gộp vào menu avatar (không còn nút logout riêng như desktop TopBar).
 * Search desktop bỏ hẳn trên mobile — tìm kiếm nằm trong từng view cần nó.
 */
export function MobileTopBar({ title, role, onLogout }: MobileTopBarProps) {
  const [date, setDate] = useState("2026-06-11");
  const [menuOpen, setMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const account = ACCOUNT_BY_ROLE[role];

  // Đóng menu khi chạm ra ngoài.
  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

  // Title đổi → fade-slide nhẹ (transform + autoAlpha, tôn trọng reduced-motion).
  const titleRef = useRef<HTMLHeadingElement>(null);
  useGSAP(
    () => {
      if (prefersReducedMotion() || !titleRef.current) return;
      gsap.fromTo(titleRef.current, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: DUR.fast });
    },
    { dependencies: [title], scope: rootRef }
  );

  function fakeSync() {
    setSyncing(true);
    setTimeout(() => setSyncing(false), 1200);
  }

  return (
    <div
      ref={rootRef}
      className="relative shrink-0 z-30 bg-surface/90 backdrop-blur border-b border-border"
      style={{ paddingTop: "var(--pv-safe-top)" }}
    >
      <div className="flex items-center gap-2 px-4 h-14">
        <h1 ref={titleRef} className="flex-1 min-w-0 font-display text-lg font-bold text-ink truncate">
          {title}
        </h1>

        {/* Chọn ngày — input date thật, label gọn dd/MM */}
        <label className="relative inline-flex">
          <span className="sr-only">Ngày kinh doanh</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="peer absolute inset-0 opacity-0 w-full h-full cursor-pointer"
            aria-label="Ngày kinh doanh"
          />
          <span className="pointer-events-none inline-flex items-center gap-1 h-11 px-3 rounded-full border border-border bg-surface text-sm text-ink peer-focus-visible:ring-2 peer-focus-visible:ring-border-strong">
            <Icon name="clock" size={16} />
            {date.slice(8, 10)}/{date.slice(5, 7)}
          </span>
        </label>

        <button
          type="button"
          onClick={fakeSync}
          aria-label={syncing ? "Đang sync POS" : "Đồng bộ POS"}
          className="w-11 h-11 rounded-full border border-border bg-surface flex items-center justify-center text-ink hover:bg-surface-muted"
        >
          <Icon name="refreshCw" size={20} className={cn(syncing && "animate-spin")} />
        </button>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          // Chứa visible text (initials) trong accessible name — axe label-content-name-mismatch.
          aria-label={`${account.initials} — tài khoản ${account.name}`}
          aria-expanded={menuOpen}
          className="w-11 h-11 rounded-full flex items-center justify-center"
        >
          <Avatar size="md" initials={account.initials} alt={account.name} />
        </button>
      </div>

      {/* Menu avatar: tên + role + Đăng xuất */}
      {menuOpen && (
        <div className="absolute right-3 top-[calc(var(--pv-safe-top)+3.25rem)] w-56 rounded-lg bg-surface shadow-popover border border-border p-2 z-40">
          <div className="px-3 py-2">
            <div className="text-sm font-medium text-ink truncate">{account.name}</div>
            <Badge variant="soft" semantic="neutral" className="mt-1">
              {ROLE_LABEL[role]}
            </Badge>
          </div>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onLogout();
            }}
            className="w-full h-11 px-3 rounded-md flex items-center gap-2 text-sm text-danger hover:bg-danger-soft/50"
          >
            <Icon name="logOut" size={16} />
            Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}
