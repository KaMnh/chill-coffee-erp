import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  dashedBorder?: boolean;
  className?: string;
}

export function EmptyState({
  icon = "info",
  title,
  subtitle,
  action,
  dashedBorder,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center p-12 rounded-lg",
        dashedBorder && "border-2 border-dashed border-border",
        className
      )}
    >
      <Icon name={icon} size={24} className="text-muted mb-3" />
      <div className="text-base font-medium text-ink">{title}</div>
      {subtitle && <div className="mt-1 text-sm text-muted max-w-sm">{subtitle}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
