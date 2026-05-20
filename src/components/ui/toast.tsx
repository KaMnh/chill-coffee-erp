"use client";

import * as RadixToast from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "./icons";

type ToastSemantic = "info" | "success" | "warning" | "danger";

interface ToastItem {
  id: string;
  title?: string;
  message: string;
  semantic: ToastSemantic;
}

interface ToastContextValue {
  toast: (input: Omit<ToastItem, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const semanticIcon: Record<ToastSemantic, IconName> = {
  info: "info",
  success: "checkCircle",
  warning: "alertTriangle",
  danger: "alertCircle",
};

const semanticColor: Record<ToastSemantic, string> = {
  info: "text-blue-ink",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((input: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((t) => [...t, { id, ...input }]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      <RadixToast.Provider swipeDirection="right" duration={4000}>
        {children}
        {toasts.map((t) => (
          <RadixToast.Root
            key={t.id}
            onOpenChange={(open) => {
              if (!open) setToasts((curr) => curr.filter((x) => x.id !== t.id));
            }}
            className={cn(
              "bg-surface rounded-md shadow-popover px-4 py-3 flex items-start gap-3 toast-enter transition-transform",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
              "data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[calc(100%+1rem)] data-[swipe=end]:duration-100"
            )}
          >
            <Icon name={semanticIcon[t.semantic]} size={20} className={cn("shrink-0 mt-0.5", semanticColor[t.semantic])} />
            <div className="flex-1 min-w-0">
              {t.title && <RadixToast.Title className="text-sm font-semibold text-ink">{t.title}</RadixToast.Title>}
              <RadixToast.Description className="text-sm text-ink-2">{t.message}</RadixToast.Description>
            </div>
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2 w-96 max-w-[calc(100vw-2rem)] z-50 outline-none" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  );
}
