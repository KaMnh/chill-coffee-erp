import { cn } from "@/lib/cn";

interface ListItemProps {
  avatar?: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function ListItem({ avatar, title, subtitle, action, onClick, className }: ListItemProps) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      onClick={onClick}
      type={onClick ? "button" : undefined}
      className={cn(
        "w-full flex items-center gap-3 py-3 px-2 border-b border-border last:border-b-0 transition-colors",
        onClick && "hover:bg-surface-muted text-left",
        className
      )}
    >
      {avatar && <div className="shrink-0">{avatar}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-ink truncate">{title}</div>
        {subtitle && <div className="text-xs text-muted truncate mt-0.5">{subtitle}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </Component>
  );
}
