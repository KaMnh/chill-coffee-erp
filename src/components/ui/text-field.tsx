"use client";

import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, helper, error, id, className, disabled, ...rest },
  ref
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const helperId = `${inputId}-helper`;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-ink-2">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={(helper || error) ? helperId : undefined}
        className={cn(
          "h-10 px-3 rounded-sm bg-surface border text-sm text-ink placeholder:text-muted transition-colors",
          "focus-visible:outline-none focus-visible:border-2",
          error
            ? "border-danger focus-visible:border-danger"
            : "border-border focus-visible:border-border-strong",
          disabled && "bg-surface-muted text-muted cursor-not-allowed",
          className
        )}
        {...rest}
      />
      {(helper || error) && (
        <span
          id={helperId}
          className={cn("text-xs", error ? "text-danger" : "text-muted")}
        >
          {error ?? helper}
        </span>
      )}
    </div>
  );
});
