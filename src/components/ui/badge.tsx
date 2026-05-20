import { cn } from "@/lib/cn";

export type BadgeVariant = "solid" | "soft" | "count";
export type BadgeSemantic = "neutral" | "success" | "warning" | "danger";

interface BadgeProps {
  variant?: BadgeVariant;
  semantic?: BadgeSemantic;
  withDot?: boolean;
  children?: React.ReactNode;
  className?: string;
}

const solidClass: Record<BadgeSemantic, string> = {
  neutral: "bg-ink text-white",
  success: "bg-success text-white",
  warning: "bg-warning text-white",
  danger: "bg-danger text-white",
};

const softClass: Record<BadgeSemantic, string> = {
  neutral: "bg-surface-muted text-ink-2",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  variant = "solid",
  semantic = "neutral",
  withDot,
  children,
  className,
}: BadgeProps) {
  if (variant === "count") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-xs font-medium bg-ink text-white",
          className
        )}
      >
        {children}
      </span>
    );
  }
  const classes = variant === "solid" ? solidClass[semantic] : softClass[semantic];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        classes,
        className
      )}
    >
      {withDot && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}
