import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";
import type { PastelColor } from "./stat-card";

interface InsightCardProps {
  icon: IconName;
  iconColor?: PastelColor;
  title: string;
  description: string;
  detailsHref?: string;
  detailsLabel?: string;
  className?: string;
}

const iconBg: Record<PastelColor, string> = {
  peach: "bg-peach text-peach-ink",
  blue: "bg-blue text-blue-ink",
  mint: "bg-mint text-mint-ink",
  lilac: "bg-lilac text-lilac-ink",
};

export function InsightCard({
  icon,
  iconColor = "blue",
  title,
  description,
  detailsHref,
  detailsLabel = "Xem chi tiết",
  className,
}: InsightCardProps) {
  return (
    <div className={cn("bg-surface rounded-2xl p-5", className)}>
      <div className="flex items-center gap-3">
        <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", iconBg[iconColor])}>
          <Icon name={icon} size={20} />
        </div>
        <h4 className="text-sm font-medium text-ink">{title}</h4>
      </div>
      <p className="mt-3 text-xs text-muted leading-relaxed">{description}</p>
      {detailsHref && (
        <a
          href={detailsHref}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-ink hover:underline"
        >
          {detailsLabel}
          <Icon name="arrowRight" size={16} />
        </a>
      )}
    </div>
  );
}
