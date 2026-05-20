"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./icon-button";

export const Modal = RadixDialog.Root;
export const ModalTrigger = RadixDialog.Trigger;

interface ModalContentProps extends React.ComponentPropsWithoutRef<typeof RadixDialog.Content> {
  showClose?: boolean;
}

export const ModalContent = forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  ModalContentProps
>(function ModalContent({ className, children, showClose = true, ...rest }, ref) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <RadixDialog.Content
        ref={ref}
        className={cn(
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
          "w-[min(90vw,28rem)] max-h-[85vh] overflow-auto",
          "bg-surface rounded-lg shadow-modal p-6",
          "focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out",
          className
        )}
        {...rest}
      >
        {children}
        {showClose && (
          <RadixDialog.Close asChild>
            <IconButton
              icon="x"
              size={32}
              variant="ghost"
              aria-label="Đóng"
              className="absolute right-4 top-4"
            />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
});

export const ModalTitle = forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(function ModalTitle({ className, ...rest }, ref) {
  return (
    <RadixDialog.Title
      ref={ref}
      className={cn("font-display text-xl font-bold text-ink", className)}
      {...rest}
    />
  );
});

export const ModalDescription = forwardRef<
  React.ElementRef<typeof RadixDialog.Description>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(function ModalDescription({ className, ...rest }, ref) {
  return (
    <RadixDialog.Description
      ref={ref}
      className={cn("mt-2 text-sm text-ink-2", className)}
      {...rest}
    />
  );
});

export function ModalActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mt-6 flex items-center justify-end gap-3", className)}>{children}</div>;
}

export const ModalClose = RadixDialog.Close;
