"use client";

import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";
import { IconButton } from "./icon-button";

export type AlertVariant = "info" | "success" | "warning" | "danger";

interface AlertBannerProps {
  variant?: AlertVariant;
  title?: string;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

const variantClass: Record<AlertVariant, { bg: string; text: string; icon: IconName }> = {
  info: { bg: "bg-blue", text: "text-blue-ink", icon: "info" },
  success: { bg: "bg-success-soft", text: "text-success", icon: "checkCircle" },
  warning: { bg: "bg-warning-soft", text: "text-warning", icon: "alertTriangle" },
  danger: { bg: "bg-danger-soft", text: "text-danger", icon: "alertCircle" },
};

// danger/warning = alert (assertive), info/success = status (polite). A11y cho screen reader.
const variantRole: Record<AlertVariant, "alert" | "status"> = {
  info: "status",
  success: "status",
  warning: "alert",
  danger: "alert",
};

export function AlertBanner({
  variant = "info",
  title,
  children,
  onClose,
  className,
}: AlertBannerProps) {
  const v = variantClass[variant];
  return (
    <div role={variantRole[variant]} className={cn("flex items-start gap-3 rounded-md px-4 py-3", v.bg, className)}>
      <Icon name={v.icon} size={20} className={cn("shrink-0 mt-0.5", v.text)} />
      <div className={cn("flex-1 text-sm", v.text)}>
        {title && <span className="font-semibold">{title} </span>}
        {children}
      </div>
      {onClose && (
        <IconButton
          icon="x"
          size={32}
          variant="ghost"
          onClick={onClose}
          aria-label="Đóng"
          className={cn(v.text, "hover:bg-black/5")}
        />
      )}
    </div>
  );
}
