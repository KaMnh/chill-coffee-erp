"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";

interface AppShellProps {
  sidebar: React.ReactNode;
  topBar: React.ReactNode;
  children: React.ReactNode;
  /** Bottom tab bar mobile (<md) — fixed đáy viewport, main tự chừa chỗ. */
  bottomNav?: React.ReactNode;
  className?: string;
}

/**
 * Responsive app shell.
 *
 * Desktop (≥1024px): sidebar docked left, topbar + main on the right.
 * Tablet (768–1024px): sidebar moves into a Radix Dialog drawer that
 * slides in from the left, triggered by a hamburger button in the topbar.
 * Mobile (<768px): hamburger ẩn — điều hướng bằng `bottomNav` (bottom tab
 * bar + drawer "Thêm", spec 2026-06-11-mobile-uiux-design).
 * The drawer auto-closes when a NavItem (any <button> or <a> inside it)
 * is tapped — implemented via event delegation so NavItem doesn't need
 * to know about the drawer.
 *
 * The `sidebar` ReactNode renders into either mount point depending on
 * viewport; HomePage's prop API is unchanged.
 */
export function AppShell({ sidebar, topBar, children, bottomNav, className }: AppShellProps) {
  const [open, setOpen] = useState(false);

  // Auto-close drawer when a nav button/link inside it is activated.
  function handleDrawerClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("button,a")) setOpen(false);
  }

  return (
    <div className={cn("min-h-screen p-4 md:p-6", className)}>
      {/* Main bento card chứa toàn bộ UI */}
      <div className="mx-auto max-w-[1500px] rounded-2xl bg-surface shadow-bento overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] min-h-[calc(100vh-3rem)]">
          {/* Sidebar — docked on desktop only */}
          <aside className="hidden lg:block border-r border-border">{sidebar}</aside>
          {/* Right column: topbar + content (min-w-0 lets wide tables scroll inside main) */}
          <div className="flex flex-col min-w-0">
            <div className="flex items-center border-b border-border">
              {/* Hamburger drawer — mobile/tablet only */}
              <RadixDialog.Root open={open} onOpenChange={setOpen}>
                <RadixDialog.Trigger asChild>
                  <IconButton
                    icon="menu"
                    variant="ghost"
                    size={40}
                    aria-label="Mở menu"
                    className="hidden md:inline-flex lg:hidden ml-2 shrink-0"
                  />
                </RadixDialog.Trigger>
                <RadixDialog.Portal>
                  <RadixDialog.Overlay
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 lg:hidden data-[state=open]:animate-in data-[state=closed]:animate-out"
                  />
                  <RadixDialog.Content
                    onClick={handleDrawerClick}
                    aria-label="Menu điều hướng"
                    className="fixed left-0 top-0 bottom-0 w-[280px] bg-surface z-50 overflow-y-auto lg:hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left"
                  >
                    <RadixDialog.Title className="sr-only">
                      Menu điều hướng
                    </RadixDialog.Title>
                    {sidebar}
                  </RadixDialog.Content>
                </RadixDialog.Portal>
              </RadixDialog.Root>
              <div className="flex-1 min-w-0">{topBar}</div>
            </div>
            {/* <md: pb chừa bottom tab bar fixed (h-14 + safe-area). */}
            <main className="flex-1 p-4 lg:p-6 overflow-auto pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:pb-4 lg:pb-6">
              {children}
            </main>
          </div>
        </div>
      </div>

      {bottomNav && (
        <div className="md:hidden fixed inset-x-0 bottom-0 z-40">{bottomNav}</div>
      )}
    </div>
  );
}
