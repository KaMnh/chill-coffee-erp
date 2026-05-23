import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

export type PastelColor = "peach" | "blue" | "mint" | "lilac";

interface StatCardProps {
  color: PastelColor;
  title: string;
  subtitle?: string;
  value: string | number;
  onAction?: () => void;
  actionAriaLabel?: string;
  className?: string;
}

const colorBg: Record<PastelColor, string> = {
  peach: "bg-peach",
  blue: "bg-blue",
  mint: "bg-mint",
  lilac: "bg-lilac",
};

const colorInk: Record<PastelColor, string> = {
  peach: "text-peach-ink",
  blue: "text-blue-ink",
  mint: "text-mint-ink",
  lilac: "text-lilac-ink",
};

export function StatCard({
  color,
  title,
  subtitle,
  value,
  onAction,
  actionAriaLabel = "Xem chi tiết",
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        "relative rounded-2xl p-4 sm:p-6 min-h-[110px] sm:min-h-[180px] flex flex-col justify-between overflow-hidden",
        colorBg[color],
        className
      )}
    >
      <div>
        <div className={cn("text-sm font-medium", colorInk[color])}>{title}</div>
        {subtitle && <div className={cn("text-xs mt-1 opacity-80", colorInk[color])}>{subtitle}</div>}
      </div>
      <div className="flex items-end justify-between gap-4">
        <div className={cn("font-display text-2xl sm:text-4xl font-bold tabular-nums", colorInk[color])}>{value}</div>
        {onAction && (
          <IconButton
            icon="arrowUpRight"
            size={40}
            variant="primary"
            onClick={onAction}
            aria-label={actionAriaLabel}
          />
        )}
      </div>
    </div>
  );
}
