"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { gsap, useGSAP, DUR, prefersReducedMotion } from "@/lib/gsap";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";
import { usePhonePortal } from "./phone-frame";

interface SheetProps {
  open: boolean;
  onClose(): void;
  /** Title hiển thị + aria-label cho dialog. */
  title: string;
  children: ReactNode;
  /** Cho phép sheet cao tới 92% khung (form dài). Mặc định 80%. */
  tall?: boolean;
}

/**
 * Bottom sheet trượt từ đáy — primitive mobile thay cho Modal desktop
 * (spec: Modal → Sheet khi build thật, đây là bản preview).
 *
 * - Portal vào PhoneFrame (không phải document.body) để sheet nằm trong "máy".
 * - GSAP: backdrop autoAlpha + panel yPercent (transform, không animate top/height).
 *   Bọc trong gsap.matchMedia() với điều kiện prefers-reduced-motion —
 *   reduce = duration 0 (hiện/ẩn tức thì).
 * - Kéo tay cầm xuống >80px để đóng (drag bằng pointer events + gsap, không cần
 *   plugin Draggable cho mockup).
 * - Esc / chạm backdrop để đóng. role=dialog + aria-modal.
 */
export function Sheet({ open, onClose, title, children, tall }: SheetProps) {
  const portal = usePhonePortal();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  // Giữ mount trong lúc animate đóng.
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  // Reduced-motion theo convention repo (prefersReducedMotion — như Reveal/
  // CountUp): reduce → gsap.set đồng bộ, hiện/ẩn tức thì không chờ ticker.
  // Khi wiring bản thật, animation chỉ-mobile sẽ bọc thêm gsap.matchMedia
  // theo breakpoint (<768px) — trong preview khung luôn là mobile nên không gate.
  useGSAP(
    () => {
      if (!present || !panelRef.current || !backdropRef.current) return;
      const panel = panelRef.current;
      const backdrop = backdropRef.current;
      const reduce = prefersReducedMotion();

      if (open) {
        if (reduce) {
          gsap.set(backdrop, { autoAlpha: 1 });
          gsap.set(panel, { yPercent: 0 });
        } else {
          gsap.fromTo(backdrop, { autoAlpha: 0 }, { autoAlpha: 1, duration: DUR.base * 0.85 });
          gsap.fromTo(
            panel,
            { yPercent: 100 },
            { yPercent: 0, duration: DUR.base * 0.85, ease: "power3.out" }
          );
        }
        panel.focus({ preventScroll: true });
      } else if (reduce) {
        gsap.set(backdrop, { autoAlpha: 0 });
        gsap.set(panel, { yPercent: 100 });
        setPresent(false);
      } else {
        gsap.to(backdrop, { autoAlpha: 0, duration: DUR.base * 0.85 });
        gsap.to(panel, {
          yPercent: 100,
          duration: DUR.base * 0.85,
          ease: "power3.in",
          onComplete: () => setPresent(false),
        });
      }
    },
    { dependencies: [open, present], scope: rootRef }
  );

  // Kéo xuống để đóng — bám vào vùng tay cầm.
  useGSAP(
    (_, contextSafe) => {
      const panel = panelRef.current;
      if (!present || !open || !panel || !contextSafe) return;
      const handle = panel.querySelector<HTMLElement>("[data-sheet-handle]");
      if (!handle) return;

      let startY = 0;
      let dragging = false;

      const onMove = contextSafe((e: PointerEvent) => {
        if (!dragging) return;
        const dy = Math.max(0, e.clientY - startY);
        gsap.set(panel, { y: dy });
      });
      const onUp = contextSafe((e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        const dy = Math.max(0, e.clientY - startY);
        if (dy > 80) {
          onClose();
        } else {
          gsap.to(panel, { y: 0, duration: DUR.fast, ease: "power2.out" });
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      });
      const onDown = contextSafe((e: PointerEvent) => {
        dragging = true;
        startY = e.clientY;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });

      handle.addEventListener("pointerdown", onDown);
      return () => {
        handle.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
    },
    { dependencies: [open, present], scope: rootRef }
  );

  // Esc để đóng.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!portal || !present) return null;

  return createPortal(
    <div ref={rootRef} className="absolute inset-0 z-40">
      <div
        ref={backdropRef}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm opacity-0"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          // KHÔNG dùng class translate-y-full ở đây: GSAP import translateY
          // của class thành y px nền → bẩn mọi tween sau. GSAP set vị trí
          // trong layout effect (useGSAP) trước paint nên không flash.
          "absolute inset-x-0 bottom-0",
          "bg-surface rounded-t-2xl shadow-modal focus:outline-none",
          "flex flex-col",
          tall ? "max-h-[92%]" : "max-h-[80%]"
        )}
      >
        {/* Tay cầm kéo */}
        <div
          data-sheet-handle
          className="shrink-0 pt-2.5 pb-1.5 cursor-grab touch-none"
          aria-hidden
        >
          <div className="mx-auto w-10 h-1.5 rounded-full bg-border" />
        </div>
        <div className="shrink-0 px-5 pb-2 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="w-11 h-11 -mr-2 rounded-full flex items-center justify-center text-muted hover:bg-surface-muted"
          >
            <Icon name="x" size={20} />
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+var(--pv-safe-bottom))]"
        >
          {children}
        </div>
      </div>
    </div>,
    portal
  );
}
