"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { NavGroupWithItems, ViewKey } from "@/features/navigation/navigation";

interface MobileMoreDrawerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  groups: ReadonlyArray<NavGroupWithItems>;
  active: ViewKey;
  onSelect(view: ViewKey): void;
  accountName: string;
  roleLabel: string;
  onSignOut(): void;
  /** Mở sheet "Tuỳ chỉnh tab" (đổi 4 đích bottom bar). */
  onCustomize?(): void;
}

/**
 * Drawer "Thêm" — bottom sheet (Radix Dialog, mobile <md) chứa các đích
 * ngoài 4 tab chính, nhóm theo NAV_GROUPS như sidebar desktop. Hàng 48px,
 * cuối sheet là hàng tài khoản + Đăng xuất (logout gộp khỏi top bar).
 * Animation: tailwind animate-in/out slide-in-from-bottom — cùng cơ chế
 * data-state với drawer hamburger hiện có trong AppShell.
 */
export function MobileMoreDrawer({
  open,
  onOpenChange,
  groups,
  active,
  onSelect,
  accountName,
  roleLabel,
  onSignOut,
  onCustomize,
}: MobileMoreDrawerProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 md:hidden",
            "bg-surface rounded-t-2xl shadow-modal max-h-[85dvh] overflow-y-auto",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom"
          )}
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {/* Tay cầm + header */}
          <div className="pt-2.5 pb-1.5" aria-hidden>
            <div className="mx-auto w-10 h-1.5 rounded-full bg-border" />
          </div>
          <div className="px-5 pb-2 flex items-center justify-between gap-3">
            <RadixDialog.Title className="font-display text-lg font-bold text-ink">
              Tất cả chức năng
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Đóng"
                className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted hover:bg-surface-muted"
              >
                <Icon name="x" size={20} />
              </button>
            </RadixDialog.Close>
          </div>

          <div className="px-5 space-y-4">
            {groups.map((group) => (
              <div key={group.key}>
                <div className="text-xs font-medium uppercase tracking-wide text-muted px-1 mb-1">
                  {group.label}
                </div>
                <div className="rounded-lg border border-border overflow-hidden">
                  {group.items.map((item, i) => {
                    const isActive = item.key === active;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          onSelect(item.key);
                          onOpenChange(false);
                        }}
                        aria-current={isActive ? "page" : undefined}
                        className={cn(
                          "w-full h-12 px-3 flex items-center gap-3 text-left text-sm transition-colors",
                          i > 0 && "border-t border-border",
                          isActive ? "bg-ink text-white" : "bg-surface text-ink hover:bg-surface-muted"
                        )}
                      >
                        <Icon name={item.icon} size={20} className={isActive ? "text-white" : "text-muted"} />
                        <span className="flex-1 font-medium">{item.label}</span>
                        <Icon name="chevronRight" size={16} className={isActive ? "text-white/60" : "text-muted/50"} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Tuỳ chỉnh tab bottom bar */}
            {onCustomize && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onCustomize();
                }}
                className="w-full h-12 px-3 rounded-lg border border-dashed border-border flex items-center gap-3 text-left text-sm text-ink-2 hover:bg-surface-muted"
              >
                <Icon name="pencil" size={20} className="text-muted" />
                <span className="flex-1 font-medium">Tuỳ chỉnh tab thanh dưới</span>
                <Icon name="chevronRight" size={16} className="text-muted/50" />
              </button>
            )}

            {/* Tài khoản + đăng xuất */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="h-14 px-3 flex items-center gap-3 bg-surface-muted/60">
                <Avatar size="sm" initials={accountName.slice(0, 2).toUpperCase()} alt={accountName} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{accountName}</div>
                  <Badge variant="soft" semantic="neutral">{roleLabel}</Badge>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onSignOut();
                }}
                className="w-full h-12 px-3 flex items-center gap-3 border-t border-border text-sm text-danger hover:bg-danger-soft/40"
              >
                <Icon name="logOut" size={20} />
                <span className="font-medium">Đăng xuất</span>
              </button>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
