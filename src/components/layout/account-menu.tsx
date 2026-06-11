"use client";

import * as RadixDropdown from "@radix-ui/react-dropdown-menu";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";

interface AccountMenuProps {
  name: string;
  roleLabel: string;
  onSignOut(): void;
}

/**
 * Menu avatar trên top bar: tên + role + Đăng xuất. Trên mobile đây là
 * đường logout duy nhất ở top bar (nút logout rời chỉ hiện ≥md) —
 * spec 2026-06-11-mobile-uiux-design §1 "logout gộp vào menu avatar".
 */
export function AccountMenu({ name, roleLabel, onSignOut }: AccountMenuProps) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>
        <button
          type="button"
          aria-label={`${initials} — tài khoản ${name}`}
          className="w-10 h-10 rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong"
        >
          <Avatar size="md" initials={initials} alt={name} />
        </button>
      </RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align="end"
          sideOffset={8}
          className="z-50 w-56 rounded-lg bg-surface shadow-popover border border-border p-2 data-[state=open]:animate-in data-[state=closed]:animate-out"
        >
          <div className="px-3 py-2">
            <div className="text-sm font-medium text-ink truncate">{name}</div>
            <Badge variant="soft" semantic="neutral" className="mt-1">{roleLabel}</Badge>
          </div>
          <RadixDropdown.Separator className="h-px bg-border my-1" />
          <RadixDropdown.Item
            onSelect={onSignOut}
            className="h-11 px-3 rounded-md flex items-center gap-2 text-sm text-danger cursor-pointer outline-none data-[highlighted]:bg-danger-soft/50"
          >
            <Icon name="logOut" size={16} />
            Đăng xuất
          </RadixDropdown.Item>
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  );
}
