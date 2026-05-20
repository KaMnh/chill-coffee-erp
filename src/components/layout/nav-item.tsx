"use client";

import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icons";

interface NavItemProps {
  icon?: IconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
  href?: string;
  className?: string;
}

export function NavItem({ icon, label, active, onClick, href, className }: NavItemProps) {
  const Component = href ? "a" : "button";
  return (
    <Component
      onClick={onClick}
      href={href}
      type={href ? undefined : "button"}
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        active
          ? "rounded-full bg-ink text-white"
          : "rounded-md text-ink-2 hover:bg-surface-muted hover:text-ink",
        className
      )}
    >
      {icon && <Icon name={icon} size={20} />}
      <span>{label}</span>
    </Component>
  );
}
