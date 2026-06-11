"use client";

import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { Avatar } from "@/components/ui/avatar";
import { Reveal } from "@/components/ui/reveal";
import type { ViewKey } from "@/features/navigation/navigation";
import { Sheet } from "./sheet";
import { DRAWER_BY_ROLE } from "./mobile-nav";
import { ACCOUNT_BY_ROLE, ROLE_LABEL, type PreviewRole } from "../_mock/data";

interface MoreDrawerProps {
  open: boolean;
  onClose(): void;
  role: PreviewRole;
  active: ViewKey;
  onSelect(view: ViewKey): void;
  onLogout(): void;
  /** View đang có cảnh báo → chấm đỏ cạnh label. */
  alertOn?: ViewKey | null;
}

/**
 * Drawer "Thêm" — bottom sheet chứa các đích ngoài 4 tab chính,
 * nhóm theo NAV_GROUPS của desktop sidebar. Hàng 48px, chevron phải.
 */
export function MoreDrawer({ open, onClose, role, active, onSelect, onLogout, alertOn }: MoreDrawerProps) {
  const groups = DRAWER_BY_ROLE[role];
  const account = ACCOUNT_BY_ROLE[role];

  return (
    <Sheet open={open} onClose={onClose} title="Tất cả chức năng">
      <Reveal stagger className="space-y-4 pb-1">
        {groups.map((group) => (
          <div key={group.label}>
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
                      onClose();
                    }}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "w-full h-12 px-3 flex items-center gap-3 text-left text-sm transition-colors",
                      i > 0 && "border-t border-border",
                      isActive ? "bg-ink text-white" : "bg-surface text-ink hover:bg-surface-muted"
                    )}
                  >
                    <Icon name={item.icon} size={20} className={isActive ? "text-white" : "text-muted"} />
                    <span className="flex-1 font-medium inline-flex items-center gap-2">
                      {item.label}
                      {alertOn === item.key && (
                        <span className="w-2 h-2 rounded-full bg-danger" aria-label="Có cảnh báo" />
                      )}
                    </span>
                    <Icon name="chevronRight" size={16} className={isActive ? "text-white/60" : "text-muted/50"} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Hàng tài khoản + đăng xuất */}
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="h-14 px-3 flex items-center gap-3 bg-surface-muted/60">
            <Avatar size="sm" initials={account.initials} alt={account.name} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-ink truncate">{account.name}</div>
              <div className="text-xs text-muted">{ROLE_LABEL[role]}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              onLogout();
            }}
            className="w-full h-12 px-3 flex items-center gap-3 border-t border-border text-sm text-danger hover:bg-danger-soft/40"
          >
            <Icon name="logOut" size={20} />
            <span className="font-medium">Đăng xuất</span>
          </button>
        </div>
      </Reveal>
    </Sheet>
  );
}
