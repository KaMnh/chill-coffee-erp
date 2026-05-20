import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";
import { Icon } from "./icons";

interface PromoCardProps {
  badge?: string;
  badgeIcon?: "sparkles";
  headline: string;
  description?: string;
  onAction?: () => void;
  actionAriaLabel?: string;
  className?: string;
}

export function PromoCard({
  badge = "PRO",
  badgeIcon = "sparkles",
  headline,
  description,
  onAction,
  actionAriaLabel = "Tìm hiểu thêm",
  className,
}: PromoCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl bg-gradient-to-br from-ink to-ink-2 text-white p-6 min-h-[180px] overflow-hidden",
        className
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
          <Icon name={badgeIcon} size={16} />
          {badge}
        </div>
        {onAction && (
          <IconButton
            icon="arrowUpRight"
            size={40}
            variant="ghost"
            className="bg-transparent border border-white/30 text-white hover:bg-white/10"
            onClick={onAction}
            aria-label={actionAriaLabel}
          />
        )}
      </div>
      <div className="mt-6">
        <div className="font-display text-2xl font-bold leading-tight">{headline}</div>
        {description && <div className="mt-2 text-sm text-white/70">{description}</div>}
      </div>
    </div>
  );
}
