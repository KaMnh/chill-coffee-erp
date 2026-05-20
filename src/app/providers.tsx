"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { ToastProvider } from "@/components/ui/toast";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1
          }
        }
      })
  );
  return (
    <QueryClientProvider client={client}>
      <RadixTooltip.Provider>
        <ToastProvider>{children}</ToastProvider>
      </RadixTooltip.Provider>
    </QueryClientProvider>
  );
}
