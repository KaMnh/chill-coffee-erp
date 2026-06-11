"use client";

import { createContext, useContext, useRef, useState, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Khung điện thoại ~390px cho preview.
 *
 * - ≥ md: bezel mô phỏng (viền tối, bo 3rem, status bar giả + home indicator),
 *   safe-area mô phỏng qua CSS var --pv-safe-top/bottom.
 * - < md (xem trên điện thoại thật): frame chiếm full viewport, safe-area
 *   lấy từ env(safe-area-inset-*) thật.
 *
 * Frame root là containing block (relative + overflow hidden) — mọi sheet/
 * drawer portal vào đây thay vì document.body để không thoát khỏi "máy".
 */

const PhonePortalContext = createContext<HTMLElement | null>(null);

/** Element của frame để portal sheet/drawer vào trong "máy". */
export function usePhonePortal() {
  return useContext(PhonePortalContext);
}

interface PhoneFrameProps {
  children: ReactNode;
  className?: string;
}

export function PhoneFrame({ children, className }: PhoneFrameProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  // Portal container chỉ có sau mount (ref null ở SSR) — setState 1 lần.
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalEl(innerRef.current);
  }, []);

  return (
    <div
      className={cn(
        // Mobile thật: cha (PreviewShell) là flex column 100dvh → frame flex-1.
        "relative mx-auto w-full flex-1 min-h-0 md:flex-none md:w-[390px] shrink-0",
        "md:rounded-[3rem] md:border-[10px] md:border-ink md:bg-ink md:shadow-bento",
        className
      )}
    >
      <div
        ref={innerRef}
        className={cn(
          "relative flex flex-col overflow-hidden bg-gradient-to-br from-bg-app-from to-bg-app-to",
          "h-full md:h-[780px] md:max-h-[calc(100vh-7rem)] md:rounded-[2.4rem]",
          // Safe-area: env() thật trên máy, mô phỏng trên desktop bezel.
          "[--pv-safe-top:env(safe-area-inset-top,0px)] md:[--pv-safe-top:44px]",
          "[--pv-safe-bottom:env(safe-area-inset-bottom,0px)] md:[--pv-safe-bottom:18px]"
        )}
      >
        {/* Status bar mô phỏng — chỉ hiện trong bezel desktop */}
        <div
          aria-hidden
          className="hidden md:flex absolute top-0 inset-x-0 h-[44px] items-center justify-between px-7 z-50 pointer-events-none text-ink"
        >
          <span className="text-[13px] font-semibold tracking-wide">9:41</span>
          <span className="flex items-center gap-1.5">
            {/* sóng */}
            <span className="flex items-end gap-[2px]">
              <span className="w-[3px] h-[4px] rounded-[1px] bg-ink" />
              <span className="w-[3px] h-[6px] rounded-[1px] bg-ink" />
              <span className="w-[3px] h-[8px] rounded-[1px] bg-ink" />
              <span className="w-[3px] h-[10px] rounded-[1px] bg-ink/40" />
            </span>
            {/* pin */}
            <span className="relative w-[22px] h-[11px] rounded-[3px] border border-ink/60">
              <span className="absolute inset-[1.5px] right-[6px] rounded-[1.5px] bg-ink" />
              <span className="absolute -right-[3px] top-[3px] w-[2px] h-[4px] rounded-r-[1px] bg-ink/60" />
            </span>
          </span>
        </div>

        <PhonePortalContext.Provider value={portalEl}>
          {children}
        </PhonePortalContext.Provider>

        {/* Home indicator — desktop bezel */}
        <div
          aria-hidden
          className="hidden md:block absolute bottom-[6px] left-1/2 -translate-x-1/2 w-[120px] h-[5px] rounded-full bg-ink/30 z-30 pointer-events-none"
        />
      </div>
    </div>
  );
}
