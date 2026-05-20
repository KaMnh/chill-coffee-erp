"use client";

import { forwardRef, useId, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helper?: string;
  error?: string;
}

/**
 * Textarea primitive — mirrors TextField API (label, helper, error + standard
 * HTML textarea props). Used in shifts (check-out note, payroll-edit note),
 * 3B.2b cash (note), 3C handover (note). API mirror of TextField means
 * caller learning curve = 0.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
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
      <textarea
        ref={ref}
        id={inputId}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={(helper || error) ? helperId : undefined}
        className={cn(
          "rounded-sm bg-surface border px-3 py-2 text-sm text-ink placeholder:text-muted transition-colors",
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
        <span id={helperId} className={cn("text-xs", error ? "text-danger" : "text-muted")}>
          {error ?? helper}
        </span>
      )}
    </div>
  );
});
