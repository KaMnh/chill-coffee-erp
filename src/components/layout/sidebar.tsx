import Image from "next/image";
import { cn } from "@/lib/cn";

interface SidebarProps {
  children: React.ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  return (
    <nav className={cn("flex flex-col gap-1 p-4", className)}>{children}</nav>
  );
}

export function SidebarSection({
  label,
  children,
}: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 mt-4 first:mt-0">
      {label && (
        <div className="px-3 py-1 text-xs uppercase tracking-wider text-muted">
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

export function SidebarLogo({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-4">
      <Image
        src="/chill-logo.png"
        alt="Chill Coffee Garden"
        width={36}
        height={36}
        className="shrink-0"
        priority
      />
      <span className="font-display text-xl font-bold leading-tight">{children}</span>
    </div>
  );
}
