"use client";

import { forwardRef, useId, useRef } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export interface FileUploadFieldProps {
  label?: string;
  helper?: string;
  error?: string;
  accept: string;
  disabled?: boolean;
  onSelect: (file: File) => void;
  selectedFileName?: string | null;
  onClear?: () => void;
  buttonLabel?: string;
}

/**
 * Phase 2 primitive — first file-input primitive in v4.
 *
 * Renders: label (optional) + hidden <input type="file"> + visible "Chọn file"
 * button + selected file name + clear button. Does NOT trigger upload — the
 * parent owns the mutation. Single-file only (multi-file = parent uses an
 * array of these or composes a list).
 */
export const FileUploadField = forwardRef<HTMLInputElement, FileUploadFieldProps>(
  function FileUploadField(
    { label, helper, error, accept, disabled, onSelect, selectedFileName, onClear, buttonLabel = "Chọn file" },
    ref
  ) {
    const autoId = useId();
    const inputId = `file-${autoId}`;
    const helperId = `${inputId}-helper`;
    const inputRef = useRef<HTMLInputElement>(null);

    function handlePick() {
      inputRef.current?.click();
    }

    function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
      const file = event.target.files?.[0];
      if (file) onSelect(file);
      // Reset value so the same file can be re-picked after clear.
      event.target.value = "";
    }

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-ink-2">
            {label}
          </label>
        )}
        <input
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          id={inputId}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={handleChange}
          aria-describedby={(helper || error) ? helperId : undefined}
          className="sr-only"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePick}
            disabled={disabled}
            className={cn(
              "inline-flex items-center gap-2 h-10 px-4 rounded-full border border-border bg-surface text-sm text-ink transition-colors",
              "hover:bg-surface-muted focus-visible:outline-none focus-visible:border-2 focus-visible:border-border-strong",
              "disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <Icon name="upload" size={16} />
            {buttonLabel}
          </button>
          {selectedFileName && (
            <>
              <span className="text-sm text-ink-2 truncate max-w-[16rem]" title={selectedFileName}>
                {selectedFileName}
              </span>
              {onClear && (
                <button
                  type="button"
                  onClick={onClear}
                  disabled={disabled}
                  aria-label="Bỏ chọn"
                  className="h-6 w-6 inline-flex items-center justify-center rounded-full hover:bg-surface-muted disabled:opacity-40"
                >
                  <Icon name="x" size={16} />
                </button>
              )}
            </>
          )}
        </div>
        {(helper || error) && (
          <span id={helperId} className={cn("text-xs", error ? "text-danger" : "text-muted")}>
            {error ?? helper}
          </span>
        )}
      </div>
    );
  }
);
