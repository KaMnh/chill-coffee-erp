"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  square?: boolean;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2 active:bg-ink/90",
  secondary: "border border-border text-ink hover:bg-surface-muted",
  destructive: "bg-danger text-white hover:bg-danger/90",
  ghost: "text-ink hover:bg-surface-muted",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, leadingIcon, trailingIcon, square, className, children, disabled, type = "button", ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-2",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        square ? "rounded-md" : "rounded-full",
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...rest}
    >
      {loading ? <Icon name="loader" size={16} className="animate-spin" /> : leadingIcon}
      {children && <span>{children}</span>}
      {trailingIcon}
    </button>
  );
});
