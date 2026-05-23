"use client";

import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icons";

interface NavItemProps {
  icon?: IconName;
  label: string;
  active?: boolean;
  onClick?: () => void;
  /** Fires on pointer/touch hover — used for predictive query prefetch. */
  onPointerEnter?: () => void;
  /** Fires when the cursor leaves before the prefetch timer expires. */
  onPointerLeave?: () => void;
  href?: string;
  className?: string;
}

const baseClass =
  "flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors duration-200 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2";

const activeClass = "rounded-full bg-ink text-white";
const inactiveClass = "rounded-md text-ink-2 hover:bg-surface-muted hover:text-ink";

export function NavItem({
  icon,
  label,
  active,
  onClick,
  onPointerEnter,
  onPointerLeave,
  href,
  className,
}: NavItemProps) {
  const content = (
    <>
      {icon && <Icon name={icon} size={20} />}
      <span>{label}</span>
    </>
  );

  // Split element returns thay vì dynamic Component — TypeScript narrow đúng theo element,
  // aria attribute đúng per-branch (page vs pressed).
  if (href) {
    return (
      <a
        href={href}
        onClick={onClick}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        aria-current={active ? "page" : undefined}
        className={cn(baseClass, active ? activeClass : inactiveClass, className)}
      >
        {content}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      aria-pressed={active}
      className={cn(baseClass, active ? activeClass : inactiveClass, className)}
    >
      {content}
    </button>
  );
}
