"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";
import type { ButtonVariant } from "./button";

export type IconButtonSize = 32 | 40 | 48;

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: IconName;
  size?: IconButtonSize;
  variant?: ButtonVariant;
  "aria-label": string; // bắt buộc cho a11y
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2",
  secondary: "border border-border text-ink hover:bg-surface-muted",
  destructive: "bg-danger text-white hover:bg-danger/90",
  ghost: "text-ink hover:bg-surface-muted",
};

const iconSize: Record<IconButtonSize, 16 | 20 | 24> = {
  32: 16,
  40: 20,
  48: 24,
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = 40, variant = "primary", className, disabled, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      disabled={disabled}
      style={{ width: size, height: size }}
      className={cn(
        "inline-flex items-center justify-center rounded-full transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        variantClass[variant],
        className
      )}
      {...rest}
    >
      <Icon name={icon} size={iconSize[size]} />
    </button>
  );
});
